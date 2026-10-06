import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { ARM } from "#/sim/arm";
import { FLYWHEEL } from "#/sim/flywheel";
import { formatRpm, ROBOT } from "#/sim/robot";
import type { RunResult, SimSpec } from "#/sim/types";

export const SERIES_COLORS = {
	target: "#A897FF",
	actual: "#4DC6E2",
	volts: "#F4FBFC",
	grid: "#22324A",
	axis: "#7F92AB",
	cursor: "#9FB0C6",
};

/** Colors for plot() lines, in order of first use. */
export const PLOT_COLORS = [
	"#9FE3F2",
	"#C9BEFF",
	"#FFC861",
	"#F4FBFC",
	"#7F92AB",
	"#4DC6E2",
	"#A897FF",
	"#FF6B81",
];

interface ResponseChartProps {
	spec: SimSpec;
	run: RunResult | null;
	/** Playback position: the trace is drawn up to here. */
	t: number;
}

interface Strip {
	top: number;
	height: number;
	lo: number;
	hi: number;
	/** The data's own range, for labels. The strip adds padding around it. */
	dataLo?: number;
	dataHi?: number;
}

interface Series {
	key: string;
	strip: Strip;
	values: (number | null)[];
	color: string;
	width: number;
	dash?: number[];
}

const PAD = { left: 48, right: 12, top: 8, bottom: 26 };

/** How the main strip reads for each mechanism. */
const SCALES = {
	arm: {
		label: "arm",
		step: 30,
		tick: (v: number) => `${v}°`,
		value: (v: number) => `${v.toFixed(1)}°`,
		target: (v: number) => `${v.toFixed(0)}°`,
		valueWidth: 6,
		targetWidth: 4,
		range(lo: number, hi: number): [number, number] {
			return [
				Math.max(ARM.minAngle, Math.floor((Math.min(-5, lo) - 5) / 30) * 30),
				Math.min(
					ARM.maxAngle + 10,
					Math.ceil((Math.max(90, hi) + 5) / 30) * 30,
				),
			];
		},
		idle: "Run your code to see how the arm moves.",
	},
	flywheel: {
		label: "flywheel",
		step: 2000,
		tick: (v: number) => (v ? `${v / 1000}k` : "0"),
		value: (v: number) => `${formatRpm(v)} RPM`,
		target: (v: number) => `${formatRpm(v)} RPM`,
		valueWidth: 10,
		targetWidth: 9,
		range(lo: number, hi: number): [number, number] {
			// Before the first run, leave room for a typical target.
			const top = Number.isFinite(hi) ? hi : FLYWHEEL.defaultTarget;
			return [
				Number.isFinite(lo) ? Math.min(0, Math.floor(lo / 2000) * 2000) : 0,
				Math.min(
					FLYWHEEL.maxRpm,
					Math.max(2000, Math.ceil((top + 500) / 2000) * 2000),
				),
			];
		},
		idle: "Run your code to see how the flywheel spins.",
	},
};

