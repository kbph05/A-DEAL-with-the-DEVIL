# The realtime fight

Fights are a short realtime 2D brawl in a top-down room, not menu choices (Big Chungus). The fight lives in `src/fight/`. Fight and boss nodes in the game play it (see "Engine hookup" below). It also runs on its own on the fight lab page (`/fight.html`, test builds only).

| File | What it is |
| --- | --- |
| `index.ts` | Public API: `runFight(parent, input, options?) → Promise<FightResult>`. |
| `logic.ts` | Pure rules: damage, timers, the enemy state machine, geometry, input sanitising, screen layout. No Phaser. |
| `sim.ts` | `FightSim`: the world, stepped at a fixed 60 Hz. It is pure too: the same seed and the same controls give the same fight. |
| `FightScene.ts` | Phaser scene. It reads keyboard, mouse and touch, steps the sim, and draws everything: labelled black-and-white placeholder sprites for the bodies and pillars (`src/render/placeholder.ts`), plain shapes for the rest. |
| `dev.ts` + `/fight.html` | The fight lab. |
| `logic.test.ts` | Node tests (in `npm test`), including whole fights played by a bot. |

## Running it

- `npm run dev`, then open `/fight.html`. Or `npm run build:test` and `npm run preview:test`.
- Pick act 1 to 3 and Boss, then press **Fight**. The stats come prefilled from the engine formulas and you can edit them.
- When the fight ends, the page shows the `FightResult` JSON and a **Fight again** button.
- Query string: `?act=2&boss=1&seed=abc&auto=1` (`auto` starts the fight straight away). `&touch=1` / `&touch=0` forces the touch controls on or off.
- The final build (`npm run build`) does not contain the lab page: `vite.config.ts` adds `fight.html` as an input only in mode `test`. It does contain the fight and Phaser, as their own chunk (about 1.2 MB, 330 kB gzipped) that loads on the first fight, so the page itself stays light (about 50 kB of JS).

## Controls

| | Desktop | Touch |
| --- | --- | --- |
| Move (8 directions) | WASD or arrow keys | Left-thumb joystick: it re-centres where your thumb lands on the left half of the screen, and snaps to 8 directions with a dead zone |
| Attack | Space (hold to keep swinging), or left click (aims at the cursor) | **Attack** button (hold to keep swinging) |
| Dash | Shift | **Dash** button (it shows its cooldown) |

- **Attack:** a 120 degree swing in front of you. It has a 0.42 s cooldown and knocks regular enemies back.
- **Dash:** a quick burst (0.16 s) with 0.22 s of invulnerability. You pass through the enemy and its bullets. Cooldown 0.8 s; the thin blue bar under your HP shows it.
- **Getting hit:** you are knocked back, the camera shakes, and you blink through 0.8 s of i-frames.
- The touch controls show when the device reports touch input. They also appear on the first touch.
- Multi-touch works: you can hold the joystick and Attack together.
- **Screen fit:** the game picks a logical size from the container's shape. In landscape the controls sit beside the 720×720 arena; in portrait (phones) they sit below it. Phaser `Scale.FIT` then scales the canvas to the container.

## Enemy AI

A small state machine (`nextEnemyMode` / `tickBrain` in `logic.ts`):

- **idle:** stands at spawn until you come within range, or 1.2 s pass (0.9 s for a boss).
- **chase:** walks at you and steers around pillars. Touching it while it walks hurts a little (contact damage).
- **windup (the telegraph):**
  - It stops and swells up to 1.3×. (Placeholder art is black and white, so there is no colour shift.)
  - A lane on the floor shows where it will lunge. The lane follows you for the first half of the wind-up, then locks, and the enemy starts flashing white (the black body swaps to a white one).
  - The wind-up lasts 0.48 s for a regular enemy (shorter in later acts) and 0.6 s for a boss.
- **lunge:** a fast charge along the locked lane. If it touches you, you take the lunge damage (once per lunge).
- **recover:** it stands still and faint, with a little dizzy ring. This is your opening.
- Then it goes back to **chase**. The lunge has a cooldown, so it doesn't chain lunges.
- **Bosses:**
  - They are bigger (radius 34 vs 18) and sword hits don't push them back.
  - They have a second pattern, the **burst**. Every 4.6 s (4.1 s in act 2, 3.6 s in act 3) a boss stops and charges a growing ring for 0.9 s. Then it fires a ring of bullets: 10, 14 or 18 by act. Dash through the ring or get out of its way.

**Speeds and timings by act:** an enemy's act is worked out from its power (regular power is 2 + act, boss power 3 + act). Later acts move faster, wind up quicker and recover sooner. All the numbers are in `enemyParams` and `PLAYER` in `logic.ts`. They are all **first guesses**.

## How the engine's stats map in

The input is exactly what the engine has: the player's `hp`, `maxHp` and `attack`, and the current enemy's `name`, `hp`, `maxHp`, `power` and `boss` (the hidden `power` too). Damage reuses the engine's per-round formulas (docs/FEATURES.md 5.1), with `d3` meaning 0, 1 or 2:

