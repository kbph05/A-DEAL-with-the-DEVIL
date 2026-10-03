# The realtime fight

Fights are a short realtime 2D brawl in a top-down room, not menu choices (Big Chungus). The fight lives in `src/fight/`. It is **not yet wired into the engine or the test UI**; for now it runs on its own on the fight lab page (`/fight.html`, test builds only).

| File | What it is |
| --- | --- |
| `index.ts` | Public API: `runFight(parent, input, options?) → Promise<FightResult>`. |
| `logic.ts` | Pure rules: damage, timers, the enemy state machine, geometry, input sanitising, screen layout. No Phaser. |
| `sim.ts` | `FightSim`: the world, stepped at a fixed 60 Hz. It is pure too: the same seed and the same controls give the same fight. |
| `FightScene.ts` | Phaser scene. It reads keyboard, mouse and touch, steps the sim, and draws everything with plain shapes (no textures). |
| `dev.ts` + `/fight.html` | The fight lab. |
| `logic.test.ts` | Node tests (in `npm test`), including whole fights played by a bot. |

## Running it

- `npm run dev`, then open `/fight.html`. Or `npm run build:test` and `npm run preview:test`.
- Pick act 1 to 3 and Boss, then press **Fight**. The stats come prefilled from the engine formulas and you can edit them.
- When the fight ends, the page shows the `FightResult` JSON and a **Fight again** button.
- Query string: `?act=2&boss=1&seed=abc&auto=1` (`auto` starts the fight straight away). `&touch=1` / `&touch=0` forces the touch controls on or off.
- The final build (`npm run build`) does not contain the page or Phaser. `vite.config.ts` adds `fight.html` as an input only in mode `test`.

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
  - It stops and swells up to 1.3×, and its colour shifts toward yellow.
  - A lane on the floor shows where it will lunge. The lane follows you for the first half of the wind-up, then locks, and the enemy starts flashing white.
  - The wind-up lasts 0.48 s for a regular enemy (shorter in later acts) and 0.6 s for a boss.
- **lunge:** a fast charge along the locked lane. If it touches you, you take the lunge damage (once per lunge).
- **recover:** it stands still and dark, with a little dizzy ring. This is your opening.
- Then it goes back to **chase**. The lunge has a cooldown, so it doesn't chain lunges.
- **Bosses:**
  - They are bigger (radius 34 vs 18) and sword hits don't push them back.
  - They have a second pattern, the **burst**. Every 4.6 s (4.1 s in act 2, 3.6 s in act 3) a boss stops and charges a growing pink ring for 0.9 s. Then it fires a ring of bullets: 10, 14 or 18 by act. Dash through the ring or get out of its way.

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

## Proposed engine hookup (next step, additive only)

The pattern is the same as the devil round trip, so the contract stays additive and the equivalence fixtures stay valid:

1. **Start.** `{"cmd":"fight","realtime":true}` returns `awaiting: { fight: FightRequest }` and records it in a new `state.pendingFight`. `FightRequest` is `{ player: {hp, maxHp, attack}, enemy: {name, hp, maxHp, power, boss}, seed }`, where `seed` is `` `${state.seed}:${nodeId}:${n}` ``, so a restored state replays the same arena and dice. A plain `{"cmd":"fight"}` stays the one-round fight that bots, the REPL and the 700 recorded runs use.
2. **Play.** The UI calls `runFight(el, awaiting.fight)`.
3. **Report.** The UI sends `{"cmd":"fight_result","won":..,"hpLeft":..,"timeMs":..,"hitsTaken":..,"damageDealt":..,"enemyHpLeft":..}`.
   - The engine sanitizes the result like `sanitizeDeal`: `hpLeft` is clamped to `0..hp before the fight` (a fight never heals), and `enemyHpLeft` to `0..enemy hp before`.
   - It then applies the result through the existing events: `fought` (dealt and taken), then `enemy_slain` with the gold, the boss heal and the stairs, or `damaged`.
   - Then it fires `on_hit` curses (once, if `hitsTaken > 0`) and runs `settle()`.
4. **While a fight is pending**, `actions` is `[{"cmd":"fight_result", ...}]`, `look` still works, and everything else is rejected ("the fight is still on"), just like `devil_reply`.
5. **Revival.** If `settle()` spends the soul, the enemy stays at `enemyHpLeft` and the engine awaits a fresh fight (a new seed suffix `n`) against it.

## Open questions for the designer

1. **Fight length and difficulty.** At engine HP and damage, a regular fight lasts 2 to 4 s and a careless player loses little. Options:
   - a realtime HP multiplier for enemies;
   - a slower swing;
   - harsher contact damage;
   - more aggressive enemy timing.

   Which feel do you want: quick skirmishes, or 10 to 20 s duels?
2. **Revival mid-fight.** Should a revival resume the same fight (as proposed above), or end it?
3. **Curses in realtime.** Does `on_hit` fire once per fight or once per hit taken? Any curse ideas that only make sense in realtime (slower dash, a shorter swing, reversed controls for 3 s)?
4. **Fleeing and timeouts.** Should there be a time limit or an escape? The engine currently forbids leaving a live enemy.
5. **Enemy variety.** Today all enemies of an act share one behaviour. Should the roster names get distinct patterns (rat: fast and weak; hollow knight: slow lunges and a shield)? And should each boss get its own second pattern instead of the shared radial burst?
6. **Arena.** It is a 720×720 room with one of four pillar layouts picked from the seed (bosses get open or four pillars). Tiled maps or OpenGameArt art later?
7. **Joystick.** It is hand-written (about 30 lines in `FightScene`) instead of rexrainbow's VirtualJoystick, to avoid a dependency. Fine to keep?
