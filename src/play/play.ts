/**
 * The play page (`/play.html`, docs/play.md): the game as one screen. The scene for the current node (the village to
 * walk and shop in, the forest path for fights, a dim backdrop with a panel for campfires and wells), the HUD over it,
 * the act map when it is open or forced, the devil's full-screen overlay, and the ending card. Every engine command
 * goes through the one shared `Session`; what is on screen is derived from `flow(view, local)` (flow.ts) on each render.
 */
import "./play.css";
import type Phaser from "phaser";
import { HttpDevil, ONE_CHOICE, execute, isGibberish, setDevil, type Command, type GameEvent, type View } from "../game";
import { offTopicKind } from "../game/devil";
import { createSession } from "../game/session";
import { destroyGame } from "../destroyGame";
import { runForestFight, type FightSim } from "../fight";
import { mountHud } from "../hud/hud";
import { hudModel } from "../hud/model";
import { mountMap, type MapHandle } from "../mapscene";
import { paintIcon, type IconKey } from "../mapscene/icons";
import { effectChips, curseText, eventText, kindLookup, lastStrike, outcomeEvents, questionsText, restHint, rewriteText } from "../ui/logic";
import { mountScene, sceneById, type SceneHandle, type SceneZone, type WorldDebug } from "../world";
import { shopPrompt } from "../world/shopZone";
import { CLOSE_DEVIL, LOCAL, OPEN_DEVIL, arrived, flow, setLocal, wantsOpener, wellChoice, wishToSend, type Flow, type Local } from "./flow";
import { mountDevilArt } from "./devilArt";
import { POSE_MS, devilPose } from "./devilPose";
import { CONTROLS, pauseKey, pauseStep, startState, type PauseAction, type PauseState } from "./pause";
import { creditsBody, loadCredits } from "../render/credits";

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
const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
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
// The play page's HUD: no item bar (the village's stalls sell), ATK, Soul or Revive (kbph, 4 Oct; hudShown in src/hud/model.ts).
const hud = mountHud(root, { variant: "play" });
// Portrait puts the map title and the toast under the HUD's stats, which grow with the devil's line and curse chips:
// keep --hud-bottom (play.css) on the stats' real bottom edge. A hidden HUD (during a fight) keeps the last value.
const hudStats = hud.el.querySelector<HTMLElement>(".hud-stats");
if (hudStats) new ResizeObserver(() => {
  const b = hudStats.getBoundingClientRect();
  if (b.height > 0) root.style.setProperty("--hud-bottom", `${Math.round(b.bottom)}px`);
}).observe(hudStats);
const mapBtn = button("Map", () => toggleMap(true), "play-mapbtn");
mapBtn.append(h("span", "key", " (M)"));
mapBtn.setAttribute("aria-keyshortcuts", "M");
const mapClose = button("Close", () => toggleMap(false), "play-mapclose quiet");
mapClose.append(h("span", "key", " map")); // portrait hides " map" so the button clears the HUD stats
mapClose.setAttribute("aria-label", "Close map");
const mapTitle = h("div", "play-maptitle", "Choose where to go next");
const prompt = h("div", "play-prompt");
const panel = h("div", "play-layer play-dim");
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-modal", "true");
const devil = h("div", "play-layer play-devil");
devil.setAttribute("role", "dialog");
devil.setAttribute("aria-modal", "true");
devil.setAttribute("aria-label", "The devil");
const portrait = mountDevilArt(); // his silhouette above the card (devilArt.ts); kept across the card's re-renders
const ending = h("div", "play-layer play-ending");
const toast = h("div", "play-toast");
toast.setAttribute("role", "status");
toast.setAttribute("aria-live", "polite");
toast.hidden = true;
const pauseBtn = button("", () => undefined, "play-pausebtn quiet"); // two bars, drawn in play.css (a ⏸ glyph is missing from some fonts)
let pausedByPointer = false; // a click (not Enter/Space) opened the menu: focus doesn't go back to the button on Resume
pauseBtn.onclick = (e) => { pausedByPointer = e.detail > 0; doPause("pause"); pausedByPointer = false; };
pauseBtn.setAttribute("aria-label", "Pause");
pauseBtn.setAttribute("aria-keyshortcuts", "Escape P");
pauseBtn.title = "Pause (Esc or P)";
const pauseLayer = h("div", "play-layer play-pause");
pauseLayer.setAttribute("role", "dialog");
pauseLayer.setAttribute("aria-modal", "true");
pauseLayer.setAttribute("aria-labelledby", "play-pause-title");
pauseLayer.hidden = true;
const titleLayer = h("div", "play-layer play-title");
titleLayer.setAttribute("role", "region");
titleLayer.setAttribute("aria-label", "Title screen");
titleLayer.hidden = true;
// The credits (the sprite packs' attribution files): from the title screen, the pause menu and the ending card. Above
// all of them; Escape closes it first (pauseKey).
const credits = h("div", "play-layer play-credits");
credits.setAttribute("role", "dialog");
credits.setAttribute("aria-modal", "true");
credits.setAttribute("aria-label", "Credits");
credits.hidden = true;
root.append(mapBtn, mapClose, mapTitle, prompt, panel, devil, ending, toast, pauseBtn, pauseLayer, titleLayer, credits);

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
// The pause menu and the title screen (pause.ts). The village's and the fight's Phaser games, to pause them.
let ps: PauseState = startState(location.search);
let villageGame: Phaser.Game | null = null;
let fightGame: Phaser.Game | null = null;
let returnFocus: HTMLElement | null = null;
// Test builds: live positions, for the check that a paused game stands still.
let worldDebug: WorldDebug | null = null;
let fightSim: FightSim | null = null;
/** Focus an element, unless the pause menu (or the title screen) is up: a render behind it must not steal its focus. */
function focus(el: HTMLElement | null | undefined): void { if (!ps.paused && ps.screen === "run") el?.focus(); }

