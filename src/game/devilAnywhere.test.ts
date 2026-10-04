/**
 * The devil outside his table (kbph and Big Chungus, 4 Oct): a deal is the third choice at every campfire (one of rest,
 * train or deal), and he turns up at some wells (WELL_DEVIL_CHANCE, his own hashed roll per seed and node). Same rules as a
 * deal node there: MAX_ASKS per node, MAX_DEVIL_QUERIES per run, strikes and anger, accept and refuse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDeal } from "./deal";
import { DEVIL_GOLD_FROM, devilGold } from "./economy";
import { StubDevil, WELL_ENTICE, type Deal, type Devil } from "./devil";
import {
  MAX_ASKS, MAX_DEVIL_QUERIES, ONE_CHOICE, WELL_DEVIL_CHANCE, devilAtWell, initialState, type Command, type GameState, type StepResult,
} from "./gameState";
import { restoreGame } from "./run";
import { step } from "./state-machine";
import { observation } from "./view";

const OFFER: Deal = { dialogue: "Sign.", effects: { gold: 5 } };
const STRIKE: Deal = { dialogue: "Enough.", effects: { hp: -4 }, forced: true };
const has = (r: { actions: Command[] }, cmd: string) => r.actions.some((c) => c.cmd === cmd);
const reason = (r: StepResult) => (r.events[0]?.type === "rejected" ? r.events[0].reason : null);
function ok(s: GameState, c: Command): GameState {
  const r = step(s, c);
  assert.ok(r.ok, `${JSON.stringify(c)}: ${JSON.stringify(r.events)}`);
  return r.state;
}
/** Ask the devil and answer for him in one go. */
const ask = (s: GameState, answer: Deal = OFFER, text = "a wish"): GameState => ok(ok(s, { cmd: "deal", text }), { cmd: "devil_reply", deal: answer });

/** Put the player on node `id` (as `enter` would leave it, minus the events), turned into `kind`. */
function moveTo(s: GameState, id: string, kind: "campfire" | "well" | "deal"): GameState {
  const d = structuredClone(s);
  d.acts[d.player.act].nodes.find((n) => n.id === id)!.kind = kind;
  d.player.nodeId = id;
  d.resolved = false; d.offer = null; d.asks = 0; d.enemy = null;
  delete d.devilGone;
  return d;
}
const atFire = (seed = "fire"): GameState => moveTo(initialState(seed), "a0n0", "campfire");
/** A run standing at a well where the devil sits (`yes`) or does not. */
function atWell(yes: boolean, seed = "well"): GameState {
  const s = initialState(seed), id = s.acts[0].nodes.map((n) => n.id).find((i) => i !== s.acts[0].entry && devilAtWell(seed, i) === yes)!;
  return moveTo(s, id, "well");
}

test("campfire: rest, train and deal are mutually exclusive, in every order (3 x 2)", () => {
  const choose: Record<string, (s: GameState) => GameState> = {
    rest: (s) => ok(s, { cmd: "rest" }), train: (s) => ok(s, { cmd: "train" }), deal: (s) => ok(s, { cmd: "deal" }),
  };
  for (const first of ["rest", "train", "deal"]) for (const second of ["rest", "train", "deal"].filter((x) => x !== first)) {
    const s0 = atFire(`order-${first}-${second}`);
    assert.ok(["rest", "train", "deal"].every((c) => has({ actions: step(s0, { cmd: "look" }).actions }, c)), "all three on arrival");
    let s = choose[first](s0);
    if (first === "deal") s = ok(s, { cmd: "devil_reply", deal: OFFER }); // the ask alone already locks the fire
    const r = step(s, { cmd: second } as Command);
    assert.equal(r.ok, false, `${first} then ${second}`);
    assert.equal(r.state, s, "rejected: state untouched");
    assert.equal(reason(r), first === "deal" ? "you chose the devil at this fire" : "the embers are spent");
    assert.ok(!has(r, second), `${second} not listed after ${first}`);
  }
});

