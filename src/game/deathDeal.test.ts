/**
 * Death's door (Big Chungus, 4 Oct): dying with the soul no longer revives on its own. The devil comes for the soul: his
 * opener is the soul for another life; the player accepts, haggles for extras (priced on top), or refuses and dies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { botPolicyAtDeath, execute, simulate } from "./autoplay";
import { dealValue } from "./dealValue";
import { DEATH_LINES, StubDevil, deathOffer } from "./devil";
import { MAX_ASKS, MAX_DEVIL_QUERIES, devilContext, initialState, type GameState } from "./gameState";
import { hashSeed, mulberry32 } from "../map";
import { restoreGame } from "./run";
import { step } from "./state-machine";
import { reviveHp, type PlayerState } from "./state";
import { view } from "./view";

const RAT = { name: "cave rat", hp: 10, maxHp: 10, power: 2, boss: false };
const types = (es: Array<{ type: string }>) => es.map((e) => e.type);

/** A run facing a rat, then a lost realtime fight: HP 0. */
function lostFight(seed = "death", soul: 1 | 0 = 1): ReturnType<typeof step> {
  const s = initialState(seed);
  s.enemy = { ...RAT };
  s.player.soul = soul;
  const started = step(s, { cmd: "fight", realtime: true });
  return step(started.state, { cmd: "fight_result", won: false, hpLeft: 0, timeMs: 5000, hitsTaken: 4, damageDealt: 3, enemyHpLeft: 7 });
}
/** Answer the pending request with the StubDevil, as the game does. */
async function answer(s: GameState): Promise<ReturnType<typeof step>> {
  const req = s.pending!;
  return step(s, { cmd: "devil_reply", deal: await new StubDevil().offer(req.state, req.context, req.playerText ?? undefined) });
}

test("death with the soul: no automatic revival; the devil's request is pending (kind death, his free opener)", () => {
  const r = lostFight();
  assert.ok(r.ok);
  assert.deepEqual(types(r.events), ["fought", "damaged", "devil_at_death"]);
  assert.deepEqual(r.events[2], { type: "devil_at_death", cause: "cave rat", nodeId: r.state.player.nodeId });
  assert.equal(r.state.player.hp, 0);
  assert.equal(r.state.player.soul, 1, "not spent yet");
  assert.equal(r.state.ending, null);
  assert.equal(r.awaiting?.devil?.context.kind, "death");
  assert.equal(r.awaiting?.devil?.context.opening, true);
  assert.equal(r.awaiting?.devil?.playerText, null);
  assert.equal(r.state.totalAsks, 0, "the opener costs no question");
  assert.deepEqual(r.actions, [{ cmd: "devil_reply", deal: null }]);
  assert.equal(view(r.state).dying, true);
});

test("the stub's opener at death: the soul for the old revival's HP, nothing else", async () => {
  const r = await answer(lostFight().state);
  assert.deepEqual(types(r.events), ["deal_offered"]);
  assert.deepEqual(r.state.offer, { dialogue: DEATH_LINES.open, effects: { soul: -1, hp: 15 } });
  const v = view(r.state);
  assert.equal(v.dying, true);
  assert.deepEqual(v.exits, [], "no walking away from death");
  assert.deepEqual(v.actions.map((c) => c.cmd), ["deal", "accept", "refuse"]);
  assert.equal(step(r.state, { cmd: "fight" }).ok, false, "no fighting on until it is settled");
});

test("accept: revived with the soul gone, at the old revival's HP; the run goes on and the enemy is still there", async () => {
  const r = step((await answer(lostFight().state)).state, { cmd: "accept" });
  assert.ok(r.ok);
  assert.deepEqual(types(r.events), ["deal_applied", "revived"]);
  assert.equal(r.state.player.soul, 0);
  assert.equal(r.state.player.hp, reviveHp(30));
  assert.equal(r.state.ending, null);
  assert.equal(r.state.dying, null);
  assert.equal(r.state.dealsDecided, 0, "not a node's deal");
  assert.ok(r.state.player.log.some((l) => l.startsWith("soul spent on a revival")), "the HUD reads this line");
  assert.equal(r.state.enemy?.hp, 7);
  assert.ok(r.actions.some((c) => c.cmd === "fight"));
});

