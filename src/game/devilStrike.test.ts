import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STRIKE_HP, sanitizeDeal } from "./deal";
import { STRIKE_CHANCE, STRIKE_MAX, STRIKE_MIN, StubDevil, type Deal, type Devil, type DevilContext } from "./devil";
import { describe } from "./events";
import { MAX_ASKS, MAX_DEVIL_QUERIES, initialState, type GameState } from "./gameState";
import { restoreGame } from "./run";
import { newPlayer } from "./state";
import { step } from "./state-machine";

const onDeal = (seed: string): GameState => { const s = initialState(seed); s.acts[0].nodes[0].kind = "deal"; return s; };
const strikeDevil = (deal: unknown): Devil => ({ offer: async () => deal as Deal });
const STRIKE: Deal = { dialogue: "Enough noise.", effects: { hp: -5 }, forced: true };

test("StrikeChance is 50%; a strike takes 3..6 HP in the stub, never more than the engine cap", () => {
  assert.equal(STRIKE_CHANCE, 0.5);
  assert.ok(STRIKE_MIN === 3 && STRIKE_MAX === 6 && STRIKE_MAX <= MAX_STRIKE_HP);
});

// ---- sanitizeDeal ----

test("sanitizeDeal: forced is kept only as boolean true, and false/other values mean an ordinary offer", () => {
  assert.equal(sanitizeDeal({ dialogue: "x", effects: { gold: 5 }, forced: true }).forced, true);
  for (const f of [false, "true", 1, null, undefined, {}, []]) {
    const d = sanitizeDeal({ dialogue: "x", effects: { gold: 5 }, forced: f });
    assert.equal(d.forced, undefined, `forced: ${JSON.stringify(f)}`);
    assert.deepEqual(d.effects, { gold: 5 });
  }
  assert.ok(!("forced" in sanitizeDeal({ dialogue: "x", effects: {} })), "plain deals are byte-identical to before");
});

test("sanitizeDeal: a forced deal is cut to an HP loss (capped); gains, soul, curse and rewrite are stripped", () => {
  const raw = {
    dialogue: "Mine.", forced: true,
    effects: { hp: -20, gold: 50, soul: -1, attack: 3, max_hp: 10 },
    curse: { trigger: "on_hit", effect: { hp: -5 } }, rewrite: { nodeId: "a0n2", to: "fight" },
  };
  assert.deepEqual(sanitizeDeal(raw), { dialogue: "Mine.", effects: { hp: -MAX_STRIKE_HP }, forced: true });
  assert.deepEqual(sanitizeDeal({ ...raw, effects: { hp: -4 } }).effects, { hp: -4 });
  assert.deepEqual(sanitizeDeal({ ...raw, effects: { hp: 15, gold: 10 } }).effects, {}, "healing is not a punishment: dropped");
  assert.deepEqual(sanitizeDeal({ ...raw, effects: { damage: -2, gold: -9 } }).effects, {}, "only hp survives");
  assert.deepEqual(sanitizeDeal({ dialogue: "rant", forced: true }), { dialogue: "rant", effects: {}, forced: true }, "a pure rant is fine");
  assert.deepEqual(sanitizeDeal({ forced: true }), { dialogue: "...", effects: {}, forced: true });
});

// ---- engine ----

test("engine: a forced reply applies at once, with no offer to accept, the node stays open and the ask counts", () => {
  const s0 = onDeal("strike-1");
  const asked = step(s0, { cmd: "deal", text: "asdfghjkl" });
  const r = step(asked.state, { cmd: "devil_reply", deal: STRIKE });
  assert.ok(r.ok);
  assert.deepEqual(r.events, [{ type: "devil_struck", dialogue: "Enough noise.", effects: { hp: -5 } }]);
  const s = r.state;
  assert.equal(s.player.hp, s0.player.hp - 5);
  assert.equal(s.offer, null, "nothing on the table");
  assert.equal(s.pending, null);
  assert.equal(s.resolved, false, "the strike does not resolve the node");
  assert.equal(s.dealsDecided, 0);
  assert.equal(s.asks, 1);
  assert.equal(s.totalAsks, 1, "it counted as a question");
  assert.equal(s.ending, null);
  assert.ok(!r.actions.some((c) => c.cmd === "accept" || c.cmd === "refuse"), "no accept/refuse step");
  assert.ok(r.actions.some((c) => c.cmd === "deal"), "he can be asked again");
  assert.ok(r.actions.some((c) => c.cmd === "go"), "or the player can leave");
  assert.match(s.player.log.at(-1)!, /devil struck/);
  assert.match(describe(r.events[0]), /DEVIL STRIKES: "Enough noise\."\n {2}you take: HP -5/);
});

