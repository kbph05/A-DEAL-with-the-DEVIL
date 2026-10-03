/**
 * Recording harness for the engine equivalence and JSON-contract fixtures. Uses only the public engine API that
 * existed before the stateless refactor (createGame, execute, botPolicy, StubDevil, Game.observe/map/state/ending),
 * so the same code records with the old engine and replays against the new one.
 *
 * Regenerate (only when a behaviour change is intended): `npx tsx src/game/__fixtures__/generate.ts`
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mulberry32, type Rng } from "../../map";
import { autoplay, botPolicy, execute, type Command, type Policy } from "../autoplay";
import { StubDevil, type Deal, type Devil } from "../devil";
import type { GameEvent, Result } from "../events";
import { HttpDevil } from "../httpDevil";
import { createGame, type Game } from "../run";

export const BOT_SEEDS = Array.from({ length: 500 }, (_, i) => `eq-${i}`);
export const CHAOS_SEEDS = Array.from({ length: 200 }, (_, i) => `chaos-${i}`);
export const SAMPLE_SEEDS = ["eq-0", "eq-1", "eq-2"];
/** Event types added by the stateless engine; filtered out when comparing against the pre-refactor recording. */
export const NEW_EVENT_TYPES: ReadonlySet<string> = new Set(["devil_stage_entered", "devil_stage_left"]);

export interface StepRecord { cmd: Command; ok: boolean; events: GameEvent[]; state: Result["state"] }
export interface RunRecord { seed: string; ending: string | null; steps: StepRecord[] }

const TEXTS = [undefined, "", "gold please", "I read the fine print", "my soul", "the road ahead", "heal me", "blood"];
/** Random commands (valid and invalid) mixed with the bot, from its own seeded stream: exercises rejections, haggles, shops, look. */
function chaosPolicy(rng: Rng): Policy {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const extra: Command[] = [
    { cmd: "look" }, { cmd: "go", n: 0 }, { cmd: "go", n: 1 }, { cmd: "go", n: 2 }, { cmd: "go", n: 3 }, { cmd: "go", n: 4 },
    { cmd: "fight" }, { cmd: "rest" }, { cmd: "buy", item: "heal" }, { cmd: "buy", item: "blade" }, { cmd: "buy", item: "blessing" },
    { cmd: "buy", item: "sword" }, { cmd: "buy" }, { cmd: "accept" }, { cmd: "refuse" }, { cmd: "accept" },
  ];
  return (o) => {
    if (rng() < 0.55) return botPolicy(o);
    if (o.kind === "deal" && rng() < 0.5) return { cmd: "deal", text: pick(TEXTS) };
    return pick(extra);
  };
}

const strip = (events: GameEvent[]): GameEvent[] => events.filter((e) => !NEW_EVENT_TYPES.has(e.type));

/** Play one run the way autoplay does, but keep every command, result and the final state. */
export async function recordRun(seed: string, mode: "bot" | "chaos", maxSteps = mode === "bot" ? 1000 : 400): Promise<RunRecord> {
  const g = createGame(seed, new StubDevil(seed));
  const policy = mode === "bot" ? botPolicy : chaosPolicy(mulberry32(seed.length * 7919 + Number(seed.split("-")[1] ?? 0)));
  const steps: StepRecord[] = [];
  while (!g.ending && steps.length < maxSteps) {
    const cmd = policy(g.observe());
    if (!cmd) break;
    const r = await execute(g, cmd);
    steps.push({ cmd, ok: r.ok, events: strip(r.events), state: r.state });
  }
  return { seed, ending: g.ending, steps };
}

export const hashRun = (r: RunRecord): string => createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 24);
/** One compact fixture row: [seed, ending, steps, events, hash of everything]. */
export type Row = [string, string | null, number, number, string];
export const rowOf = (r: RunRecord): Row => [r.seed, r.ending, r.steps.length, r.steps.reduce((n, s) => n + s.events.length, 0), hashRun(r)];

// ---- JSON contract: type shapes of every external JSON value ------------------------------------------------------

/** Keys whose values are free-form stat maps (`{gold: 5}`): their keys are data, so they are collapsed to `{}`. */
const DICTS = new Set(["effects", "effect", "changes"]);
const ABSENT = Symbol("absent");
const kindOf = (v: unknown): string =>
  v === ABSENT ? "absent" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

