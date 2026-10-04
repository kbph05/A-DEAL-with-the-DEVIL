# src/map: act map generator

Dependency-free TypeScript. A run is 3 acts, each a layered DAG of 12-14 nodes (`MIN_NODES`..`MAX_NODES`) with one entry and one exit
(always a `boss`); act 3 also has a separate `final` node after its boss. Deterministic from
`(runSeed, actIndex, modifiers)`; generate act 0 at start, acts 1 and 2 on arrival.

Shape (designer's algorithm, 4 Oct): 6 or 8 layers (even, so the boss lands on a bad layer; 6-8 without alternation).
Layer 0 is 1 node; each next layer is the previous width plus or minus 1 (coin flip), clamped to `MIN_WIDTH`..`MAX_WIDTH`
in the middle and to at most `layers - i` so it narrows back to the single exit (`widthBounds`). Walks are redrawn until
the act totals 12-14 nodes (at most 256 tries, then the closest walk). Width 4 cannot occur at 12-14 nodes (it needs 16).
Linking (`linkLayers`): each old node links to one new node (sorted picks, so targets never decrease), then each new node
left without a parent is adopted by an old node whose edge crosses none. Edges never cross when each layer is drawn in
slot order (planar by construction); there are no extra cross-links.

- `generateAct(runSeed, actIndex /*0..2*/, modifiers?, { alternate = true }?) => Act`
- `rewriteNode(act, nodeId, newKind) => { ok: true, act } | { ok: false, reason }`: immutable, never throws;
  rejects visited nodes, entry, exit, boss/final, unknown kinds and no-op swaps. The devil MAY break good/bad alternation: the result carries `change` (`{nodeId, from, to, polarityFlip}`) and the act keeps a `changes` log, so the UI can tell the player what moved.
- `markVisited(act, nodeId) => Act`
- `Modifiers = { forceKinds?: Partial<Record<Kind, number>>, banKinds?: Kind[] }`: "at least N" and "never".
  They change kinds, never shape; a ban that leaves a slot no legal kind is ignored for that polarity.
- `MapNode = { id, kind, layer, slot, next }`; edges go layer n to n+1. Chain acts with
  `acts[i].exit` to `acts[i+1].entry`, and the last `exit` to `act.final`.

```ts
import { generateAct, rewriteNode } from "./map";
const act = generateAct("run-42", 0, { forceKinds: { campfire: 1 }, banKinds: ["well"] });
const r = rewriteNode(act, act.nodes[2].id, "village"); // devil swaps an upcoming node
```
