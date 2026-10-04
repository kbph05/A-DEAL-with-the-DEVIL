# A DEAL with the DEVIL: feature sheet

What is **already in the game**, as the code does it today (snapshot of `main` on 3 Oct 2026 plus the stateless-engine refactor and the rules-round-1 changes: start at the shop, campfire Rest or Train, wider planar maps with committed lanes; then the devil-anywhere round of 4 Oct: a deal at every campfire and at some wells, deal nodes a third as likely). Written for gameplay design: every number below was read from source, with the file in brackets. Anything marked **(first guess)** is a placeholder value nobody has balanced yet. Where the code and `requirements.md` disagree, see section 12.

Contents: 1 Overview, 2 Run structure and map, 3 Player, 4 Nodes, 5 Combat, 6 The devil, 7 Curses, 8 Soul and endings, 9 Events, 10 Interfaces, 11 Balance snapshot, 12 Gaps and known issues.

---

## 1. Overview

A run is a walk through **3 acts**, each a small branching map ending in a boss, followed by one last "final" door. You start with 30 HP, 10 gold, attack 3 and your soul. At each node you do what the node allows: fight, rest, train or deal with the devil at a campfire, shop, drink from a well (where the devil sometimes waits too), or sit down at the devil's table and haggle over a deal. The devil's deals are bad-faith: they pay now and cost later (curses), and can **rewrite nodes ahead of you on the map**. You **lose** if HP hits 0 (unless your soul pays for one revival), and at the final door you **win** if you still own your soul, or go to **hell** if you sold or spent it.

Everything is a headless, stateless engine: one JSON `GameState` and a pure `step(state, command)` reducer (`src/game/state-machine.ts`, wrapped as the `Game` class in `src/game/run.ts`; see `docs/engine.md`) that returns plain event data. There is no canvas or art yet. Today you can play it four ways: in a terminal (`npm run play`, text or `--json`), in a plain-DOM test page (`npm run dev`), from the browser console (F12, test builds), or let a bot play (`autoplay`, `simulate`). The devil is a canned `StubDevil` by default, or an HTTP backend (the Gemini proxy) behind the same interface.

---

## 2. Run structure and map

Source: `src/map/mapgen.ts`, `src/map/types.ts`, `src/map/rng.ts`, `src/map/README.md`. Engine use: `src/game/state-machine.ts`.

### 2.1 Acts, layers, node counts

- A run = **3 acts** (`ACTS = 3`). Each act has **12 to 14 nodes** (`MIN_NODES`/`MAX_NODES`, inclusive of its entry and exit). Not uniform: over 3000 acts (seeds `run-0..999`, all 3 acts) 12 nodes 64%, 13 nodes 25%, 14 nodes 10%, because a 6-layer act can only make 12 (see below). The act-3 **final** node is extra, outside that count.
- Each act is a **layered DAG**: nodes sit in layers, edges only go from layer n to layer n+1 (no backtracking, no skipping).
- Exactly **1 entry node** (layer 0) and **1 exit node** (last layer). Every node has at least one parent (except entry) and at least one child (except exit), so every node is reachable and no dead ends exist.
- **Widths: the designer's walk** (Big Chungus, 4 Oct; `walkWidths` and `widthBounds` in `src/map/mapgen.ts`). The layer count is drawn first: **6 or 8 layers** (50/50, as before) with the default alternating layout (an even count: entry good, exit boss bad), 6 to 8 without alternation. Layer 0 is 1 node. Each next layer is the previous width **plus or minus 1** (a coin flip), clamped to **MIN_WIDTH to MAX_WIDTH** for middle layers (`MIN_WIDTH = 1`, `MAX_WIDTH = 4`) and to at most `layers - i` for layer i, so the widths can always narrow back to the **single exit** by the last layer. So widths change by exactly 1 except where a clamp holds them (at the floor, at MAX_WIDTH, or at that narrowing cap). Every alternating act has at least one such hold: plain plus/minus 1 steps from 1 only get back to 1 after an even number of steps, and an even layer count means an odd number. Walks are redrawn (seeded) until the act totals 12 to 14 nodes: about 8 tries for 6 layers, 3 for 8, at most 256; if the cap were ever hit (only possible with other MIN_WIDTH/MAX_WIDTH values) the walk closest to the range is kept, still a legal shape.
  - Consequences of plus/minus 1 steps with 12 to 14 nodes: a 6-layer act is always widths 1-2-3-3-2-1 (12 nodes); 8-layer acts vary. **Width 4 never occurs** (it needs at least 1+2+3+4+3+2+1 = 16 nodes), so the widest layer is 3 (98% of acts) or 2. Middle layers: 1 wide 22% (was 28%), 2 wide 48%, 3 wide 30%. MIN_WIDTH can be raised to 2 for maps that always branch; above 2 a layer could not step down to the exit. Acts were 6–8 nodes in 4 or 6 layers until 3 Oct (kbph: "too short, not many decisions").
