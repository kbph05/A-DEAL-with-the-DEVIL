// Fight lab (fight.html): a test-build page for the realtime fight on its own. Not part of the final build
// (vite.config.ts only adds fight.html as an input in mode "test"). Query: ?act=1..3&boss=1&seed=abc&touch=0|1&auto=1
import { BOSSES, FOES } from "../game/gameState";
import { hashSeed } from "../map/rng";
import { runFight, type FightInput, type FightResult, type FightSim } from "./index";

declare global {
  interface Window { __fight?: { running: boolean; sim: FightSim | null; result: FightResult | null; input: FightInput | null } }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const act = $<HTMLSelectElement>("act");
const boss = $<HTMLInputElement>("boss");
const seed = $<HTMLInputElement>("seed");
const php = $<HTMLInputElement>("php");
const pmax = $<HTMLInputElement>("pmax");
const patk = $<HTMLInputElement>("patk");
const ehp = $<HTMLInputElement>("ehp");
const epow = $<HTMLInputElement>("epow");
const foe = $<HTMLSpanElement>("foe");
const go = $<HTMLButtonElement>("go");
const stage = $<HTMLDivElement>("stage");
const idle = $<HTMLDivElement>("idle");
const done = $<HTMLDivElement>("done");
const state: NonNullable<Window["__fight"]> = { running: false, sim: null, result: null, input: null };
window.__fight = state;

/**
 * Representative stats for act `a` (0-based), from the engine formulas (docs/FEATURES.md 5.2): regular enemy HP
 * 8 + 4a + d4 (we take the rounded-up middle, +2), power 2 + a; boss HP 18 + 8a, power 3 + a. The player starts at
 * 30/30, attack 3; we assume about +1 attack (a campfire Train or a blade) and +3 max HP per act cleared.
 */
function preset(): void {
  const a = Number(act.value);
  const isBoss = boss.checked;
  const max = 30 + 3 * a;
  php.value = String(max);
  pmax.value = String(max);
  patk.value = String(3 + a);
  ehp.value = String(isBoss ? 18 + 8 * a : 8 + 4 * a + 2);
  epow.value = String(isBoss ? 3 + a : 2 + a);
  foe.textContent = enemyName();
}

function enemyName(): string {
  const a = Number(act.value);
  return boss.checked ? BOSSES[a] : FOES[a][hashSeed(seed.value || "lab") % FOES[a].length];
}

function input(): FightInput {
  const n = (el: HTMLInputElement) => Number(el.value);
  const hp = n(ehp);
  return {
    player: { hp: n(php), maxHp: n(pmax), attack: n(patk) },
    enemy: { name: enemyName(), hp, maxHp: hp, power: n(epow), boss: boss.checked },
    seed: seed.value || Math.random().toString(36).slice(2, 8),
  };
}

const q = new URLSearchParams(location.search);
const touch = q.get("touch") === "1" ? true : q.get("touch") === "0" ? false : undefined;

async function start(): Promise<void> {
  if (state.running) return;
  const inp = input();
  state.running = true;
  state.result = null;
  state.input = inp;
  go.disabled = true;
  idle.style.display = "none";
  done.classList.remove("show");
  const result = await runFight(stage, inp, { touch, onDebug: (sim) => { state.sim = sim; } });
  state.running = false;
  state.result = result;
  go.disabled = false;
  $("verdict").textContent = `${result.won ? "Won" : "Lost"} against ${inp.enemy.name} (seed ${inp.seed})`;
  $("result").textContent = JSON.stringify(result, null, 2);
  done.classList.add("show");
}

// Wide screens show the stat inputs inline; phones fold them under "Stats".
($<HTMLDetailsElement>("stats")).open = matchMedia("(min-width: 701px)").matches;
act.value = String(Math.min(2, Math.max(0, Number(q.get("act") ?? 1) - 1)) || 0);
boss.checked = q.get("boss") === "1";
seed.value = q.get("seed") ?? "";
preset();
act.addEventListener("change", preset);
boss.addEventListener("change", preset);
seed.addEventListener("input", () => { foe.textContent = enemyName(); });
go.addEventListener("click", () => void start());
$("again").addEventListener("click", () => void start());
if (q.get("auto") === "1") void start();