// ---- the devil's portrait: which pose (devilPose.ts), from his overlay's state and the clock ------------------------
const pose = {
  /** When the overlay opened, or the player stopped typing: idle shifts count from here. */
  since: 0,
  /** When the offer on the table arrived (null: none yet at this overlay). */
  offerAt: null as number | null,
  laughUntil: 0,
  /** The player is working in the wish box (clicked or typed in it); a box focused by the page alone doesn't count. */
  engaged: false,
  /** The wish just sent was gibberish, off-topic or a jailbreak: he scorns the player when he answers. */
  scorn: false,
};
let poseTimer = 0;
let leaving = 0; // he left laughing: the portrait lingers, fading, until this timer ends
const reducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
function updatePose(): void {
  const reduce = reducedMotion();
  portrait.set(devilPose({ now: performance.now(), since: pose.since, typing: pose.engaged || wish.trim() !== "", offerAt: pose.offerAt, laughUntil: pose.laughUntil, reducedMotion: reduce }), reduce);
}
function laughNow(): void { pose.laughUntil = performance.now() + POSE_MS.laugh; }
function stopTyping(): void {
  if (!pose.engaged) return;
  pose.engaged = false;
  pose.since = performance.now();
}
devil.addEventListener("pointerdown", (e) => { if (e.target instanceof HTMLInputElement) { pose.engaged = true; updatePose(); } });
devil.addEventListener("keydown", (e) => { if (e.target instanceof HTMLInputElement && e.key !== "Tab" && e.key !== "Escape") { pose.engaged = true; updatePose(); } });
devil.addEventListener("input", () => updatePose());
devil.addEventListener("focusout", (e) => { if (e.target instanceof HTMLInputElement) { stopTyping(); updatePose(); } });

function patch(p: Partial<Local>): void { local = setLocal(local, session.game().view().nodeId, p); render(); }