| Hit | Damage |
| --- | --- |
| Your swing | `attack + d3` (the engine's round damage) |
| Enemy lunge | `power + d3` (the engine's round damage) |
| Walking into a chasing enemy | `ceil(power / 2)` |
| Boss burst bullet | `max(1, power - 1)` |

- HP is the engine's own HP: the enemy starts with its current `hp`, and the player with theirs.
- The dice come from the fight's seed (mulberry32, the same generator the map uses). Phaser's own RNG is seeded with it too.
- Bad input is clamped, never thrown: hp to `0..maxHp`, attack at least 1, power at least 0.

**Fight lab presets.** These are representative, not balanced:

- **Enemy (engine formulas):**
  - Regular: HP `8 + 4a + 2` (the middle of the d4) and power `2 + a`, for 0-based act `a`.
  - Boss: HP `18 + 8a` and power `3 + a`.
- **Player:** starts at 30/30 HP and attack 3, plus about +3 max HP and +1 attack per act cleared.

**How hard it is.** These are bot measurements: 50 seeds each, preset stats, fixed 60 Hz.

- **Standing still always loses.**
- **A button-masher that walks in and swings without dodging always wins:**
  - Act-1 regular: about 2.5 s, 0.8 hits taken, about 2.5 HP lost.
  - Act-3 boss: about 3.5 s, 3 hits, about 15 HP lost.
  - The round-based engine fight costs more than that against bosses (an act-3 boss deals about 30 HP).
- **A bot that also dashes out of every telegraph** takes almost nothing, except from boss bullets.

So skill pays off, but **the fights are short and forgiving at these numbers**; see the open questions.

## FightResult

```ts
interface FightResult {
  won: boolean;        // enemy dropped (true) or player HP hit 0 (false)
  hpLeft: number;      // player HP at the end (0 when lost)
  timeMs: number;      // simulated time (fixed 60 Hz steps), so it does not depend on the device's speed
  hitsTaken: number;   // times the player took damage
  damageDealt: number; // enemy HP actually removed (overkill not counted)
  enemyHpLeft: number; // additive extra: enemy HP at the end (0 when won); lets the engine resume after a revival
}
```

- `runFight` makes its own `Phaser.Game` inside `parent`. It resolves about 1.1 s after the end (once the VICTORY or DEFEATED banner has shown) and destroys the game, canvas included.
- The fight knows nothing about the soul. At 0 HP it simply reports `won: false, hpLeft: 0`, and the engine decides about revival.
- `options.onDebug(sim)` exposes the live `FightSim` (the lab page and the smoke test use it). `options.touch` forces the touch controls on or off.

## Engine hookup (implemented)

**Status: implemented.** Fight and boss nodes in the game UI now play this fight. The engine side is `src/game/fightResult.ts` plus a few lines in `state-machine.ts` and `actions.ts`; tests are in `src/game/fightResult.test.ts`. It works like the devil round trip, and the JSON contract only grew. A plain `{"cmd":"fight"}` is still the one-round fight that bots, autoplay, the REPL and the 700 recorded runs use, so the equivalence fixtures did not change.

1. **Start.** `{"cmd":"fight","realtime":true}` (only while an enemy blocks the way) returns `awaiting: { fight: FightRequest }` and stores it in `state.pendingFight`. It emits no events and rolls no dice.
   - `FightRequest` is `{ player: {hp, maxHp, attack}, enemy: {name, hp, maxHp, power, boss}, seed }`. It has the same shape as the fight's `FightInput`, so the UI passes it straight to `runFight`.
   - `seed` is `` `${state.seed}:${nodeId}:${n}` ``, where `n` counts the bouts against this enemy (`enemy.bouts`: 1, then 2 after a revival...). A saved state replays the same arena and dice.
2. **While it is pending:**
   - `actions` is a single `fight_result`, listed as "nothing happened": `{won:false, hpLeft: <player hp>, timeMs:0, hitsTaken:0, damageDealt:0, enemyHpLeft: <enemy hp>}`. It is always safe to send, which makes it the abort.
   - `look` still works.
   - Anything else is rejected with "the fight is still on; send fight_result". `fight_result` with no fight on is rejected with "no fight is on; fight with realtime first".
3. **Play.** The UI calls `runFight(el, awaiting.fight)`.
4. **Report.** The UI sends `{"cmd":"fight_result","won":..,"hpLeft":..,"timeMs":..,"hitsTaken":..,"damageDealt":..,"enemyHpLeft":..}`, which is the `FightResult` as it is.
5. **Sanitizing** (`sanitizeFightResult`). The client is never trusted. Junk is treated as "nothing happened", and nothing throws.
   - `hpLeft` is clamped to `0..player hp at the start`, because a fight never heals. If it is missing, HP is unchanged.
   - `enemyHpLeft` is clamped to `0..enemy hp at the start`. If it is missing, it is worked out from `damageDealt`; failing that it is 0 when `won === true`, and otherwise unchanged. When `enemyHpLeft` is given, `damageDealt` is ignored and recomputed as the enemy's HP before minus after.
   - **Outcome:**
     - **Won** only if `won === true`, the enemy is at 0, and the player is above 0. The sim stops at the first death, so both can't drop.
     - A claimed win with the enemy still standing, or with the player at 0, is not a win. An enemy that was not beaten keeps at least 1 HP.
     - **Lost** means the player is at 0.
     - **Unfinished** means both are still standing (an abort, a crash, later maybe a flee). It is accepted: partial damage sticks and the enemy stays.
   - `hitsTaken` is clamped to `[1 if any HP was lost else 0, HP lost]`, because every hit does at least 1. `timeMs` is clamped to 0..1 h; it is for information only.
6. **Applying** goes through the round's own events, in this order:
   1. `fought { dealt, enemyHp, taken, bout }`, where `bout` is `{ timeMs, hits, enemy, outcome: "won" | "lost" | "unfinished" }` (additive; the one-round fight never sets it, and `describe` words a bout as a whole fight)
   2. `damaged` (if HP was lost)
   3. the `on_hit` curses, if `hitsTaken > 0`. They fire once: a curse is spent when it fires, so "once per hit" would come to the same thing.
   4. the death check: `revived` or `lost`
   5. if the enemy fell and the run goes on: `enemy_slain` with the gold roll, and the boss's `healed` (victory)
7. **Revival.** If the soul pays, the same enemy stays at `enemyHpLeft` and the player wakes at half HP. The state is not awaiting anything: the player starts a new bout (seed `n + 1`), or uses the plain `fight`.

**In the UI** (`src/ui/ui.ts`, `choices.ts`):

- On a fight or boss node, the Fight panel's main button is **Fight! (realtime)**. If a fight is already pending (for example one started from the console), it reads **Resume the fight (realtime)**.
- Clicking it steps the realtime `fight`, then hides the choices and shows a fight stage in their place, in the "Your choices" card. The stage fits the card's width: landscape on wide screens, portrait with the touch controls below on phones.
- Then it loads the fight module (a separate, lazily loaded chunk with Phaser), plays it, and steps `fight_result`. The Outcome box shows the events of both steps.
- While the fight runs, the choices are gone, the active element is blurred (so Space does not press a button), and the dev tools column is `inert`.
- If the fight module fails to load, the engine gets the "nothing happened" result. The Outcome says why, and the panel then also offers the quick fight.
- **Auto-resolve (quick)** is a small secondary button, in test builds only. It plays the old one-round fight again and again until the enemy falls, the soul revives you, or the run ends.
- Test builds expose the live sim as `window.__fightSim` (null between fights).

**Console and REPL:**

- **Console:** `fight(true)` starts a realtime fight and logs the request; `fightResult({...})` reports it.
- **REPL:**
  - `--json` takes `{"cmd":"fight","realtime":true}` and `{"cmd":"fight_result",...}`. While a fight is pending, each line carries `awaiting.fight`.
  - Text mode: `fight realtime` and `result {json}`.

## Open questions for the designer

1. **Fight length and difficulty.** At engine HP and damage, a regular fight lasts 2 to 4 s and a careless player loses little. Options:
   - a realtime HP multiplier for enemies;
   - a slower swing;
   - harsher contact damage;
   - more aggressive enemy timing.

   Which feel do you want: quick skirmishes, or 10 to 20 s duels?
2. **Revival mid-fight.** Implemented: the same enemy stays at the HP it was left on, and you start another bout yourself. Should it instead resume at once, or end the fight?
3. **Curses in realtime.** `on_hit` fires once if you were hit at all. Curses are spent when they fire, so once per hit would be the same. Should there be lasting curses that fire on every hit? Any curse ideas that only make sense in realtime (slower dash, a shorter swing, reversed controls for 3 s)?
4. **Fleeing and timeouts.** Should there be a time limit or an escape? The engine still forbids leaving a live enemy. It already accepts an "unfinished" result: partial damage sticks and the enemy stays. A flee button or a timeout could report that.
5. **Enemy variety.** Today all enemies of an act share one behaviour. Should the roster names get distinct patterns (rat: fast and weak; hollow knight: slow lunges and a shield)? And should each boss get its own second pattern instead of the shared radial burst?
6. **Arena.** It is a 720×720 room with one of four pillar layouts picked from the seed (bosses get open or four pillars). Tiled maps or OpenGameArt art later?
7. **Joystick.** It is hand-written (`FloatingStick` in `src/input/stick.ts`, shared with the world scene; keyboard and stick directions are in `src/input/dir.ts`) instead of rexrainbow's VirtualJoystick, to avoid a dependency. Fine to keep?
8. **Quick fight in the final game.** Auto-resolve (the old round-based fight) is offered in test builds only, and as a fallback when the fight fails to load. Should players get it too, for example as an accessibility option?