export function ResponseChart({ spec, run, t }: ResponseChartProps) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [width, setWidth] = useState(600);
	const [hover, setHover] = useState<number | null>(null);
	// The series whose legend entry is hovered or focused; the rest dim.
	const [focus, setFocus] = useState<string | null>(null);
	const plotNames = useMemo(() => Object.keys(run?.plots ?? {}), [run]);
	const height = plotNames.length ? 340 : 236;
	const scale = SCALES[spec.mechanism];

	useEffect(() => {
		const el = canvas.current?.parentElement;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) =>
			setWidth(Math.max(280, entry.contentRect.width)),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const strips = useMemo(() => {
		const samples = run?.samples ?? [];
		const [lo, hi] = scale.range(
			Math.min(...samples.map((s) => Math.min(s.actual, s.target))),
			Math.max(...samples.map((s) => Math.max(s.actual, s.target))),
		);

		const innerH = height - PAD.top - PAD.bottom;
		const gap = 18;
		const mainH = plotNames.length ? innerH * 0.5 : innerH * 0.72;
		const voltsH = plotNames.length ? innerH * 0.18 : innerH - mainH - gap;
		const plotsH = plotNames.length ? innerH - mainH - voltsH - gap * 2 : 0;

		// Scale to the 1st-99th percentile so one spike (a derivative's first
		// tick, say) can't flatten everything else. Outliers get clipped.
		const values: number[] = [];
		for (const name of plotNames) {
			for (const v of run?.plots[name] ?? []) if (v !== null) values.push(v);
		}
		values.sort((a, b) => a - b);
		const at = (q: number) =>
			values[Math.min(values.length - 1, Math.floor(q * values.length))];
		let plo = values.length
			? values.length >= 100
				? at(0.01)
				: values[0]
			: Number.NaN;
		let phi = values.length
			? values.length >= 100
				? at(0.99)
				: values[values.length - 1]
			: Number.NaN;
		if (!Number.isFinite(plo) || !Number.isFinite(phi)) {
			plo = -1;
			phi = 1;
		}
		if (phi - plo < 1e-9) {
			plo -= 1;
			phi += 1;
		}
		const pad = (phi - plo) * 0.1;

		return {
			main: { top: PAD.top, height: mainH, lo, hi } as Strip,
			volts: {
				top: PAD.top + mainH + gap,
				height: voltsH,
				lo: -ROBOT.maxVolts,
				hi: ROBOT.maxVolts,
			} as Strip,
			plots: {
				top: PAD.top + mainH + voltsH + gap * 2,
				height: plotsH,
				lo: plo - pad,
				hi: phi + pad,
				dataLo: plo,
				dataHi: phi,
			} as Strip,
		};
	}, [run, plotNames, height, scale]);

	useEffect(() => {
		const el = canvas.current;
		if (!el) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		el.width = Math.round(width * dpr);
		el.height = Math.round(height * dpr);
		const ctx = el.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);

		const plotW = width - PAD.left - PAD.right;
		const x = (time: number) => PAD.left + (time / spec.durationS) * plotW;
		const y = (strip: Strip, v: number) =>
			strip.top + strip.height * (1 - (v - strip.lo) / (strip.hi - strip.lo));

		ctx.font =
			'500 10px "JetBrains Mono Variable", "JetBrains Mono", monospace';
		ctx.textBaseline = "middle";

		// Grid and axes.
		const gridLine = (strip: Strip, v: number, label: string) => {
			const yy = Math.round(y(strip, v)) + 0.5;
			ctx.strokeStyle = SERIES_COLORS.grid;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(PAD.left, yy);
			ctx.lineTo(width - PAD.right, yy);
			ctx.stroke();
			ctx.fillStyle = SERIES_COLORS.axis;
			ctx.textAlign = "right";
			ctx.fillText(label, PAD.left - 6, yy);
		};
		for (
			let v = Math.ceil(strips.main.lo / scale.step) * scale.step;
			v <= strips.main.hi;
			v += scale.step
		)
			gridLine(strips.main, v, scale.tick(v));
		for (const v of [-ROBOT.maxVolts, 0, ROBOT.maxVolts])
			gridLine(strips.volts, v, `${v}V`);
		if (plotNames.length) {
			const { dataLo = strips.plots.lo, dataHi = strips.plots.hi } =
				strips.plots;
			gridLine(strips.plots, dataHi, compact(dataHi));
			gridLine(strips.plots, dataLo, compact(dataLo));
			// A zero line, labelled only if the label clears the other two.
			if (dataLo < 0 && dataHi > 0) {
				const zero = y(strips.plots, 0);
				const clear =
					Math.min(
						zero - y(strips.plots, dataHi),
						y(strips.plots, dataLo) - zero,
					) >= 12;
				gridLine(strips.plots, 0, clear ? "0" : "");
			}
		}
		ctx.textAlign = "center";
		ctx.fillStyle = SERIES_COLORS.axis;
		for (let s = 0; s <= spec.durationS; s += 1)
			ctx.fillText(`${s}s`, x(s), height - PAD.bottom / 2);

		const samples = run?.samples ?? [];
		if (!samples.length) return;
		const last = Math.min(samples.length - 1, Math.floor(t / ROBOT.controlDt));

		const line = (
			strip: Strip,
			values: (number | null)[],
			color: string,
			widthPx: number,
			dash: number[] = [],
		) => {
			ctx.save();
			ctx.beginPath();
			ctx.rect(PAD.left, strip.top - 2, plotW, strip.height + 4);
			ctx.clip();
			ctx.strokeStyle = color;
			ctx.lineWidth = widthPx;
			ctx.setLineDash(dash);
			ctx.lineJoin = "round";
			ctx.beginPath();
			let pen = false;
			for (let i = 0; i <= last; i++) {
				const v = values[i];
				if (v === null || v === undefined) {
					pen = false;
					continue;
				}
				const px = x(samples[i].t);
				const py = y(strip, v);
				if (pen) ctx.lineTo(px, py);
				else ctx.moveTo(px, py);
				pen = true;
			}
			ctx.stroke();
			ctx.restore();
		};

		const series: Series[] = [
			{
				key: "target",
				strip: strips.main,
				values: samples.map((s) => s.target),
				color: SERIES_COLORS.target,
				width: 1.5,
				dash: [5, 4],
			},
			{
				key: "actual",
				strip: strips.main,
				values: samples.map((s) => s.actual),
				color: SERIES_COLORS.actual,
				width: 2,
			},
			{
				key: "volts",
				strip: strips.volts,
				values: samples.map((s) => s.volts),
				color: SERIES_COLORS.volts,
				width: 1.25,
			},
			...plotNames.map((name, i) => ({
				key: `plot:${name}`,
				strip: strips.plots,
				values: run?.plots[name] ?? [],
				color: PLOT_COLORS[i % PLOT_COLORS.length],
				width: 1.5,
			})),
		];
		// The highlighted series goes on top.
		series.sort((a, b) => Number(a.key === focus) - Number(b.key === focus));
		for (const s of series) {
			const dimmed = focus !== null && s.key !== focus;
			ctx.globalAlpha = dimmed ? 0.15 : 1;
			line(
				s.strip,
				s.values,
				s.color,
				s.key === focus ? s.width + 0.75 : s.width,
				s.dash,
			);
		}
		ctx.globalAlpha = 1;

		// Events.
		ctx.font = '600 9px "Widescreen", "Lexend Variable", sans-serif';
		for (const event of run?.events ?? []) {
			if (event.t > t) continue;
			const ex = Math.round(x(event.t)) + 0.5;
			if (event.kind === "shot") {
				// A short tick at the top: there can be many shots.
				ctx.strokeStyle = SHOT_COLOR;
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(ex, PAD.top);
				ctx.lineTo(ex, PAD.top + 7);
				ctx.stroke();
				ctx.lineWidth = 1;
				continue;
			}
			ctx.strokeStyle = event.kind === "brownout" ? "#FF6B81" : "#4A5B73";
			ctx.setLineDash([2, 3]);
			ctx.beginPath();
			ctx.moveTo(ex, PAD.top);
			ctx.lineTo(ex, height - PAD.bottom);
			ctx.stroke();
			ctx.setLineDash([]);
			if (event.kind !== "hit" && event.kind !== "waypoint") {
				ctx.fillStyle =
					event.kind === "brownout" ? "#FF6B81" : SERIES_COLORS.axis;
				ctx.textAlign = "left";
				ctx.fillText(EVENT_LABEL[event.kind], ex + 4, PAD.top + 6);
			}
		}

		// Playhead or hover line.
		const cursorT = hover ?? (t < spec.durationS - 1e-6 ? t : null);
		if (cursorT !== null) {
			const cx = Math.round(x(cursorT)) + 0.5;
			ctx.strokeStyle = SERIES_COLORS.cursor;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(cx, PAD.top);
			ctx.lineTo(cx, height - PAD.bottom);
			ctx.stroke();
		}
	}, [
		width,
		height,
		strips,
		scale,
		run,
		t,
		spec.durationS,
		plotNames,
		hover,
		focus,
	]);

	const samples = run?.samples ?? [];
	const readoutT = hover ?? Math.min(t, spec.durationS);
	const readoutIndex = Math.min(
		samples.length - 1,
		Math.floor(readoutT / ROBOT.controlDt),
	);
	const readout = samples.length ? samples[Math.max(0, readoutIndex)] : null;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 type-data text-ink-muted">
				<LegendItem
					color={SERIES_COLORS.target}
					dashed
					label="target"
					width={scale.targetWidth}
					focused={focus}
					seriesKey="target"
					onFocusChange={setFocus}
					value={readout ? scale.target(readout.target) : undefined}
				/>
				<LegendItem
					color={SERIES_COLORS.actual}
					label={scale.label}
					width={scale.valueWidth}
					focused={focus}
					seriesKey="actual"
					onFocusChange={setFocus}
					value={readout ? scale.value(readout.actual) : undefined}
				/>
				<LegendItem
					color={SERIES_COLORS.volts}
					label="motor"
					width={7}
					focused={focus}
					seriesKey="volts"
					onFocusChange={setFocus}
					value={readout ? `${readout.volts.toFixed(1)} V` : undefined}
				/>
				{plotNames.map((name, i) => {
					const v = run?.plots[name]?.[Math.max(0, readoutIndex)];
					return (
						<LegendItem
							key={name}
							color={PLOT_COLORS[i % PLOT_COLORS.length]}
							label={name}
							width={7}
							focused={focus}
							seriesKey={`plot:${name}`}
							onFocusChange={setFocus}
							value={v === null || v === undefined ? undefined : compact(v)}
						/>
					);
				})}
				<span
					className="ml-auto inline-block text-right tabular-nums"
					style={{ width: "7ch" }}
				>
					{readout ? `${readoutT.toFixed(2)} s` : ""}
				</span>
			</div>
			<div className="relative w-full">
				<canvas
					ref={canvas}
					style={{ width: "100%", height }}
					className="block"
					aria-label={`Response graph: target, ${spec.mechanism === "arm" ? "arm angle" : "flywheel speed"} and motor volts over time`}
					role="img"
					onMouseMove={(event) => {
						if (!samples.length) return;
						const rect = event.currentTarget.getBoundingClientRect();
						const plotW = rect.width - PAD.left - PAD.right;
						const time =
							((event.clientX - rect.left - PAD.left) / plotW) * spec.durationS;
						setHover(time >= 0 && time <= spec.durationS ? time : null);
					}}
					onMouseLeave={() => setHover(null)}
				/>
				{!samples.length && (
					<div className="absolute inset-0 flex items-center justify-center type-body-sm text-ink-muted">
						{scale.idle}
					</div>
				)}
			</div>
		</div>
	);
}

