# The map scene (`src/mapscene/`)

The act map as a game screen, in the style of Slay the Spire's map: a vertical parchment you scroll, the act's entry at the bottom, the boss as a big icon near the top and the stairs (or, on the last act, the final door) above it. Every node is a small pixel-art icon, drawn in code like the rest of the game's placeholder art (src/world/textures.ts). There are no image files and no emoji.

- **Paths** are dotted ink. The ways out of your node are dashed and darker, and the paths you have walked are solid ink.
- **Visited nodes** are circled in ink and faded.
- **The current node** glows gold, and the player's token stands beside it.
- **The next nodes** pulse (a gentle scale) and are clickable.
- **Everything else** is dimmed.
- **Rewritten nodes** carry a red star on a red halo: the devil rewrote that node.
- **The legend** is drawn on a fixed UI camera, not on the parchment. A small **Legend** button (bottom-left, `aria-expanded`) shows or hides it. Where there is room beside the parchment (`legendBeside`: 190 px free on each side, so laptops and desktops) it starts open there; on narrow screens (phones, portrait tablets) it starts collapsed and, when opened, is a card over the map's bottom-left corner (taps on the card do not reach the nodes under it). Once the player uses the button, their choice wins over the screen shape.

Files:

| File | What |
| --- | --- |
| `layout.ts` | `layoutMap(dag, seed, act)`: pure, Node-tested. It turns the DAG model into world positions with seeded jitter and edge polylines |
| `icons.ts` | the icons as 16×16 palette grids (`ICONS`), painted onto canvas textures, plus the private-art hook |
| `MapScene.ts` | the Phaser scene: the parchment texture, edges, icons, legend, camera and input |
| `index.ts` | `mountMap`: the Phaser game plus the DOM around it (accessible buttons, tooltip, lock hint) |
| `mapscene.css` | the DOM layer's styles |
| `dev.ts` + `/map.html` | the map lab (test builds only) |
| `layout.test.ts` | layout and icon tests (in `npm test`) |

## API

```ts
import { mountMap } from "./mapscene";

const map = mountMap(parent, {
  onGo: (n) => send({ cmd: "go", n }), // the engine's go index, exactly as the DOM DAG sends it
  map: view.map,                        // the current act (game.map())
  view,                                 // game.view(): where you stand, the lock, the legal actions
  busy: false,                          // optional: lock the map while your UI waits on something (e.g. a network devil)
  overlays: () => [hudEl.querySelector(".hud-stats")], // optional: things drawn over the map that must not hide its top nodes
});
map.update(view.map, view, busy);       // after every engine step
map.destroy();
map.debug();                            // test hook: { dag, layout, screenOf(id), zoom, centerY, legendOnMap, legendOpen, inset, privateArt }
```

`parent` must be positioned, because the scene fills it (`position: absolute; inset: 0`). The HUD can share the parent: call `mountHud(parent)` after `mountMap`. The HUD is a DOM overlay with `pointer-events: none` except on its buttons, so taps reach the map. The layout leaves 150 world units above the stairs. On a phone the HUD's stats strip (and the play page's "Choose where to go next" title) covers the top of the parchment, so pass them as `overlays`: the camera may then scroll that many px past the top edge (`clampCenter` in `layout.ts`), the auto-scroll centres on the part of the screen below them, and `debug().inset` says how far. Only overlays that overlap the parchment horizontally and sit in the map's top half count, so on a laptop, where the stats strip sits beside the parchment, nothing changes.

**Nothing is re-derived here.** Which node is current, visited, next or far, each node's exit number `n`, its accessible label, and whether it is clickable all come from `dagModel(view, map, busy, view.actions)` in `src/ui/logic.ts`, the same model the DOM DAG uses. Each layer's left-to-right order comes from `planarOrder`. So a node is clickable exactly when its `go` is in the engine's legal `actions` and the UI's `moveLock` allows it. While the devil is speaking, a fight is pending, an offer is on the table or the run is over, nothing pulses or moves. The reason ("Finish the fight first.", "The devil considers…") is shown in a hint at the bottom, and tapping a locked node shows it again.

**Input.**

- **Tap or click** a pulsing node to move. Tapping any other node shows its label for a moment ("fight on the left, not reachable yet": never a node id; siblings in a row are told apart by place).
- **Scroll** with drag, touch-drag or the mouse wheel. A press that travels more than 7 px is a drag, never a tap.
- **On every update**, the camera scrolls to a point between the current node and the next nodes.
- **Hover** shows a tooltip with the node's label.

**Accessibility.** The canvas is backed by a visually hidden `<nav aria-label="Map">`. It holds a heading ("Map, act 2"), where you are ("You are here: village"), and one `<button>` per next node, labelled like the DAG ("Go to fight on the left, then campfire or village").

- **Locked nodes** stay focusable with `aria-disabled`, and their label carries the reason.
- **Tab** reaches the list, which uses a roving tabindex.
- **The arrow keys** move between nodes, and **Enter** goes. Focus is mirrored on the canvas as red corner brackets, so sighted keyboard users see it too.
- **After clicking the canvas**, an arrow key or Enter jumps into the list.
- **The lock hint** is an `aria-live` status.
- **Phaser's keyboard plugin is off**, so other inputs on the page keep their arrow keys.

**Sizes.** The world is 360 units wide. The camera zooms it to fill the screen's width, capped at the height divided by 520 and at 2.4, so it fills a 390×844 phone and stays a centred strip on a 1366×768 laptop, with the legend beside it. Scale mode is `RESIZE`: the scene follows its parent's size.

