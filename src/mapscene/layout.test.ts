import assert from "node:assert/strict";
import { test } from "node:test";
import { botPolicy, createGame, execute, type MapView, type Observation } from "../game";
import { ACTS, generateAct, type Act, type MapNode } from "../map";
import { dagModel, type Dag } from "../ui/logic";
import { ICONS, ICON_SIZE, privateIconFile, privateIcons } from "./icons";
import { crossings, focusY, LAYOUT, layoutMap, MAP_WIDTH, segmentsCross, type MapLayout } from "./layout";

/** The engine's MapView for an act, standing on `here` (as src/game/view.ts builds it). */
function mapViewOf(a: Act, here: string): MapView {
  const mv = (n: MapNode) => ({ id: n.id, kind: n.kind, visited: n.id === here, current: n.id === here, rewritten: false, next: [...n.next] });
  const layers: MapView["layers"] = [];
  for (const n of a.nodes) (layers[n.layer] ??= { layer: n.layer, nodes: [] }).nodes.push(mv(n));
  return { act: a.index, layers, final: a.final && mv(a.final), changes: [] };
}
const obs = (nodeId: string) => ({ nodeId, ending: null, pending: false, enemy: null, offer: null }) as unknown as Observation;
function dagOf(seed: string, act: number, at: "entry" | "exit" = "entry"): Dag {
  const a = generateAct(seed, act);
  const here = at === "entry" ? a.entry : a.exit;
  return dagModel(obs(here), mapViewOf(a, here));
}

const inBounds = (l: MapLayout) => l.nodes.every((n) =>
  n.x >= LAYOUT.marginX / 2 && n.x <= MAP_WIDTH - LAYOUT.marginX / 2 && n.y >= LAYOUT.top / 2 && n.y <= l.height - LAYOUT.bottom / 2);

test("layout: deterministic per seed and act; different seeds jitter differently", () => {
  const a = layoutMap(dagOf("det", 0), "det", 0), b = layoutMap(dagOf("det", 0), "det", 0);
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));
  assert.deepEqual(a.edges, b.edges);
  // Same graph, another jitter seed: the nodes move, the graph does not.
  const c = layoutMap(dagOf("det", 0), "other", 0);
  assert.deepEqual(c.nodes.map((n) => n.id), a.nodes.map((n) => n.id));
  assert.notDeepEqual(c.nodes.map((n) => [n.x, n.y]), a.nodes.map((n) => [n.x, n.y]));
});

test("layout: positions do not depend on where you stand (nodes never move as you walk)", () => {
  const a = layoutMap(dagOf("walk", 1, "entry"), "walk", 1), b = layoutMap(dagOf("walk", 1, "exit"), "walk", 1);
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));
});

test("layout: 300 seeds, all acts: in bounds, no crossings, entry at the bottom, boss and stairs/final on top", () => {
  let reduced = 0;
  for (let i = 0; i < 300; i++) for (let act = 0; act < ACTS; act++) {
    const seed = `lay-${i}`, dag = dagOf(seed, act), l = layoutMap(dag, seed, act);
    assert.ok(inBounds(l), `${seed}/${act}: a node is out of bounds`);
    assert.equal(crossings(l.edges).length, 0, `${seed}/${act}: edges cross`);
    assert.equal(l.nodes.length, dag.rows.flat().length);
    assert.equal(l.edges.length, dag.edges.length);
    const top = l.nodes.find((n) => n.row === 0)!, boss = l.nodes.find((n) => n.kind === "boss")!;
    const entry = l.nodes.find((n) => n.row === dag.rows.length - 1)!;
    assert.equal(top.kind, act === ACTS - 1 ? "final" : "stairs");
    assert.ok(top.y < boss.y && boss.y < Math.min(...l.nodes.filter((n) => n !== top && n !== boss).map((n) => n.y)));
    assert.ok(entry.y === Math.max(...l.nodes.map((n) => n.y)));
    assert.ok(boss.r > l.nodes.find((n) => n.kind !== "boss")!.r, "the boss is drawn bigger");
    // Rows stay in order: every node of a lower row is below every node of the row above.
    for (let r = 1; r < dag.rows.length; r++) {
      const up = l.nodes.filter((n) => n.row === r - 1), down = l.nodes.filter((n) => n.row === r);
      assert.ok(Math.max(...up.map((n) => n.y)) < Math.min(...down.map((n) => n.y)), `${seed}/${act}: rows ${r - 1} and ${r} overlap`);
    }
    // Every edge runs upwards, between the icons.
    for (const e of l.edges) assert.ok(e.points[0].y > e.points[e.points.length - 1].y);
    if (l.jitter < 1) reduced++;
  }
  assert.ok(reduced < 30, `jitter was reduced on ${reduced} of 900 acts`); // 0 today
});

test("layout: real bot runs (visited, rewrites, later acts) lay out cleanly; focus sits between current and next", async () => {
  let rewrites = 0, laterActs = 0;
  for (let i = 0; i < 20; i++) {
    const g = createGame(`run-${i}`);
    for (let s = 0; s < 400 && !g.ending; s++) {
      const v = g.view(), l = layoutMap(dagModel(v, v.map, false, v.actions), v.seed, v.map.act);
      assert.equal(crossings(l.edges).length, 0);
      assert.ok(inBounds(l));
      rewrites += v.map.changes.length ? 1 : 0;
      laterActs += v.map.act > 0 ? 1 : 0;
      const cur = l.nodes.find((n) => n.node.state === "current")!, next = l.nodes.filter((n) => n.node.state === "next");
      if (cur && next.length) assert.ok(focusY(l) < cur.y && focusY(l) > Math.min(...next.map((n) => n.y)));
      const c = botPolicy(v);
      if (!c) break;
      await execute(g, c);
    }
  }
  assert.ok(rewrites > 0 && laterActs > 0, `covered rewrites (${rewrites} views) and acts 2-3 (${laterActs} views)`);
});

test("segmentsCross: proper crossings only", () => {
  const p = (x: number, y: number) => ({ x, y });
  assert.equal(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0)), true);
  assert.equal(segmentsCross(p(0, 0), p(10, 10), p(10, 10), p(20, 0)), false); // shared end
  assert.equal(segmentsCross(p(0, 0), p(10, 0), p(0, 5), p(10, 5)), false);
});

test("icons: every kind has a 16×16 grid using only its palette; the private hook finds map/<kind>.png", () => {
  for (const [k, g] of Object.entries(ICONS)) {
    assert.equal(g.rows.length, ICON_SIZE, k);
    for (const row of g.rows) {
      assert.equal(row.length, ICON_SIZE, `${k}: ${row}`);
      for (const ch of row) assert.ok(ch === "." || ch === "k" || ch in g.palette, `${k}: unknown colour ${ch}`);
    }
  }
  for (const k of ["campfire", "fight", "deal", "well", "village", "boss", "final", "stairs", "rewritten"] as const) assert.ok(k in ICONS);
  assert.deepEqual(privateIcons(["map/well.png", "map/boss.png", "player-idle.png", "map/here.png"]), ["well", "boss"]);
  assert.equal(privateIconFile("campfire"), "map/campfire.png");
});
