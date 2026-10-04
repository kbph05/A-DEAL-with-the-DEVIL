// Fight lab (fight.html): a test-build page for the realtime fight on its own. Not part of the final build
// (vite.config.ts only adds fight.html as an input in mode "test").
// Query: ?act=1..3&boss=1&seed=abc&touch=0|1&auto=1, and for forest mode &mode=forest&layer=0..6&enemy=<roster id>
import { BOSSES, FOES } from "../game/gameState";
import { hashSeed } from "../map/rng";
import {
  ENEMIES, ENEMY_IDS, encounterFor, runFight, runForestFight,
  type Encounter, type EnemyId, type FightInput, type FightResult, type FightSim, type ForestRequest, type ForestView,
} from "./index";

declare global {
  interface Window {
    __fight?: {
      running: boolean; sim: FightSim | null; result: FightResult | null; input: FightInput | null;
      /** Forest mode: the encounter being fought, and the scene's live view (zoom, camera, depths). */
      mode?: "arena" | "forest"; encounter?: Encounter | null; view?: ForestView | null;
    };
  }
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
const mode = $<HTMLSelectElement>("mode");
const layer = $<HTMLInputElement>("layer");
const layerv = $<HTMLSpanElement>("layerv");
const force = $<HTMLSelectElement>("force");
const enc = $<HTMLDivElement>("enc");
const go = $<HTMLButtonElement>("go");
const stage = $<HTMLDivElement>("stage");
const idle = $<HTMLDivElement>("idle");
const done = $<HTMLDivElement>("done");
const state: NonNullable<Window["__fight"]> = { running: false, sim: null, result: null, input: null, mode: "arena", encounter: null, view: null };
window.__fight = state;

/** The lab's act map: 7 layers per act (the generator makes 6 to 8), 3 acts. */
const LAYERS = 7;
const ACTS = 3;

for (const id of ENEMY_IDS) force.add(new Option(ENEMIES[id].label, id));

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
  readout();
}

function enemyName(): string {
  const a = Number(act.value);
  return boss.checked ? BOSSES[a] : FOES[a][hashSeed(seed.value || "lab") % FOES[a].length];
}

function input(fixedSeed?: string): ForestRequest {
  const n = (el: HTMLInputElement) => Number(el.value);
  const hp = n(ehp);
  const req: ForestRequest = {
    player: { hp: n(php), maxHp: n(pmax), attack: n(patk) },
    enemy: { name: enemyName(), hp, maxHp: hp, power: n(epow), boss: boss.checked },
    seed: fixedSeed ?? (seed.value || Math.random().toString(36).slice(2, 8)),
  };
  if (mode.value === "forest") req.where = { act: Number(act.value), acts: ACTS, layer: Number(layer.value), layers: LAYERS, kind: boss.checked ? "boss" : "fight" };
  return req;
}

const forced = (): EnemyId | undefined => (force.value ? force.value as EnemyId : undefined);

/** One line per enemy: HP, power and the scaled stats (Big Chungus: speed, cooldown, stuns move with progress). */
function describeEncounter(e: Encounter): string {
  const x = (v: number) => `×${v.toFixed(2)}`;
  const head = `<b>Progress ${e.progress.toFixed(2)}</b> (act ${e.act}/${e.acts}, layer ${layer.value}/${LAYERS}) · ${e.boss ? "boss" : `band ${e.band + 1}`} · ${e.enemies.length} foe${e.enemies.length === 1 ? "" : "s"}, ${e.totalHp} HP total`
    + ` · curve: speed ${x(e.scale.speed)}, attack cooldown ${x(e.scale.attackCd)}, hitstun dealt ${x(e.scale.hitstun)}, stun taken ${x(e.scale.stunTaken)}`;
  const rows = e.enemies.map((m) => `${m.name}: ${m.hp} HP, power ${m.power} · speed ${m.params.speed} · attack cooldown ${m.params.attackCdMs} ms · hitstun ${m.params.hitstunMs} ms · stunned ${m.params.stunTakenMs} ms when hit`);
  return [head, ...rows].join("<br>");
}

/** Forest mode: show the encounter this setup gives (with the typed seed, or a sample one when it's random). */
function readout(): void {
  const forest = mode.value === "forest";
  document.body.classList.toggle("forest-mode", forest);
  const p = (Number(act.value) + Number(layer.value) / LAYERS) / ACTS;
  layerv.textContent = `${layer.value} · p ${p.toFixed(2)}`;
  if (!forest || state.running) return;
  const e = encounterFor(input(seed.value || "sample"), { force: forced() });
  enc.innerHTML = describeEncounter(e) + (seed.value ? "" : "<br><i>(random seed: the mix varies per fight; the stats don't)</i>");
}

const q = new URLSearchParams(location.search);
const touch = q.get("touch") === "1" ? true : q.get("touch") === "0" ? false : undefined;

async function start(): Promise<void> {
  if (state.running) return;
  const inp = input();
  const forest = mode.value === "forest";
  state.running = true;
  state.result = null;
  state.input = inp;
  state.mode = forest ? "forest" : "arena";
  state.encounter = null;
  state.view = null;
  go.disabled = true;
  idle.style.display = "none";
  done.classList.remove("show");
  (document.activeElement as HTMLElement | null)?.blur(); // Space must not press a button
  document.body.classList.add("fighting");
  const result = forest
    ? await runForestFight(stage, inp, {
      touch, force: forced(),
      onEncounter: (e) => { state.encounter = e; enc.innerHTML = describeEncounter(e); },
      onDebug: (sim, view) => { state.sim = sim; state.view = view; },
    })
    : await runFight(stage, inp, { touch, onDebug: (sim) => { state.sim = sim; } });
  state.running = false;
  state.result = result;
  document.body.classList.remove("fighting");
  go.disabled = false;
  const met = state.encounter as Encounter | null; // set by onEncounter while the fight ran
  const against = forest && met ? met.enemies.map((e) => e.name).join(", ") : inp.enemy.name;
  $("verdict").textContent = `${result.won ? "Won" : "Lost"} against ${against} (seed ${inp.seed})`;
  $("done-enc").innerHTML = forest && met ? describeEncounter(met) : "";
  $("result").textContent = JSON.stringify(result, null, 2);
  done.classList.add("show");
}

// Wide screens show the stat inputs inline; phones fold them under "Stats".
($<HTMLDetailsElement>("stats")).open = matchMedia("(min-width: 701px)").matches;
act.value = String(Math.min(2, Math.max(0, Number(q.get("act") ?? 1) - 1)) || 0);
boss.checked = q.get("boss") === "1";
seed.value = q.get("seed") ?? "";
mode.value = q.get("mode") === "forest" ? "forest" : "arena";
layer.value = String(Math.min(LAYERS - 1, Math.max(0, Math.round(Number(q.get("layer") ?? 0)) || 0)));
const qEnemy = q.get("enemy");
if (qEnemy && (ENEMY_IDS as readonly string[]).includes(qEnemy)) force.value = qEnemy;
preset();
act.addEventListener("change", preset);
boss.addEventListener("change", preset);
for (const el of [mode, layer, force, ehp, epow]) el.addEventListener("input", readout);
mode.addEventListener("change", readout);
seed.addEventListener("input", () => { foe.textContent = enemyName(); readout(); });
go.addEventListener("click", () => void start());
$("again").addEventListener("click", () => void start());
if (q.get("auto") === "1") void start();
