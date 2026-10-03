/**
 * Writes the engine fixtures: `npx tsx src/game/__fixtures__/generate.ts`.
 *   engine-runs.json   per-seed hash of every command, result and event (500 bot seeds + 200 chaos seeds), plus full
 *                      event logs of a few seeds so a mismatch is readable
 *   contract.json      path -> JSON types of every external JSON shape (see harness.ts contractShapes)
 * These were recorded with the pre-refactor class engine (commit cc6ba2d). Only regenerate on an intended change.
 */
import { writeFileSync } from "node:fs";
import { BOT_SEEDS, CHAOS_SEEDS, SAMPLE_SEEDS, contractShapes, recordRun, rowOf } from "./harness";

const dir = new URL(".", import.meta.url);
const bot = [], chaos = [], samples: Record<string, unknown> = {};
for (const s of BOT_SEEDS) {
  const r = await recordRun(s, "bot");
  bot.push(rowOf(r));
  if (SAMPLE_SEEDS.includes(s)) samples[s] = r.steps.flatMap((x) => x.events);
}
for (const s of CHAOS_SEEDS) chaos.push(rowOf(await recordRun(s, "chaos")));
const rows = (xs: unknown[]) => `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`;
writeFileSync(new URL("engine-runs.json", dir),
  `{\n  "bot": ${rows(bot)},\n  "chaos": ${rows(chaos)},\n  "samples": ${JSON.stringify(samples)}\n}\n`);
const c = await contractShapes();
writeFileSync(new URL("contract.json", dir), `{\n${Object.entries(c).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
console.log(`bot ${bot.length}, chaos ${chaos.length}, contract paths ${Object.keys(c).length}`);
