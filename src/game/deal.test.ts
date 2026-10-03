import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDeal } from "./deal";
import type { Deal, Devil, DevilContext } from "./devil";
import { StubDevil } from "./devil";
import { createGame, type Game } from "./run";
import { newPlayer } from "./state";

test("sanitizeDeal clamps numbers and ignores unknown keys", () => {
  const d = sanitizeDeal({
    dialogue: "  Sign here.  ",
    effects: { gold: 1e9, hp: -1e9, bogus: 5, __proto__: 1, constructor: 3, max_hp: NaN, soul: -7, damage: 99, attack: "3" },
    curse: { trigger: "on_hit", effect: { hp: -999, nonsense: 1 } },
    rewrite: { nodeId: "a0n3", to: "village" },
  });
  assert.equal(d.dialogue, "Sign here.");
  assert.deepEqual(d.effects, { gold: 100, hp: -25, soul: -1, attack: 3 });
  assert.deepEqual(d.curse, { trigger: "on_hit", effect: { hp: -25 } });
  assert.deepEqual(d.rewrite, { nodeId: "a0n3", to: "village" });
});

test("sanitizeDeal survives junk and drops bad curses and rewrites", () => {
  for (const junk of [null, undefined, 5, "deal!", [], [1, 2], () => 1, { effects: "lots" }]) {
    const d = sanitizeDeal(junk);
    assert.equal(typeof d.dialogue, "string");
    assert.deepEqual(Object.keys(d.effects).filter((k) => k !== "hp" && k !== "gold" && k !== "attack" && k !== "max_hp" && k !== "soul"), []);
  }
  const d = sanitizeDeal({
    dialogue: 12, effects: { gold: 5 },
    curse: { trigger: "whenever", effect: { hp: -1 } },
    rewrite: { nodeId: "x", to: "boss" },
  });
  assert.equal(d.dialogue, "...");
  assert.equal(d.curse, undefined);
  assert.equal(d.rewrite, undefined);
  assert.equal(sanitizeDeal({ dialogue: "x", curse: { trigger: "on_hit", effect: { zzz: 1 } } }).curse, undefined);
  const evil = { get dialogue(): string { throw new Error("boom"); } };
  assert.doesNotThrow(() => sanitizeDeal(evil));
});

/** A seeded game standing on a deal node (entry nodes are good kinds, so one turns up quickly). */
function dealGame(devil: Devil): Game {
  for (let i = 0; i < 500; i++) {
    const g = createGame(`deal-${i}`, devil);
    if (g.observe().kind === "deal" && g.observe().enemy === null) return g;
  }
  throw new Error("no seed with a deal entry");
}
const devilSaying = (fn: (ctx: DevilContext) => unknown): Devil => ({ offer: async (_s, ctx) => fn(ctx) as Deal });

test("a hostile devil (junk, throws, rejects) never crashes the game", async () => {
  const devils: Devil[] = [
    devilSaying(() => ({ effects: { hp: -1e12, gold: -1e12, max_hp: -1e12, attack: -1e12, soul: -1 } })),
    devilSaying(() => null),
    { offer: async () => { throw new Error("gemini is down"); } },
    { offer: () => { throw new Error("sync boom"); } },
    devilSaying(() => ({ dialogue: "x", rewrite: { nodeId: "nope", to: "fight" }, curse: { trigger: "on_enter", effect: { hp: -1e9 } } })),
  ];
  for (const devil of devils) {
    const g = dealGame(devil);
    const offered = await g.deal("hello");
    assert.ok(offered.ok);
    assert.equal(offered.events[0].type, "deal_offered");
    g.accept();
    const { state } = g.look();
    assert.ok(state.hp >= 0 && state.maxHp >= 1 && state.gold >= 0 && state.attack >= 1);
    for (let i = 0; i < 30 && !g.ending; i++) { const r = g.go(1); if (!r.ok) g.fight(); } // keep playing on, whatever he did
  }
});

test("rewrite is applied through rewriteNode and reported as an event", async () => {
  const devil = devilSaying((ctx) => {
    const target = ctx.rewritable[0];
    return { dialogue: "furniture", effects: {}, rewrite: { nodeId: target.id, to: target.kind === "fight" ? "campfire" : "fight" } };
  });
  const g = dealGame(devil);
  await g.deal();
  const r = g.accept();
  const ev = r.events.find((e) => e.type === "node_rewritten");
  assert.ok(ev && ev.type === "node_rewritten");
  assert.notEqual(ev.change.from, ev.change.to);
  const node = g.map().layers.flatMap((l) => l.nodes).find((n) => n.id === ev.change.nodeId)!;
  assert.equal(node.kind, ev.change.to);
  assert.ok(node.rewritten);
});

