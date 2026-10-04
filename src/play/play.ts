/**
 * The play page (`/play.html`, docs/play.md): the game as one screen. The scene for the current node (the village to
 * walk and shop in, the forest path for fights, a dim backdrop with a panel for campfires and wells), the HUD over it,
 * the act map when it is open or forced, the devil's full-screen overlay, and the ending card. Every engine command
 * goes through the one shared `Session`; what is on screen is derived from `flow(view, local)` (flow.ts) on each render.
 */
import "./play.css";
import { HttpDevil, describe, execute, setDevil, type Command, type GameEvent, type View } from "../game";
import { createSession } from "../game/session";
import { runForestFight } from "../fight";
import { mountHud } from "../hud/hud";
import { hudModel } from "../hud/model";
import { mountMap, type MapHandle } from "../mapscene";
import { paintIcon, type IconKey } from "../mapscene/icons";
import { effectChips, curseText, lastStrike, outcomeEvents, questionsText } from "../ui/logic";
import { mountScene, sceneById, type SceneHandle, type SceneZone } from "../world";
import { shopPrompt } from "../world/shopZone";
import { CLOSE_DEVIL, LOCAL, OPEN_DEVIL, arrived, flow, setLocal, type Flow, type Local } from "./flow";

const params = new URLSearchParams(location.search);
const TEST = import.meta.env.MODE === "test";
/** Lab only (test builds): `?god=1` plays fights with huge HP and attack. The engine still clamps the result to the real HP. */
const GOD = TEST && params.get("god") === "1";
if (import.meta.env.VITE_DEVIL_URL) setDevil(new HttpDevil(import.meta.env.VITE_DEVIL_URL)); // else: the StubDevil

const END: Record<string, [string, string]> = {
  win: ["You win.", "The devil is gracious about it, which is worse."],
  hell: ["HELL.", "You won, but you sold your soul."],
  lose: ["You died.", "The devil keeps the change."],
};
const WHERE: Record<string, string> = { deal: "at his table", campfire: "by the fire", well: "on the rim of the well" };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text: string, onClick: () => void, cls = "", sub?: string): HTMLButtonElement {
  const b = h("button", cls);
  b.type = "button";
  if (sub) b.append(h("span", "", text), h("small", "", sub)); else b.textContent = text;
  b.onclick = onClick;
  return b;
}
function icon(k: IconKey): HTMLCanvasElement {
  const c = h("canvas");
  c.width = 16; c.height = 16;
  const ctx = c.getContext("2d");
  if (ctx) paintIcon(ctx, k);
  c.setAttribute("aria-hidden", "true");
  return c;
}

// ---- layout ------------------------------------------------------------------------------------------------------
const root = document.getElementById("play")!;
root.classList.add("play");
const sceneLayer = h("div", "play-layer play-scene");
const mapLayer = h("div", "play-layer play-map");
mapLayer.hidden = true;
root.append(sceneLayer, mapLayer);
const session = createSession(params.get("seed") ?? undefined);
const hud = mountHud(root, { onUseItem: (item) => { if (item.command) void send(item.command); } });
const mapBtn = button("Map", () => toggleMap(true), "play-mapbtn");
mapBtn.append(h("span", "key", " (M)"));
mapBtn.setAttribute("aria-keyshortcuts", "M");
const mapClose = button("Close map", () => toggleMap(false), "play-mapclose quiet");
const mapTitle = h("div", "play-maptitle", "Choose where to go next");
const prompt = h("div", "play-prompt");
const panel = h("div", "play-layer play-dim");
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-modal", "true");
const devil = h("div", "play-layer play-devil");
devil.setAttribute("role", "dialog");
devil.setAttribute("aria-modal", "true");
devil.setAttribute("aria-label", "The devil");
const ending = h("div", "play-layer play-ending");
const toast = h("div", "play-toast");
toast.setAttribute("role", "status");
toast.setAttribute("aria-live", "polite");
toast.hidden = true;
root.append(mapBtn, mapClose, mapTitle, prompt, panel, devil, ending, toast);

// ---- state -------------------------------------------------------------------------------------------------------
let local: Local = LOCAL;
let log: GameEvent[] = []; // newest first, like the DOM UI's history
let zone: SceneZone | null = null; // the village zone the feet are in
let mounted: { key: string; destroy(): void } | null = null;
let world: SceneHandle | null = null;
let map: MapHandle | null = null;
let autoFought: string | null = null; // the node whose fight was started on arrival
let wish = "";
let toastTimer = 0;
let current: Flow = flow(session.game().view(), local);

