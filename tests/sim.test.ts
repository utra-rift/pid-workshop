import { describe, expect, test } from "vitest";
import { ARM } from "#/sim/arm";
import { FLYWHEEL } from "#/sim/flywheel";
import { computeMetrics } from "#/sim/metrics";
import { ROBOT } from "#/sim/robot";
import { simulate } from "#/sim/simulate";
import type { SimSpec } from "#/sim/types";

const level: SimSpec = { mechanism: "arm", env: {}, durationS: 4 };
const variant = { name: "60°", target: 60 };
const last = (spec: SimSpec, fn: (a: number, t: number, dt: number) => number) =>
	simulate(spec, variant, fn).samples.at(-1);

describe("arm", () => {
	test("with no push, gravity drops it onto the lower hard stop", () => {
		expect(last(level, () => 0)?.actual).toBeCloseTo(ARM.minAngle, 5);
	});

	test("kG volts hold it level", () => {
		expect(last(level, () => ARM.kG)?.actual).toBeCloseTo(0, 3);
	});

	test("kG * cos(angle) holds it anywhere", () => {
		const spec: SimSpec = { mechanism: "arm", env: { start: 40 }, durationS: 4 };
		const hold = (angle: number) => ARM.kG * Math.cos((angle * Math.PI) / 180);
		expect(last(spec, hold)?.actual).toBeCloseTo(40, 3);
	});

	test("output is clipped to the battery", () => {
		const run = simulate(level, variant, () => 1000);
		expect(Math.max(...run.samples.map((s) => s.volts))).toBe(ROBOT.maxVolts);
		expect(run.samples.at(-1)?.actual).toBeCloseTo(ARM.maxAngle, 5);
	});

	test("the controller runs every 5 ms", () => {
		const run = simulate(level, variant, () => 0);
		expect(run.samples).toHaveLength(level.durationS / ROBOT.controlDt);
		expect(run.samples[1].t - run.samples[0].t).toBeCloseTo(0.005, 9);
	});

	test("noise is the same for the same seed and different for another", () => {
		const spec: SimSpec = { mechanism: "arm", env: { noise: { tick: 0.2, amplitude: 0.3 } }, durationS: 1 };
		const measured = (seed: number) => simulate(spec, { ...variant, seed }, () => ARM.kG).samples.map((s) => s.measured);
		expect(measured(7)).toEqual(measured(7));
		expect(measured(7)).not.toEqual(measured(8));
	});

	test("holding full power browns out the battery", () => {
		const spec: SimSpec = { mechanism: "arm", env: { brownout: { threshold: 16, holdS: 0.15, sagged: 12 } }, durationS: 1 };
		const run = simulate(spec, variant, () => 24);
		expect(run.browned).toBe(true);
		expect(run.events.some((e) => e.kind === "brownout")).toBe(true);
		expect(Math.max(...run.samples.slice(-10).map((s) => s.volts))).toBe(12);
	});

	test("a hopper refill makes it heavier from that moment", () => {
		const spec: SimSpec = { mechanism: "arm", env: { startAtTarget: true, reload: { t: 1, weight: 2 } }, durationS: 3 };
		const hold = (angle: number) => ARM.kG * Math.cos((angle * Math.PI) / 180);
		const run = simulate(spec, variant, hold);
		expect(run.samples[Math.round(0.9 / ROBOT.controlDt)].actual).toBeCloseTo(60, 3);
		expect(run.samples.at(-1)?.actual).toBeLessThan(55);
		expect(run.events).toContainEqual({ t: 1, kind: "reload" });
	});

	test("a controller that returns nothing stops the run with an issue", () => {
		const run = simulate(level, variant, () => undefined as unknown as number);
		expect(run.issue?.kind).toBe("returned-non-number");
		expect(run.samples).toHaveLength(0);
	});
});

describe("flywheel", () => {
	const spin: SimSpec = { mechanism: "flywheel", env: {}, durationS: 4 };
	const rpm = { name: "6,000 RPM", target: 6000 };

	test("kV volts per RPM hold any speed", () => {
		const run = simulate(spin, rpm, (_speed, target) => FLYWHEEL.kV * target);
		expect(run.samples.at(-1)?.actual).toBeCloseTo(6000, -1);
	});

	test("full power tops out at 24 / kV RPM", () => {
		const run = simulate({ ...spin, durationS: 8 }, rpm, () => 24);
		expect(run.samples.at(-1)?.actual).toBeCloseTo(24 / FLYWHEEL.kV, -1);
	});

	test("worn wheels drag more, so the same volts hold less speed", () => {
		const run = simulate(spin, { ...rpm, drag: 1.1 }, (_speed, target) => FLYWHEEL.kV * target);
		expect(run.samples.at(-1)?.actual).toBeCloseTo(6000 / 1.1, -1);
	});

	test("each shot costs the wheel its loss in RPM", () => {
		const spec: SimSpec = {
			mechanism: "flywheel",
			env: { start: 6000, shots: { startS: 0.5, everyS: 0.5, count: 2, loss: 400, tolerance: 50 } },
			durationS: 2,
		};
		const run = simulate(spec, rpm, () => FLYWHEEL.kV * 6000);
		const at = (t: number) => run.samples[Math.round(t / ROBOT.controlDt)].actual;
		expect(at(0.5)).toBeCloseTo(6000, 3);
		expect(at(0.505)).toBeLessThan(5650);
		expect(run.events.filter((e) => e.kind === "shot").map((e) => e.t)).toEqual([0.5, 1]);
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

	test("shot errors are the speed each projectile met, slow is positive", () => {
		const spec: SimSpec = {
			mechanism: "flywheel",
			env: { start: 6000, shots: { startS: 1, everyS: 0.2, count: 3, loss: 400, tolerance: 50 } },
			durationS: 2,
		};
		const m = computeMetrics(spec, simulate(spec, { name: "6,000", target: 6000 }, () => FLYWHEEL.kV * 6000));
		expect(m.shotErrors).toHaveLength(3);
		expect(m.shotErrors[0]).toBeCloseTo(0, 0);
		expect(m.shotErrors[1]).toBeGreaterThan(200);
		expect(m.shotErr).toBe(Math.max(...m.shotErrors));
	});
});
