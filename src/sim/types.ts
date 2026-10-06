export type Lang = "cpp" | "python";

export interface Waypoint {
	/** Seconds into the run. */
	t: number;
	/** Degrees. */
	angle: number;
}

/** Everything that can make a level harder. All angles are in degrees. */
export interface EnvConfig {
	/** Where the arm starts. Defaults to 0 (level). */
	startAngle?: number;
	/** Start the arm already holding its target, at rest. */
	startAtTarget?: boolean;
	/** The target changes over time. Overrides the variant's target. */
	sequence?: Waypoint[];
	/** The encoder rounds to `tick` degrees, then adds uniform noise of ±`amplitude`. */
	noise?: { tick: number; amplitude: number };
	/** The motor must push harder than this many volts to break loose from rest. */
	stiction?: number;
	/** Over `threshold` volts for `holdS` seconds browns out the battery. The limit drops to `sagged` volts. */
	brownout?: { threshold: number; holdS: number; sagged: number };
	/** At `t` the arm grabs a game piece and its weight is multiplied by `weight`. */
	gamePiece?: { t: number; weight: number };
	/** A latch holds the arm at or below `maxAngle` until `untilS`. */
	latch?: { untilS: number; maxAngle: number };
	/** Shoves of `volts` (as motor-equivalent torque) for `widthS`, every `everyS` from `startS`, alternating direction. */
	defense?: { startS: number; everyS: number; widthS: number; volts: number };
}

/** One run of a level. The first variant is the one students see. */
export interface Variant {
	name: string;
	/** Degrees. Ignored when the level has a sequence. */
	target: number;
	/** Multiplies the arm's weight and inertia. */
	weight?: number;
	/** Seeds the encoder noise. */
	seed?: number;
}

export interface SimSpec {
	env: EnvConfig;
	durationS: number;
}

export interface Sample {
	t: number;
	/** Degrees. */
	target: number;
	/** What the encoder reported to the controller. */
	measured: number;
	/** Where the arm really was. */
	angle: number;
	/** What the controller asked for. */
	requested: number;
	/** What the motor got after clipping. */
	volts: number;
}

export type SimEventKind =
	| "piece"
	| "release"
	| "bump"
	| "brownout"
	| "waypoint";

export interface SimEvent {
	t: number;
	kind: SimEventKind;
}

export type IssueKind =
	| "compile"
	| "missing-function"
	| "exception"
	| "returned-nan"
	| "returned-non-number"
	| "timeout"
	| "trap";

export interface RunIssue {
	kind: IssueKind;
	/** Plain-English message, shown in the verdict. */
	message: string;
	/** Raw output (traceback, compiler output), shown in the console. */
	detail?: string;
	/** 1-based line in the student's file. */
	line?: number;
	/** Seconds into the run when it happened. */
	t?: number;
}

export interface RunResult {
	variant: Variant;
	samples: Sample[];
	/** Values from plot(name, value), indexed like samples. */
	plots: Record<string, (number | null)[]>;
	logs: string[];
	events: SimEvent[];
	browned: boolean;
	issue?: RunIssue;
}

/** Thrown by a runtime when the student's controller can't produce a number. */
export class ControllerError extends Error {
	constructor(readonly issue: RunIssue) {
		super(issue.message);
	}
}

export type ControllerFn = (
	angle: number,
	target: number,
	dt: number,
) => unknown;
