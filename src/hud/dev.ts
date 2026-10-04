// HUD lab (hud.html): a test-build page for the in-game HUD on its own, over a grey placeholder "scene". Not part of
// the final build (vite.config.ts only adds hud.html as an input in mode "test"). It runs a real engine game with the
// StubDevil; the buttons step it and the HUD updates live. Query: ?seed=abc&steps=N (N bot steps on load).
// The dashed circle is where the world scene's touch stick rests (worldLayout in src/world/logic.ts), for checking overlap.
import { botPolicy, createGame, describe, execute, type Command, type Game, type GameEvent, type Result, type View } from "../game";
import { worldLayout } from "../world/logic";
import { mountHud } from "./hud";
import { hudModel, type HudModel } from "./model";

declare global { interface Window { __hud?: { game: Game; model: HudModel; steps: number } } }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const seedBox = $<HTMLInputElement>("seed"), stage = $<HTMLDivElement>("stage"), scene = $<HTMLDivElement>("scene");
const stickEl = $<HTMLDivElement>("stick"), eventLine = $<HTMLDivElement>("event");
const btn = { step: $<HTMLButtonElement>("step"), fight: $<HTMLButtonElement>("fight"), buy: $<HTMLButtonElement>("buy"), deal: $<HTMLButtonElement>("deal") };

let game: Game = createGame();
let steps = 0;
let busy = false;

const hud = mountHud(scene, { onUseItem: (item) => { if (item.command) act(() => [execute(game, item.command!)]); } });

/** Lay the scene box out like the world scene's FIT-scaled canvas, and draw the stick's resting circle. */
function layout(): void {
  const W = stage.clientWidth, H = stage.clientHeight, L = worldLayout(W, H);
  const k = Math.min(W / L.width, H / L.height), w = L.width * k, h = L.height * k;
  Object.assign(scene.style, { left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, width: `${w}px`, height: `${h}px` });
  const r = L.stick.r * k;
  Object.assign(stickEl.style, { left: `${L.stick.x * k - r}px`, top: `${L.stick.y * k - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
}

function render(events: GameEvent[] = []): void {
  const v: View = game.view();
  const model = hudModel(v);
  hud.update(model);
  window.__hud = { game, model, steps };
  const over = v.ending !== null;
  btn.step.disabled = btn.fight.disabled = btn.deal.disabled = over || busy;
  btn.buy.disabled = over || busy;
  const offer = v.actions.some((c) => c.cmd === "accept");
  btn.deal.textContent = offer ? "Accept offer" : "Deal";
  if (events.length) eventLine.textContent = events.map(describe).filter(Boolean).slice(-3).join(" ");
}

/** Run some engine commands (each returns a Result or a promise of one), then redraw with their events. */
async function act(run: () => Array<Result | Promise<Result>>): Promise<void> {
  if (busy) return;
  busy = true;
  const events: GameEvent[] = [];
  try { for (const r of run()) events.push(...(await r).events); } finally { busy = false; }
  render(events);
}

/** One bot step (the default autoplay policy), preferring an exit to one of `toward` kinds when there is a choice. */
function botStep(toward: string[] = []): Promise<Result> | Result | null {
  const o = game.observe();
  let c = botPolicy(o);
  const exit = o.exits.find((x) => toward.includes(x.kind));
  if (c?.cmd === "go" && exit) c = { cmd: "go", n: exit.n };
  if (!c || game.ending) return null;
  steps++;
  return execute(game, c);
}

/** Bot-step until `want(view)` holds (or the run ends, or 200 steps), collecting the events. */
async function walkUntil(want: (v: View) => boolean, toward: string[]): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for (let i = 0; i < 200 && !game.ending && !want(game.view()); i++) {
    const r = botStep(toward);
    if (!r) break;
    events.push(...(await r).events);
  }
  return events;
}

const legal = (v: View, cmd: Command["cmd"]) => v.actions.find((c) => c.cmd === cmd);

btn.step.onclick = () => act(() => { const r = botStep(); return r ? [r] : []; });

// Take damage through the real fight path: walk to an enemy, start a realtime fight, report 5 HP lost and no damage dealt.
btn.fight.onclick = () => act(() => [(async () => {
  const events = await walkUntil((v) => v.enemy !== null, ["fight", "boss"]);
  if (!game.observe().enemy) return { ok: false, events, state: game.state };
  const req = game.fight(true);
  const e = game.observe().enemy!;
  const r = game.fightResult({ won: false, hpLeft: game.state.hp - 5, enemyHpLeft: e.hp, timeMs: 3000, hitsTaken: 1, damageDealt: 0 });
  return { ...r, events: [...events, ...req.events, ...r.events] };
})()]);

btn.buy.onclick = () => act(() => [(async () => {
  const events = await walkUntil((v) => legal(v, "buy") !== undefined, ["village", "well"]);
  const c = legal(game.view(), "buy");
  const r: Result = c ? await execute(game, c) : { ok: false, events: [], state: game.state };
  return { ...r, events: [...events, ...r.events] };
})()]);

btn.deal.onclick = () => act(() => [(async () => {
  if (legal(game.view(), "accept")) return game.accept();
  const events = await walkUntil((v) => legal(v, "deal") !== undefined, ["deal"]);
  const r = legal(game.view(), "deal") ? await game.deal("Give me strength, and name your price.") : { ok: false, events: [], state: game.state };
  return { ...r, events: [...events, ...r.events] };
})()]);

async function newRun(seed: string, n = 0): Promise<void> {
  game = createGame(seed.trim() || undefined);
  steps = 0;
  seedBox.value = game.seed;
  const url = new URL(location.href);
  url.searchParams.set("seed", game.seed);
  history.replaceState(null, "", url);
  hud.update(hudModel(game.view())); // baseline, so the first live announcement is a change
  for (let i = 0; i < n; i++) { const r = botStep(); if (!r) break; await r; }
  render();
}

$<HTMLButtonElement>("new").onclick = () => newRun(seedBox.value === game.seed ? "" : seedBox.value);
seedBox.onkeydown = (e) => { if (e.key === "Enter") newRun(seedBox.value); };
new ResizeObserver(layout).observe(stage);
layout();
const q = new URLSearchParams(location.search);
newRun(q.get("seed") ?? "", Math.max(0, Math.min(1000, Number(q.get("steps")) || 0)));
