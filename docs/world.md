# The world scene

This is the first piece of the actual game scene: a character who walks around a tile map. It lives in `src/world/` and runs on its own on the world lab page (`/world.html`, test builds only). It is not wired into the game yet: `src/main.ts` doesn't import it, so the final build (`npm run build`) doesn't contain it.

| File | What it is |
| --- | --- |
| `index.ts` | Public API: `mountWorld(parent, options) → { map, destroy() }`. |
| `tiles.ts` | Tile ids, the `WorldMap` shape, tile lookups (`tileAt`, `isBlocked`, `toTile`, `reachable`) and `parseWorldMap` for our JSON format. Pure. |
| `gen.ts` | `generateWorld(seed, { width, height })`: the seeded field generator. Pure and deterministic. |
| `tiled.ts` | `fromTiled(json)`: the Tiled JSON loader. `loadMapJson(json)` accepts either format. Pure. |
| `logic.ts` | Walking speed and smoothing (`stepVelocity`), 4-way facing (`facingOf`), the screen layout (`worldLayout`). Pure. |
| `WorldScene.ts` | The Phaser scene: tilemap layer, Arcade physics player, cameras, keyboard and touch. |
| `textures.ts` | The placeholder art, drawn in code onto canvas textures. |
| `assets.ts` | The private art hook (see "Art" below). |
| `dev.ts` + `/world.html` | The world lab. |
| `world.test.ts` | Node tests (part of `npm test`). |

Shared with the fight: `src/input/dir.ts` (keyboard and stick to a unit direction) and `src/input/stick.ts` (`FloatingStick`, the hand-written touch joystick). The fight's behaviour is unchanged; `src/fight/logic.ts` re-exports the moved helpers.

## Running it

| Command | What it does |
| --- | --- |
| `npm run game` | Dev server (test mode) that opens `/world.html` straight away. `npm run dev` is unchanged and still opens the test UI. |
| `npm run build:game` | Static build of the test pages into `dist-test/`. It is the same as `npm run build:test`, because the world lab is a test-build page. |
| `npm run preview:game` | Serves `dist-test/` and opens `/world.html`. |

**Query string:**

- `?seed=abc` fixes the map.
- `&touch=1` / `&touch=0` forces the touch stick on or off.
- `&map=/maps/x.json` loads a map file (our format or a Tiled export, for example from `public/maps/`) instead of generating one.

**The lab page:**

- The bar has a **Seed** box, with **Regenerate** (or press Enter in the box) and **New seed**.
- Regenerating destroys the game and mounts a new one, so it also exercises `destroy()`.
- The bar shows the tile under the player's feet, for example `tile (34, 27) path · facing down`. A yellow outline marks the same tile on the map.
- Entering a door prints `Entered a door at (x, y)`.
- `window.__world` exposes `{ seed, map, debug, entered, mounts }` for the console and smoke tests. `debug` is live: `pos`, `vel`, `tile`, `facing`, `input`, `art`, `frames`.

## Controls

| | Desktop | Touch |
| --- | --- | --- |
| Walk (8 directions) | WASD or arrow keys | A floating stick. It re-centres where your thumb lands, anywhere on the canvas, and springs back on release. It snaps to 8 directions and has a dead zone. |

- Movement eases in and out. Top speed is 5 tiles a second (80 px/s). It takes about 0.1 s to reach full speed and about 0.07 s to stop (`WALK` in `logic.ts`). Diagonals are not faster.
- The player faces one of 4 ways (down, left, right, up). On an exact diagonal it keeps its current facing, so the sprite doesn't flicker. The walk animation runs while moving. Walking into a wall walks on the spot.
- Collision uses a 10×6 px box at the feet, so the player fits through one-tile gaps and their head can overlap the tile above.
- The keyboard is ignored while a text box has focus. The arrow keys are captured so they don't scroll the page; WASD are not, so typing still works.

**Screen.**

- The logical size follows the container's shape: 540 px on the short side, up to 1280 on the long side. Phaser `Scale.FIT` then scales the canvas to the container.
- The world camera has an integer zoom of 3 and `pixelArt: true`, so the pixels stay crisp. About 11 tiles fit across the short side.
- The camera follows the player and stays inside the map; a map smaller than the view is centred. A second, unzoomed camera draws the stick and the help line.

## Tiles

Tiles are 16×16 world pixels. A tile id is also its frame in the tileset image.

| Id | Name | Blocks | Placeholder look |
| --- | --- | --- | --- |
| 0 | void | yes | black (outside the map, unknown ids) |
| 1 | floor | no | grey stone slabs |
| 2 | grass | no | speckled green |
| 3 | path | no | dirt |
| 4 | wall | yes | brick |
| 5 | water | yes | blue with ripples |
| 6 | door | no | wooden door in a brick frame (exits: `map.doors`) |
| 7 | tree | yes | tree on grass |
| 8 | rock | yes | boulder on grass |

The table is `TILES` in `tiles.ts`. To add a tile:

1. Append a row (the next id).
2. Draw it in `textures.ts` (`drawTile`).
3. Add it to the private tileset, if you use one.

Blocking ids go into the tilemap layer's collision automatically.

## Map format

Our own JSON format (`parseWorldMap`):

```json
{
  "width": 40,
  "height": 30,
  "tiles": [4, 4, 4, "... width * height ids, row-major: tile (x, y) is tiles[y * width + x]"],
  "spawn": { "x": 12, "y": 27 },
  "seed": "optional"
}
```

- Unknown ids become void.
- A missing or blocked `spawn` falls back to the first walkable tile.
- `doors` is worked out from the door tiles.
- A malformed map throws an `Error` with a readable message, for example a `tiles` array of the wrong length.

