// Map lab (map.html): a test-build page for the map scene, with the HUD over it, on a real engine run (StubDevil). Not part
// of the final build (vite.config.ts only adds map.html as an input in mode "test"). Tap a pulsing node to `go`; the bar
// under the map has the node's other legal actions (fights here are the plain turn-based `fight`, one round per press;
// the devil is asked without a wish, as the bot does, so `?steps=N` replays `autoplay` exactly).
// Query: ?seed=abc&steps=N (N bot steps on load). Playwright reads window.__map.
import { botPolicy, createGame, describe, execute, type Command, type Game, type GameEvent, type Result, type View } from "../game";
import { mountHud } from "../hud/hud";
import { hudModel } from "../hud/model";
import { mountMap, type MapHandle } from "./index";

declare global { interface Window { __map?: { game: Game; view: View; map: MapHandle; steps: number; busy: boolean; log: string[]; bot: () => Command | null } } }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const seedBox = $<HTMLInputElement>("seed"), stage = $<HTMLDivElement>("stage"), acts = $<HTMLDivElement>("acts"), eventLine = $<HTMLDivElement>("event");

let game: Game = createGame(new URLSearchParams(location.search).get("seed") || undefined);
let steps = 0, busy = false;
const log: string[] = [];

const map = mountMap(stage, { onGo: (n) => void act({ cmd: "go", n }), map: game.map(), view: game.view() });
const hud = mountHud(stage, { onUseItem: (item) => { if (item.command) void act(item.command); } });

const ware = (item?: string) => (item === "heal" ? "Heal" : item === "blade" ? "Blade" : item === "blessing" ? "Blessing" : item ?? "?");
/** Button text for a legal command (every one but `go` and the realtime fight, which this lab does not play). */
function label(c: Command, v: View): string | null {
  switch (c.cmd) {
    case "fight": return c.realtime ? null : `Fight the ${v.enemy?.name ?? "enemy"}`;
    case "rest": return "Rest";
    case "train": return "Train (+1 attack)";
    case "buy": return `Buy ${ware(c.item)}`;
    case "deal": return v.offer ? "Haggle" : "Ask the devil";
    case "accept": return "Accept the offer";
    case "refuse": return "Refuse the offer";
    case "devil_reply": return "Devil: stay silent";
    case "fight_result": return "End the fight";
    default: return null;
  }
}

function render(events: GameEvent[] = []): void {
  const v = game.view();
  map.update(v.map, v, busy);
  hud.update(hudModel(v));
  const buttons = v.actions.flatMap((c) => {
    const text = label(c, v);
    if (!text) return [];
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.dataset.cmd = JSON.stringify(c);
    b.disabled = busy;
    b.onclick = () => void act(c);
    return [b];
  });
  if (!buttons.length) {
    const s = document.createElement("span");
    s.className = "none";
    s.textContent = v.ending ? `The run is over: ${v.ending}.` : "Nothing to do here: pick the next node on the map.";
    buttons.push(s as unknown as HTMLButtonElement);
  }
  acts.replaceChildren(...buttons);
  const lines = events.map(describe).filter(Boolean);
  log.push(...lines);
  if (lines.length) eventLine.textContent = lines.slice(-2).join(" ");
  window.__map = { game, view: v, map, steps, busy, log, bot: () => botPolicy(game.observe()) };
}

async function act(c: Command): Promise<void> {
  if (busy) return;
  busy = true;
  steps++;
  let r: Result | null = null;
  try {
    if (c.cmd === "deal") render(); // show the map locked while the devil thinks
    r = await execute(game, c);
  } finally { busy = false; }
  render(r?.events ?? []);
}

function newRun(seed: string): void {
  game = createGame(seed.trim() || undefined);
  steps = 0;
  log.length = 0;
  seedBox.value = game.seed;
  const url = new URL(location.href);
  url.searchParams.set("seed", game.seed);
  history.replaceState(null, "", url);
  hud.update(hudModel(game.view())); // baseline, so the first live announcement is a change
  render();
}

$<HTMLButtonElement>("new").onclick = () => newRun(seedBox.value === game.seed ? "" : seedBox.value);
seedBox.onkeydown = (e) => { if (e.key === "Enter") newRun(seedBox.value); };
$<HTMLButtonElement>("bot").onclick = () => { const c = botPolicy(game.observe()); if (c) void act(c); };

(async () => {
  newRun(game.seed);
  const n = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get("steps")) || 0));
  for (let i = 0; i < n && !game.ending; i++) { const c = botPolicy(game.observe()); if (!c) break; await act(c); }
})();
