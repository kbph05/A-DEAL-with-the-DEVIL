// World lab (world.html): a test-build page for the world scene on its own. Not part of the final build
// (vite.config.ts only adds world.html as an input in mode "test").
// Query: ?scene=<sample id, or the URL of a SceneDef JSON, e.g. a file in public/>&outlines=1&touch=0|1&speed=<px/s>&zoom=<n>
//        &seed=<run seed>&gold=<n> (lab only: start the run with n gold, to try every stall)
// It also runs a real engine game (createGame with the StubDevil) under the HUD: shop zones show a buy prompt
// (shopZone.ts), and every command updates the HUD. The map is not wired: exits only say so.
import { StubDevil, createGame, describe, restoreGame, type Command, type Game } from "../game";
import { mountHud } from "../hud/hud";
import { hudModel } from "../hud/model";
import { SCENES, mountScene, parseSceneDef, type SceneDef, type SceneHandle, type SceneZone, type WorldDebug } from "./index";
import { exitPrompt, shopPrompt, type ShopPrompt } from "./shopZone";

interface ZoneEvent { type: "enter" | "leave"; zone: string; kind: string; frame: number }

declare global {
  interface Window {
    __world?: {
      scene: SceneDef | null; debug: WorldDebug | null; events: ZoneEvent[]; mounts: number;
      /** The lab's engine run, the prompt on screen (null: hidden), and the last command's result text. */
      game?: Game; prompt?: ShopPrompt | null; result?: string;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = $<HTMLSelectElement>("scene");
const outlinesBox = $<HTMLInputElement>("outlines");
const stage = $<HTMLDivElement>("stage");
const where = $<HTMLSpanElement>("where");
const event = $<HTMLSpanElement>("event");
const err = $<HTMLDivElement>("err");

const q = new URLSearchParams(location.search);
const touch = q.get("touch") === "1" ? true : q.get("touch") === "0" ? false : undefined;
const num = (k: string) => (q.get(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
const speed = num("speed");
const zoom = num("zoom");
outlinesBox.checked = q.get("outlines") === "1";
const state: NonNullable<Window["__world"]> = { scene: null, debug: null, events: [], mounts: 0 };
window.__world = state;
let handle: SceneHandle | null = null;
const loaded = new Map<string, SceneDef>(SCENES.map((s) => [s.id, s]));

for (const s of SCENES) picker.add(new Option(`${s.id} (${s.size.w}×${s.size.h})`, s.id));

function setQuery(key: string, value: string | null): void {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, "", url);
}

function mount(def: SceneDef): void {
  handle?.destroy();
  hidePrompt();
  state.scene = def;
  state.debug = null;
  state.events = [];
  event.textContent = "";
  err.style.display = "none";
  const log = (type: ZoneEvent["type"]) => (z: { id: string; kind?: string; label?: string }) => {
    state.events.push({ type, zone: z.id, kind: z.kind ?? "trigger", frame: state.debug?.frames ?? 0 });
    if (state.events.length > 200) state.events.shift();
    event.textContent = `${type === "enter" ? "Entered" : "Left"} ${z.kind ?? "trigger"} "${z.label ?? z.id}"`;
  };
  handle = mountScene(stage, {
    scene: def, touch, speed, zoom, outlines: outlinesBox.checked,
    onDebug: (d) => { state.debug = d; },
    onEnterZone: (z) => { log("enter")(z); enterZone(z); },
    onLeaveZone: (z) => { log("leave")(z); leaveZone(z); },
  });
  state.mounts++;
}

function show(id: string): void {
  (document.activeElement as HTMLElement | null)?.blur(); // hand the keys back to the game
  const def = loaded.get(id);
  if (def) { setQuery("scene", id); mount(def); }
}

// ---------------------------------------------------------------------------------------------------------------
// The engine run, the HUD and the shop prompt

const seed = q.get("seed") ?? undefined;
let game: Game = createGame(seed, new StubDevil());
const startGold = num("gold");
if (startGold !== undefined) {
  const gs = game.gameState;
  game = restoreGame({ ...gs, player: { ...gs.player, gold: Math.max(0, Math.floor(startGold)) } }, new StubDevil());
}
state.game = game;
state.prompt = null;
state.result = "";

const hud = mountHud(stage, { onUseItem: (item) => { if (item.command) send(item.command); } });
const refreshHud = () => hud.update(hudModel(game.view()));
refreshHud();

const shop = $<HTMLDivElement>("shop");
const shopTitle = $<HTMLDivElement>("shop-title");
const shopDesc = $<HTMLDivElement>("shop-desc");
const shopWhy = $<HTMLDivElement>("shop-why");
const shopResult = $<HTMLDivElement>("shop-result");
const buyBtn = $<HTMLButtonElement>("shop-buy");
let here: SceneZone | null = null;

function renderPrompt(): void {
  if (!here) { hidePrompt(); return; }
  shop.hidden = false;
  if (here.kind === "exit") {
    state.prompt = null;
    shopTitle.textContent = exitPrompt(here);
    shopDesc.textContent = shopWhy.textContent = shopResult.textContent = "";
    buyBtn.hidden = true;
    return;
  }
  const p = shopPrompt(here, game.view());
  state.prompt = p;
  shopTitle.textContent = p.price === null ? p.title : `${p.title} · ${p.price}g`;
  shopDesc.textContent = p.desc;
  shopWhy.textContent = p.enabled ? "" : p.reason ?? "";
  shopResult.textContent = state.result ?? "";
  buyBtn.hidden = false;
  buyBtn.disabled = !p.enabled;
  buyBtn.title = p.enabled ? "Buy (E or Enter)" : p.reason ?? "";
}

function hidePrompt(): void {
  here = null;
  state.prompt = null;
  shop.hidden = true;
}

function enterZone(z: SceneZone): void {
  if (z.kind !== "shop" && z.kind !== "exit") return;
  here = z;
  state.result = "";
  renderPrompt();
}

function leaveZone(z: SceneZone): void {
  if (here?.id === z.id) hidePrompt();
}

/** Send one engine command, show its result text, and update the HUD and the prompt. */
function send(cmd: Command): void {
  const r = game.step(cmd);
  state.result = r.events.map(describe).filter(Boolean).join(" ");
  refreshHud();
  renderPrompt();
  if (shop.hidden && state.result) event.textContent = state.result;
}

function buy(): void {
  const p = state.prompt;
  if (p?.enabled && p.command) send(p.command);
}

buyBtn.addEventListener("click", () => { buy(); buyBtn.blur(); });
window.addEventListener("keydown", (e) => {
  if (e.repeat || shop.hidden || (e.key !== "e" && e.key !== "E" && e.key !== "Enter")) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== buyBtn && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON")) return;
  e.preventDefault();
  buy();
});

// Readout: foot y, current zone, facing.
let last = "";
const tick = () => {
  const d = state.debug;
  if (d) {
    const text = `feet (${Math.round(d.pos.x)}, ${Math.round(d.footY)}) · foot y ${Math.round(d.footY)} · zone ${d.zones.join(", ") || "none"} · facing ${d.facing}`;
    if (text !== last) where.textContent = last = text;
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

picker.addEventListener("change", () => show(picker.value));
outlinesBox.addEventListener("change", () => {
  handle?.setOutlines(outlinesBox.checked);
  setQuery("outlines", outlinesBox.checked ? "1" : null);
  outlinesBox.blur();
});

async function start(): Promise<void> {
  const want = q.get("scene") ?? SCENES[0].id;
  if (loaded.has(want)) { picker.value = want; mount(loaded.get(want)!); return; }
  try {
    const res = await fetch(want);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const def = parseSceneDef(await res.json());
    loaded.set(def.id, def);
    picker.add(new Option(`${def.id} (${want})`, def.id));
    picker.value = def.id;
    mount(def);
  } catch (e) {
    err.style.display = "grid";
    err.textContent = `Could not load the scene ${want}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
void start();
