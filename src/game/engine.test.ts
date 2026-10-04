import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../map";
import { botPolicy, execute } from "./autoplay";
import { legalActions } from "./actions";
import { StubDevil, type Devil } from "./devil";
import type { GameEvent } from "./events";
import { devilContext, initialState, type Command, type GameState, type StepResult } from "./gameState";
import { createGame, restoreGame } from "./run";
import { createSession, type SyncKind } from "./session";
import { snapshot } from "./state";
import { step } from "./state-machine";
import { view } from "./view";
import { MAX_DEAL_GOLD } from "./economy";

const deepFreeze = <T>(x: T): T => {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) deepFreeze(v); }
  return x;
};
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Pure-API driver: random legal moves, the devil answered by a StubDevil. Yields every (state before, command, result). */
async function* randomPlay(seed: string, maxSteps = 300): AsyncGenerator<{ before: GameState; cmd: Command; r: StepResult }> {
  const rng = mulberry32(seed.length * 31 + seed.charCodeAt(seed.length - 1));
  const devil = new StubDevil(seed);
  let s = initialState(seed);
  for (let i = 0; i < maxSteps && !s.ending; i++) {
    const acts = legalActions(s);
    assert.ok(acts.length > 0, `${seed}: no legal action in a live run`);
    let cmd = acts[Math.floor(rng() * acts.length)];
    if (cmd.cmd === "deal") cmd = { cmd: "deal", text: ["gold", "I read the fine print", "", "soul"][Math.floor(rng() * 4)] };
    if (cmd.cmd === "devil_reply") { const q = s.pending!; cmd = { cmd: "devil_reply", deal: await devil.offer(q.state, q.context, q.playerText ?? undefined) }; }
    if (cmd.cmd === "fight_result") { // a realtime fight: won, lost, the listed no-op, or junk
      const f = s.pendingFight!, k = Math.floor(rng() * 4), hp = 1 + Math.floor(rng() * f.player.hp);
      if (k === 0) cmd = { cmd: "fight_result", won: true, hpLeft: hp, hitsTaken: f.player.hp - hp, timeMs: 3000, damageDealt: f.enemy.hp, enemyHpLeft: 0 };
      else if (k === 1) cmd = { cmd: "fight_result", won: false, hpLeft: 0, hitsTaken: 9, timeMs: 5000, damageDealt: 1, enemyHpLeft: f.enemy.hp - 1 };
      else if (k === 2) cmd = { cmd: "fight_result", won: "yes", hpLeft: NaN, hitsTaken: -4, enemyHpLeft: 1e9 };
    }
    const before = s;
    const r = step(s, cmd);
    yield { before, cmd, r };
    s = r.state;
  }
}

const PLAUSIBLE: Command[] = [
  { cmd: "go", n: 0 }, { cmd: "go", n: 1 }, { cmd: "go", n: 2 }, { cmd: "go", n: 3 }, { cmd: "go", n: 4 }, { cmd: "go", n: "" as unknown as number },
  { cmd: "fight" }, { cmd: "rest" }, { cmd: "train" }, { cmd: "buy", item: "heal" }, { cmd: "buy", item: "blade" }, { cmd: "buy", item: "blessing" },
  { cmd: "buy", item: "sword" }, { cmd: "buy" }, { cmd: "deal" }, { cmd: "accept" }, { cmd: "refuse" }, { cmd: "devil_reply", deal: null },
  { cmd: "dance" } as unknown as Command,
];
const same = (a: Command, b: Command) => JSON.stringify(a) === JSON.stringify(b);

test("step is pure: never mutates its (deep-frozen) input, and a rejected command returns the very same state", async () => {
  for (let i = 0; i < 40; i++) {
    for await (const { before, cmd } of randomPlay(`pure-${i}`)) {
      const frozen = deepFreeze(structuredClone(before)), json = JSON.stringify(frozen);
      const r = step(frozen, cmd); // would throw in strict mode on any write
      assert.equal(JSON.stringify(frozen), json);
      assert.ok(r.ok);
      const bad = step(frozen, { cmd: "dance" } as unknown as Command);
      assert.equal(bad.ok, false);
      assert.equal(bad.state, frozen);
      assert.deepEqual(bad.events.map((e) => e.type), ["rejected"]);
    }
  }
});

