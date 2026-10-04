# The world scene

This is the game scene: a character who walks around a **scene**. It lives in `src/world/` and runs on its own on the world lab page (`/world.html`, test builds only). It is not wired into the game yet: `src/main.ts` doesn't import it, so the final build (`npm run build`) doesn't contain it.

## The scene model

This is the designer's model (Big Chungus, asked for by kbph, 4 Oct):

- **A scene is one large texture,** not a tile map.
- **The playable region is a rectangle** (`bounds`). The player's feet can't leave it. It is not the texture size: the texture can show sky, walls or forest around it.
- **A foreground overlay texture** (optional) is drawn over everything that walks, for tree canopies, roof edges, arches and so on.
- **Draw order:**
  1. the scene texture (depth 0);
  2. the actors and the player, sorted by foot height every frame (the lower the feet, the further in front);
  3. the overlay;
  4. the lab's debug outlines.
- **Zones** are rectangles that report when the player's feet enter and leave them. They replace door tiles: an `"exit"` zone is the hook for leading to a node of the act map later; a `"shop"` zone sells one engine ware (its `item`); a `"trigger"` is anything else.

## SceneDef

A scene is plain JSON data (`SceneDef` in `src/world/scene.ts`). Coordinates are world pixels: (0, 0) is the background's top-left, and an actor's `x, y` is its feet.