test("refuse: the death stands, with the soul kept: the lose ending", async () => {
  const r = step((await answer(lostFight().state)).state, { cmd: "refuse" });
  assert.deepEqual(types(r.events), ["deal_refused", "lost"]);
  assert.deepEqual(r.events[1], { type: "lost", cause: "cave rat" });
  assert.equal(r.state.ending, "lose");
  assert.equal(r.state.player.soul, 1);
  assert.deepEqual(r.actions, []);
});

test("death without the soul: the old rule, the run is lost at once", () => {
  const r = lostFight("death-soulless", 0);
  assert.deepEqual(types(r.events), ["fought", "damaged", "lost"]);
  assert.equal(r.state.ending, "lose");
  assert.equal(r.awaiting, undefined);
});

test("haggling at death: each extra is priced on top (dealValue <= 0), the price climbs, and accepting still revives", async () => {
  const wishes = ["gold please", "a sharper sword", "more max health", "something better", "I read the fine print, more gold"];
  for (const seed of ["h-0", "h-1", "h-2", "h-3"]) for (const progress of [0, 0.4, 0.8]) for (const maxHp of [20, 30, 45]) for (const wish of wishes) {
    const dying: PlayerState = { hp: 0, maxHp, gold: 5, attack: 4, soul: 1, act: Math.floor(progress * 3), nodeId: "a0n1", log: [] };
    const woken: PlayerState = { ...dying, soul: 0, hp: reviveHp(maxHp) };
    for (const haggle of [1, 2]) {
      const ctx = { ...devilContext(initialState(seed)), kind: "death" as const, progress, haggle, askIndex: haggle };
      const d = deathOffer(dying, ctx, wish, mulberry32(hashSeed(`${seed}:${wish}`)));
      if (d.forced) continue;
      assert.equal(d.effects.soul, -1, "the soul is always the price");
      const extras = { ...d, effects: { ...d.effects, soul: 0, hp: (d.effects.hp ?? 0) - Math.min(reviveHp(maxHp), 25) } };
      assert.ok(dealValue(extras, woken, ctx) <= 0, `${seed} p${progress} ${wish}: extras ${JSON.stringify(extras)} = ${dealValue(extras, woken, ctx)}`);
      assert.ok(dealValue(d, dying, ctx) <= 0, "the whole package favours the devil");
    }
  }
  // through the engine: a haggle is a question, the extra lands with its price, and you wake alive without the soul
  const opened = await answer(lostFight("h-engine").state);
  const asked = step(opened.state, { cmd: "deal", text: "a sharper sword" });
  assert.equal(asked.state.totalAsks, 1);
  assert.equal(asked.awaiting?.devil?.context.haggle, 1);
  assert.equal(asked.awaiting?.devil?.context.kind, "death");
  const offered = await answer(asked.state);
  assert.equal(offered.state.offer?.effects.attack, 1, "the extra asked for");
  const took = step(offered.state, { cmd: "accept" });
  assert.equal(took.state.player.soul, 0);
  assert.equal(took.state.player.attack, 4);
  assert.ok(took.state.player.hp > 0);
  assert.ok(took.state.player.maxHp < 30 || took.state.curses.length > 0, "and its price");
});

