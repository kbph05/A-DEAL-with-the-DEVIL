import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, legalActions, step, view, type Command, type GameState } from "../game";
import { mulberry32 } from "../map/rng";
import { CLOSE_DEVIL, LOCAL, OPEN_DEVIL, arrived, flow, setLocal, toastEvents, wantsOpener, wellChoice, wishToSend, type FlowView, type Local } from "./flow";
import type { GameEvent } from "../game";

const go: Command = { cmd: "go", n: 1 };
/** A hand-made view: by default a quiet node with one exit and nothing else going on. */
function fv(over: Partial<FlowView> = {}): FlowView {
  return { nodeId: "a0n1", kind: "village", enemy: null, offer: null, pending: false, resolved: false, ending: null, devilPresent: false, asksLeft: 0, actions: [go], ...over };
}
const at = (patch: Partial<Local> = {}, nodeId = "a0n1"): Local => setLocal(LOCAL, nodeId, patch);
const offer = { dialogue: "A trade?", effects: { hp: 5 } };
const enemy = { name: "cave rat", hp: 10, maxHp: 10, boss: false };

test("village: the map is optional, opens and closes, never forced", () => {
  const v = fv({ kind: "village", actions: [{ cmd: "buy", item: "heal" }, go] });
  assert.deepEqual([flow(v).map, flow(v).mapButton], ["closed", true]);
  assert.equal(flow(v, at({ mapOpen: true })).map, "open");
  assert.equal(flow(v, at({ mapOpen: false })).map, "closed");
  assert.equal(flow(v, at({ mapOpen: true }, "elsewhere")).map, "closed", "a flag from another node is ignored");
});

test("campfire: rest / train / deal prompts, then the map is forced once the choice resolves", () => {
  const fire = fv({ kind: "campfire", devilPresent: true, asksLeft: 3, actions: [{ cmd: "rest" }, { cmd: "train" }, { cmd: "deal" }, go] });
  assert.deepEqual(flow(fire).prompts, ["rest", "train", "deal"]);
  assert.equal(flow(fire).map, "closed");
  assert.equal(flow(fire).mapButton, false);
  // rested or trained: resolved
  assert.equal(flow(fv({ kind: "campfire", devilPresent: true, resolved: true })).map, "forced");
  // chose the devil: overlay; asked once: rest and train are gone, still talking
  assert.equal(flow(fire, at({ talking: true })).devil, true);
  const talking = fv({ kind: "campfire", devilPresent: true, asksLeft: 2, actions: [{ cmd: "deal" }, go] });
  assert.deepEqual([flow(talking).devil, flow(talking).map], [true, "closed"]);
  // accepted / refused: resolved → forced; asks used up with no offer → ended → forced; walked away after asking → forced
  assert.equal(flow(fv({ kind: "campfire", devilPresent: true, resolved: true, asksLeft: 0 })).map, "forced");
  assert.equal(flow(fv({ kind: "campfire", devilPresent: true, asksLeft: 0 })).map, "forced");
  assert.equal(flow(talking, at({ walkedAway: true })).map, "forced");
  // closing the overlay before asking just goes back to the three choices; after asking it forces the map
  const opened = at(OPEN_DEVIL);
  assert.equal(flow(fire, opened).devil, true);
  const closed = setLocal(opened, "a0n1", CLOSE_DEVIL);
  assert.deepEqual([flow(fire, closed).devil, flow(fire, closed).prompts], [false, ["rest", "train", "deal"]]);
  assert.equal(flow(talking, closed).map, "forced");
  assert.equal(flow(fire, setLocal(closed, "a0n1", OPEN_DEVIL)).devil, true, "open again");
});

test("well: blessing, deal only where the devil sits, move on forces the map", () => {
  const well = fv({ kind: "well", actions: [{ cmd: "buy", item: "blessing" }, go] });
  assert.deepEqual(flow(well).prompts, ["blessing", "move-on"]);
  assert.equal(flow(well).map, "closed");
  const devilWell = fv({ kind: "well", devilPresent: true, asksLeft: 3, actions: [{ cmd: "buy", item: "blessing" }, { cmd: "deal" }, go] });
  assert.deepEqual(flow(devilWell).prompts, ["blessing", "deal", "move-on"]);
  assert.equal(flow(devilWell, at(OPEN_DEVIL)).devil, true);
  const closed = at({ ...OPEN_DEVIL, ...CLOSE_DEVIL });
  assert.deepEqual([flow(devilWell, closed).devil, flow(devilWell, closed).map], [false, "closed"], "closing the well's devil keeps you at the well");
  assert.equal(flow(devilWell, setLocal(closed, "a0n1", OPEN_DEVIL)).devil, true, "open again");
  assert.deepEqual(flow(fv({ kind: "well", resolved: true })).prompts, ["move-on"], "blessing taken");
  assert.equal(flow(well, at({ movedOn: true })).map, "forced");
});