test("actions: every listed action is accepted; unlisted plausible commands are rejected", async () => {
  let checked = 0;
  for (let i = 0; i < 60; i++) {
    for await (const { before } of randomPlay(`act-${i}`)) {
      const listed = legalActions(before);
      for (const c of listed) assert.ok(step(before, c).ok, `listed ${JSON.stringify(c)} was rejected`);
      for (const c of PLAUSIBLE) if (!listed.some((l) => same(l, c) || (l.cmd === c.cmd && c.cmd !== "go" && c.cmd !== "buy"))) {
        const r = step(before, c);
        assert.equal(r.ok, false, `unlisted ${JSON.stringify(c)} was accepted at ${before.player.nodeId}`);
        assert.equal(r.state, before);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `only ${checked} rejections checked`);
});

test("actions: [] once over, only devil_reply (or fight_result) while awaiting; every step result and view carry them", async () => {
  for (let i = 0; i < 20; i++) {
    for await (const { r } of randomPlay(`aw-${i}`)) {
      assert.deepEqual(r.actions, legalActions(r.state));
      assert.deepEqual(view(r.state).actions, r.actions);
      if (r.state.ending) assert.deepEqual(r.actions, []);
      if (r.awaiting?.devil) assert.deepEqual(r.actions, [{ cmd: "devil_reply", deal: null }]);
      if (r.awaiting?.fight) assert.deepEqual(r.actions.map((c) => c.cmd), ["fight_result"]);
    }
  }
});

/** A fresh run whose act-1 entry is swapped to a deal node (test-only: the real map always opens on the village). */
const onDeal = (seed: string): GameState => { const s = initialState(seed); s.acts[0].nodes[0].kind = "deal"; return s; };

test("act 1 always opens on the village (the shop), never at the devil's table", () => {
  for (let i = 0; i < 300; i++) {
    const v = view(initialState(`start-${i}`));
    assert.equal(v.kind, "village");
    assert.ok(v.actions.some((c) => c.cmd === "buy"), "the starting gold buys something");
  }
});

test("campfire: rest OR train, never both; train is +1 attack for good, capped, and only at a fire", () => {
  const atFire = (seed: string): GameState => { const s = initialState(seed); s.acts[0].nodes[0].kind = "campfire"; return s; };
  const s = atFire("fire");
  s.player.hp = 10;
  assert.deepEqual(legalActions(s).slice(0, 2), [{ cmd: "rest" }, { cmd: "train" }], "listed right after fight, before buys");
  const t = step(s, { cmd: "train" });
  assert.ok(t.ok);
  assert.deepEqual(t.events, [{ type: "trained", amount: 1, attack: s.player.attack + 1 }]);
  assert.equal(t.state.player.attack, s.player.attack + 1);
  assert.equal(t.state.player.hp, 10, "training does not heal");
  assert.ok(t.state.resolved);
  for (const c of [{ cmd: "rest" }, { cmd: "train" }] as Command[]) assert.deepEqual(step(t.state, c).events, [{ type: "rejected", reason: "the embers are spent" }]);
  assert.ok(!t.actions.some((c) => c.cmd === "rest" || c.cmd === "train"));
  const r = step(s, { cmd: "rest" });
  assert.ok(r.ok && r.state.resolved && r.state.player.hp > 10 && r.state.player.attack === s.player.attack);
  assert.equal(step(r.state, { cmd: "train" }).ok, false, "rested: no training after");
  const capped = atFire("fire"); capped.player.attack = 12;
  assert.match((step(capped, { cmd: "train" }).events[0] as { reason: string }).reason, /peak \(12\)/);
  assert.ok(legalActions(capped).some((c) => c.cmd === "rest") && !legalActions(capped).some((c) => c.cmd === "train"));
  assert.deepEqual(step(initialState("fire"), { cmd: "train" }).events, [{ type: "rejected", reason: "there is no fire here" }]);
});

test("deal awaits the devil with the HttpDevil request shape; only devil_reply (or look) continues", () => {
  let s = onDeal("demo");
  assert.equal(view(s).kind, "deal");
  const asked = step(s, { cmd: "deal", text: "gold" });
  assert.ok(asked.ok && asked.awaiting);
  assert.deepEqual(asked.events, []);
  s = asked.state;
  assert.deepEqual(asked.awaiting.devil, { state: snapshot(s.player), context: devilContext(s), playerText: "gold" });
  assert.equal(asked.awaiting.devil.context.askIndex, 1);
  assert.deepEqual(s.pending, asked.awaiting.devil);
  for (const c of PLAUSIBLE.filter((c) => c.cmd !== "devil_reply")) {
    const r = step(s, c);
    assert.equal(r.ok, false); assert.equal(r.state, s); assert.ok(r.awaiting);
  }
  assert.ok(step(s, { cmd: "look" }).ok, "look still works while the devil thinks");
  const replied = step(s, { cmd: "devil_reply", deal: { dialogue: "x", effects: { gold: 1e9 }, junk: 1 } });
  assert.ok(replied.ok && !replied.awaiting && replied.state.pending === null);
  assert.deepEqual(replied.events, [{ type: "deal_offered", deal: { dialogue: "x", effects: { gold: MAX_DEAL_GOLD } } }]);
  assert.equal(step(replied.state, { cmd: "devil_reply", deal: {} }).ok, false, "no second reply");
});

test("GameState JSON round-trip mid-run continues identically (pure step)", async () => {
  for (let i = 0; i < 30; i++) {
    const trace: Array<{ before: GameState; cmd: Command; r: StepResult }> = [];
    for await (const x of randomPlay(`rt-${i}`)) trace.push(x);
    for (const k of [0, 1, Math.floor(trace.length / 2), trace.length - 1]) {
      let s = roundTrip(trace[k].before);
      assert.deepEqual(s, trace[k].before);
      for (const { cmd, r } of trace.slice(k)) {
        const q = step(s, cmd);
        assert.deepEqual(q, r);
        s = roundTrip(q.state);
      }
    }
  }
});

test("Game: save mid-run, restore from JSON with the same devil, and the rest of the run is identical", async () => {
  const play = async (seed: string, devil: Devil, cut?: number) => {
    let g = createGame(seed, devil);
    const events: GameEvent[] = [];
    for (let n = 0; !g.ending && n < 1000; n++) {
      if (n === cut) g = restoreGame(roundTrip(g.gameState), devil);
      events.push(...(await execute(g, botPolicy(g.observe())!)).events);
    }
    return { events, final: roundTrip(g.gameState) };
  };
  for (let i = 0; i < 40; i++) {
    const seed = `save-${i}`, whole = await play(seed, new StubDevil(seed));
    for (const cut of [1, 7, 20]) assert.deepEqual(await play(seed, new StubDevil(seed), cut), whole, `${seed} cut at ${cut}`);
  }
});

test("devil stage events bracket deal nodes; endings stay last", async () => {
  for (let i = 0; i < 100; i++) {
    let s = initialState(`stage-${i}`);
    const all: GameEvent[] = [];
    for await (const { r } of randomPlay(`stage-${i}`)) { all.push(...r.events); s = r.state; }
    all.forEach((e, j) => {
      const prev = all[j - 1];
      if (e.type === "devil_stage_entered") assert.ok(prev.type === "moved" && prev.kind === "deal");
      if (e.type === "devil_stage_left") assert.equal(all[j + 1].type, "moved");
      if (e.type === "moved" && e.kind === "deal") assert.equal(all[j + 1]?.type, "devil_stage_entered");
    });
    if (s.ending) assert.ok(["won", "lost", "hell"].includes(all[all.length - 1].type));
  }
});

test("Session.onSync fires on entering/leaving the devil's table and on the ending, with the full state", async () => {
  const seen: Array<[SyncKind, GameState]> = [];
  let session = createSession("demo", { onSync: (k, st) => seen.push([k, st]) });
  assert.equal(seen.length, 0, "act 1 opens on the village: nothing to sync at the start");
  let g = session.game();
  for (let i = 0; !seen.some(([k]) => k === "devil_stage_left") && i < 50; i++) { // a bot run that sits at the devil's table
    seen.length = 0;
    session = createSession(`sync-${i}`, { onSync: (k, st) => seen.push([k, st]) });
    g = session.game();
    for (let n = 0; !g.ending && n < 1000; n++) session.emit((await execute(g, botPolicy(g.observe())!)).events);
  }
  const kinds = seen.map(([k]) => k);
  assert.ok(kinds.includes("devil_stage_entered") && kinds.includes("devil_stage_left"));
  assert.ok(["won", "lost", "hell"].includes(kinds[kinds.length - 1]));
  const [, last] = seen[seen.length - 1];
  assert.deepEqual(last, g.gameState);
  assert.notEqual(last, g.gameState, "a copy, not the live state");
  assert.doesNotThrow(() => createSession("x").emit([{ type: "won" }]), "default hook is a no-op");
});

test("view: player-safe projection with curses and haggles left, no dice or enemy power", () => {
  const g = restoreGame(onDeal("demo"));
  const v = g.view();
  assert.equal(v.asksLeft, 3);
  assert.equal(createGame("demo").view().asksLeft, 0, "not at a deal node");
  assert.deepEqual(v.curses, []);
  assert.deepEqual({ ...g.observe() }, Object.fromEntries(Object.keys(g.observe()).map((k) => [k, (v as unknown as Record<string, unknown>)[k]])));
  assert.deepEqual(v.map, g.map());
  const text = JSON.stringify(v);
  assert.ok(!text.includes('"rng"') && !text.includes('"power"') && !text.includes('"pending":{'));
});
