# Learn PID

A browser playground for the RIFT controls workshop. Students write a feedback controller in Python or C++ and watch it drive a simulated robot through fourteen levels. First an arm: on/off, P, D, feedforward, I, windup. Then the launcher's flywheel: velocity feedforward, recovering between shots, and a limited integral for worn wheels. Then stretch levels on the arm: a noisy encoder, battery brownout, taking hits, a sticky gearbox and a full match.

Everything runs in the browser. Python runs in Pyodide; C++ compiles with clang compiled to WebAssembly and runs as WebAssembly. Monaco gets errors as you type, completion and hover from basedpyright and clangd, both running in workers. There is no backend.

Built with TanStack Start, Tailwind CSS v4 and shadcn/ui, using the RIFT design system from rift-web (tokens, type, components, the Arena theme).

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`pnpm dev` first runs `scripts/sync-tools.mjs`, which copies the toolchains into `vendor/` (gitignored). The dev server serves that folder at `/vendor`. Production loads the same files from the CDN, `https://cdn2.evanyu.dev/learn-pid/` (see [Toolchains on the CDN](#toolchains-on-the-cdn)), so they aren't part of the build:

| What | Size |
|---|---|
| Pyodide (Python runtime) | 15 MB |
| basedpyright worker (Python language server) | 18 MB |
| clang (`@yowasp/clang`): its 75 MB wasm and 30 MB header tar, gzipped | 26 MB |
| clangd: its JS glue, and its 126 MB wasm gzipped | 24 MB |

The three big binaries are stored gzipped, 231 MB down to 50 MB. The compiler and clangd workers inflate them in the browser with `DecompressionStream`. The first sync downloads clangd from clangd-in-browser, checks its sha256, and caches it in `node_modules/.cache`.

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm check` (Biome).

Picking a language on the landing page downloads its runtime and language server, with a progress bar in the card, and opens the lesson once they're running. They stay loaded while the student moves between levels. A returning student's language starts downloading as soon as the landing page opens.

Add `?instructor=1` to any level URL to unlock every level and show the Answer button. `?instructor=0` turns it off.

Typing the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) anywhere outside the editor shows a small wrench button in the bottom right; typing it again hides it. The button opens dev tools: a switch for instructor mode, Pass all and Reset (with a confirm) for progress, whether the page is cross-origin isolated, and the toolchain versions.

## Tests

`pnpm test` runs two suites with vitest:

- `tests/levels.test.ts` runs every level's solution, starter and common wrong answers through the real toolchains (Pyodide and clang, in Node), in both languages. Solutions must pass every variant, starters must fail, and each wrong answer must get its expected coach message. Run it after changing anything in `src/sim` or `src/levels`. The first run takes a minute or two while Node compiles clang; after that, about 10 seconds.
- `tests/sim.test.ts` checks the arm and flywheel physics, clipping, noise determinism, brownout, hopper refills, shots and metrics.

Browser smoke tests need a running server and Playwright's Chromium (`~/Library/Caches/ms-playwright`, or set `CHROME_PATH`):

```bash
node scripts/smoke-start.mjs http://localhost:3000    # landing page download flow, header, steady legend
node scripts/smoke.mjs http://localhost:3000          # level 1 in both languages, plus live errors and completion
node scripts/smoke-errors.mjs http://localhost:3000   # syntax errors, crashes, infinite loops, printf
node scripts/smoke-levels.mjs http://localhost:3000   # every level's answer, both languages
```

## How it works

- `src/sim/` is the physics and the metrics, in plain TypeScript. It runs in the workers and in the tests. `simulate.ts` is the shared loop: it calls the student's controller every 5 ms (200 Hz), clips to the 24 V battery, adds sensor noise and brownouts, and steps a plant every 1 ms. The plants are `arm.ts`, the usual feedforward model `volts = kG·cos(angle) + kV·velocity + kA·acceleration`, and `flywheel.ts`, `volts = kV·speed + kA·acceleration` in RPM, where each projectile costs the wheel some speed. `robot.ts` has the shared constants and how each mechanism is described to students.
- `src/levels/` defines the levels: story, goal, hints, simulation settings, hidden test variants, starter code and solutions in both languages, wrong answers, the pass check and level-specific coaching.
- `src/coach/grade.ts` turns runs into a verdict and a plain-English message.
- `src/runtimes/` runs student code. Python: one worker with Pyodide (`python/`). C++: a compiler worker that keeps clang loaded and a disposable runner worker that's killed if the code never returns (`cpp/`). The harness files are shared with the tests.
- `src/editor/` is Monaco and the language servers. `monaco-core.ts` loads only the editor plus the C++ and Python grammars. `lsp/client.ts` is a small LSP client scoped to one language, covering diagnostics, completion, hover, signature help and go to definition. `lsp/clangd.worker.ts` runs clangd and feeds its stdin.
- `src/runtimes/prepare.ts` downloads and starts a language's runtime and language server before a lesson, and reports progress to the landing page.
- `src/routes/` are the pages: `/` and `/level/$levelId`. The level page is client-only (`ssr: false`).

### Cross-origin isolation

clangd is multi-threaded and Pyodide's interrupt uses SharedArrayBuffer, so every response needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They're set in three places: `src/start.ts` for server-rendered pages, `nitro({ routeRules })` in `vite.config.ts` for static files in production, and `server.headers` in `vite.config.ts` for dev.

## Deploy

`pnpm build` produces a Nitro server in `.output/`. Pick the host with a Nitro preset, the same as rift-web: `NITRO_PRESET=vercel pnpm build`, or `cloudflare_module` for Cloudflare Workers (not tried yet).

Before deploying to Vercel, run `node scripts/check-vercel.mjs`. It checks two things that broke in production:

- **Headers on static files.** It replays Vercel's first-match routing from `.vercel/output/config.json` and checks that every script, wasm file and page gets COOP and COEP. Nitro's own cache rule for `/assets` matches first, so `vite.config.ts` repeats the headers on `/assets/**`. Without them, worker scripts are blocked (`blocked:COEP-framed-resource-needs-coep-header`) and Python and C++ fail with "The worker crashed." Browsers cache `/assets` as immutable for a year, headers included, so after the fix the worker files got a new name pattern (`worker.rolldownOptions` in `vite.config.ts`) to force fresh copies. If worker headers ever change again, change that pattern too.
- **The server function.** It copies the built function to a temp folder, away from the project's `node_modules`, and requests a few pages, so a package missing from the function fails there instead of in production.

Monaco and the language servers must stay out of the server bundle. `clientOnly()` in `vite.config.ts` replaces `src/editor/monaco.ts` and `src/editor/lsp/servers.ts` with stubs in the server build. Without it, the bundler put shared helpers in the language-server chunk, every server render loaded that chunk, and Vercel failed with `Cannot find module 'vscode-jsonrpc'`. Keep editor and language-server code behind those two modules, and import them only dynamically.

### Toolchains on the CDN

Production loads Pyodide, basedpyright, clang and clangd from `https://cdn2.evanyu.dev/learn-pid/`: the `learn-pid/` folder of the R2 bucket `cdn`, in the "Redux - O4 Labs" Cloudflare account. The bucket also serves `cdn.badbird.dev`. The Vercel deploy is 5.6 MB without them. `src/tools.ts` picks the URL: the CDN in production, `/vendor` in dev, or `VITE_TOOLS_URL` if set.

When a tool version changes, upload before deploying the app:

```bash
pnpm tools:upload     # sync vendor/, then upload what changed (uses wrangler's login)
pnpm tools:check      # every file on the CDN: size, type, immutable caching, CORS
```

The upload runs `wrangler r2 object put` with your `npx wrangler login`; in CI, set `CLOUDFLARE_API_TOKEN` instead. Paths include the tool version, so objects never change after upload. Each one gets `Cache-Control: public, max-age=31536000, immutable`, and files already up with the same size and headers are skipped.

Cloudflare's edge caches the `.gz`, `.js` and `.zip` files. It doesn't cache `.wasm` by default, so `pyodide.asm.wasm` comes from R2 on every request. A Cache Rule on `cdn2.evanyu.dev/learn-pid/*` (eligible for cache, respect origin TTL) would fix that.

The bucket's CORS policy (`scripts/r2-cors.json`, set with `pnpm tools:upload --cors`) lets any origin GET and HEAD. It applies to the whole bucket, `cdn.badbird.dev` included. The page is cross-origin isolated, so the browser blocks a cross-origin file without a CORS header. Two tools needed changes to load from another origin:

- **clangd** starts its threads as workers from its own script, and a worker can't start from another origin. The clangd worker fetches `clangd.js`, loads it from a blob URL, and passes that blob to its threads (`mainScriptUrlOrBlob`).
- **The download badges** on the landing page can't ask the HTTP cache about another origin (`only-if-cached` is same-origin only), so localStorage remembers which tool versions this browser has downloaded.

Download sizes per student: Python is about 10 MB. C++ is about 50 MB compressed: clang 26 MB, clangd 24 MB. Ask students to open the site and pick their language before the workshop, on good wifi.

## Open TODOs

- **clangd binary.** `sync-tools.mjs` downloads the clangd 21.1.0 build published by [clangd-in-browser](https://github.com/Guyutongxue/clangd-in-browser) (MIT), pinned by sha256. For production, build our own with `scripts/clangd/build.sh`, adapted from theirs. The script hasn't been run here; it takes an hour or more.
- **Offline.** Picking a language warms the browser's HTTP cache. A service worker that caches the toolchains would make the site survive a dead venue network.
- **Deploy target.** Running on Vercel. For Cloudflare Workers, try the preset and check that the headers from `routeRules` reach static files there.
- **Browsers.** Tested in Chromium. Check Safari 15.2+ and Firefox, and C++ on the weakest Chromebook you have: clangd reserves 2 GB of memory.
- **Fonts.** The Widescreen files come from rift-web and are trial versions. The licence TODO from rift-web applies here too.
- **Narrow screens.** The layout stacks below 1280 px but isn't designed for phones.

## Credits

The idea comes from [PID Playground](https://pid-playground.rishaan.cc/) by Rishaan, which teaches tuning with sliders. This site has students write the controller instead. No code was ported. The clangd stdin plumbing follows clangd-in-browser by Guyutongxue (MIT).
