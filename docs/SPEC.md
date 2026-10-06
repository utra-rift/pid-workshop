# Learn PID spec

Status: built, 2026-10-06. This describes what the code does; see the README to run it.
Owner: Evan Yu. Requested by Aaron Huang for the RIFT embedded/controls workshop (ARC Championships).

## Summary

A browser playground where students write a feedback controller in Python or C++ and watch it drive a simulated robot: an arm, then the launcher's flywheel. It follows the level structure of [PID Playground](https://pid-playground.rishaan.cc/), but students build the controller one piece at a time instead of tuning gains with sliders. No code from that site was used.

Everything runs in the browser. Student code compiles and runs in Web Workers, Monaco gets live errors and completion from a language server in a worker, and there is no backend. The app is TanStack Start with Tailwind and shadcn/ui, in the RIFT design system from rift-web.

## Decisions

| Date | Question | Decision |
|---|---|---|
| 2026-10-06 | Mechanisms | An arm, plus a launcher flywheel (levels 7–9) like PID Playground's. No game pieces: ARC robots fire projectiles, so the arm's extra load is a hopper refill and its disturbances are hits from other robots |
| 2026-10-06 | Saved progress | Keyed by level number, not id. No migration from the earlier id keys, which nobody used yet |
| 2026-10-06 | Deploy target | Vercel. All tools ship with the app; the three big binaries are gzipped to fit 25 MiB per file, so no separate bucket is needed |
| 2026-10-05 | Workshop timing | Not soon. clangd and the stretch levels are in scope |
| 2026-10-05 | Students new to code | Keep the level design. Python is suggested to first-timers; level 1's hints show `if`/`else` syntax |
| 2026-10-05 | Porting PID Playground's code | Not needed. Everything here is written from scratch; the site is credited |
| 2026-10-05 | Robot platform | ARC robots: a 24 V battery and an embedded controller. The sim uses ±24 V and a 200 Hz loop, and avoids FRC terms |
| 2026-10-05 | LSP client | A small client of our own instead of monaco-languageclient. See [Editor](#editor) |

## Goals

- Students write `controller(angle, target, dt)` for the arm and `controller(speed, target, dt)` for the flywheel, and return volts. By the end of each mechanism's core levels it's a full PID + feedforward controller.
- Students switch between Python and C++ at any time. Each language keeps its own code per level.
- Monaco shows errors as you type, completion, hover and signature help in both languages.
- Every failed run gets a plain-English reason based on what the arm or flywheel did.

## Non-goals

Accounts or any server that stores data, running code on a server, Java, phone layouts, and a free-play sandbox. Progress lives in localStorage, keyed by level number: passed levels, code per level and language, passing code, and hints shown.

## Routes

| Route | Purpose | SSR |
|---|---|---|
| `/` | What this is, language picker (Python marked "First time"), level list | yes |
| `/level/$levelId` | The play screen | no |

Picking a language downloads and starts everything the lesson needs before opening it: the runtime (Pyodide or clang) and the language server, with a progress bar in the card. The lesson opens once the runtime is running. The language server gets up to 30 s more, then keeps loading inside the lesson, so a stuck one can't block it. Both stay alive while the student moves between levels. A returning student's language starts downloading as soon as the landing page opens. Each card is also a plain link to its first level, so a click before the page hydrates still works.

- `?lang=cpp|python` sets the language; `?instructor=1` unlocks every level and the Answer button, `?instructor=0` turns that off. Both are saved and removed from the URL.
- Share links carry the code in the hash: `/level/03-brakes?lang=python#code=<lz-string>`. The page reads it once, saves it as the student's code for that level, and clears the hash.

## Play screen

The top bar holds the RIFT mark and the level chips (numbered, a check when passed, a lock when locked, a labelled divider before the flywheel and before the stretch levels). There are no other navigation links. Wide screens (1280 px and up) have two columns. On the left are the level brief, the arm or flywheel, the response graph and the metrics. On the right are the editor, the console and the verdict, which stay in view while the page scrolls. Narrower screens stack them in reading order: brief, code, verdict, then the mechanism and graph.

- **Levels.** A level unlocks when the previous one passes. The current one scrolls into view in the top bar.
- **Brief.** Title, story, goal, two hints shown one at a time, and an Answer dialog. Answer appears in instructor mode, or after both hints and two failed runs. "Use this code" replaces the editor contents.
- **Arm.** SVG with a scale from -30° to 150°, hard stops, the target ray, the latch while it holds, a ring once the hopper is refilled, a flash when a hit lands, a motor-effort arc around the pivot, and a BROWNOUT label. Replays in real time after each run, with Replay and Skip buttons.
- **Flywheel.** SVG of the launcher: two friction wheels whose spokes turn at a 40th of the real speed, a motor-effort arc on each, a 0–10k RPM gauge with the target marked, and an armour panel. Each projectile flies to the panel and lands high if the wheel was fast, low if slow, and short on the floor if far too slow. The panel covers the level's shot tolerance, so a hit on the panel is a shot that passed. A HITS counter tallies them.
- **Response graph.** Canvas with three strips: angle or speed with the target, motor volts, and the student's `plot()` lines with their own scale. Event markers show reload, release and brownout; hits and new targets get unlabelled lines, and shots get short amber ticks along the top. Hovering shows the values at that time. Each live value in the legend has a fixed-width slot, so values that change every frame (the motor especially) don't shift the text around them. Hovering or focusing a legend entry highlights its line and dims the others. The `plot()` strip scales to the 1st–99th percentile of its values, so one spike, such as a derivative's first tick, can't flatten the rest.
- **Metrics.** For the arm: overshoot, settle error, peak motor and jitter. For the flywheel: worst shot (or settle error with no shots), overshoot, peak motor and jitter, in RPM. Plus a chip for each hidden test variant. Clicking a chip replays that variant.
- **Editor header.** Python or C++ toggle, `controller.py`/`robot.py` (or `controller.cpp`/`robot.h`, read-only) tabs, "use my code from the last level" (when there is some), Reset with a confirm, Share, and Run (also Ctrl/Cmd+Enter). A progress bar shows while the toolchain downloads.
- **Status line and console.** The status line shows the language server and runtime state. The console shows compiler output, `print`/`printf`/`std::cout`, tracebacks and a one-line summary of each variant.
- **Verdict.** Ready, Running, a pass with the takeaway and a link to the next level, or a fail with the coach message. Errors on a line are also underlined in the editor.

Each level opens with our starter code, which has `// TODO` comments where the new piece goes, or the student's saved code for that level. Their passing code from the previous level of the same mechanism is one click away instead of loading automatically (level 10 offers level 6's arm code, not level 9's flywheel code). The starters guide beginners better than their own code would.

## Controller contract

The sim calls the student's function every 5 ms (200 Hz). It gets the sensor reading and the target, in degrees for the arm or RPM for the flywheel, and `dt` in seconds, and returns motor volts. The output is clipped to ±24 V, or less during a brownout, and held until the next call. Module-level variables keep their values between calls and reset for every run and every variant.

### C++

`robot.h` is read-only in the editor:

```cpp
extern "C" double controller(double measured, double target, double dt);
void plot(const char* name, double value);          // a line on the graph
inline double clamp(double x, double lo, double hi);
inline double toRadians(double degrees);
```

The full standard library is available: `<cmath>`, `<algorithm>`, `<cstdio>` and `<iostream>`. stdout is unbuffered, so `printf` lines show up in order. Because of the `extern "C"` declaration, students write a plain `double controller(...)`, and can name the first parameter `angle` or `speed`.

### Python

`robot.py` provides `plot(name, value)` and `clamp(x, lo, hi)`, imported with `from robot import plot, clamp`. `math` and the rest of the standard library are available. Assigning a module-level variable needs `global`. Level 3 teaches it, and the coach catches the `UnboundLocalError`.

## Levels

Core path, the arm:

| # | id | The problem | Student writes | Pass (every variant) |
|---|---|---|---|---|
| 1 | `01-on-off` | Get the arm up at all | `if` below target, 6 V, else 0 | settle error < 10° |
| 2 | `02-push` | On/off buzzes between 6 V and nothing | `kP * error` | settle < 10°, jitter < 0.1 V |
| 3 | `03-brakes` | A bigger kP swings past | `last_error`, `(error - last_error) / dt` | overshoot < 3°, settle < 8° |
| 4 | `04-sag` | It stops short and stays there | `kG * cos(radians(angle))` | settle < 1°, overshoot < 5° |
| 5 | `05-reload` | Holding at target, its hopper is refilled at 2 s and it gets twice as heavy | `integral += error * dt` | settle < 0.5° |
| 6 | `06-windup` | A latch holds it at 20° for 3 s and the integral winds up | clamp the integral to ±2 | overshoot < 6°, settle < 1° |

Core path, the flywheel. Speeds in RPM; the sensor has ±15 RPM of noise:

| # | id | The problem | Student writes | Pass (every variant) |
|---|---|---|---|---|
| 7 | `07-spin-up` | kP alone settles far short: a spinning wheel needs volts just to keep going | `kV * target` feedforward, kV = 24 V / 9,600 RPM | settle < 20 RPM |
| 8 | `08-rapid-fire` | 10 shots, 5 a second from 1.5 s, each costs 400 RPM | a bigger kP (0.02) to win the speed back | every shot within 50 RPM |
| 9 | `09-worn-wheels` | worn wheels drag 10% more; 3 shots, one a second from 2 s | `kI * integral`, clamped to ±20 | every shot within 25 RPM, overshoot < 150 RPM |

Stretch, back on the arm:

| # | id | Environment | Student writes | Pass |
|---|---|---|---|---|
| 10 | `10-noisy-encoder` | encoder rounds to 0.2°, ±0.3° noise | low-pass filter on the derivative | settle < 1°, jitter < 0.6 V |
| 11 | `11-brownout` | over 16 V for 0.15 s sags the battery to 12 V | a setpoint that moves at most 90°/s | settle < 1°, no brownout |
| 12 | `12-taking-hits` | an enemy robot rams it: 12 V shoves for 0.1 s every 1.5 s | stiffer gains (kP 1.5, kD 0.12) | worst error in the last 3 s < 5.5° |
| 13 | `13-sticky-gearbox` | stiction: needs 4 V past gravity to move | `kS` nudge when error > 0.2° | settle < 0.2° |
| 14 | `14-match` | 60° → 15° → 90° at 0, 3, 6 s; hopper refill at 7 s (×1.8); brownout above 20 V | everything | each position within 3° before the next, settle < 1°, no brownout |

Arm variants: 60° (shown), 30°, and 75° with a 1.3× heavier arm. The match uses a normal and a heavier arm. Flywheel variants: 6,000 RPM (shown), 4,000 and 7,500 RPM; rapid fire uses 4,500 instead of 4,000; worn wheels uses worn wheels at 6,000 RPM (shown), new wheels, and worn wheels at 5,000 RPM. A run passes only if every variant does. If the shown one passes and a hidden one fails, the coach says which.

The flywheel levels were calibrated the same way. P alone can't get within 20 RPM at any stable gain, because the loop goes unstable above kP ≈ 0.5 V/RPM. With rapid fire, kP 0.01 misses by about 63 RPM and 0.02 by about 13. With worn wheels, the integral without a clamp overshoots by about 2,000 RPM during spin-up.

The level plan changed during the build. The thresholds were calibrated by running the cumulative solutions against every level:

- A "smooth moves" level meant to teach derivative-on-measurement was dropped, because the level 10 filter already removes the derivative kick.
- Level 5 starts at the target. Otherwise the integral winds up on the first climb and teaches level 6's lesson early.
- The match has no encoder noise, because noise makes the kS nudge flip sign every tick.
- The match's brownout limit is 20 V, so the full controller from level 13 can pass.

Each level is one object in `src/levels/index.ts`: story, goal, hints (per language where they differ), takeaway, sim spec, variants, starter and solution in both languages, wrong answers with the coach message each must produce, the pass check, and level-specific coaching.

## Simulation

Pure TypeScript. `src/sim/simulate.ts` is the loop every level shares: noise, the controller call, clipping, brownout, and a plant stepped every 1 ms. The arm, `src/sim/arm.ts`:

```
acceleration = (volts - kG·weight·cos(angle) - kV·velocity) / (kA·weight)
```

| Constant | Value |
|---|---|
| kG | 4.0 V (holds the arm level) |
| kV | 3.2 V per rad/s |
| kA | 0.7 V per rad/s² |
| Battery | ±24 V |
| Hard stops | -30° and 150° |
| Physics step | 1 ms, semi-implicit Euler |
| Controller | every 5 ms, output held between calls |
| Default target | 60°. At 90°, gravity has no pull at the target and level 4 has nothing to fix |

The flywheel, `src/sim/flywheel.ts`, in RPM:

```
acceleration = (volts - kV·drag·speed) / (kA·inertia)
```

| Constant | Value |
|---|---|
| kV | 0.0025 V per RPM, so 24 V tops out at 9,600 RPM |
| kA | 0.00125 V per RPM/s, a 0.5 s time constant |
| Shots | each one takes `loss` RPM off the wheel at once |
| Default target | 6,000 RPM |

Environment effects: sensor noise (rounding plus uniform noise from a seeded RNG, so the same code always gets the same run), brownout (over the threshold for long enough drops the limit for the rest of the run) and `startAtTarget`, for both. On the arm: stiction (stuck from rest until the push beats gravity by the threshold, then half that as drag), reload (the hopper is refilled: a weight multiplier from a time), latch (caps the angle until a time), hits (alternating torque pulses) and sequence (target changes over time). On the flywheel: shots (a burst of projectiles, each costing some speed, with a tolerance for a hit) and, per variant, drag (worn wheels) and inertia.

## Metrics and coaching

`src/sim/metrics.ts` computes, per run: closest approach, overshoot past the final target in the direction of travel, mean error over the last 0.8 s, worst error over the last 3 s, waypoint error, the speed error at each shot, rise time, jitter (mean volt change per tick over the second half), biggest single-tick step, peak volts, longest saturation, brownout, growing oscillation, and constant output.

`src/coach/grade.ts` returns a title and a message:

1. **Code problems first.** A syntax error points at its line. A missing `controller` gets the expected signature. Python's `UnboundLocalError` gets the `global` advice. Returning nothing or NaN, a crash (integer divide by zero, out-of-bounds memory, abort) and timeouts each get their own message.
2. **Then the level's own coaching**, with numbers from the run, such as level 3's "It swings 13.3° past the target. Brake on the way in: push against how fast the error is shrinking."
3. **Then general advice**, worded for the mechanism: constant output, growing oscillation, fell over the top (arm), never got near, saturated, overshoot, settles above or below. Flywheel levels name the worst shot, such as "Shot 2 left 379 RPM slow, so it falls short."

## Architecture

| Piece | Choice |
|---|---|
| App | TanStack Start 1.168, React 19, Vite 8, Nitro |
| UI | Tailwind 4, shadcn/ui (Radix), the RIFT tokens and components from rift-web |
| Editor | Monaco 0.57 (`monaco-editor`), trimmed to the editor plus C++ and Python grammars |
| Python | Pyodide 314.0.7 (Python 3.14) in a worker |
| Python language server | `browser-basedpyright` 1.40.2 in a worker, `typeCheckingMode: basic`, auto-import completions off |
| C++ compiler | `@yowasp/clang` 22 (clang, wasm-ld, wasi-libc, libc++) in a worker |
| C++ runtime | WebAssembly + `@bjorn3/browser_wasi_shim`, in a disposable worker |
| C++ language server | clangd 21.1.0 compiled to WebAssembly (pthreads, Asyncify), in a worker |
| Tests | vitest with the real toolchains in Node; Playwright smoke scripts |

### Running code

- **Python.** The worker boots Pyodide, writes `robot.py` and runs each variant in a fresh namespace. The TypeScript sim calls the student's function directly, which takes about 4 ms per 300 calls. Errors are caught by a Python-side wrapper that records the trimmed traceback and line. A runaway loop is interrupted through a SharedArrayBuffer (`KeyboardInterrupt`) after 4 s, and the remaining variants are skipped. If Python itself is stuck, the worker is restarted after 7 s.
- **C++.** The compiler worker keeps clang loaded and builds with `--target=wasm32-wasip1 -O2 -std=c++20 -fno-exceptions -mexec-model=reactor -include prelude.h -Wall`, exporting `controller`. Diagnostics are parsed into editor underlines. The runner worker instantiates the module once per variant, which resets globals, and runs the sim. If the code doesn't return within 4 s, the runner is terminated and replaced.

### Editor

Monaco's built-in `monaco.lsp` client sends every open file to every server, with no way to pass initialization options, and basedpyright needs those for its virtual files. monaco-languageclient brings the whole VS Code service layer. So `src/editor/lsp/client.ts` is a ~500-line client over `vscode-languageserver-protocol` that registers Monaco providers for one language only. It covers document sync, diagnostics, completion (with resolve and snippets), hover, signature help and go to definition.

- **basedpyright** gets `robot.pyi` and `pyrightconfig.json` through `initializationOptions.files`. Its strict default would flag every untyped parameter, so the config uses basic mode.
- **clangd** runs from `clangd.js` and `clangd.wasm`, with the workspace written to its in-memory file system (`controller.cpp`, `robot.h`, `prelude.h`, `.clangd` with the flags). Its JSON transport is patched to await `stdinReady()` before each read. The worker splits every message into three stdin chunks (header line, blank line, body) and ends each `read()` at a chunk boundary. Without that, libc buffers ahead, the wait sees an empty queue, and clangd hangs on its first request.
- Enter accepts a suggestion only when it adds something (`acceptSuggestionOnEnter: "smart"`), so beginners don't accept completions by accident.

### Cross-origin isolation

COOP `same-origin` and COEP `require-corp` are set on every response: by TanStack Start middleware for pages, Nitro `routeRules` for static files (repeated for `/assets/**`, because Vercel stops at the first matching route), and Vite `server.headers` in dev. Worker scripts in particular won't start without COEP.

### Hosting

- **Everything ships with the app** in `public/vendor/`: Pyodide (15 MB), the basedpyright worker (18 MB), clang (26 MB) and clangd (24 MB). clang's 75 MB wasm and 30 MB header tar and clangd's 126 MB wasm are stored gzipped, which puts every file under Cloudflare's 25 MiB limit. The compiler worker swaps in a `fetch` that asks for the `.gz` and inflates it as it streams; the clangd worker inflates its wasm after downloading. Both skip inflating if a server already decoded the file. The static output is about 86 MiB.
- **Downloads per student:** Python about 10 MB compressed, C++ about 45 MB, downloaded when the student picks a language.

## Testing

| Suite | What it checks | Result 2026-10-06 |
|---|---|---|
| `tests/levels.test.ts` | Solutions pass every variant, starters fail, each wrong answer gets its message, in both languages, using real Pyodide and clang | 73/73 |
| `tests/sim.test.ts` | Gravity, hold voltage, clipping, timing, noise determinism, brownout, metrics | 10/10 |
| `scripts/smoke-start.mjs` | Landing page download flow, the lesson opening ready, level chips in the header, the legend not moving, the card working as a plain link | 8/8 |
| `scripts/smoke.mjs` | In Chromium: level 1 passes, live error underlines and completion, in both languages | pass, dev and production |
| `scripts/smoke-errors.mjs` | Python `global`, syntax errors, infinite loops in both languages, missing semicolon, wrong function name, `printf` | 7/7, dev and production |
| `scripts/smoke-levels.mjs` | Every level's answer in the browser, both languages | 22/22 |

## Risks and open items

| Item | Notes |
|---|---|
| clangd binary provenance | Uses clangd-in-browser's published build, pinned by sha256. `scripts/clangd/build.sh` builds our own but hasn't been run |
| Memory on low-end laptops | clangd reserves 2 GB of shared memory and starts a thread pool. The T3 preview browser disconnected during one test with clangd running. Test on the weakest Chromebook; steer those students to Python |
| Offline at the venue | Picking a language warms the HTTP cache only. A service worker would be sturdier |
| Deploy preset | Only the Node preset has been built. Check the chosen host serves the headers on static files |
| Safari and Firefox | Not tested yet |
| Fonts | Widescreen trial files, carried over from rift-web |

## Credits

Level structure inspired by [PID Playground](https://pid-playground.rishaan.cc/) by Rishaan. The clangd stdin plumbing and build script follow [clangd-in-browser](https://github.com/Guyutongxue/clangd-in-browser) by Guyutongxue (MIT).