## Layout

`layoutMap(dag, seed, act) → { width, height, nodes: [{ id, kind, x, y, r, row, node }], byId, edges: [{ from, to, points }], jitter }` (`src/mapscene/layout.ts`). `focusY(layout)` gives the camera target.

- **Rows** follow `dag.rows`, top first: row 0 is the stairs or final door, row 1 the boss, and the last row is the act's entry. The boss row has wider gaps around it. Nodes are spread evenly across the width.
- **Jitter** is seeded per node from `hashSeed("mapscene:<run seed>:<act>:<node id>")`. A node therefore never moves while you walk the act, and the same seed always gives the same map. The jitter is at most 22% of the gap between neighbours (and at most 20 units) sideways, and 13 units up or down. The boss gets 40% of that, and the top node none.
- **No crossings.** Edges are straight lines between the icons, trimmed by each icon's radius. If a seed's jitter would make two edges cross, the jitter is halved, then quartered, then dropped. The planar order alone never crosses. Over 900 generated acts (seeds `lay-0..299`), it was never reduced.
- **Tests** (`src/mapscene/layout.test.ts`):
  - it is deterministic per seed;
  - positions are independent of where you stand;
  - 300 seeds × 3 acts are in bounds, with rows in order, the boss bigger and on top, and no geometric crossings;
  - 20 real bot runs (visited nodes, rewrites, acts 2 and 3) lay out cleanly, with the focus between the current and next nodes;
  - every icon grid is 16×16 and uses only its palette.

## Icons

Each icon is a 16×16 grid of palette letters in `ICONS` (`src/mapscene/icons.ts`). `.` is transparent and `k` is the shared dark outline, so every icon reads on the parchment. Edit the strings to redraw an icon.

| Key | Picture | Shown for |
| --- | --- | --- |
| `campfire` | flames on crossed logs | campfire nodes |
| `fight` | crossed swords | fight nodes |
| `deal` | red devil head with horns | deal nodes |
| `well` | roofed stone well with water and a bucket | wells |
| `village` | cottage with chimney, window and door | villages (the shop) |
| `boss` | horned skull with red eyes, drawn about twice the size | the act's boss |
| `final` | arched wooden door in a stone frame | the last act's final door |
| `stairs` | stone steps | the stairs to the next act |
| `rewritten` | red star | the devil's mark on rewritten nodes |
| `here` | the player (blue tunic) | the token beside the current node |

Visited nodes are tinted parchment-brown, and far nodes are tinted and faded. The current and next nodes keep their full colour.

## Private art

Drop PNGs into the gitignored `public/assets/private/map/`, named after the key: `campfire.png`, `fight.png`, `deal.png`, `well.png`, `village.png`, `boss.png`, `final.png`, `stairs.png`, and `rewritten.png` for the star. Each one replaces the generated icon, on the map and in the legend. This is the same hook as the world scene (docs/world.md):

- `vite.config.ts` lists that folder into `__PRIVATE_ASSETS__` at startup, so only files that exist are requested. Restart the dev server after adding files.
- A file that fails to load falls back to the generated icon.
- Any size works: the scene fits the longer side to the node's size.
- `pixelArt` is on, so small pixel art stays crisp.
- `map.debug().privateArt` lists which icons were replaced.

The `here` token has no hook yet.

## The map lab (`/map.html`, `npm run map`)

Test builds only: `map.html` is an input only in mode `test`, so `npm run build` does not ship it. The lab runs a real engine game (`createGame(seed)` with the StubDevil) with the map scene and the HUD over it.

- **Moving:** tap a pulsing node to `go`.
- **The bar under the map** has the node's other legal actions as buttons: fight (the plain turn-based `fight`, one round per press), rest, train, buy, ask the devil, accept and refuse.
- **The top bar** has a seed box (Enter or New run) and **Bot step**, which plays one `botPolicy` command.
- **`?seed=abc&steps=N`** plays N bot steps on load. The devil is asked without a wish, as the bot does, so this replays `autoplay` exactly.
- **`window.__map`** holds `{ game, view, map, steps, busy, log, bot() }` for scripts.

## Wiring it into the game (kbph)

The DOM game UI's "Where to next" (`src/ui/choices.ts`) calls `mountDag(send)` and then `dag.update(dagModel(o, o.map, busy, o.actions))` on every render. The map scene takes the same inputs:

1. Give it a positioned container: a full-screen stage, or the "Where to next" card.
2. `const map = mountMap(stage, { onGo: (n) => send({ cmd: "go", n }), map: v.map, view: v, busy })`. `send` is the session's command runner, the same one the DAG gets.
3. On every render, call `map.update(v.map, v, busy)`. It is cheap: the scene redraws about 15 sprites, and the parchment texture is only regenerated when the act or its height changes.
4. **Game flow.** Show the map scene when the player is choosing where to go next: the node's business is done, so `v.actions` has `go` commands and `moveLock` is null. After a `go`, switch to the node's scene (the world scene, or the realtime fight), then come back to the map. Locked states are handled already, so the map can also stay on screen behind a fight or the devil's table.
5. `map.destroy()` when leaving the screen. It owns its own `Phaser.Game`, like `mountScene`. To share one Phaser game with the world scene later, add `MapScene` to that game's scene list. The scene only needs `setModel({ layout, seed, act, lock })` and the hooks.

The old placeholder `src/scenes/MapScene.ts` (circles and labels, not imported anywhere) is superseded by this one.
