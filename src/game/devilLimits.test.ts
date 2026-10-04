import { test } from "node:test";
import assert from "node:assert/strict";
import { legalActions } from "./actions";
import { sanitizeDeal } from "./deal";
import { StubDevil, isGibberish, type DevilContext } from "./devil";
import { MAX_DEVIL_QUERIES, initialState, questionsLeft, type GameState } from "./gameState";
import { createGame, restoreGame } from "./run";
import { newPlayer } from "./state";
import { step } from "./state-machine";
import { observation, view } from "./view";

const onDeal = (seed: string): GameState => { const s = initialState(seed); s.acts[0].nodes[0].kind = "deal"; return s; };

test("MAX_DEVIL_QUERIES is 10 and questionsLeft counts down from it", () => {
  assert.equal(MAX_DEVIL_QUERIES, 10);
  const s = onDeal("q");
  assert.equal(questionsLeft(s), 10);
  assert.equal(observation(s).questionsLeft, 10);
  assert.equal(view({ ...s, totalAsks: 4 }).questionsLeft, 6);
  assert.equal(questionsLeft({ totalAsks: 99 }), 0, "never negative");
});

test("the devil's context says how many questions are left after this one", () => {
  const s = onDeal("q");
  const r = step(s, { cmd: "deal", text: "gold" });
  assert.equal(r.awaiting!.devil!.context.askIndex, 1);
  assert.equal(r.awaiting!.devil!.context.questionsLeft, MAX_DEVIL_QUERIES - 1);
});

test("run-wide cap: the 11th deal is not legal and is rejected with the reason; an offer on the table can still be decided", async () => {
  const g = restoreGame({ ...onDeal("cap"), totalAsks: MAX_DEVIL_QUERIES - 1 });
  assert.ok(g.view().actions.some((c) => c.cmd === "deal"));
  const last = await g.deal("gold");
  assert.ok(last.ok);
  const v = g.view();
  assert.equal(v.questionsLeft, 0);
  assert.equal(v.asksLeft, 2, "the per-node haggle budget is separate");
  assert.ok(v.offer, "the last answer is on the table");
  assert.ok(!v.actions.some((c) => c.cmd === "deal"), "deal is no longer a legal action");
  assert.ok(v.actions.some((c) => c.cmd === "accept") && v.actions.some((c) => c.cmd === "refuse"));
  const r = await g.deal("more?");
  assert.equal(r.ok, false);
  assert.deepEqual(r.events, [{ type: "rejected", reason: "The devil has heard enough from you this run." }]);
  assert.equal(g.gameState.totalAsks, MAX_DEVIL_QUERIES, "a rejected ask does not count");
  assert.ok(g.accept().ok, "the standing offer can still be accepted");
});

test("run-wide cap carries over to later deal nodes", () => {
  const s = { ...onDeal("cap2"), totalAsks: MAX_DEVIL_QUERIES };
  assert.equal(step(s, { cmd: "deal", text: "gold" }).ok, false);
  // his opening offer is free, so it still comes; after it, nothing more
  assert.ok(legalActions(s).some((c) => c.cmd === "deal"));
  const opened = step(step(s, { cmd: "deal" }).state, { cmd: "devil_reply", deal: { dialogue: "Sign.", effects: { gold: 5 } } }).state;
  assert.equal(opened.totalAsks, MAX_DEVIL_QUERIES);
  assert.ok(!legalActions(opened).some((c) => c.cmd === "deal"));
  assert.ok(createGame("fresh").view().questionsLeft === MAX_DEVIL_QUERIES, "a new run starts with all of them");
});

// ---- gibberish ----

test("isGibberish: flags mashed keys and noise", () => {
  for (const t of [
    "laksjdhflkajshdg9", "laksjdhflkajshdg", "asdfghjkl", "asdf", "qwertyuiop", "qwerty", "zxcvbnm", "hjkl", "kjhkjhkjh", "sdfsdfsdf",
    "ajshdgfjhas", "kalsdjfalksdj", "asdfjkl", "xkcdqzpwvbn", "aaaaaaaaaaaa", "ababababab", "abcabcabc", "a1b2c3d4e5", "asdf asdf",
    "!!!@@@###$$$", "!@#$%^&*()", "?????", "ASDFGHJKL", "lkjsdf lkjsdf lkjsdf", "gold asdfjkl", "ñandú qwertyuiop",
  ]) assert.ok(isGibberish(t), `should be gibberish: ${t}`);
});