function say(events: GameEvent[]): void {
  // The devil's own words are in his overlay; the toast carries everything else (and a lone rejection).
  const shown = outcomeEvents(events).filter((e) => e.type !== "deal_offered" && e.type !== "devil_struck" && (e.type !== "rejected" || events.length === 1));
  const kindOf = kindLookup(session.game().view().map);
  const text = shown.map((e) => eventText(e, kindOf)).filter(Boolean).join(" ");
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
  if (c.cmd === "deal") pose.scorn = !!c.text && (isGibberish(c.text) || offTopicKind(c.text) !== null);
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
  for (const e of events) {
    log.unshift(e);
    if (e.type === "deal_offered") { pose.offerAt = performance.now(); if (pose.scorn) laughNow(); }
    if (e.type === "devil_struck" || e.type === "deal_applied") laughNow(); // a strike, or a deal struck: he laughs
    if (e.type === "deal_offered" || e.type === "devil_struck") pose.scorn = false;
  }
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
  try {
    report = await runForestFight(stage, input, {
      help: false, // the pause menu lists the controls
      onGame: (game) => { fightGame = game; if (ps.paused) setGamePaused(game, true); },
      onDebug: TEST ? (sim) => { fightSim = sim; } : undefined,
    });
  } catch (err) { say([{ type: "rejected", reason: `the fight could not start (${err instanceof Error ? err.message : String(err)})` }]); }
  fightGame = null; fightSim = null;
  local = { ...local, busy: null };
  mounted?.destroy(); mounted = null; // the next render puts the backdrop back (under the map, or the revival panel)
  if (session.game() !== g) { render(); return; }
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
  else map = mountMap(mapLayer, { onGo: go, map: v.map, view: v, busy: local.busy !== null, overlays: () => [hud.el.querySelector(".hud-stats"), mapTitle] });
}

// ---- the scene under it all --------------------------------------------------------------------------------------
function renderScene(v: View, f: Flow): void {
  // The village is laid out for the screen's shape when it mounts (worldLayout), then only scaled, so it is mounted
  // afresh when a phone turns (see the resize listener below); you start again on the village square.
  const key = f.screen === "village" ? `village:${v.nodeId}:${shape()}` : f.screen === "fight" ? `fight:${v.nodeId}` : `backdrop:${v.kind}:${v.nodeId}`;
  if (mounted?.key === key) return;
  if (f.screen === "fight" && local.busy === "fight") return; // the fight owns the stage
  mounted?.destroy(); world = null; zone = null;
  sceneLayer.replaceChildren();
  if (f.screen === "village") {
    const el = h("div", "play-layer");
    sceneLayer.append(el);
    world = mountScene(el, {
      scene: sceneById("village"),
      help: false, // the pause menu lists the controls
      onGame: (game) => { villageGame = game; if (ps.paused) setGamePaused(game, true); },
      onDebug: TEST ? (d) => { worldDebug = d; } : undefined,
      onEnterZone: (z) => {
        if (z.kind === "shop") { zone = z; render(); }
        if (z.kind === "exit") toggleMap(true);
      },
      onLeaveZone: (z) => { if (zone?.id === z.id) { zone = null; render(); } },
    });
    const w = world;
    mounted = { key, destroy: () => { w.destroy(); el.remove(); villageGame = null; worldDebug = null; } };
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
    const rest = button("Rest", () => void send({ cmd: "rest" }), "", restHint(v.state.hp, v.state.maxHp));
    const train = button("Sharpen Weapon", () => void send({ cmd: "train" }), "", "+1 attack, for the rest of the run");
    const deal = button("Deal", () => patch(OPEN_DEVIL), "", "Talk to the devil by the fire");
    rest.disabled = !can("rest"); train.disabled = !can("train"); deal.disabled = !can("deal");
    list.append(rest, train, deal);
  } else if (f.screen === "well") {
    title.append(icon("well"), "A well");
    const chose = wellChoice(log); // the blessing, or the devil's offer accepted or refused (then he has left)
    card.append(title, h("p", "lead", v.devilPresent && chose !== "devil" ? "Someone sits on the rim of the well, smiling." : "Cold water, and an old coin slot."));
    const p = shopPrompt({ id: "well", kind: "shop", item: "blessing", label: "Well", x: 0, y: 0, w: 1, h: 1 }, v);
    const locked = chose === "devil" && v.resolved ? capital(ONE_CHOICE.well.devil) : p.reason; // his offer accepted, not the blessing
    const buy = button(`Buy a blessing (${p.price}g)`, () => { if (p.command) void send(p.command); }, "", p.enabled ? p.desc : locked);
    buy.disabled = !p.enabled;
    list.append(buy);
    if (f.prompts.includes("deal")) list.append(button("Deal", () => patch(OPEN_DEVIL), "", "Talk to the devil at the well"));
    else if (v.devilPresent) { // one choice per well: say why the devil is closed
      const why = chose === "devil" ? "the devil has gone" : v.resolved ? ONE_CHOICE.well.spent : v.questionsLeft <= 0 ? "the devil has heard enough from you this run" : "the devil has gone";
      const deal = button("Deal", () => undefined, "", capital(why));
      deal.disabled = true;
      list.append(deal);
    }
    list.append(button("Move on", () => patch({ movedOn: true }), "quiet", "Choose the next stop on the map"));
  } else {
    title.append(icon("fight"), "Back on your feet");
    card.append(title, h("p", "lead", `The ${v.enemy?.name ?? "enemy"} is still there.`));
    list.append(button("Fight on", () => void fight()));
  }
  card.append(list);
  panel.replaceChildren(card);
  focus(list.querySelector<HTMLButtonElement>("button:not(:disabled)"));
}

