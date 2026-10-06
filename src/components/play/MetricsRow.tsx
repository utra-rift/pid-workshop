import { Check, X } from "lucide-react";
import type { VariantGrade } from "#/coach/grade";
import { cn } from "#/lib/utils";
import type { Metrics } from "#/sim/metrics";

interface MetricsRowProps {
	metrics: Metrics | null;
	variants: VariantGrade[];
	selected: number;
	onSelect: (index: number) => void;
}

const fmt = (v: number | undefined, unit: string, digits = 1) =>
	v === undefined || !Number.isFinite(v) ? "–" : `${v.toFixed(digits)}${unit}`;

export function MetricsRow({
	metrics,
	variants,
	selected,
	onSelect,
}: MetricsRowProps) {
	const cells = [
		{ label: "Overshoot", value: fmt(metrics?.overshoot, "°") },
		{ label: "Settle error", value: fmt(metrics?.settleErr, "°", 2) },
		{ label: "Peak motor", value: fmt(metrics?.peakVolts, " V") },
		{ label: "Jitter", value: fmt(metrics?.jitter, " V", 2) },
	];
	return (
		<div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
			{cells.map((cell) => (
				<div
					key={cell.label}
					className="flex flex-col gap-1 bg-surface-raised px-4 py-3"
				>
					<span className="type-label text-[11px] text-ink-muted">
						{cell.label}
					</span>
					<span className="font-mono text-lg text-ink tabular-nums">
						{cell.value}
					</span>
				</div>
			))}
			<div className="flex flex-col gap-1.5 bg-surface-raised px-4 py-3">
				<span className="type-label text-[11px] text-ink-muted">
					Tests{" "}
					{variants.length
						? `${variants.filter((v) => v.passed).length}/${variants.length}`
						: ""}
				</span>
				<div className="flex flex-wrap gap-1.5">
					{variants.map((v, i) => (
						<button
							key={v.variant.name}
							type="button"
							onClick={() => onSelect(i)}
							title={`${v.variant.name}: ${v.passed ? "passed" : "failed"}${i === selected ? " (showing)" : ""}`}
							aria-pressed={i === selected}
							className={cn(
								"flex size-7 cursor-pointer items-center justify-center rounded-sm border transition-colors",
								i === selected
									? "border-ink"
									: "border-line hover:border-ink-muted",
								v.passed ? "text-cyan" : "text-[#FF6B81]",
							)}
						>
							{v.passed ? (
								<Check className="size-4" aria-hidden />
							) : (
								<X className="size-4" aria-hidden />
							)}
							<span className="sr-only">{v.variant.name}</span>
						</button>
					))}
					{!variants.length && (
						<span className="font-mono text-lg text-ink">–</span>
					)}
				</div>
			</div>
		</div>
	);
}