```json
{
  "id": "crossroads",
  "size": { "w": 960, "h": 540 },
  "background": "scene-crossroads-bg",
  "overlay": "scene-crossroads-overlay",
  "bounds": { "x": 64, "y": 200, "w": 832, "h": 300 },
  "spawn": { "x": 480, "y": 440 },
  "zones": [
    { "id": "road-north", "x": 432, "y": 200, "w": 96, "h": 28, "kind": "exit", "label": "Road north" },
    { "id": "shrine", "x": 96, "y": 220, "w": 120, "h": 70, "kind": "trigger", "label": "Shrine" }
  ],
  "actors": [
    { "id": "devil", "x": 480, "y": 330, "label": "DEVIL" },
    { "id": "signpost", "x": 300, "y": 380, "texture": "/art/signpost.png" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique name. It also names the private art folder, `scenes/<id>/`. |
| `size` | The texture's size in world pixels. The background and overlay are stretched to it. The camera stays inside it. |
| `background`, `overlay` | A Phaser texture key or an image URL (anything with a `/` or an image extension). `overlay` is optional. |
| `bounds` | The playable rectangle. It must lie inside `size`. |
| `spawn` | Where the feet start. It must lie inside `bounds`. |
| `zones` | Optional. `id`, a rectangle, `kind` (`"exit"`, `"trigger"` or `"shop"`, default trigger), an optional `label`, `node`, a free-form link to an act-map node for later, and `item`, the engine item id a shop sells (`"heal"`, `"blade"`, `"blessing"`; required when `kind` is `"shop"`). |
| `actors` | Optional. `id`, the feet position, an optional `texture` (key or URL) and `label`. With placeholder art the label is drawn as a small sign above the actor. |

**Validation.** `sceneErrors(raw)` returns every problem as a readable message. `parseSceneDef(raw)` returns the scene or throws one `Error` listing them all. It checks:

- all numbers are finite, and `size`, `bounds` and the zones have an area;
- `bounds` lies inside `size`, and `spawn` lies inside `bounds`;
- zone and actor ids are unique;
- a shop zone has an `item`;
- a zone touches `bounds` (otherwise it can never be entered);
- actors stand inside `size` (they may be outside `bounds`: shopfronts on the edge).

**The samples** are in `src/world/scenes/`: `village.json` (960×540, the default: the first entry of `SCENES`; see "The village and shop zones" below), `crossroads.json` (960×540: the devil, a signpost, two exits and a shrine) and `chapel.json` (1600×900, bigger than the view, so the camera scrolls and clamps). To add one, drop a JSON file there and list it in `scenes/index.ts`. The lab can also load any SceneDef JSON by URL (see below).

## The village and shop zones

kbph (4 Oct): the village scene, the one the game starts with, contains the shops. Act 1 always starts on the village node, where the engine sells **heal** (10g, +12 HP) and **blade** (15g, +1 attack); **blessing** (8g, one of +3 max HP, +1 attack or +8 HP) is sold at **wells** only.

`src/world/scenes/village.json`:

- **Shops are on the edge, in a line** (kbph, 4 Oct: "shops shall be on edges, like a line; outside of walkable area so you can't walk through them"). Three stalls, as actors `stall-healer`, `stall-smith` and `stall-shrine` (labelled "Healer", "Smith" and "Shrine"), stand in an evenly spaced row (x = 280, 480, 680) with their feet just above the top edge of `bounds` (y = 148; the rectangle starts at 150), so the stalls are outside it and can't be walked into or through. Two cottages (`house-west`, `house-east`) flank the row.
- In front of each stall, inside `bounds` and touching its top edge, a zone `{ "kind": "shop", "item": "heal" | "blade" | "blessing", "label": ... }`. Walk up to the edge in front of a stall and its prompt opens.
- An exit zone `leave` ("Leave the village") on the east edge, the spawn in the middle (480, 390), the usual canopy overlay.
- Actors outside `bounds` are allowed by the validator (it only checks them against `size`). Zones must still touch `bounds`, and the spawn must lie inside it.
- The placeholder background gives a stall or cottage that stands outside `bounds` a small grass clearing (`sceneTiles`), instead of leaving it in the forest.

`src/world/shopZone.ts` is the glue, pure and tested:

```ts
shopPrompt(zone, game.view()) // → { title, price, desc, enabled, reason?, command? }
```

- `enabled` is true exactly when the engine's legal `actions` contain `{cmd:"buy", item: zone.item}`. Then `command` is that command.
- Otherwise `reason` says why: "Not enough gold: need 15g, you have 10g", "Only sold at a well, not in the village", "Not at a shop (this is a fight node)", "The well has given what it will give", "The run is over", "The devil is speaking".
- So at the village the Shrine stall is always disabled: the engine's rules (unchanged) sell blessings at wells. If the team wants it buyable here, that is an engine change (`legalActions` and `rejection`).
- `exitPrompt(zone)` is "Leave the village (map: coming soon)".

**In the world lab** (`dev.ts`): walk into a stall's zone and a prompt appears at the bottom: item, price, effect and a Buy button (E or Enter also buys). Buy sends the command with `game.step`, shows the engine's result text (`describe` of the events, e.g. "Bought blade for 15g: Attack +1."), and updates the HUD and the prompt. Leaving the zone hides it. The HUD's own item bar buys too, through the same path. A new run has 10 gold, so only the Healer is affordable; use `?gold=40` to try the Smith.

**Wiring `buy` in the real game scene** (kbph): the same pieces, with the session's game instead of the lab's:

```ts
import { mountScene, sceneById } from "./world";
import { shopPrompt, exitPrompt } from "./world/shopZone";
import { mountHud } from "./hud/hud";
import { hudModel } from "./hud/model";
import { describe } from "./game";

const hud = mountHud(stage, { onUseItem: (item) => item.command && send(item.command) });
let here: SceneZone | null = null;
const render = () => {
  hud.update(hudModel(game.view()));
  if (here?.kind === "shop") showPrompt(shopPrompt(here, game.view())); // your DOM: title, price, desc, Buy disabled with reason
};
const send = (cmd: Command) => { const r = game.step(cmd); showResult(r.events.map(describe).join(" ")); render(); };

