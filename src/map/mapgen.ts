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
/** Fewest lanes in a middle layer (entry and exit layers are always 1). At most 2, so a layer can still step down to the exit. */
export const MIN_WIDTH = 1;
/** Nodes per act, entry and exit included (kbph, 3 Oct: longer acts, more decisions). */
export const MIN_NODES = 12;
export const MAX_NODES = 14;
/**
 * Layers per act, drawn first (seeded, uniform). Alternating acts need an even count: the entry (layer 0) is good and
 * the exit boss sits on an odd layer. 6 layers can only make 12 nodes, as 1-2-3-3-2-1.
 */
const LAYER_COUNTS = { alternate: [6, 8], free: [6, 7, 8] } as const;
/** Width walks tried per act before settling for the one closest to MIN_NODES..MAX_NODES (see buildShape). */
const WIDTH_TRIES = 256;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const layerPolarity = (layer: number): Polarity => (layer % 2 === 0 ? "good" : "bad");

/** Two edges between the same pair of layers cross, in slot order, iff their ends are in opposite order. */
const crosses = (e: readonly [number, number], f: readonly [number, number]): boolean => (e[0] - f[0]) * (e[1] - f[1]) < 0;

/**
 * Clamp bounds for the width of layer `i` of `layerCount`: the entry and exit are 1; a middle layer is MIN_WIDTH to
 * MAX_WIDTH but never wider than `layerCount - i`, so the widths can still narrow by one per layer to the single exit.
 */
export function widthBounds(i: number, layerCount: number): [number, number] {
  if (i === 0 || i === layerCount - 1) return [1, 1];
  const hi = Math.min(MAX_WIDTH, layerCount - i);
  return [Math.min(MIN_WIDTH, hi), hi];
}

/**
 * Designer's walk (Big Chungus, 4 Oct): each layer is the previous width plus or minus 1 (a coin flip), clamped to
 * widthBounds. So widths change by exactly 1, except where the clamp holds them (at MIN_WIDTH, at MAX_WIDTH, or at the
 * narrowing cap), and always end on 1. With alternation (even layer count) every act has at least one such hold,
 * because plain +-1 steps from 1 can only get back to 1 after an even number of steps.
 */
function walkWidths(rng: Rng, layerCount: number): number[] {
  const widths = [1];
  for (let i = 1; i < layerCount; i++) {
    const [lo, hi] = widthBounds(i, layerCount);
    widths.push(Math.max(lo, Math.min(hi, widths[i - 1] + (rng() < 0.5 ? -1 : 1))));
  }
  return widths;
}

/**
 * Edges (as slot pairs) joining a layer of `m` nodes to the next one of `n`, planar in slot order by construction
 * (designer's rule, 4 Oct). First pass: each of the `m` nodes picks one random new node, and the picks are dealt out
 * left to right in sorted order, so the targets never decrease and no two edges cross. Second pass: each new node left
 * without a parent, left to right, gets one, picked at random among the old nodes whose edge to it would cross none
 * so far (there is always at least one: the old nodes on either side of the gap it sits in). The first `m` edges
 * returned are the first pass, in slot order; the rest are the second.
 */
export function linkLayers(rng: Rng, m: number, n: number): Array<[number, number]> {
  const picks = Array.from({ length: m }, () => Math.floor(rng() * n)).sort((a, b) => a - b);
  const edges = picks.map((t, i): [number, number] => [i, t]);
  for (let j = 0; j < n; j++) {
    if (picks.includes(j)) continue;
    const ok = Array.from({ length: m }, (_, a) => a).filter((a) => edges.every((e) => !crosses(e, [a, j])));
    edges.push([pick(rng, ok), j]);
  }
  return edges;
}

/**
 * Layered DAG: one node in the first and last layer, widths from walkWidths in between, edges only layer n -> n+1 via
 * linkLayers, never crossing. The layer count is drawn first; then width walks are drawn until one totals
 * MIN_NODES..MAX_NODES. That takes about 8 tries for 6 layers and 3 for 8, so WIDTH_TRIES (256) never runs out with
 * the shipped constants; if it does (other MIN_WIDTH/MAX_WIDTH), the walk closest to the range is used, still a legal shape.
 */
function buildShape(rng: Rng, actIndex: number, alternate: boolean): MapNode[][] {
  const layerCount = pick(rng, alternate ? LAYER_COUNTS.alternate : LAYER_COUNTS.free);
  const miss = (ws: number[]) => { const t = ws.reduce((a, b) => a + b, 0); return Math.max(MIN_NODES - t, t - MAX_NODES, 0); };
  let widths = walkWidths(rng, layerCount);
  for (let t = 1; t < WIDTH_TRIES && miss(widths) > 0; t++) {
    const w = walkWidths(rng, layerCount);
    if (miss(w) < miss(widths)) widths = w;
  }
  let n = 0;
  const layers = widths.map((w, layer) =>
    Array.from({ length: w }, (_, slot): MapNode => ({ id: `a${actIndex}n${n++}`, kind: "fight", layer, slot, next: [] })),
  );
  for (let l = 0; l < layerCount - 1; l++) {
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