test("campfire: the first ask spends the choice, whatever follows (haggle, strike, accept, refuse, walking away)", () => {
  const locked = (s: GameState) => ["rest", "train"].every((c) => reason(step(s, { cmd: c } as Command)) === "you chose the devil at this fire");
  const asked = ok(atFire(), { cmd: "deal", text: "a wish" });
  assert.ok(asked.pending, "pending: only devil_reply goes");
  const offered = ok(asked, { cmd: "devil_reply", deal: OFFER });
  assert.ok(locked(offered) && has(step(offered, { cmd: "look" }), "deal"), "haggling stays open");
  const struck = ask(atFire(), STRIKE);
  assert.ok(locked(struck) && !struck.resolved, "a strike leaves the node open, the fire still locked");
  assert.equal(struck.asks, 1);
  for (const end of ["accept", "refuse"] as const) {
    const done = ok(offered, { cmd: end });
    assert.ok(done.resolved, `${end} spends the fire`);
    for (const c of ["rest", "train", "deal"]) assert.equal(step(done, { cmd: c } as Command).ok, false, `${c} after ${end}`);
    assert.equal(reason(step(done, { cmd: "deal" })), "the devil has already gone");
    assert.equal(observation(done).asksLeft, 0);
  }
  // Walking away: the fire is left behind like any node; nothing to come back to (edges only go forward).
  assert.ok(step(offered, { cmd: "go", n: 1 }).ok);
  // Haggles are capped per node as at a deal node.
  let h = atFire("haggle");
  for (let i = 0; i < MAX_ASKS; i++) h = ask(h);
  assert.equal(reason(step(h, { cmd: "deal" })), "he is done haggling: accept() or refuse()");
  assert.ok(has(step(h, { cmd: "look" }), "accept"));
});

test("campfire: the devil is told where he sits; the view says he is here", () => {
  const r = step(atFire(), { cmd: "deal", text: "gold" });
  assert.equal(r.awaiting?.devil?.context.kind, "campfire");
  assert.equal(observation(atFire()).devilPresent, true);
  assert.equal(observation(atFire()).asksLeft, MAX_ASKS);
  assert.equal(observation(ok(atFire(), { cmd: "rest" })).asksLeft, 0, "rested: no asks left here");
  const deal = moveTo(initialState("d"), "a0n0", "deal");
  assert.equal(step(deal, { cmd: "deal" }).awaiting?.devil?.context.kind, "deal");
  assert.equal(observation(initialState("v")).devilPresent, false, "not at the village");
});

test("well devil: deterministic per seed and node, about WELL_DEVIL_CHANCE over many seeds", () => {
  assert.equal(WELL_DEVIL_CHANCE, 0.5);
  let yes = 0, n = 0;
  for (let i = 0; i < 2000; i++) for (const id of ["a0n3", "a1n5", "a2n7"]) {
    const v = devilAtWell(`wd-${i}`, id);
    assert.equal(devilAtWell(`wd-${i}`, id), v, "same answer every time");
    yes += v ? 1 : 0; n++;
  }
  assert.ok(Math.abs(yes / n - WELL_DEVIL_CHANCE) < 0.03, `devil at ${(100 * yes / n).toFixed(1)}% of wells`);
});

test("well devil: entering a well announces him exactly when the dice say so, and only then is deal legal", () => {
  let seen = 0, absent = 0;
  for (let i = 0; i < 300; i++) {
    const s = initialState(`walk-${i}`), act = s.acts[0], next = act.nodes.find((x) => x.id === act.nodes[0].next[0])!;
    next.kind = "well";
    const r = step(s, { cmd: "go", n: 1 }), here = devilAtWell(s.seed, next.id);
    assert.ok(r.ok);
    assert.deepEqual(r.state.rng, s.rng, "the roll leaves the dice stream alone");
    const appears = r.events.filter((e) => e.type === "devil_appears");
    assert.deepEqual(appears, here ? [{ type: "devil_appears", nodeId: next.id, kind: "well" }] : []);
    if (here) assert.equal(r.events[r.events.findIndex((e) => e.type === "moved") + 1].type, "devil_appears", "right after moved");
    assert.equal(has(r, "deal"), here);
    assert.equal(observation(r.state).devilPresent, here);
    if (!here) { assert.equal(reason(step(r.state, { cmd: "deal" })), "the devil does not sit here"); absent++; } else seen++;
  }
  assert.ok(seen > 100 && absent > 100, `${seen} with, ${absent} without`);
});

