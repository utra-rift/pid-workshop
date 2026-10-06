import type { Metrics } from "#/sim/metrics";
import { formatRpm } from "#/sim/robot";
import type { Variant } from "#/sim/types";
import { code, type Level } from "./types";

export type { Level, Localized, WrongAnswer } from "./types";
export { localize } from "./types";

/** The function every level calls. */
export const ENTRY = "controller";

const ARM_VARIANTS: Variant[] = [
	{ name: "60°", target: 60, seed: 1 },
	{ name: "30°", target: 30, seed: 2 },
	{ name: "75° with a heavier arm", target: 75, weight: 1.3, seed: 3 },
];

const SEQUENCE_VARIANTS: Variant[] = [
	{ name: "Normal arm", target: 60, seed: 1 },
	{ name: "Heavier arm", target: 60, weight: 1.3, seed: 2 },
];

const FLYWHEEL_VARIANTS: Variant[] = [
	{ name: "6,000 RPM", target: 6000, seed: 1 },
	{ name: "4,000 RPM", target: 4000, seed: 2 },
	{ name: "7,500 RPM", target: 7500, seed: 3 },
];

const deg = (x: number) => `${x.toFixed(1)}°`;
const rpm = (x: number) => `${formatRpm(x)} RPM`;

/** The shot furthest from the target speed: 1-based, and how far off. Positive is slow. */
function worstShot(m: Metrics): { n: number; err: number } | null {
	let worst: { n: number; err: number } | null = null;
	for (const [i, err] of m.shotErrors.entries()) {
		if (!worst || Math.abs(err) > Math.abs(worst.err))
			worst = { n: i + 1, err };
	}
	return worst;
}

// ---------------------------------------------------------------------------
// Code for each level. Solution N is the starting point for level N+1.
// ---------------------------------------------------------------------------

const S = {
	onOff: {
		python: code`
			def controller(angle, target, dt):
			    if angle < target:
			        return 6
			    return 0
		`,
		cpp: code`
			#include "robot.h"

			double controller(double angle, double target, double dt) {
			  if (angle < target) {
			    return 6;
			  }
			  return 0;
			}
		`,
	},
	push: {
		python: code`
			# kP: volts of push for each degree the arm is off.
			kP = 0.6


			def controller(angle, target, dt):
			    error = target - angle  # how far off the arm is, in degrees
			    return kP * error
		`,
		cpp: code`
			#include "robot.h"

			// kP: volts of push for each degree the arm is off.
			const double kP = 0.6;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;  // how far off the arm is, in degrees
			  return kP * error;
			}
		`,
	},
	brakes: {
		python: code`
			kP = 0.6
			kD = 0.08

			# Variables out here keep their value between calls.
			last_error = 0.0


			def controller(angle, target, dt):
			    global last_error  # lets this function change last_error
			    error = target - angle
			    derivative = (error - last_error) / dt  # degrees per second
			    last_error = error
			    return kP * error + kD * derivative
		`,
		cpp: code`
			#include "robot.h"

			const double kP = 0.6;
			const double kD = 0.08;

			// Variables out here keep their value between calls.
			double lastError = 0;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;
			  double derivative = (error - lastError) / dt;  // degrees per second
			  lastError = error;
			  return kP * error + kD * derivative;
			}
		`,
	},
	sag: {
		python: code`
			import math

			kP = 0.6
			kD = 0.08
			kG = 4.0  # volts that hold the arm level

			last_error = 0.0


			def controller(angle, target, dt):
			    global last_error
			    error = target - angle
			    derivative = (error - last_error) / dt
			    last_error = error
			    gravity = kG * math.cos(math.radians(angle))
			    return kP * error + kD * derivative + gravity
		`,
		cpp: code`
			#include "robot.h"
			#include <cmath>

			const double kP = 0.6;
			const double kD = 0.08;
			const double kG = 4.0;  // volts that hold the arm level

			double lastError = 0;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;
			  double derivative = (error - lastError) / dt;
			  lastError = error;
			  double gravity = kG * std::cos(toRadians(angle));
			  return kP * error + kD * derivative + gravity;
			}
		`,
	},
	reload: {
		python: code`
			import math

			kP = 0.6
			kI = 1.0
			kD = 0.08
			kG = 4.0

			last_error = 0.0
			integral = 0.0


			def controller(angle, target, dt):
			    global last_error, integral
			    error = target - angle
			    integral += error * dt  # error added up over time
			    derivative = (error - last_error) / dt
			    last_error = error
			    gravity = kG * math.cos(math.radians(angle))
			    return kP * error + kI * integral + kD * derivative + gravity
		`,
		cpp: code`
			#include "robot.h"
			#include <cmath>

			const double kP = 0.6;
			const double kI = 1.0;
			const double kD = 0.08;
			const double kG = 4.0;

			double lastError = 0;
			double integral = 0;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;
			  integral += error * dt;  // error added up over time
			  double derivative = (error - lastError) / dt;
			  lastError = error;
			  double gravity = kG * std::cos(toRadians(angle));
			  return kP * error + kI * integral + kD * derivative + gravity;
			}
		`,
	},
	windup: {
		python: code`
			import math
			from robot import plot, clamp

			kP = 0.6
			kI = 1.0
			kD = 0.08
			kG = 4.0

			last_error = 0.0
			integral = 0.0


			def controller(angle, target, dt):
			    global last_error, integral
			    error = target - angle
			    integral = clamp(integral + error * dt, -2, 2)  # never more than 2
			    plot("integral", integral)
			    derivative = (error - last_error) / dt
			    last_error = error
			    gravity = kG * math.cos(math.radians(angle))
			    return kP * error + kI * integral + kD * derivative + gravity
		`,
		cpp: code`
			#include "robot.h"
			#include <cmath>

			const double kP = 0.6;
			const double kI = 1.0;
			const double kD = 0.08;
			const double kG = 4.0;

			double lastError = 0;
			double integral = 0;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;
			  integral = clamp(integral + error * dt, -2, 2);  // never more than 2
			  plot("integral", integral);
			  double derivative = (error - lastError) / dt;
			  lastError = error;
			  double gravity = kG * std::cos(toRadians(angle));
			  return kP * error + kI * integral + kD * derivative + gravity;
			}
		`,
	},
	noise: {
		python: code`
			import math
			from robot import plot, clamp

			kP = 0.6
			kI = 1.0
			kD = 0.08
			kG = 4.0

			last_error = 0.0
			integral = 0.0
			filtered = 0.0


			def controller(angle, target, dt):
			    global last_error, integral, filtered
			    error = target - angle
			    integral = clamp(integral + error * dt, -2, 2)
			    derivative = (error - last_error) / dt
			    last_error = error
			    # Each tick, move only 10% of the way toward the new reading.
			    filtered = 0.9 * filtered + 0.1 * derivative
			    plot("filtered", filtered)
			    gravity = kG * math.cos(math.radians(angle))
			    return kP * error + kI * integral + kD * filtered + gravity
		`,
		cpp: code`
			#include "robot.h"
			#include <cmath>

			const double kP = 0.6;
			const double kI = 1.0;
			const double kD = 0.08;
			const double kG = 4.0;

			double lastError = 0;
			double integral = 0;
			double filtered = 0;

			double controller(double angle, double target, double dt) {
			  double error = target - angle;
			  integral = clamp(integral + error * dt, -2, 2);
			  double derivative = (error - lastError) / dt;
			  lastError = error;
			  // Each tick, move only 10% of the way toward the new reading.
			  filtered = 0.9 * filtered + 0.1 * derivative;
			  plot("filtered", filtered);
			  double gravity = kG * std::cos(toRadians(angle));
			  return kP * error + kI * integral + kD * filtered + gravity;
			}
		`,
	},
	profile: {
		python: code`
			import math
			from robot import plot, clamp

			kP = 0.6
			kI = 1.0
			kD = 0.08
			kG = 4.0
			max_speed = 90.0  # degrees per second

			last_error = 0.0
			integral = 0.0
			filtered = 0.0
			setpoint = 0.0
			started = False


			def controller(angle, target, dt):
			    global last_error, integral, filtered, setpoint, started
			    if not started:
			        setpoint = angle  # start from wherever the arm is
			        started = True
			    # Walk the setpoint toward the target instead of jumping there.
			    step = max_speed * dt
			    setpoint += clamp(target - setpoint, -step, step)
			    plot("setpoint", setpoint)

			    error = setpoint - angle
			    integral = clamp(integral + error * dt, -2, 2)
			    derivative = (error - last_error) / dt
			    last_error = error
			    filtered = 0.9 * filtered + 0.1 * derivative
			    gravity = kG * math.cos(math.radians(angle))
			    return kP * error + kI * integral + kD * filtered + gravity
		`,
		cpp: code`
			#include "robot.h"
			#include <cmath>

			const double kP = 0.6;
			const double kI = 1.0;
			const double kD = 0.08;
			const double kG = 4.0;
			const double maxSpeed = 90.0;  // degrees per second

			double lastError = 0;
			double integral = 0;
			double filtered = 0;
			double setpoint = 0;
			bool started = false;

			double controller(double angle, double target, double dt) {
			  if (!started) {
			    setpoint = angle;  // start from wherever the arm is
			    started = true;
			  }
			  // Walk the setpoint toward the target instead of jumping there.
			  double step = maxSpeed * dt;
			  setpoint += clamp(target - setpoint, -step, step);
			  plot("setpoint", setpoint);

			  double error = setpoint - angle;
			  integral = clamp(integral + error * dt, -2, 2);
			  double derivative = (error - lastError) / dt;
			  lastError = error;
			  filtered = 0.9 * filtered + 0.1 * derivative;
			  double gravity = kG * std::cos(toRadians(angle));
			  return kP * error + kI * integral + kD * filtered + gravity;
			}
		`,
	},
};