test("fight and boss: no map while the enemy stands or the fight is on; forced after a win", () => {
  for (const kind of ["fight", "boss"] as const) {
    const blocked = fv({ kind, enemy, actions: [{ cmd: "fight" }, { cmd: "fight", realtime: true }] });
    assert.deepEqual([flow(blocked).screen, flow(blocked).map, flow(blocked).prompts], ["fight", "closed", ["fight"]]);
    const pendingFight = fv({ kind, enemy, actions: [{ cmd: "fight_result", won: false, hpLeft: 30 }] });
    assert.deepEqual([flow(pendingFight).map, flow(pendingFight).prompts], ["closed", []]);
    assert.equal(flow(blocked, at({ busy: "fight" })).map, "closed");
    assert.equal(flow(fv({ kind })).map, "forced", "won: the enemy is gone");
  }
});

test("deal node: the overlay until resolved, ended or walked away; then the map is forced", () => {
  const table = fv({ kind: "deal", devilPresent: true, asksLeft: 3, actions: [{ cmd: "deal" }, go] });
  assert.deepEqual([flow(table).devil, flow(table).map], [true, "closed"]);
  assert.equal(flow(fv({ kind: "deal", devilPresent: true, resolved: true })).map, "forced");
  assert.equal(flow(fv({ kind: "deal", devilPresent: true, asksLeft: 0 })).map, "forced", "asks spent, no offer: ended");
  assert.equal(flow(table, at({ walkedAway: true })).map, "forced");
  // questions spent for the run before asking here: the overlay says so; walking away forces the map
  const heardEnough = fv({ kind: "deal", devilPresent: true, asksLeft: 3, actions: [go] });
  assert.equal(flow(heardEnough).devil, true);
  assert.equal(flow(heardEnough, at({ walkedAway: true })).map, "forced");
});

test("never forced while the devil is speaking, an offer stands or a fight is pending", () => {
  for (const kind of ["village", "campfire", "well", "deal", "fight"] as const) {
    const pending = fv({ kind, devilPresent: true, pending: true, actions: [{ cmd: "devil_reply", deal: null }] });
    assert.deepEqual([flow(pending).map, flow(pending).devil], ["closed", true], kind);
    const onTable = fv({ kind, devilPresent: true, offer, asksLeft: 1, actions: [{ cmd: "accept" }, { cmd: "refuse" }, go] });
    assert.deepEqual([flow(onTable, at({ movedOn: true, walkedAway: true, mapOpen: true })).map, flow(onTable).devil], ["closed", true], kind);
    assert.equal(flow(fv({ kind }), at({ busy: "devil", mapOpen: true, movedOn: true })).map, "closed", kind);
  }
});

test("endings: the ending screen, no map", () => {
  for (const ending of ["win", "lose", "hell"] as const) {
    const f = flow(fv({ kind: ending === "lose" ? "fight" : "final", ending, actions: [] }), at({ mapOpen: true }));
    assert.deepEqual([f.screen, f.map, f.ending, f.devil, f.prompts.length], ["ending", "closed", ending, false, 0]);
  }
});

test("arrived/setLocal reset the flags on a move", () => {
  const l = setLocal(LOCAL, "a", { mapOpen: true, movedOn: true });
  assert.equal(setLocal(l, "b", { talking: true }).mapOpen, false);
  assert.equal(setLocal(l, "a", { talking: true }).mapOpen, true);
  assert.deepEqual(arrived("x"), { ...LOCAL, at: "x" });
});

/**
 * The real engine: random legal play over many seeds (the player's local flags drawn at random too). At every state a
 * forced or open map must have a legal `go`, nothing is forced while the devil speaks, an offer stands, an enemy blocks
 * or a fight is on, and an ending shows the ending screen.
 */
