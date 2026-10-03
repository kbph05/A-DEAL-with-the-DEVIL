/** Test-only: the current act as a DAG of boxes (entry at the bottom). Imported by tools.ts only, so final builds drop it. */
import type { MapView } from "../game";
import { h } from "./dom";

export function renderMap(el: HTMLElement, m: MapView): void {
  const why = new Map(m.changes.map((c) => [c.nodeId, `${c.from} → ${c.to}`]));
  const box = (n: MapView["layers"][number]["nodes"][number]) => h("div", {
    class: `node ${n.kind}${n.current ? " current" : ""}${n.visited ? " visited" : ""}${n.rewritten ? " rewritten" : ""}`,
    title: `${n.id} → ${n.next.join(", ") || "-"}${why.has(n.id) ? ` (rewritten ${why.get(n.id)})` : ""}`,
  }, h("small", { text: n.id }), n.kind, n.rewritten ? " ★" : "");
  const rows = [...(m.final ? [[m.final]] : []), ...[...m.layers].reverse().map((l) => l.nodes)];
  el.replaceChildren(...rows.map((ns) => h("div", { class: "layer" }, ...ns.map(box))));
}
