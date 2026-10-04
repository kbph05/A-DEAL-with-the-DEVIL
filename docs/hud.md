# The in-game HUD (`src/hud/`)

A prototype heads-up display for the game scene: HP, gold, attack, soul and revive, curses, devil questions, where you are, and an item bar. It is a **DOM overlay** over the game canvas, not Phaser objects: the text stays crisp at any zoom, the item slots are real buttons (keyboard, screen readers, 44 px tap targets), and it can be restyled with CSS alone.

Two parts:

- `src/hud/model.ts`: `hudModel(viewOrGameState) → HudModel`, pure and unit-tested (`src/hud/model.test.ts`, network-free). No DOM.
- `src/hud/hud.ts` + `src/hud/hud.css`: `mountHud(parent, { onUseItem? }) → { el, update(model), destroy() }`.

Lab page: **`/hud.html`** in test builds (`npm run dev`, then open `/hud.html`; or `npm run build:test`). It is not in the final build.

## HudModel

`hudModel` takes the engine's `View` (`view(state)`, `game.view()`) or a whole `GameState` (it calls `view` itself). Every field is read defensively: a partial object, junk, or a newer engine with extra fields never throws; missing numbers fall back to 0 (max HP to 1).

| Field | Meaning |
| --- | --- |
| `hp`, `maxHp` | HP, clamped to 0..maxHp |
| `gold`, `attack` | as in `PlayerState` |
| `speed` | the player's movement `speed` if the state carries a number there (kbph may add it), else `null` and the HUD hides it |
| `soul` | `"kept"`, `"sold"` (to the devil) or `"spent"` (paid for a revival) |
| `revive` | `"available"` (soul kept), `"used"`, or `"forfeit"` (soul sold). "Spent" vs "sold" is read from the player log line "soul spent on a revival"; the log keeps the last 100 lines, so in a very long run a revival can read as "sold" |
| `items` | the item bar, below |
| `curses` | `{ trigger, label, tooltip }`, e.g. label "On hit: -4 HP", tooltip "Curse, fires once the next time an enemy hits you and survives the round: -4 HP." |
| `devil` | `{ questionsLeft, max, asksLeft }`: questions the devil will still hear this run (of `MAX_DEVIL_QUERIES`), and haggles left at this deal node (`null` when not on a deal node; the HUD then hides the line) |
| `act` | 1-based act |
| `layer`, `layers` | 1-based layer of the current node in the act's map, and how many layers the act has; `null` at the final door |
| `kind` | the node kind (`village`, `fight`, ...) |
| `ending` | `null`, `"win"`, `"lose"` or `"hell"` |
| `busy` | `"devil"` while the devil's reply is awaited, `"fight"` while a realtime fight's result is; items are not usable then |

**Items.** The engine has **no inventory yet**: heal, blade and blessing are bought and applied on the spot. So the item bar shows:

- **Wares** sold at this node (village: Heal 10g "+12 HP", Blade 12g "+1 ATK"; well: Blessing 8g), each `{ id, label, hint, kind: "ware", cost, count: null, usable, reason, command }`. `usable` is true exactly when `{cmd:"buy", item}` is in the view's legal `actions`, except the Heal at full HP (the engine would take the gold for nothing, so the HUD, the shop prompt and the DOM shop disable it with "You're at full health": a UI-only guard, `src/ui/shopGuard.ts`); otherwise `reason` says why in a few words ("need 2g more", "the well is spent", "the devil is speaking", "the run is over"). `command` is what to send to the engine.
- **Consumables**, once an inventory exists: an `inventory` field on the view, or `inventory` / `items` on the player state, as `{ heal: 2 }` or `[{ id: "heal", count: 2 }]`. They get `kind: "consumable"` and a `count`, and are usable when the legal actions contain a non-buy command with that `item` (for example a future `{cmd:"use", item:"heal"}`). Nothing else needs to change in the HUD.

The wares' effect texts and which node sells them are copied from the engine (`buy` in `state-machine.ts`, `legalActions` in `actions.ts`), since it does not export them; costs come from `WARES`.

`announce(prev, next)` (also in `model.ts`) is the text for the HUD's polite live region: HP and gold changes only, "" when neither changed.

## Mounting it in the game scene

```ts
import { mountHud } from "../hud/hud";
import { hudModel } from "../hud/model";

// `parent` is the element that holds the Phaser canvas; it must be positioned (position: relative).
const hud = mountHud(parent, {
  onUseItem: (item) => { if (item.command) session.game.step(item.command); refresh(); },
});
const refresh = () => hud.update(hudModel(session.game.view()));
refresh();               // once at start
// ...and after every engine step (moves, fights, deals, buys).
// hud.destroy() when the scene goes away.
```

- The HUD is `position: absolute; inset: 0` inside `parent`, with `pointer-events: none` except on the item buttons and curse chips, so touches elsewhere still reach the canvas and the touch stick.
- Layout: the stats strip sits top-left. The item bar sits bottom-right in landscape (the world scene's stick rests bottom-left) and stacks up the right edge in portrait (the stick rests bottom-centre); see `worldLayout` in `src/world/logic.ts`. The switch is a CSS container query on the HUD's own box, not the window, so it follows the stage size. Safe-area insets are respected.
- `update` is cheap and idempotent: the item buttons are rebuilt only when the items change, and the live region only speaks on HP or gold changes. Item buttons blur themselves after a press, so Space (attack in the fight) does not press them again.
- Accessibility: the HP bar is a `role="meter"` with value text, item slots are `<button>`s with an `aria-label` such as "Buy Heal, +12 HP, 10 gold" or "Blade, +1 ATK, 12 gold. Unavailable: need 2g more", unusable ones are disabled and show the reason on the slot, curses carry their tooltip as hidden text too.

## Restyling

Everything lives under `.hud` in `src/hud/hud.css`. The palette is the test UI's dark theme (`src/ui/ui.css`), set as custom properties on `.hud`; override them to restyle without touching the rules:

`--hud-bg` (panel background), `--hud-panel` (slot background), `--hud-ink`, `--hud-muted`, `--hud-line`, `--hud-hp`, `--hud-hp-low` (HP bar at 30% or less), `--hud-gold`, `--hud-curse`, `--hud-accent` (focus ring, status line), `--hud-gap`, `--hud-slot` (slot size, never below 44 px).

Class hooks: `.hud-stats`, `.hud-where`, `.hud-hp` (`.low`), `.hud-row`, `.hud-stat` (`.hud-gold`, `.hud-atk`, `.hud-spd`, `.hud-soul`, `.hud-revive`; `.lost`), `.hud-devil`, `.hud-curses` / `.hud-curse`, `.hud-status`, `.hud-items`, `.hud-slot` (`.off`; `data-item="heal"`), `.hud-slot-name`, `.hud-slot-tag`, `.hud-slot-hint`.

## The HUD lab (`hud.html`, `src/hud/dev.ts`)

A real engine game with the StubDevil, the HUD over a grey placeholder "scene" laid out like the world scene's canvas, and a dashed circle where the world scene's touch stick rests, to check for overlap. Buttons: **Step (bot)** (one default-bot step), **Take a hit** (walks to the next enemy, starts a realtime fight and reports 5 HP lost: the real `fight_result` path), **Buy** (walks to the next shop or well and buys the first affordable ware), **Deal** (walks to the next deal node and asks; **Accept offer** when one stands). Walking uses the default bot, which heads for the wanted node kind when it has a choice, and can die on the way. The HUD's own item slots work too. `?seed=abc&steps=N` starts on a fixed seed after N bot steps; `window.__hud` holds `{ game, model, steps }` for scripted checks.
