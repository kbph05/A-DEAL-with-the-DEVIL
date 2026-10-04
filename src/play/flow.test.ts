import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, legalActions, step, view, type Command, type GameState } from "../game";
import { mulberry32 } from "../map/rng";
import { CLOSE_DEVIL, LOCAL, OPEN_DEVIL, arrived, flow, setLocal, type FlowView, type Local } from "./flow";

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
