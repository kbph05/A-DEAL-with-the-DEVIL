# A DEAL with the DEVIL

## Build and run

Needs **Node.js 20+** (`node -v` to check).

```
git pull                 # get the latest
npm install              # install dependencies (first time, or after package.json changes)
```

| Command | What it is for |
| --- | --- |
| `npm run dev` | Dev server in **test mode** (`vite --mode test`): game UI plus the test tools (Devil lab with stub/HTTP toggle, autoplay button, F12 console commands). Add `?seed=abc` for a fixed map. |
| `npm run game` | Dev server (test mode) that opens the **game scene** straight away: `/world.html`, a character walking around a tile map. WASD/arrows or the touch stick. See [docs/world.md](docs/world.md). |
| `npm run build:game` / `npm run preview:game` | Build the game scene as a static bundle (the same test build as `build:test`, into `dist-test/`), then serve it and open `/world.html`. |
| `npm run build:test` | The test-mode bundle (game UI plus test tools, and both lab pages) in `dist-test/`. `npm run preview:test` serves it. |
| `/fight.html` (test builds) | **Fight lab**: the realtime 2D fight on its own (pick act and boss, play, see the `FightResult`). The lab page is not in the final build; the fight itself is (fight nodes play it). See [docs/fight.md](docs/fight.md). |
| `/world.html` (test builds) | **World lab**: the game scene on its own: a seeded tile map (or a Tiled map with `?map=`), seed box and Regenerate, and the tile under the player. Not in the final build yet; nothing in the game uses it so far. See [docs/world.md](docs/world.md). |
| `npm run build` | **Final** bundle in `dist/`: game UI only. The lab, autoplay and console are tree-shaken out (`import.meta.env.MODE` check in `src/main.ts`), not hidden. The devil is the HTTP backend at `VITE_DEVIL_URL` (set at build time, e.g. `VITE_DEVIL_URL=https://example.com/deal npm run build`), or the built-in StubDevil if unset. `npm run preview` serves it. |
| `npm run mock:devil` | Mock backend on `localhost:8787/deal` (StubDevil replies, `?chaos=1` for junk, `?delay=ms`) for testing the HTTP devil without Gemini. Contract: [docs/devil-api.md](docs/devil-api.md). |
| `npm test` | Unit tests (network-free except the HttpDevil test, which starts the mock on a random local port). |

To share a build, upload the contents of `dist/` to itch.io (HTML game) or GitHub Pages.

**Test UI.** `src/ui/` is a plain DOM front end over the headless engine: a **Game** column (situation, your choices (action buttons plus the act's map as a clickable DAG: click a bright node to move), the devil's offer card, the outcome of the last move, collapsed history) and, in test builds, a separate **Run & dev tools** column (seed, raw state, autoplay, Devil lab). It calls exactly the same engine functions as the console (`go`, `fight`, `deal`, ...) through one shared `Session`, so it doubles as a check that the engine API is enough for the real UI. In test builds the **Devil lab** sends the current game's real state and context to the backend URL and shows request, raw response, latency and the sanitized deal side by side.

**Changing game rules or balance?** The equivalence test replays 700 recorded runs and fails on any behaviour change. After an *intentional* change, run `npm run fixtures` and commit the updated `src/game/__fixtures__/engine-runs.json` (and `contract-current.json`). Never regenerate `contract.json`: it is the frozen JSON contract and must keep passing.

Phaser 3 + Vite + TypeScript. `src/main.ts` boots the plain-DOM game UI (`src/ui/`). Fights are the realtime Phaser fight (`src/fight/`, [docs/fight.md](docs/fight.md)), which loads lazily on the first fight. The game scene (walking around a tile map, `src/world/`, [docs/world.md](docs/world.md)) is being built on its own lab page; keyboard and touch-stick input shared by both is in `src/input/`. Test builds also install the console layer.
Console (F12, test builds; same run as the page): `help()`, `look()`, `go(1)`, `fight()`, `rest()`, `train()`, `buy("heal")`, `deal("text")`, `accept()`, `refuse()`, `map()`, `newgame("abc")`. `?seed=abc` fixes the run.
The engine is headless and stateless: the whole run is one JSON `GameState`, and the pure `step(state, command)` returns `{ ok, state, events, actions, awaiting? }` (`src/game/state-machine.ts`; [docs/engine.md](docs/engine.md)). `createGame()` wraps it as a `Game` whose commands return `{ ok, events, state }` as before; `npm run play -- --json --state` shows every step, including the legal `actions`. For automated play use `await autoplay("abc")` (full event log) or `await simulate(200)` (outcome counts); both also run in Node tests.
Devil: `StubDevil` by default; kbph's Gemini client plugs in via `setDevil()` in `src/game/devil.ts`. Phaser scene (`src/scenes/MapScene.ts`) is kept but not imported (the old Phaser `main.ts` is in git history).
