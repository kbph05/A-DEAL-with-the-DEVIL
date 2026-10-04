import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTS, KINDS, MAX_NODES, MAX_WIDTH, MIN_NODES, MIN_WIDTH, START_KIND, generateAct, markVisited, mulberry32, polarity,
  rewriteNode, type Act, type Kind, type Modifiers,
} from "./index";
import { linkLayers } from "./mapgen";

// Independent oracle: checks every structural invariant from the spec.
function checkInvariants(act: Act): void {
  const { nodes } = act;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(byId.size, nodes.length, "unique ids");
  assert.ok(nodes.length >= MIN_NODES && nodes.length <= MAX_NODES, `node count ${nodes.length}`);
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
  // Widths (designer's walk): entry and exit 1, middle layers MIN_WIDTH..MAX_WIDTH, and each layer is the previous one
  // plus or minus 1. It may only stay the same where one of the two steps was clamped away: below the floor, above
  // MAX_WIDTH, or wider than the layers left can narrow back to 1 from (layer i of L may be at most L - i wide).
  const layers: Array<typeof nodes> = [];
  for (const n of nodes) (layers[n.layer] ??= []).push(n);
  const L = layers.length, w = layers.map((l) => l.length);
  assert.equal(w[0], 1); assert.equal(w[L - 1], 1);
  if (act.alternate) assert.equal(L % 2, 0, "alternating acts have an even layer count (boss on an odd layer)");
  for (let i = 1; i < L; i++) {
    const exit = i === L - 1, lo = exit ? 1 : MIN_WIDTH, hi = exit ? 1 : Math.min(MAX_WIDTH, L - i);
    assert.ok(w[i] >= lo && w[i] <= hi, `layer ${i} of ${L} width ${w[i]}`);
    const d = w[i] - w[i - 1];
    assert.ok(Math.abs(d) <= 1, `width step ${w[i - 1]} -> ${w[i]} at layer ${i}`);
    if (d === 0) assert.ok(w[i - 1] - 1 < lo || w[i - 1] + 1 > hi, `width held at ${w[i]} on layer ${i} without a clamp`);
  }
  // Edges: planar in slot order (no two edges between the same layers cross), every node but the exit has a child and
  // every node but the entry a parent (checked above via single root/leaf), each node's exits numbered left to right.
  for (let l = 0; l + 1 < L; l++) {
    const es = layers[l].flatMap((n) => n.next.map((t) => [n.slot, byId.get(t)!.slot] as const));
    for (const [i, e] of es.entries()) for (const f of es.slice(i + 1))
      assert.ok((e[0] - f[0]) * (e[1] - f[1]) >= 0, `edges ${e} and ${f} cross between layers ${l} and ${l + 1}`);
    // First pass gives each old node one edge; the second at most one per new node it missed.
    assert.ok(es.length <= w[l] + w[l + 1] - 1, `too many edges between layers ${l} and ${l + 1}`);
    for (const n of layers[l]) assert.deepEqual(n.next, [...n.next].sort((a, b) => byId.get(a)!.slot - byId.get(b)!.slot), "exits numbered left to right");
  }
  if (act.alternate) for (const n of nodes) for (const t of n.next)
    assert.notEqual(polarity(n.kind), polarity(byId.get(t)!.kind), `alternation ${n.id}->${t}`);
  if (act.index === ACTS - 1) {
    assert.equal(act.final?.kind, "final");
    assert.equal(act.final!.layer, byId.get(act.exit)!.layer + 1);
  } else assert.equal(act.final, undefined);
}

const count = (act: Act, k: Kind) => act.nodes.filter((n) => n.kind === k).length;

test("node count is 12-14 and all three sizes occur", () => {
  assert.deepEqual([MIN_NODES, MAX_NODES], [12, 14]);
  const sizes = new Set<number>();
  for (let s = 0; s < 200; s++) sizes.add(generateAct(s, 0).nodes.length);
  assert.deepEqual([...sizes].sort((a, b) => a - b), [12, 13, 14]);
});

test("linkLayers: each old node links to one new node, targets non-decreasing; then one parent per missed new node, planar", () => {
  const rng = mulberry32(7);
  for (let k = 0; k < 5000; k++) {
    const m = 1 + Math.floor(rng() * MAX_WIDTH), n = Math.max(1, Math.min(MAX_WIDTH, m + Math.floor(rng() * 3) - 1));
    const edges = linkLayers(rng, m, n), first = edges.slice(0, m), extra = edges.slice(m);
    assert.deepEqual(first.map(([a]) => a), Array.from({ length: m }, (_, i) => i), "first pass: one edge per old node, in slot order");
    for (let i = 1; i < m; i++) assert.ok(first[i][1] >= first[i - 1][1], "first-pass targets never decrease");
    const missed = Array.from({ length: n }, (_, j) => j).filter((j) => !first.some(([, t]) => t === j));
    assert.deepEqual(extra.map(([, t]) => t), missed, "second pass: exactly one parent for each missed new node, left to right");
    for (const [i, e] of edges.entries()) for (const f of edges.slice(i + 1)) assert.ok((e[0] - f[0]) * (e[1] - f[1]) >= 0, `${e} crosses ${f}`);
    for (const [a, b] of edges) assert.ok(a >= 0 && a < m && b >= 0 && b < n);
  }
});

