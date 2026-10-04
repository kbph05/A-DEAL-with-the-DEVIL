import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROLS, RUNNING, TITLE, canPause, pauseKey, pauseStep, startState, type KeyContext, type PauseState } from "./pause";

const ctx = (p: Partial<KeyContext> = {}): KeyContext => ({ map: "closed", typing: false, ending: false, ...p });
const PAUSED: PauseState = { screen: "run", paused: true, confirmQuit: false };
const ASKING: PauseState = { screen: "run", paused: true, confirmQuit: true };

test("pause: first load goes straight into the run unless ?title=1", () => {
  assert.deepEqual(startState(""), TITLE, "the game opens on the title screen");
  assert.deepEqual(startState("?seed=abc"), RUNNING, "dev links with a seed start the run");
  assert.deepEqual(startState("?seed=abc&god=1"), RUNNING);
  assert.deepEqual(startState("?title=1"), TITLE);
  assert.deepEqual(startState("?title=0"), RUNNING);
});

test("pause: pause, resume, quit (confirmed or not), new game", () => {
  assert.deepEqual(pauseStep(RUNNING, "pause"), PAUSED);
  assert.deepEqual(pauseStep(PAUSED, "resume"), RUNNING);
  assert.deepEqual(pauseStep(PAUSED, "quit"), ASKING);
  assert.deepEqual(pauseStep(ASKING, "cancelQuit"), PAUSED);
  assert.deepEqual(pauseStep(ASKING, "confirmQuit"), TITLE);
  assert.deepEqual(pauseStep(ASKING, "resume"), RUNNING);
  assert.deepEqual(pauseStep(TITLE, "newGame"), RUNNING);
});

test("pause: actions out of place change nothing", () => {
  assert.equal(pauseStep(RUNNING, "resume"), RUNNING);
  assert.equal(pauseStep(RUNNING, "quit"), RUNNING, "quit only from the menu");
  assert.equal(pauseStep(PAUSED, "confirmQuit"), PAUSED, "quitting needs the confirmation");
  assert.equal(pauseStep(PAUSED, "pause"), PAUSED);
  assert.equal(pauseStep(TITLE, "pause"), TITLE);
  assert.equal(pauseStep(RUNNING, "newGame"), RUNNING, "new game only from the title");
});

test("pause: Escape closes an open map first, then pauses; P pauses", () => {
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ map: "open" })), "closeMap");
  assert.equal(pauseKey(RUNNING, "p", ctx({ map: "open" })), "pause");
  assert.equal(pauseKey(RUNNING, "Escape", ctx()), "pause");
  assert.equal(pauseKey(RUNNING, "P", ctx()), "pause");
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ map: "forced" })), "pause", "a forced map can't close, so Escape pauses");
  assert.equal(pauseKey(RUNNING, "x", ctx()), null);
});

test("pause: in the menu, Escape and P resume; in the quit question, Escape backs out and P does nothing", () => {
  assert.equal(pauseKey(PAUSED, "Escape", ctx({ map: "open" })), "resume", "the menu sits over the map: close the menu first");
  assert.equal(pauseKey(PAUSED, "p", ctx()), "resume");
  assert.equal(pauseKey(ASKING, "Escape", ctx()), "cancelQuit");
  assert.equal(pauseKey(ASKING, "p", ctx()), null);
});

test("pause: no keys while typing, on the title screen, or on the ending card", () => {
  assert.equal(pauseKey(RUNNING, "p", ctx({ typing: true })), null);
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ typing: true, map: "open" })), null);
  assert.equal(pauseKey(TITLE, "Escape", ctx()), null);
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ ending: true })), null);
  assert.equal(canPause(RUNNING, true), false);
  assert.equal(canPause(RUNNING, false), true);
  assert.equal(canPause(PAUSED, false), false);
});

test("pause: the controls list covers moving, fighting, the map, buying and pausing, on keyboard and touch", () => {
  const keys = CONTROLS.keyboard.map(([k]) => k).join(" | ");
  for (const k of ["WASD", "arrow", "Space", "click", "Shift", "M", "E / Enter", "Esc / P"]) assert.ok(keys.includes(k), k);
  const touch = CONTROLS.touch.map(([k, v]) => `${k} ${v}`).join(" | ");
  for (const k of ["stick", "Attack", "Dash", "Map", "Buy", "Pause"]) assert.ok(touch.includes(k), k);
});

test("Escape: the topmost open layer first: credits, then the map, then the pause menu, else pause", () => {
  const up = ctx({ credits: true, map: "open" });
  for (const s of [RUNNING, PAUSED, ASKING, TITLE]) assert.equal(pauseKey(s, "Escape", up), "closeCredits", "credits over everything");
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ credits: true, ending: true })), "closeCredits", "credits over the ending card");
  assert.equal(pauseKey(PAUSED, "p", up), null, "under the credits, P does nothing");
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ map: "open" })), "closeMap");
  assert.equal(pauseKey(PAUSED, "Escape", ctx()), "resume");
  assert.equal(pauseKey(RUNNING, "Escape", ctx()), "pause");
  assert.equal(pauseKey(RUNNING, "Escape", ctx({ credits: true, typing: true })), null, "typing still wins");
});

test("pause: the Controls sub-menu opens from the menu; Esc goes back to the menu, Esc again resumes; P resumes", () => {
  const CONTROLS_OPEN = pauseStep(PAUSED, "controls");
  assert.deepEqual(CONTROLS_OPEN, { ...PAUSED, controls: true });
  assert.equal(pauseKey(CONTROLS_OPEN, "Escape", ctx()), "back");
  assert.deepEqual(pauseStep(CONTROLS_OPEN, "back"), PAUSED);
  assert.equal(pauseKey(PAUSED, "Escape", ctx()), "resume");
  assert.equal(pauseKey(CONTROLS_OPEN, "p", ctx()), "resume");
  assert.deepEqual(pauseStep(CONTROLS_OPEN, "resume"), RUNNING);
  assert.equal(pauseKey(CONTROLS_OPEN, "Escape", ctx({ credits: true })), "closeCredits", "credits over the sub-menu");
  // Out of place: not from the quit question, not twice, not while running; Back only from the sub-menu; no quitting from it.
  assert.equal(pauseStep(ASKING, "controls"), ASKING);
  assert.equal(pauseStep(CONTROLS_OPEN, "controls"), CONTROLS_OPEN);
  assert.equal(pauseStep(RUNNING, "controls"), RUNNING);
  assert.equal(pauseStep(PAUSED, "back"), PAUSED);
  assert.equal(pauseStep(CONTROLS_OPEN, "quit"), CONTROLS_OPEN);
});