function patch(p: Partial<Local>): void { local = setLocal(local, session.game().view().nodeId, p); render(); }

function say(events: GameEvent[]): void {
  // The devil's own words are in his overlay; the toast carries everything else (and a lone rejection).
  const shown = outcomeEvents(events).filter((e) => e.type !== "deal_offered" && e.type !== "devil_struck" && (e.type !== "rejected" || events.length === 1));
  const text = shown.map(describe).filter(Boolean).join(" ");
  if (!text) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, Math.min(9000, 2500 + text.length * 45));
}

/** Run one command through the session (the devil's `deal` is async), announce it, re-render. */
async function send(c: Command): Promise<void> {
  if (local.busy) return;
  const g = session.game();
  if (c.cmd === "deal") local = setLocal(local, g.view().nodeId, { busy: "devil" });
  render();
  let events: GameEvent[] = [];
  try { events = (await execute(g, c)).events; } finally { local = { ...local, busy: null }; }
  if (session.game() !== g) return;
  session.emit(events);
}

session.subscribe((events) => {
  if (events.some((e) => e.type === "started")) { log = []; local = LOCAL; autoFought = null; wish = ""; }
  const moved = events.find((e) => e.type === "moved");
  if (moved) { local = arrived(moved.to); wish = ""; }
  for (const e of events) log.unshift(e);
  log = log.slice(0, 200);
  say(events);
  render();
});

// ---- the realtime fight ------------------------------------------------------------------------------------------
async function fight(): Promise<void> {
  if (local.busy) return;
  const g = session.game();
  let req = g.gameState.pendingFight ?? null, pre: GameEvent[] = [];
  if (!req) {
    const r = g.step({ cmd: "fight", realtime: true });
    if (!r.ok || !r.awaiting?.fight) { session.emit(r.events); return; }
    req = r.awaiting.fight; pre = r.events;
  }
  local = setLocal(local, g.view().nodeId, { busy: "fight" });
  render(); // unmounts the world scene, shows the stage
  const stage = h("div", "play-layer");
  sceneLayer.replaceChildren(stage);
  mounted = { key: `fight:${g.view().nodeId}`, destroy: () => stage.remove() };
  (document.activeElement as HTMLElement | null)?.blur(); // Space must not press a button behind the fight
  const input = GOD ? { ...req, player: { hp: 9999, maxHp: 9999, attack: 99 } } : req;
  let report: unknown = null;
  try { report = await runForestFight(stage, input); } catch (err) { say([{ type: "rejected", reason: `the fight could not start (${err instanceof Error ? err.message : String(err)})` }]); }
  local = { ...local, busy: null };
  if (session.game() !== g) return;
  const r = g.fightResult(report ?? {}); // nothing reported: an unfinished fight, nothing changes
  session.emit([...pre, ...r.events]);
}

// ---- the map -----------------------------------------------------------------------------------------------------
function toggleMap(open: boolean): void {
  if (!current.mapButton) return;
  patch({ mapOpen: open });
  if (!open) mapBtn.focus();
}

function go(n: number): void {
  if (local.busy) return;
  void send({ cmd: "go", n });
}

function renderMap(v: View, f: Flow): void {
  const show = f.map !== "closed";
  mapLayer.hidden = !show;
  if (!show) { map?.destroy(); map = null; return; }
  if (map) map.update(v.map, v, local.busy !== null);
  else map = mountMap(mapLayer, { onGo: go, map: v.map, view: v, busy: local.busy !== null });
}

// ---- the scene under it all --------------------------------------------------------------------------------------
function renderScene(v: View, f: Flow): void {
  const key = f.screen === "village" ? `village:${v.nodeId}` : f.screen === "fight" ? `fight:${v.nodeId}` : `backdrop:${v.kind}:${v.nodeId}`;
  if (mounted?.key === key) return;
  if (f.screen === "fight" && local.busy === "fight") return; // the fight owns the stage
  mounted?.destroy(); world = null; zone = null;
  sceneLayer.replaceChildren();
  if (f.screen === "village") {
    const el = h("div", "play-layer");
    sceneLayer.append(el);
    world = mountScene(el, {
      scene: sceneById("village"),
      onEnterZone: (z) => {
        if (z.kind === "shop") { zone = z; render(); }
        if (z.kind === "exit") toggleMap(true);
      },
      onLeaveZone: (z) => { if (zone?.id === z.id) { zone = null; render(); } },
    });
    const w = world;
    mounted = { key, destroy: () => { w.destroy(); el.remove(); } };
    return;
  }
  const bd = h("div", "play-layer play-backdrop");
  const kind: IconKey = v.kind === "final" ? "final" : v.kind;
  bd.append(icon(kind));
  sceneLayer.append(bd);
  mounted = { key, destroy: () => bd.remove() };
}