const EVENT_LABEL = {
	reload: "RELOAD",
	release: "RELEASE",
	brownout: "BROWNOUT",
	hit: "HIT",
	waypoint: "NEW TARGET",
	shot: "SHOT",
} as const;

const SHOT_COLOR = "#FFC861";

/**
 * A legend entry with its live value in a fixed-width slot, so values that
 * change every frame (the motor especially) don't shift the text around them.
 * Hovering or focusing it highlights its line and dims the others.
 */
function LegendItem({
	color,
	label,
	value,
	width,
	dashed,
	seriesKey,
	focused,
	onFocusChange,
}: {
	color: string;
	label: string;
	value?: string;
	/** Characters to reserve for the value. The font is monospaced. */
	width: number;
	dashed?: boolean;
	seriesKey: string;
	focused: string | null;
	onFocusChange: (key: string | null) => void;
}) {
	const dimmed = focused !== null && focused !== seriesKey;
	return (
		<button
			type="button"
			aria-pressed={focused === seriesKey}
			aria-label={`Highlight ${label}`}
			onMouseEnter={() => onFocusChange(seriesKey)}
			onMouseLeave={() => onFocusChange(null)}
			onFocus={() => onFocusChange(seriesKey)}
			onBlur={() => onFocusChange(null)}
			className={cn(
				"flex cursor-default items-center gap-1.5 rounded-xs transition-opacity",
				dimmed && "opacity-40",
			)}
		>
			<svg width="16" height="6" aria-hidden="true">
				<line
					x1="0"
					y1="3"
					x2="16"
					y2="3"
					stroke={color}
					strokeWidth="2"
					strokeDasharray={dashed ? "4 3" : undefined}
				/>
			</svg>
			<span>{label}</span>
			<span
				className="inline-block text-right text-ink tabular-nums"
				style={{ width: `${width}ch` }}
			>
				{value ?? ""}
			</span>
		</button>
	);
}

function compact(v: number): string {
	const abs = Math.abs(v);
	if (abs >= 1000) return v.toFixed(0);
	if (abs >= 100) return v.toFixed(1);
	return v.toFixed(2);
}