test("isGibberish: leaves real wishes alone", () => {
  for (const t of [
    "", "   ", "gold", "heal me", "make me rich", "I read the fine print", "I'd like some gold, and no strings", "a sharper sword, and I'm not afraid of a curse",
    "the road ahead", "my soul", "blood", "give me strength", "strengths", "twelfths", "rhythm", "hmm", "psst", "shh", "pfft", "lol", "wtf", "ok", "a", "I", "no",
    "NOOOOOO", "please please please", "I want 1000 gold", "1000", "12345678", "donne-moi de l'or", "je veux être riche", "金をくれ", "дай мне золота", "🙏", "💰💰💰💰💰💰",
    "what is the airspeed velocity of an unladen swallow", "pneumonoultramicroscopicsilicovolcanoconiosis", "Knightsbridge", "...", "what?!", "r2d2 and c3po", "3rd floor",
    "I read the contract", "loophole", "mississippi", "blah blah blah",
  ]) assert.ok(!isGibberish(t), `should NOT be gibberish: ${JSON.stringify(t)}`);
  assert.ok(!isGibberish(undefined) && !isGibberish(null) && !isGibberish(42 as unknown as string));
});

const ctx: DevilContext = { seed: "g", act: 0, nodeId: "a0n1", askIndex: 1, questionsLeft: 5, curses: [], rewritable: [{ id: "a0n2", kind: "fight" }] };

test("StubDevil: gibberish makes him angry; his offers are punitive with the curse always attached (fine print can't strike it)", async () => {
  const devil = new StubDevil("g"), p = newPlayer("a0n1");
  const lines = new Set<string>();
  let offers = 0;
  for (let i = 1; i <= 80; i++) {
    const c = { ...ctx, askIndex: i };
    const d = await devil.offer(p, c, "laksjdhflkajshdg9");
    assert.deepEqual(sanitizeDeal(d), d, "valid Deal");
    assert.equal(d.rewrite, undefined);
    assert.ok(!/fine print|struck/i.test(d.dialogue));
    assert.ok(!/\b(god|hell|heaven|pray|sin|bless|holy|amen|lord)\b/i.test(d.dialogue), "no religious references");
    lines.add(d.dialogue);
    // Pure: same request, same reply.
    assert.deepEqual(await new StubDevil("other").offer(p, c, "laksjdhflkajshdg9"), d);
    if (d.forced) continue; // strikes are covered in devilStrike.test.ts
    offers++;
    assert.ok(d.curse, "a curse always comes with it");
    // Worse than usual: the price is always paid in stats the player wants.
    const costs = { ...d.effects, ...d.curse!.effect };
    assert.ok(Object.entries(costs).some(([k, v]) => k !== "gold" && v < 0), "it costs something real");
    // Gibberish plus the fine-print words does not strike the curse.
    assert.ok((await devil.offer(p, c, "contract asdfjkl asdfjkl asdfjkl")).curse || (await devil.offer(p, c, "contract asdfjkl asdfjkl asdfjkl")).forced);
  }
  assert.ok(offers > 10, "he still makes offers about half the time");
  assert.ok(lines.size >= 8, "several seeded variants");
  // The same ask with a normal wish is unchanged by all this.
  const normal = await devil.offer(p, ctx, "gold");
  assert.ok(!(await devil.offer(p, ctx, "asdfghjkl")).dialogue.includes(normal.dialogue.slice(0, 20)));
});

test("StubDevil: hp-costing spite is not offered to the nearly dead", async () => {
  const devil = new StubDevil("g"), p = newPlayer("a0n1");
  p.hp = 5;
  for (let i = 1; i <= 60; i++) {
    const d = await devil.offer(p, { ...ctx, askIndex: i }, "kjhkjhkjh");
    if (!d.forced) assert.ok((d.effects.hp ?? 0) >= 0); // a strike is not an offer: it may hurt anyone
  }
});

test("StubDevil: taunts about the question limit near the end, and only then", async () => {
  const devil = new StubDevil("g"), p = newPlayer("a0n1");
  assert.match((await devil.offer(p, { ...ctx, questionsLeft: 0 }, "gold")).dialogue, /last question/);
  assert.match((await devil.offer(p, { ...ctx, questionsLeft: 1 }, "gold")).dialogue, /one question left/);
  assert.doesNotMatch((await devil.offer(p, { ...ctx, questionsLeft: 5 }, "gold")).dialogue, /question/);
});
