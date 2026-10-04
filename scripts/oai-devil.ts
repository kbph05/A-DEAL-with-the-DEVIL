/**
 * Devil backend on any OpenAI-compatible chat API (llama-swap / llama.cpp, Ollama, Gemini's OpenAI endpoint, OpenRouter...).
 * Contract: docs/devil-api.md. `npm run devil:oai` -> POST http://localhost:8788/deal, CORS open, listens on every interface.
 *
 * The server decides, the model writes:
 * - It classifies the player's text with the game's own heuristics (isGibberish, offTopicKind) and rolls the strike dice
 *   itself, with the StubDevil's constants and seed (`devil:<seed>:<askIndex>`), so a strike lands exactly when the stub's
 *   would. On a strike or a spite deal the model only writes the angry dialogue; the numbers are the server's.
 * - Otherwise the model writes an offer (dialogue + effects) under a JSON schema that has no `forced`; `forced` is deleted
 *   server-side anyway, gold gains are capped at what the stub would pay now (devilGold), and a rewrite must name a
 *   rewritable node.
 * - kbph, 4 Oct: "devil is too nice". Every offer is priced: `playerValue` scores it in gold (economy.ts prices); a deal
 *   worth more than nothing to the player (less, when the player is weak or haggling) is sent back to the model once
 *   ("too generous"), and if it is still generous the server adds a curse or stat cost and says so in the dialogue.
 * - Everything goes through sanitizeDeal. Model error, bad JSON or timeout: the StubDevil's reply to the same request
 *   (priced the same way), logged as a fallback. The game never waits more than TIMEOUT_MS here.
 *
 * Env: OAI_BASE_URL (http://169.254.1.3:11434/v1), OAI_MODEL (gemma4:26b), OAI_API_KEY (optional, sent as Bearer, never
 * logged), PORT (8788), SCHEMA_MODE (auto | json_schema | json_object | none; auto tries json_schema, then json_object,
 * then a prompt-only JSON instruction), TEMPERATURE (0.9), TIMEOUT_MS (12000), RETRIES (1), OAI_EXTRA_BODY (JSON merged
 * into each request; default {"chat_template_kwargs":{"enable_thinking":false}} for http:// servers, {} for https),
 * DEVIL_PROMPT (path; default devil_prompt.txt at the repo root).
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, createDevilCore, respond, type OaiDevilOptions, type SchemaMode } from "../server/devil-core";

// The devil itself lives in server/devil-core.ts (shared with the Vercel function, api/deal.ts); this file is the Node server.
export * from "../server/devil-core";

// ---- the server --------------------------------------------------------------------------------------------------------

export function createOaiDevil(o: OaiDevilOptions = {}) {
  const core = createDevilCore({ ...o, rulesText: o.rulesText ?? readFileSync(new URL("../devil_prompt.txt", import.meta.url), "utf8").trim() });
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return; }
    if (req.method !== "POST" || u.pathname !== "/deal") { res.writeHead(404, CORS).end("POST /deal only"); return; }
    let body = "";
    req.on("data", (ch) => { body += ch; if (body.length > 512_000) req.destroy(); });
    req.on("end", async () => {
      const { status, json } = await respond(core, body);
      res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(json));
    });
  });
  return { server, decide: core.decide, describe: core.describe };
}

export function startOaiDevil(port = 8788, o: OaiDevilOptions = {}): Promise<Server> {
  const d = createOaiDevil(o);
  return new Promise((resolve) => d.server.listen(port, () => { (o.log ?? console.log)(`oai devil on http://localhost:${port}/deal (all interfaces)  ${d.describe()}`); resolve(d.server); }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const num = (v: string | undefined, dflt: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : dflt);
  await startOaiDevil(num(env.PORT, 8788), {
    baseUrl: env.OAI_BASE_URL || DEFAULT_BASE_URL, model: env.OAI_MODEL || DEFAULT_MODEL, apiKey: env.OAI_API_KEY,
    schemaMode: (env.SCHEMA_MODE as SchemaMode) || "auto", temperature: num(env.TEMPERATURE, 0.9),
    timeoutMs: num(env.TIMEOUT_MS, 12000), retries: num(env.RETRIES, 1),
    extraBody: env.OAI_EXTRA_BODY ? JSON.parse(env.OAI_EXTRA_BODY) : undefined,
    rulesText: env.DEVIL_PROMPT ? readFileSync(env.DEVIL_PROMPT, "utf8").trim() : undefined,
  });
}
