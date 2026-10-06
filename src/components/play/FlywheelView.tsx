import { useMemo } from "react";
import { FLYWHEEL } from "#/sim/flywheel";
import { formatRpm, ROBOT, targetAt } from "#/sim/robot";
import type { RunResult, SimSpec, Variant } from "#/sim/types";

const GAUGE = { x: 150, y: 104, r: 58 };
const WHEEL_R = 22;
// Each wheel's effort arc runs around its outer side, from 180° (left), so the two never meet.
const WHEELS = [
	{ x: 70, y: 194, turn: 1, side: 1 },
	{ x: 70, y: 242, turn: -1, side: -1 },
];
const LAUNCH = { x: 96, y: 218 };
const GROUND = 282;
/** The armour panel. Its height covers the level's shot tolerance. */
const PANEL = { x: 414, y: 226, half: 10 };
const FLIGHT_S = 0.12;
/** The spokes turn this many times slower than the wheel, so the eye can follow them. */
const SLOWDOWN = 40;

const polar = (cx: number, cy: number, deg: number, r: number) => {
	const rad = (deg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
};

/** 0 RPM at the bottom left of the gauge, the top of the scale at the bottom right. */
const gaugeAngle = (rpm: number) =>
	225 - 270 * Math.max(0, Math.min(1, rpm / FLYWHEEL.maxRpm));

const arc = (from: number, to: number, r: number) => {
	const a = polar(GAUGE.x, GAUGE.y, from, r);
	const b = polar(GAUGE.x, GAUGE.y, to, r);
	return `M ${a.x} ${a.y} A ${r} ${r} 0 ${from - to > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
};

/**
 * Where a shot lands. Slow shots drop low and fast ones fly high, scaled so
 * the panel covers the tolerance. Much too slow and it lands short.
 */
function landing(err: number, tolerance: number) {
	const y = PANEL.y + (err / tolerance) * PANEL.half;
	if (y <= GROUND - 3) {
		return {
			x: PANEL.x - 4,
			y: Math.max(y, 150),
			hit: Math.abs(err) <= tolerance,
		};
	}
	const short = Math.min(PANEL.x - 180, (y - GROUND) * 1.5);
	return { x: PANEL.x - 4 - short, y: GROUND - 3, hit: false };
}

interface FlywheelViewProps {
	spec: SimSpec;
	variant: Variant;
	run: RunResult | null;
	t: number;
}

/** The launcher at time t of a run: wheels, a speed gauge and where each shot lands. */
export function FlywheelView({ spec, variant, run, t }: FlywheelViewProps) {
	const samples = run?.samples ?? [];
	const index = Math.min(
		samples.length - 1,
		Math.max(0, Math.floor(t / ROBOT.controlDt)),
	);
	const sample = samples[index];
	const restSpeed = spec.env.startAtTarget
		? targetAt(spec, variant, 0)
		: (spec.env.start ?? 0);
	const speed = sample?.actual ?? restSpeed;
	const target = sample?.target ?? targetAt(spec, variant, 0);
	const volts = sample?.volts ?? 0;
	const now = sample ? t : 0;

	// How far the wheels have turned by each tick, in degrees.
	const turned = useMemo(() => {
		const out = new Float64Array(samples.length + 1);
		for (let i = 0; i < samples.length; i++) {
			out[i + 1] =
				out[i] + (samples[i].actual / 60) * ROBOT.controlDt * (360 / SLOWDOWN);
		}
		return out;
	}, [samples]);
	const spin = sample ? turned[index] : 0;

	const tolerance = spec.env.shots?.tolerance ?? 50;
	const shots = useMemo(
		() =>
			(run?.events ?? [])
				.filter((event) => event.kind === "shot")
				.map((event) => {
					const x = samples[Math.floor(event.t / ROBOT.controlDt + 1e-6)];
					const err = x ? x.target - x.actual : 0;
					return { t: event.t, ...landing(err, tolerance) };
				}),
		[run, samples, tolerance],
	);
	const landed = shots.filter((shot) => now >= shot.t + FLIGHT_S);
	const flying = shots.filter(
		(shot) => now >= shot.t && now < shot.t + FLIGHT_S,
	);
	const hits = landed.filter((shot) => shot.hit).length;
	const flash = landed.some(
		(shot) => shot.hit && now < shot.t + FLIGHT_S + 0.15,
	);
	const browned = (run?.events ?? []).some(
		(e) => e.kind === "brownout" && e.t <= now,
	);

	// Motor effort: an arc around each wheel, longer the harder it pushes.
	const effort = Math.max(-1, Math.min(1, volts / ROBOT.maxVolts));

	const needle = polar(GAUGE.x, GAUGE.y, gaugeAngle(speed), GAUGE.r - 10);
	const targetIn = polar(GAUGE.x, GAUGE.y, gaugeAngle(target), GAUGE.r - 9);
	const targetOut = polar(GAUGE.x, GAUGE.y, gaugeAngle(target), GAUGE.r + 7);

	return (
		<svg
			viewBox="0 0 460 300"
			className="block h-auto w-full"
			role="img"
			aria-label={`Flywheel at ${formatRpm(speed)} RPM, target ${formatRpm(target)} RPM`}
		>
			<defs>
				<pattern
					id="fly-dots"
					width="20"
					height="20"
					patternUnits="userSpaceOnUse"
				>
					<circle cx="1" cy="1" r="1" fill="#F4FBFC" opacity="0.06" />
				</pattern>
				<filter id="fly-glow" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="5" />
				</filter>
			</defs>
			<rect width="460" height="300" fill="url(#fly-dots)" />

			{/* Gauge */}
			<path
				d={arc(225, -45, GAUGE.r)}
				fill="none"
				stroke="#22324A"
				strokeWidth="6"
			/>
			{speed > 1 && (
				<path
					d={arc(225, gaugeAngle(speed), GAUGE.r)}
					fill="none"
					stroke={browned ? "#FF6B81" : "#4DC6E2"}
					strokeWidth="6"
				/>
			)}
			{Array.from({ length: 11 }, (_, i) => i * 1000).map((rpm) => {
				const major = rpm % 2000 === 0;
				const a = polar(GAUGE.x, GAUGE.y, gaugeAngle(rpm), GAUGE.r + 5);
				const b = polar(
					GAUGE.x,
					GAUGE.y,
					gaugeAngle(rpm),
					GAUGE.r + (major ? 11 : 8),
				);
				const label = polar(GAUGE.x, GAUGE.y, gaugeAngle(rpm), GAUGE.r + 21);
				return (
					<g key={rpm}>
						<line
							x1={a.x}
							y1={a.y}
							x2={b.x}
							y2={b.y}
							stroke="#4A5B73"
							strokeWidth="1"
						/>
						{major && (
							<text
								x={label.x}
								y={label.y + 3}
								textAnchor="middle"
								className="fill-ink-muted font-mono text-[9px]"
							>
								{rpm ? `${rpm / 1000}k` : "0"}
							</text>
						)}
					</g>
				);
			})}
			<line
				x1={targetIn.x}
				y1={targetIn.y}
				x2={targetOut.x}
				y2={targetOut.y}
				stroke="#A897FF"
				strokeWidth="2.5"
			/>
			<line
				x1={GAUGE.x}
				y1={GAUGE.y}
				x2={needle.x}
				y2={needle.y}
				stroke="#F4FBFC"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
			<circle cx={GAUGE.x} cy={GAUGE.y} r="5" fill="#F4FBFC" />
			<text
				x={GAUGE.x}
				y={GAUGE.y + 34}
				textAnchor="middle"
				className="fill-ink font-mono text-[18px] font-semibold"
			>
				{formatRpm(speed)}
			</text>
			<text
				x={GAUGE.x}
				y={GAUGE.y + 48}
				textAnchor="middle"
				className="fill-ink-muted font-wide text-[9px] font-semibold tracking-[0.08em]"
			>
				RPM
			</text>
			<text
				x={GAUGE.x}
				y={GAUGE.y + 66}
				textAnchor="middle"
				className="fill-violet-text font-mono text-[10px] font-semibold"
			>
				target {formatRpm(target)}
			</text>

			{/* Ground and the armour panel */}
			<line
				x1="16"
				y1={GROUND}
				x2="444"
				y2={GROUND}
				stroke="#22324A"
				strokeWidth="1"
			/>
			<line
				x1={PANEL.x + 6}
				y1="150"
				x2={PANEL.x + 6}
				y2={GROUND}
				stroke="#22324A"
				strokeWidth="1"
			/>
			<rect
				x={PANEL.x - 2}
				y={PANEL.y - PANEL.half}
				width="8"
				height={PANEL.half * 2}
				fill="#0E1A2E"
				stroke={flash ? "#F4FBFC" : "#4A5B73"}
				strokeWidth={flash ? 2 : 1}
			/>
			{[PANEL.y - PANEL.half - 4, PANEL.y + PANEL.half + 1].map((y) => (
				<rect
					key={y}
					x={PANEL.x - 2}
					y={y}
					width="8"
					height="3"
					fill="#FF6B81"
					opacity={flash ? 1 : 0.7}
				/>
			))}
			{spec.env.shots && (
				<text
					x={PANEL.x + 2}
					y="138"
					textAnchor="middle"
					className="fill-ink-muted font-wide text-[9px] font-semibold tracking-[0.08em]"
				>
					HITS {hits}/{landed.length}
				</text>
			)}

			{/* Shots */}
			{landed.map((shot) => (
				<circle
					key={shot.t}
					cx={shot.x}
					cy={shot.y}
					r="3"
					fill={shot.hit ? "#4DC6E2" : "#FF6B81"}
					opacity="0.85"
				/>
			))}
			{flying.map((shot) => {
				const u = (now - shot.t) / FLIGHT_S;
				const x = LAUNCH.x + (shot.x - LAUNCH.x) * u;
				const y = LAUNCH.y + (shot.y - LAUNCH.y) * u * u;
				return (
					<g key={shot.t}>
						<circle
							cx={x}
							cy={y}
							r="7"
							fill="#FFC861"
							opacity="0.35"
							filter="url(#fly-glow)"
						/>
						<circle cx={x} cy={y} r="4" fill="#FFC861" />
					</g>
				);
			})}

			{/* Launcher: two wheels that pinch the projectile between them */}
			<line
				x1={LAUNCH.x - 4}
				y1={LAUNCH.y - 7}
				x2={LAUNCH.x + 22}
				y2={LAUNCH.y - 7}
				stroke="#4A5B73"
				strokeWidth="2"
			/>
			<line
				x1={LAUNCH.x - 4}
				y1={LAUNCH.y + 7}
				x2={LAUNCH.x + 22}
				y2={LAUNCH.y + 7}
				stroke="#4A5B73"
				strokeWidth="2"
			/>
			{WHEELS.map((wheel) => {
				const sweep = Math.abs(effort) * 180;
				const ringStart = polar(wheel.x, wheel.y, 180, WHEEL_R + 6);
				const ringEnd = polar(
					wheel.x,
					wheel.y,
					180 - wheel.side * sweep,
					WHEEL_R + 6,
				);
				return (
					<g key={wheel.y}>
						<circle
							cx={wheel.x}
							cy={wheel.y}
							r={WHEEL_R}
							fill="#0E1A2E"
							stroke="#F4FBFC"
							strokeWidth="4"
						/>
						<g
							transform={`rotate(${(spin * wheel.turn) % 360} ${wheel.x} ${wheel.y})`}
						>
							{[0, 120, 240].map((a) => {
								const end = polar(wheel.x, wheel.y, a, WHEEL_R - 4);
								return (
									<line
										key={a}
										x1={wheel.x}
										y1={wheel.y}
										x2={end.x}
										y2={end.y}
										stroke="#4DC6E2"
										strokeWidth="3"
										strokeLinecap="round"
									/>
								);
							})}
						</g>
						<circle cx={wheel.x} cy={wheel.y} r="4" fill="#F4FBFC" />
						{Math.abs(effort) > 0.01 && (
							<path
								d={`M ${ringStart.x} ${ringStart.y} A ${WHEEL_R + 6} ${WHEEL_R + 6} 0 0 ${wheel.side > 0 ? 1 : 0} ${ringEnd.x} ${ringEnd.y}`}
								fill="none"
								stroke={
									browned ? "#FF6B81" : effort < 0 ? "#FFC861" : "#4DC6E2"
								}
								strokeWidth="3"
								strokeLinecap="round"
								opacity="0.8"
							/>
						)}
					</g>
				);
			})}

			{browned && (
				<text
					x="444"
					y="296"
					textAnchor="end"
					className="fill-[#FF6B81] font-wide text-[11px] font-semibold tracking-[0.08em]"
				>
					BROWNOUT
				</text>
			)}
		</svg>
	);
}
