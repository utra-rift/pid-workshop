import type { Mechanism, SimSpec, Variant } from "./types";

/** What every mechanism shares: the battery and the control loop. */
export const ROBOT = {
	/** A 24 V robot battery. */
	maxVolts: 24,
	/** The controller runs at 200 Hz, a typical embedded control loop. */
	controlDt: 0.005,
	physicsDt: 0.001,
} as const;

/** The physics of one mechanism, stepped by the simulation loop. */
export interface Plant {
	/** Where it really is: degrees for the arm, RPM for the flywheel. */
	readonly value: number;
	/** Advances the physics by ROBOT.physicsDt, with `volts` at the motor from time `now`. */
	step(volts: number, now: number): void;
}

/** How each mechanism is described to students. */
export const MECHANISMS: Record<
	Mechanism,
	{
		/** For sentences: "the arm". */
		name: string;
		/** The controller's first parameter. */
		reading: string;
		format(value: number): string;
		/** Within this of the target counts as close, for rise time. */
		near: number;
		/** Swings smaller than this aren't instability. */
		wobble: number;
	}
> = {
	arm: {
		name: "arm",
		reading: "angle",
		format: (value) => `${value.toFixed(1)}°`,
		near: 5,
		wobble: 6,
	},
	flywheel: {
		name: "flywheel",
		reading: "speed",
		format: (value) => `${formatRpm(value)} RPM`,
		near: 100,
		wobble: 150,
	},
};

/** 6000 → "6,000". */
export function formatRpm(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

export function targetAt(spec: SimSpec, variant: Variant, t: number): number {
	const { sequence } = spec.env;
	if (!sequence?.length) return variant.target;
	let target = sequence[0].angle;
	for (const waypoint of sequence)
		if (t >= waypoint.t - 1e-9) target = waypoint.angle;
	return target;
}
