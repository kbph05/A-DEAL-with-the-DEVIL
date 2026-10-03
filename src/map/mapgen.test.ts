import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTS, KINDS, generateAct, markVisited, mulberry32, polarity, rewriteNode,
  type Act, type Kind, type Modifiers,
} from "./index";

// Independent oracle: checks every structural invariant from the spec.
function checkInvariants(act: Act): void {
  const { nodes } = act;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(byId.size, nodes.length, "unique ids");
  assert.ok(nodes.length >= 6 && nodes.length <= 8, `node count ${nodes.length}`);
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const t of n.next) {
    assert.ok(byId.has(t), `edge to unknown ${t}`);
    assert.equal(byId.get(t)!.layer, n.layer + 1, "edges go one layer forward (so: acyclic)");
    incoming.get(t)!.push(n.id);
  }
  const roots = nodes.filter((n) => incoming.get(n.id)!.length === 0);
  const leaves = nodes.filter((n) => n.next.length === 0);
  assert.deepEqual(roots.map((n) => n.id), [act.entry], "single root");
  assert.deepEqual(leaves.map((n) => n.id), [act.exit], "single leaf");
  const walk = (start: string, edges: (id: string) => string[]) => {
    const seen = new Set([start]);
    for (const stack = [start]; stack.length; ) for (const t of edges(stack.pop()!)) if (!seen.has(t)) { seen.add(t); stack.push(t); }
    return seen;
  };
  assert.equal(walk(act.entry, (id) => byId.get(id)!.next).size, nodes.length, "all reachable from root");
  assert.equal(walk(act.exit, (id) => incoming.get(id)!).size, nodes.length, "all reach the leaf");
  assert.equal(byId.get(act.exit)!.kind, "boss");
  assert.equal(nodes.filter((n) => n.kind === "boss").length, 1, "boss only at exit");
  assert.equal(polarity(byId.get(act.entry)!.kind), "good");
  assert.ok(nodes.every((n) => n.kind !== "final"));
  const slots = new Set(nodes.map((n) => `${n.layer}:${n.slot}`));
  assert.equal(slots.size, nodes.length, "unique (layer, slot)");
  if (act.alternate) for (const n of nodes) for (const t of n.next)
    assert.notEqual(polarity(n.kind), polarity(byId.get(t)!.kind), `alternation ${n.id}->${t}`);
  if (act.index === ACTS - 1) {
    assert.equal(act.final?.kind, "final");
    assert.equal(act.final!.layer, byId.get(act.exit)!.layer + 1);
  } else assert.equal(act.final, undefined);
}

const count = (act: Act, k: Kind) => act.nodes.filter((n) => n.kind === k).length;

test("node count is 6-8 and all three sizes occur", () => {
  const sizes = new Set<number>();
  for (let s = 0; s < 200; s++) sizes.add(generateAct(s, 0).nodes.length);
  assert.deepEqual([...sizes].sort(), [6, 7, 8]);
});

test("structure: single root/leaf, reachability, boss exit, alternation (both option values)", () => {
  for (const alternate of [true, false]) for (let a = 0; a < ACTS; a++) checkInvariants(generateAct("seed", a, {}, { alternate }));
});

test("alternation is the default", () => {
  assert.equal(generateAct(1, 0).alternate, true);
  assert.equal(generateAct(1, 0, {}, { alternate: false }).alternate, false);
});

test("non-alternating acts do mix polarity on some edge", () => {
  const mixed = Array.from({ length: 100 }, (_, s) => generateAct(s, 0, {}, { alternate: false })).some((act) =>
    act.nodes.some((n) => n.next.some((t) => polarity(n.kind) === polarity(act.nodes.find((m) => m.id === t)!.kind))));
  assert.ok(mixed);
});

test("determinism: same inputs identical, different seeds usually differ", () => {
  const mods: Modifiers = { forceKinds: { campfire: 1 }, banKinds: ["well"] };
  assert.deepEqual(generateAct("abc", 1, mods), generateAct("abc", 1, mods));
  assert.deepEqual(generateAct(42, 2), generateAct(42, 2));
  const sigs = new Set<string>();
  for (let s = 0; s < 100; s++) sigs.add(JSON.stringify(generateAct(s, 0)));
  assert.ok(sigs.size >= 90, `only ${sigs.size}/100 distinct`);
  assert.notDeepEqual(generateAct(7, 0), generateAct(7, 1), "acts of one run differ");
});

test("act ids are unique across acts and chain-friendly", () => {
  const ids = [0, 1, 2].flatMap((a) => generateAct(5, a).nodes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => generateAct(5, 3), RangeError);
});

