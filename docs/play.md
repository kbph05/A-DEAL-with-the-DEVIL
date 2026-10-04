# The play page (`src/play/`, `/play.html`)

The game as one screen: the scene for the current node, the HUD over it, the act map when it is open or forced, the devil's full-screen overlay, and an ending card. It strings together the pieces that already existed on their own lab pages: the world scene (docs/world.md), the forest fight (docs/fight.md), the map scene (docs/mapscene.md) and the HUD (docs/hud.md). Every engine command goes through one shared `Session` (src/game/session.ts), as in the DOM UI.

kbph asked for it (4 Oct): "create a button that opens the map and allows the player to move to the next zone. if the player is in a village, they can leave to the next stage whenever they want by using the map to go to the next node. if they are at a campfire, well, or finished fight scene the map automatically opens and the player must select the next node to travel to."

## Running it

| Command | What it does |
| --- | --- |
| `npm run game` | Dev server (test mode) that opens `/play.html`. |
| `npm run build:game` / `npm run preview:game` | The test build into `dist-test/`, then serve it and open `/play.html`. |
| `npm run world` | The world lab (`/world.html`), which `npm run game` used to open. |

Query string:

- `?seed=abc` fixes the run's seed (the first run only; New game on the title screen picks a new one).
- `?title=1` opens on the title screen instead of going straight into the run. Without it, first load is unchanged.
- `?god=1` (test builds only) plays fights with 9999 HP and 99 attack. Only the request handed to the fight is changed. The engine's `sanitizeFightResult` clamps the reported HP back to your real HP, so a god fight costs nothing and changes nothing else. A final build ignores the flag.

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

**The HUD** on this page is trimmed (kbph, 4 Oct): HP, gold, curses, the devil's questions (at a deal node), act, layer and node. No item buttons (the village's stalls sell), no ATK, Soul or Revive. See docs/hud.md, "Variants".

**No controls line** at the bottom of the village or the fight: the pause menu lists the controls (`help: false` to `mountScene` and `runForestFight`; the labs keep the line).

**A forced map** has no close button, and Escape and M do nothing: the player must pick the next node. A "Choose where to go next" line says so.

**The map is never forced or open** while the devil is speaking, an offer is on the table (accept or refuse it first), an enemy blocks the way, or a fight is on.

**The devil's opening offer:** when the devil appears (a deal node, a well where he sits, or Deal at a campfire) the page asks for his opener at once (`wantsOpener` in `flow.ts`, from the engine's `opening`), so his overlay opens with an offer tailored to your state. It is free; accept it, refuse it, or type a wish to counter (that counts as a question). At a well, refusing it sends him away and the blessing is still yours to buy.

**The devil's overlay** is the same at deal nodes, campfires and wells. It is a dark full-screen panel with:

- the devil's line: his offer's dialogue, his strike if he lashed out, "Well? Name your wish.", or "I have heard enough from you this run.";
- the offer's effects, curse and rewrite as chips;
- "Questions left this run" and the asks left at this node;
- a wish box with **Ask**, which becomes **Haggle** while an offer stands;
- **Accept** / **Refuse** while an offer stands, and **Walk away** otherwise.

**The devil's portrait** (Big Chungus's silhouettes, 4 Oct: `assets/devil_*.png`). He fills the space above the card, about the top half on a 1366×768 screen and a third on a 390×844 phone, with the card's top edge over his shoulders. The black silhouette reads on the dark red through a layered ember rim glow (CSS `drop-shadow`s on `.play-devil-art`). He is decorative: `aria-hidden`, no pointer events, never focused; focus lands on the card as before (the wish box with a keyboard, the first button on touch).

