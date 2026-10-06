# PID Workshop spec

Status: built, 2026-10-06. This describes what the code does; see the README to run it.
Owner: Evan Yu. Requested by Aaron Huang for the RIFT embedded/controls workshop (ARC Championships).

## Summary

A browser playground where students write a feedback controller in Python or C++ and watch it drive a simulated robot arm. It follows the level structure of [PID Playground](https://pid-playground.rishaan.cc/), but students build the controller one piece at a time instead of tuning gains with sliders. No code from that site was used.

Everything runs in the browser. Student code compiles and runs in Web Workers, Monaco gets live errors and completion from a language server in a worker, and there is no backend. The app is TanStack Start with Tailwind and shadcn/ui, in the RIFT design system from rift-web.

## Decisions

| Date | Question | Decision |
|---|---|---|
| 2026-10-05 | Deploy target | Vercel or Cloudflare Workers, picked later. Tool binaries go on R2 either way |
| 2026-10-05 | Workshop timing | Not soon. clangd and the stretch levels are in scope |
| 2026-10-05 | Students new to code | Keep the level design. Python is suggested to first-timers; level 1's hints show `if`/`else` syntax |
| 2026-10-05 | Porting PID Playground's code | Not needed. Everything here is written from scratch; the site is credited |
| 2026-10-05 | Mechanism | An arm, for every level |
| 2026-10-05 | Robot platform | ARC robots: a 24 V battery and an embedded controller. The sim uses ±24 V and a 200 Hz loop, and avoids FRC terms |
| 2026-10-05 | LSP client | A small client of our own instead of monaco-languageclient. See [Editor](#editor) |

## Goals

- Students write `controller(angle, target, dt)` and return volts. By the last core level it's a full PID + feedforward controller.
- Students switch between Python and C++ at any time. Each language keeps its own code per level.
- Monaco shows errors as you type, completion, hover and signature help in both languages.
- Every failed run gets a plain-English reason based on what the arm did.

## Non-goals

Accounts or any server that stores data, running code on a server, Java, phone layouts, and a free-play sandbox. Progress lives in localStorage.

## Routes

| Route | Purpose | SSR |
|---|---|---|
| `/` | What this is, language picker (Python marked "First time"), level list | yes |
| `/setup` | Downloads each language's tools with progress bars | no |
| `/level/$levelId` | The play screen | no |

- `?lang=cpp|python` sets the language; `?instructor=1` unlocks every level and the Answer button, `?instructor=0` turns that off. Both are saved and removed from the URL.
- Share links carry the code in the hash: `/level/03-brakes?lang=python#code=<lz-string>`. The page reads it once, saves it as the student's code for that level, and clears the hash.

## Play screen

Wide screens (1280 px and up) have two columns. On the left are the level brief, the arm, the response graph and the metrics. On the right are the editor, the console and the verdict, which stay in view while the page scrolls. Narrower screens stack them in reading order: brief, code, verdict, then the arm and graph.

- **Level rail.** Numbered chips, with a check when passed and a lock when locked. A level unlocks when the previous one passes. Stretch levels come after a divider.
- **Brief.** Title, story, goal, two hints shown one at a time, and an Answer dialog. Answer appears in instructor mode, or after both hints and two failed runs. "Use this code" replaces the editor contents.
- **Arm.** SVG with a scale from -30° to 150°, hard stops, the target ray, the latch while it holds, a game piece ring, a flash when a defender hits, a motor-effort arc around the pivot, and a BROWNOUT label. Replays in real time after each run, with Replay and Skip buttons.
- **Response graph.** Canvas with three strips: angle and target, motor volts, and the student's `plot()` lines with their own scale. Event markers show piece, release and brownout. Hovering shows the values at that time.
- **Metrics.** Overshoot, settle error, peak motor and jitter for the variant on screen, plus a chip for each hidden test variant. Clicking a chip replays that variant.
- **Editor header.** Python or C++ toggle, `controller.py`/`robot.py` (or `controller.cpp`/`robot.h`, read-only) tabs, "use my code from the last level" (when there is some), Reset with a confirm, Share, and Run (also Ctrl/Cmd+Enter). A progress bar shows while the toolchain downloads.
- **Status line and console.** The status line shows the language server and runtime state. The console shows compiler output, `print`/`printf`/`std::cout`, tracebacks and a one-line summary of each variant.
- **Verdict.** Ready, Running, a pass with the takeaway and a link to the next level, or a fail with the coach message. Errors on a line are also underlined in the editor.

Each level opens with our starter code, which has `// TODO` comments where the new piece goes, or the student's saved code for that level. Their passing code from the previous level is one click away instead of loading automatically. The starters guide beginners better than their own code would.

## Controller contract

The sim calls the student's function every 5 ms (200 Hz). It gets the measured angle and the target in degrees and `dt` in seconds, and returns motor volts. The output is clipped to ±24 V, or less during a brownout, and held until the next call. Module-level variables keep their values between calls and reset for every run and every variant.

### C++

`robot.h` is read-only in the editor:

```cpp
extern "C" double controller(double angle, double target, double dt);
void plot(const char* name, double value);          // a line on the graph
inline double clamp(double x, double lo, double hi);
inline double toRadians(double degrees);
```

The full standard library is available: `<cmath>`, `<algorithm>`, `<cstdio>` and `<iostream>`. stdout is unbuffered, so `printf` lines show up in order. Because of the `extern "C"` declaration, students write a plain `double controller(...)`.

### Python

`robot.py` provides `plot(name, value)` and `clamp(x, lo, hi)`, imported with `from robot import plot, clamp`. `math` and the rest of the standard library are available. Assigning a module-level variable needs `global`. Level 3 teaches it, and the coach catches the `UnboundLocalError`.

## Levels

Core path:

| # | id | The problem | Student writes | Pass (every variant) |
|---|---|---|---|---|
| 1 | `01-on-off` | Get the arm up at all | `if` below target, 6 V, else 0 | settle error < 10° |
| 2 | `02-push` | On/off buzzes between 6 V and nothing | `kP * error` | settle < 10°, jitter < 0.1 V |
| 3 | `03-brakes` | A bigger kP swings past | `last_error`, `(error - last_error) / dt` | overshoot < 3°, settle < 8° |
| 4 | `04-sag` | It stops short and stays there | `kG * cos(radians(angle))` | settle < 1°, overshoot < 5° |
| 5 | `05-game-piece` | Holding at target, it gets twice as heavy at 2 s | `integral += error * dt` | settle < 0.5° |
| 6 | `06-windup` | A latch holds it at 20° for 3 s and the integral winds up | clamp the integral to ±2 | overshoot < 6°, settle < 1° |

Stretch:

| # | id | Environment | Student writes | Pass |
|---|---|---|---|---|
| 7 | `07-noisy-encoder` | encoder rounds to 0.2°, ±0.3° noise | low-pass filter on the derivative | settle < 1°, jitter < 0.6 V |
| 8 | `08-brownout` | over 16 V for 0.15 s sags the battery to 12 V | a setpoint that moves at most 90°/s | settle < 1°, no brownout |
| 9 | `09-defense` | 12 V shoves for 0.1 s every 1.5 s | stiffer gains (kP 1.5, kD 0.12) | worst error in the last 3 s < 5.5° |
| 10 | `10-sticky-gearbox` | stiction: needs 4 V past gravity to move | `kS` nudge when error > 0.2° | settle < 0.2° |
| 11 | `11-match` | 60° → 15° → 90° at 0, 3, 6 s; piece at 7 s (×1.8); brownout above 20 V | everything | each position within 3° before the next, settle < 1°, no brownout |

Variants: 60° (shown), 30°, and 75° with a 1.3× heavier arm. The match uses a normal and a heavier arm. A run passes only if every variant does. If the shown one passes and a hidden one fails, the coach says which.

The level plan changed during the build. The thresholds were calibrated by running the cumulative solutions against every level:

- A "smooth moves" level meant to teach derivative-on-measurement was dropped, because the level 7 filter already removes the derivative kick.
- Level 5 starts at the target. Otherwise the integral winds up on the first climb and teaches level 6's lesson early.
- The match has no encoder noise, because noise makes the kS nudge flip sign every tick.
- The match's brownout limit is 20 V, so the full controller from level 10 can pass.

Each level is one object in `src/levels/index.ts`: story, goal, hints (per language where they differ), takeaway, sim spec, variants, starter and solution in both languages, wrong answers with the coach message each must produce, the pass check, and level-specific coaching.

## Simulation

`src/sim/arm.ts`, pure TypeScript:

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

Environment effects: encoder noise (rounding plus uniform noise from a seeded RNG, so the same code always gets the same run), stiction (stuck from rest until the push beats gravity by the threshold, then half that as drag), brownout (over the threshold for long enough drops the limit for the rest of the run), game piece (weight multiplier from a time), latch (caps the angle until a time), defense (alternating torque pulses), sequence (target changes over time) and `startAtTarget`.

## Metrics and coaching

`src/sim/metrics.ts` computes, per run: closest approach, overshoot past the final target in the direction of travel, mean error over the last 0.8 s, worst error over the last 3 s, waypoint error, rise time, jitter (mean volt change per tick over the second half), biggest single-tick step, peak volts, longest saturation, brownout, growing oscillation, and constant output.

`src/coach/grade.ts` returns a title and a message:

1. **Code problems first.** A syntax error points at its line. A missing `controller` gets the expected signature. Python's `UnboundLocalError` gets the `global` advice. Returning nothing or NaN, a crash (integer divide by zero, out-of-bounds memory, abort) and timeouts each get their own message.
2. **Then the level's own coaching**, with numbers from the run, such as level 3's "It swings 13.3° past the target. Brake on the way in: push against how fast the error is shrinking."
3. **Then general advice**: constant output, growing oscillation, fell over the top, never got near, saturated, overshoot, settles above or below.

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

COOP `same-origin` and COEP `require-corp` are set on every response: by TanStack Start middleware for pages, Nitro `routeRules` for static files, and Vite `server.headers` in dev. Tools on another origin only need CORS, because every request for them is a CORS fetch or a module import. This was tested with a production build loading clang and clangd from a separate CORS-only origin.

### Hosting

- **App** (Nitro preset for Vercel or Cloudflare): 39 MB of static files, mostly Pyodide (15 MB) and the basedpyright worker (18 MB). Every file is under Cloudflare's 25 MiB limit.
- **Tools** on R2: clang (75 MB wasm plus a 30 MB header and library tar) and clangd (126 MB wasm). Built with `VITE_TOOLS_URL`.
- **Downloads per student:** Python about 10 MB compressed, C++ about 45 MB. `/setup` downloads them ahead of time.

## Testing

| Suite | What it checks | Result 2026-10-06 |
|---|---|---|
| `tests/levels.test.ts` | Solutions pass every variant, starters fail, each wrong answer gets its message, in both languages, using real Pyodide and clang | 73/73 |
| `tests/sim.test.ts` | Gravity, hold voltage, clipping, timing, noise determinism, brownout, metrics | 10/10 |
| `scripts/smoke.mjs` | In Chromium: level 1 passes, live error underlines and completion, in both languages | pass, dev and production |
| `scripts/smoke-errors.mjs` | Python `global`, syntax errors, infinite loops in both languages, missing semicolon, wrong function name, `printf` | 7/7, dev and production |
| `scripts/smoke-levels.mjs` | Every level's answer in the browser, both languages | 22/22 |

## Risks and open items

| Item | Notes |
|---|---|
| clangd binary provenance | Uses clangd-in-browser's published build, pinned by sha256. `scripts/clangd/build.sh` builds our own but hasn't been run |
| Memory on low-end laptops | clangd reserves 2 GB of shared memory and starts a thread pool. The T3 preview browser disconnected during one test with clangd running. Test on the weakest Chromebook; steer those students to Python |
| Offline at the venue | `/setup` warms the HTTP cache only. A service worker would be sturdier |
| Deploy preset | Only the Node preset has been built. Check the chosen host serves the headers on static files |
| Safari and Firefox | Not tested yet |
| Fonts | Widescreen trial files, carried over from rift-web |

## Credits

Level structure inspired by [PID Playground](https://pid-playground.rishaan.cc/) by Rishaan. The clangd stdin plumbing and build script follow [clangd-in-browser](https://github.com/Guyutongxue/clangd-in-browser) by Guyutongxue (MIT).
