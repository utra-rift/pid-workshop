import { describe, expect, test } from "vitest";
import { ARM, simulate } from "#/sim/arm";
import { computeMetrics } from "#/sim/metrics";
import type { SimSpec } from "#/sim/types";

const level: SimSpec = { env: {}, durationS: 4 };
const variant = { name: "60°", target: 60 };
const last = (spec: SimSpec, fn: (a: number, t: number, dt: number) => number) =>
	simulate(spec, variant, fn).samples.at(-1);

describe("arm", () => {
	test("with no push, gravity drops it onto the lower hard stop", () => {
		expect(last(level, () => 0)?.angle).toBeCloseTo(ARM.minAngle, 5);
	});

	test("kG volts hold it level", () => {
		expect(last(level, () => ARM.kG)?.angle).toBeCloseTo(0, 3);
	});

	test("kG * cos(angle) holds it anywhere", () => {
		const spec: SimSpec = { env: { startAngle: 40 }, durationS: 4 };
		const hold = (angle: number) => ARM.kG * Math.cos((angle * Math.PI) / 180);
		expect(last(spec, hold)?.angle).toBeCloseTo(40, 3);
	});

	test("output is clipped to the battery", () => {
		const run = simulate(level, variant, () => 1000);
		expect(Math.max(...run.samples.map((s) => s.volts))).toBe(ARM.maxVolts);
		expect(run.samples.at(-1)?.angle).toBeCloseTo(ARM.maxAngle, 5);
	});

	test("the controller runs every 5 ms", () => {
		const run = simulate(level, variant, () => 0);
		expect(run.samples).toHaveLength(level.durationS / ARM.controlDt);
		expect(run.samples[1].t - run.samples[0].t).toBeCloseTo(0.005, 9);
	});

	test("noise is the same for the same seed and different for another", () => {
		const spec: SimSpec = { env: { noise: { tick: 0.2, amplitude: 0.3 } }, durationS: 1 };
		const measured = (seed: number) => simulate(spec, { ...variant, seed }, () => ARM.kG).samples.map((s) => s.measured);
		expect(measured(7)).toEqual(measured(7));
		expect(measured(7)).not.toEqual(measured(8));
	});

	test("holding full power browns out the battery", () => {
		const spec: SimSpec = { env: { brownout: { threshold: 16, holdS: 0.15, sagged: 12 } }, durationS: 1 };
		const run = simulate(spec, variant, () => 24);
		expect(run.browned).toBe(true);
		expect(run.events.some((e) => e.kind === "brownout")).toBe(true);
		expect(Math.max(...run.samples.slice(-10).map((s) => s.volts))).toBe(12);
	});

	test("a controller that returns nothing stops the run with an issue", () => {
		const run = simulate(level, variant, () => undefined as unknown as number);
		expect(run.issue?.kind).toBe("returned-non-number");
		expect(run.samples).toHaveLength(0);
	});
});

describe("metrics", () => {
	test("overshoot is measured past the target in the direction of travel", () => {
		const m = computeMetrics(level, simulate(level, variant, (a, t) => (a < t ? 24 : 0)));
		expect(m.overshoot).toBeGreaterThan(5);
	});

	test("a steady hold has no jitter and a constant output", () => {
		const m = computeMetrics(level, simulate(level, variant, () => ARM.kG));
		expect(m.jitter).toBe(0);
		expect(m.constantOutput).toBe(true);
		expect(m.settleErr).toBeCloseTo(60, 1);
	});
});