- **Files:** the seven PNGs are imported through Vite (`src/play/devilArt.ts`), so builds ship them as hashed files (`vite.config.ts` keeps them from being inlined). They are stacked and cross-faded (200 ms).
- **Poses** (`devilPose` in `src/play/devilPose.ts`, pure, tested in `devilPose.test.ts`). Priority, top first:
  - `laugh`, for 1.6 s: you accept a deal, he strikes, or he answers gibberish, off-topic text or a jailbreak (your wish checked with the stub's own `isGibberish` and `offTopicKind`, whichever devil answers). When the overlay closes on a laugh (an accepted deal forces the map), his portrait lingers and fades over the map, inert and click-through.
  - `head_tilt`: you are typing or haggling: the wish box has text, or you clicked or typed in it. The box the page focuses for you doesn't count, or he would never do anything else on a laptop.
  - `lean_in`, for 2.2 s: an offer lands, the opening offer included.
  - Idle: `normal`, and every 4 to 7 s a 1.3 s shift to `left`, `right` or `lean_left` in turn, then back to normal.
- **Reduced motion** (`prefers-reduced-motion`): no idle shifts, and the swaps are instant; no fade when he leaves.
- **No private override.** The old dealer placeholder and its `devil/dealer.png` hook went out with the revert in 8d890c9. To change the art, replace the PNGs in `assets/`, keeping the names.

**Ask** runs the engine's devil round trip through `Game.deal(text)`: ask, await the devil, `devil_reply`. Nothing else can be pressed while he considers.

**Credits.** The title screen (next to **New game**), the pause menu (so it is reachable from the village and anywhere else in a run) and the ending card (next to **Play again**) each have a **Credits** button. The screen shows each sprite pack's own `attribution.txt`, read at runtime (`src/render/credits.ts`) when the build has the art; without `ASSET_KEY` it says the credits need the art. Escape or **Close** closes it. Escape always closes the topmost layer first: the credits, then an open map, then the pause menu; otherwise it pauses (`pauseKey` in `pause.ts`, one ordered check). The written copy is docs/CREDITS.md.

**Results** of every command (a buy, a fight, a deal) show for a few seconds as a toast near the top, in the engine's own words (`describe`). The devil's offers and strikes show in his overlay instead.

**Layers**, bottom to top:

1. the scene (the village, the fight's own Phaser game, or a dim backdrop with the node's map icon);
2. the map;
3. the HUD (hidden while a fight is on screen; the fight draws its own);
4. the Map and pause buttons and the shop prompt;
5. the campfire and well panel;
6. the devil's overlay;
7. the ending card;
8. the toast;
9. the pause menu;
10. the title screen.

## Pause and quit (`pause.ts`)

kbph asked for it (4 Oct): "make a pause menu with what controls are used, and then remove the bottom text that shows controls. Also make the menu have a quit game option too."

- **Opening it:** Esc or P, or the pause button (two bars, 44 px) at the top right, under the Map button. In a fight it sits lower, under the fight's title, enemy count and clock. It is hidden while the devil's overlay or the ending card is up; Esc and P still work over the devil when focus is not in the wish box.
- **Escape order:** an open map (village) closes first. Then Escape pauses. In the menu it resumes, and in the quit question it goes back to the menu. A forced map can't close, so Escape pauses there. P pauses and resumes, but does nothing in the quit question. Keys typed in a text box are text, and no key works on the title screen or the ending card.
- **Pausing pauses the game:** the village's or the fight's `Phaser.Game` is paused (`game.pause()`: no update, no render, so no movement, no enemy actions and no fight clock). Its keyboard is switched off, so Space can press the menu's buttons and isn't replayed as an attack. Keys are reset on resume, so one released during the pause doesn't stick. Nothing new starts behind the menu (the auto-fight, the devil's opener); renders behind it don't take focus.
- **The menu** is a dialog (`role="dialog"`, `aria-modal`, labelled by its title) with "Paused", the keyboard and touch controls (`CONTROLS` in `pause.ts`, checked against the code), **Resume** and **Quit game**. Tab is trapped in it; focus returns where it was on Resume (in a fight, not to a button, since Space attacks).

