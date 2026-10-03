/**
 * Mock devil backend for local testing without Gemini: `npm run mock:devil` -> POST http://localhost:8787/deal
 * Contract: docs/devil-api.md. Replies come from StubDevil (deterministic per context.seed).
 *   ?chaos=1   every other request is junk on purpose (cycles: bare string, HTTP 500, malformed JSON, out-of-range deal, null, empty body)
 *   ?delay=ms  wait before answering (to see the "devil considers..." state or trigger the client timeout)
 * No dependencies. Not type-checked by `npm run build` (outside tsconfig include; no @types/node).
 */
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { StubDevil } from "../src/game/devil";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };

const JUNK: Array<[number, string]> = [
  [200, JSON.stringify("lol no")],
  [500, JSON.stringify({ error: "gemini exploded" })],
  [200, '{"dialogue": "oops'],
  [200, JSON.stringify({
    dialogue: "x".repeat(900), effects: { gold: 9999, damage: 50, maxHp: 99, hp: "lots", xp: 3 },
    curse: { trigger: "on_hit", effect: { hp: -500 } }, rewrite: { nodeId: "nope", to: "boss" }, extra: 1,
  })],
  [200, "null"],
  [200, ""],
];

export function startMockDevil(port = 8787): Promise<Server> {
  const devils = new Map<string, StubDevil>();
  let count = 0;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return; }
    if (req.method !== "POST" || u.pathname !== "/deal") { res.writeHead(404, CORS).end("POST /deal only"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const n = count++;
      const delay = Number(u.searchParams.get("delay")) || 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const send = (status: number, text: string) => { res.writeHead(status, { ...CORS, "content-type": "application/json" }).end(text); };
      try {
        const { state, context, playerText } = JSON.parse(body);
        if (!state || !context) throw new Error("need { state, context, playerText }");
        if (u.searchParams.get("chaos") === "1" && n % 2 === 1) { const [s, t] = JUNK[Math.floor(n / 2) % JUNK.length]; send(s, t); return; }
        let d = devils.get(context.seed);
        if (!d) devils.set(context.seed, (d = new StubDevil(context.seed)));
        send(200, JSON.stringify(await d.offer(state, context, playerText ?? undefined)));
      } catch (e) { send(400, JSON.stringify({ error: String(e instanceof Error ? e.message : e) })); }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  await startMockDevil(port);
  console.log(`mock devil on http://localhost:${port}/deal  (add ?chaos=1 for junk, ?delay=ms for latency)`);
}
