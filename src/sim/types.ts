export type Lang = "cpp" | "python";

/** What the student's controller drives. The arm works in degrees, the flywheel in RPM. */
export type Mechanism = "arm" | "flywheel";

export interface Waypoint {
	/** Seconds into the run. */
	t: number;
	/** Degrees. */
	angle: number;
}

/**
 * Everything that can make a level harder. Values are in the mechanism's
 * units: degrees for the arm, RPM for the flywheel.
 */
export interface EnvConfig {
	/** Where it starts. Defaults to 0: the arm level, the flywheel stopped. */
	start?: number;
	/** Start already holding the target, at rest. */
	startAtTarget?: boolean;
	/** Arm: the target changes over time. Overrides the variant's target. */
	sequence?: Waypoint[];
	/** The sensor rounds to `tick` (skipped when 0), then adds uniform noise of ±`amplitude`. */
	noise?: { tick: number; amplitude: number };
	/** Arm: the motor must push harder than this many volts to break loose from rest. */
	stiction?: number;
	/** Over `threshold` volts for `holdS` seconds browns out the battery. The limit drops to `sagged` volts. */
	brownout?: { threshold: number; holdS: number; sagged: number };
	/** Arm: at `t` the hopper on the arm is refilled with projectiles and its weight is multiplied by `weight`. */
	reload?: { t: number; weight: number };
	/** Arm: a latch holds it at or below `maxAngle` until `untilS`. */
	latch?: { untilS: number; maxAngle: number };
	/** Arm: hits of `volts` (as motor-equivalent torque) for `widthS`, every `everyS` from `startS`, alternating direction. */
	hits?: { startS: number; everyS: number; widthS: number; volts: number };
	/**
	 * Flywheel: the feeder pushes `count` projectiles through, one every `everyS`
	 * from `startS`. Each costs the wheel `loss` RPM. A shot fired within
	 * `tolerance` RPM of the target hits the armour panel.
	 */
	shots?: {
		startS: number;
		everyS: number;
		count: number;
		loss: number;
		tolerance: number;
	};
}

/** One run of a level. The first variant is the one students see. */
export interface Variant {
	name: string;
	/** Degrees or RPM. Ignored when the level has a sequence. */
	target: number;
	/** Arm: multiplies its weight and inertia. Flywheel: multiplies its inertia. */
	weight?: number;
	/** Flywheel: multiplies the drag, as from worn wheels. */
	drag?: number;
	/** Seeds the sensor noise. */
	seed?: number;
}

export interface SimSpec {
	mechanism: Mechanism;
	env: EnvConfig;
	durationS: number;
}

export interface Sample {
	t: number;
	target: number;
	/** What the sensor reported to the controller. */
	measured: number;
	/** Where it really was: the arm's angle or the flywheel's speed. */
	actual: number;
	/** What the controller asked for. */
	requested: number;
	/** What the motor got after clipping. */
	volts: number;
}

export type SimEventKind =
	| "reload"
	| "release"
	| "hit"
	| "brownout"
	| "waypoint"
	| "shot";

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
	measured: number,
	target: number,
	dt: number,
) => unknown;
