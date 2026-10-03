import { test } from "node:test";
import assert from "node:assert/strict";
import { autoplay, botPolicy, execute, simulate } from "./autoplay";
import { createGame } from "./run";

test("200 seeds: the bot always reaches win, lose or hell, never throws or stalls", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const r = await autoplay(`seed-${i}`);
    assert.ok(["win", "lose", "hell"].includes(r.outcome), `seed-${i}: ${r.outcome} after ${r.steps} steps`);
    assert.equal(r.events[0].type, "started");
    const last = r.events[r.events.length - 1];
    assert.equal(last.type, r.outcome === "lose" ? "lost" : r.outcome === "win" ? "won" : "hell");
    seen.add(r.outcome);
  }
  assert.ok(seen.has("win") && seen.has("lose"), `outcomes seen: ${[...seen]}`);
});

test("state stays in range on every step of every run", async () => {
  for (let i = 0; i < 50; i++) {
    const g = createGame(`range-${i}`);
    for (let step = 0; !g.ending && step < 1000; step++) {
      const c = botPolicy(g.observe());
      assert.ok(c);
      const { state } = await execute(g, c);
      assert.ok(Number.isInteger(state.hp) && state.hp >= 0 && state.hp <= state.maxHp, `hp ${state.hp}/${state.maxHp}`);
      assert.ok(state.gold >= 0 && state.attack >= 1 && (state.soul === 0 || state.soul === 1));
    }
    assert.ok(g.ending);
  }
});

test("determinism: same seed and policy give an identical event log", async () => {
  for (const seed of ["a", "b", "devil", 7]) {
    const [x, y] = [await autoplay(seed), await autoplay(seed)];
    assert.deepEqual(x.events, y.events);
    assert.equal(x.steps, y.steps);
  }
  const [p, q] = [await autoplay("one"), await autoplay("two")];
  assert.notDeepEqual(p.events, q.events);
});

test("simulate tallies outcomes", async () => {
  const t = await simulate(20);
  assert.equal(t.total, 20);
  assert.equal(t.win + t.lose + t.hell + t.timeout, 20);
  assert.equal(t.timeout, 0);
  assert.deepEqual(await simulate(20), t);
});

test("a policy that never acts times out instead of hanging", async () => {
  const r = await autoplay("idle", () => ({ cmd: "look" }), 25);
  assert.equal(r.outcome, "timeout");
  assert.equal(r.steps, 25);
});

test("hell ending when winning soulless; win when the soul is kept", async () => {
  for (const [soul, want] of [[0, "hell"], [1, "win"]] as const) {
    const g = createGame("god-mode");
    for (let step = 0; !g.ending && step < 1000; step++) {
      Object.assign(g.state, { hp: 60, maxHp: 60, attack: 12, soul }); // never die, never revive
      const c = botPolicy(g.observe());
      assert.ok(c);
      await execute(g, c);
    }
    assert.equal(g.ending, want);
  }
});
