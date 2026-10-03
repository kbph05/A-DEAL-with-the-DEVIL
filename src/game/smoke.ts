/** Manual smoke run: `npx tsx src/game/smoke.ts [seed] [maxCommands]` prints a command transcript from the headless engine. */
import { describe } from "./events";
import { createGame } from "./run";

const g = createGame((globalThis as { process?: { argv: string[] } }).process?.argv[2] ?? "demo");
const say = (cmd: string, r: { events: Parameters<typeof describe>[0][] }) => {
  console.log(`> ${cmd}`);
  for (const e of r.events) console.log(describe(e).replace(/^/gm, "  "));
};
say("look()", g.look());
const MAX = Number((globalThis as { process?: { argv: string[] } }).process?.argv[3] ?? 40);
for (let i = 0; i < MAX && !g.ending; i++) {
  const o = g.observe();
  if (o.enemy) { say("fight()", g.fight()); continue; }
  if (o.kind === "campfire" && !o.resolved) { say("rest()", g.rest()); continue; }
  if (o.kind === "village" && o.state.gold >= 15 && !o.resolved) { say('buy("blade")', g.buy("blade")); continue; }
  if (o.kind === "well" && !o.resolved) { say('buy("blessing")', g.buy("blessing")); continue; }
  if (o.kind === "deal" && !o.resolved) {
    if (!o.offer) say('deal("I read the fine print")', await g.deal("I read the fine print"));
    else say("accept()", g.accept());
    continue;
  }
  say("go(1)", g.go(1));
}
