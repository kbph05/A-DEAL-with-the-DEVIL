# src/map: act map generator

Dependency-free TypeScript. A run is 3 acts, each a layered DAG of 6-8 nodes with one entry and one exit
(always a `boss`); act 3 also has a separate `final` node after its boss. Deterministic from
`(runSeed, actIndex, modifiers)`; generate act 0 at start, acts 1 and 2 on arrival.

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
