# The play page (`src/play/`, `/`, `index.html`)

The game as one screen: the scene for the current node, the HUD over it, the act map when it is open or forced, the devil's full-screen overlay, and an ending card. It strings together the pieces that already existed on their own lab pages: the world scene (docs/world.md), the forest fight (docs/fight.md), the map scene (docs/mapscene.md) and the HUD (docs/hud.md). Every engine command goes through one shared `Session` (src/game/session.ts), as in the DOM UI.

kbph asked for it (4 Oct): "create a button that opens the map and allows the player to move to the next zone. if the player is in a village, they can leave to the next stage whenever they want by using the map to go to the next node. if they are at a campfire, well, or finished fight scene the map automatically opens and the player must select the next node to travel to."

## Running it

| Command | What it does |
| --- | --- |
| `npm run game` (or `npm run dev`) | Dev server (test mode) that opens `/`, the play page. |
| `npm run build` / `npm run preview` | **The production build** into `dist/`: the play page as the site's entry (`index.html`), nothing else. |
| `npm run build:game` / `npm run preview:game` | The test build into `dist-test/`, then serve it and open `/`. |
| `npm run classic` | The old DOM UI with its dev tools (`/classic.html`, test builds only). |
| `npm run world` | The world lab (`/world.html`). |

Query string:

- `?seed=abc` fixes the run's seed.
- `?god=1` (test builds only) plays fights with 9999 HP and 99 attack. Only the request handed to the fight is changed. The engine's `sanitizeFightResult` clamps the reported HP back to your real HP, so a god fight costs nothing and changes nothing else. The production build ignores the flag (the code is compiled out, `import.meta.env.MODE`).

The devil is the StubDevil, or the HTTP devil when the build sets `VITE_DEVIL_URL` (the same switch as `src/main.ts`).

## The flow

Each node kind has a screen:

| Node | Screen | The map |
| --- | --- | --- |
| Village | The village scene (walk, shop at the stalls). | A **Map** button (top right, or the M key) opens it. Walking into the "Leave the village" exit opens it too. Here it can be closed again (Close map, Escape, M) to keep shopping. Picking a pulsing node goes there. |
| Fight, boss | The forest path, with the realtime fight (`runForestFight`) started on arrival. | **Forced** after a won fight. A revival shows "Fight on" (same enemy, the HP it was left on). A death goes to the ending card. |
| Campfire | A panel over a dim backdrop: **Rest** (heal 40% of max HP), **Sharpen Weapon** (+1 attack) or **Deal**. One of three: the engine locks the others once you pick. | **Forced** once the choice is resolved: rested, trained, or the deal accepted, refused or ended. Ended means the asks ran out with no offer standing, or you walked away after asking. Walking away before asking just returns to the three choices. |
| Well | A panel: **Buy a blessing** (8g, once per well), **Deal** (only when the engine says the devil is there, `devilPresent`), and **Move on**. One choice per well: once the blessing is bought, Deal is disabled with its reason, and once the devil is asked, the blessing is (docs/engine.md). | **Forced** after Move on. |
| Deal | The devil's full-screen overlay. | **Forced** once the deal is accepted, refused or ended, or you walk away. |
| Stairs, final door | Reached through the map. The stairs lead to the next act's first node. The final door ends the run. | |
| Run over (win, hell, lose) | An ending card with **Play again** (a new run). | None. |

**A forced map** has no close button, and Escape and M do nothing: the player must pick the next node. A "Choose where to go next" line says so.

**The map is never forced or open** while the devil is speaking, an offer is on the table (accept or refuse it first), an enemy blocks the way, or a fight is on.

**The devil's opening offer:** when the devil appears (a deal node, a well where he sits, or Deal at a campfire) the page asks for his opener at once (`wantsOpener` in `flow.ts`, from the engine's `opening`), so his overlay opens with an offer tailored to your state. It is free; accept it, refuse it, or type a wish to counter (that counts as a question). At a well, refusing it sends him away and the blessing is still yours to buy.

**The devil's overlay** is the same at deal nodes, campfires and wells. It is a dark full-screen panel with:

- the devil's line: his offer's dialogue, his strike if he lashed out, "Well? Name your wish.", or "I have heard enough from you this run.";
- the offer's effects, curse and rewrite as chips;
- "Questions left this run" and the asks left at this node;
- a wish box with **Ask**, which becomes **Haggle** while an offer stands;
- **Accept** / **Refuse** while an offer stands, and **Walk away** otherwise.

