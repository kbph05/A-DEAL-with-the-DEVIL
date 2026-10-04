// World lab (world.html): a test-build page for the world scene on its own. Not part of the final build
// (vite.config.ts only adds world.html as an input in mode "test").
// Query: ?scene=<sample id, or the URL of a SceneDef JSON, e.g. a file in public/>&outlines=1&touch=0|1&speed=<px/s>&zoom=<n>
import { SCENES, mountScene, parseSceneDef, type SceneDef, type SceneHandle, type WorldDebug } from "./index";

interface ZoneEvent { type: "enter" | "leave"; zone: string; kind: string; frame: number }

declare global {
  interface Window { __world?: { scene: SceneDef | null; debug: WorldDebug | null; events: ZoneEvent[]; mounts: number } }
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
    onEnterZone: log("enter"),
    onLeaveZone: log("leave"),
  });
  state.mounts++;
}

function show(id: string): void {
  (document.activeElement as HTMLElement | null)?.blur(); // hand the keys back to the game
  const def = loaded.get(id);
  if (def) { setQuery("scene", id); mount(def); }
}

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