/** The profile solution with different gains, used by the later levels. */
function withGains(
	src: string,
	gains: Record<string, string>,
	lang: "python" | "cpp",
): string {
	let out = src;
	for (const [name, value] of Object.entries(gains)) {
		out =
			lang === "python"
				? out.replace(
						new RegExp(`^${name} = [^\\n]*$`, "m"),
						`${name} = ${value}`,
					)
				: out.replace(
						new RegExp(`^const double ${name} = [^;]*;`, "m"),
						`const double ${name} = ${value};`,
					);
	}
	return out;
}

const STIFF = {
	python: withGains(S.profile.python, { kP: "1.5", kD: "0.12" }, "python"),
	cpp: withGains(S.profile.cpp, { kP: "1.5", kD: "0.12" }, "cpp"),
};

const STICKY = {
	python: STIFF.python
		.replace(
			"max_speed = 90.0  # degrees per second",
			"kS = 4.0  # volts that break the gearbox loose\nmax_speed = 90.0  # degrees per second",
		)
		.replace(
			"    return kP * error + kI * integral + kD * filtered + gravity\n",
			"    output = kP * error + kI * integral + kD * filtered + gravity\n    if abs(error) > 0.2:\n        output += math.copysign(kS, error)  # nudge toward the target\n    return output\n",
		),
	cpp: STIFF.cpp
		.replace(
			"const double maxSpeed = 90.0;  // degrees per second",
			"const double kS = 4.0;  // volts that break the gearbox loose\nconst double maxSpeed = 90.0;  // degrees per second",
		)
		.replace(
			"  return kP * error + kI * integral + kD * filtered + gravity;\n",
			"  double output = kP * error + kI * integral + kD * filtered + gravity;\n  if (std::abs(error) > 0.2) {\n    output += std::copysign(kS, error);  // nudge toward the target\n  }\n  return output;\n",
		),
};

// ---------------------------------------------------------------------------
// The flywheel. Same idea: solution N is the starting point for level N+1.
// ---------------------------------------------------------------------------

