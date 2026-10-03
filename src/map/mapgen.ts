import { hashSeed, mulberry32, type Rng } from "./rng";
import {
  GOOD_KINDS, BAD_KINDS, isKind, polarity,
  type Act, type GenOptions, type Kind, type MapNode, type Modifiers, type Polarity,
  type RewriteChange, type RewriteResult, type Seed,
} from "./types";

export const ACTS = 3;
/** Act 1 always opens on this kind: the run starts at the shop, never at the devil's table (kbph, 3 Oct). */
export const START_KIND: Kind = "village";
/** Lanes per layer (kbph: more branches). */
export const MAX_WIDTH = 4;
/** Fewest lanes in a middle layer (entry and exit layers are always 1). Raise to 2+ for maps that always branch. */
export const MIN_WIDTH = 1;
/**
 * Chance that a pair of adjacent layers gets one cross-link between lanes, beyond the fewest edges that connect them
 * (kbph, 3 Oct: "each direction should be more of a dedication of where you're going"). At most one per layer pair.
 */
export const CROSS_LINK_P = 0.2;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const layerPolarity = (layer: number): Polarity => (layer % 2 === 0 ? "good" : "bad");

/** Two edges between the same pair of layers cross, in slot order, iff their ends are in opposite order. */
const crosses = (e: readonly [number, number], f: readonly [number, number]): boolean => (e[0] - f[0]) * (e[1] - f[1]) < 0;

/**
 * Edges (as slot pairs) joining a layer of `m` nodes to one of `n`: planar in slot order by construction. A monotone
 * staircase from (0, 0) to (m-1, n-1) gives every node a parent and a child with the fewest edges, max(m, n): parallel
 * lanes where the widths match, a split or merge where they differ (placed at random). Then, with CROSS_LINK_P, one
 * extra edge that crosses none of the others (only the corners of a diagonal step qualify).
 */
function linkLayers(rng: Rng, m: number, n: number): Array<[number, number]> {
  const di = m - 1, dj = n - 1, steps: Array<"i" | "j" | "ij"> = [];
  for (let k = Math.min(di, dj); k > 0; k--) steps.push("ij");
  for (let k = Math.abs(di - dj); k > 0; k--) steps.push(di > dj ? "i" : "j");
  for (let k = steps.length - 1; k > 0; k--) { const r = Math.floor(rng() * (k + 1)); [steps[k], steps[r]] = [steps[r], steps[k]]; }
  const edges: Array<[number, number]> = [[0, 0]];
  let [i, j] = [0, 0];
  for (const st of steps) { if (st !== "j") i++; if (st !== "i") j++; edges.push([i, j]); }
  if (rng() < CROSS_LINK_P) {
    const has = (a: number, b: number) => edges.some(([x, y]) => x === a && y === b);
    const free: Array<[number, number]> = [];
    for (let a = 0; a < m; a++) for (let b = 0; b < n; b++)
      if (!has(a, b) && edges.every((e) => !crosses(e, [a, b]))) free.push([a, b]);
    if (free.length) edges.push(pick(rng, free));
  }
  return edges;
}

/** Layered DAG: one node in the first and last layer, 1..MAX_WIDTH in between, edges only layer n -> n+1, never crossing. */
function buildShape(rng: Rng, actIndex: number, alternate: boolean): MapNode[][] {
  const total = 12 + Math.floor(rng() * 3); // 12..14 (kbph: longer acts, more decisions)
  // Exit must be bad (boss), so with alternation its layer index is odd: 6 or 8 layers.
  const r = rng();
  const layerCount = alternate ? (r < 0.5 ? 6 : 8) : 6 + Math.floor(r * 3); // even when alternating: entry good, exit bad
  // Middle layers start at MIN_WIDTH; if that can't fit the node budget, fall back to fewer layers.
  let lc = layerCount;
  while (lc > 4 && 2 + (lc - 2) * MIN_WIDTH > total) lc -= alternate ? 2 : 1;
  const widths = Array.from({ length: lc }, (_, i) => (i === 0 || i === lc - 1 ? 1 : MIN_WIDTH));
  for (let extra = total - widths.reduce((a, b) => a + b, 0); extra > 0; extra--) {
    const open = widths.map((w, i) => (i > 0 && i < lc - 1 && w < MAX_WIDTH ? i : -1)).filter((i) => i >= 0);
    widths[pick(rng, open)]++;
  }
  let n = 0;
  const layers = widths.map((w, layer) =>
    Array.from({ length: w }, (_, slot): MapNode => ({ id: `a${actIndex}n${n++}`, kind: "fight", layer, slot, next: [] })),
  );
  for (let l = 0; l < lc - 1; l++) {
    const [from, to] = [layers[l], layers[l + 1]];
    for (const [a, b] of linkLayers(rng, from.length, to.length)) from[a].next.push(to[b].id);
    for (const a of from) a.next.sort((x, y) => to.findIndex((t) => t.id === x) - to.findIndex((t) => t.id === y)); // exits left to right
  }
  return layers;
}