// ---- prompts and panels ------------------------------------------------------------------------------------------
function renderPrompt(v: View, f: Flow): void {
  prompt.replaceChildren();
  prompt.hidden = true;
  if (f.screen !== "village" || f.map !== "closed" || f.devil || !zone || zone.kind !== "shop") return;
  const p = shopPrompt(zone, v);
  prompt.hidden = false;
  const buy = button(p.price !== null ? `Buy (${p.price}g)` : "Buy", () => { if (p.command) void send(p.command); });
  buy.disabled = !p.enabled;
  prompt.append(h("b", "", p.title), buy, h("p", "", p.desc));
  if (p.reason) prompt.append(h("p", "why", p.reason));
}

let panelKey = "";
function renderPanel(v: View, f: Flow): void {
  const show = (f.screen === "campfire" || f.screen === "well" || (f.screen === "fight" && f.prompts.includes("fight") && autoFought === v.nodeId))
    && f.map === "closed" && !f.devil;
  panel.hidden = !show;
  if (!show) { panelKey = ""; return; }
  const key = JSON.stringify([v.nodeId, f.prompts, v.state.gold, v.resolved, v.state.hp]);
  if (key === panelKey) return;
  panelKey = key;
  const card = h("div", "play-card"), list = h("div", "play-choices");
  const title = h("h2");
  if (f.screen === "campfire") {
    title.append(icon("campfire"), "A campfire");
    card.append(title, h("p", "lead", "One choice, then the night moves on."));
    const can = (p: string) => f.prompts.includes(p as never);
    const rest = button("Rest", () => void send({ cmd: "rest" }), "", `Heal ${Math.ceil(v.state.maxHp * 0.4)} HP`);
    const train = button("Sharpen Weapon", () => void send({ cmd: "train" }), "", "+1 attack, for the rest of the run");
    const deal = button("Deal", () => patch(OPEN_DEVIL), "", "Talk to the devil by the fire");
    rest.disabled = !can("rest"); train.disabled = !can("train"); deal.disabled = !can("deal");
    list.append(rest, train, deal);
  } else if (f.screen === "well") {
    title.append(icon("well"), "A well");
    card.append(title, h("p", "lead", v.devilPresent ? "Someone sits on the rim of the well, smiling." : "Cold water, and an old coin slot."));
    const p = shopPrompt({ id: "well", kind: "shop", item: "blessing", label: "Well", x: 0, y: 0, w: 1, h: 1 }, v);
    const buy = button(`Buy a blessing (${p.price}g)`, () => { if (p.command) void send(p.command); }, "", p.enabled ? p.desc : p.reason);
    buy.disabled = !p.enabled;
    list.append(buy);
    if (f.prompts.includes("deal")) list.append(button("Deal", () => patch(OPEN_DEVIL), "", "Talk to the devil at the well"));
    list.append(button("Move on", () => patch({ movedOn: true }), "quiet", "Choose the next stop on the map"));
  } else {
    title.append(icon("fight"), "Back on your feet");
    card.append(title, h("p", "lead", `The ${v.enemy?.name ?? "enemy"} is still there.`));
    list.append(button("Fight on", () => void fight()));
  }
  card.append(list);
  panel.replaceChildren(card);
  list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

function renderDevil(v: View, f: Flow): void {
  devil.hidden = !f.devil;
  if (!f.devil) return;
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement && devil.contains(active);
  if (typing && local.busy === null && devil.dataset.key === JSON.stringify([v.nodeId, v.asksLeft, v.questionsLeft, !!v.offer])) return;
  devil.dataset.key = JSON.stringify([v.nodeId, v.asksLeft, v.questionsLeft, !!v.offer]);
  const card = h("div", "play-card");
  const canAsk = v.actions.some((c) => c.cmd === "deal");
  const busy = local.busy === "devil" || v.pending;
  card.append(h("h2", "", `The devil, ${WHERE[v.kind] ?? "here"}`));
  const strike = lastStrike(log);
  if (strike) card.append(h("p", "strike", `The devil strikes! ${strike.dialogue}`));
  const line = busy ? "The devil considers…" : v.offer ? `“${v.offer.dialogue}”` : canAsk ? "“Well? Name your wish.”" : v.questionsLeft <= 0 ? "“I have heard enough from you this run.”" : "“We are done here.”";
  card.append(h("p", "say", line));
  if (v.offer && !busy) {
    const chips = h("div", "chips");
    for (const c of effectChips(v.offer.effects)) chips.append(h("span", `chip ${c.tone}`, c.text));
    if (v.offer.curse) chips.append(h("span", "chip bad", `Curse, ${curseText(v.offer.curse)}`));
    if (v.offer.rewrite) chips.append(h("span", "chip bad", `Rewrites ${v.offer.rewrite.nodeId} into a ${v.offer.rewrite.to}`));
    card.append(chips);
  }
  card.append(h("p", "count", `${questionsText(v.questionsLeft)} · asks left here: ${v.asksLeft}`));
  if (canAsk || busy) {
    const form = h("form"), input = h("input");
    input.type = "text"; input.maxLength = 2000; input.value = wish;
    input.placeholder = v.offer ? "Haggle: ask for something else" : "Make a wish";
    input.setAttribute("aria-label", "Your wish");
    input.oninput = () => { wish = input.value; };
    const ask = h("button", "", v.offer ? "Haggle" : "Ask");
    ask.type = "submit";
    ask.disabled = busy;
    input.disabled = busy;
    form.onsubmit = (e) => { e.preventDefault(); const text = wish.trim(); wish = ""; void send({ cmd: "deal", text }); };
    form.append(input, ask);
    card.append(form);
  }
  const row = h("div", "row");
  if (v.offer && !busy) row.append(button("Accept", () => void send({ cmd: "accept" })), button("Refuse", () => void send({ cmd: "refuse" }), "quiet"));
  if (!v.offer && !busy) row.append(button("Walk away", () => patch(CLOSE_DEVIL), "quiet"));
  card.append(row);
  devil.replaceChildren(card);
  (devil.querySelector<HTMLElement>("input:not(:disabled)") ?? devil.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
}

function renderEnding(f: Flow): void {
  ending.hidden = f.screen !== "ending";
  ending.className = `play-layer play-ending ${f.ending ?? ""}`;
  if (ending.hidden || ending.childElementCount) return;
  const [head, body] = END[f.ending ?? "lose"];
  const again = button("Play again", () => { ending.replaceChildren(); session.newGame(); });
  ending.append(h("div", "", undefined));
  ending.firstElementChild!.append(h("h2", "", head), h("p", "", body), again);
  again.focus();
}

function render(): void {
  const v = session.game().view();
  const f = flow(v, local);
  current = f;
  renderScene(v, f);
  renderMap(v, f);
  hud.el.hidden = f.screen === "fight" && local.busy === "fight";
  hud.update(hudModel(v));
  mapBtn.hidden = !f.mapButton || f.map !== "closed" || f.devil;
  mapClose.hidden = f.map !== "open";
  mapTitle.hidden = f.map !== "forced";
  renderPrompt(v, f);
  renderPanel(v, f);
  renderDevil(v, f);
  if (f.screen !== "ending") ending.replaceChildren();
  renderEnding(f);
  // A fight node: start the fight on arrival (a revival asks first, with "Fight on").
  if (f.screen === "fight" && f.prompts.includes("fight") && autoFought !== v.nodeId && !local.busy) {
    autoFought = v.nodeId;
    queueMicrotask(() => void fight());
  }
}

// ---- keys ----------------------------------------------------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if ((e.key === "m" || e.key === "M") && current.mapButton && !e.repeat) { toggleMap(current.map === "closed"); e.preventDefault(); }
  else if (e.key === "Escape" && current.map === "open") toggleMap(false);
  else if ((e.key === "e" || e.key === "E" || e.key === "Enter") && zone?.kind === "shop" && current.map === "closed" && !current.devil && (t === document.body || t?.tagName === "CANVAS")) {
    const p = shopPrompt(zone, session.game().view());
    if (p.command) void send(p.command);
  }
});

render();

if (TEST) {
  (window as unknown as Record<string, unknown>).__play = {
    session,
    flow: () => current,
    local: () => local,
    view: () => session.game().view(),
    map: () => map?.debug() ?? null,
    zone: () => zone?.id ?? null,
    toast: () => (toast.hidden ? "" : toast.textContent),
    send: (c: Command) => send(c),
  };
}
