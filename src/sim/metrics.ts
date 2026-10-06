import { MECHANISMS, ROBOT } from "./robot";
import type { RunResult, Sample, SimSpec } from "./types";

/**
 * What a run did, in volts, seconds and the mechanism's own units: degrees
 * for the arm, RPM for the flywheel.
 */
export interface Metrics {
	/** Closest it got to the final target. */
	minErr: number;
	/** How far it went past the final target, in the direction it was travelling. */
	overshoot: number;
	/** Mean error over the last 0.8 s. */
	settleErr: number;
	/** Worst error over the last 3 s. */
	worstLate: number;
	/** For sequences: the worst error at the moment each next position was called. */
	waypointErr: number;
	/** Flywheel: target minus speed as each projectile went through. Positive means slow. */
	shotErrors: number[];
	/** The worst of shotErrors, either way. 0 with no shots. */
	shotErr: number;
	/** First time it got near the final target. Infinity if never. */
	riseTime: number;
	/** Mean change in volts per tick over the second half of the run. */
	jitter: number;
	/** Biggest change in volts between two ticks. */
	maxStep: number;
	peakVolts: number;
	/** Longest stretch with the output clipped at the limit. */
	saturatedS: number;
	browned: boolean;
	/** Each swing bigger than the last. */
	growing: boolean;
	/** The output never changed. */
	constantOutput: boolean;
	finalValue: number;
	finalTarget: number;
	/** Seconds the run lasted before it stopped (early if the code failed). */
	ranS: number;
}

export function computeMetrics(spec: SimSpec, run: RunResult): Metrics {
	const s = run.samples;
	const { near, wobble } = MECHANISMS[spec.mechanism];
	const empty: Metrics = {
		minErr: Number.POSITIVE_INFINITY,
		overshoot: 0,
		settleErr: Number.POSITIVE_INFINITY,
		worstLate: Number.POSITIVE_INFINITY,
		waypointErr: Number.POSITIVE_INFINITY,
		shotErrors: [],
		shotErr: spec.env.shots ? Number.POSITIVE_INFINITY : 0,
		riseTime: Number.POSITIVE_INFINITY,
		jitter: 0,
		maxStep: 0,
		peakVolts: 0,
		saturatedS: 0,
		browned: run.browned,
		growing: false,
		constantOutput: true,
		finalValue: spec.env.start ?? 0,
		finalTarget: run.variant.target,
		ranS: 0,
	};
	if (s.length < 2) return empty;

	const last = s[s.length - 1];
	const finalTarget = last.target;
	const err = (x: Sample) => x.target - x.actual;

	// The final segment: every sample since the target last changed.
	let segStart = s.length - 1;
	while (segStart > 0 && s[segStart - 1].target === finalTarget) segStart--;
	const segment = s.slice(segStart);
	const startValue = segment[0].actual;
	const goingUp = finalTarget >= startValue;

	let minErr = Number.POSITIVE_INFINITY;
	let peakPast = 0;
	let riseTime = Number.POSITIVE_INFINITY;
	for (const x of segment) {
		const e = Math.abs(err(x));
		minErr = Math.min(minErr, e);
		if (e < near && riseTime === Number.POSITIVE_INFINITY)
			riseTime = x.t - segment[0].t;
		peakPast = Math.max(
			peakPast,
			goingUp ? x.actual - finalTarget : finalTarget - x.actual,
		);
	}

	const tail = s.slice(-Math.min(s.length, Math.round(0.8 / ROBOT.controlDt)));
	const settleErr =
		tail.reduce((sum, x) => sum + Math.abs(err(x)), 0) / tail.length;

	const tEnd = last.t;
	let worstLate = 0;
	for (const x of s)
		if (x.t > tEnd - 3) worstLate = Math.max(worstLate, Math.abs(err(x)));

	let waypointErr = 0;
	const sequence = spec.env.sequence;
	if (sequence?.length) {
		for (let w = 0; w < sequence.length; w++) {
			const deadline =
				w + 1 < sequence.length ? sequence[w + 1].t : spec.durationS;
			let before: Sample | undefined;
			for (const x of s) if (x.t < deadline - 1e-9) before = x;
			if (before) waypointErr = Math.max(waypointErr, Math.abs(err(before)));
		}
		if (last.t < spec.durationS - ROBOT.controlDt * 1.5)
			waypointErr = Number.POSITIVE_INFINITY;
	}

	// The sample from the start of the tick a shot fired in is the speed it met.
	const shotErrors: number[] = [];
	for (const event of run.events) {
		if (event.kind !== "shot") continue;
		const x = s[Math.floor(event.t / ROBOT.controlDt + 1e-6)];
		if (x) shotErrors.push(err(x));
	}
	let shotErr = shotErrors.reduce(
		(worst, e) => Math.max(worst, Math.abs(e)),
		0,
	);
	if (spec.env.shots && shotErrors.length < spec.env.shots.count)
		shotErr = Number.POSITIVE_INFINITY;

	let jitterSum = 0;
	let jitterN = 0;
	let maxStep = Math.abs(s[0].volts);
	let peakVolts = 0;
	let saturatedS = 0;
	let saturatedRun = 0;
	let constantOutput = true;
	for (let i = 0; i < s.length; i++) {
		const v = s[i].volts;
		peakVolts = Math.max(peakVolts, Math.abs(v));
		if (Math.abs(s[i].requested) >= Math.abs(v) + 1e-9 && Math.abs(v) > 0) {
			saturatedRun += ROBOT.controlDt;
			saturatedS = Math.max(saturatedS, saturatedRun);
		} else saturatedRun = 0;
		if (i > 0) {
			const step = Math.abs(v - s[i - 1].volts);
			maxStep = Math.max(maxStep, step);
			if (Math.abs(s[i].requested - s[0].requested) > 1e-9)
				constantOutput = false;
			if (s[i].t >= tEnd / 2) {
				jitterSum += step;
				jitterN++;
			}
		}
	}

	const { hits, shots } = spec.env;
	return {
		minErr,
		overshoot: Math.max(0, peakPast),
		settleErr,
		worstLate,
		waypointErr,
		shotErrors,
		shotErr,
		riseTime,
		jitter: jitterN ? jitterSum / jitterN : 0,
		maxStep,
		peakVolts,
		saturatedS,
		browned: run.browned,
		// Hits, shots and new targets make swings that aren't instability.
		growing: hits || shots || sequence ? false : isGrowing(s, wobble),
		constantOutput,
		finalValue: last.actual,
		finalTarget,
		ranS: last.t + ROBOT.controlDt,
	};
}

/** Compares how far it swings in the last two seconds with the two before. */
function isGrowing(s: Sample[], wobble: number): boolean {
	const tEnd = s[s.length - 1].t;
	if (tEnd < 4) return false;
	const swing = (from: number, to: number) => {
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (const x of s) {
			if (x.t < from || x.t >= to) continue;
			const e = x.target - x.actual;
			lo = Math.min(lo, e);
			hi = Math.max(hi, e);
		}
		return hi - lo;
	};
	const earlier = swing(tEnd - 4, tEnd - 2);
	const later = swing(tEnd - 2, tEnd + 1);
	return later > wobble && later > earlier * 1.15;
}
