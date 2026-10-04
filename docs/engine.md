# The engine: a stateless reducer

`Output' = f(Output, Input)`: the whole game is one plain JSON object (`GameState`) and one pure function (`step`). Everything else (the `Game` class, the UI, the console, the REPL, autoplay) is a thin layer that holds a state and feeds it commands.

Source: `src/game/gameState.ts` (the state and read-only queries), `src/game/state-machine.ts` (`step` and the rules), `src/game/actions.ts` (`legalActions`), `src/game/view.ts` (`view`), `src/game/run.ts` (the `Game` wrapper). All are re-exported from `src/game/index.ts`.

## GameState

One JSON-serializable object with everything the engine needs to continue a run exactly: `JSON.parse(JSON.stringify(state))` continues byte-for-byte. It contains no class instances, functions, Maps or Sets.

**The devil is not in the state, and doesn't need to be.** `StubDevil` is a pure function of the request (its dice are seeded from the run seed and `askIndex`), so `restoreGame(state)` with a fresh devil replays a saved run exactly. A backend devil gives the same guarantee only if it is also pure (same request, same reply); an LLM devil generally isn't, so restored runs will get different offers from the next deal on, but they stay legal.

| Field | Meaning |
| --- | --- |
| `v` | format version (1) |
| `seed` | run seed |
| `rng` | dice RNG state `{ s }`: the mulberry32 state number, advanced by the pure `nextRandom` (same sequence as before) |
| `acts` | acts generated so far (lazily, on arrival), with `visited` and the rewrite log `changes` |
| `player` | `PlayerState` (hp, maxHp, gold, attack, soul, act, nodeId, log) |
| `curses`, `enemy` | active curses; the current enemy, including its hidden `power` |
| `resolved`, `offer`, `asks`, `totalAsks`, `dealsDecided` | node and devil bookkeeping |
| `ending` | `null`, `"win"`, `"lose"` or `"hell"` |
| `pending` | the devil request awaiting an answer, or `null` |
| `pendingFight` | the realtime fight awaiting its result (a `FightRequest`); absent or `null` otherwise. Optional, so older saves stay valid |

`initialState(seed)` makes a new run. Treat states as immutable: `step` always returns a new one.

## step

`step(state, command) → { ok, state, events, actions, awaiting? }` is pure and synchronous. It never mutates its input, does no I/O, and reads no clock or `Math.random`.

- **Commands:** the existing `Command` objects (`{"cmd":"go","n":1}`, `fight`, `rest`, `train` (campfire: one or the other with `rest`), `buy` with an `item`, `deal` with optional `text`, `accept`, `refuse`, `look`), plus `{"cmd":"devil_reply","deal":...}`, `{"cmd":"fight","realtime":true}` and `{"cmd":"fight_result",...}` (the realtime fight, below).
- **Rejection:** a rejected command returns `ok: false`, the input state itself (unchanged), and exactly one `rejected` event. The reasons are the same strings as before.
- **`look`:** always accepted, including after the run ends and while the devil is pending. It changes nothing.

## actions

Every step result carries `actions`: the exact legal next commands, computed by the same rule checks `step` uses (`legalActions(state)` gives the same list for any state). They come in this order:

1. `fight`, then `{"cmd":"fight","realtime":true}` (both while an enemy blocks the way)
2. `rest`
3. `train`
4. affordable `buy`s
5. `deal` (while asks remain at this node and questions remain this run)
6. `accept` and `refuse` (when an offer stands)
7. `go n` (one per exit)

Special cases:

- While the devil is pending, `actions` is only `[{"cmd":"devil_reply","deal":null}]`.
- While a realtime fight is pending, `actions` is only a `fight_result` meaning "nothing happened" (`won: false`, the current `hpLeft` and `enemyHpLeft`, zeros elsewhere). It is always safe to send.
- When the run is over, it is `[]`.
- `look` is never listed.

`deal` is listed without text; any text is fine. `devil_reply` is listed with `deal: null`; any answer is fine.

## view

`view(state)` is the player-safe projection. It returns everything `observe()` returns plus three more fields:

- `seed`
- `map`: the current act's `MapView`
- `actions`

`Observation` gains two fields:

- `curses`
- `asksLeft`: the haggles left at this deal node
- `questionsLeft`: the questions the devil will still hear this run, at any deal node (`MAX_DEVIL_QUERIES = 10`, exported from `gameState.ts`, minus `state.totalAsks`)

It leaves out the dice state, enemy power, past acts and the raw pending request. `Game.observe()`, `Game.map()` and `Game.view()` delegate to it.

## The devil round trip

The devil is outside the engine; it may be a network call.

1. `step(s, {"cmd":"deal","text":"..."})` returns `awaiting: { devil: request }` and records the request in `state.pending`. The request has the exact body shape `HttpDevil` POSTs (docs/devil-api.md): `{ state, context, playerText }`.
2. Send the request to any devil and wait.
3. `step(s, {"cmd":"devil_reply","deal": answer})` runs `sanitizeDeal` on the answer, puts the offer on the table and emits `deal_offered`. **Forced replies:** if the sanitized deal has `forced: true` the devil strikes instead: nothing is put on the table (a standing offer from an earlier haggle is untouched); the HP loss (only HP, at most `MAX_STRIKE_HP` = 8, no curse, rewrite, gold or soul) is applied at once, `devil_struck { dialogue, effects }` is emitted (`effects` = the deltas that landed), the usual death check runs (revival, or `lost` with cause "the devil's wrath"), and the node is **not** resolved. The ask counted as usual (`asks`, `totalAsks`). So after a strike `accept`/`refuse` stay unavailable unless an older offer stands, and `deal` stays legal while asks and questions remain (docs/devil-api.md, "Forced replies"). Junk, `null` and missing answers become the devil's silence. Any other command (except `look`) is rejected with "the devil is still speaking" until the reply arrives.