test("property: random legal play never strands the player", () => {
  let forcedSeen = 0;
  const kindsForced = new Set<string>();
  for (let seed = 0; seed < 150; seed++) {
    const rnd = mulberry32(seed + 1);
    let s: GameState = initialState(`flow-${seed}`);
    for (let i = 0; i < 400 && !s.ending; i++) {
      const v = view(s);
      const local = setLocal(LOCAL, v.nodeId, { mapOpen: rnd() < 0.5, movedOn: rnd() < 0.3, talking: rnd() < 0.5, walkedAway: rnd() < 0.2 });
      const f = flow(v, local);
      if (f.map !== "closed") {
        assert.ok(v.actions.some((c) => c.cmd === "go"), `seed ${seed}: map ${f.map} at ${v.kind} without a legal go`);
        assert.ok(!v.pending && !v.offer && !v.enemy, `seed ${seed}: map ${f.map} while blocked`);
      }
      if (f.map === "forced") { forcedSeen++; kindsForced.add(v.kind); assert.equal(f.devil, false); }
      for (const p of f.prompts) {
        if (p === "move-on" || p === "fight") continue;
        assert.ok(v.actions.some((c) => c.cmd === (p === "blessing" ? "buy" : p)), `prompt ${p} is legal`);
      }
      const legal = legalActions(s);
      let c = legal[Math.floor(rnd() * legal.length)];
      if (c.cmd === "fight" && c.realtime) c = { cmd: "fight" };
      if (c.cmd === "fight_result") c = { ...c, won: true, enemyHpLeft: 0 };
      if (c.cmd === "devil_reply") c = { cmd: "devil_reply", deal: rnd() < 0.5 ? { dialogue: "Yes.", effects: { gold: 3 } } : null };
      s = step(s, c).state;
    }
    if (s.ending) assert.equal(flow(view(s)).screen, "ending");
  }
  assert.ok(forcedSeen > 100, `forced maps seen: ${forcedSeen}`);
  for (const k of ["fight", "campfire", "well", "deal"]) assert.ok(kindsForced.has(k), `a forced map at a ${k}`);
});

test("wantsOpener: the overlay asks for the devil's opening offer as he appears (deal node, well, Deal at a fire), once", () => {
  /** Stand on a0n6 of seed ws-3 (a well where the devil sits), turned into `kind`. */
  const standAt = (kind: "deal" | "well" | "campfire"): GameState => {
    const s = initialState("ws-3");
    s.acts[0].nodes.find((n) => n.id === "a0n6")!.kind = kind;
    s.player.nodeId = "a0n6"; s.player.gold = 30;
    return s;
  };
  const idle = { busy: null } as const;
  for (const kind of ["deal", "well", "campfire"] as const) {
    const s = standAt(kind), v = view(s);
    assert.equal(v.opening, true, `${kind}: due`);
    const l = kind === "campfire" ? at(OPEN_DEVIL, "a0n6") : arrived("a0n6");
    if (kind === "campfire") assert.equal(wantsOpener(v, flow(v, arrived("a0n6")), idle), false, "a fire waits for Deal");
    assert.equal(wantsOpener(v, flow(v, l), idle), true, `${kind}: asked for as he appears`);
    assert.equal(wantsOpener(v, flow(v, l), { busy: "devil" }), false, `${kind}: not while busy`);
    // the opener is free: no question used, no ask; then it is not due again
    const r = step(s, { cmd: "deal" });
    assert.ok(r.ok && r.awaiting?.devil?.context.opening === true && r.awaiting.devil.playerText === null);
    assert.equal(r.state.totalAsks, 0);
    const answered = step(r.state, { cmd: "devil_reply", deal: offer }).state, after = view(answered);
    assert.equal(after.questionsLeft, view(s).questionsLeft);
    assert.equal(after.opening, false);
    assert.equal(wantsOpener(after, flow(after, l), idle), false, `${kind}: once per node`);
    // a typed wish after it counts as a question as usual
    assert.equal(step(answered, { cmd: "deal", text: "gold" }).state.totalAsks, 1);
  }
  // a devil-free well, or a village: nothing to ask for
  const plain = view(initialState("ws-3"));
  assert.equal(plain.opening, false);
});