/** The overlay goes away. If he is laughing (a deal struck, a strike), his portrait lingers and fades over what comes next. */
function closeDevil(): void {
  if (devil.hidden || leaving) return;
  const left = pose.laughUntil - performance.now();
  if (left > 0) {
    devil.classList.add("leaving");
    devil.setAttribute("aria-hidden", "true");
    devil.inert = true; // the card stays in place, hidden (play.css), so the portrait doesn't jump
    delete devil.dataset.key;
    leaving = window.setTimeout(() => { leaving = 0; closeDevil(); }, left);
    return;
  }
  devil.hidden = true;
  devil.classList.remove("leaving");
  devil.removeAttribute("aria-hidden");
  devil.inert = false;
  clearInterval(poseTimer); poseTimer = 0;
}

function openDevil(v: View): void {
  if (leaving) { clearTimeout(leaving); leaving = 0; devil.classList.remove("leaving"); devil.removeAttribute("aria-hidden"); devil.inert = false; }
  if (!devil.hidden && poseTimer) return;
  // Freshly up: idle counts from now. An offer that is already there (a well's opener) arrived just now as far as he cares.
  pose.since = performance.now();
  pose.engaged = false;
  if (pose.offerAt === null || !v.offer) pose.offerAt = v.offer ? performance.now() : null;
  devil.hidden = false;
  updatePose();
  if (!poseTimer) poseTimer = window.setInterval(updatePose, 200);
}

