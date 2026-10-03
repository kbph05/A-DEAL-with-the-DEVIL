/**
 * Play the headless engine one command at a time in a terminal: `npm run play [-- seed] [--json] [--state] [--manual-devil]`.
 *
 * Text mode: look | go N | fight | rest | buy ITEM | deal [text] | accept | refuse | reply {deal json} | map | new [seed] | help | quit
 *
 * --json: JSON in, JSON out, one object per line (for scripts, jq, or an LLM driving the game).
 *   in:  {"cmd":"go","n":1} | {"cmd":"fight"} | {"cmd":"buy","item":"blade"} | {"cmd":"deal","text":"..."}
 *        | {"cmd":"accept"} | {"cmd":"refuse"} | {"cmd":"rest"} | {"cmd":"look"} | {"cmd":"map"}
 *        | {"cmd":"devil_reply","deal":{...}}  (answers a pending devil request; see --manual-devil)
 *        | {"cmd":"new","seed":"abc"}            (the same Command shape autoplay uses, plus map/new)
 *   out: {"cmd", "ok", "text":[...], "events", "state", "observation", "map", "ending", "actions", "awaiting"?, "game_state"?}
 *        or {"ok":false,"error":"..."} for unparseable input. Text commands still work and answer in JSON.
 *        `actions` lists the legal next commands; `awaiting` is present while the devil's answer is pending.
 * --state: every report line also carries the full GameState as `game_state` (save it, diff it, replay from it).
 * --manual-devil: `deal` does not call the StubDevil; the line carries `awaiting: {devil: request}` (the HTTP devil
 *   request body, docs/devil-api.md) and the next input must be `devil_reply` with your Deal: drive the devil by hand.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";
import { execute, type Command } from "./autoplay";
import { legalActions } from "./actions";
import { describe, isSyncMarker, type Result } from "./events";
import { createGame } from "./run";

const HELP = "look | go N | fight | rest | buy heal|blade|blessing | deal [text] | accept | refuse | reply {deal} | map | new [seed] | help | quit";
const JSON_MODE = argv.includes("--json");
const WITH_STATE = argv.includes("--state");
const MANUAL_DEVIL = argv.includes("--manual-devil");
let seed = argv.slice(2).find((a) => !a.startsWith("--")) ?? "demo";
let game = createGame(seed);

type Input = Command | { cmd: "map" } | { cmd: "new"; seed?: string } | { cmd: "help" } | { cmd: "quit" };
const GAME_CMDS = new Set(["look", "go", "fight", "rest", "buy", "deal", "accept", "refuse", "devil_reply"]);

/** Text or JSON line -> Input. Throws with a readable message on bad input. */
function parse(line: string): Input {
  if (line.startsWith("{")) {
    const o = JSON.parse(line) as Record<string, unknown>;
    if (typeof o.cmd !== "string") throw new Error('missing "cmd"');
    if (o.cmd === "go" && typeof o.n !== "number") throw new Error('"go" needs a numeric "n"');
    if (!GAME_CMDS.has(o.cmd) && !["map", "new", "help", "quit"].includes(o.cmd)) throw new Error(`unknown cmd "${o.cmd}"`);
    return o as Input;
  }
  const [cmd = "", ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase()) {
    case "go": return { cmd: "go", n: Number(arg) };
    case "buy": return { cmd: "buy", item: arg || undefined };
    case "deal": return { cmd: "deal", text: arg || undefined };
    case "new": return { cmd: "new", seed: arg || undefined };
    case "reply": return { cmd: "devil_reply", deal: arg ? JSON.parse(arg) : undefined };
    case "exit": return { cmd: "quit" };
    case "look": case "fight": case "rest": case "accept": case "refuse": case "map": case "help": case "quit":
      return { cmd: cmd.toLowerCase() } as Input;
    default: throw new Error(`unknown command "${cmd}". ${HELP}`);
  }
}

function report(cmd: Input | string, r: Result) {
  if (JSON_MODE) {
    const gs = game.gameState;
    console.log(JSON.stringify({ cmd, ok: r.ok, text: r.events.map(describe), events: r.events, state: r.state,
      observation: game.observe(), map: game.map(), ending: game.ending, actions: legalActions(gs),
      ...(gs.pending ? { awaiting: { devil: gs.pending } } : {}), ...(WITH_STATE ? { game_state: gs } : {}) }));
  } else {
    for (const e of r.events) if (!isSyncMarker(e)) console.log(describe(e).replace(/^/gm, "  "));
    if (game.gameState.pending) console.log(`  (the devil awaits your answer for him: reply {"dialogue":"...","effects":{...}})\n  request: ${JSON.stringify(game.gameState.pending)}`);
    if (game.ending) console.log(`  -- ${game.ending.toUpperCase()} -- type "new" to play again`);
  }
}

function showMap() {
  const m = game.map();
  if (JSON_MODE) return console.log(JSON.stringify({ cmd: "map", ok: true, map: m, ...(WITH_STATE ? { game_state: game.gameState } : {}) }));
  for (const l of [...m.layers].reverse())
    console.log("  " + l.nodes.map((n) => `${n.current ? "[" : " "}${n.kind}${n.rewritten ? "*" : ""}${n.visited ? "·" : ""}${n.current ? "]" : " "}`).join("  "));
}

/** One game command. With --manual-devil, `deal` only asks: the devil's answer comes in as a later `devil_reply`. */
async function run(c: Command): Promise<Result> {
  if (!(MANUAL_DEVIL && c.cmd === "deal")) return execute(game, c);
  const r = game.step(c);
  return { ok: r.ok, events: r.events, state: { ...game.state, log: [...game.state.log] } };
}

if (!JSON_MODE) console.log(`A DEAL with the DEVIL (seed "${seed}"). ${HELP}`);
report({ cmd: "look" }, game.look());
const rl = createInterface({ input: stdin, output: stdout, prompt: JSON_MODE ? "" : "> " });
rl.prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (line) {
    let input: Input | null = null;
    try { input = parse(line); } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(JSON_MODE ? JSON.stringify({ ok: false, error }) : `  ${error}`);
    }
    if (input?.cmd === "quit") { rl.close(); exit(0); }
    else if (input?.cmd === "help") console.log(JSON_MODE ? JSON.stringify({ ok: true, help: HELP }) : HELP);
    else if (input?.cmd === "map") showMap();
    else if (input?.cmd === "new") {
      seed = input.seed || String(Date.now());
      game = createGame(seed);
      report(input, game.look());
    } else if (input) report(input, await run(input));
  }
  rl.prompt();
}