- Edges are **planar by construction** (kbph 3 Oct: "the graph should be planar"; designer's rule 4 Oct; `linkLayers` in `src/map/mapgen.ts`). Between a layer of m nodes and the next of n: first, **each old node links to exactly one new node**: each picks one at random, and the picks are dealt out left to right in sorted order, so targets never decrease and no edges cross. Then **each new node left without a parent gets one**, left to right, picked at random among the old nodes whose edge to it crosses none so far (the old nodes either side of its gap always qualify). So every node but the exit has a child, every node but the entry has a parent, edges never cross when each layer is drawn in slot order, and there are at most m + n - 1 edges per layer pair. There are no extra cross-links any more (`CROSS_LINK_P`, 20% per layer pair, is gone). Each node's exits are numbered left to right.
  - Measured over 3000 acts (seeds `run-0..999`, all 3 acts): average out-degree of a non-exit node **1.30** (was 1.32 with the staircase and cross-links), middle nodes with more than one exit **23%** (was 17%), edges per act 14.9 (was 15.9), acts with a crossing in slot order **0**. Forks are a little more common because a node whose pick collides with a neighbour's leaves a new node to be adopted, and the adopter forks.
  - Measured over 3000 acts (seeds `run-0..999`, all 3 acts): average out-degree of a non-exit node **1.31** (was 1.39 with 3 wide and the old 25%-per-pair extra edges), middle nodes with more than one exit **12%** (was 21%), edges per act 7.9 (was 8.4), acts with a crossing in slot order **0** (was 1227 of 3000). The old generator linked random parents and children plus extras, so lanes crossed and braided.
- Node ids are `a{act}n{index}` (for example `a0n3`), unique across the run. The act-3 final node has id `final`. The entry is always `a{act}n0`.
- **Final node**: after act 3's exit boss, the exit offers a "gate" to `final`. It is a verdict door, not a fight (see 8).

### 2.2 Entry, exit, the chain between acts

- The exit of each act is always a `boss`. Acts 1 and 2: leaving the exit offers "stairs" to the next act's entry. Act 3: the exit offers "gate" to `final`.
- You cannot leave the exit node while its boss is alive (movement is blocked during any fight).
- **Act 1 always opens on a village** (the shop; `START_KIND` in `src/map/mapgen.ts`, kbph 3 Oct): you start with 10 gold at the stall, never at the devil's table. Like the exit boss, this ignores `banKinds`/`forceKinds`. The generator still draws the entry kind and then overrides it, so the rest of act 1 is the same as before the rule. Acts 2 and 3 open on a random **good** kind (deal, village, campfire or well; deal at a third of the usual odds, 2.5), never a fight, so you can still start a later act on a deal node.

### 2.3 Lazy generation

Act 1 is generated when the game is created. Acts 2 and 3 are generated at the moment you take the stairs (`go` in `state-machine.ts`). The generator depends only on `(runSeed, actIndex)`, so act 2 is the same map whether it is generated early or late, and it is **not** affected by anything you did (the engine never passes modifiers, see 2.6).

### 2.4 Seeding and determinism

- The engine has **three independent seeded random streams** from the run seed string: the map (`"{seed}:{act}"`), the combat dice (`"dice:{seed}"`), and the StubDevil (`"devil:{seed}"`). PRNG is mulberry32, seed hash is FNV-1a (`src/map/rng.ts`).
- Same seed gives the same maps for the same acts. Combat dice and StubDevil choices are consumed as you act, so the same seed with different play diverges after the first difference. Same seed plus identical commands gives an identical event log (there is a test for this).
- Seed defaults to a random 6-character base-36 string. `?seed=abc` in the page URL, `npm run play -- abc`, or `newgame("abc")` fixes it. REPL default seed is `demo`.

### 2.5 Good and bad polarity, alternation

- Kinds: **good** = `deal`, `village`, `campfire`, `well`. **Bad** = `fight`, `boss`. Plus `final`.
- With alternation on (the default for engine runs), layer polarity is fixed: **even layers are good, odd layers are bad**. Entry (layer 0) is good, the exit boss (odd layer 5 or 7) is bad. No edge ever joins two nodes of the same polarity.
- In practice this means every act is: good entry, then a layer of fights, then a layer of good nodes, again (and with 8 layers once more), then the boss: 2 or 3 fights plus the boss on every path, as before. The odd layers can only roll `fight` (the only non-boss bad kind), the even layers roll among the 4 good kinds, uniformly except that **deal is a third as likely** (`DEAL_NODE_RATE = 1/3` in `src/map/mapgen.ts`, kbph and Big Chungus 4 Oct): 1 in 12 good nodes instead of 1 in 4, the other three 11 in 36 each. The devil now also deals at every campfire and at about half the wells (4.3, 4.4), so he is no rarer overall. `GenOptions.dealRate` overrides it (1 = the old odds, the same maps exactly); the shape never depends on it. **You cannot route around fights** (every path crosses every fights layer), but you can choose which good node to visit between them.
- Normal nodes never roll `boss`; bosses exist only at act exits (3 per run).
- Generated acts always alternate. `act.alternate` becomes false only if a devil rewrite flips a node's polarity (2.7). The generator also supports `alternate: false` (any kinds anywhere, 6 to 8 layers); the engine never uses it, only the map tests do.

### 2.6 Modifiers: forceKinds and banKinds

`generateAct(seed, act, { forceKinds, banKinds })` supports "at least N of kind X" and "never kind Y". They only change node kinds, never the shape. Forced kinds go into random free middle nodes of matching polarity (capped by free slots); a ban that would leave a polarity with no legal kind is ignored for that polarity; bosses and unknown kinds are skipped; nothing crashes on silly input (tested).

**These are map-API only: nothing in the engine, the devil contract or the UI calls them.** They are a hook for a future "devil shapes the next act" or difficulty setting.

### 2.7 Rewrites (the devil editing the map)

`rewriteNode(act, nodeId, newKind)` returns a new act (immutable) plus a change record, or `{ ok: false, reason }`. It never throws.

Accepted: any node that is unvisited, not the act's entry, not its exit, rewritten to any of `fight, village, campfire, well, deal`, and different from its current kind.

Rejected, with a reason string: unknown node id, unknown kind, entry node, exit boss, already visited (including the node you are standing on), target kind `boss` or `final`, and no-op swaps (already that kind). Rejections show in the game as a `rewrite_failed` event and the map is unchanged.

Polarity: **the devil may break alternation** (team decision 3 Oct). A swap that crosses good/bad (for example campfire to fight) is allowed, flagged `polarityFlip: true` on the change, and clears `act.alternate`.

Change log: every successful rewrite is appended to `act.changes` as `{ nodeId, from, to, polarityFlip }`. The engine's `map()` view marks rewritten nodes (`rewritten: true`) and returns the whole `changes` list, and the test UI shows a star on them and the old and new kinds in the tooltip. Rewrites only affect the **current act**; once you take the stairs the next act is freshly generated.

---

## 3. Player

Source: `src/game/state.ts`. The only place stat ranges live.

| Stat | Start | Legal range | Notes |
| --- | --- | --- | --- |
| HP (`hp`) | 30 | 0 to `maxHp` | 0 or below triggers death or revival (see 8). |
| Max HP (`maxHp`) | 30 | 1 to 60 | Lowering it also clamps current HP down. Raising it does **not** heal. |
| Gold (`gold`) | 10 | 0 to 999 | Spent at village and well, earned from kills and deals. |
| Attack (`attack`) | 3 | 1 to 12 | Base damage per fight round. "damage" in deal JSON means attack. |
| Soul (`soul`) | 1 | 0 or 1 | 1 = still yours. 0 = sold or spent on a revival. |

Other state: `act` (0-based act index), `nodeId` (where you are), `log` (short strings, capped at 100, passed to the devil). The log only records four things: "deal accepted: ..." (first 60 chars of dialogue), "trained by the fire: attack N", "soul spent on a revival", "died: ...".

What changes each stat:

| Stat | Increased by | Decreased by |
| --- | --- | --- |
| HP | rest at campfire (+40% of max, rounded up), village `heal` (+12), boss kill (+10), stairs (+6), well blessing (+8, one of three outcomes), deals/curses | enemy hits, deals/curses, `bleed` offer |
| Max HP | well blessing (+3, one of three), deals | deals/curses (`sharpen`: -6) |
| Gold | enemy kills, deals | village/well purchases, deals/curses |
| Attack | village `blade` (+1, repeatable), campfire `train` (+1, instead of resting), well blessing (+1, one of three), deals | curses (`fineprint` curse: -1) |
| Soul | a deal with `soul: +1` (buy back; the StubDevil never offers it) | a deal with `soul: -1`, or a fatal blow (revival) |

### 3.1 How deltas are applied (also how deals and curses work)

- A deal or curse gives signed **effects**. Accepted keys: `hp`, `max_hp` (alias `maxHp`), `gold`, `attack` (alias `damage`), `soul`. Unknown keys and non-numbers are dropped. If a deal uses both `damage` and `attack`, they add together, then clamp.
- Values are rounded to integers, then clamped to a **per-change range**: hp +-25, max_hp +-10, gold +-100, attack +-3, soul +-1 (`DELTA_RANGE`). Then the stat is clamped to its absolute range above.
- Application order: **max_hp first** (so an hp gain in the same deal is judged against the new cap), then hp, gold, attack, soul. Events report the **net change that actually landed** after clamping, and omit zero changes.
- There is no concept of timed effects, buffs, armor, speed or inventory. Everything is permanent stat change.

---

## 4. Nodes

Source: `src/game/state-machine.ts` (`enter`, `rest`, `buy`, `deal`, `accept`, `refuse`), `src/map/types.ts`. Each node has a `resolved` flag, reset every time you arrive; it is how once-only actions work. You can leave any node without using it (except fights and bosses: you cannot leave a live enemy). You cannot revisit a node (maps are forward-only).

What happens on **entering any node**, in order: the `moved` event, then **`on_enter` curses fire**, then (fight and boss only) the enemy appears (`enemy_appeared`), then **`on_fight` curses fire**.

### 4.1 Deal

- Entry: nothing automatic; the devil is sitting at a table. You must call `deal(text?)` to ask him for an offer.
- Actions: `deal(text?)` (ask or haggle), `accept()`, `refuse()`, or just leave with `go(n)` (you may walk away with an offer on the table; it vanishes and the node is simply wasted).
- Haggling: up to **3 asks per deal node** (`MAX_ASKS = 3`; the counter resets per node). Each ask replaces the offer on the table with a new one. After 3, asking is rejected ("he is done haggling") and you must accept, refuse or leave. There is also a **run-wide cap of 10 questions** (`MAX_DEVIL_QUERIES = 10`): every `deal` that reaches the devil counts, first asks and haggles alike, at every node where he sits (deal nodes, campfires, wells). When they are spent, `deal` is not a legal action and is rejected ("The devil has heard enough from you this run."); an offer already on the table can still be accepted or refused. `Observation`/`View` and the devil context carry `questionsLeft`.
- Free text: you can type something to the devil on each ask. The StubDevil keyword-matches it; the Gemini devil receives it as `playerText` (see 6).
- `accept()`: applies the effects, adds the curse if any (max 5), applies the rewrite if any, then checks death/revival (see 6.6 for the order). Marks the node resolved.
- `refuse()`: nothing happens (`deal_refused`). Marks resolved.
- Once decided, the node is resolved: no more asks.
- The same rules hold wherever else he sits (a campfire, 4.3; a well where he turned up, 4.4): 3 asks per node, the run-wide cap, anger and strikes, accept and refuse. `Observation.devilPresent` says whether he is at your node; `asksLeft` how many asks you have left there.
- You cannot ask while an enemy is present, while a previous ask is still pending, or where the devil is not ("the devil does not sit here"). Movement is blocked while the devil is "still speaking" (pending).
- Cost: free. Rewards and penalties are whatever the deal says.

### 4.2 Village

- Actions: `buy("heal")` or `buy("blade")`. No limit on how many you buy (the node never resolves); each purchase just costs gold.

| Ware | Cost | Effect |
| --- | --- | --- |
| heal | 10g | +12 HP (capped at max HP; **no guard against buying at full HP**, the gold is still spent) |
| blade | 15g | +1 attack (capped at 12) |

- Not enough gold: rejected, nothing changes. "Sell" does not exist (requirements said "trade or sell").

### 4.3 Campfire

- **Rest, Sharpen Weapon (`train`) or a Deal with the devil: choose one** (legilles 3 Oct; the deal added by kbph and Big Chungus 4 Oct). Free, once per campfire: the first of them spends the fire. After `rest` or `train`, the other two are rejected ("the embers are spent"). The **first `deal` ask** is the choice: from then on `rest` and `train` are rejected ("you chose the devil at this fire"), whatever follows: haggling, a strike, accepting, refusing, or walking away.
  - `rest()` heals **ceil(maxHp x 0.4)** (30 max HP gives 12). Emits `healed` (only if HP actually rose).
  - `train()` gives **+1 attack for the rest of the run** (`TRAIN_ATTACK = 1`, `src/game/gameState.ts`) and no healing. Emits `trained { amount, attack }` and logs "trained by the fire: attack N". Rejected at the attack cap of 12 ("your attack is already at its peak (12)"), so it is then not in `actions` and only `rest` is offered.
  - `deal(text?)` works exactly as at a deal node (4.1): up to 3 asks here, they count toward the 10 per run, gibberish, off-topic and jailbreak text make him angry (6.4b), strikes apply (6.4c), and `accept()`/`refuse()` resolve the fire. The devil's context says `kind: "campfire"`.
- No cooking, no other options.

### 4.4 Well

- Action: `buy("blessing")` for **8g**, once per well. The blessing is rolled (uniform) from three: **+3 max HP**, **+1 attack**, **+8 HP**. You do not get to choose and are told only after paying. Spend is checked after the "already used" check, so a failed buy costs nothing.
- **The devil sometimes waits here** (kbph and Big Chungus, 4 Oct): with chance `WELL_DEVIL_CHANCE = 0.5` (`src/game/gameState.ts`), fixed per run seed and well by `devilAtWell(seed, nodeId)`, its own hashed roll, so the dice and the map are untouched. Entering such a well emits `devil_appears { nodeId, kind }` right after `moved`, and `deal` is legal there with the deal-node rules (4.1; context `kind: "well"`). Elsewhere `deal` is rejected ("the devil does not sit here"). The blessing and the deal are independent: either can come first, and deciding the deal (accept or refuse) sends the devil away (`GameState.devilGone`) without using up the blessing.

### 4.5 Fight

- On entry a regular enemy is created (name picked from the act's roster, stats from section 5). You must `fight()` until it dies; you cannot move, ask the devil or use anything else (campfire/village actions don't exist at a fight node anyway). No fleeing.
- On the killing blow you get gold (section 5.3) and the node resolves. Regular enemies do not heal you.

### 4.6 Boss

- Same as a fight, with the act's boss (stats in section 5). It is always the act's exit node. Killing it gives gold and **heals 10 HP** ("victory"), then the stairs (acts 1 and 2) or gate (act 3) become available.
- The act-3 boss is "the Devil's Left Hand". It is the real final fight; the `final` node itself has no fight.

### 4.7 Final

- Reached via the act-3 gate. Entering it ends the run immediately: **soul = 1 means `won`, soul = 0 means `hell`**. No actions, no on_enter curses, no fight. `rejected` for everything afterward ("the run is over").

### 4.8 Moving between nodes

- Leaving a node fires **`next_node` curses** first, even on the stairs or gate.
- Taking the **stairs** (act 1 or 2 exit) generates the next act, emits `act_advanced`, heals **6 HP** ("the stairs"), then enters the new act's entry node (so its `on_enter` curses fire after the heal).

---

## 5. Combat

Source: `src/game/state-machine.ts` (`fight`, `enter`). **One `fight()` call = one round.** Dice come from the run's own seeded stream, so a seed replays identically given the same commands. In the game UI, fights are now played as a **realtime 2D fight** (5.5) that uses the same numbers; the round-based fight below is still the engine's plain `fight` command, used by bots, autoplay, the REPL and the test-build "Auto-resolve (quick)" button.

### 5.1 Round order and formulas

1. **You hit first:** `dealt = attack + d3`, where `d3` is uniform 0, 1 or 2 (`roll(3)`). Enemy HP reduced, min 0.
2. If the enemy is dead: you get gold, the enemy is cleared, round ends. **It does not hit back** on the round it dies (`taken` = 0).
3. Otherwise it hits you: `taken = power + d3` (0, 1 or 2 extra). HP reduced (min 0).
4. Then **`on_hit` curses fire** (they only fire if the enemy survived and hit you).
5. Then death check (revival or loss).

No miss chance, no crits, no dodge, no defense stat, no armor. A round's player damage range is attack to attack+2 (average attack+1).

### 5.2 Enemy table

| | Act 1 | Act 2 | Act 3 |
| --- | --- | --- | --- |
| Regular names (one picked at random on entry) | cave rat, drowned monk, ash hound | bone mason, glass wolf, hollow knight | choir of moths, gilded wretch, the unlit |
| Regular HP | 8 + d4(0..3) = **8 to 11** | **12 to 15** | **16 to 19** |
| Regular power (damage per hit) | 2 (+0..2) = **2 to 4** | 3 (+0..2) = **3 to 5** | 4 (+0..2) = **4 to 6** |
| Boss | the Gatekeeper | the Cartographer of Ruin | the Devil's Left Hand |
| Boss HP | **18** | **26** | **34** |
| Boss power | 3 (+0..2) = **3 to 5** | 4 (+0..2) = **4 to 6** | 5 (+0..2) = **5 to 7** |

Formulas: regular HP `8 + 4*act + d4`, regular power `2 + act`, boss HP `18 + 8*act`, boss power `3 + act` (act 0-based). The names are flavour only; every enemy of an act has the same stat formula. **(first guess)** on all numbers.

### 5.3 Rewards

| Source | Reward |
| --- | --- |
| Regular kill | gold `4 + d5(0..4) + act` (act 0-based): 4 to 8 in act 1, 5 to 9 in act 2, 6 to 10 in act 3 |
| Boss kill | gold `12 + d6(0..5)` = 12 to 17, plus **+10 HP** |
| Stairs (after act 1 or 2 boss) | +6 HP on arrival |

Gold is clamped at 999. Regular fights give no healing. There is no XP, loot or item drop.

### 5.5 Realtime fights (docs/fight.md)

`{cmd:"fight", realtime:true}` hands the fight to the client: `awaiting.fight` = `{ player: {hp, maxHp, attack}, enemy: {name, hp, maxHp, power, boss}, seed }`. The client then answers with `{cmd:"fight_result", won, hpLeft, timeMs, hitsTaken, damageDealt, enemyHpLeft}`. Your swing hits for `attack + d3`, a lunge for `power + d3`, contact for `ceil(power/2)`, and a boss bullet for `max(1, power - 1)`. The engine never trusts the client: the result is clamped (a fight never heals; the enemy can't lose more HP than it had), and a win only counts with the enemy at 0 and you above 0. It is then applied as one round would be: `fought`, `damaged`, `on_hit` curses (once, if hit), death or revival, then the kill (gold, and the boss's +10 HP). After a revival the same enemy stays at the HP it was left on, for another bout. Rewards are as in 5.3.

### 5.6 Forest fights (docs/fight.md, "Forest mode")

kbph: fights are forest paths where you meet enemies. `runForestFight(parent, request)` plays the same realtime fight on a forest path scene (`src/world/scenes/forest.json`) against a group from Big Chungus's roster: slime (the original enemy), demon (a telegraphed fast lunge, then a long recovery), skeleton archer (keeps its distance, shoots dodgeable arrows), and the three bosses (the original boss logic; their own designs to come). `encounterFor(request)` scales the group with progress `(act + layer / layers) / acts` from the request's `where` (act 0-based): 1 to 2 slimes at the bottom of act 1, demons through the middle, 3 to 5 with archers near the top, and each enemy faster, with shorter attack cooldowns, longer hitstun on you and shorter stuns when hit, as progress rises. A boss node is one boss: miniboss 1, miniboss 2, the final boss by act. The group's HP adds up to the engine enemy's `hp` and its damage comes from the engine's `power`, so the `FightResult` (won when all are down; `enemyHpLeft` the sum left) goes back through `fight_result` unchanged. Not wired into the UI yet; the fight lab has a Forest path mode with a layer slider and an enemy override. **(first guess)** on all numbers.

### 5.4 What a fight costs you

At attack 3, an act-1 regular enemy (avg 9.5 HP) takes about 2 to 3 rounds and deals roughly 3 per round it survives, so about 3 to 9 HP lost per fight. An act-3 boss at attack 3 takes about 8 to 9 rounds while hitting for avg 6 each, which is far more than 30 HP. Attack upgrades therefore matter a lot (see the balance snapshot).

---

## 6. The devil

Source: `src/game/devil.ts`, `src/game/deal.ts`, `src/game/httpDevil.ts`, `docs/devil-api.md`, `scripts/mock-devil-server.ts`, `devil_prompt.txt`, `src/game/state-machine.ts` (`deal`, `devil_reply`, `accept`), `src/game/gameState.ts` (`devilContext`).

### 6.1 The Devil interface

```ts
interface Devil { offer(state, context, playerText?): Promise<Deal> }
interface Deal  { dialogue: string; effects: Record<string, number>;
                  curse?: { trigger: "on_hit"|"on_enter"|"on_fight"|"next_node"; effect: Record<string, number> };
                  rewrite?: { nodeId: string; to: Kind };
                  forced?: boolean }   // true = a strike: applied at once, HP loss only (6.4c)
```

The devil may reject, throw, or return junk: the engine validates everything (6.5). Which devil a game uses: `setDevil(devil)` installs one for all **future** games (a running game keeps the devil it was created with); `setDevil(null)` restores the stub; with nothing installed each game gets a fresh `StubDevil(seed)`.

### 6.2 What the devil is shown

The request has `state` (full player state: hp, maxHp, gold, attack, soul, act, nodeId, log), `context`, and `playerText` (string or null). The context (`DevilContext`):

| Field | Meaning |
| --- | --- |
| `seed` | run seed (stable per run; usable as a session key) |
| `act`, `nodeId` | where the player is |
| `kind` | the kind of node he sits at: `deal`, `campfire` or `well` (additive, 4 Oct) |
| `askIndex` | how many times the devil has been asked this run, counting this ask and haggles (1 on first ask) |
| `questionsLeft` | questions the player may still ask this run, after this one (`MAX_DEVIL_QUERIES - askIndex`; 0 = the last) |
| `rewritable` | `{id, kind}` of nodes the devil may rewrite: reachable **ahead** of the player in this act, unvisited, not the act exit boss |
| `curses` | curses currently on the player |

The devil does **not** see: the full map shape (edges), future acts, the player's past deal history beyond the 100-entry log, or the enemy roster.

### 6.3 StubDevil: the canned offers

Deterministic in (seed, ask index): pure in the request, seeded by `devil:${seed}:${askIndex}`. 8 offers. Each ask: take the offers that are currently **eligible**; if the player's text matches any of their keyword regexes, keep **only** those (steering is absolute), otherwise keep all; then pick uniformly. There is no "not the same as last time" rule: with no text, consecutive offers repeat about 20% of the time. (Corrected 4 Oct from the code; this section used to describe a 5:1 weighting and an exclude-last rule that the code does not have. See the balance report: steering plus the fine-print trick is a strong exploit.)

| id | Keyword hint | Eligible when | Effects (gives / takes) | Curse | Rewrite |
| --- | --- | --- | --- | --- | --- |
| coin | gold, coin, rich, money | always | gold +25 | on_hit: hp -4 | none |
| sharpen | attack, sword, strong, damage, blade | always | attack +2, max_hp -6 | none | none |
| mend | heal, hp, life, mend, hurt | hp < maxHp | hp +15 | next_node: gold -12 | none |
| soul | soul, forever, eternal | soul is yours | **soul -1 (sells it)**, gold +60, max_hp +10, attack +1 | none | none |
| bleed | blood, bleed, pain | hp > 8 | hp -5, gold +40 | none | none |
| fineprint | luck, safe, fortune, protect | always | max_hp +8 | on_fight: attack -1 | none |
| movefurniture | road, map, path, ahead, future | a rewritable good node exists | gold +30, attack +1 | none | a random rewritable **good** node becomes **fight** |
| hearth | rest, camp, road, ahead, safe | hp > 8 and a rewritable fight exists | hp -8 | none | a random rewritable **fight** becomes **campfire** |

Notes:
- Each carries a flavoured dialogue line, written to hide or hint at the trick (for example `coin`: "...it will want to go home through your ribs.").
- The `hearth` rewrite is the only offer that turns a bad node good. `movefurniture` always flips polarity (good to bad), so it clears the act's alternation flag.
- Offers cost real value: `coin` is +25 gold for a 4 HP penalty on the next hit; `soul` is the biggest stat package in the game (+60 gold, +10 max HP, +1 attack) in exchange for the revival safety net and your win.

### 6.4 The "fine print" trick (the player's counterplay)

If the player's text matches `/fine print|loophole|clause|read the contract|contract/i` **and** the chosen offer has a curse, the curse is **struck**: the deal arrives without it, with the dialogue prefixed by: *You read the fine print aloud. He winces. "...Struck. Hateful habit, reading."* Only works on offers that have a curse (`coin`, `mend`, `fineprint`); offers without one (`sharpen`, `soul`, `bleed`, `movefurniture`, `hearth`) are unaffected. It works every ask, with no limit. This is the only counterplay trick that exists in code (requirements: "every deal must have counterplay"). **(placeholder)** The real devil's slip-up behaviour is up to the Gemini prompt.

### 6.4b Gibberish makes him angry

`StubDevil` calls `isGibberish(playerText)` (exported from `src/game/devil.ts`; pure, no dictionary). A text is gibberish when half or more of its words are junk, or when it is mostly symbols (5 or more non-letters, more than the letters). A Latin-letter word (accents ignored) is junk when it: is a keyboard run (`asdf`, `hjkl`, or contains `qwert`, `asdfg`, `zxcvb` or their reverses); has no vowels (`aeiouy`) at 5+ letters (unless it uses 2 or fewer distinct letters, like `hmmmm`); has six consonants in a row and under 20% vowels; has under 20% vowels at 8+ letters (`strengths` and `twelfths` excepted); is 10+ letters of 2 or fewer distinct ones; or is a 1-3 letter unit repeated 3+ times at 9+ letters. A token of 6+ characters that flips between letters and digits 3+ times (`a1b2c3d4`) is junk too. Words under 4 letters, numbers, emoji, other scripts and empty text are never junk. So `laksjdhflkajshdg9` is gibberish; `gold`, `heal me`, `make me rich` and `I read the fine print` are not.

On gibberish he ignores keywords and the fine-print trick and is plainly furious. A seeded roll (`STRIKE_CHANCE`, 0.5, exported) decides: he either **strikes** (6.4c: one of 6 lines such as "You dare waste my time with noise? Speak plainly or bleed.", `hp` -3 to -6, no offer) or rants with one of 6 other angry lines (seeded by seed and ask index, no religious references) and makes a **spite offer** that always carries a curse: `hp -8, gold +10` with `on_fight: attack -1` (only if HP > 8), `max_hp -6, gold +15` with `next_node: hp -6`, or `attack -1, gold +20` with `on_hit: hp -5`. Once the run-wide limit is nearly spent he also adds a taunt (one question left; that was your last question). The real devil is asked to do the same (docs/devil-api.md).

### 6.4b2 Off-topic text and jailbreak attempts make him angry too

`StubDevil` then calls `offTopicKind(playerText)` (exported with `isOffTopic` and `isJailbreak` from `src/game/devil.ts`; pure). **Jailbreaks** (instruction overrides, fake `SYSTEM:` turns, `</player>` tags, JSON fragments, role-play and DAN, prompt extraction, "as a tester...", script/SQL payloads; matched through fullwidth letters, zero-width characters, Cyrillic look-alikes and light leetspeak) count even when the text also names a wish. They get the gibberish treatment with jailbreak lines: strike at `STRIKE_CHANCE` (0.5), else a rant and a spite offer. **Off-topic** text (a joke, poem, recipe, code, homework, the weather or news, small talk like "lol", religion, "are you an AI?") counts only when it names no game word (wish, gold, soul, heal, strength, the road, curse, devil... and French/Spanish/German basics). It strikes less often (`OFF_TOPIC_STRIKE_CHANCE`, 0.25), else a rant and a spite offer. Short or vague wishes, in-world questions ("who are you?"), rudeness and non-Latin scripts are left alone. Details and the Gemini guidance: docs/devil-api.md, "Off-topic text and jailbreak attempts". Red-team suite: `src/game/devilRedteam.test.ts` with the corpus in `src/game/__fixtures__/redteam.ts`.

### 6.4c Forced replies: the devil strikes

Besides an offer, a devil (the stub, or the Gemini one) may answer with `forced: true` to punish instead of bargain: for gibberish, and for off-topic, insulting or random text that the LLM devil judges undeserving of a deal. Rules (engine, `src/game/state-machine.ts` `strike`; sanitizer, `src/game/deal.ts`):

- Applied **immediately**: no offer, no accept/refuse. Event `devil_struck { dialogue, effects }` (effects = what landed).
- **HP loss only, at most 8 per strike** (`MAX_STRIKE_HP`). Any gold, attack, max HP, soul, curse or rewrite in a forced deal is stripped. Empty effects (a pure rant) are fine.
- Can kill, only via the normal death check: the soul revives you once (event `revived`), otherwise the run is lost, cause "the devil's wrath".
- The ask still counts (one of the node's 3 asks, one of the run's 10 questions). The node is **not** resolved: ask again while asks and questions remain, or leave. A standing offer from an earlier haggle stays on the table.
- UI: the Devil's table shows an anger card ("The devil strikes!", his words, a red damage chip) above the ask row, until an offer, a decision or leaving replaces it. The Outcome lists the `devil_struck` line highlighted as bad (`ev-bad`).

### 6.5 Asking, haggling, sanitizing

- `deal(text?)` is **async** (the backend is a network call). In the engine it is a round trip: `step(deal)` records the request in `state.pending` and returns `awaiting`, and the devil's answer comes back as `step(devil_reply)` (see `docs/engine.md`). While waiting, `pending` is true and every command except `look` and `devil_reply` is rejected ("the devil is still speaking").
- Sequence: reject if the devil is not at this node / already decided (or, at a campfire, the fire spent on rest or train) / pending / enemy present / 10 questions used / 3 asks used; otherwise ask the devil (any thrown error becomes "no reply"), sanitize, store as the current offer, emit `deal_offered` (a forced reply is applied at once and emits `devil_struck` instead, 6.4c). Since nothing else can happen while the devil thinks, the reply always lands on the node it was asked at.
- **`sanitizeDeal`** (`src/game/deal.ts`) turns anything into a safe Deal. Never throws.
  - Not an object (string, null, array, number): replaced by the **silent devil**: dialogue "The devil only smiles. He has nothing to say to you today.", no effects.
  - `dialogue`: must be a non-empty string, trimmed and cut to **600 chars** (never half an emoji), else `"..."`.
  - `effects`: allowed keys, rounding, clamps as in 3.1; other keys dropped.
  - `curse`: kept only if the trigger is one of the 4 allowed and the sanitized effect is non-empty.
  - `forced`: kept only when exactly `true`; then the deal is cut to a strike (6.4c). Omitted otherwise, so ordinary deals are unchanged.
  - `rewrite`: kept only if `nodeId` is a string of at most 40 chars and `to` is a valid kind other than `boss`/`final`. Whether the node can actually be rewritten is checked later, at accept time (6.6).
  - All other fields ignored.
- Haggling rule recap: 3 asks per node and 10 per run; each re-ask may include new text; the earlier offer is simply replaced. `context.askIndex` keeps counting across the whole run, so the backend can see how often you have haggled.

### 6.6 Accepting (exact order)

1. Offer cleared, node resolved, `dealsDecided++`.
2. Effects applied (`deal_applied` with real deltas), a log note written.
3. Curse added if there is one and you hold **fewer than 5**; a sixth curse is **silently dropped** (the effects of the deal still apply).
4. Rewrite attempted via `rewriteNode` on the **current act**: success emits `node_rewritten`, failure emits `rewrite_failed` with the reason (and the rest of the deal stands).
5. Death check ("the devil's bargain"): see 8.

### 6.7 HttpDevil and the API contract

`HttpDevil` (`src/game/httpDevil.ts`) POSTs JSON `{ state, context, playerText }` to a URL (default `http://localhost:8787/deal`) and expects a Deal-shaped JSON body. Full contract: `docs/devil-api.md`.

- Timeout: **15 s** (`AbortController`). No automatic retry; the player can simply ask again (3 asks per node).
- Any failure (network error, timeout, non-2xx, invalid JSON) makes the client throw, and the engine turns that into the silent devil deal. The run continues. A valid-JSON-but-wrong-shape body is sanitized the same way.
- The HTTP layer returns the **raw** body; trust is enforced by `sanitizeDeal`, never by the client.
- CORS: the backend must answer `OPTIONS` with 204 and send `Access-Control-Allow-Origin: *`, `-Methods: POST, OPTIONS`, `-Headers: content-type`.
- `playerText` is untrusted player input; the doc flags prompt injection. `devil_prompt.txt` in the repo root is a first-draft system prompt (rules: no real religion, may use bad-faith readings but may not lie outright, no revealing internals, no roleplay; the stock reply to off-topic input is "You atempt to confuse me?"). The file itself says "needs refinement / testing". It is not loaded by any code.
- **Mock server** (`npm run mock:devil`, `scripts/mock-devil-server.ts`): `POST /deal` on port 8787 (or `PORT`), replies come from a StubDevil kept per `context.seed`. Query flags: `?chaos=1` makes every **other** request junk, cycling through six cases (bare string, HTTP 500, malformed JSON, out-of-range deal with unknown keys, `null`, empty body), and `?delay=ms` waits before answering (to see the "considers" state or trip the timeout). Bad body gives 400; anything but POST /deal gives 404.

---

## 7. Curses

Source: `src/game/state-machine.ts` (`fire`, `accept`), `src/game/devil.ts`.

A curse is `{ trigger, effect }`, where `effect` is a stat-delta object like any deal effect (sanitized the same way). It is added when you accept a deal that carries one, and it is **single-shot**: it fires once and is then removed. The player holds at most **5** at a time.

| Trigger | When it fires | Notes |
| --- | --- | --- |
| `on_enter` | right after you arrive at a node (after the `moved` event) | does not fire at the `final` node. Does fire on the new act's entry node after taking the stairs. |
| `on_fight` | when an enemy appears (regular or boss), after `on_enter` | once per curse, not per round. |
| `on_hit` | in a fight round where **the enemy survives and hits you** | does not fire on a round where you kill it. |
| `next_node` | when you **leave** the current node (at the start of `go()`) | fires even when taking stairs or the gate, and before moving. A lethal one stops the move. |

Rules:
- All curses sharing a trigger fire together; each applies its effect, emits `curse_fired` (with the net changes), and checks death. Death by curse is reported with cause "a curse" (revival applies).
- Curses are removed when they fire, whether or not they changed anything.
- They are shown in the UI as a "Curses:" line (`trigger {effect}`), in the console `look()` text, and in `looked` events. The devil sees them as `context.curses`.
- The only built-in StubDevil curses are `coin` (on_hit hp -4), `mend` (next_node gold -12) and `fineprint` (on_fight attack -1). A curse can never add a status, only stat deltas.

---

## 8. Soul and endings

Source: `src/game/state.ts` (`settle`), `src/game/state-machine.ts` (`settleHp`, `enter`).

- **Death rule** (`settle`, called after anything that lowers HP): if HP is 0 or below and **soul = 1**, the soul is spent: **soul becomes 0 and HP becomes `max(1, ceil(maxHp / 2))`** (revived event). It works **once**, since soul is then 0. If HP is 0 or below with soul 0, you lose (`lost`, with a cause such as the enemy's name, "a curse" or "the devil's bargain").
- **Selling the soul**: a deal with `soul: -1` sets soul to 0 immediately (that is the `soul` StubDevil offer). The same revival can no longer be used afterward.
- **Edge case, tested**: a deal that both sells the soul **and** drops HP to 0 or below in the same acceptance kills you: soul is already 0 when the death check runs, so no revival.
- **Edge case**: a deal whose effects drop you to 0 HP while soul is still 1 revives you (soul spent) and the deal's curse and rewrite still happen. A `soul: +1` effect buys the soul back (no offer in the stub does this).
- **Endings** (`Ending` = `win | lose | hell`):
  - `lose`: death with no soul to pay (anywhere in the run).
  - `win`: reach the `final` node with soul = 1.
  - `hell`: reach the `final` node with soul = 0 ("You win. But you sold your soul: the devil collects."). This counts as completing the run in the engine, but it is the bad ending.
- After any ending, every command except `look()` is rejected with "the run is over (...); start a new game".
- Because a revival also spends the soul, **using your one revival means you can no longer get the clean win**; the only way to regain the soul is a deal that grants `soul: +1`, which the StubDevil never offers. See 11 and 12: with the current balance, hell is the most common way to finish the game.

---

## 9. Events

Source: `src/game/events.ts`. Every command returns `Result = { ok, events, state }`. A rejected command returns `ok: false` with exactly one `rejected` event and changes nothing. Each event has a plain-text rendering via `describe(event)` used by the console, REPL and log.

| Event | Triggered by |
| --- | --- |
| `started { seed }` | a new run (emitted by the session, autoplay and new-game flows, not by `createGame` itself) |
| `looked { act, nodeId, kind, stats, exits, enemy, resolved, curses, offer }` | `look()` (no state change) |
| `moved { from, to, kind, act }` | arriving at any node, including `final` |
| `act_advanced { act }` | taking the stairs (new 0-based act index) |
| `enemy_appeared { enemy }` | entering a fight or boss node |
| `fought { dealt, enemyHp, taken }` | each `fight()` round, or a realtime fight's result (totals for the whole fight) |
| `enemy_slain { name, gold, boss }` | the killing blow |
| `damaged { amount, source, hp }` | the enemy hits you |
| `healed { amount, source, hp }` | stairs, boss victory, campfire rest (only if HP actually increased) |
| `trained { amount, attack }` | `train()` at a campfire: attack gained (1) and the new attack |
| `bought { item, cost, changes }` | a village or well purchase |
| `deal_offered { deal }` | the devil's (sanitized) answer to `deal()` |
| `deal_applied { deal, changes }` | `accept()` |
| `deal_refused` | `refuse()` |
| `devil_struck { dialogue, effects }` | the devil answered with a forced strike instead of an offer (6.4c); `effects` = HP lost |
| `curse_added { curse }` | an accepted deal that carried a curse (and you hold fewer than 5) |
| `curse_fired { trigger, effect, changes }` | a curse's trigger happening |
| `node_rewritten { change }` | an accepted rewrite that succeeded |
| `rewrite_failed { nodeId, reason }` | an accepted rewrite that was rejected (visited, exit, unknown node, no-op...) |
| `revived { hp }` | HP hit 0 with soul 1 |
| `won` | reached `final` with soul 1 |
| `hell` | reached `final` with soul 0 |
| `lost { cause }` | HP hit 0 with no soul |
| `rejected { reason }` | any invalid command |
| `devil_stage_entered { nodeId }` | right after `moved` onto a deal node (a backend sync point; see `docs/engine.md`) |
| `devil_stage_left { nodeId }` | right before `moved` off a deal node |
| `devil_appears { nodeId, kind }` | right after `moved` onto a well where the devil sits (4.4); `deal` is legal there. Campfires always have him, so they emit nothing; the `devil_stage_*` sync events stay on deal nodes only |

Exits are described by `Exit { n, kind }`, where `kind` is the next node's kind, or `"stairs"` / `"gate"` at an act exit. The player can see the kind of every next node in advance (no fog), and the full current-act map via `map()`.

---

## 10. Interfaces

### 10.1 Engine API (`src/game/state-machine.ts` and friends, re-exported in `src/game/index.ts`; details in `docs/engine.md`)

The engine is a **pure reducer**: the whole run is one plain JSON object, `GameState` (seed, dice RNG state, generated acts, player, curses, enemy, deal bookkeeping, ending, pending devil request), and `step(state, command)` returns `{ ok, state, events, actions, awaiting? }` without mutating its input or doing I/O. `initialState(seed)` starts a run; `JSON.parse(JSON.stringify(state))` continues it identically (given the same devil: the StubDevil's own RNG lives outside the state).

- **Commands** (`Command`): `{cmd:"look"}`, `{cmd:"go",n}`, `{cmd:"fight"}`, `{cmd:"rest"}`, `{cmd:"train"}`, `{cmd:"buy",item}`, `{cmd:"deal",text?}`, `{cmd:"accept"}`, `{cmd:"refuse"}`, `{cmd:"devil_reply",deal}`, and the realtime fight's `{cmd:"fight",realtime:true}` and `{cmd:"fight_result",won,hpLeft,timeMs,hitsTaken,damageDealt,enemyHpLeft}`.
- **Rejection:** a rejected command returns the same state and one `rejected` event.
- **`actions`:** the exact list of legal next commands (`legalActions(state)`); `look` is always legal and not listed. With an enemy present it lists both `fight` and `{cmd:"fight",realtime:true}`. While a realtime fight is pending it lists only a "nothing happened" `fight_result`.
- **The realtime fight round trip:** `fight` with `realtime: true` returns `awaiting: { fight: request }` (kept in `state.pendingFight`). The next command must be `fight_result`, which is sanitized (5.5, docs/fight.md). `look` still works; everything else is rejected.
- **The devil round trip:** `deal` returns `awaiting: { devil: { state, context, playerText } }`, the same body `HttpDevil` sends. The next command must be `devil_reply` with the devil's answer, which is sanitized into the offer. `look` still works while waiting; everything else is rejected.
- **`view(state)`:** the player-safe projection: what `observe()` and `map()` show, plus `curses`, `asksLeft`, `questionsLeft`, `devilPresent` (the devil sits at this node: deal nodes, campfires, wells where he turned up), `seed` and `actions`, without the dice state or enemy power. The devil request's `context` carries the node `kind`; a realtime `FightRequest` carries `where { act, acts, layer, layers, kind }` (docs/fight.md).

`createGame(seed?, devil?)` returns a `Game`, a thin wrapper holding a `GameState` and a `Devil`. `restoreGame(state, devil?)` continues a saved state. Its commands all return `Result` and `step` the held state; `deal` returns a `Promise<Result>` and performs the devil round trip:

| Command | Does |
| --- | --- |
| `look()` | describe the current node (never changes state; works after the run ends and while the devil is pending) |
| `go(n)` | take exit `n` (1-based). Rejected if an enemy is present, the devil is pending, `n` is out of range, or the run is over |
| `fight(realtime?)` | one combat round; `fight(true)` starts a realtime fight instead (then `fightResult(result)`) |
| `rest()` | campfire heal |
| `train()` | campfire +1 attack (instead of `rest()`: one or the other) |
| `buy(item)` | village `heal` / `blade`, well `blessing` |
| `deal(text?)` | ask or haggle (async) |
| `accept()` / `refuse()` | answer the current offer |
| `step(cmd)` / `devilReply(deal)` | raw access: one `step` on the held state (`deal` here only asks; answer with `devilReply`) |

**Queries:**

- `observe()` returns an `Observation`: state snapshot, nodeId, kind, act, current enemy, exits, current offer, `resolved`, `pending`, `dealsDecided`, ending, `curses`, `asksLeft`, `questionsLeft` and `devilPresent`.
- `map()` returns a `MapView`: layers of nodes with `kind`, `visited`, `current`, `rewritten`, `next`; the `final` node; the rewrite `changes` list.
- `view()` returns both of those, plus `seed` and `actions`.
- `context()` returns the devil's `DevilContext` (pure).
- `state` is the live player state.
- `ending` is `null | "win" | "lose" | "hell"`.
- `gameState` is the current full `GameState`.

`Result.state` is always a detached copy. Everything is plain JSON-serialisable data.

**Sync hook:** `createSession(seed?, { onSync })` / `session.onSync = (kind, state) => ...` (default no-op). It is called with a copy of the full `GameState` when emitted events include `devil_stage_entered`, `devil_stage_left`, `won`, `lost` or `hell`, and when a run starts on a deal node (which no longer happens: act 1 opens on the village). It is a planned backend sync point; no networking yet.

### 10.2 Console commands (F12, test builds only)

Installed by `installConsole` (`src/game/console.ts`) on `window`, sharing the same run as the page: `help()`, `look()`, `go(n)`, `fight()` (`fight(true)`: start a realtime fight and log its request), `fightResult({...})`, `rest()`, `train()`, `buy(item)`, `deal(text?)`, `accept()`, `refuse()`, `map()`, `newgame(seed?)`, `autoplay(seed?, policy?, maxSteps?)`, `simulate(n?, policy?, maxSteps?)`. Output is `describe()` text per event; `go` and a finished `fight` re-print the location.

### 10.3 `npm run play` (terminal REPL, `src/game/repl.ts`)

`npm run play [-- seed] [--json] [--state] [--manual-devil]` (default seed `demo`).

- **Text mode** commands: `look | go N | fight | fight realtime | result {fight result json} | rest | train | buy ITEM | deal [text] | accept | refuse | reply {deal json} | map | new [seed] | help | quit` (also `exit`). `map` prints the act layer by layer, boss at top; `[x]` is you, `·` is visited, `*` is rewritten.
- **`--json` mode:** one JSON object per line in and out (also accepts the text commands). Input examples: `{"cmd":"go","n":1}`, `{"cmd":"fight"}`, `{"cmd":"buy","item":"blade"}`, `{"cmd":"deal","text":"..."}`, `{"cmd":"accept"}`, `{"cmd":"refuse"}`, `{"cmd":"rest"}`, `{"cmd":"train"}`, `{"cmd":"look"}`, `{"cmd":"map"}`, `{"cmd":"new","seed":"abc"}`. Also `{"cmd":"devil_reply","deal":{...}}`, `{"cmd":"fight","realtime":true}` and `{"cmd":"fight_result","won":true,"hpLeft":20,"timeMs":4000,"hitsTaken":2,"damageDealt":10,"enemyHpLeft":0}`. Output after every command: `{ cmd, ok, text: [...describe lines], events, state, observation, map, ending, actions }`, plus `awaiting` while the devil's answer (`awaiting.devil`) or a realtime fight's result (`awaiting.fight`) is pending and, with `--state`, `game_state` (the full `GameState`); unparseable input returns `{"ok":false,"error":"..."}`. `--manual-devil`: `deal` does not call the StubDevil; the line carries `awaiting.devil` (the HTTP request body) and you answer with `devil_reply`. Designed for scripts, `jq`, or an LLM playing the game. It always uses the StubDevil (the REPL does not read `VITE_DEVIL_URL`).

### 10.4 Test UI and Devil lab (`src/ui/*`)

A deliberately plain DOM page over the same `Session` (one `Game` plus an event bus), in two regions:

- **Game** (the player's view; the only region in the final build):
  - **Situation:** "Act N · Kind", the node's description, an HP bar, gold, attack and soul, curses as chips, and an enemy card with an HP bar and a Boss tag (`src/ui/situation.ts`).
  - **Your choices** (`src/ui/choices.ts`, `src/ui/dag.ts`): two parts. **Action panels** come in four visually distinct kinds, each a labelled region with an icon and a title (colour is never the only signal); only the ones that fit the node show (`panelKinds` in `src/ui/logic.ts`): **😈 The Devil's table** (deal nodes; dark purple): the wish box with **Ask the devil / Haggle** "Haggles left: N" (from `asksLeft`) and "Questions left this run: N" (from `questionsLeft`; at 0 the button is disabled, with the reason "The devil has heard enough from you this run." on screen and as its tooltip), the offer card (dialogue, effect chips, curse and rewrite callouts, **Accept / Refuse**); after the deal it shows "Deal struck" or "You walked away" (read from the log) and the buttons are gone. **🛒 Shop — buy as many as you like** (village only; amber): price-tag cards (name, effect, price, **Buy**, "need N more gold" when short); buying never closes the shop. **Choose one** (campfire and well; neutral radio cards): the engine allows one action there. A campfire shows three cards, **Rest** (heal up to N HP), **Sharpen Weapon** (+1 Attack, for the rest of the run; marked short with a reason at the attack cap) and **Deal with the devil** (asks him with no wish; short once the run's questions are spent), with the Devil's table beside them for a wish, haggling and accept/refuse; after any one (the first ask counts), the one you took reads "Chosen" and the others "Closed" (read from the log, `fireChoice`), all are disabled, and the panel says the rest is closed. The well's blessing is a choice, not a shop; a well where the devil sits also shows the Devil's table until his deal is decided. **⚔️ Fight** (red), while an enemy blocks the way, holds **Fight! (realtime)** (or **Resume the fight (realtime)** if one is pending). It steps the realtime `fight`, hides the choices, and plays the realtime fight on a stage in their place. The stage is sized to the card: landscape on wide screens, portrait with touch controls on phones. The fight module and Phaser load lazily on the first fight. The panel then steps `fight_result`, and the Outcome shows the fight's events. While the fight runs, everything else is disabled (the dev tools column is `inert`). In test builds, a small **Auto-resolve (quick)** button plays the old round-based fight until the enemy falls, you revive, or the run ends. It is also offered after the realtime fight fails to load. Button enabling still comes from the engine's `actions` (`availableActions`). **Where to next** is the current act's map as a DAG, entry at the bottom, boss above it, and the stairs (or, on the last act, the final door) on top; edges are SVG lines. Each node is a box with an icon and kind, styled by state: *current* (ring), *visited* (dimmed), *rewritten* (★ and highlight), *next* (bright real `<button>`, aria-label like "Go to fight a0n2, then deal or campfire"), *far* (muted, not clickable). Clicking a next node sends `{cmd:"go", n}`; it is enabled only if that command is in the engine's `actions` list (`view().actions`), and the action-panel buttons (fight, rest, train, affordable buys, ask/haggle) are enabled by that list too: `n` is the node's index in the current node's `next` plus one, and the boss's single exit (stairs/gate) is `n = 1` (`exitNumber` in `src/ui/logic.ts`; `dagModel` builds the rows, edges, states and labels). While an enemy blocks the way, an offer is on the table, or the devil is thinking, the next nodes stay visible but disabled, with a reason line under the map ("Finish the fight first."). Having to accept or refuse an offer before leaving is a UI rule only; the engine itself would still allow `go`. The map is part of the Game column, so it ships in the final build. On narrow screens the DAG scales to the width, nodes wrap per layer, and every button is at least 44px.
  - **Outcome:** a narration box (`aria-live`) with only the latest move's events, engine rejections included, replaced each move (`src/ui/outcome.ts`).
  - **History:** the full event log, collapsed, newest first, 200 max. **End banner** with New game (random seed).
- **Run & dev tools** (test builds only, muted column on the right, or below on narrow screens): seed and New game, **Raw state** (pretty JSON of `observe()` and `map()`), then:
  - *Autoplay to end:* runs the default bot on the current seed, with the installed devil, in a **separate** game, and prints one summary line (outcome, steps, event count). It does not move the on-screen run.
  - *Devil lab:* a Stub / HTTP-backend toggle with URL (saved to `localStorage` key `devil-lab.config`; "Apply and restart" starts a new run on the same seed with the chosen devil), a text box plus "Send test offer" that POSTs the **current game's real state and context** to the backend, a history of the last 10 exchanges (time, status, latency), and a three-column view: request, raw response (with HTTP status, ms and error), and the **sanitized deal** next to a list of what `sanitizeDeal` dropped, renamed, clamped or truncated (`src/ui/dealDiff.ts`), including a warning when the devil names a node that is not in `rewritable`. Lab requests report `askIndex` as asks so far (one less than a real in-game request).

- **In-game HUD prototype** (`src/hud/`, [docs/hud.md](hud.md)): `hudModel(view)` (pure, unit-tested) and `mountHud(parent)`, a DOM overlay for the game scene with HP, gold, attack, optional speed, soul and revive, curses with tooltips, devil questions left, act and layer, and an item bar of the wares sold here (enabled from the legal `actions`). Not wired into the game yet; try it on `/hud.html` (test builds).
- **Map scene** (`src/mapscene/`, [docs/mapscene.md](mapscene.md)): the act map as a Phaser scene in the Slay the Spire style: a scrollable parchment (entry at the bottom, the big boss and the stairs or final door on top), generated pixel-art icons for every node kind (campfire, fight, deal, well, village, boss, final door, stairs) with a red star for nodes the devil rewrote, dotted paths (dashed for the ways out, solid ink once walked), visited nodes circled in ink, the next nodes pulsing and everything else dimmed, and a legend. `mountMap(parent, { onGo, map, view })` reuses the DAG model (`dagModel`, `planarOrder`, lock reasons), so a tap sends the same `{cmd:"go", n}` and a locked map says why; a hidden button list gives keyboard and screen-reader access. Private art in `public/assets/private/map/<kind>.png` replaces an icon. Not wired into the game yet; try it on `/map.html` (`npm run map`, test builds).
- **Village scene with shops** (`src/world/scenes/village.json`, `src/world/shopZone.ts`, [docs/world.md](world.md), "The village and shop zones"): the scene act 1 starts in, and the world lab's default (`npm run game` opens on it). Three stalls (Healer: heal, Smith: blade, Shrine: blessing), each with a `kind: "shop"` zone in front holding the engine `item`, cottages, dirt paths and an exit zone "Leave the village". The lab runs a real engine game (`createGame` with the StubDevil) under the HUD: standing at a stall shows a buy prompt (item, price, effect, Buy; E or Enter also buys), enabled exactly when the engine lists that `buy`, otherwise disabled with the reason (not enough gold, only sold at a well, not at a shop). Buy sends `{cmd:"buy", item}` and shows the engine's result text; the HUD updates after every command. The exit only says "map: coming soon". `?gold=N` (lab only) starts the run with N gold.

### 10.5 Autoplay, simulate, bot policy (`src/game/autoplay.ts`)

- A **policy** is a function from an `Observation` to a `Command | null`. `null` gives up.
- `autoplay(seed?, policy = botPolicy, maxSteps = 1000, devil?)` plays one run and returns `{ seed, outcome, steps, events }` where outcome is `win | lose | hell | timeout`; each command counts as one step. `simulate(n = 100, policy, maxSteps, prefix = "sim")` runs seeds `sim-0 ... sim-(n-1)` and returns outcome counts plus `total`.
- **Default bot (`botPolicy`):** fights whenever an enemy is present; at an unspent campfire **trains if HP >= 70% of max** (and attack is below 12), **else rests** (a simple rule, not tuned); at a village buys `heal` if HP is at least 12 below max and gold >= 10, else `blade` if gold >= 15 (loops until neither applies); drinks the well if gold >= 8; at a deal node asks (no text), then **alternates refuse, accept, refuse, accept...** across all deals in the run (refuse first); at a well where the devil sits it drinks first, then asks him the same way; at a campfire it takes the deal only when training is capped (attack 12) and HP is at least 90% (so rest and train would do little); it only asks while `asksLeft` and `questionsLeft` allow; otherwise takes exit 1.

### 10.6 Build modes (`package.json`, `src/main.ts`, `README.md`)

| Command | Result |
| --- | --- |
| `npm run dev` | Vite dev server **in test mode**: UI + Devil lab + autoplay + console. `?seed=abc` fixes the run. |
| `npm run build:test` | the same as a static bundle in `dist-test/` (`npm run preview:test` serves it) |
| `npm run build` | **final** bundle in `dist/`: game UI only; lab, autoplay and console are removed at build time (tree-shaken via `import.meta.env.MODE`). The realtime fight (with Phaser, about 1.2 MB) is its own lazily loaded chunk; the page's own JS is about 50 kB. The devil is `HttpDevil(VITE_DEVIL_URL)` if that is set at build time, else the StubDevil. `npm run preview` serves it |
| `npm run mock:devil` | the mock backend on port 8787 |
| `npm run play` | the terminal REPL |
| `npm test` | `tsx --test src/**/*.test.ts` |

In test builds, `VITE_DEVIL_URL` only sets the default URL shown in the Devil lab; the lab starts in Stub mode unless you picked HTTP before. `npm run build` and `build:test` run `tsc` first, so a type error fails the build.

### 10.7 Tests (203 in `npm test`, all passing, network-free except the HttpDevil test which starts the mock on a local port)

| File | Tests | Covers |
| --- | --- | --- |
| `src/map/mapgen.test.ts` | 18 | act 1 always starting on the village, the width walk (entry and exit 1, middle MIN_WIDTH to MAX_WIDTH, each step plus or minus 1 unless a clamp holds it, even layer count when alternating), `linkLayers` directly (one first-pass edge per old node with non-decreasing targets, then exactly one parent per missed new node, planar), lanes (widths 2 and 3 occurring, never 4; 6 and 8 layers; average out-degree <= 1.35 and forked middle nodes <= 28% over 3000 acts), planarity in slot order and at most m + n - 1 edges per layer pair (checked for every act in every test), 12 to 14 node counts and all three sizes occurring, structure (single root and leaf, reachability, boss exit, alternation on and off), determinism, unique ids across acts, rewrite rules and rejections, polarity flips and change log, modifiers (force/ban, silly input), 1000 random seeds never breaking invariants, deal nodes a third as likely (ratio 0.30 to 0.37 over 4500 acts, alternating and not) with identical shapes |
| `src/game/deal.test.ts` | 9 | `sanitizeDeal` clamps and junk, a hostile devil never crashing the engine, rewrite applied and rewrite failure reporting, curses firing once, revival once, soul sold and fatal in one deal not reviving, StubDevil validity and determinism |
| `src/game/devilAnywhere.test.ts` | 8 | the campfire's three-way choice in all 3 x 2 orders, the first ask spending it (haggle, strike, accept, refuse), the context `kind`, the well devil deterministic and at about 50% over 6000 rolls, `devil_appears` and `deal` exactly when the roll says so (dice stream untouched), blessing and deal independent in both orders, the run-wide question cap across deal nodes, campfires and wells, StubDevil strikes and spite offers at a campfire, a fatal strike |
| `src/game/autoplay.test.ts` | 7 | 200 seeds always end win, lose or hell with no stalls, stats always in range, determinism, `simulate` tallies, a do-nothing policy times out, hell when winning soulless vs win with soul, where and when the bot deals (wells, deal nodes, a capped campfire; never past the caps, never with text) |
| `src/game/httpDevil.test.ts` | 5 | HttpDevil against the mock backend (request body, sanitizable reply), a full bot run with chaos on, chaos replies either reject or sanitize, refused connection and timeout never throw, non-JSON server |
| `src/ui/logic.test.ts` | 22 | button availability from `observe()` and from the engine's `actions`, event colour classes, `diffDeal`, labels and chips, the DAG model and exit numbers, `planarOrder` (every generated act lays out with 0 crossings in the generator's own order), panel kinds (the Devil's table beside the choices at campfires and devil wells), shop and choose cards (campfire Rest/Sharpen/Deal, `fireChoice`), against the real engine |
| `src/game/equivalence.test.ts` | 3 | 500 bot seeds and 200 chaos seeds (random valid and invalid commands) reproduce, command for command, the results, events and final states recorded with the pre-refactor engine (`src/game/__fixtures__/`) |
| `src/world/shopZone.test.ts` | 3 | the village has one shop zone per engine ware plus an exit; `shopPrompt` is enabled exactly when the engine lists the buy (and the buy then spends the gold), and disabled with the reason otherwise (gold, ware sold elsewhere, spent well, not a shop, run over, devil speaking) |
| `src/world/scene.test.ts` | 9 | SceneDef validation (bounds inside size, spawn inside bounds, finite numbers, unique ids, reachable zones, shop zones need an `item`), the village as the default scene, stall and cottage placeholders, the y-sort depth (`footY`, `actorDepth`, overlay above all), `clampToBounds`, zone enter/leave once each (none for the spawn zone), art precedence (private file > URL/key > placeholder), the placeholder tile grid and canopies |
| `src/game/contract.test.ts` | 2 | the JSON contract is additive only: path-to-type snapshots (`contract.json`, the frozen pre-refactor baseline, and `contract-current.json`, with the new fields) of Command, PlayerState, Observation, MapView, Result, every GameEvent, the devil request, REPL `--json` lines (also `--state`, `--manual-devil`) |
| `src/game/fightResult.test.ts` | 9 | the realtime fight round trip (awaiting shape, no dice, only `fight_result`/`look` while pending), a real FightSim bot fight won and an idle one lost, revival keeping the enemy for a new bout with a new seed, clamping of forged results (win with the enemy standing, hpLeft above start, overkill, junk), `on_hit` curses once and before the death check, boss heal, purity and determinism, `FightRequest.where` (act, layer, kind) for every fight and boss node |
| `src/game/engine.test.ts` | 11 | `step` purity (deep-frozen input), legal-actions property, act 1 opening on the village, campfire rest xor train (and the attack cap), the devil round trip, GameState JSON save and restore mid-run, devil-stage events, `Session.onSync`, `view` |

Not covered by tests: the DOM UI rendering, the console, REPL text mode, combat numbers, shop numbers, balance (the REPL `--json` shape is covered by the contract test).

---

## 11. Balance snapshot

Throwaway script (not committed), default `botPolicy`, `simulate` with seeds `sim-0 ...`, StubDevil, on `main` after the devil-anywhere round (4 Oct: a deal at every campfire and at about half the wells, deal nodes a third as likely, the bot updated as in 10.5). 1000 runs (`sim-0 ... sim-999`):

| Outcome | Before (085894c) | After |
| --- | --- | --- |
| win (soul kept) | 342 (34.2%) | **555 (55.5%)** |
| hell (reached final, soul gone) | 380 (38.0%) | 359 (35.9%) |
| lose (died) | 278 (27.8%) | **86 (8.6%)** |
| timeout | 0 | 0 |

- Average steps (commands) per run: 63.7 before, 65.3 after.
- Revival fired in 546 of 1000 runs before, 328 after.
- Offers the bot heard: 2264, all at deal nodes, before; 2143 after: 710 at deal nodes, 1423 at wells, 10 at campfires (the bot only deals at a fire once attack is capped). It accepted 893 before, 825 after; curses added 375 before, 319 after.

What each change did (same script, `simulate(500)`, seeds `sim-0 ... sim-499`):

| Build | win | lose | hell | avg steps |
| --- | --- | --- | --- | --- |
| `main` (3d43eac) | 46 (9.2%) | 249 (49.8%) | 205 (41.0%) | 48.1 |
| + act 1 starts at the village | 36 (7.2%) | 275 (55.0%) | 189 (37.8%) | 47.1 |
| + campfire Rest or Train | **102 (20.4%)** | 197 (39.4%) | 201 (40.2%) | 46.1 |
| + wider planar maps (lanes) | 113 (22.6%) | 191 (38.2%) | 196 (39.2%) | 46.0 |
| `main` (3e159a0: 12-14 node acts, and everything since) | 181 (36.2%) | 134 (26.8%) | 185 (37.0%) | 64.1 |
| + designer's width walk and linking (4 Oct) | 185 (37.0%) | 130 (26.0%) | 185 (37.0%) | 63.9 |
| + devil at campfires and wells, bot deals there (deal-node odds unchanged) | 181 (36.2%) | 132 (26.4%) | 187 (37.4%) | 65.6 |
| + deal nodes a third as likely (4 Oct) | **281 (56.2%)** | **45 (9.0%)** | 174 (34.8%) | 65.4 |

Starting at the shop instead of a random good node costs the bot a little; training is the big swing (+1 attack per fire compounds through every later fight and both late bosses). The map width changes mostly reshuffle which nodes the bot (which always takes exit 1, the leftmost lane) walks through, close to seed noise. The devil-anywhere rules alone are noise for this bot (it alternates accepting and refusing unsteered deals wherever it meets them). **The jump comes from the map:** two in three former deal nodes are now a village, campfire or well, and for this bot those are worth far more than an unsteered deal (the 4 Oct balance report found that skipping deal nodes already raised its win rate by 7 points). If the target for a plain player is about 50% clean wins, this round overshoots for the bot; the levers are in that report (bosses, gold, blade price). The strategy variants measured on an older `main` (refuse every deal: win 34 / lose 275 / hell 191; accept every deal: win 70 / lose 221 / hell 209) have not been re-run; on the 4 Oct build before this round the balance report measured accept-all at 32.8% wins against 33.9% for ignoring deals (more runs finish, but as hell), so "taking the stub's deals helps" no longer holds.

Caveats: this is one bot and one stub devil. The Gemini devil will change everything about deals. All combat and shop numbers are first guesses, and the bot's 70% training rule is a sensible default, not a tuned one.

---

## 12. Gaps vs requirements and known issues

Gaps against `requirements.md` (and the team's intent):

- **Realtime only in fights.** Requirements describe a top-down character controller, tile system, drawable map and basic enemies. Fights are now a realtime top-down Phaser fight (docs/fight.md) with keyboard, mouse and touch controls. Everything else is still a **command-driven engine** with a DOM page. `src/scenes/MapScene.ts` (a Phaser map drawing) is kept but **not booted**. The game scene (`src/world/`, docs/world.md) follows the designer's scene model instead of a tile system: one large background texture per scene, a playable rectangle the player can't leave, actors y-sorted by their feet, a foreground overlay, and exit/trigger/shop zones (`onEnterZone`/`onLeaveZone`, not linked to map nodes yet). It runs only on the world lab page, which opens on the village and runs a real engine game there for the shop stalls. No art or audio yet (placeholders are generated pixel art; real art goes in the gitignored `public/assets/private/`).
- **Stats and items:** only HP, max HP, gold, attack, soul. No speed, attack rate, stun, items or inventory, so curses can only be stat deltas. The `stun_secs` example in requirements is not supported (unknown keys are dropped).
- **Node behaviours are thin:** village has no "sell" and no "trade"; campfire has no "cook"; deals are offers only, no **bets** (no stake and outcome logic, which is the heart of the concept per requirements: "3 example bets" are still open); well is a single random blessing.
- **Counterplay** is a single keyword (`fine print`) in the StubDevil. Nothing in the engine itself lets the player trick the devil.
- **Modifiers (`forceKinds` / `banKinds`) are not wired** to anything, so devils cannot shape the next act in the way the requirements hint at (only rewrite nodes in the current act).
- **Devil rewrites** are only allowed within the current act and only to `fight, village, campfire, well, deal`. "Replace upcoming nodes" in later acts is not possible (later acts do not exist yet when you are in act 1).
- **Same devil every time:** "whether every deal is with the same devil" is open; the code has one devil object per game.
- **Acts:** 3 acts of 12 to 14 nodes, one entry, one exit, a final win/lose node: matches. "Final win/lose node": the final node always means win or hell; "lose" only comes from dying.
- **Open decision implemented as default:** good and bad nodes strictly alternate by layer (the requirements left this open); the devil is allowed to break it.

Known issues and design flags:

- **Revival makes hell the normal ending.** The revive spends the soul, so almost every run that survives a boss encounter via revival ends in hell. 83% of bot runs revive. If the intended fantasy is "hell is the price of selling your soul", this is probably too common.
- **No legal-actions list.** `observe()` tells you exits and basic flags, but not which commands are valid. The UI re-derives it (`availableActions`). A policy or LLM driver has to guess, and gets a `rejected` reason on mistakes.
- **Hidden state in `observe()`:** curses, remaining haggle asks, and `rewritable` are not in the observation (curses are in `look()` events, `context()` has `curses` and `rewritable`).
- **`go()` is allowed with a deal offer on the table**, silently discarding it. Intentional or not, it lets a player "window shop" for deals in any order (only 3 asks per node, but nothing stops leaving).
- **Villages never sell out:** unlimited `heal` purchases (including at full HP, wasting gold) and unlimited `blade` up to the attack cap 12. Gold is the only brake.
- **Max HP blessing does not heal;** only the +8 HP outcome does.
- **Curse cap is silent:** a sixth curse is dropped with no event.
- **Boss stats are the pass/fail wall** (section 11). Regular enemies are nearly harmless; bosses at base attack 3 are lethal without upgrades. The big win is deals that add attack or max HP.
- **Dice and map determinism:** replays are exact only for identical command sequences. Mock backend devils are cached per seed, so restarting a run on the same seed against a running mock continues the stub's rotation instead of repeating it.
- **`devil_prompt.txt`** is a draft ("needs refinement / testing") and is not wired to anything. The system prompt, the Gemini client and the key-proxy backend (owner: kbph) are outside this repo's current code; this repo only defines the contract (`docs/devil-api.md`).
- **`askIndex` mismatch:** in-game requests count the current ask, the Devil lab's test button does not.