test("wellChoice: the blessing or the devil, since arriving at the well (log newest first)", () => {
  const moved: GameEvent = { type: "moved", from: "a0n2", to: "a0n3", kind: "well", act: 0 };
  const blessing: GameEvent = { type: "bought", item: "blessing", cost: 8, changes: { max_hp: 3 } };
  const accepted: GameEvent = { type: "deal_applied", deal: { dialogue: "Sign.", effects: { soul: -1 } }, changes: { soul: -1 } };
  assert.equal(wellChoice([moved]), null, "nothing chosen yet");
  assert.equal(wellChoice([accepted, moved]), "devil", "his offer accepted: not the blessing");
  assert.equal(wellChoice([{ type: "deal_refused" }, moved]), "devil", "refused: he has left");
  assert.equal(wellChoice([blessing, { type: "deal_refused" }, moved]), "blessing", "refused his opener, then bought the blessing");
  assert.equal(wellChoice([moved, accepted]), null, "a choice at an earlier node does not count");
});

test("wishToSend: a blank wish is sent only while the free opener is due", () => {
  assert.equal(wishToSend("  make me rich ", false), "make me rich");
  assert.equal(wishToSend("   ", false), null, "a blank Ask or Haggle would spend a question");
  assert.equal(wishToSend("", undefined), null);
  assert.equal(wishToSend("", true), "", "blank before the opener is the opener, which is free");
});

test("toast: only a menu choice's answer or a lone rejection; no arrival or fight-result popups (kbph)", () => {
  const fightEnd: GameEvent[] = [
    { type: "fought", dealt: 10, enemyHp: 0, taken: 2, bout: { timeMs: 2900, hits: 1, enemy: "cave rat", outcome: "won" } },
    { type: "damaged", amount: 2, source: "cave rat", hp: 8 },
    { type: "enemy_slain", name: "cave rat", gold: 10, boss: false },
    { type: "act_advanced", act: 2 },
  ];
  assert.deepEqual(toastEvents(null, fightEnd), []);
  assert.deepEqual(toastEvents("fight_result", fightEnd), []);
  const arrival: GameEvent[] = [{ type: "moved", from: "a0n0", to: "a0n1", kind: "fight", act: 1 }, { type: "enemy_appeared", enemy }];
  assert.deepEqual(toastEvents("go", arrival), []);
  const bought: GameEvent = { type: "bought", item: "heal", cost: 5, changes: { hp: 5 } };
  assert.deepEqual(toastEvents("buy", [bought]), [bought]);
  const rested: GameEvent = { type: "healed", amount: 4, source: "rest", hp: 10 };
  assert.deepEqual(toastEvents("rest", [rested, { type: "act_advanced", act: 2 }]), [rested]);
  const no: GameEvent = { type: "rejected", reason: "not enough gold" };
  assert.deepEqual(toastEvents("buy", [no]), [no]);
  assert.deepEqual(toastEvents(null, [no]), [no]);
  assert.deepEqual(toastEvents("deal", [{ type: "deal_offered", deal: offer as never }]), []);
});

test("death's door: the devil's overlay over a forest fight, with no map, prompts or fight, until it is settled", () => {
  const s = initialState("flow-death");
  s.enemy = { ...enemy, power: 2 };
  const fought = step(step(s, { cmd: "fight", realtime: true }).state, { cmd: "fight_result", won: false, hpLeft: 0, timeMs: 3000, hitsTaken: 4, damageDealt: 2, enemyHpLeft: 8 });
  const pending = flow(view(fought.state), at({}, fought.state.player.nodeId));
  assert.deepEqual([pending.devil, pending.map, pending.prompts], [true, "closed", []]);
  const offered = step(fought.state, { cmd: "devil_reply", deal: { dialogue: "Your soul for another life.", effects: { soul: -1, hp: 15 } } });
  for (const local of [at({}, offered.state.player.nodeId), at({ walkedAway: true }, offered.state.player.nodeId), at({ busy: "fight" }, offered.state.player.nodeId)]) {
    const f = flow(view(offered.state), local);
    assert.equal(f.devil, true, JSON.stringify(local));
    assert.equal(f.map, "closed");
    assert.deepEqual(f.prompts, []);
  }
  const back = step(offered.state, { cmd: "accept" });
  const after = flow(view(back.state), at({}, back.state.player.nodeId));
  assert.deepEqual([after.devil, after.screen, after.prompts], [false, "fight", ["fight"]], "back on your feet: fight on");
  const dead = flow(view(step(offered.state, { cmd: "refuse" }).state));
  assert.deepEqual([dead.screen, dead.ending], ["ending", "lose"]);
});
