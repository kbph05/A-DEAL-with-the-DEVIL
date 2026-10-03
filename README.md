# A DEAL with the DEVIL

## Build and run

Needs **Node.js 20+** (`node -v` to check).

```
git pull                 # get the latest
npm install              # install dependencies (first time, or after package.json changes)
npm run dev              # dev server; open the URL it prints (add ?seed=abc for a fixed map)
npm test                 # run the tests
npm run build            # production build into dist/
npm run preview          # serve dist/ locally to check the build
```

To share a build, upload the contents of `dist/` to itch.io (HTML game) or GitHub Pages.

Phaser 3 + Vite + TypeScript. **Current prototype round is console-only**: no canvas; `src/main.ts` boots `src/game/console.ts` and the page just says to open devtools.
Play in the browser console (F12): `help()`, `look()`, `go(1)`, `fight()`, `rest()`, `buy("heal")`, `deal("text")`, `accept()`, `refuse()`, `map()`, `newgame("abc")`. `?seed=abc` fixes the run.
The engine (`src/game/run.ts`) is headless: each command returns `{ ok, events, state }`. For automated play use `await autoplay("abc")` (full event log) or `await simulate(200)` (outcome counts); both also run in Node tests.
Devil: `StubDevil` by default; kbph's Gemini client plugs in via `setDevil()` in `src/game/devil.ts`. Phaser scene (`src/scenes/MapScene.ts`) is kept but not imported; see the comment in `main.ts` to switch back.
