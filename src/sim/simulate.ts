import { createArm } from "./arm";
import { createFlywheel } from "./flywheel";
import { createRng } from "./rng";
import { ROBOT, targetAt } from "./robot";
import {
	ControllerError,
	type ControllerFn,
	type RunIssue,
	type RunResult,
	type Sample,
	type SimEvent,
	type SimSpec,
	type Variant,
} from "./types";

const MAX_PLOTS = 8;
const MAX_LOGS = 500;

/** Collects plot() and print output from the student's code during a run. */
export class Recorder {
	tick = 0;
	readonly plots: Record<string, (number | null)[]> = {};
	readonly logs: string[] = [];

	plot = (name: string, value: number) => {
		let series = this.plots[name];
		if (!series) {
			if (Object.keys(this.plots).length >= MAX_PLOTS) return;
			series = [];
			this.plots[name] = series;
		}
		series[this.tick] = Number.isFinite(value) ? value : null;
	};

	log = (text: string) => {
		for (const line of text.replace(/\n$/, "").split("\n")) {
			if (this.logs.length < MAX_LOGS) this.logs.push(line);
			else if (this.logs.length === MAX_LOGS) {
				this.logs.push(`Console output stops at ${MAX_LOGS} lines.`);
			}
		}
	};

	/** Fills the gaps left by ticks that didn't call plot(). */
	finish(ticks: number): Record<string, (number | null)[]> {
		const out: Record<string, (number | null)[]> = {};
		for (const [name, series] of Object.entries(this.plots)) {
			out[name] = Array.from({ length: ticks }, (_, i) => series[i] ?? null);
		}
		return out;
	}
}

/**
 * Runs one variant of a level against a controller. The controller is called
 * every 5 ms with the sensor reading; the physics steps every 1 ms in between.
 * Stops early if the controller throws or returns something that isn't a number.
 */
export function simulate(
	spec: SimSpec,
	variant: Variant,
	controller: ControllerFn,
	recorder = new Recorder(),
): RunResult {
	const { env } = spec;
	const rng = createRng(variant.seed ?? 1);
	const ticks = Math.round(spec.durationS / ROBOT.controlDt);
	const substeps = Math.round(ROBOT.controlDt / ROBOT.physicsDt);

	const samples: Sample[] = [];
	const events: SimEvent[] = [];
	let issue: RunIssue | undefined;

	const start = env.startAtTarget
		? targetAt(spec, variant, 0)
		: (env.start ?? 0);
	const plant = (spec.mechanism === "flywheel" ? createFlywheel : createArm)(
		spec,
		variant,
		start,
		events,
	);
	for (const waypoint of env.sequence?.slice(1) ?? []) {
		events.push({ t: waypoint.t, kind: "waypoint" });
	}

	let maxVolts: number = ROBOT.maxVolts;
	let overThresholdS = 0;
	let browned = false;

	for (let i = 0; i < ticks; i++) {
		const t = i * ROBOT.controlDt;
		const target = targetAt(spec, variant, t);

		let measured = plant.value;
		if (env.noise) {
			const { tick, amplitude } = env.noise;
			if (tick > 0) measured = Math.round(measured / tick) * tick;
			measured += (rng() * 2 - 1) * amplitude;
		}

		recorder.tick = i;
		let requested: number;
		try {
			const out = controller(measured, target, ROBOT.controlDt);
			if (typeof out !== "number") {
				issue = {
					kind: "returned-non-number",
					message:
						out === undefined || out === null
							? "Your controller didn't return anything. Did you forget `return`?"
							: `Your controller returned ${describe(out)} instead of a number of volts.`,
					t,
				};
				break;
			}
			if (!Number.isFinite(out)) {
				issue = {
					kind: "returned-nan",
					message: `Output became ${Number.isNaN(out) ? "NaN" : "infinite"} at t=${t.toFixed(2)} s. That usually means dividing by zero or using a value before it's set.`,
					t,
				};
				break;
			}
			requested = out;
		} catch (error) {
			if (error instanceof ControllerError) {
				issue = { ...error.issue, t: error.issue.t ?? t };
				break;
			}
			throw error;
		}

		const volts = Math.max(-maxVolts, Math.min(maxVolts, requested));
		samples.push({
			t,
			target,
			measured,
			actual: plant.value,
			requested,
			volts,
		});

		if (env.brownout && !browned) {
			overThresholdS =
				Math.abs(volts) > env.brownout.threshold
					? overThresholdS + ROBOT.controlDt
					: 0;
			if (overThresholdS >= env.brownout.holdS - 1e-9) {
				browned = true;
				maxVolts = env.brownout.sagged;
				events.push({ t, kind: "brownout" });
			}
		}

		for (let s = 0; s < substeps; s++) {
			plant.step(volts, t + s * ROBOT.physicsDt);
		}
	}

	return {
		variant,
		samples,
		plots: recorder.finish(samples.length),
		logs: recorder.logs,
		events: events
			.filter((event) => event.t <= spec.durationS)
			.sort((a, b) => a.t - b.t),
		browned,
		issue,
	};
}

function describe(value: unknown): string {
	if (typeof value === "string") return `the text "${value.slice(0, 40)}"`;
	if (typeof value === "boolean") return value ? "True" : "False";
	if (Array.isArray(value)) return "a list";
	return `a ${typeof value}`;
}
