import { type Plant, ROBOT } from "./robot";
import type { SimEvent, SimSpec, Variant } from "./types";

/**
 * The launcher's flywheel, in the same feedforward form as the arm but with
 * no gravity: it only has to beat its own drag.
 *   volts = kV * speed + kA * acceleration
 * Speeds are in RPM.
 */
export const FLYWHEEL = {
	/** Volts per RPM to keep it spinning: 24 V tops out at 9,600 RPM. */
	kV: 0.0025,
	/** Volts per RPM/s: the wheel's inertia. Spinning up takes about half a second. */
	kA: 0.00125,
	/** The top of the gauge. */
	maxRpm: 10_000,
	defaultTarget: 6000,
} as const;

/** A flywheel spinning at `start` RPM. */
export function createFlywheel(
	spec: SimSpec,
	variant: Variant,
	start: number,
	events: SimEvent[],
): Plant {
	const { shots } = spec.env;
	const drag = variant.drag ?? 1;
	const inertia = variant.weight ?? 1;
	let rpm = start;
	let fired = 0;

	return {
		get value() {
			return rpm;
		},
		step(volts, now) {
			if (
				shots &&
				fired < shots.count &&
				now >= shots.startS + fired * shots.everyS - 1e-9
			) {
				// The projectile takes some of the wheel's energy with it.
				events.push({ t: now, kind: "shot" });
				if (rpm > 0) rpm = Math.max(0, rpm - shots.loss);
				fired++;
			}
			const accel =
				(volts - FLYWHEEL.kV * drag * rpm) / (FLYWHEEL.kA * inertia);
			rpm += accel * ROBOT.physicsDt;
		},
	};
}
