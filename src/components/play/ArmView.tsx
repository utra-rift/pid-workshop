import { ARM, targetAt } from "#/sim/arm";
import type { RunResult, SimSpec, Variant } from "#/sim/types";

const PIVOT = { x: 230, y: 214 };
const LENGTH = 150;
const SCALE = [-30, 0, 30, 60, 90, 120, 150];

const polar = (deg: number, r: number) => {
	const rad = (deg * Math.PI) / 180;
	return { x: PIVOT.x + r * Math.cos(rad), y: PIVOT.y - r * Math.sin(rad) };
};

interface ArmViewProps {
	spec: SimSpec;
	variant: Variant;
	run: RunResult | null;
	t: number;
}

/** The arm at time t of a run, or at rest before the first run. */
export function ArmView({ spec, variant, run, t }: ArmViewProps) {
	const samples = run?.samples ?? [];
	const index = Math.min(
		samples.length - 1,
		Math.max(0, Math.floor(t / ARM.controlDt)),
	);
	const sample = samples[index];
	const restAngle = spec.env.startAtTarget
		? targetAt(spec, variant, 0)
		: (spec.env.startAngle ?? 0);
	const angle = sample?.angle ?? restAngle;
	const target = sample?.target ?? targetAt(spec, variant, 0);
	const volts = sample?.volts ?? 0;
	const now = sample ? t : 0;

	const events = run?.events ?? [];
	const hasPiece = events.some((e) => e.kind === "piece" && e.t <= now);
	const browned = events.some((e) => e.kind === "brownout" && e.t <= now);
	const bump = events.find(
		(e) => e.kind === "bump" && now >= e.t && now - e.t < 0.18,
	);
	const latch =
		spec.env.latch && now < spec.env.latch.untilS ? spec.env.latch : null;

	const tip = polar(angle, LENGTH);
	const targetEnd = polar(target, LENGTH + 28);
	const targetLabel = polar(target, LENGTH + 54);

	// Motor effort: an arc around the pivot, longer the harder it pushes.
	const effort = Math.max(-1, Math.min(1, volts / ARM.maxVolts));
	const ringR = 26;
	const sweep = effort * 300;
	const ringStart = polar(angle, ringR);
	const ringEnd = polar(angle + sweep, ringR);
	const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
	const ringPath = `M ${ringStart.x} ${ringStart.y} A ${ringR} ${ringR} 0 ${largeArc} ${sweep > 0 ? 0 : 1} ${ringEnd.x} ${ringEnd.y}`;

	const arcStart = polar(-30, LENGTH + 18);
	const arcEnd = polar(150, LENGTH + 18);

	return (
		<svg
			viewBox="0 0 460 300"
			className="block h-auto w-full"
			role="img"
			aria-label={`Arm at ${angle.toFixed(1)} degrees, target ${target.toFixed(0)} degrees`}
		>
			<defs>
				<pattern
					id="arm-dots"
					width="20"
					height="20"
					patternUnits="userSpaceOnUse"
				>
					<circle cx="1" cy="1" r="1" fill="#F4FBFC" opacity="0.06" />
				</pattern>
				<filter id="arm-glow" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="6" />
				</filter>
			</defs>
			<rect width="460" height="300" fill="url(#arm-dots)" />

			{/* Scale */}
			<path
				d={`M ${arcStart.x} ${arcStart.y} A ${LENGTH + 18} ${LENGTH + 18} 0 0 0 ${arcEnd.x} ${arcEnd.y}`}
				fill="none"
				stroke="#22324A"
				strokeWidth="1"
			/>
			{SCALE.map((deg) => {
				const a = polar(deg, LENGTH + 13);
				const b = polar(deg, LENGTH + 23);
				const label = polar(deg, LENGTH + 36);
				return (
					<g key={deg}>
						<line
							x1={a.x}
							y1={a.y}
							x2={b.x}
							y2={b.y}
							stroke="#4A5B73"
							strokeWidth="1"
						/>
						<text
							x={label.x}
							y={label.y + 3}
							textAnchor="middle"
							className="fill-ink-muted font-mono text-[9px]"
						>
							{deg}°
						</text>
					</g>
				);
			})}
			{/* Hard stops */}
			{[ARM.minAngle, ARM.maxAngle].map((deg) => {
				const a = polar(deg, 34);
				const b = polar(deg, LENGTH - 6);
				return (
					<line
						key={deg}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke="#22324A"
						strokeWidth="2"
						strokeDasharray="2 6"
					/>
				);
			})}

			{/* Target */}
			<line
				x1={PIVOT.x}
				y1={PIVOT.y}
				x2={targetEnd.x}
				y2={targetEnd.y}
				stroke="#A897FF"
				strokeWidth="1.5"
				strokeDasharray="5 5"
			/>
			<text
				x={targetLabel.x}
				y={targetLabel.y + 3}
				textAnchor="middle"
				className="fill-violet-text font-mono text-[10px] font-semibold"
			>
				{target.toFixed(0)}°
			</text>

			{/* Latch */}
			{latch && (
				<g>
					{(() => {
						const a = polar(latch.maxAngle + 4, LENGTH * 0.55);
						const b = polar(latch.maxAngle + 4, LENGTH + 6);
						const label = polar(latch.maxAngle + 12, LENGTH * 0.8);
						return (
							<>
								<line
									x1={a.x}
									y1={a.y}
									x2={b.x}
									y2={b.y}
									stroke="#9FB0C6"
									strokeWidth="6"
									strokeLinecap="square"
								/>
								<text
									x={label.x}
									y={label.y}
									textAnchor="middle"
									className="fill-ink-muted font-wide text-[9px] font-semibold tracking-[0.08em]"
								>
									LATCH
								</text>
							</>
						);
					})()}
				</g>
			)}

			{/* Arm */}
			<line
				x1={PIVOT.x}
				y1={PIVOT.y}
				x2={tip.x}
				y2={tip.y}
				stroke="#F4FBFC"
				strokeWidth="12"
				strokeLinecap="round"
			/>
			<line
				x1={PIVOT.x}
				y1={PIVOT.y}
				x2={tip.x}
				y2={tip.y}
				stroke="#0E1A2E"
				strokeWidth="3"
				strokeLinecap="round"
				opacity="0.35"
			/>
			<circle
				cx={tip.x}
				cy={tip.y}
				r="14"
				fill="#4DC6E2"
				opacity="0.35"
				filter="url(#arm-glow)"
			/>
			<circle cx={tip.x} cy={tip.y} r="8" fill="#4DC6E2" />
			{hasPiece && (
				<circle
					cx={tip.x}
					cy={tip.y}
					r="13"
					fill="none"
					stroke="#A897FF"
					strokeWidth="4"
				/>
			)}
			{bump && (
				<circle
					cx={tip.x}
					cy={tip.y}
					r={18 + (now - bump.t) * 120}
					fill="none"
					stroke="#F4FBFC"
					strokeWidth="2"
					opacity={1 - (now - bump.t) / 0.18}
				/>
			)}

			{/* Motor */}
			<circle
				cx={PIVOT.x}
				cy={PIVOT.y}
				r="18"
				fill="#0E1A2E"
				stroke="#4A5B73"
				strokeWidth="2"
			/>
			{Math.abs(effort) > 0.01 && (
				<path
					d={ringPath}
					fill="none"
					stroke={browned ? "#FF6B81" : "#4DC6E2"}
					strokeWidth="4"
					strokeLinecap="round"
				/>
			)}
			<circle cx={PIVOT.x} cy={PIVOT.y} r="5" fill="#F4FBFC" />

			{browned && (
				<text
					x="444"
					y="286"
					textAnchor="end"
					className="fill-[#FF6B81] font-wide text-[11px] font-semibold tracking-[0.08em]"
				>
					BROWNOUT
				</text>
			)}
		</svg>
	);
}