| Keyboard | | Touch | |
| --- | --- | --- | --- |
| WASD / arrow keys | Move | Drag | The stick: anywhere in the village, the left half in a fight |
| Space / left click | Attack (fights) | Attack, Dash | The buttons at the bottom right (fights) |
| Shift | Dash (fights) | Map | The Map button, top right (village) |
| M | Open or close the map (village) | Buy | The Buy button at a stall |
| E / Enter | Buy at a stall | Pause | The pause button, top right |
| Esc / P | Pause; Esc closes the map first | | |

- **Quit game** asks "Quit this run? Progress will be lost." (Cancel, the default, or Quit game). Quitting tears the run's scenes down (a fight in progress is destroyed with its game) and shows the **title screen**: "A DEAL with the DEVIL" and **New game**, which starts a fresh run with a new seed. There is no credits screen yet, so no Credits button. Quit is the only way to the title screen, besides `?title=1`.
- `pauseStep(state, action)` and `pauseKey(state, key, context)` are pure; `src/play/pause.test.ts` covers the transitions, the key order and the controls list.

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
| `devilPose.ts`, `devilPose.test.ts` | Which devil pose shows, from the overlay's state and the clock. Pure, and its tests. |
| `devilArt.ts` | The devil's portrait: the seven PNGs, stacked and cross-faded. |
| `pause.ts`, `pause.test.ts` | The pause menu and title screen state, the key rules and the controls list. Pure, and its tests. |
| `play.ts` | The page: mounts the layers, runs commands through the session, renders from `flow`. |
| `play.css` | The page's styles. Portrait screens put the map title and toast under the stats. Short landscape screens (a turned phone) put the map title under the stats on the left, off your node. |
| `/play.html` | The entry. Test builds only (`vite.config.ts` lists it in mode `test`). |

Test builds expose `window.__play`: `{ session, flow(), local(), view(), map(), zone(), toast(), send(cmd), pause(), probe() }`. `map()` is the map scene's `debug()` while it is up. `pause()` is the pause state; `probe()` gives live positions (the village walker's feet, or the fight's player, enemies and clock), for checking that a paused game stands still.

The pause check (Playwright, like the visual check above) holds an arrow key through a pause in the village and in a fight, and checks that nothing moves for 1 s and that it moves again after Resume. It also checks the trimmed HUD, the 44 px button clear of the Map button and HUD, the focus trap, Escape closing the map first, Quit (with its question) to the title screen with no canvas left, New game on a new seed, and `?title=1`.

The visual check (Playwright) plays seed `play-8` from the village through a fight, a campfire, a deal node and a well, at 1366×768 and 390×844, with `?god=1`. A second run loses a fight on purpose: the revival, "Fight on", death, the ending card and Play again.

## Making it the main build (kbph)

The final build (`npm run build`) still has the single entry `index.html`, the DOM UI. To ship the play page instead, point `index.html` at it. Replace its body with:

```html
<main id="play" aria-label="A DEAL with the DEVIL"></main>
<script type="module" src="/src/play/play.ts"></script>
```

That is the whole swap. The rest follows from it:

- The lab flags (`?god=1`, `window.__play`) are behind `import.meta.env.MODE === "test"`, so the final build drops them.
- `VITE_DEVIL_URL` picks the HTTP devil, as before.
- The DOM UI stays in `src/ui/`. It is still reachable in test builds if you keep it under another page name, for example by copying the old `index.html` to `ui.html` and adding it to the test inputs in `vite.config.ts`.
- The play page doesn't load the test UI's dev tools (the console commands and the devil lab).

## Not done yet

- **Campfires and wells** have no walking scene, only panels over a dim backdrop (kbph, 4 Oct). Deal nodes have no table scene behind the overlay.
- **The map is its own Phaser game,** mounted when it opens and destroyed when it closes. One shared Phaser game would be lighter (docs/mapscene.md, "Wiring it into the game"). Each teardown (the map, a fight, the village) goes through `destroyGame` (`src/destroyGame.ts`), which also releases the game's WebGL context, so a long run no longer piles up contexts (Chrome warned "Too many active WebGL contexts" after about 16). One shared game is not a simple swap: the map is drawn over the live village, and the scenes use different scale modes, physics and input settings.
- **No save or resume** across reloads.
