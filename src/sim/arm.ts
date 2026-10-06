import { type Plant, ROBOT } from "./robot";
import type { SimEvent, SimSpec, Variant } from "./types";

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
	/** Hard stops, degrees. */
	minAngle: -30,
	maxAngle: 150,
	defaultTarget: 60,
} as const;

const DEG = Math.PI / 180;

/** An arm starting at `start` degrees, at rest. */
export function createArm(
	spec: SimSpec,
	variant: Variant,
	start: number,
	events: SimEvent[],
): Plant {
	const { env } = spec;
	const weight = variant.weight ?? 1;
	let theta = start * DEG;
	let omega = 0;
	let load = 1;
	let lastHit = -1;

	if (env.latch) events.push({ t: env.latch.untilS, kind: "release" });
	if (env.reload) events.push({ t: env.reload.t, kind: "reload" });

	return {
		get value() {
			return theta / DEG;
		},
		step(volts, now) {
			if (env.reload && now >= env.reload.t) load = env.reload.weight;
			const mass = weight * load;

			let push = volts;
			if (env.hits && now >= env.hits.startS) {
				const k = Math.floor((now - env.hits.startS) / env.hits.everyS);
				const phase = now - env.hits.startS - k * env.hits.everyS;
				if (phase < env.hits.widthS) {
					push += (k % 2 === 0 ? -1 : 1) * env.hits.volts;
					if (k !== lastHit) {
						lastHit = k;
						events.push({ t: now, kind: "hit" });
					}
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

			omega += (net / (ARM.kA * mass)) * ROBOT.physicsDt;
			theta += omega * ROBOT.physicsDt;

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
		},
	};
}