const F = {
	spinUp: {
		python: code`
			# kP: volts for each RPM the wheel is off.
			kP = 0.002
			# kV: volts for each RPM of speed.
			kV = 0.0025


			def controller(speed, target, dt):
			    error = target - speed  # how far off the wheel is, in RPM
			    feedforward = kV * target  # volts that hold this speed
			    return feedforward + kP * error
		`,
		cpp: code`
			#include "robot.h"

			// kP: volts for each RPM the wheel is off.
			const double kP = 0.002;
			// kV: volts for each RPM of speed.
			const double kV = 0.0025;

			double controller(double speed, double target, double dt) {
			  double error = target - speed;  // how far off the wheel is, in RPM
			  double feedforward = kV * target;  // volts that hold this speed
			  return feedforward + kP * error;
			}
		`,
	},
	rapidFire: {
		python: code`
			# kP: volts for each RPM the wheel is off.
			kP = 0.02
			# kV: volts for each RPM of speed.
			kV = 0.0025


			def controller(speed, target, dt):
			    error = target - speed  # how far off the wheel is, in RPM
			    feedforward = kV * target  # volts that hold this speed
			    return feedforward + kP * error
		`,
		cpp: code`
			#include "robot.h"

			// kP: volts for each RPM the wheel is off.
			const double kP = 0.02;
			// kV: volts for each RPM of speed.
			const double kV = 0.0025;

			double controller(double speed, double target, double dt) {
			  double error = target - speed;  // how far off the wheel is, in RPM
			  double feedforward = kV * target;  // volts that hold this speed
			  return feedforward + kP * error;
			}
		`,
	},
	worn: {
		python: code`
			from robot import clamp

			kP = 0.02
			kI = 0.1
			kV = 0.0025

			integral = 0.0


			def controller(speed, target, dt):
			    global integral
			    error = target - speed
			    integral = clamp(integral + error * dt, -20, 20)  # at most 2 V
			    feedforward = kV * target
			    return feedforward + kP * error + kI * integral
		`,
		cpp: code`
			#include "robot.h"

			const double kP = 0.02;
			const double kI = 0.1;
			const double kV = 0.0025;

			double integral = 0;

			double controller(double speed, double target, double dt) {
			  double error = target - speed;
			  integral = clamp(integral + error * dt, -20, 20);  // at most 2 V
			  double feedforward = kV * target;
			  return feedforward + kP * error + kI * integral;
			}
		`,
	},
};

// ---------------------------------------------------------------------------
// The levels.
// ---------------------------------------------------------------------------

