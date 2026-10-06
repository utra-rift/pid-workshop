import { ARM } from "./arm";
import type { RunResult, Sample, SimSpec } from "./types";

/** What a run did, in degrees, volts and seconds. */
export interface Metrics {
	/** Closest the arm got to the final target. */
	minErr: number;
	/** How far it went past the final target, in the direction it was travelling. */
	overshoot: number;
	/** Mean error over the last 0.8 s. */
	settleErr: number;
	/** Worst error over the last 3 s. */
	worstLate: number;
	/** For sequences: the worst error at the moment each next position was called. */
	waypointErr: number;
	/** First time the arm got within 5° of the final target. Infinity if never. */
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
	finalAngle: number;
	finalTarget: number;
	/** Seconds the run lasted before it stopped (early if the code failed). */
	ranS: number;
}

export function computeMetrics(spec: SimSpec, run: RunResult): Metrics {
	const s = run.samples;
	const empty: Metrics = {
		minErr: Number.POSITIVE_INFINITY,
		overshoot: 0,
		settleErr: Number.POSITIVE_INFINITY,
		worstLate: Number.POSITIVE_INFINITY,
		waypointErr: Number.POSITIVE_INFINITY,
		riseTime: Number.POSITIVE_INFINITY,
		jitter: 0,
		maxStep: 0,
		peakVolts: 0,
		saturatedS: 0,
		browned: run.browned,
		growing: false,
		constantOutput: true,
		finalAngle: spec.env.startAngle ?? 0,
		finalTarget: run.variant.target,
		ranS: 0,
	};
	if (s.length < 2) return empty;

	const last = s[s.length - 1];
	const finalTarget = last.target;
	const err = (x: Sample) => x.target - x.angle;

	// The final segment: every sample since the target last changed.
	let segStart = s.length - 1;
	while (segStart > 0 && s[segStart - 1].target === finalTarget) segStart--;
	const segment = s.slice(segStart);
	const startAngle = segment[0].angle;
	const goingUp = finalTarget >= startAngle;

	let minErr = Number.POSITIVE_INFINITY;
	let peakPast = 0;
	let riseTime = Number.POSITIVE_INFINITY;
	for (const x of segment) {
		const e = Math.abs(err(x));
		minErr = Math.min(minErr, e);
		if (e < 5 && riseTime === Number.POSITIVE_INFINITY)
			riseTime = x.t - segment[0].t;
		peakPast = Math.max(
			peakPast,
			goingUp ? x.angle - finalTarget : finalTarget - x.angle,
		);
	}

	const tail = s.slice(-Math.min(s.length, Math.round(0.8 / ARM.controlDt)));
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
		if (last.t < spec.durationS - ARM.controlDt * 1.5)
			waypointErr = Number.POSITIVE_INFINITY;
	}

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
			saturatedRun += ARM.controlDt;
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

	return {
		minErr,
		overshoot: Math.max(0, peakPast),
		settleErr,
		worstLate,
		waypointErr,
		riseTime,
		jitter: jitterN ? jitterSum / jitterN : 0,
		maxStep,
		peakVolts,
		saturatedS,
		browned: run.browned,
		// Shoves and new targets make swings that aren't instability.
		growing: spec.env.defense || spec.env.sequence ? false : isGrowing(s),
		constantOutput,
		finalAngle: last.angle,
		finalTarget,
		ranS: last.t + ARM.controlDt,
	};
}

/** Compares how far the arm swings in the last two seconds with the two before. */
function isGrowing(s: Sample[]): boolean {
	const tEnd = s[s.length - 1].t;
	if (tEnd < 4) return false;
	const swing = (from: number, to: number) => {
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (const x of s) {
			if (x.t < from || x.t >= to) continue;
			const e = x.target - x.angle;
			lo = Math.min(lo, e);
			hi = Math.max(hi, e);
		}
		return hi - lo;
	};
	const earlier = swing(tEnd - 4, tEnd - 2);
	const later = swing(tEnd - 2, tEnd + 1);
	return later > 6 && later > earlier * 1.15;
}
