/**
 * Vercel serverless function: POST /api/deal -> a Deal (docs/devil-api.md), the LLM devil of `npm run devil:oai` on the
 * game's own origin. Env (Vercel project settings): OAI_BASE_URL, OAI_MODEL, OAI_API_KEY (never logged), TIMEOUT_MS
 * (default 10000). Any model error -> the StubDevil's reply; no OAI_BASE_URL -> the StubDevil at once. maxDuration is in
 * vercel.json. The devil is the bundle ./_lib/devil.mjs (`npm run build:api`; see tools/build-api.ts for why).
 * docs/deploy-vercel.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleDeal } from "./_lib/devil.mjs";

/** Largest request body accepted, in bytes (the game sends a few KB; the Node server allows the same). */
export const MAX_BODY = 512_000;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };

/** Vercel's request: a Node IncomingMessage, plus a lazily parsed `body` when its helpers are on (the default). */
type VercelReq = IncomingMessage & { body?: unknown };
type Body = { body: unknown } | { status: number; error: string };

/** The body, whichever way it arrives: Vercel's pre-read `req.body` (object, string or Buffer), or the raw stream. */
async function readBody(req: VercelReq): Promise<Body> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY) return { status: 413, error: `body over ${MAX_BODY} bytes` };
  if ("body" in req) {
    let b: unknown;
    try { b = req.body; } catch { return { status: 400, error: "body is not valid JSON" }; } // Vercel's getter throws on bad JSON
    if (b !== undefined) {
      const text = Buffer.isBuffer(b) ? b.toString("utf8") : typeof b === "string" ? b : null;
      const size = text !== null ? Buffer.byteLength(text) : Buffer.byteLength(JSON.stringify(b) ?? "");
      if (size > MAX_BODY) return { status: 413, error: `body over ${MAX_BODY} bytes` };
      return { body: text ?? b };
    }
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) { done = true; resolve({ status: 413, error: `body over ${MAX_BODY} bytes` }); req.resume(); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve({ body: Buffer.concat(chunks).toString("utf8") }); } });
    req.on("error", () => { if (!done) { done = true; resolve({ status: 400, error: "could not read body" }); } });
  });
}

export default async function handler(req: VercelReq, res: ServerResponse): Promise<void> {
  const send = (status: number, payload: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...CORS, ...extra, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(payload));
  };
  if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return; }
  if (req.method !== "POST") { send(405, { error: "POST only" }, { allow: "POST, OPTIONS" }); return; }
  const got = await readBody(req);
  if ("error" in got) { send(got.status, { error: got.error }); return; }
  const { status, json } = await handleDeal(got.body, process.env);
  send(status, json);
}