test("well: one choice of blessing, deal or skip; the first choice locks the other, in either order", () => {
  const rich = (s: GameState) => { s.player.gold = 50; return s; };
  // blessing first: the deal is refused, with a player-facing reason, and the devil is shut out of the view
  const s = ok(rich(atWell(true)), { cmd: "buy", item: "blessing" });
  assert.ok(s.resolved && !has(step(s, { cmd: "look" }), "deal"));
  assert.equal(reason(step(s, { cmd: "deal" })), ONE_CHOICE.well.spent);
  assert.equal(observation(s).asksLeft, 0);
  assert.equal(reason(step(s, { cmd: "buy", item: "blessing" })), "the well has given what it will give");
  assert.ok(has(step(s, { cmd: "look" }), "go"), "moving on is still open");
  // the first ask locks the blessing, before any answer is decided (an offer standing, or a strike)
  const asked = ask(rich(atWell(true, "well-2")));
  assert.ok(asked.offer && !has(step(asked, { cmd: "look" }), "buy"));
  assert.equal(reason(step(asked, { cmd: "buy", item: "blessing" })), ONE_CHOICE.well.devil);
  const struck = ask(rich(atWell(true, "well-2")), STRIKE);
  assert.equal(reason(step(struck, { cmd: "buy", item: "blessing" })), ONE_CHOICE.well.devil);
  // refusing (or accepting) the deal still locks it
  for (const end of ["refuse", "accept"] as const) {
    const t = ok(asked, { cmd: end });
    assert.ok(t.devilGone && t.resolved === (end === "accept"), `${end}: the devil leaves; accepting also spends the well`);
    assert.equal(reason(step(t, { cmd: "buy", item: "blessing" })), ONE_CHOICE.well.devil);
    assert.equal(reason(step(t, { cmd: "deal" })), "the devil has already gone");
    assert.ok(has(step(t, { cmd: "look" }), "go"));
    assert.equal(ok(t, { cmd: "go", n: 1 }).devilGone, undefined, "leaving resets the devil's flag");
  }
  // skipping is just leaving: nothing taken, nothing locked behind you
  assert.ok(step(rich(atWell(true)), { cmd: "go", n: 1 }).ok);
  // no devil: the well is only a well (blessing or skip)
  const u = rich(atWell(false));
  assert.equal(reason(step(u, { cmd: "deal" })), "the devil does not sit here");
  assert.deepEqual(step(u, { cmd: "look" }).actions.map((c) => c.cmd).filter((c) => c !== "go"), ["buy"]);
  assert.ok(step(u, { cmd: "buy", item: "blessing" }).ok);
  assert.equal(step(atWell(true), { cmd: "deal" }).awaiting?.devil?.context.kind, "well");
});

test("well: the stub devil opens by talking the player out of the blessing, deterministic per seed", async () => {
  const pending = (seed: string) => step(atWell(true, seed), { cmd: "deal" }).state.pending!;
  for (const seed of ["well", "well-2", "w3"]) {
    const req = pending(seed);
    const a = await new StubDevil().offer(req.state, req.context), b = await new StubDevil().offer(req.state, req.context);
    assert.equal(a.dialogue, b.dialogue);
    assert.ok(WELL_ENTICE.some((l) => a.dialogue.startsWith(l)), a.dialogue);
  }
  const fire = ok(atFire(), { cmd: "deal" }).pending!;
  const f = await new StubDevil().offer(fire.state, fire.context);
  assert.ok(!WELL_ENTICE.some((l) => f.dialogue.includes(l)), "only at a well");
});