function renderDevil(v: View, f: Flow): void {
  if (!f.devil) { closeDevil(); return; }
  openDevil(v);
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement && devil.contains(active);
  if (typing && local.busy === null && devil.dataset.key === JSON.stringify([v.nodeId, v.asksLeft, v.questionsLeft, !!v.offer])) return;
  devil.dataset.key = JSON.stringify([v.nodeId, v.asksLeft, v.questionsLeft, !!v.offer]);
  stopTyping(); // the wish box is rebuilt below
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
    if (v.offer.rewrite) chips.append(h("span", "chip bad", `Rewrites the road: ${rewriteText(v.offer.rewrite, kindLookup(v.map))}`));
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
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = wishToSend(wish, v.opening);
      if (text === null) { input.focus(); return; } // an empty wish would cost a question for nothing
      wish = "";
      void send({ cmd: "deal", text });
    };
    form.append(input, ask);
    card.append(form);
  }
  const row = h("div", "row");
  if (v.offer && !busy) row.append(button("Accept", () => void send({ cmd: "accept" })), button("Refuse", () => void send({ cmd: "refuse" }), "quiet"));
  if (!v.offer && !busy) row.append(button("Walk away", () => patch(CLOSE_DEVIL), "quiet"));
  card.append(row);
  devil.replaceChildren(portrait.el, card);
  updatePose();
  // Focus the wish box with a keyboard; on a touch screen that would pop the on-screen keyboard over the offer.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches === true;
  focus(devil.querySelector<HTMLElement>(coarse ? "button:not(:disabled)" : "input:not(:disabled)") ?? devil.querySelector<HTMLElement>("button:not(:disabled)"));
}

let creditsBack: HTMLElement | null = null;
async function showCredits(): Promise<void> {
  creditsBack = document.activeElement as HTMLElement | null;
  const card = h("div", "play-card");
  const close = button("Close", hideCredits, "quiet");
  card.append(h("h2", "", "Credits"), h("p", "lead", "Loading..."), close);
  credits.replaceChildren(card);
  credits.hidden = false;
  close.focus();
  const entries = await loadCredits();
  if (credits.hidden) return;
  card.querySelector(".lead")?.replaceWith(creditsBody(entries));
}
function hideCredits(): void {
  credits.hidden = true;
  credits.replaceChildren();
  if (creditsBack?.isConnected) creditsBack.focus();
  creditsBack = null;
}
const creditsButton = (): HTMLButtonElement => button("Credits", () => void showCredits(), "quiet");

function renderEnding(f: Flow): void {
  ending.hidden = f.screen !== "ending";
  ending.className = `play-layer play-ending ${f.ending ?? ""}`;
  if (ending.hidden || ending.childElementCount) return;
  const [head, body] = END[f.ending ?? "lose"];
  const again = button("Play again", () => { ending.replaceChildren(); session.newGame(); });
  ending.append(h("div", "", undefined));
  const row = h("div", "play-ending-row");
  row.append(again, creditsButton());
  ending.firstElementChild!.append(h("h2", "", head), h("p", "", body), row);
  focus(again);
}

function render(): void {
  renderPause();
  if (ps.screen === "title") { renderTitle(); return; }
  titleLayer.hidden = true;
  const v = session.game().view();
  const f = flow(v, local);
  current = f;
  mapTitle.hidden = f.map !== "forced"; // before renderMap: the map keeps its top nodes clear of the title as well as the HUD
  renderScene(v, f);
  renderMap(v, f);
  hud.el.hidden = f.screen === "fight" && local.busy === "fight";
  root.classList.toggle("fighting", f.screen === "fight" && local.busy === "fight");
  hud.update(hudModel(v));
  mapBtn.hidden = !f.mapButton || f.map !== "closed" || f.devil;
  mapClose.hidden = f.map !== "open";
  mapTitle.hidden = f.map !== "forced";
  pauseBtn.hidden = f.screen === "ending" || f.devil;
  renderPrompt(v, f);
  renderPanel(v, f);
  renderDevil(v, f);
  if (f.screen !== "ending") ending.replaceChildren();
  renderEnding(f);
  if (ps.paused) return; // nothing starts behind the pause menu; resuming renders again
  // The devil appears: he opens with an offer of his own, unasked (free; see wantsOpener).
  if (wantsOpener(v, f, local)) queueMicrotask(() => void send({ cmd: "deal" }));
  // A fight node: start the fight on arrival (a revival asks first, with "Fight on").
  if (f.screen === "fight" && f.prompts.includes("fight") && autoFought !== v.nodeId && !local.busy) {
    autoFought = v.nodeId;
    queueMicrotask(() => void fight());
  }
}

