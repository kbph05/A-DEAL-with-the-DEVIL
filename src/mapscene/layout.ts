/**
 * Where everything sits on the map scene, in world units: a pure function of the act's DAG model (src/ui/logic.ts
 * `dagModel`: rows top first, already in `planarOrder`) and the run seed. No Phaser, no DOM, so it runs in Node tests.
 *
 * The act runs bottom to top, like Slay the Spire: the entry at the bottom, the boss near the top, the stairs (or the
 * final door on the last act) above it. Each node gets a little seeded jitter (seeded from the run seed, the act and the
 * node id, so a node never moves while you walk the act). The jitter never creates a crossing: if a seed's jitter would
 * make two edges cross, it is scaled down (halved, then dropped) until none do; the planar order alone has none.
 */
import { hashSeed, mulberry32 } from "../map/rng";
import type { Dag, DagKind, DagNode } from "../ui/logic";

export interface Point { x: number; y: number }

export interface LaidNode extends Point {
  id: string;
  kind: DagKind;
  /** Row from the top (0 = stairs or final door, 1 = boss, last = the act's entry). */
  row: number;
  /** Hit and draw radius, world units. */
  r: number;
  node: DagNode;
}

export interface LaidEdge {
  /** The lower node (where you walk from) and the upper one. */
  from: string;
  to: string;
  /** The line to draw, from the edge of the lower icon to the edge of the upper one. */
  points: Point[];
}

export interface MapLayout {
  width: number;
  height: number;
  nodes: LaidNode[];
  byId: Map<string, LaidNode>;
  edges: LaidEdge[];
  /** The jitter scale actually used (1 = full; less when the full jitter would have crossed two edges). */
  jitter: number;
}

/** World width of the parchment: a narrow strip, like the Spire's map. The scene zooms it to fit the screen. */
export const MAP_WIDTH = 360;
export const LAYOUT = {
  marginX: 46,
  /** Room above the top row, so the stairs can scroll clear of the HUD's stats strip. */
  top: 150,
  bottom: 110,
  rowGap: 96,
  /** Gaps around the boss row: the boss is drawn big. */
  bossGapAbove: 118,
  bossGapBelow: 124,
  radius: 22,
  bossRadius: 36,
  topRadius: 24,
  /** Largest jitter: x as a share of the gap between neighbours (capped in units), and y in units. */
  jitterX: 0.22,
  jitterXMax: 20,
  jitterY: 13,
} as const;

/** Seeded jitter in [-1, 1) for one node, two draws (x, y). */
function jitterOf(seed: string, act: number, id: string): [number, number] {
  const r = mulberry32(hashSeed(`mapscene:${seed}:${act}:${id}`));
  return [r() * 2 - 1, r() * 2 - 1];
}

const orient = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** Proper crossing of segments ab and cd (touching at an end, or collinear overlap, does not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Pairs of edges whose polylines cross. Edges sharing a node are skipped (they meet at that node by design). */
export function crossings(edges: readonly LaidEdge[]): Array<[LaidEdge, LaidEdge]> {
  const out: Array<[LaidEdge, LaidEdge]> = [];
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j];
    if (e.from === f.from || e.from === f.to || e.to === f.from || e.to === f.to) continue;
    let hit = false;
    for (let a = 0; a + 1 < e.points.length && !hit; a++) for (let b = 0; b + 1 < f.points.length && !hit; b++)
      hit = segmentsCross(e.points[a], e.points[a + 1], f.points[b], f.points[b + 1]);
    if (hit) out.push([e, f]);
  }
  return out;
}

/** The line between two node centres, trimmed by each icon's radius plus a little air. */
function edgeLine(a: LaidNode, b: LaidNode): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, ra = a.r + 4, rb = b.r + 4;
  if (len <= ra + rb) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  return [{ x: a.x + ux * ra, y: a.y + uy * ra }, { x: b.x - ux * rb, y: b.y - uy * rb }];
}

function place(dag: Dag, seed: string, act: number, scale: number): MapLayout {
  const L = LAYOUT, rows = dag.rows, inner = MAP_WIDTH - 2 * L.marginX;
  // Row y from the top: the gaps around the boss row are wider.
  const ys: number[] = [];
  let y = L.top;
  rows.forEach((_, i) => {
    if (i > 0) y += i === 1 ? L.bossGapAbove : i === 2 ? L.bossGapBelow : L.rowGap;
    ys.push(y);
  });
  const height = y + L.bottom;
  const nodes: LaidNode[] = [];
  rows.forEach((row, ri) => row.forEach((n, i) => {
    const k = row.length, gap = inner / k;
    const isTop = ri === 0, isBoss = n.kind === "boss";
    const [jx, jy] = isTop ? [0, 0] : jitterOf(seed, act, n.id);
    const jitterX = Math.min(L.jitterX * (k === 1 ? inner / 3 : gap), L.jitterXMax) * scale * (isBoss ? 0.4 : 1);
    nodes.push({
      id: n.id, kind: n.kind, row: ri, node: n,
      x: L.marginX + gap * (i + 0.5) + jx * jitterX,
      y: ys[ri] + jy * L.jitterY * scale * (isBoss ? 0.4 : 1),
      r: isBoss ? L.bossRadius : isTop ? L.topRadius : L.radius,
    });
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidEdge[] = [];
  for (const [from, to] of dag.edges) {
    const a = byId.get(from), b = byId.get(to);
    if (a && b) edges.push({ from, to, points: edgeLine(a, b) });
  }
  return { width: MAP_WIDTH, height, nodes, byId, edges, jitter: scale };
}

/**
 * Lay the act out. `seed` and `act` seed the jitter (use the run seed and `map.act`). Deterministic: the same DAG,
 * seed and act always give the same layout. Nodes stay inside [marginX/2, width - marginX/2] and [top/2, height - bottom/2].
 */
export function layoutMap(dag: Dag, seed: string, act: number): MapLayout {
  for (const scale of [1, 0.5, 0.25]) {
    const l = place(dag, seed, act, scale);
    if (crossings(l.edges).length === 0) return l;
  }
  return place(dag, seed, act, 0);
}

/** The scroll target for the camera: between the current node and the nodes one step up, so both are in view. */
export function focusY(layout: MapLayout): number {
  const cur = layout.nodes.find((n) => n.node.state === "current");
  const next = layout.nodes.filter((n) => n.node.state === "next");
  if (!cur) return next.length ? next[0].y : layout.height - LAYOUT.bottom;
  if (!next.length) return cur.y;
  return (cur.y + next.reduce((s, n) => s + n.y, 0) / next.length) / 2;
}
