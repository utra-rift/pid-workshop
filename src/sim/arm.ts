import { createRng } from "./rng";
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

/**
 * The arm, in the usual feedforward form for a motor lifting a weight:
 *   volts = kG * cos(angle) + kV * velocity + kA * acceleration
 * so the motion follows from
 *   acceleration = (volts - kG * cos(angle) - kV * velocity) / kA
 */
export const ARM = {
	/** Volts to hold the arm level. */
	kG: 4.0,
	/** Volts per rad/s. Back-EMF and friction together. */
	kV: 3.2,
	/** Volts per rad/s². The arm's inertia. */
	kA: 0.7,
	/** A 24 V robot battery. */
	maxVolts: 24,
	/** Hard stops, degrees. */
	minAngle: -30,
	maxAngle: 150,
	/** The controller runs at 200 Hz, a typical embedded control loop. */
	controlDt: 0.005,
	physicsDt: 0.001,
	defaultTarget: 60,
} as const;

const DEG = Math.PI / 180;
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

export function targetAt(spec: SimSpec, variant: Variant, t: number): number {
	const { sequence } = spec.env;
	if (!sequence?.length) return variant.target;
	let target = sequence[0].angle;
	for (const waypoint of sequence)
		if (t >= waypoint.t - 1e-9) target = waypoint.angle;
	return target;
}

/**
 * Runs one variant of a level against a controller. The controller is called
 * every 20 ms with the encoder reading; the physics steps every 1 ms in between.
 * Stops early if the controller throws or returns something that isn't a number.
 */
export function simulate(
	spec: SimSpec,
	variant: Variant,
	controller: ControllerFn,
	recorder = new Recorder(),
): RunResult {
	const { env } = spec;
	const weight = variant.weight ?? 1;
	const rng = createRng(variant.seed ?? 1);
	const ticks = Math.round(spec.durationS / ARM.controlDt);
	const substeps = Math.round(ARM.controlDt / ARM.physicsDt);

	let theta =
		(env.startAtTarget ? targetAt(spec, variant, 0) : (env.startAngle ?? 0)) *
		DEG;
	let omega = 0;
	let maxVolts: number = ARM.maxVolts;
	let overThresholdS = 0;
	let browned = false;
	let pieceWeight = 1;

	const samples: Sample[] = [];
	const events: SimEvent[] = [];
	let issue: RunIssue | undefined;

	for (const waypoint of env.sequence?.slice(1) ?? []) {
		events.push({ t: waypoint.t, kind: "waypoint" });
	}
	if (env.latch) events.push({ t: env.latch.untilS, kind: "release" });
	if (env.gamePiece) events.push({ t: env.gamePiece.t, kind: "piece" });

	for (let i = 0; i < ticks; i++) {
		const t = i * ARM.controlDt;
		const target = targetAt(spec, variant, t);

		let measured = theta / DEG;
		if (env.noise) {
			const { tick, amplitude } = env.noise;
			if (tick > 0) measured = Math.round(measured / tick) * tick;
			measured += (rng() * 2 - 1) * amplitude;
		}

		recorder.tick = i;
		let requested: number;
		try {
			const out = controller(measured, target, ARM.controlDt);
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
		samples.push({ t, target, measured, angle: theta / DEG, requested, volts });

		if (env.brownout && !browned) {
			overThresholdS =
				Math.abs(volts) > env.brownout.threshold
					? overThresholdS + ARM.controlDt
					: 0;
			if (overThresholdS >= env.brownout.holdS - 1e-9) {
				browned = true;
				maxVolts = env.brownout.sagged;
				events.push({ t, kind: "brownout" });
			}
		}

		for (let s = 0; s < substeps; s++) {
			const now = t + s * ARM.physicsDt;
			if (env.gamePiece && now >= env.gamePiece.t)
				pieceWeight = env.gamePiece.weight;
			const mass = weight * pieceWeight;

			let push = volts;
			if (env.defense && now >= env.defense.startS) {
				const k = Math.floor((now - env.defense.startS) / env.defense.everyS);
				const phase = now - env.defense.startS - k * env.defense.everyS;
				if (phase < env.defense.widthS) {
					push += (k % 2 === 0 ? -1 : 1) * env.defense.volts;
					if (s === 0 && phase < ARM.controlDt)
						events.push({ t: now, kind: "bump" });
				}
			}

			const gravity = ARM.kG * mass * Math.cos(theta);
			let net = push - gravity - ARM.kV * omega;
			if (env.stiction) {
				if (Math.abs(omega) < 1e-3 && Math.abs(push - gravity) < env.stiction) {
					omega = 0;
					net = 0;
				} else {
					// Once it's moving, about half the breakaway force keeps dragging on it.
					net -= 0.5 * env.stiction * Math.sign(omega);
				}
			}

			omega += (net / (ARM.kA * mass)) * ARM.physicsDt;
			theta += omega * ARM.physicsDt;

			if (
				env.latch &&
				now < env.latch.untilS &&
				theta > env.latch.maxAngle * DEG
			) {
				theta = env.latch.maxAngle * DEG;
				omega = Math.min(omega, 0);
			}
			if (theta < ARM.minAngle * DEG) {
				theta = ARM.minAngle * DEG;
				omega = Math.max(omega, 0);
			} else if (theta > ARM.maxAngle * DEG) {
				theta = ARM.maxAngle * DEG;
				omega = Math.min(omega, 0);
			}
		}
	}

	return {
		variant,
		samples,
		plots: recorder.finish(samples.length),
		logs: recorder.logs,
		events: events.filter((event) => event.t <= spec.durationS),
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