**Ask** runs the engine's devil round trip through `Game.deal(text)`: ask, await the devil, `devil_reply`. Nothing else can be pressed while he considers.

**Results** of every command (a buy, a fight, a deal) show for a few seconds as a toast near the top, in the engine's own words (`describe`). The devil's offers and strikes show in his overlay instead.

**Layers**, bottom to top:

1. the scene (the village, the fight's own Phaser game, or a dim backdrop with the node's map icon);
2. the map;
3. the HUD (hidden while a fight is on screen; the fight draws its own);
4. the Map button and the shop prompt;
5. the campfire and well panel;
6. the devil's overlay;
7. the ending card;
8. the toast.

## The controller (`flow.ts`)

`flow(view, local) → { screen, map: "closed" | "open" | "forced", mapButton, devil, prompts, ending }` is pure and has no DOM. It reads only the engine's `View` and a few local flags (`Local`): `mapOpen` (village), `movedOn` (well), `talking` and `walkedAway` (the devil's overlay), and `busy` (the devil's reply or a fight on screen). The flags are bound to the node they were set at (`at`), so moving resets them. Prompts are filtered by the engine's legal `actions`, so the page never offers something the engine would reject.

`src/play/flow.test.ts` (in `npm test`) covers every rule above:

- the village's optional map;
- the map forced after a campfire choice (each way it resolves), after Move on at a well, after a won fight, and after a deal node is accepted, refused, ended or walked away from;
- opening and closing the devil's overlay at a campfire and a well;
- no map while the devil is speaking, an offer stands or a fight is pending;
- the endings.

A property test plays 150 random legal runs on the real engine. At every state it checks that an open or forced map always has a legal `go`, that the map is never open while something blocks the way, and that every prompt is legal.

## Files

| File | What it is |
| --- | --- |
| `flow.ts` | The controller. Pure. |
| `flow.test.ts` | Its tests. |
| `play.ts` | The page: mounts the layers, runs commands through the session, renders from `flow`. |
| `play.css` | The page's styles. Portrait screens keep the prompt clear of the HUD's item column and put the map title and toast under the stats. Short landscape screens (a turned phone) put the map title under the stats on the left, off your node. |
| `/index.html` | The entry, in production and test builds alike (it loads `play.ts`). The old `play.html` is gone; the old DOM UI is `classic.html`. |

Test builds expose `window.__play`: `{ session, flow(), local(), view(), map(), zone(), toast(), send(cmd) }`. `map()` is the map scene's `debug()` while it is up.

The visual check (Playwright) plays seed `play-8` from the village through a fight, a campfire, a deal node and a well, at 1366×768 and 390×844, with `?god=1`. A second run loses a fight on purpose: the revival, "Fight on", death, the ending card and Play again.

## The main build (done)

`index.html` is the play page: it mounts `src/play/play.ts` into `<main id="play">`. `npm run build` therefore ships the play flow as the site's entry, and `dist/` holds only that page, its CSS, the main chunk and the lazily loaded fight chunk (Phaser).

- The test-only parts are behind `import.meta.env.MODE === "test"` and are compiled out of `dist/`: `?god=1` and `window.__play`. The lab pages (fight, world, hud, map) are test inputs only, so they are not in `dist/` either. Check with `grep -rl "__play\|god" dist/`, which should print nothing.
- `VITE_DEVIL_URL` picks the HTTP devil (`VITE_DEVIL_URL=https://example.com/deal npm run build`); without it the StubDevil plays.
- The old plain-DOM UI is `classic.html` (`src/main.ts`, `src/ui/`), listed in the test inputs of `vite.config.ts`: `npm run classic`, or `/classic.html` in `dist-test/`. It is not in the production build. Its dev tools (console commands, devil lab) stay with it.
- The play page does not load the DOM UI's dev tools.

## Not done yet

- **Campfires and wells** have no walking scene, only panels over a dim backdrop (kbph, 4 Oct). Deal nodes have no table scene behind the overlay.
- **The map is its own Phaser game,** mounted when it opens and destroyed when it closes. One shared Phaser game would be lighter (docs/mapscene.md, "Wiring it into the game"). Each teardown (the map, a fight, the village) goes through `destroyGame` (`src/destroyGame.ts`), which also releases the game's WebGL context, so a long run no longer piles up contexts (Chrome warned "Too many active WebGL contexts" after about 16). One shared game is not a simple swap: the map is drawn over the live village, and the scenes use different scale modes, physics and input settings.
- **No save or resume** across reloads.