test("engine: a strike carries no soul change, gold, curse or rewrite even when the devil sends them", () => {
  const s0 = onDeal("strike-2");
  const r = step(step(s0, { cmd: "deal" }).state, { cmd: "devil_reply", deal: {
    dialogue: "x", forced: true, effects: { hp: -50, gold: 99, soul: -1, attack: 3 }, curse: { trigger: "on_hit", effect: { hp: -9 } }, rewrite: { nodeId: "a0n2", to: "campfire" },
  } });
  assert.equal(r.state.player.hp, s0.player.hp - MAX_STRIKE_HP);
  assert.equal(r.state.player.gold, s0.player.gold);
  assert.equal(r.state.player.soul, 1);
  assert.equal(r.state.player.attack, s0.player.attack);
  assert.deepEqual(r.state.curses, []);
  assert.deepEqual(r.events.map((e) => e.type), ["devil_struck"]);
});

test("engine: a strike leaves a standing offer from an earlier haggle on the table", () => {
  const s0 = onDeal("strike-3");
  const offered = step(step(s0, { cmd: "deal", text: "gold" }).state, { cmd: "devil_reply", deal: { dialogue: "Sign.", effects: { gold: 5 } } }).state;
  assert.ok(offered.offer);
  const r = step(step(offered, { cmd: "deal", text: "asdf" }).state, { cmd: "devil_reply", deal: STRIKE });
  assert.deepEqual(r.state.offer, offered.offer);
  assert.ok(r.actions.some((c) => c.cmd === "accept"));
  assert.equal(r.state.asks, 2);
});

test("engine: a lethal strike goes through the normal death check: soul revives once, then it kills", () => {
  const s0 = onDeal("strike-4");
  s0.player.hp = 4;
  const hit = (s: GameState) => step(step(s, { cmd: "deal" }).state, { cmd: "devil_reply", deal: STRIKE });
  const dying = hit(s0);
  assert.deepEqual(dying.events.map((e) => e.type), ["devil_struck", "devil_at_death"]);
  assert.deepEqual(dying.events[0], { type: "devil_struck", dialogue: "Enough noise.", effects: { hp: -4 } }, "effects show what actually landed");
  assert.equal(dying.awaiting?.devil?.context.kind, "death");
  const r1 = step(step(dying.state, { cmd: "devil_reply", deal: { dialogue: "Your soul.", effects: { soul: -1, hp: 15 } } }).state, { cmd: "accept" });
  assert.deepEqual(r1.events.map((e) => e.type), ["deal_applied", "revived"]);
  assert.equal(r1.state.player.soul, 0);
  assert.equal(r1.state.player.hp, 15);
  assert.equal(r1.state.ending, null);
  const low = structuredClone(r1.state);
  low.player.hp = 3;
  const r2 = hit(low);
  assert.deepEqual(r2.events.map((e) => e.type), ["devil_struck", "lost"]);
  assert.deepEqual(r2.events[1], { type: "lost", cause: "the devil's wrath" });
  assert.equal(r2.state.ending, "lose");
  assert.deepEqual(r2.actions, []);
});

test("engine: strikes spend the node's asks and the run's questions like any ask, then the devil is done", async () => {
  const g = restoreGame(onDeal("strike-5"), strikeDevil({ dialogue: "Out.", effects: { hp: -1 }, forced: true }));
  for (let i = 0; i < MAX_ASKS; i++) assert.ok((await g.deal("kjh")).ok);
  assert.equal(g.view().asksLeft, 0);
  assert.ok(!g.view().actions.some((c) => c.cmd === "deal"));
  assert.equal(g.gameState.totalAsks, MAX_ASKS);
  assert.ok(MAX_ASKS < MAX_DEVIL_QUERIES);
  assert.equal(g.gameState.player.hp, 30 - MAX_ASKS);
});

test("Game.deal round trip: the strike events come back with the ask, and a state save/restore continues identically", async () => {
  const g = restoreGame(onDeal("strike-6"), strikeDevil(STRIKE));
  const r = await g.deal("qwerty");
  assert.deepEqual(r.events.map((e) => e.type), ["devil_struck"]);
  const saved = JSON.parse(JSON.stringify(g.gameState)) as GameState;
  const g2 = restoreGame(saved, strikeDevil(STRIKE));
  assert.deepEqual((await g.deal("qwerty")).events, (await g2.deal("qwerty")).events);
  assert.deepEqual(g.gameState, g2.gameState);
});

// ---- StubDevil ----