export const LEVELS: Level[] = [
	{
		id: "01-on-off",
		number: 1,
		title: "On/off",
		story:
			"The arm hangs level. Your code decides how hard the motor pushes, 200 times a second.",
		goal: "Get the arm within **10°** of the target and keep it there.",
		hints: [
			{
				python:
					"An `if` statement picks between two answers. `if angle < target:` followed by an indented `return 6` only runs when the arm is below the target. Put `return 0` after it, not indented, for every other case.",
				cpp: "An `if` statement picks between two answers. `if (angle < target) { return 6; }` only runs when the arm is below the target. Put `return 0;` after it for every other case.",
			},
			{
				python: "```\nif angle < target:\n    return 6\nreturn 0\n```",
				cpp: "```\nif (angle < target) {\n  return 6;\n}\nreturn 0;\n```",
			},
		],
		why: "That's a controller: read the sensor, compare it with the target, set the motor, again and again. Look at the motor line on the graph, though. It flips between 6 V and nothing the whole time.",
		spec: { mechanism: "arm", env: {}, durationS: 6 },
		variants: ARM_VARIANTS,
		starter: {
			python: code`
				# The robot calls this 200 times a second.
				# angle and target are in degrees. dt is the time since the last call, in seconds.
				# Return how many volts to give the motor, from -24 to 24.
				def controller(angle, target, dt):
				    # TODO: if the arm is below the target, push with 6 volts.
				    #       Otherwise, return 0.
				    return 0
			`,
			cpp: code`
				#include "robot.h"

				// The robot calls this 200 times a second.
				// angle and target are in degrees. dt is the time since the last call, in seconds.
				// Return how many volts to give the motor, from -24 to 24.
				double controller(double angle, double target, double dt) {
				  // TODO: if the arm is below the target, push with 6 volts.
				  //       Otherwise, return 0.
				  return 0;
				}
			`,
		},
		solution: S.onOff,
		wrongAnswers: [
			{
				name: "returns 0",
				code: {
					python: "def controller(angle, target, dt):\n    return 0\n",
					cpp: '#include "robot.h"\n\ndouble controller(double angle, double target, double dt) {\n  return 0;\n}\n',
				},
				expect: /same every call/,
			},
			{
				name: "full power",
				code: {
					python: S.onOff.python.replace("return 6", "return 24"),
					cpp: S.onOff.cpp.replace("return 6;", "return 24;"),
				},
				expect: /fell over the top/,
			},
		],
		pass: (m) => m.settleErr < 10,
		coach: (m) => {
			if (m.finalValue > 110) {
				return "It shot past the target and fell over the top. That's far more push than this arm needs. Try 6 V.";
			}
			return null;
		},
	},
	{
		id: "02-push",
		number: 2,
		title: "Push",
		story:
			"On/off gets there, but the motor flips between 6 V and nothing 200 times a second. That buzz wears out gearboxes. Push hard when the arm is far away and gently when it's close.",
		goal: "Settle within **10°** of the target with a smooth motor: jitter under **0.1 V**.",
		hints: [
			"Return `kP * error`. When the arm is far away the error is big, so the push is big. As it closes in, the push fades.",
			"Try `kP = 0.5`. If it stops too far below the line, raise kP.",
		],
		why: "That's proportional control, the P in PID. It never quite reaches the line, though, and with a big kP it swings past. The next two levels fix both.",
		spec: { mechanism: "arm", env: {}, durationS: 6 },
		variants: ARM_VARIANTS,
		starter: {
			python: code`
				# kP: volts of push for each degree the arm is off.
				kP = 0.0  # TODO: pick a value


				def controller(angle, target, dt):
				    error = target - angle  # how far off the arm is, in degrees
				    # TODO: return a push that grows with the error.
				    return 0
			`,
			cpp: code`
				#include "robot.h"

				// kP: volts of push for each degree the arm is off.
				const double kP = 0.0;  // TODO: pick a value

				double controller(double angle, double target, double dt) {
				  double error = target - angle;  // how far off the arm is, in degrees
				  // TODO: return a push that grows with the error.
				  return 0;
				}
			`,
		},
		solution: S.push,
		wrongAnswers: [
			{ name: "still on/off", code: S.onOff, expect: /buzzing/ },
			{
				name: "kP too small",
				code: {
					python: S.push.python.replace("kP = 0.6", "kP = 0.1"),
					cpp: S.push.cpp.replace("kP = 0.6", "kP = 0.1"),
				},
				expect: /Raise kP/,
			},
		],
		pass: (m) => m.settleErr < 10 && m.jitter < 0.1,
		coach: (m) => {
			if (m.jitter >= 0.1) {
				return `The motor is still buzzing: it changes by ${m.jitter.toFixed(2)} V every tick on average. Use a push that shrinks smoothly as the error shrinks.`;
			}
			if (m.settleErr >= 10 && m.finalValue < m.finalTarget) {
				return `It stops ${deg(m.settleErr)} short of the target. Raise kP so it pushes harder.`;
			}
			return null;
		},
	},
	{
		id: "03-brakes",
		number: 3,
		title: "Stop the bounce",
		story:
			"A bigger kP gets there faster, but the arm swings past the line. Brake as it closes in.",
		goal: "Overshoot by less than **3°**, and settle within **8°**.",
		hints: [
			{
				python:
					"The error shrinks as the arm closes in. `(error - last_error) / dt` says how fast, in degrees per second. It's negative on the way in, so `kD * derivative` pushes back. Keep `last_error` outside the function, and write `global last_error` inside it so Python lets you change it.",
				cpp: "The error shrinks as the arm closes in. `(error - lastError) / dt` says how fast, in degrees per second. It's negative on the way in, so `kD * derivative` pushes back. Declare `lastError` outside the function so it keeps its value between calls.",
			},
			"Try `kD = 0.08`. More kD brakes harder.",
		],
		why: "That's the D in PID. It reacts to how fast the error is changing and pushes back before the arm arrives.",
		spec: { mechanism: "arm", env: {}, durationS: 6 },
		variants: ARM_VARIANTS,
		starter: {
			python: code`
				kP = 0.6
				kD = 0.0  # TODO: pick a value

				# Variables out here keep their value between calls.
				last_error = 0.0


				def controller(angle, target, dt):
				    global last_error  # lets this function change last_error
				    error = target - angle
				    # TODO: how fast is the error changing, in degrees per second?
				    derivative = 0
				    last_error = error
				    return kP * error + kD * derivative
			`,
			cpp: code`
				#include "robot.h"

				const double kP = 0.6;
				const double kD = 0.0;  // TODO: pick a value

				// Variables out here keep their value between calls.
				double lastError = 0;

				double controller(double angle, double target, double dt) {
				  double error = target - angle;
				  // TODO: how fast is the error changing, in degrees per second?
				  double derivative = 0;
				  lastError = error;
				  return kP * error + kD * derivative;
				}
			`,
		},
		solution: S.brakes,
		wrongAnswers: [
			{ name: "no brakes", code: S.push, expect: /past the target/ },
			{
				name: "forgot global",
				code: {
					python: S.brakes.python.replace(
						"    global last_error  # lets this function change last_error\n",
						"",
					),
				},
				expect: /global last_error/,
			},
		],
		pass: (m) => m.overshoot < 3 && m.settleErr < 8,
		coach: (m) => {
			if (m.overshoot >= 3) {
				return `It swings ${deg(m.overshoot)} past the target. Brake on the way in: push against how fast the error is shrinking.`;
			}
			return null;
		},
	},
	{
		id: "04-sag",
		number: 4,
		title: "Kill the sag",
		story:
			"It stops a few degrees short and stays there. kP's push shrinks with the error until it only just holds the arm's weight. Hold the weight on purpose instead.",
		goal: "Settle within **1°** of the target.",
		hints: [
			{
				python:
					"Gravity's pull follows `cos(angle)`: 1 when the arm is level, 0 when it points straight up. `kG * cos(angle)` holds the weight at any angle. `math.cos` takes radians, so convert first: `math.cos(math.radians(angle))`.",
				cpp: "Gravity's pull follows `cos(angle)`: 1 when the arm is level, 0 when it points straight up. `kG * cos(angle)` holds the weight at any angle. `std::cos` takes radians, so convert first: `std::cos(toRadians(angle))`.",
			},
			"Try `kG = 4`. If it settles above the line, kG is too big.",
		],
		why: "That's feedforward. You predicted the push the arm needs instead of waiting for an error to build up.",
		spec: { mechanism: "arm", env: {}, durationS: 6 },
		variants: ARM_VARIANTS,
		starter: {
			python: code`
				import math

				kP = 0.6
				kD = 0.08
				kG = 0.0  # TODO: volts that hold the arm level

				last_error = 0.0


				def controller(angle, target, dt):
				    global last_error
				    error = target - angle
				    derivative = (error - last_error) / dt
				    last_error = error
				    # TODO: hold up the arm's weight. Gravity pulls hardest when the arm
				    #       is level (0°) and not at all when it points straight up (90°).
				    gravity = 0
				    return kP * error + kD * derivative + gravity
			`,
			cpp: code`
				#include "robot.h"
				#include <cmath>

				const double kP = 0.6;
				const double kD = 0.08;
				const double kG = 0.0;  // TODO: volts that hold the arm level

				double lastError = 0;

				double controller(double angle, double target, double dt) {
				  double error = target - angle;
				  double derivative = (error - lastError) / dt;
				  lastError = error;
				  // TODO: hold up the arm's weight. Gravity pulls hardest when the arm
				  //       is level (0°) and not at all when it points straight up (90°).
				  double gravity = 0;
				  return kP * error + kD * derivative + gravity;
				}
			`,
		},
		solution: S.sag,
		wrongAnswers: [
			{ name: "no feedforward", code: S.brakes, expect: /below the target/ },
			{
				name: "cos of degrees",
				code: {
					python: S.sag.python.replace(
						"math.cos(math.radians(angle))",
						"math.cos(angle)",
					),
					cpp: S.sag.cpp.replace(
						"std::cos(toRadians(angle))",
						"std::cos(angle)",
					),
				},
				expect: /radians/,
			},
		],
		pass: (m) => m.settleErr < 1 && m.overshoot < 5,
		coach: (m) => {
			if (m.settleErr < 1) return null;
			return m.finalValue < m.finalTarget
				? `It settles ${deg(m.settleErr)} below the target. Add \`kG * cos(angle)\` so the motor holds the weight, and make sure cos gets radians.`
				: `It settles ${deg(m.settleErr)} above the target. kG is too big, or cos isn't getting radians.`;
		},
	},
	{
		id: "05-reload",
		number: 5,
		title: "Reload",
		story:
			"The arm is holding at the target. At 2 seconds its hopper is refilled with projectiles, and it gets twice as heavy. Your kG doesn't know about the extra weight.",
		goal: "Get back within **0.5°** of the target.",
		hints: [
			"`integral += error * dt` adds up the error over time. An error that won't go away keeps growing the integral, and `kI * integral` keeps pushing harder until the arm gets there.",
			"Try `kI = 1`. Too much kI makes it wobble.",
		],
		why: "That's the I in PID. Feedforward handles what you can predict, and the integral cleans up what you can't.",
		spec: {
			mechanism: "arm",
			env: { startAtTarget: true, reload: { t: 2, weight: 2 } },
			durationS: 6,
		},
		variants: ARM_VARIANTS,
		starter: {
			python: code`
				import math

				kP = 0.6
				kI = 0.0  # TODO: pick a value
				kD = 0.08
				kG = 4.0

				last_error = 0.0
				integral = 0.0


				def controller(angle, target, dt):
				    global last_error, integral
				    error = target - angle
				    # TODO: add up the error over time in integral.
				    derivative = (error - last_error) / dt
				    last_error = error
				    gravity = kG * math.cos(math.radians(angle))
				    return kP * error + kI * integral + kD * derivative + gravity
			`,
			cpp: code`
				#include "robot.h"
				#include <cmath>

				const double kP = 0.6;
				const double kI = 0.0;  // TODO: pick a value
				const double kD = 0.08;
				const double kG = 4.0;

				double lastError = 0;
				double integral = 0;

				double controller(double angle, double target, double dt) {
				  double error = target - angle;
				  // TODO: add up the error over time in integral.
				  double derivative = (error - lastError) / dt;
				  lastError = error;
				  double gravity = kG * std::cos(toRadians(angle));
				  return kP * error + kI * integral + kD * derivative + gravity;
				}
			`,
		},
		solution: S.reload,
		wrongAnswers: [{ name: "no integral", code: S.sag, expect: /hopper/ }],
		pass: (m) => m.settleErr < 0.5,
		coach: (m) => {
			if (m.settleErr >= 0.5 && m.finalValue < m.finalTarget) {
				return `The full hopper drags it ${deg(m.settleErr)} below the target. kG can't know about the extra weight, but an integral can: it keeps growing until the arm gets there.`;
			}
			return null;
		},
	},
	{
		id: "06-windup",
		number: 6,
		title: "Windup",
		story:
			"A latch holds the arm down for the first 3 seconds. Your integral keeps adding up the whole time, and when the latch lets go the arm flies past.",
		goal: "After the latch lets go, overshoot by less than **6°** and settle within **1°**.",
		hints: [
			{
				python:
					'See it first: add `from robot import plot` at the top and `plot("integral", integral)` in your function. Watch it climb while the latch holds the arm.',
				cpp: 'See it first: `plot("integral", integral);` adds it to the graph. Watch it climb while the latch holds the arm.',
			},
			{
				python:
					"Limit it: `integral = clamp(integral + error * dt, -2, 2)`, with `from robot import clamp`. With kI = 1 that caps the I term at 2 V.",
				cpp: "Limit it: `integral = clamp(integral + error * dt, -2, 2);`. With kI = 1 that caps the I term at 2 V.",
			},
		],
		why: "That's integral windup. Every PID controller on a real robot limits its integral.",
		spec: {
			mechanism: "arm",
			env: { latch: { untilS: 3, maxAngle: 20 } },
			durationS: 7,
		},
		variants: ARM_VARIANTS,
		starter: {
			python: S.reload.python
				.replace(
					"import math\n",
					"import math\nfrom robot import plot, clamp\n",
				)
				.replace(
					"    integral += error * dt  # error added up over time\n",
					'    integral += error * dt\n    # TODO: stop the integral from growing forever.\n    #       See it first: plot("integral", integral)\n',
				),
			cpp: S.reload.cpp.replace(
				"  integral += error * dt;  // error added up over time\n",
				'  integral += error * dt;\n  // TODO: stop the integral from growing forever.\n  //       See it first: plot("integral", integral);\n',
			),
		},
		solution: S.windup,
		wrongAnswers: [
			{
				name: "unclamped integral",
				code: S.reload,
				expect: /when the latch let go/,
			},
		],
		pass: (m) => m.overshoot < 6 && m.settleErr < 1,
		coach: (m, run) => {
			if (m.overshoot < 6) return null;
			const integral = run.plots.integral?.filter(
				(v): v is number => v !== null,
			);
			const peak = integral?.length
				? Math.max(...integral.map(Math.abs))
				: null;
			return `It flew ${deg(m.overshoot)} past the target when the latch let go. Something kept growing the whole time the arm was stuck.${peak !== null ? ` Your integral reached ${peak.toFixed(1)}.` : ""}`;
		},
	},
	{
		id: "07-spin-up",
		number: 7,
		title: "Spin up",
		story:
			"New mechanism: the launcher's flywheel. Its speed sets how hard projectiles fly, so it has to hold a target speed, in RPM. At full power, 24 V, it tops out at 9,600 RPM.",
		goal: "Settle within **20 RPM** of the target speed.",
		hints: [
			"Run it first. kP only pushes when the wheel is slow, but a spinning wheel needs volts all the time just to beat its own drag. So it settles wherever kP's push just about holds it, far short of the target.",
			"The volts it needs grow with the speed. 24 V holds 9,600 RPM, so each RPM takes 24 / 9600 = 0.0025 V. Set `kV = 0.0025` and `feedforward = kV * target`.",
		],
		why: "That's velocity feedforward. On a flywheel, kV does almost all the work, and kP only trims what's left.",
		spec: {
			mechanism: "flywheel",
			env: { noise: { tick: 0, amplitude: 15 } },
			durationS: 4,
		},
		variants: FLYWHEEL_VARIANTS,
		starter: {
			python: code`
				# The flywheel calls this 200 times a second too.
				# speed and target are in RPM (revolutions per minute). Return volts, -24 to 24.

				# kP: volts for each RPM the wheel is off.
				kP = 0.002
				# kV: volts for each RPM of speed.
				kV = 0.0  # TODO: pick a value


				def controller(speed, target, dt):
				    error = target - speed  # how far off the wheel is, in RPM
				    # TODO: the volts that hold the target speed on their own.
				    feedforward = 0
				    return feedforward + kP * error
			`,
			cpp: code`
				#include "robot.h"

				// The flywheel calls this 200 times a second too.
				// speed and target are in RPM (revolutions per minute). Return volts, -24 to 24.

				// kP: volts for each RPM the wheel is off.
				const double kP = 0.002;
				// kV: volts for each RPM of speed.
				const double kV = 0.0;  // TODO: pick a value

				double controller(double speed, double target, double dt) {
				  double error = target - speed;  // how far off the wheel is, in RPM
				  // TODO: the volts that hold the target speed on their own.
				  double feedforward = 0;
				  return feedforward + kP * error;
				}
			`,
		},
		solution: F.spinUp,
		wrongAnswers: [
			{
				name: "P only, turned up",
				code: {
					python: F.spinUp.python
						.replace("kP = 0.002", "kP = 0.3")
						.replace("kV = 0.0025", "kV = 0.0"),
					cpp: F.spinUp.cpp
						.replace("kP = 0.002", "kP = 0.3")
						.replace("kV = 0.0025", "kV = 0.0"),
				},
				expect: /only pushes when/,
			},
			{
				name: "same volts at every speed",
				code: {
					python: F.spinUp.python.replace(
						"feedforward = kV * target ",
						"feedforward = 15 ",
					),
					cpp: F.spinUp.cpp.replace(
						"feedforward = kV * target;",
						"feedforward = 15;",
					),
				},
				expect: /grow with the speed/,
			},
		],
		pass: (m) => m.settleErr < 20,
		coach: (m) => {
			if (m.settleErr < 20) return null;
			return m.finalValue < m.finalTarget
				? `It holds ${rpm(m.settleErr)} below the target. kP only pushes when there's an error, and a spinning wheel needs volts just to keep going. Add a push that comes from the target speed, not the error.`
				: `It settles ${rpm(m.settleErr)} above the target. The volts that hold a speed grow with the speed, so use kV times the target.`;
		},
	},
	{
		id: "08-rapid-fire",
		number: 8,
		title: "Rapid fire",
		story:
			"The feeder pushes a projectile through the wheels five times a second, and each one costs the wheel 400 RPM. A slow wheel throws a short shot.",
		goal: "Every shot leaves within **50 RPM** of the target speed.",
		hints: [
			"Feedforward holds the speed, but it doesn't push any harder when a shot slows the wheel down. kP does, and a bigger kP wins the speed back faster.",
			"Try `kP = 0.02`.",
		],
		why: "Feedforward holds the speed, and feedback wins it back after every shot. That's a launcher controller.",
		spec: {
			mechanism: "flywheel",
			env: {
				noise: { tick: 0, amplitude: 15 },
				shots: {
					startS: 1.5,
					everyS: 0.2,
					count: 10,
					loss: 400,
					tolerance: 50,
				},
			},
			durationS: 4.5,
		},
		variants: [
			{ name: "6,000 RPM", target: 6000, seed: 1 },
			{ name: "4,500 RPM", target: 4500, seed: 2 },
			{ name: "7,500 RPM", target: 7500, seed: 3 },
		],
		starter: {
			python: F.spinUp.python.replace(
				"kP = 0.002\n",
				"kP = 0.002  # TODO: recover faster?\n",
			),
			cpp: F.spinUp.cpp.replace(
				"kP = 0.002;\n",
				"kP = 0.002;  // TODO: recover faster?\n",
			),
		},
		solution: F.rapidFire,
		wrongAnswers: [
			{ name: "gentle kP", code: F.spinUp, expect: /falls short/ },
		],
		pass: (m) => m.shotErr < 50,
		coach: (m) => {
			const worst = worstShot(m);
			if (!worst || Math.abs(worst.err) < 50) return null;
			return worst.err > 0
				? `Shot ${worst.n} left ${rpm(worst.err)} slow, so it falls short. Each projectile costs the wheel 400 RPM, and feedforward alone is slow to win it back. Push harder while the wheel is slow.`
				: `Shot ${worst.n} left ${rpm(-worst.err)} fast, so it flies long.`;
		},
	},
	{
		id: "09-worn-wheels",
		number: 9,
		title: "Worn wheels",
		story:
			"Launcher wheels wear down over a competition, and worn ones drag more, so kV's volts aren't enough. One of these launchers has new wheels and two have worn ones. The feeder fires once a second from 2 s.",
		goal: "Every shot leaves within **25 RPM** of the target, and the wheel never spins more than **150 RPM** over.",
		hints: [
			{
				python:
					"Add up the error over time with `integral += error * dt`, and add `kI * integral` to the output. It keeps growing until the wheel is at speed, however worn the wheels are. Write `global integral` inside the function.",
				cpp: "Add up the error over time with `integral += error * dt;`, and add `kI * integral` to the output. It keeps growing until the wheel is at speed, however worn the wheels are.",
			},
			{
				python:
					"While the wheel spins up the error is thousands of RPM, so the integral piles up and the wheel flies past. Limit it like in level 6: `integral = clamp(integral + error * dt, -20, 20)` with `kI = 0.1`.",
				cpp: "While the wheel spins up the error is thousands of RPM, so the integral piles up and the wheel flies past. Limit it like in level 6: `integral = clamp(integral + error * dt, -20, 20);` with `kI = 0.1`.",
			},
		],
		why: "That's a full flywheel controller: feedforward for the speed you want, P to win it back after a shot, and a limited I for what you can't measure.",
		spec: {
			mechanism: "flywheel",
			env: {
				noise: { tick: 0, amplitude: 15 },
				shots: { startS: 2, everyS: 1, count: 3, loss: 400, tolerance: 25 },
			},
			durationS: 4.5,
		},
		variants: [
			{ name: "Worn wheels", target: 6000, drag: 1.1, seed: 1 },
			{ name: "New wheels", target: 6000, seed: 2 },
			{ name: "Worn wheels at 5,000 RPM", target: 5000, drag: 1.1, seed: 3 },
		],
		starter: {
			python: code`
				from robot import clamp

				kP = 0.02
				kI = 0.0  # TODO: pick a value
				kV = 0.0025

				integral = 0.0


				def controller(speed, target, dt):
				    global integral
				    error = target - speed
				    # TODO: add up the error in integral, and limit it.
				    feedforward = kV * target
				    return feedforward + kP * error + kI * integral
			`,
			cpp: code`
				#include "robot.h"

				const double kP = 0.02;
				const double kI = 0.0;  // TODO: pick a value
				const double kV = 0.0025;

				double integral = 0;

				double controller(double speed, double target, double dt) {
				  double error = target - speed;
				  // TODO: add up the error in integral, and limit it.
				  double feedforward = kV * target;
				  return feedforward + kP * error + kI * integral;
				}
			`,
		},
		solution: F.worn,
		wrongAnswers: [
			{ name: "no integral", code: F.rapidFire, expect: /drag more/ },
			{
				name: "unlimited integral",
				code: {
					python: F.worn.python.replace(
						"integral = clamp(integral + error * dt, -20, 20)  # at most 2 V",
						"integral += error * dt",
					),
					cpp: F.worn.cpp.replace(
						"integral = clamp(integral + error * dt, -20, 20);  // at most 2 V",
						"integral += error * dt;",
					),
				},
				expect: /spinning up/,
			},
		],
		pass: (m) => m.shotErr < 25 && m.overshoot < 150,
		coach: (m, run) => {
			if (m.overshoot >= 150) {
				const integral = run.plots.integral?.filter(
					(v): v is number => v !== null,
				);
				const peak = integral?.length
					? Math.max(...integral.map(Math.abs))
					: null;
				return `It spun ${rpm(m.overshoot)} past the target. The integral kept adding up the whole time the wheel was spinning up.${peak !== null ? ` It reached ${peak.toFixed(0)}.` : ""} Limit it, like in level 6.`;
			}
			const worst = worstShot(m);
			if (!worst || Math.abs(worst.err) < 25) return null;
			return worst.err > 0
				? `Shot ${worst.n} left ${rpm(worst.err)} slow. Worn wheels drag more than kV expects, and kP's push fades before it closes the gap. An integral keeps growing until it does.`
				: `Shot ${worst.n} left ${rpm(-worst.err)} fast. The integral is pushing too hard: lower kI or limit it more.`;
		},
	},
	{
		id: "10-noisy-encoder",
		number: 10,
		title: "Noisy encoder",
		stretch: true,
		story:
			"This encoder's reading jitters by a fraction of a degree. Your D term divides that jitter by dt, which is 0.005 s, so it comes out 200 times bigger and the motor buzzes.",
		goal: "Settle within **1°** with a smooth motor: jitter under **0.6 V**.",
		hints: [
			"Plot your derivative to see the noise. A smoothed version moves only part of the way toward each new value, so the jitter averages out.",
			"`filtered = 0.9 * filtered + 0.1 * derivative`, then use `kD * filtered`.",
		],
		why: "That's a low-pass filter. Real controllers filter the derivative or keep kD small for exactly this reason.",
		spec: {
			mechanism: "arm",
			env: { noise: { tick: 0.2, amplitude: 0.3 } },
			durationS: 6,
		},
		variants: ARM_VARIANTS,
		starter: {
			python: S.windup.python
				.replace("integral = 0.0\n", "integral = 0.0\nfiltered = 0.0\n")
				.replace(
					"global last_error, integral\n",
					"global last_error, integral, filtered\n",
				)
				.replace('    plot("integral", integral)\n', "")
				.replace(
					"    last_error = error\n",
					'    last_error = error\n    # TODO: smooth the derivative before using it.\n    plot("derivative", derivative)\n',
				)
				.replace("  # never more than 2", ""),
			cpp: S.windup.cpp
				.replace(
					"double integral = 0;\n",
					"double integral = 0;\ndouble filtered = 0;\n",
				)
				.replace('  plot("integral", integral);\n', "")
				.replace(
					"  lastError = error;\n",
					'  lastError = error;\n  // TODO: smooth the derivative before using it.\n  plot("derivative", derivative);\n',
				)
				.replace("  // never more than 2", ""),
		},
		solution: S.noise,
		wrongAnswers: [{ name: "unfiltered", code: S.windup, expect: /buzzing/ }],
		pass: (m) => m.settleErr < 1 && m.jitter < 0.6,
		coach: (m) => {
			if (m.jitter >= 0.6) {
				return `The motor is buzzing: it changes by ${m.jitter.toFixed(2)} V every tick on average. The D term is amplifying the encoder's jitter.`;
			}
			return null;
		},
	},
	{
		id: "11-brownout",
		number: 11,
		title: "Brownout",
		stretch: true,
		story:
			"Pull more than 16 V for 0.15 s and the battery sags to 12 V. In a match, a sagging battery can reset your electronics.",
		goal: "Settle within **1°** without ever browning out.",
		hints: [
			"Full power at the start is what browns it out, and it comes from the error jumping to 60° all at once. Keep your own `setpoint` and walk it toward the target a little each tick, then use `setpoint - angle` as the error.",
			{
				python:
					"Move it at most 90° per second: `step = max_speed * dt`, then `setpoint += clamp(target - setpoint, -step, step)`. Start it at the arm's angle on the first call.",
				cpp: "Move it at most 90° per second: `double step = maxSpeed * dt;`, then `setpoint += clamp(target - setpoint, -step, step);`. Start it at the arm's angle on the first call.",
			},
		],
		why: "That's a motion profile. It plans the move so PID only ever sees a small error, and the motor never has to slam.",
		spec: {
			mechanism: "arm",
			env: { brownout: { threshold: 16, holdS: 0.15, sagged: 12 } },
			durationS: 6,
		},
		variants: ARM_VARIANTS,
		starter: {
			python: S.profile.python.replace(
				'    # Walk the setpoint toward the target instead of jumping there.\n    step = max_speed * dt\n    setpoint += clamp(target - setpoint, -step, step)\n    plot("setpoint", setpoint)\n\n    error = setpoint - angle\n',
				"    # TODO: move setpoint toward target by at most max_speed * dt,\n    #       then use setpoint instead of target in the error.\n\n    error = target - angle\n",
			),
			cpp: S.profile.cpp.replace(
				'  // Walk the setpoint toward the target instead of jumping there.\n  double step = maxSpeed * dt;\n  setpoint += clamp(target - setpoint, -step, step);\n  plot("setpoint", setpoint);\n\n  double error = setpoint - angle;\n',
				"  // TODO: move setpoint toward target by at most maxSpeed * dt,\n  //       then use setpoint instead of target in the error.\n\n  double error = target - angle;\n",
			),
		},
		solution: S.profile,
		wrongAnswers: [
			{ name: "no profile", code: S.noise, expect: /browned out/ },
		],
		pass: (m) => m.settleErr < 1 && !m.browned,
		coach: (m, run) => {
			if (!m.browned) return null;
			const at = run.events.find((event) => event.kind === "brownout")?.t;
			return `You browned out the battery${at !== undefined ? ` at ${at.toFixed(2)} s` : ""}: the motor pulled more than 16 V for too long. Ease into the move instead of jumping at it.`;
		},
	},
	{
		id: "12-taking-hits",
		number: 12,
		title: "Taking hits",
		stretch: true,
		story:
			"An enemy robot keeps ramming yours, shoving the arm every 1.5 seconds. Feedforward can't see the hits coming.",
		goal: "In the last 3 seconds, never get knocked more than **5.5°** off target.",
		hints: [
			"This one is all feedback. A bigger kP shoves back harder.",
			"Raise kP until the arm wobbles after each hit, then raise kD until the wobble stops. Try kP = 1.5 and kD = 0.12.",
		],
		why: "Fighting off pushes you can't predict is the reason to close the loop at all.",
		spec: {
			mechanism: "arm",
			env: { hits: { startS: 1.5, everyS: 1.5, widthS: 0.1, volts: 12 } },
			durationS: 8,
		},
		variants: ARM_VARIANTS,
		starter: {
			python: S.profile.python
				.replace("kP = 0.6\n", "kP = 0.6  # TODO: stiffer?\n")
				.replace("kD = 0.08\n", "kD = 0.08  # TODO: stiffer?\n"),
			cpp: S.profile.cpp
				.replace(
					"const double kP = 0.6;\n",
					"const double kP = 0.6;  // TODO: stiffer?\n",
				)
				.replace(
					"const double kD = 0.08;\n",
					"const double kD = 0.08;  // TODO: stiffer?\n",
				),
		},
		solution: STIFF,
		wrongAnswers: [{ name: "soft gains", code: S.profile, expect: /knock/ }],
		pass: (m) => m.worstLate < 5.5,
		coach: (m) => {
			if (m.worstLate >= 5.5) {
				return `The hits knock it up to ${deg(m.worstLate)} off target. Make it stiffer: more kP to shove back, then more kD to stop the wobble.`;
			}
			return null;
		},
	},
	{
		id: "13-sticky-gearbox",
		number: 13,
		title: "Sticky gearbox",
		stretch: true,
		story:
			"This gearbox sticks. From rest, it won't move until the motor pushes more than 4 V past what holds the weight.",
		goal: "Settle within **0.2°** of the target.",
		hints: [
			"Add a constant nudge in the direction of the error, `kS` volts, whenever the arm is more than a fraction of a degree off.",
			{
				python:
					"Try `kS = 4`, only when `abs(error) > 0.2`: `output += math.copysign(kS, error)`.",
				cpp: "Try `kS = 4`, only when `std::abs(error) > 0.2`: `output += std::copysign(kS, error);`.",
			},
		],
		why: "kS does for friction what kG does for gravity.",
		spec: { mechanism: "arm", env: { stiction: 4 }, durationS: 6 },
		variants: ARM_VARIANTS,
		starter: {
			python: STIFF.python
				.replace(
					"max_speed = 90.0  # degrees per second",
					"kS = 0.0  # TODO: volts that break the gearbox loose\nmax_speed = 90.0  # degrees per second",
				)
				.replace(
					"    return kP * error + kI * integral + kD * filtered + gravity\n",
					"    output = kP * error + kI * integral + kD * filtered + gravity\n    # TODO: when the arm is off target, nudge it with kS volts toward the target.\n    return output\n",
				),
			cpp: STIFF.cpp
				.replace(
					"const double maxSpeed = 90.0;  // degrees per second",
					"const double kS = 0.0;  // TODO: volts that break the gearbox loose\nconst double maxSpeed = 90.0;  // degrees per second",
				)
				.replace(
					"  return kP * error + kI * integral + kD * filtered + gravity;\n",
					"  double output = kP * error + kI * integral + kD * filtered + gravity;\n  // TODO: when the arm is off target, nudge it with kS volts toward the target.\n  return output;\n",
				),
		},
		solution: STICKY,
		wrongAnswers: [{ name: "no kS", code: STIFF, expect: /stuck/ }],
		pass: (m) => m.settleErr < 0.2,
		coach: (m) => {
			if (m.settleErr >= 0.2) {
				return `Friction has it stuck ${m.settleErr.toFixed(2)}° from the target. Small pushes can't break it loose.`;
			}
			return null;
		},
	},
	{
		id: "14-match",
		number: 14,
		title: "Match",
		stretch: true,
		story:
			"Three positions, called one after another, then a hopper refill, on a battery that browns out above 20 V. Everything from the arm levels, in one match.",
		goal: "Reach each position within **3°** before the next one is called, settle within **1°** at the end, and never brown out.",
		hints: [
			"Start from your best arm controller. Everything you need is in levels 4 to 6 and 10 to 13.",
			"The profile keeps the battery happy and the integral handles the refill. If a position is missed, check that max speed is fast enough to get there in time.",
		],
		why: "That's a full arm controller: a motion profile, feedforward and PID. It's the same structure you'd write for the robot.",
		spec: {
			mechanism: "arm",
			env: {
				sequence: [
					{ t: 0, angle: 60 },
					{ t: 3, angle: 15 },
					{ t: 6, angle: 90 },
				],
				reload: { t: 7, weight: 1.8 },
				brownout: { threshold: 20, holdS: 0.15, sagged: 14 },
			},
			durationS: 10,
		},
		variants: SEQUENCE_VARIANTS,
		starter: STICKY,
		solution: STICKY,
		wrongAnswers: [
			{ name: "no profile", code: S.windup, expect: /browned out/ },
		],
		pass: (m) => m.waypointErr < 3 && m.settleErr < 1 && !m.browned,
		coach: (m, run) => {
			if (m.browned) {
				const at = run.events.find((event) => event.kind === "brownout")?.t;
				return `You browned out the battery${at !== undefined ? ` at ${at.toFixed(2)} s` : ""}. Ease into each move with a motion profile.`;
			}
			if (m.waypointErr >= 3) {
				return `It was still ${deg(m.waypointErr)} away when the next position was called. Get there faster.`;
			}
			return null;
		},
	},
];

/** Which part of the course a level is in: the arm, the flywheel or the stretch levels. */
export function sectionOf(level: Level): "Arm" | "Flywheel" | "Stretch" {
	if (level.stretch) return "Stretch";
	return level.spec.mechanism === "flywheel" ? "Flywheel" : "Arm";
}

export function getLevel(id: string): Level | undefined {
	return LEVELS.find((level) => level.id === id);
}