function assignKinds(layers: MapNode[][], rng: Rng, alternate: boolean, mods: Modifiers, actIndex: number): void {
  const banned = new Set(mods.banKinds ?? []);
  const playable: Kind[] = [...GOOD_KINDS, ...BAD_KINDS.filter((k) => k !== "boss")];
  // Bans are dropped for a polarity only if they would leave it empty.
  const pool = (pol?: Polarity): Kind[] => {
    const all = playable.filter((k) => !pol || polarity(k) === pol);
    const ok = all.filter((k) => !banned.has(k));
    return ok.length ? ok : all;
  };
  const polFor = (layer: number) => (alternate ? layerPolarity(layer) : undefined);
  const middle = layers.slice(1, -1).flat();
  const forced = new Set<string>();

  for (const [kind, count] of Object.entries(mods.forceKinds ?? {}) as [Kind, number][]) {
    if (!playable.includes(kind) || banned.has(kind) || !(count > 0)) continue;
    const free = middle.filter((n) => !forced.has(n.id) && (!alternate || layerPolarity(n.layer) === polarity(kind)));
    for (let i = Math.min(Math.floor(count), free.length); i > 0; i--) { // draw without replacement
      const [n] = free.splice(Math.floor(rng() * free.length), 1);
      n.kind = kind;
      forced.add(n.id);
    }
  }
  const root = layers[0][0];
  root.kind = pick(rng, pool("good")); // drawn even for act 1, so the rest of the act is the same as before the start rule
  if (actIndex === 0) root.kind = START_KIND; // like the exit boss, this ignores modifiers
  for (const n of middle) if (!forced.has(n.id)) n.kind = pick(rng, pool(polFor(n.layer)));
  layers[layers.length - 1][0].kind = "boss";
}

/**
 * Deterministic in (runSeed, actIndex, modifiers, alternate). Modifiers only change kinds, never the
 * shape: the shape is drawn first from the seeded stream.
 */
export function generateAct(runSeed: Seed, actIndex: number, modifiers: Modifiers = {}, opts: GenOptions = {}): Act {
  if (!Number.isInteger(actIndex) || actIndex < 0 || actIndex >= ACTS) throw new RangeError(`actIndex must be 0..${ACTS - 1}`);
  const alternate = opts.alternate ?? true;
  const rng = mulberry32(hashSeed(`${runSeed}:${actIndex}`));
  const layers = buildShape(rng, actIndex, alternate);
  assignKinds(layers, rng, alternate, modifiers, actIndex);
  const nodes = layers.flat();
  const exit = layers[layers.length - 1][0];
  const act: Act = { index: actIndex, runSeed, alternate, nodes, entry: nodes[0].id, exit: exit.id, changes: [], visited: [] };
  if (actIndex === ACTS - 1) act.final = { id: "final", kind: "final", layer: exit.layer + 1, slot: 0, next: [] };
  return act;
}

/** Returns a new act with `nodeId` marked visited (unknown ids are ignored). */
export function markVisited(act: Act, nodeId: string): Act {
  const known = act.nodes.some((n) => n.id === nodeId);
  return known && !act.visited.includes(nodeId) ? { ...act, visited: [...act.visited, nodeId] } : act;
}

/**
 * Devil rewrite of a not-yet-visited node. Never throws; returns the new act plus the change (for the UI)
 * or a reason. The devil may break good/bad alternation (team call, 3 Oct): a polarity flip is allowed,
 * clears `act.alternate`, and is flagged on the change so the player can be told.
 */
export function rewriteNode(act: Act, nodeId: string, newKind: Kind): RewriteResult {
  const no = (reason: string): RewriteResult => ({ ok: false, reason });
  const node = act.nodes.find((n) => n.id === nodeId);
  if (!node) return no(`unknown node ${nodeId}`);
  if (!isKind(newKind)) return no(`unknown kind ${String(newKind)}`);
  if (node.id === act.entry) return no("the entry node cannot be rewritten");
  if (node.id === act.exit) return no("the exit boss cannot be rewritten");
  if (act.visited.includes(node.id)) return no("node already visited");
  if (newKind === "boss" || newKind === "final") return no(`${newKind} is reserved for the act exit`);
  if (newKind === node.kind) return no(`node is already ${newKind}`);
  const change: RewriteChange = { nodeId, from: node.kind, to: newKind, polarityFlip: polarity(newKind) !== polarity(node.kind) };
  const nodes = act.nodes.map((n) => (n === node ? { ...n, kind: newKind } : n));
  return { ok: true, change, act: { ...act, nodes, alternate: act.alternate && !change.polarityFlip, changes: [...act.changes, change] } };
}
