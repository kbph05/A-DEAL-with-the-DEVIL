/**
 * Play the headless engine one command at a time in a terminal: `npm run play [-- seed] [--json]`.
 * --json: after every command, also print one line of JSON with the events, the full state and the map
 * (`{"cmd", "ok", "events", "state", "observation", "map"}`), e.g. to pipe into jq or diff two runs.
 * Commands: look | go N | fight | rest | buy ITEM | deal [text] | accept | refuse | map | new [seed] | help | quit
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";
import { describe, type Result } from "./events";
import { createGame } from "./run";

const HELP = "look | go N | fight | rest | buy heal|blade|blessing | deal [text] | accept | refuse | map | new [seed] | help | quit";
const JSON_MODE = argv.includes("--json");
let seed = argv.slice(2).find((a) => !a.startsWith("--")) ?? "demo";
let game = createGame(seed);

let lastCmd = "start";
const show = (r: Result) => {
  for (const e of r.events) console.log(describe(e).replace(/^/gm, "  "));
  if (JSON_MODE) console.log(JSON.stringify({ cmd: lastCmd, ok: r.ok, events: r.events, state: r.state, observation: game.observe(), map: game.map() }));
};

function showMap() {
  const m = game.map();
  for (const l of [...m.layers].reverse())
    console.log("  " + l.nodes.map((n) => `${n.current ? "[" : " "}${n.kind}${n.rewritten ? "*" : ""}${n.visited ? "·" : ""}${n.current ? "]" : " "}`).join("  "));
}

console.log(`A DEAL with the DEVIL (seed "${seed}"). ${HELP}`);
show(game.look());
const rl = createInterface({ input: stdin, output: stdout, prompt: "> " });
rl.prompt();
for await (const line of rl) {
  const [cmd = "", ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(" ");
  lastCmd = line.trim();
  switch (cmd.toLowerCase()) {
    case "": break;
    case "look": show(game.look()); break;
    case "go": show(game.go(Number(arg))); break;
    case "fight": show(game.fight()); break;
    case "rest": show(game.rest()); break;
    case "buy": show(game.buy(arg as Parameters<typeof game.buy>[0])); break;
    case "deal": show(await game.deal(arg || undefined)); break;
    case "accept": show(game.accept()); break;
    case "refuse": show(game.refuse()); break;
    case "map": showMap(); break;
    case "new": seed = arg || String(Date.now()); game = createGame(seed); console.log(`New run, seed "${seed}".`); show(game.look()); break;
    case "help": console.log(HELP); break;
    case "quit": case "exit": rl.close(); break;
    default: console.log(`  unknown command "${cmd}". ${HELP}`);
  }
  if (game.ending) console.log(`  -- ${game.ending.toUpperCase()} -- type "new" to play again`);
  rl.prompt();
}