test("the run-wide question cap counts asks at deal nodes, campfires and wells alike", () => {
  const seed = "cap";
  let s = initialState(seed);
  const ids = s.acts[0].nodes.map((n) => n.id).filter((i) => i !== s.acts[0].entry);
  const well = ids.find((i) => devilAtWell(seed, i))!, others = ids.filter((i) => i !== well);
  const visit = (id: string, kind: "campfire" | "well" | "deal", asks: number) => {
    s = moveTo(s, id, kind);
    for (let i = 0; i < asks; i++) s = ask(s);
    s = ok(s, { cmd: "refuse" });
  };
  visit(others[0], "deal", 3); visit(others[1], "campfire", 3); visit(well, "well", 3);
  assert.equal(s.totalAsks, 9);
  s = moveTo(s, others[2], "campfire");
  s = ask(s);
  assert.equal(observation(s).questionsLeft, 0);
  assert.equal(reason(step(s, { cmd: "deal" })), "The devil has heard enough from you this run.");
  for (const kind of ["deal", "well", "campfire"] as const) {
    const t = moveTo(s, kind === "well" ? well : others[3], kind);
    assert.equal(s.totalAsks, MAX_DEVIL_QUERIES);
    assert.equal(reason(step(t, { cmd: "deal", text: "gold" })), "The devil has heard enough from you this run.", kind);
    assert.ok(has(step(t, { cmd: "look" }), "deal"), `${kind}: his free opener is still listed`);
    const o = ok(ok(t, { cmd: "deal" }), { cmd: "devil_reply", deal: OFFER });
    assert.ok(o.offer && o.totalAsks === MAX_DEVIL_QUERIES && !has(step(o, { cmd: "look" }), "deal"), `${kind}: after the opener, nothing more`);
  }
  assert.ok(step(s, { cmd: "accept" }).ok, "an offer on the table can still be taken");
  assert.equal(step(ok(s, { cmd: "refuse" }), { cmd: "rest" }).ok, false, "and the fire is spent");
});

test("campfire: strikes and anger work as at a deal node (StubDevil, gibberish and off-topic text)", async () => {
  let strikes = 0, rants = 0;
  for (let i = 0; i < 40; i++) {
    const g = restoreGame(atFire(`angry-${i}`));
    const hp = g.state.hp;
    const r = await g.deal(i % 2 ? "asdfghjkl qwertyuiop" : "tell me a joke about cats");
    assert.ok(r.ok);
    const struck = r.events.find((e) => e.type === "devil_struck");
    if (struck) {
      strikes++;
      assert.ok(g.state.hp < hp && g.state.hp >= hp - 8, "an HP loss, capped");
      assert.equal(g.gameState.resolved, false, "the node stays open");
      assert.equal(g.gameState.asks, 1);
      assert.equal(g.rest().ok, false, "and the fire is still spent on the devil");
    } else {
      rants++;
      const offer = g.observe().offer!;
      assert.ok(offer.curse, "an angry spite offer always carries a curse");
    }
  }
  assert.ok(strikes > 0 && rants > 0, `${strikes} strikes, ${rants} rants`);
  // A backend strike that would kill: the usual death check at a campfire too.
  const dying = atFire("dying");
  dying.player.hp = 3; dying.player.soul = 0;
  const g = restoreGame(dying, { offer: async () => STRIKE } as Devil);
  const r = await g.deal("asdf");
  assert.deepEqual(r.events.at(-1), { type: "lost", cause: "the devil's wrath" });
});