// A phone turned in the village kept a thin portrait strip in the middle of a landscape screen (or the reverse).
function shape(): "wide" | "tall" { return innerWidth >= innerHeight ? "wide" : "tall"; }
let lastShape = shape();
window.addEventListener("resize", () => { if (shape() !== lastShape) { lastShape = shape(); render(); } });

// ---- pause, quit and the title screen (pause.ts) -------------------------------------------------------------------
/** Pause or resume a scene's Phaser game: no update or render, and its keyboard off (the fight captures Space and Shift
 *  on the window, which would keep Space from pressing the menu's buttons and replay it as an attack on resume). */
function setGamePaused(game: Phaser.Game, on: boolean): void {
  if (on) game.pause(); else game.resume();
  const kb = game.input?.keyboard;
  if (kb) kb.enabled = !on;
  if (!on) for (const sc of game.scene.getScenes(true)) sc.input?.keyboard?.resetKeys(); // keys released while paused
}

function doPause(a: PauseAction): void {
  const before = ps;
  const next = pauseStep(ps, a);
  if (next === ps) return;
  ps = next;
  if (!before.paused && ps.paused) { // opening
    returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (returnFocus === pauseBtn && pausedByPointer) returnFocus = null; // else Enter/E at a stall would press it, not buy
    for (const g of [villageGame, fightGame]) if (g) setGamePaused(g, true);
  }
  if (before.screen === "run" && ps.screen === "title") quitRun();
  if (before.paused && !ps.paused && ps.screen === "run") { // resumed
    for (const g of [villageGame, fightGame]) if (g) setGamePaused(g, false);
    const back = returnFocus;
    returnFocus = null;
    // Back where focus was. In a fight Space attacks, so it must not land on a button (the ⏸ one) to press it again.
    if (back && back.isConnected && !(local.busy === "fight" && back.tagName === "BUTTON")) back.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }
  if (before.screen === "title" && ps.screen === "run") { session.newGame(); return; } // a fresh run, a new seed; it renders
  render();
}

/** Quit: tear the run's scenes down (a fight in progress is destroyed with its game; its promise is left unresolved). */
function quitRun(): void {
  if (fightGame) { const g = fightGame; fightGame = null; fightSim = null; g.resume(); destroyGame(g); }
  mounted?.destroy(); mounted = null; world = null; zone = null;
  sceneLayer.replaceChildren();
  map?.destroy(); map = null;
  mapLayer.hidden = true;
  if (leaving) { clearTimeout(leaving); leaving = 0; }
  devil.hidden = true; devil.classList.remove("leaving"); devil.removeAttribute("aria-hidden"); devil.inert = false;
  clearInterval(poseTimer); poseTimer = 0;
  ending.replaceChildren();
  toast.hidden = true;
  local = { ...LOCAL };
  autoFought = null;
}