**Tiled** (`fromTiled`; `loadMapJson` detects it by its `layers`):

- **Map settings.** The map must be orthogonal and finite (untick "Infinite"). Save it as JSON (`.tmj`/`.json`). The tile layer format must be CSV or uncompressed Base64. Compressed layers and infinite maps are refused with a message saying what to change.
- **Layers.** All visible tile layers are merged. In each cell the topmost non-empty tile wins. Group layers are walked.
- **Which tile is which:**
  - By default, the tile's index in its tileset is our id. Draw on a tileset image in id order: the placeholder sheet, or the private `tiles.png`.
  - Otherwise, give a tile a custom property `kind` (string: `"wall"`, `"water"`, ...), or set its class to the name.
  - Several tilesets work (the one with the largest `firstgid` ≤ gid owns a tile). Flip bits are ignored.
- **Spawn.** Use an object named, typed or classed `spawn` in any object layer (a point or a rectangle; tile objects work too).

**The generator** (`gen.ts`, default 40×30 tiles):

- A wall border, grass inside, and the spawn near the bottom.
- A door in the top wall, and in 3 of 4 maps a second door in a side wall.
- Winding dirt paths from the spawn to every door.
- 2 or 3 ponds, a ruined stone room (floor inside, crumbled gaps, a doorway), and scattered trees and rocks.
- Paths and the spawn are never covered. The tests check, over 300 seeds and two sizes, that every door is reachable from the spawn and that the border is closed.
- It uses the same seed hashing and mulberry32 as the act map and the fight.

## Public API

```ts
import { mountWorld } from "./world";
const world = mountWorld(el, {
  seed: "abc",                           // or map: loadMapJson(json)
  onEnterTile(tileId, x, y) { /* e.g. tileId === T.DOOR → enter a node */ },
});
world.map;       // the WorldMap in use
world.destroy(); // removes the game and its canvas
```

Other options:

- `size: { width, height }` for the generator.
- `touch` to force the stick on or off.
- `showTile` for the outline.
- `onDebug(debug)` for the live read-only state.

`onEnterTile` fires whenever the feet move onto a different tile, not for the spawn tile.

## Art

There are no image files in the repo, and nothing comes from generative models. The placeholders are drawn in code with canvas 2D: the tileset and a 16×16 hero with four facings and a two-step walk with a bob.

### The private hook

This is for licensed art that can't be redistributed (the team is considering **zerie's Tiny RPG Character Asset Pack**: 100×100 frames, no redistribution, so it must never be committed to this public repo).

1. Put the PNGs in `public/assets/private/`. It is in `.gitignore`. Check with `git status`: it must not list them.
2. Restart the dev server, or rebuild. `vite.config.ts` lists that folder when it starts and bakes the names in as `__PRIVATE_ASSETS__`. That way only files that exist are requested, and a clean checkout logs no 404s.
3. Edit the specs in `src/world/assets.ts` to match the art. Each file is optional and falls back to the placeholder on its own, including when it fails to load. The lab's `__world.debug.art` says which art is in use.

| File | Spec (`assets.ts`) |
| --- | --- |
| `player-idle.png`, `player-walk.png` | `PRIVATE_PLAYER`: frame size (default 100×100), frames and fps per animation, and `layout`. Both files are needed. |
| `tiles.png` | `PRIVATE_TILESET`: 16×16 tiles in id order (the table above), any number of columns. |

More about `PRIVATE_PLAYER`:

- **`layout`:**
  - `"side"` is one row facing right, as in the Tiny RPG pack. Left mirrors it; up and down reuse it.
  - `"four"` is rows in the order down, left, right, up.
- **`feet`** is the collision box inside a frame, in sheet pixels. Keep it centred left to right, because of the mirroring.
- **`scale`** is world pixels per sheet pixel. The Tiny RPG figures are small inside their 100×100 frames, so 1 is about right next to 16 px tiles.

**Unverified.** The frame counts (idle 6, walk 8) and the feet box (10×6 at 45,54) are guesses from the pack's description. Nobody has checked them against the actual files yet. Rename the pack's files (for example `Soldier-Idle.png` → `player-idle.png`) or change the `file` names in the spec.

The hook was tested with throwaway PNGs, which were deleted afterwards. The scene picked them up, mirrored the side sheet for walking left, and kept the feet on the right tile.

**Shipping.** Vite copies everything in `public/` into the build. A build made on a machine that has the private files therefore contains the raw PNGs. Itch.io or GitHub Pages would then host them as loose files. Check the license before deploying such a build. For a public deploy, build on a clean checkout, without the private folder.

## Next steps (not done yet)

1. **Hook it into the run.** Link the nodes of the act DAG to doors and areas:
   - Each map node becomes an area, generated from `seed:act:node`.
   - Its doors lead to the node's successors; `onEnterTile` with `T.DOOR` calls the engine's `go`.
   - Fight and boss nodes start `runFight` when you meet the enemy.
2. **Enemies** that walk the same tilemap: reuse the fight's brain (`tickBrain`) with tile collision.
3. **Interactables:** campfire, well, village stall, the devil's table. Use a tile or an object layer with an "interact" button: Space on desktop, a touch button.
4. **Real art:** wire the actual Tiny RPG sheets (verify the spec), and pick a CC0 tileset (OpenGameArt) with a credits list.
5. **Tiled workflow:** a `public/maps/` folder of hand-made areas, a Tiled tileset (`.tsj`) of the placeholder sheet with `kind` properties, and per-area spawn and door objects.
6. **Depth sorting:** tall tiles (trees, wall tops) drawn over the player when they stand behind them. This needs a second tile layer above the player.
