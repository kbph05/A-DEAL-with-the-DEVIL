New here? Start with docs/OVERVIEW.md.

# A DEAL with the DEVIL

## Build and run

Needs **Node.js 20+** (`node -v` to check).

```
git pull                 # get the latest
npm install              # install dependencies (first time, or after package.json changes)
```

The build needs the dev dependencies, including **`@types/node`** (`vite.config.ts` and the tests import `node:` modules).
`npm install` brings them in, since they are listed in `package.json`. If a build fails with `Cannot find type definition file for 'node'` or `Cannot find module 'node:fs'`:
- your `node_modules` predates that entry: run `npm install` again;
- or dev dependencies were skipped (`NODE_ENV=production`, `--omit=dev`): run `npm install -D @types/node`.

| Command | What it is for |
| --- | --- |
| `npm run dev` | Dev server in **test mode** (`vite --mode test`): the play page at `/` (with `?god=1`), plus `/classic.html` with the test tools (Devil lab with stub/HTTP toggle, autoplay button, F12 console commands) and the lab pages. Add `?seed=abc` for a fixed map. |
| `npm run game` / `/` (`index.html`) | **The game as one screen** (the play page, and the entry of the production build): the village to walk and shop in, with a Map button (or M) to pick the next node; fights on the forest path; campfire and well panels; the devil as a full-screen overlay; the act map, forced once a node is done; an ending card with Play again. Same engine, one `Session`. `?seed=abc`; `?god=1` (test builds only) for huge HP in fights. See [docs/play.md](docs/play.md). |
| `npm run classic` / `/classic.html` (test builds) | The old plain-DOM UI plus its dev tools (Devil lab, autoplay, F12 console). Not in the production build. |
| `npm run build:game` / `npm run preview:game` | Build the play page as a static bundle (the same test build as `build:test`, into `dist-test/`), then serve it and open `/`. |
| `npm run build:test` | The test-mode bundle in `dist-test/`: the play page, `classic.html` (DOM UI plus test tools) and the lab pages. `npm run preview:test` serves it. |
| `/fight.html` (test builds) | **Fight lab**: the realtime 2D fight on its own (pick act and boss, play, see the `FightResult`). The lab page is not in the final build; the fight itself is (fight nodes play it). See [docs/fight.md](docs/fight.md). |
| `npm run world` / `/world.html` (test builds) | **World lab**: the game scene on its own: the village (or `?scene=forest`, or a SceneDef JSON with `?scene=<url>`), a toggle for the bounds and zone outlines, and the player's foot y and current zone. Not in the final build. See [docs/world.md](docs/world.md). |
| `/hud.html` (test builds) | **HUD lab**: the in-game HUD (HP, gold, attack, soul and revive, curses, devil questions, item bar) over a placeholder scene, on a real engine run with buttons to step it, take a hit, buy and deal. Not in the final build. See [docs/hud.md](docs/hud.md). |
| `npm run map` / `/map.html` (test builds) | **Map lab**: the Slay-the-Spire-style act map (`src/mapscene/`: parchment, pixel-art node icons, dotted paths, legend) with the HUD over it, on a real engine run: tap a pulsing node to move, the bar below has the node's other actions, plus a seed box and a bot step. Not in the final build. See [docs/mapscene.md](docs/mapscene.md). |
| `npm run build` | **Production** bundle in `dist/`: the play page (`index.html`, [docs/play.md](docs/play.md)) only. `classic.html`, the labs, `?god=1` and `window.__play` are not in it (`import.meta.env.MODE` checks, plus the test-only page inputs in `vite.config.ts`), not hidden. The devil is the HTTP backend at `VITE_DEVIL_URL` (set at build time, e.g. `VITE_DEVIL_URL=https://example.com/deal npm run build`), or the built-in StubDevil if unset. `npm run preview` serves it. |
| `npm run mock:devil` | Mock backend on `localhost:8787/deal` (StubDevil replies, `?chaos=1` for junk, `?delay=ms`) for testing the HTTP devil without Gemini. Contract: [docs/devil-api.md](docs/devil-api.md). |
| `npm run devil:oai` | **The LLM devil** on `localhost:8788/deal` (all interfaces, CORS open), over any OpenAI-compatible API. Default: llama-swap `gemma4:26b` at `http://169.254.1.3:11434/v1`. Gemini: `OAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai OAI_MODEL=gemini-2.5-flash OAI_API_KEY=... npm run devil:oai`. Then `VITE_DEVIL_URL=http://localhost:8788/deal npm run game`. The server classifies text and rolls strikes itself, prices every offer, sanitizes everything and falls back to the StubDevil on any model failure. Env vars, LAN use: [docs/devil-api.md](docs/devil-api.md#openai-compatible-backend-npm-run-deviloai). |
| `npm run assets:encrypt` / `assets:check` / `assets:keygen` | **Encrypted art** for packs we may use but not redistribute: originals in the gitignored `assets/private-src/`, encrypted with AES-256-GCM into `assets/encrypted/` using the key in `ASSET_KEY` (in `.env`, never committed). Vite decrypts them in dev and build. Without the key, the game uses the generated art. See [docs/assets.md](docs/assets.md). |
| `npm test` | Unit tests (network-free except the HttpDevil and OAI devil tests, which start local servers on random ports). |

To share a build, upload the contents of `dist/` to itch.io (HTML game) or GitHub Pages.

**Vercel** (game plus the LLM devil as `/api/deal` on the same origin): `vercel.json`, `api/deal.ts`, env vars `OAI_BASE_URL`, `OAI_MODEL`, `OAI_API_KEY`, `ASSET_KEY`; steps in [docs/deploy-vercel.md](docs/deploy-vercel.md). After changing the devil, run `npm run build:api` and commit `api/_lib/devil.mjs`.

**Classic UI.** (`/classic.html`, test builds only.) `src/ui/` is a plain DOM front end over the headless engine: a **Game** column (situation, your choices (action buttons plus the act's map as a clickable DAG: click a bright node to move), the devil's offer card, the outcome of the last move, collapsed history) and, in test builds, a separate **Run & dev tools** column (seed, raw state, autoplay, Devil lab). It calls exactly the same engine functions as the console (`go`, `fight`, `deal`, ...) through one shared `Session`, so it doubles as a check that the engine API is enough for the real UI. In test builds the **Devil lab** sends the current game's real state and context to the backend URL and shows request, raw response, latency and the sanitized deal side by side.

**Changing game rules or balance?** The equivalence test replays 700 recorded runs and fails on any behaviour change. After an *intentional* change, run `npm run fixtures` and commit the updated `src/game/__fixtures__/engine-runs.json` (and `contract-current.json`). Never regenerate `contract.json`: it is the frozen JSON contract and must keep passing.

Phaser 3 + Vite + TypeScript. `src/main.ts` boots the plain-DOM game UI (`src/ui/`). Fights are the realtime Phaser fight (`src/fight/`, [docs/fight.md](docs/fight.md)), which loads lazily on the first fight. The game scene (walking around a scene texture, `src/world/`, [docs/world.md](docs/world.md)) is being built on its own lab page; keyboard and touch-stick input shared by both is in `src/input/`. Test builds also install the console layer.
Console (F12, test builds; same run as the page): `help()`, `look()`, `go(1)`, `fight()`, `rest()`, `train()`, `buy("heal")`, `deal("text")`, `accept()`, `refuse()`, `map()`, `newgame("abc")`. `?seed=abc` fixes the run.
The engine is headless and stateless: the whole run is one JSON `GameState`, and the pure `step(state, command)` returns `{ ok, state, events, actions, awaiting? }` (`src/game/state-machine.ts`; [docs/engine.md](docs/engine.md)). `createGame()` wraps it as a `Game` whose commands return `{ ok, events, state }` as before; `npm run play -- --json --state` shows every step, including the legal `actions`. For automated play use `await autoplay("abc")` (full event log) or `await simulate(200)` (outcome counts); both also run in Node tests.
Devil: `StubDevil` by default; kbph's Gemini client plugs in via `setDevil()` in `src/game/devil.ts`. Phaser scene (`src/scenes/MapScene.ts`) is kept but not imported (the old Phaser `main.ts` is in git history).