/** Path -> set of JSON types seen there, over many samples (missing keys count as "absent"). */
export function shapes(samples: unknown[], path: string, out: Record<string, string[]> = {}): Record<string, string[]> {
  const add = (p: string, t: string) => { const s = (out[p] ??= []); if (!s.includes(t)) { s.push(t); s.sort(); } };
  for (const v of samples) add(path, kindOf(v));
  const objs = samples.filter((v): v is Record<string, unknown> => kindOf(v) === "object");
  const arrs = samples.filter((v): v is unknown[] => Array.isArray(v));
  if (arrs.length) { const items = arrs.flat(); if (items.length) shapes(items, `${path}[]`, out); }
  if (objs.length) {
    const key = path.split(/[.[\]{}]+/).filter(Boolean).pop() ?? "";
    if (DICTS.has(key)) { const vals = objs.flatMap((o) => Object.values(o)); if (vals.length) shapes(vals, `${path}{}`, out); }
    else {
      const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))].sort();
      for (const k of keys) shapes(objs.map((o) => (Object.hasOwn(o, k) ? o[k] : ABSENT)), `${path}.${k}`, out);
    }
  }
  return out;
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A devil that goes through the real HttpDevil wire format, with fetch faked in-process (no network). */
function wireDevil(inner: Devil, requests: unknown[]): Devil {
  const http = new HttpDevil("http://contract.invalid/deal");
  return {
    async offer(state, context, text) {
      const real = globalThis.fetch;
      globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
        const req = JSON.parse(String(init?.body)) as { state: typeof state; context: typeof context; playerText: string | null };
        requests.push(req);
        const deal: Deal = await inner.offer(req.state, req.context, req.playerText ?? undefined);
        return new Response(JSON.stringify(deal ?? null), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      try { return await http.offer(state, context, text); } finally { globalThis.fetch = real; }
    },
  };
}

/** Hostile and odd devils so every event type (rewrite_failed, curses, revived, lost...) turns up in the samples. */
const ODD: Array<(seed: string) => Devil> = [
  () => ({ offer: async (_s, ctx) => ({ dialogue: "x", effects: { hp: -25 }, curse: { trigger: "on_hit", effect: { hp: -3 } }, rewrite: { nodeId: ctx.nodeId, to: "fight" } }) }),
  () => ({ offer: async (_s, ctx) => ({ dialogue: "y", effects: { gold: 5 }, rewrite: { nodeId: ctx.rewritable[0]?.id ?? "nope", to: "campfire" }, curse: { trigger: "next_node", effect: { gold: -2 } } }) }),
  () => ({ offer: async () => { throw new Error("down"); } }),
  () => ({ offer: async () => ({ dialogue: "z", effects: { soul: -1, gold: 50 }, curse: { trigger: "on_enter", effect: { hp: -2 } } }) }),
  () => ({ offer: async () => ({ dialogue: "w", effects: { max_hp: 5 }, curse: { trigger: "on_fight", effect: { attack: -1 } } }) }),
];

/** Collect the shapes of PlayerState, Observation, MapView, events, commands, Result and the devil request. */
export async function contractShapes(opts: { includeNew?: boolean } = {}): Promise<Record<string, string[]>> {
  const states: unknown[] = [], ctxs: unknown[] = [], obs: unknown[] = [], maps: unknown[] = [], results: unknown[] = [], requests: unknown[] = [];
  const events = new Map<string, unknown[]>(), cmds = new Map<string, unknown[]>();
  const push = <K>(m: Map<K, unknown[]>, k: K, v: unknown) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  const play = async (g: Game, policy: Policy, max = 400) => {
    for (let i = 0; i < max && !g.ending; i++) {
      obs.push(json(g.observe())); maps.push(json(g.map())); ctxs.push(json(g.context()));
      const c = policy(g.observe());
      if (!c) break;
      push(cmds, c.cmd, json(c));
      const r = json(await execute(g, c));
      results.push(r); states.push(r.state);
      for (const e of r.events) push(events, e.type, e);
    }
    obs.push(json(g.observe())); maps.push(json(g.map()));
    const l = json(g.look()); results.push(l); for (const e of l.events) push(events, e.type, e);
  };
  const wire = (d: Devil) => wireDevil(d, requests);
  for (let i = 0; i < 12; i++) await play(createGame(`contract-${i}`, wire(new StubDevil(`contract-${i}`))), chaosPolicy(mulberry32(i + 1)));
  for (let i = 0; i < 40; i++) await play(createGame(`odd-${i}`, wire(ODD[i % ODD.length](`odd-${i}`))), chaosPolicy(mulberry32(100 + i)));
  for (let i = 0; i < 20; i++) await play(createGame(`odd-bot-${i}`, wire(ODD[i % ODD.length](`odd-bot-${i}`))), botPolicy);
  const ap = json(await autoplay("contract-ap", botPolicy, 1000, new StubDevil("contract-ap")));
  for (const e of ap.events) push(events, e.type, e);
  const out: Record<string, string[]> = {};
  shapes(states, "PlayerState", out);
  shapes(obs, "Observation", out);
  shapes(maps, "MapView", out);
  shapes(results, "Result", out);
  shapes(requests, "DevilRequest", out);
  shapes(ctxs, "DevilContext", out);
  shapes([{ ...ap, events: [] }], "AutoplayResult", out);
  for (const [t, xs] of [...events].sort()) shapes(xs, `GameEvent:${t}`, out);
  for (const [c, xs] of [...cmds].sort()) shapes(xs, `Command:${c}`, out);
  Object.assign(out, replShapes(opts.includeNew ? ["--state"] : []));
  if (opts.includeNew) { // the devil driven by hand: awaiting, devil_reply
    const reply = '{"cmd":"devil_reply","deal":{"dialogue":"Sign.","effects":{"gold":5},"curse":{"trigger":"on_hit","effect":{"hp":-1}}}}';
    Object.assign(out, replShapes(["--state", "--manual-devil"], "repl-manual", ['{"cmd":"deal","text":"gold"}', '{"cmd":"go","n":1}', reply, '{"cmd":"deal"}', reply, '{"cmd":"accept"}']));
  }
  const keep = ([k]: [string, unknown]) => opts.includeNew || ![...NEW_EVENT_TYPES].some((t) => k.startsWith(`GameEvent:${t}`));
  return Object.fromEntries(Object.entries(out).filter(keep).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The REPL's `--json` output lines, driven through a real child process. */
export function replShapes(extraArgs: string[] = [], prefix = "repl", extraLines: string[] = []): Record<string, string[]> {
  const lines = [...extraLines,
    '{"cmd":"look"}', '{"cmd":"map"}', '{"cmd":"help"}', "not a command", '{"cmd":"go"}', '{"nope":1}',
    ...Array.from({ length: 6 }, () => ['{"cmd":"fight"}', '{"cmd":"rest"}', '{"cmd":"buy","item":"blessing"}', '{"cmd":"buy","item":"heal"}',
      '{"cmd":"deal","text":"gold"}', '{"cmd":"deal"}', '{"cmd":"accept"}', '{"cmd":"refuse"}', '{"cmd":"go","n":1}', "fight", "go 2", "buy blade", "deal soul", "accept"]).flat(),
    '{"cmd":"new","seed":"contract-b"}', "new contract-c", '{"cmd":"quit"}',
  ];
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/game/repl.ts", "--json", ...extraArgs, "contract-a"], { input: lines.join("\n") + "\n", encoding: "utf8", cwd: new URL("../../..", import.meta.url).pathname });
  if (r.status !== 0) throw new Error(`repl exited ${r.status}: ${r.stderr}`);
  const out = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  const group = (o: Record<string, unknown>) => ("error" in o ? "error" : "help" in o ? "help" : "events" in o ? "report" : "map");
  const shp: Record<string, string[]> = {};
  for (const g of ["report", "map", "error", "help"]) shapes(out.filter((o) => group(o) === g), `${prefix}:${g}`, shp);
  // events inside report lines are covered per type above; keep only the line-level and non-event structure here
  return Object.fromEntries(Object.entries(shp).filter(([k]) => !k.startsWith(`${prefix}:report.events[].`)));
}
