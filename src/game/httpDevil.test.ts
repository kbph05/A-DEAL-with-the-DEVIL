import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { startMockDevil } from "../../scripts/mock-devil-server";
import { HttpDevil } from "./httpDevil";
import { sanitizeDeal } from "./deal";
import { createGame } from "./run";
import { autoplay, botPolicy } from "./autoplay";

let server: Server, base: string;
before(async () => { server = await startMockDevil(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/deal`; });
after(() => { server.closeAllConnections(); server.close(); });

test("HttpDevil gets a real, sanitizable deal from the mock backend and sends state, context and playerText", async () => {
  const g = createGame("http-1");
  const x = await new HttpDevil(base).exchange(g.observe().state, g.context(), "I want gold");
  assert.equal(x.ok, true);
  assert.equal(x.status, 200);
  assert.equal(x.request.playerText, "I want gold");
  assert.equal(x.request.context.seed, "http-1");
  const deal = await new HttpDevil(base).offer(g.observe().state, g.context());
  assert.equal(typeof deal.dialogue, "string");
});

test("a whole bot run through HttpDevil (chaos on) still ends cleanly", async () => {
  const r = await autoplay("http-2", botPolicy, 1000, new HttpDevil(`${base}?chaos=1`));
  assert.ok(["win", "lose", "hell"].includes(r.outcome), r.outcome);
});

test("chaos mode: junk either rejects (so the engine falls back) or sanitizes to a legal deal", async () => {
  const g = createGame("http-3");
  const d = new HttpDevil(`${base}?chaos=1`);
  let rejected = 0;
  for (let i = 0; i < 14; i++) {
    try { const deal = sanitizeDeal(await d.offer(g.observe().state, g.context())); assert.equal(typeof deal.dialogue, "string"); }
    catch { rejected++; }
  }
  assert.ok(rejected >= 3, `expected several junk rejections, got ${rejected}`);
});

test("errors never throw from exchange(): refused connection and timeout", async () => {
  const g = createGame("http-4");
  const dead = await new HttpDevil("http://127.0.0.1:1/deal").exchange(g.observe().state, g.context());
  assert.equal(dead.ok, false); assert.equal(dead.status, null); assert.match(dead.error ?? "", /network/);
  const slow = await new HttpDevil(`${base}?delay=500`, { timeoutMs: 50 }).exchange(g.observe().state, g.context());
  assert.equal(slow.ok, false); assert.match(slow.error ?? "", /timed out/);
  await assert.rejects(new HttpDevil(`${base}?delay=500`, { timeoutMs: 50 }).offer(g.observe().state, g.context()));
});

test("non-JSON server: exchange reports it", async () => {
  const s = createServer((_q, r) => r.end("<html>nope</html>"));
  await new Promise<void>((ok) => s.listen(0, ok));
  const g = createGame("http-5");
  const x = await new HttpDevil(`http://127.0.0.1:${(s.address() as AddressInfo).port}/`).exchange(g.observe().state, g.context());
  assert.equal(x.ok, false); assert.match(x.error ?? "", /not valid JSON/);
  s.closeAllConnections(); s.close();
});