test("lanes: widths 2 and 3 occur, the walk narrows to 1, few forks (planar and width rules via checkInvariants)", () => {
  assert.equal(MAX_WIDTH, 4);
  const widths = new Set<number>(), layerCounts = new Set<number>();
  let nonExit = 0, out = 0, middle = 0, branching = 0;
  for (let s = 0; s < 1000; s++) for (let a = 0; a < ACTS; a++) {
    const act = generateAct(`lanes-${s}`, a);
    checkInvariants(act);
    const perLayer = new Map<number, number>();
    for (const n of act.nodes) perLayer.set(n.layer, (perLayer.get(n.layer) ?? 0) + 1);
    widths.add(Math.max(...perLayer.values()));
    layerCounts.add(perLayer.size);
    for (const n of act.nodes) {
      if (n.id === act.exit) continue;
      nonExit++; out += n.next.length;
      if (n.id !== act.entry) { middle++; if (n.next.length > 1) branching++; }
    }
  }
  // Width 4 needs at least 1+2+3+4+3+2+1 = 16 nodes under +-1 steps, so a 12-14 node act never reaches MAX_WIDTH.
  assert.deepEqual([...widths].sort(), [2, 3]);
  assert.deepEqual([...layerCounts].sort(), [6, 8]);
  // Measured on 4 Oct (designer's walk, seeds run-0..999): avg out-degree 1.30, middle nodes with a fork 23%
  // (staircase plus cross-links before: 1.32 and 17%).
  assert.ok(out / nonExit <= 1.35, `average out-degree ${(out / nonExit).toFixed(3)}`);
  assert.ok(branching / middle <= 0.28, `middle nodes with more than one exit: ${(branching / middle).toFixed(3)}`);
});

test("structure: single root/leaf, reachability, boss exit, alternation (both option values)", () => {
  for (const alternate of [true, false]) for (let a = 0; a < ACTS; a++) checkInvariants(generateAct("seed", a, {}, { alternate }));
});

test("act 1 always starts on the village (the shop); later acts start on any good kind", () => {
  assert.equal(START_KIND, "village");
  const later = new Set<Kind>();
  for (let s = 0; s < 1000; s++) {
    for (const alternate of [true, false]) assert.equal(generateAct(`start-${s}`, 0, {}, { alternate }).nodes[0].kind, "village");
    later.add(generateAct(`start-${s}`, 1).nodes[0].kind);
  }
  assert.equal(generateAct(1, 0, { banKinds: ["village"] }).nodes[0].kind, "village", "like the boss, the start ignores modifiers");
  assert.ok(later.size > 1, `act 2 entries: ${[...later]}`);
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
  const reasons = [
    rewriteNode(act, "nope", "well"),
    rewriteNode(act, act.entry, act.nodes[0].kind === "well" ? "village" : "well"),
    rewriteNode(act, act.exit, "fight"),
    rewriteNode(act, mid.id, "boss"),
    rewriteNode(act, mid.id, "final"),
    rewriteNode(act, mid.id, "dragon" as Kind),
    rewriteNode(act, mid.id, mid.kind),
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

test("rewriteNode: the devil may break alternation, and the change is reported", () => {
  const act = generateAct(11, 0);
  const mid = act.nodes.find((n) => n.id !== act.entry && n.id !== act.exit && polarity(n.kind) === "good")!;
  const r = rewriteNode(act, mid.id, "fight");
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.change, { nodeId: mid.id, from: mid.kind, to: "fight", polarityFlip: true });
    assert.equal(r.act.alternate, false, "alternation flag cleared");
    assert.deepEqual(r.act.changes, [r.change]);
    assert.deepEqual(act.changes, [], "input act untouched");
    checkInvariants(r.act);
  }
  const same = act.nodes.find((n) => n.id !== act.entry && n.id !== act.exit && n.kind === "fight");
  if (same) { const s2 = rewriteNode(act, same.id, "fight"); assert.equal(s2.ok, false); }
});

test("rewriteNode: random rewrites keep invariants and log every change", () => {
  const rng = mulberry32(99);
  for (let s = 0; s < 200; s++) {
    let act = generateAct(s, 0);
    for (let i = 0; i < 10; i++) {
      const n = act.nodes[Math.floor(rng() * act.nodes.length)];
      const before = act.changes.length;
      const r = rewriteNode(act, n.id, KINDS[Math.floor(rng() * KINDS.length)]);
      if (r.ok) { act = r.act; assert.equal(act.changes.length, before + 1); }
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
