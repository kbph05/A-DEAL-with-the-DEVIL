// World lab (world.html): a test-build page for the world scene on its own. Not part of the final build
// (vite.config.ts only adds world.html as an input in mode "test"). Query: ?seed=abc&touch=0|1&map=<url of a map JSON>
// (our format or a Tiled export, e.g. a file in public/maps/).
import { loadMapJson, mountWorld, tileName, type WorldDebug, type WorldHandle, type WorldMap } from "./index";

declare global {
  interface Window { __world?: { seed: string; map: WorldMap | null; debug: WorldDebug | null; entered: { id: number; name: string; x: number; y: number }[]; mounts: number } }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const seedBox = $<HTMLInputElement>("seed");
const stage = $<HTMLDivElement>("stage");
const where = $<HTMLSpanElement>("where");
const event = $<HTMLSpanElement>("event");
const err = $<HTMLDivElement>("err");

const q = new URLSearchParams(location.search);
const touch = q.get("touch") === "1" ? true : q.get("touch") === "0" ? false : undefined;
const state: NonNullable<Window["__world"]> = { seed: "", map: null, debug: null, entered: [], mounts: 0 };
window.__world = state;
let handle: WorldHandle | null = null;

const randomSeed = () => Math.random().toString(36).slice(2, 8);

function mount(seed: string, map?: WorldMap): void {
  handle?.destroy();
  state.seed = seed;
  state.debug = null;
  state.entered = [];
  event.textContent = "";
  seedBox.value = seed;
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  history.replaceState(null, "", url);
  handle = mountWorld(stage, {
    seed, map, touch, showTile: true,
    onDebug: (d) => { state.debug = d; },
    onEnterTile: (id, x, y) => {
      const name = tileName(id);
      state.entered.push({ id, name, x, y });
      if (state.entered.length > 200) state.entered.shift();
      if (name === "door") event.textContent = `Entered a door at (${x}, ${y})`;
    },
  });
  state.map = handle.map;
  state.mounts++;
}

function regenerate(seed: string): void {
  (document.activeElement as HTMLElement | null)?.blur(); // hand the keys back to the game
  mount(seed.trim() || randomSeed());
}

// Tile readout under the player.
let last = "";
const tick = () => {
  const d = state.debug;
  if (d) {
    const text = `tile (${d.tile.x}, ${d.tile.y}) ${d.tile.name} · facing ${d.facing}`;
    if (text !== last) where.textContent = last = text;
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

$("regen").addEventListener("click", () => regenerate(seedBox.value));
$("random").addEventListener("click", () => regenerate(randomSeed()));
seedBox.addEventListener("keydown", (e) => { if (e.key === "Enter") regenerate(seedBox.value); });

async function start(): Promise<void> {
  const mapUrl = q.get("map");
  if (!mapUrl) { mount(q.get("seed") || randomSeed()); return; }
  try {
    const res = await fetch(mapUrl);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    mount(`map:${mapUrl}`, loadMapJson(await res.json()));
  } catch (e) {
    err.style.display = "grid";
    err.textContent = `Could not load the map ${mapUrl}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
void start();