test("rewriteNode: valid rewrite is immutable and keeps invariants", () => {
  const act = generateAct(11, 0);
  const target = act.nodes.find((n) => n.kind !== "boss" && n.id !== act.entry && polarity(n.kind) === "good")!;
  const to: Kind = target.kind === "village" ? "well" : "village";
  const r = rewriteNode(act, target.id, to);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.act.nodes.find((n) => n.id === target.id)!.kind, to);
    assert.equal(act.nodes.find((n) => n.id === target.id)!.kind, target.kind, "input act untouched");
    checkInvariants(r.act);
  }
});

test("rewriteNode: rejections return a result, never throw", () => {
  const act = generateAct(11, 0);
  const mid = act.nodes.find((n) => n.id !== act.entry && n.id !== act.exit)!;
  const wrong: Kind = polarity(mid.kind) === "good" ? "fight" : "village";
  const reasons = [
    rewriteNode(act, "nope", "well"),
    rewriteNode(act, act.entry, act.nodes[0].kind === "well" ? "village" : "well"),
    rewriteNode(act, act.exit, "fight"),
    rewriteNode(act, mid.id, "boss"),
    rewriteNode(act, mid.id, "final"),
    rewriteNode(act, mid.id, "dragon" as Kind),
    rewriteNode(act, mid.id, wrong),
    rewriteNode(markVisited(act, mid.id), mid.id, mid.kind === "fight" ? "fight" : "well"),
  ];
  for (const r of reasons) { assert.equal(r.ok, false); assert.ok(!r.ok && r.reason.length > 0); }
  assert.ok(!rewriteNode(act, "final", "well").ok);
});

test("rewriteNode: without alternation, cross-polarity is allowed, boss/entry/exit still are not", () => {
  const act = generateAct(3, 0, {}, { alternate: false });
  const mid = act.nodes.find((n) => n.id !== act.entry && n.id !== act.exit)!;
  assert.ok(rewriteNode(act, mid.id, polarity(mid.kind) === "good" ? "fight" : "well").ok);
  assert.ok(!rewriteNode(act, mid.id, "boss").ok);
  assert.ok(!rewriteNode(act, act.entry, "well").ok);
});

test("rewriteNode: random rewrites of alternating acts never break alternation", () => {
  const rng = mulberry32(99);
  for (let s = 0; s < 200; s++) {
    let act = generateAct(s, 0);
    for (let i = 0; i < 10; i++) {
      const n = act.nodes[Math.floor(rng() * act.nodes.length)];
      const r = rewriteNode(act, n.id, KINDS[Math.floor(rng() * KINDS.length)]);
      if (r.ok) act = r.act;
    }
    checkInvariants(act);
  }
});

test("modifiers: forceKinds honoured (capped by free slots) and banKinds honoured", () => {
  for (let s = 0; s < 200; s++) {
    const act = generateAct(s, 1, { forceKinds: { campfire: 1, fight: 2 }, banKinds: ["village", "well"] });
    checkInvariants(act);
    const mid = act.nodes.filter((n) => n.id !== act.entry && n.id !== act.exit);
    assert.ok(count(act, "campfire") >= 1 && count(act, "campfire") >= Math.min(1, mid.filter((n) => n.layer % 2 === 0).length));
    assert.ok(count(act, "fight") >= Math.min(2, mid.filter((n) => n.layer % 2 === 1).length));
    assert.equal(count(act, "village") + count(act, "well"), 0);
  }
  // Without alternation there is room for big forced counts.
  const act = generateAct(8, 0, { forceKinds: { deal: 4 } }, { alternate: false });
  assert.ok(count(act, "deal") >= 4);
  // Modifiers change kinds only, never the shape.
  const shape = (a: Act) => a.nodes.map((n) => [n.id, n.layer, n.slot, n.next]);
  assert.deepEqual(shape(generateAct(8, 0, {}, { alternate: false })), shape(act));
});

test("modifiers: impossible or silly requests degrade instead of crashing", () => {
  const act = generateAct(2, 0, { banKinds: ["fight", "boss", "deal", "village", "campfire", "well"], forceKinds: { boss: 3, final: 1, well: 99, deal: -1, fight: NaN } });
  checkInvariants(act);
  assert.equal(act.nodes.find((n) => n.id === act.exit)!.kind, "boss");
});

test("1000 random seeds never violate invariants", () => {
  const rng = mulberry32(2026);
  const some = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  for (let i = 0; i < 1000; i++) {
    const mods: Modifiers = {
      banKinds: KINDS.filter(() => rng() < 0.15),
      forceKinds: Object.fromEntries(KINDS.filter(() => rng() < 0.3).map((k) => [k, Math.floor(rng() * 5)])),
    };
    checkInvariants(generateAct(Math.floor(rng() * 2 ** 32), i % ACTS, mods, { alternate: some([true, true, false]) }));
  }
  for (let s = 0; s < 1000; s++) for (let a = 0; a < ACTS; a++) checkInvariants(generateAct(`run-${s}`, a));
});
