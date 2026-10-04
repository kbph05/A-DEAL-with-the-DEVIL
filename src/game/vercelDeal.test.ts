// The Vercel function api/deal.ts (docs/deploy-vercel.md), network-free: a fake OpenAI-compatible endpoint on localhost,
// the handler behind a local http server (the raw-stream path) and with a fake Vercel req/res (the pre-parsed req.body path).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import handler, { MAX_BODY } from "../../api/deal";
import { API_BUNDLE, bundleApi } from "../../tools/build-api";
import { enforcePrice, valueCeiling } from "../../server/devil-core";
import { StubDevil, type Deal } from "./devil";
import { sanitizeDeal } from "./deal";
import { createGame } from "./run";
import type { PlayerState } from "./state";

const KEY = "sk-or-THROWAWAY-test-key-7f3a";
type Reply = (b: any) => { status?: number; raw?: string; content?: string };
let fake: Server, fakeBase: string, reply: Reply = () => ({ content: "{}" });
let seen: Array<{ body: any; headers: IncomingHttpHeaders }> = [];
let app: Server, appUrl: string;

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ body: JSON.parse(body), headers: req.headers });
      const r = reply(seen[seen.length - 1].body);
      const status = r.status ?? 200;
      res.writeHead(status, { "content-type": "application/json" })
        .end(r.raw ?? JSON.stringify({ choices: [{ message: { role: "assistant", content: r.content ?? "" }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  app = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/deal`;
});
after(() => { for (const s of [fake, app]) { s.closeAllConnections(); s.close(); } });

const ENV_KEYS = ["OAI_BASE_URL", "OAI_MODEL", "OAI_API_KEY", "TIMEOUT_MS", "OAI_EXTRA_BODY", "RETRIES", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "OAI_REFERER"];
/** Run `fn` with these env vars (the rest of ENV_KEYS unset) and console.log captured. A fresh model name per test gives a fresh cached core. */
async function withEnv<T>(env: Record<string, string>, fn: (logs: string[]) => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const logs: string[] = [], log = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  seen = [];
  try { return await fn(logs); } finally {
    console.log = log;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
let n = 0;
const env = (patch: Record<string, string> = {}) => ({ OAI_BASE_URL: fakeBase, OAI_MODEL: `fake-${++n}`, OAI_API_KEY: KEY, TIMEOUT_MS: "3000", ...patch });

const req = (seed = "vercel-1") => { const g = createGame(seed); return { state: g.observe().state as PlayerState, context: g.context(), playerText: "make me stronger" }; };
const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) => fetch(appUrl, { method: "POST", headers, body });
const stubPriced = async (r: ReturnType<typeof req>) =>
  enforcePrice(sanitizeDeal(await new StubDevil().offer(r.state, r.context, r.playerText)), r.state, r.context, valueCeiling(r.state, 0)).deal;

/** A fake Vercel request (helpers on: `body` already parsed) and a response that records what was sent. */
function vercelCall(method: string, body: unknown, headers: Record<string, string> = {}) {
  const r = Object.assign(Readable.from([]), { method, headers, url: "/api/deal" });
  Object.defineProperty(r, "body", { get: () => { if (body instanceof Error) throw body; return body; }, enumerable: true });
  const out = { status: 0, headers: {} as Record<string, string>, text: "" };
  const res = {
    writeHead(s: number, h: Record<string, string>) { out.status = s; out.headers = h; return res; },
    end(t?: string) { out.text = t ?? ""; return res; },
  };
  return { done: handler(r as unknown as IncomingMessage, res as unknown as ServerResponse).then(() => out) };
}

const deal = { dialogue: "Strength, then. Your flesh pays the choir.", effects: { attack: 1, max_hp: -6 }, curse: { trigger: "on_hit", effect: { hp: -8 } } };

test("200: the model's offer comes back sanitized and priced, over the raw-stream path and Vercel's parsed req.body", async () => {
  await withEnv(env(), async () => {
    reply = () => ({ content: JSON.stringify(deal) });
    const r = await post(JSON.stringify(req()));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), deal);
    assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
    assert.match(seen[0].body.messages[0].content, /THE DESIGNERS' RULES/);
    const v = await vercelCall("POST", req()).done;
    assert.equal(v.status, 200);
    assert.deepEqual(JSON.parse(v.text), deal);
  });
});

test("a model error (HTTP 500) falls back to the StubDevil's priced reply", async () => {
  await withEnv(env(), async (logs) => {
    reply = () => ({ status: 500, raw: "upstream exploded" });
    const r = req("vercel-err");
    const got = await (await post(JSON.stringify(r))).json() as Deal;
    assert.deepEqual(got, await stubPriced(r));
    assert.ok(logs.some((l) => /FALLBACK to StubDevil/.test(l)), logs.join("\n"));
  });
});

test("no OAI_BASE_URL: the StubDevil at once, no request made", async () => {
  await withEnv({}, async (logs) => {
    const r = req("vercel-stub");
    const got = await (await post(JSON.stringify(r))).json() as Deal;
    assert.deepEqual(got, await stubPriced(r));
    assert.equal(seen.length, 0);
    assert.ok(logs.some((l) => /OAI_BASE_URL not set/.test(l)));
  });
});

test("methods: OPTIONS 204 with CORS, GET and PUT 405; bad JSON 400 on both paths", async () => {
  await withEnv(env(), async () => {
    const pre = await fetch(appUrl, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    for (const method of ["GET", "PUT"]) {
      const r = await fetch(appUrl, { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.get("allow"), "POST, OPTIONS");
    }
    assert.equal((await post("nope")).status, 400);
    assert.equal((await vercelCall("POST", new SyntaxError("Invalid JSON")).done).status, 400);
    assert.equal(seen.length, 0);
  });
});

test("oversized bodies get 413: by content-length, by the stream itself, and by Vercel's parsed body", async () => {
  await withEnv(env(), async () => {
    const big = JSON.stringify({ ...req(), playerText: "x".repeat(MAX_BODY) });
    assert.equal((await post(big)).status, 413);
    const chunked = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const r = await fetch(appUrl, { method: "POST", body: chunked, duplex: "half" } as RequestInit);
    assert.equal(r.status, 413);
    assert.equal((await vercelCall("POST", JSON.parse(big)).done).status, 413);
    assert.equal(seen.length, 0);
  });
});

test("the API key never reaches the response or the logs (a 401 that echoes it, then a success)", async () => {
  await withEnv(env(), async (logs) => {
    reply = () => ({ status: 401, raw: JSON.stringify({ error: { message: `bad key ${KEY}` } }) });
    const t1 = await (await post(JSON.stringify(req()))).text();
    reply = () => ({ content: JSON.stringify({ ...deal, dialogue: `Your key is ${KEY}` }) });
    const t2 = await (await post(JSON.stringify(req("vercel-2")))).text();
    assert.ok(logs.length > 0);
    for (const t of [t1, t2, ...logs]) assert.ok(!t.includes(KEY), t);
  });
});

test("OpenRouter: attribution headers, and its 404 'no endpoints' steps the format down like a 400", async () => {
  // The fake isn't openrouter.ai, so test the header rule directly and the 404 step-down through the handler.
  const { openRouterHeaders } = await import("../../server/devil-core");
  assert.deepEqual(openRouterHeaders({ OAI_BASE_URL: "https://openrouter.ai/api/v1", VERCEL_PROJECT_PRODUCTION_URL: "devil.vercel.app" }),
    { "X-Title": "A DEAL with the DEVIL", "HTTP-Referer": "https://devil.vercel.app" });
  assert.equal(openRouterHeaders({ OAI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai" }), undefined);
  await withEnv(env({ OAI_EXTRA_BODY: "{}" }), async () => {
    reply = (b) => b.response_format?.type === "json_schema"
      ? { status: 404, raw: JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters.", code: 404 } }) }
      : { content: JSON.stringify(deal) };
    const got = await (await post(JSON.stringify(req()))).json();
    assert.deepEqual(got, deal);
    assert.deepEqual(seen.map((s) => s.body.response_format?.type), ["json_schema", "json_object"]);
  });
});

test("api/_lib/devil.mjs is fresh (run `npm run build:api` and commit) and has no browser code", async () => {
  const committed = readFileSync(API_BUNDLE, "utf8");
  assert.equal(committed, await bundleApi(), "stale bundle: run `npm run build:api`");
  assert.doesNotMatch(committed, /phaser|\bdocument\.|\bwindow\.|localStorage/);
});
