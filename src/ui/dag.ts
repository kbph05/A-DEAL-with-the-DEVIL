/** "Where to next": the current act as a DAG of boxes (stairs/final door on top, entry at the bottom), edges as SVG lines. */
import type { Command } from "../game";
import { dagWord, type Dag, type DagKind, type DagNode } from "./logic";
import { h } from "./dom";

const ICON: Record<DagKind, string> = { campfire: "🔥", village: "🏘", well: "⛲", deal: "😈", fight: "⚔", boss: "👹", final: "🚪", stairs: "🪜" };
const SVG = "http://www.w3.org/2000/svg";

export interface DagView { el: HTMLElement; update(m: Dag): void }

/** `send` runs a command. The container is created once (it owns the resize observer); `update` swaps the rows. */
export function mountDag(send: (c: Command) => void): DagView {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "dag-edges");
  svg.setAttribute("aria-hidden", "true");
  const rowsEl = h("div", { class: "dag-rows" });
  const hint = h("p", { class: "dag-hint", id: "dag-hint" });
  const el = h("div", { class: "dag" }, svg, rowsEl);
  const wrap = h("div", { class: "dag-wrap" }, el, hint);
  let model: Dag | null = null;

  const box = (n: DagNode): HTMLElement => {
    const kids: Array<Node | string> = [
      h("span", { class: "ico", aria: { hidden: "true" }, text: ICON[n.kind] }),
      h("span", { class: "kind", text: dagWord(n.kind) }),
      h("small", { class: "id", text: n.kind === "stairs" ? "next act" : n.id }),
    ];
    if (n.rewritten) kids.push(h("span", { class: "star", aria: { hidden: "true" }, text: "★" }));
    if (n.state === "current") kids.unshift(h("span", { class: "here", aria: { hidden: "true" }, text: "▼ YOU ARE HERE" }));
    const cls = `node ${n.kind} ${n.state}${n.rewritten ? " rewritten" : ""}`;
    if (n.state !== "next") {
      const d = h("div", { class: cls }, ...kids);
      d.dataset.id = n.id;
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", n.label);
      if (n.state === "current") d.setAttribute("aria-current", "location");
      return d;
    }
    const b = h("button", { class: cls }, ...kids);
    b.type = "button"; b.dataset.id = n.id;
    b.setAttribute("aria-label", n.label);
    b.title = n.disabled ?? n.label;
    if (n.disabled) { b.disabled = true; b.setAttribute("aria-describedby", "dag-hint"); }
    else b.onclick = () => send({ cmd: "go", n: n.n! });
    return b;
  };

  /** Lines from the top edge of the lower box to the bottom edge of the upper box, measured from the live layout. */
  function drawEdges() {
    if (!model) return;
    const box0 = el.getBoundingClientRect();
    if (!box0.width) return;
    svg.setAttribute("viewBox", `0 0 ${box0.width} ${box0.height}`);
    const byId = new Map([...rowsEl.querySelectorAll<HTMLElement>("[data-id]")].map((x) => [x.dataset.id!, x]));
    const state = new Map(model.rows.flat().map((n) => [n.id, n.state]));
    svg.replaceChildren();
    for (const [from, to] of model.edges) {
      const a = byId.get(from)?.getBoundingClientRect(), b = byId.get(to)?.getBoundingClientRect();
      if (!a || !b) continue;
      const line = document.createElementNS(SVG, "line");
      line.setAttribute("x1", String(a.left + a.width / 2 - box0.left)); line.setAttribute("y1", String(a.top - box0.top));
      line.setAttribute("x2", String(b.left + b.width / 2 - box0.left)); line.setAttribute("y2", String(b.bottom - box0.top));
      const out = state.get(from) === "current" && state.get(to) === "next";
      const done = (id: string) => state.get(id) === "visited" || state.get(id) === "current";
      const walked = done(from) && done(to);
      line.setAttribute("class", out ? "edge out" : walked ? "edge walked" : "edge");
      svg.append(line);
    }
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(drawEdges).observe(el);

  return {
    el: wrap,
    update(m) {
      model = m;
      rowsEl.replaceChildren(...m.rows.map((r) => h("div", { class: "layer" }, ...r.map(box))));
      hint.textContent = m.lock ?? "";
      hint.hidden = !m.lock;
      drawEdges();
    },
  };
}