test("opening offer: free (no ask, no question), once per node; at a well it doesn't lock the blessing until accepted", () => {
  const rich = (s: GameState) => { s.player.gold = 50; return s; };
  const open = (s: GameState, answer: Deal = OFFER) => ok(ok(s, { cmd: "deal" }), { cmd: "devil_reply", deal: answer });
  const w = open(rich(atWell(true)));
  assert.ok(w.offer && w.opened && w.asks === 0 && w.totalAsks === 0);
  assert.equal(observation(w).questionsLeft, MAX_DEVIL_QUERIES);
  assert.equal(reason(step(w, { cmd: "buy", item: "blessing" })), "the devil is waiting for your answer: accept() or refuse()");
  const refused = ok(w, { cmd: "refuse" });
  assert.ok(refused.devilGone && step(refused, { cmd: "buy", item: "blessing" }).ok, "refusing his pitch leaves the blessing");
  const accepted = ok(w, { cmd: "accept" });
  assert.equal(reason(step(accepted, { cmd: "buy", item: "blessing" })), ONE_CHOICE.well.devil, "accepting it is choosing him");
  // a text-less deal after the opener is an ordinary ask
  const again = ok(w, { cmd: "deal" });
  assert.equal(again.totalAsks, 1);
  assert.equal(again.pending?.context.opening, undefined);
  // at a fire the opener comes after Deal was chosen, so it spends the fire like an ask
  const f = open(atFire());
  assert.equal(reason(step(f, { cmd: "rest" })), ONE_CHOICE.campfire.devil);
  assert.ok(ok(f, { cmd: "refuse" }).resolved);
  // no opener after the blessing, nor where the devil is absent
  assert.equal(reason(step(ok(rich(atWell(true)), { cmd: "buy", item: "blessing" }), { cmd: "deal" })), ONE_CHOICE.well.spent);
  assert.equal(observation(atWell(false)).opening, false);
});

test("StubDevil opener: tailored to the state (low HP heals, weak before the boss sharpens, a curse's toll, poor gets strength early and gold late), always at a price", async () => {
  const req = (tweak: (s: GameState) => void, seed = "op") => {
    const s = moveTo(initialState(seed), "a0n0", "deal");
    tweak(s);
    return step(s, { cmd: "deal" }).state.pending!;
  };
  const offer = async (tweak: (s: GameState) => void, progress?: number) => {
    const r = req(tweak);
    return new StubDevil().offer(r.state, progress === undefined ? r.context : { ...r.context, progress }, r.playerText ?? undefined);
  };
  const priced = (d: Deal) => d.curse !== undefined || Object.values(d.effects).some((v) => v < 0);
  const low = await offer((s) => { s.player.hp = 5; });
  assert.ok((low.effects.hp ?? 0) > 0 || (low.effects.max_hp ?? 0) > 0, JSON.stringify(low));
  const weak = await offer((s) => { s.player.gold = 50; s.acts[0].visited = s.acts[0].nodes.map((n) => n.id); }); // nothing left to rewrite: the boss is next
  assert.ok((weak.effects.attack ?? 0) > 0, `weak before the boss: ${JSON.stringify(weak)}`);
  const cursed = await offer((s) => { s.player.gold = 50; s.curses = [{ trigger: "on_hit", effect: { hp: -4 } }]; });
  assert.equal(cursed.effects.hp, 4, JSON.stringify(cursed));
  const poor = await offer((s) => { s.player.gold = 2; });
  assert.equal(poor.effects.gold, undefined, `broke early: no purse yet (kbph, 4 Oct): ${JSON.stringify(poor)}`);
  assert.ok((poor.effects.attack ?? 0) > 0 || (poor.effects.max_hp ?? 0) > 0, JSON.stringify(poor));
  const poorLate = await offer((s) => { s.player.gold = 2; }, DEVIL_GOLD_FROM);
  assert.equal(poorLate.effects.gold, devilGold(DEVIL_GOLD_FROM), `broke from mid act 2: gold, ${JSON.stringify(poorLate)}`);
  assert.ok((poorLate.effects.max_hp ?? 0) < 0, "gold costs a real stat, not only a curse the fine print could strike");
  const rich = await offer((s) => { s.player.gold = 50; });
  assert.equal(rich.effects.soul, -1, "flush and healthy: he wants the soul");
  assert.equal(rich.effects.gold, undefined, "early, the soul buys stats, not gold");
  for (const d of [low, weak, cursed, poor, poorLate, rich]) { assert.ok(priced(d), `never free: ${JSON.stringify(d)}`); assert.deepEqual(sanitizeDeal(d), d); }
  assert.deepEqual(await offer((s) => { s.player.hp = 5; }), low, "pure");
});