**Run-wide query cap.** Every `deal` that reaches the devil (first asks and haggles, at any node) counts toward `MAX_DEVIL_QUERIES` (10), tracked by the existing `state.totalAsks` (no new state field). When it is spent, `deal` drops out of `actions` and is rejected with "The devil has heard enough from you this run."; an offer already on the table can still be accepted or refused. The separate per-node limit (`MAX_ASKS = 3`) still applies. The devil is told in `context.questionsLeft` (questions left after this one).

`Game.deal(text)` does all three steps, catching devil errors exactly as before. In the REPL, `--manual-devil` stops after step 1 so you can type the reply yourself.

## The realtime fight round trip

Details, the sanitizing rules and the UI flow are in docs/fight.md ("Engine hookup").

1. `step(s, {"cmd":"fight","realtime":true})` returns `awaiting: { fight: request }` and records the request in `state.pendingFight`. It emits no events and rolls no dice. The request is `{ player: {hp, maxHp, attack}, enemy: {name, hp, maxHp, power, boss}, seed }`, where `seed` is `` `${seed}:${nodeId}:${bout}` ``.
2. Play the fight (`runFight` in src/fight) and wait.
3. `step(s, {"cmd":"fight_result","won","hpLeft","timeMs","hitsTaken","damageDealt","enemyHpLeft"})` runs `sanitizeFightResult` against the request and applies the result through the round's events:
   - `fought`
   - `damaged`
   - the `on_hit` curses, once, if a hit landed
   - `revived` or `lost`
   - then `enemy_slain`, the gold and the boss's heal, if the enemy fell
   Any other command (except `look`) is rejected with "the fight is still on; send fight_result".

The plain `{"cmd":"fight"}` is unchanged (one round), so bots, autoplay and the recorded fixtures do not use this path. `Game.fight(true)` and `Game.fightResult(result)` are the wrapper's raw access. In the REPL, the JSON line carries `awaiting.fight` while a fight is pending.

## Sync hooks

Plan: keep the state client-side and exchange it with the backend only when entering or leaving the devil stage and at the end of the game.

- **Events:** `devil_stage_left { nodeId }` comes just before the `moved` that leaves a deal node. `devil_stage_entered { nodeId }` comes just after the `moved` that arrives on one. The endings (`won`, `lost`, `hell`) are unchanged and always come last.
- **A run that starts on a deal node:** there is no `moved` event in this case, so check `view(state).kind === "deal"`. Act 1 now always opens on the village (the shop), so a new run never starts there; the check stays for hand-built states.
- **`Session.onSync(kind, state)`** (`src/game/session.ts`): defaults to a no-op. It is called with a copy of the full `GameState` (as it is after the command) for those events, and when a new run starts on a deal node. No networking is implemented yet; see docs/devil-api.md.

## Example: one step

`step(initialState("demo"), {"cmd":"go","n":1})`. The run starts on the village (act 1 always does), so there is no `devil_stage_left`; leaving a deal node would emit one before `moved`. Acts are elided:

```json
{ "ok": true,
  "events": [ { "type": "moved", "from": "a0n0", "to": "a0n1", "kind": "fight", "act": 0 },
              { "type": "enemy_appeared", "enemy": { "name": "cave rat", "hp": 10, "maxHp": 10, "boss": false } } ],
  "actions": [ { "cmd": "fight" }, { "cmd": "fight", "realtime": true } ],
  "state": { "v": 1, "seed": "demo", "rng": { "s": 189795653 }, "acts": ["…"],
             "player": { "hp": 30, "maxHp": 30, "gold": 10, "attack": 3, "soul": 1, "act": 0, "nodeId": "a0n1", "log": [] },
             "curses": [], "enemy": { "name": "cave rat", "hp": 10, "maxHp": 10, "power": 2, "boss": false },
             "resolved": false, "offer": null, "asks": 0, "totalAsks": 0, "dealsDecided": 0, "ending": null, "pending": null } }
```

## Safety nets (tests)

- **`src/game/equivalence.test.ts`:** replays 500 bot seeds and 200 "chaos" seeds against fixtures recorded with the old class engine. The chaos seeds mix random valid and invalid commands, haggles and fine print. The comparison covers every command, result, event and final state. Regenerate with `npx tsx src/game/__fixtures__/generate.ts` only for an intended behaviour change.
- **`src/game/contract.test.ts`:** fails on any non-additive change to an external JSON shape: `Command`, `PlayerState`, `Observation`, `MapView`, `Result`, every `GameEvent`, the devil request, and the REPL `--json` lines. It checks against two snapshots:
  - `contract.json`: the frozen pre-refactor baseline.
  - `contract-current.json`: includes `actions`, `awaiting`, `game_state`, `curses`, `asksLeft`, the `devil_stage_*` events, and the `--manual-devil` lines. When you add a field, regenerate this one with the generator.
- **`src/game/engine.test.ts`:** covers purity (deep-frozen inputs), the legal-actions property, the devil round trip, JSON save and restore mid-run, the sync events and `onSync`, and `view`.