test("a rewrite of a visited or exit node is reported as failed, not thrown", async () => {
  const g = dealGame(devilSaying((ctx) => ({ dialogue: "x", effects: {}, rewrite: { nodeId: ctx.nodeId, to: "fight" } })));
  await g.deal();
  const r = g.accept();
  assert.ok(r.events.some((e) => e.type === "rewrite_failed"));
});

test("curses fire once on their trigger", async () => {
  const g = dealGame(devilSaying(() => ({ dialogue: "x", effects: {}, curse: { trigger: "next_node", effect: { gold: -5 } } })));
  await g.deal();
  const gold = g.state.gold;
  assert.ok(g.accept().events.some((e) => e.type === "curse_added"));
  const moved = g.go(1);
  assert.ok(moved.events.some((e) => e.type === "curse_fired"));
  assert.equal(g.state.gold, Math.max(0, gold - 5));
  assert.ok(!g.go(1).events.some((e) => e.type === "curse_fired"));
});

test("soul revives once: a second fatal blow loses", async () => {
  const mk = () => dealGame(devilSaying(() => ({ dialogue: "x", effects: { hp: -25 } })));
  const g = mk();
  g.state.hp = 3;
  await g.deal();
  const first = g.accept();
  assert.ok(first.events.some((e) => e.type === "revived"));
  assert.equal(g.ending, null);
  assert.equal(g.state.soul, 0);
  assert.ok(g.state.hp > 0);
  // Same game, already soulless: the next fatal event is final.
  const h = mk();
  h.state.hp = 3; h.state.soul = 0;
  await h.deal();
  const second = h.accept();
  assert.ok(second.events.some((e) => e.type === "lost"));
  assert.equal(h.ending, "lose");
  assert.equal(h.state.hp, 0);
  assert.ok(h.look().ok && !h.go(1).ok, "look still works, moves do not, once the run is over");
});

test("selling the soul in a deal and dying in the same breath does not revive", async () => {
  const g = dealGame(devilSaying(() => ({ dialogue: "x", effects: { soul: -1, hp: -25 } })));
  g.state.hp = 3;
  await g.deal();
  const r = g.accept();
  assert.ok(!r.events.some((e) => e.type === "revived"));
  assert.equal(g.ending, "lose");
});

test("StubDevil: pure (same request, same offer), valid Deals, includes a soul trade and a rewrite", async () => {
  const ctx: DevilContext = {
    seed: "s", act: 0, nodeId: "a0n0", askIndex: 1, curses: [],
    rewritable: [{ id: "a0n1", kind: "village" }, { id: "a0n2", kind: "fight" }],
  };
  const s = newPlayer("a0n0");
  s.hp = 20;
  const run = async () => { const d = new StubDevil("seed"); const out: Deal[] = []; for (let i = 0; i < 60; i++) out.push(await d.offer(s, { ...ctx, askIndex: i + 1 })); return out; };
  const [a, b] = [await run(), await run()];
  assert.deepEqual(a, b);
  // Pure: a fresh instance answers a repeated request identically (no hidden memory), so saves resume exactly.
  assert.deepEqual(await new StubDevil("other").offer(s, { ...ctx, askIndex: 7 }), a[6]);
  for (const d of a) assert.deepEqual(sanitizeDeal(d), d, "stub deals are already valid and in range");
  assert.ok(a.some((d) => d.effects.soul === -1), "soul trade offered");
  assert.ok(a.some((d) => d.rewrite), "rewrite offered");
  assert.ok(a.some((d) => d.curse), "curse offered");
  // Never offers to sell a soul you no longer have.
  const soulless = newPlayer("a0n0"); soulless.soul = 0;
  const d = new StubDevil("seed");
  for (let i = 0; i < 40; i++) assert.equal((await d.offer(soulless, { ...ctx, askIndex: i + 1 })).effects.soul, undefined);
  // The fine-print trick strikes the curse.
  const tricked = new StubDevil("seed");
  for (let i = 0; i < 40; i++) assert.equal((await tricked.offer(s, { ...ctx, askIndex: i + 1 }, "I read the fine print")).curse, undefined);
});