mountScene(stage, {
  scene: sceneById("village"),
  onEnterZone(zone) {
    if (zone.kind === "shop") { here = zone; render(); }
    if (zone.kind === "exit") { /* later: open the map, or game.step({ cmd: "go", n }) */ }
  },
  onLeaveZone(zone) { if (here?.id === zone.id) { here = null; hidePrompt(); } },
});
// Buy button, E or Enter: const p = shopPrompt(here, game.view()); if (p.enabled) send(p.command!);
```

Call `render()` after every engine command (moves, fights, deals), not only buys, so the prompt's enabled state and the HUD stay current. Don't pre-check gold yourself: `shopPrompt` reads the engine's own legal actions.

## Files

| File | What it is |
| --- | --- |
| `index.ts` | Public API: `mountScene(parent, options)`, and `mountWorld`, its old name. |
| `scene.ts` | `SceneDef`, validation, the y-sort depth (`footY`, `actorDepth`, `overlayDepth`), `clampToBounds`, zones (`zonesAt`, `zoneChanges`, `ZoneTracker`) and art precedence (`artSource`). Pure. |
| `scenes/` | The sample scenes (JSON) and `SCENES` / `sceneById`. The first, the village, is the default. |
| `shopZone.ts` | `shopPrompt(zone, view)`: what a shop zone's prompt shows and whether Buy is enabled, from the engine's legal actions; `exitPrompt(zone)`. Pure. |
| `WorldScene.ts` | The Phaser scene: background, y-sorted actors and player, overlay, Arcade physics, cameras, keyboard and touch. |
| `scenePlaceholders.ts` | Placeholder background, overlay and actor art, in the generated pixel-art style. The tile grid and canopy layout are pure. |
| `logic.ts` | Walking speed and smoothing (`stepVelocity`), 4-way facing (`facingOf`), the screen layout (`worldLayout`). Pure. |
| `textures.ts` | The generated pixel art: the 16×16 tileset and the hero sheet. |
| `assets.ts` | The private art hook for the player sheet (see "Art" below). |
| `tiles.ts`, `gen.ts`, `tiled.ts` | The old tile model, kept as pure, tested code (see "The tile code" below). |
| `dev.ts` + `/world.html` | The world lab. |
| `scene.test.ts`, `shopZone.test.ts`, `world.test.ts` | Node tests (part of `npm test`). |

Shared with the fight: `src/input/dir.ts` (keyboard and stick to a unit direction) and `src/input/stick.ts` (`FloatingStick`, the hand-written touch joystick).

## Public API

```ts
import { mountScene, sceneById } from "./world";
const view = mountScene(el, {
  scene: sceneById("crossroads"),               // any SceneDef; checked with parseSceneDef
  onEnterZone(zone, scene) { /* zone.kind === "exit" → later: go to zone.node */ },
  onLeaveZone(zone, scene) { },
  speed: 80,                                     // optional, px/s
});
view.scene;            // the SceneDef in use
view.setOutlines(true) // dev: draw the bounds, zones and feet box
view.destroy();        // removes the game and its canvas
```

Other options:

- `zoom`: integer camera zoom, default 2;
- `touch`: force the stick on or off;
- `outlines`: start with the outlines on;
- `onDebug(debug)`: the live, read-only state (`pos`, `footY`, `zones`, `depth`, `art`, `bounds`, `facing`, `frames`, ...).

**Zones.** They are tested against the centre of the player's feet box. `onEnterZone` fires once per entry and `onLeaveZone` once per exit. Overlapping zones each fire. Spawning inside a zone fires nothing, so arriving through an exit doesn't bounce you straight back. This is the hook for linking scenes to act-map nodes later; it is not wired into the engine yet.

`mountWorld(parent, options)` still works: it is the same function. The tile-map options (`seed`, `map`, `size`, `onEnterTile`, `showTile`) are gone, because nothing outside the lab used them.

## How it works

- **Depth.** Every frame, each actor gets depth `10 + footY`, where `footY = y + displayHeight × (1 − originY)`. Actors have origin (0.5, 1), so `y` is the feet.
  - The player's depth key is the bottom of its feet box. With the placeholder hero that is the sprite's bottom. The private sheet's feet sit higher in its frame, so its origin is set to the feet.
  - The overlay is at `10 + 2 × size.h + 1`, above any actor.
- **Bounds.** The Arcade world bounds are `scene.bounds`, and the player has `setCollideWorldBounds(true)`. The body is the small feet box, so the feet stop at the rectangle's edge while the head can overlap what is above it. `clampToBounds` puts a spawn that is too close to an edge back inside.
- **Actors** don't collide (yet): you can walk behind and in front of them, and through them. The village shops are kept solid by standing outside `bounds`, not by a collision box.
- **Camera.** It follows the player and is clamped to the texture size. A scene smaller than the view is centred.

## Running it

| Command | What it does |
| --- | --- |
| `npm run game` | Dev server (test mode) that opens `/world.html` straight away. `npm run dev` is unchanged and still opens the test UI. |
| `npm run build:game` | Static build of the test pages into `dist-test/`. It is the same as `npm run build:test`, because the world lab is a test-build page. |
| `npm run preview:game` | Serves `dist-test/` and opens `/world.html`. |

**The lab page:**

- It opens on the **village** and runs a real engine game (`createGame(seed)` with the StubDevil) with the HUD (`mountHud`) over the scene. See "The village and shop zones".
- **Scene** picks a sample scene. Switching destroys the game and mounts a new one, so it also exercises `destroy()`.
- **Bounds and zones** draws the debug outlines:
  - the playable rectangle in yellow;
  - exits in red and triggers in blue, filled while you stand in them;
  - the feet box in white.
- The bar shows the feet, the foot y and the current zone, for example `feet (480, 443) · foot y 443 · zone none · facing down`. It also shows the last zone event, for example `Entered exit "Road north"`.
- `window.__world` exposes `{ scene, debug, events, mounts, game, prompt, result }` (`game` is the engine run, `prompt` the shop prompt on screen or null, `result` the last command's text) for the console and smoke tests. `debug` is live. `events` lists `{ type: "enter" | "leave", zone, kind, frame }`.

**Query string:**

- `?scene=chapel` picks a sample scene. `?scene=/scenes/mine.json` loads a SceneDef JSON from a URL instead, for example a file you put in `public/`.
- `&outlines=1` starts with the outlines on.
- `&touch=1` / `&touch=0` forces the touch stick on or off.
- `&speed=160` changes the walking speed; `&zoom=3` the zoom.
- `&seed=abc` sets the run seed; `&gold=40` starts the run with 40 gold (lab only, to try every stall).

## Controls

| | Desktop | Touch |
| --- | --- | --- |
| Walk (8 directions) | WASD or arrow keys | A floating stick. It re-centres where your thumb lands, anywhere on the canvas, and springs back on release. It snaps to 8 directions and has a dead zone. |

- Movement eases in and out, as before: top speed 80 px/s, about 0.1 s to reach full speed and about 0.07 s to stop (`WALK` in `logic.ts`). Diagonals are not faster.
- The player faces one of 4 ways. On an exact diagonal it keeps its current facing, so the sprite doesn't flicker. The walk animation runs while moving. Walking into the edge of the playable rectangle walks on the spot.
- The keyboard is ignored while a text box or select has focus. The arrow keys are captured so they don't scroll the page; WASD are not, so typing still works.
- **Screen.** The logical size follows the container's shape: 540 px on the short side, up to 1280 on the long side. Phaser `Scale.FIT` then scales the canvas to the container. The camera has an integer zoom (2 by default) and `pixelArt: true`, so pixels stay crisp. A second, unzoomed camera draws the stick and the help line.

## Art

There are no image files in the repo, and nothing comes from generative models. Until real art exists, the placeholders are generated pixel art, drawn in code (`scenePlaceholders.ts`):

- **Background.** The seeded tile generator (`gen.ts`, seeded by the scene id) is rendered with the placeholder tileset (`textures.ts`) into one texture of the scene's size.
  - Inside `bounds` it is ground: grass, dirt paths and stone floor.
  - Outside it is forest, walls and water.
  - Exit zones are dirt; triggers are stone floor.
- **Overlay.** It is transparent except for tree canopies: a row along the bottom edge of the playable rectangle, with gaps over exits, and one big tree inside it whose trunk is on the background. Walk under them and the player is hidden.
- **Actors.** A 16×24 robed pixel figure, coloured by actor id. Ids starting `stall-` get a 40×36 market stall (striped awning, seller, counter) and ids starting `house-` a 64×56 cottage.
- **Paths.** In a scene with shop zones, dirt paths run from the spawn along its row, then up or down to each shop and exit.
- **Player.** The 16×16 hero sheet from `textures.ts`.

### Dropping in real art

Real art replaces the placeholders automatically, with no code change. Put the files in the gitignored `public/assets/private/`:

| File | Replaces |
| --- | --- |
| `scenes/<scene id>/background.png` | The scene texture. Draw it at `size`; it is stretched to `size` if not. |
| `scenes/<scene id>/overlay.png` | The overlay. Use the same size as the background, transparent wherever nothing should cover the actors. |
| `scenes/<scene id>/actors/<actor id>.png` | One actor. Its feet are the bottom centre of the image. |
| `player-idle.png`, `player-walk.png` | The player sheet (`PRIVATE_PLAYER` in `assets.ts`, below). |

- `.webp` and `.jpg` work too.
- **Precedence** (`artSource`): a private file comes first, then the URL or texture key in the SceneDef, then the placeholder. A file that fails to load also falls back to the placeholder. `__world.debug.art` says which art is in use for each part.
- **Steps:**
  1. Add the files.
  2. Check `git status`: it must not list them.
  3. Restart the dev server, or rebuild. `vite.config.ts` lists that folder (and its subfolders) when it starts and bakes the paths in as `__PRIVATE_ASSETS__`. That way only files that exist are requested, and a clean checkout logs no 404s.
- **Never commit real art.** Art the team owns and wants in the repo can go anywhere under `public/` and be referenced by URL in the SceneDef (`"background": "/scenes/crossroads.png"`).

**The player sheet** (this is for licensed art that can't be redistributed; the team is considering **zerie's Tiny RPG Character Asset Pack**: 100×100 frames, no redistribution, so it must never be committed to this public repo):

- **`PRIVATE_PLAYER`** sets the frame size (default 100×100), the frames and fps per animation, and `layout`. Both files are needed.
- **`layout`:**
  - `"side"` is one row facing right, as in the Tiny RPG pack. Left mirrors it; up and down reuse it.
  - `"four"` is rows in the order down, left, right, up.
- **`feet`** is the collision box inside a frame, in sheet pixels. Keep it centred left to right, because of the mirroring. Its bottom is the player's foot y for the y-sort.
- **`scale`** is world pixels per sheet pixel.

**Unverified.** The frame counts (idle 6, walk 8) and the feet box (10×6 at 45,54) are guesses from the pack's description. Nobody has checked them against the actual files yet. Rename the pack's files (for example `Soldier-Idle.png` → `player-idle.png`) or change the `file` names in the spec.

**Shipping.** Vite copies everything in `public/` into the build. A build made on a machine that has the private files therefore contains the raw images. Itch.io or GitHub Pages would then host them as loose files. Check the license before deploying such a build. For a public deploy, build on a clean checkout, without the private folder.

## The tile code

The tile model is no longer the art model. The tilemap layer, tile collision, `onEnterTile` and the lab's seed box and `?map=` are gone from the runtime and the lab. The pure tile code stays, because other code and tests depend on it:

- `tiles.ts` (tile ids and lookups) and `gen.ts` (the seeded generator) draw the placeholder backgrounds, and `textures.ts` draws the tileset from `tiles.ts`;
- `tiled.ts` (the Tiled loader) is unused at runtime; it is kept with its tests in `world.test.ts` in case the designers want to paint backgrounds or zones in Tiled later.

## Next steps (not done yet)

1. **Hook it into the run.** Each act-map node gets a scene. An exit zone's `node` (or its order) picks the successor, and `onEnterZone` with `kind: "exit"` calls the engine's `go`. Fight and boss nodes start `runFight` when you meet the enemy.
2. **Solid actors and obstacles:** feet boxes for actors, and extra blocking rectangles inside `bounds` (a fountain, a table), if the designer wants them.
3. **Interactables:** trigger zones plus an "interact" button (Space on desktop, a touch button) for the campfire, well and the devil's table. The village stalls already do this (E or Enter, or the prompt's Buy button).
4. **Real art:** the designer's scene textures and overlays in `scenes/<id>/`, and the actual Tiny RPG sheets (verify the spec).
