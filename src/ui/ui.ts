/** Dummy test frontend: plain DOM over the headless engine. Every button calls the same engine functions as the console. */
import "./ui.css";
import { describe, execute, type Command, type GameEvent, type Observation } from "../game";
import { fmtDeltas } from "../game/events";
import type { Session } from "../game/session";
import { availableActions, eventClass } from "./logic";

type Attrs = { class?: string; text?: string; title?: string };
function h<K extends keyof HTMLElementTagNameMap>(tag: K, a: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (a.class) el.className = a.class;
  if (a.text !== undefined) el.textContent = a.text; // textContent only: devil text is untrusted
  if (a.title) el.title = a.title;
  el.append(...kids);
  return el;
}

const END: Record<string, [string, string]> = {
  win: ["You win.", "The devil is gracious about it, which is worse."],
  hell: ["HELL.", "You won, but you sold your soul."],
  lose: ["You died.", "The devil keeps the change."],
};

/** Returns a slot for optional test tools (the devil lab etc.), which are loaded separately so final builds can drop them. */
export function mountUI(root: HTMLElement, session: Session): { tools: HTMLElement } {
  let log: GameEvent[] = [];
  let busy = false;
  let lastReject = "";

  const wish = h("input", { class: "wish" });
  wish.placeholder = "tell the devil what you want (optional)";
  const seedIn = h("input", { class: "seed" });
  seedIn.placeholder = "seed (blank = random)";
  const newBtn = h("button", { text: "New game" });
  const head = h("header", {}, h("h1", { text: "A DEAL with the DEVIL" }), h("div", { class: "row" }, seedIn, newBtn));
  const banner = h("div", { class: "banner" }), stats = h("section", { class: "stats" }), here = h("section"),
    actions = h("section", { class: "actions" }), offer = h("section", { class: "offer" }),
    mapEl = h("section", { class: "map" }), logEl = h("section", { class: "log" }), tools = h("div", { class: "tools" });
  root.replaceChildren(head, banner, stats, here, actions, offer, h("div", { class: "cols" }, mapEl, logEl), tools);

  const push = (events: GameEvent[]) => {
    for (const e of events) if (e.type !== "looked") log.unshift(e); // the UI draws state itself; `looked` is console chatter
    log = log.slice(0, 200);
    const rej = events.find((e) => e.type === "rejected");
    lastReject = rej && rej.type === "rejected" ? rej.reason : "";
  };

  async function run(c: Command) {
    if (busy) return; // double-click guard (the engine also rejects a second deal while one is pending)
    const g = session.game();
    busy = true; render();
    let events: GameEvent[] = [];
    try { events = (await execute(g, c)).events; } finally { busy = false; }
    if (session.game() !== g) return; // a new game replaced the run while the devil was thinking
    push(events); render();
  }
  const btn = (label: string, c: Command | (() => Command), off = false, cls = "") => {
    const b = h("button", { text: label, class: cls });
    b.disabled = off;
    b.onclick = () => void run(typeof c === "function" ? c() : c); // built at click time so the wish input is current
    return b;
  };

  function render() {
    const g = session.game(), o: Observation = g.observe(), A = availableActions(o, busy);
    const s = o.state, curses = (g.look().events[0] as Extract<GameEvent, { type: "looked" }>).curses;
    const stat = (k: string, v: string | number) => h("div", { class: "stat" }, h("b", { text: String(v) }), h("small", { text: k }));
    stats.replaceChildren(stat("HP", `${s.hp}/${s.maxHp}`), stat("gold", s.gold), stat("attack", s.attack), stat("soul", s.soul ? "yours" : "gone"));
    banner.replaceChildren();
    banner.className = o.ending ? `banner show ${o.ending}` : "banner";
    if (o.ending) {
      const again = h("button", { text: "New game" });
      again.onclick = () => session.newGame(seedIn.value.trim() || undefined);
      banner.append(h("b", { text: END[o.ending][0] }), " ", END[o.ending][1], " ", again);
    }
    here.replaceChildren(
      h("p", {}, `Act ${o.act + 1} · ${o.nodeId} (${o.kind}) · seed `, h("code", { text: g.seed })),
      h("p", { class: "curses", text: curses.length ? `Curses: ${curses.map((c) => `${c.trigger} ${JSON.stringify(c.effect)}`).join("; ")}` : "No curses." }),
    );
    if (o.enemy) here.append(h("p", { class: "enemy", text: `${o.enemy.boss ? "Boss" : "Enemy"}: ${o.enemy.name} ${o.enemy.hp}/${o.enemy.maxHp} HP` }));

    const row = h("div", { class: "row" });
    if (A.fight) row.append(btn("Fight", { cmd: "fight" }, A.locked, "primary"));
    if (A.rest) row.append(btn("Rest", { cmd: "rest" }, A.locked));
    for (const w of A.buy) row.append(btn(`Buy ${w.item} (${w.cost}g)`, { cmd: "buy", item: w.item }, A.locked || !w.affordable));
    for (const x of A.exits) row.append(btn(`Go ${x.n}: ${x.kind}`, { cmd: "go", n: x.n }, A.locked));
    actions.replaceChildren(row);
    if (A.ask) actions.append(h("div", { class: "row" }, wish, btn(A.ask.again ? "Haggle" : "Ask the devil", () => ({ cmd: "deal", text: wish.value }), A.locked)));
    if (o.pending || (busy && A.ask)) actions.append(h("p", { class: "wait", text: "the devil considers…" }));
    if (lastReject) actions.append(h("p", { class: "reject", text: `Engine says: ${lastReject}` }));

    offer.replaceChildren();
    if (A.offer) {
      const d = A.offer;
      offer.append(h("blockquote", { text: `“${d.dialogue}”` }), h("p", { text: `gives: ${fmtDeltas(d.effects)}` }));
      if (d.curse) offer.append(h("p", { class: "ev-curse", text: `curse: ${d.curse.trigger} -> ${fmtDeltas(d.curse.effect)}` }));
      if (d.rewrite) offer.append(h("p", { class: "ev-rewrite", text: `rewrites ${d.rewrite.nodeId} → ${d.rewrite.to}` }));
      offer.append(h("div", { class: "row" }, btn("Accept", { cmd: "accept" }, A.locked, "primary"), btn("Refuse", { cmd: "refuse" }, A.locked)));
    }

    const m = g.map(), why = new Map(m.changes.map((c) => [c.nodeId, `${c.from} → ${c.to}`]));
    const box = (n: (typeof m.layers)[number]["nodes"][number]) => h("div", {
      class: `node ${n.kind}${n.current ? " current" : ""}${n.visited ? " visited" : ""}${n.rewritten ? " rewritten" : ""}`,
      title: `${n.id} → ${n.next.join(", ") || "-"}${why.has(n.id) ? ` (rewritten ${why.get(n.id)})` : ""}`,
    }, h("small", { text: n.id }), n.kind, n.rewritten ? " ★" : "");
    const rows = [...(m.final ? [[m.final]] : []), ...[...m.layers].reverse().map((l) => l.nodes)];
    mapEl.replaceChildren(h("h2", { text: `Map, act ${m.act + 1} (entry at bottom)` }), ...rows.map((ns) => h("div", { class: "layer" }, ...ns.map(box))));

    logEl.replaceChildren(h("h2", { text: "Log" }), ...log.map((e) => h("div", { class: `entry ${eventClass(e)}`, text: describe(e) })));
  }

  newBtn.onclick = () => session.newGame(seedIn.value.trim() || undefined);
  session.subscribe((events) => {
    if (events.some((e) => e.type === "started")) { log = []; lastReject = ""; busy = false; }
    push(events);
    render();
  });
  push([{ type: "started", seed: session.game().seed }]);
  render();
  return { tools };
}