const ctx: DevilContext = { seed: "s", act: 0, nodeId: "a0n1", askIndex: 1, questionsLeft: 5, curses: [], rewritable: [{ id: "a0n2", kind: "fight" }] };
const NOISE = ["laksjdhflkajshdg9", "asdfghjkl", "!@#$%^&*", "aaaaaaaaaaaa", "qwertyuiop zxcvbnm"];
const REAL = ["", "gold", "heal me", "I read the fine print", "my soul", "the road ahead", "blood", "a sharper sword, and I'm not afraid of a curse", "hello devil, how are you?", "金をくれ", "💰💰💰💰💰💰"];

test("StubDevil: gibberish yields both a strike and a spite offer across seeds, at about STRIKE_CHANCE", async () => {
  const p = newPlayer("a0n1");
  let strikes = 0, offers = 0;
  const strikeLines = new Set<string>(), hps = new Set<number>();
  for (let i = 1; i <= 300; i++) {
    const c = { ...ctx, seed: `seed-${i}`, askIndex: 1 + (i % 10) };
    const d = await new StubDevil().offer(p, c, NOISE[i % NOISE.length]);
    assert.deepEqual(sanitizeDeal(d), d, "a valid, already-sanitized deal either way");
    if (d.forced) {
      strikes++;
      strikeLines.add(d.dialogue);
      assert.equal(d.curse, undefined); assert.equal(d.rewrite, undefined);
      assert.deepEqual(Object.keys(d.effects), ["hp"]);
      const hp = d.effects.hp;
      assert.ok(hp <= -STRIKE_MIN && hp >= -STRIKE_MAX, `hp ${hp}`);
      hps.add(hp);
      assert.ok(!/\b(god|hell|heaven|pray|sin|bless|holy|amen|lord)\b/i.test(d.dialogue));
    } else { offers++; assert.ok(d.curse); }
  }
  assert.ok(strikes > 90 && offers > 90, `strikes ${strikes}, offers ${offers}`);
  assert.ok(strikeLines.size >= 4, "several angry variants");
  assert.deepEqual([...hps].sort((x, y) => x - y), [-6, -5, -4, -3], "3..6 all turn up");
});

test("StubDevil: the first strike line is the unmistakable one, and strikes taunt about the question limit", async () => {
  const p = newPlayer("a0n1");
  const seen = new Set<string>();
  for (let i = 1; i <= 200; i++) {
    const d = await new StubDevil().offer(p, { ...ctx, seed: `x${i}`, questionsLeft: 0 }, "asdfghjkl");
    if (d.forced) { seen.add(d.dialogue); assert.match(d.dialogue, /last question/); }
  }
  assert.ok([...seen].some((l) => l.startsWith("You dare waste my time with noise? Speak plainly or bleed.")));
});

test("StubDevil: gibberish replies are deterministic (same request, same reply, any instance)", async () => {
  const p = newPlayer("a0n1");
  for (let i = 1; i <= 40; i++) {
    const c = { ...ctx, seed: `d${i}`, askIndex: i };
    for (const t of NOISE) assert.deepEqual(await new StubDevil("a").offer(p, c, t), await new StubDevil("b").offer(p, c, t));
  }
});

test("StubDevil: ordinary text never strikes", async () => {
  const p = newPlayer("a0n1");
  for (let i = 1; i <= 100; i++) {
    for (const t of REAL) {
      const d = await new StubDevil().offer(p, { ...ctx, seed: `r${i}`, askIndex: 1 + (i % 10) }, t);
      assert.equal(d.forced, undefined, `text ${JSON.stringify(t)}`);
    }
    assert.equal((await new StubDevil().offer(p, { ...ctx, seed: `r${i}` })).forced, undefined, "no text");
  }
});

test("end to end with the stub: gibberish at the real engine sometimes strikes (HP down, node open, no offer), sometimes offers", async () => {
  let struck = 0, offered = 0;
  for (let i = 0; i < 60; i++) {
    const g = restoreGame(onDeal(`e2e-${i}`)), hp = g.state.hp;
    const r = await g.deal("laksjdhflkajshdg9");
    const v = g.view();
    assert.equal(v.resolved, false);
    assert.equal(v.questionsLeft, MAX_DEVIL_QUERIES - 1);
    if (r.events.some((e) => e.type === "devil_struck")) {
      struck++;
      assert.equal(v.offer, null); assert.ok(g.state.hp < hp && g.state.hp >= hp - STRIKE_MAX);
      assert.ok(v.actions.some((c) => c.cmd === "deal"));
    } else { offered++; assert.ok(v.offer); assert.equal(g.state.hp, hp); }
  }
  assert.ok(struck > 10 && offered > 10, `struck ${struck}, offered ${offered}`);
});