test("death's door respects the question limits: MAX_ASKS haggles here, and the run-wide MAX_DEVIL_QUERIES", async () => {
  let s = (await answer(lostFight("cap").state)).state;
  for (let i = 0; i < MAX_ASKS; i++) {
    const r = step(s, { cmd: "deal", text: "more gold" });
    assert.ok(r.ok, `haggle ${i + 1}`);
    s = (await answer(r.state)).state;
    if (!s.dying) return; // a strike took the soul: nothing left to cap (not with this seed, but stay honest)
  }
  assert.equal(step(s, { cmd: "deal", text: "more gold" }).ok, false);
  assert.ok(step(s, { cmd: "accept" }).ok, "the last offer can still be taken");
  // run-wide: one question left, then none
  const near = (await answer(lostFight("cap-run").state)).state;
  near.totalAsks = MAX_DEVIL_QUERIES - 1;
  const last = await answer(step(near, { cmd: "deal", text: "gold" }).state);
  assert.equal(last.state.totalAsks, MAX_DEVIL_QUERIES);
  const no = step(last.state, { cmd: "deal", text: "gold" });
  assert.equal(no.ok, false);
  assert.deepEqual(no.events, [{ type: "rejected", reason: "The devil has heard enough from you this run." }]);
  assert.deepEqual(last.actions.map((c) => c.cmd), ["accept", "refuse"]);
});

test("a strike at death's door: he takes the soul anyway, for 1 HP and no extras; the run goes on", () => {
  const s = lostFight("strike").state;
  const r = step(s, { cmd: "devil_reply", deal: { dialogue: "Noise!", effects: { hp: -6 }, forced: true } });
  assert.deepEqual(types(r.events), ["devil_struck", "revived"]);
  assert.equal(r.state.player.soul, 0);
  assert.equal(r.state.player.hp, 1);
  assert.equal(r.state.ending, null);
  assert.equal(r.state.dying, null);
});

test("the engine holds the bargain whatever the devil says: junk, silence or a soul gift still sells the soul and revives", () => {
  for (const junk of [null, "x", { dialogue: "y", effects: {} }, { dialogue: "z", effects: { soul: 1, hp: -25, gold: 30 } }]) {
    const offered = step(lostFight("junk").state, { cmd: "devil_reply", deal: junk });
    const r = step(offered.state, { cmd: "accept" });
    assert.equal(r.state.player.soul, 0, JSON.stringify(junk));
    assert.equal(r.state.player.hp, reviveHp(30), JSON.stringify(junk));
    assert.equal(r.state.ending, null);
  }
});

test("a deal node's standing offer survives a death there: it is back on the table after the revival", () => {
  const s = initialState("standing");
  s.acts[0].nodes[0].kind = "deal";
  s.player.hp = 3;
  const offer = { dialogue: "Stay.", effects: { gold: 5 } };
  const asked = step(step(s, { cmd: "deal" }).state, { cmd: "devil_reply", deal: offer });
  const struck = step(step(asked.state, { cmd: "deal", text: "gold" }).state, { cmd: "devil_reply", deal: { dialogue: "Bleed.", effects: { hp: -5 }, forced: true } });
  assert.ok(struck.state.dying);
  const back = step(step(struck.state, { cmd: "devil_reply", deal: { dialogue: "Soul.", effects: { soul: -1, hp: 15 } } }).state, { cmd: "accept" });
  assert.deepEqual(back.state.offer, offer);
});

test("the bot terminates at death's door, whatever it does there (accept, haggle, refuse)", async () => {
  for (const p of ["accept", "haggle", "refuse"] as const) {
    const t = await simulate(40, botPolicyAtDeath(p), 1000, `death-bot-${p}`);
    assert.equal(t.timeout, 0, p);
    assert.equal(t.total, 40);
  }
  // execute answers the death's-door request itself, so a policy always sees his offer
  const g = restoreGame(lostFight("exec").state);
  assert.equal(g.observe().offer, null);
  await g.answerDevil();
  assert.ok(g.observe().offer);
  const h = restoreGame(initialState("exec-2"));
  h.gameState.enemy = { ...RAT };
  h.gameState.player.hp = 1;
  const r = await execute(h, { cmd: "fight" });
  if (h.observe().dying) assert.ok(r.events.some((e) => e.type === "deal_offered") && h.observe().offer);
});