let pauseKeyState = "";
let pauseFromControls = false; // the sub-menu was just closed: focus goes back to the Controls button
function renderPause(): void {
  pauseLayer.hidden = !ps.paused;
  if (!ps.paused) { pauseKeyState = ""; pauseFromControls = false; return; }
  const key = JSON.stringify(ps);
  if (key === pauseKeyState) return;
  pauseKeyState = key;
  const card = h("div", "play-card");
  const title = h("h2", "", ps.confirmQuit ? "Quit this run?" : "Paused");
  title.id = "play-pause-title";
  card.append(title);
  const row = h("div", "row");
  if (ps.confirmQuit) {
    card.append(h("p", "lead", "Progress will be lost."));
    const no = button("Cancel", () => doPause("cancelQuit"), "quiet");
    const yes = button("Quit game", () => doPause("confirmQuit"));
    yes.setAttribute("aria-label", "Quit game, progress will be lost");
    row.append(no, yes);
    card.append(row);
    pauseLayer.replaceChildren(card);
    no.focus(); // the safe choice first
    return;
  }
  if (ps.controls) {
    // The Controls sub-menu: the keyboard and touch lists, and Back (Esc goes back too).
    title.textContent = "Controls";
    for (const [head, list] of [["Keyboard", CONTROLS.keyboard], ["Touch", CONTROLS.touch]] as const) {
      const sec = h("section", "controls");
      sec.setAttribute("aria-label", `${head} controls`);
      const dl = h("dl");
      for (const [k, what] of list) dl.append(h("dt", "", k), h("dd", "", what));
      sec.append(h("h3", "", head), dl);
      card.append(sec);
    }
    const back = button("Back", () => doPause("back"));
    back.setAttribute("aria-keyshortcuts", "Escape");
    row.append(back);
    card.append(row);
    pauseLayer.replaceChildren(card);
    back.focus();
    pauseFromControls = true;
    return;
  }
  const resume = button("Resume", () => doPause("resume"));
  resume.setAttribute("aria-keyshortcuts", "Escape P");
  const controls = button("Controls", () => doPause("controls"), "quiet");
  const quit = button("Quit game", () => doPause("quit"), "quiet");
  row.classList.add("menu");
  row.append(resume, controls, quit);
  card.append(row);
  pauseLayer.replaceChildren(card);
  // Back from the sub-menu: focus returns to its button; else to Resume.
  (pauseFromControls ? controls : resume).focus();
  pauseFromControls = false;
}
// Focus trap: Tab and Shift+Tab cycle through the menu's buttons.
pauseLayer.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const list = [...pauseLayer.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i === list.length - 1 ? 0 : i + 1);
  list[next].focus();
  e.preventDefault();
});
// The credits dialog keeps focus too (its only control is Close).
credits.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  credits.querySelector<HTMLElement>("button")?.focus();
  e.preventDefault();
});
// Focus that leaves the open menu by other means (a click on its backdrop) comes back to it.
pauseLayer.addEventListener("pointerdown", (e) => { if (e.target === pauseLayer) e.preventDefault(); });

function renderTitle(): void {
  for (const el of [mapBtn, mapClose, mapTitle, prompt, panel, devil, ending, pauseBtn, hud.el]) el.hidden = true;
  toast.hidden = true;
  titleLayer.hidden = false;
  if (titleLayer.childElementCount) return;
  const box = h("div", "");
  const head = h("h1", "");
  head.append("A ", h("b", "", "DEAL"), " with the ", h("b", "", "DEVIL"));
  const start = button("New game", () => { titleLayer.replaceChildren(); doPause("newGame"); });
  const row = h("div", "play-title-row");
  row.append(start, creditsButton());
  box.append(head, row);
  titleLayer.append(box);
  start.focus();
}

// ---- keys ----------------------------------------------------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const a = e.repeat ? null : pauseKey(ps, e.key, { map: current.map, typing: false, ending: current.screen === "ending", credits: !credits.hidden });
  if (a === "closeCredits") { hideCredits(); e.preventDefault(); return; }
  if (!credits.hidden) return; // the credits are on top: other keys wait
  if (a === "closeMap") { toggleMap(false); e.preventDefault(); return; }
  if (a) { doPause(a); e.preventDefault(); return; }
  if (ps.paused || ps.screen === "title") return;
  if ((e.key === "m" || e.key === "M") && current.mapButton && !e.repeat) { toggleMap(current.map === "closed"); e.preventDefault(); }
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
    pause: () => ps,
    /** Live positions: the village walker's feet, or the fight's player, enemies and clock. */
    probe: () => ({
      village: worldDebug ? { ...worldDebug.pos } : null,
      fight: fightSim ? { timeMs: fightSim.timeMs, player: { ...fightSim.player.pos }, enemies: fightSim.enemies.map((e) => ({ ...e.pos })) } : null,
    }),
    send: (c: Command) => send(c),
  };
}
