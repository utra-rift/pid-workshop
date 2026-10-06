import type { Level } from "#/levels";
import type { BuildResult } from "#/runtimes/types";
import { computeMetrics, type Metrics } from "#/sim/metrics";
import type { RunIssue, RunResult, Variant } from "#/sim/types";

export interface VariantGrade {
	variant: Variant;
	run?: RunResult;
	metrics?: Metrics;
	passed: boolean;
	issue?: RunIssue;
}

export interface Grade {
	passed: boolean;
	/** Short headline: "Level 3 complete", "Not yet", "Doesn't compile". */
	title: string;
	/** Plain English, may contain `code` and **bold**. */
	message: string;
	/** Line to highlight in the editor, if the problem is on one. */
	line?: number;
	variants: VariantGrade[];
}

const deg = (x: number) => `${x.toFixed(1)}°`;

export function grade(
	level: Level,
	build: BuildResult,
	results: RunResult[],
): Grade {
	if (!build.ok) {
		const issue = build.issue ?? {
			kind: "compile",
			message: "Your code doesn't compile.",
		};
		return {
			passed: false,
			title:
				issue.kind === "missing-function"
					? "Missing controller"
					: "Doesn't compile",
			message: issue.message,
			line: issue.line,
			variants: level.variants.map((variant) => ({ variant, passed: false })),
		};
	}

	const variants: VariantGrade[] = results.map((run) => {
		if (run.issue)
			return { variant: run.variant, run, passed: false, issue: run.issue };
		const metrics = computeMetrics(level.spec, run);
		return { variant: run.variant, run, metrics, passed: level.pass(metrics) };
	});

	if (variants.length && variants.every((v) => v.passed)) {
		return {
			passed: true,
			title: `Level ${level.number} complete`,
			message: level.why,
			variants,
		};
	}

	const failing = variants.find((v) => !v.passed) ?? variants[0];
	if (!failing) {
		return {
			passed: false,
			title: "Not yet",
			message: "Nothing ran.",
			variants,
		};
	}

	if (failing.issue) {
		return {
			passed: false,
			title:
				failing.issue.kind === "timeout" ? "Too slow" : "Your code crashed",
			message: failing.issue.message,
			line: failing.issue.line,
			variants,
		};
	}

	let message = coachFor(
		level,
		failing.metrics as Metrics,
		failing.run as RunResult,
	);
	if (failing !== variants[0] && variants[0]?.passed) {
		message = `It passes at ${variants[0].variant.name} but not at ${failing.variant.name}. ${message}`;
	}
	return { passed: false, title: "Not yet", message, variants };
}

/** Level-specific advice first, then general advice from how the arm moved. */
export function coachFor(level: Level, m: Metrics, run: RunResult): string {
	const specific = level.coach?.(m, run);
	if (specific) return specific;

	if (m.constantOutput) {
		return "Your output is the same every call, so the controller isn't reacting to the sensor.";
	}
	if (m.growing) {
		return "Each swing is bigger than the last. A gain is too high, so the loop is unstable.";
	}
	if (m.finalAngle > 110 && m.finalTarget < 100) {
		return "It shot past the target and fell over the top. Push less.";
	}
	if (m.minErr > 25) {
		return "It never gets near the target. Push harder, or hold up the arm's weight.";
	}
	if (m.saturatedS > 1) {
		return `The motor was maxed out for ${m.saturatedS.toFixed(1)} s straight, so the controller had no room to react.`;
	}
	if (m.overshoot > 5) {
		return `It swings ${deg(m.overshoot)} past the target. Brake on the way in.`;
	}
	if (m.settleErr > 1) {
		return m.finalAngle < m.finalTarget
			? `It settles ${deg(m.settleErr)} below the target.`
			: `It settles ${deg(m.settleErr)} above the target.`;
	}
	return "Close. Check the hint and run it again.";
}
