/**
 * The play page's pause menu and title screen, as pure state (docs/play.md, "Pause and quit"). No DOM: play.ts renders
 * from it and pauses the Phaser game while `paused` is set. Tested in pause.test.ts.
 */

export type PauseScreen = "run" | "title";

export interface PauseState {
  /** "title": the title screen (after Quit, or `?title=1`); "run": a run is on screen. */
  screen: PauseScreen;
  /** The pause menu is open (and the scene's Phaser game paused). */
  paused: boolean;
  /** The menu asks "Quit this run?" instead of its buttons. */
  confirmQuit: boolean;
  /** The Controls sub-menu is open (the keyboard and touch lists, with Back). Absent: closed. */
  controls?: boolean;
}

export const RUNNING: PauseState = { screen: "run", paused: false, confirmQuit: false };
export const TITLE: PauseState = { screen: "title", paused: false, confirmQuit: false };

/** First load goes straight into the run, as before; `?title=1` opens on the title screen instead. */
export function startState(search: string): PauseState {
  return new URLSearchParams(search).get("title") === "1" ? TITLE : RUNNING;
}

export type PauseAction = "pause" | "resume" | "quit" | "cancelQuit" | "confirmQuit" | "newGame" | "controls" | "back";

const MENU: PauseState = { screen: "run", paused: true, confirmQuit: false };

/** The next state. Actions that make no sense where you are change nothing (the same object comes back). */
export function pauseStep(s: PauseState, a: PauseAction): PauseState {
  switch (a) {
    case "pause": return s.screen === "run" && !s.paused ? { ...s, paused: true, confirmQuit: false } : s;
    case "resume": return s.paused ? RUNNING : s;
    case "quit": return s.paused && !s.confirmQuit && !s.controls ? { ...s, confirmQuit: true } : s;
    case "controls": return s.paused && !s.confirmQuit && !s.controls ? { ...MENU, controls: true } : s;
    case "back": return s.controls ? MENU : s;
    case "cancelQuit": return s.confirmQuit ? { ...s, confirmQuit: false } : s;
    case "confirmQuit": return s.confirmQuit ? TITLE : s;
    case "newGame": return s.screen === "title" ? RUNNING : s;
  }
}

export interface KeyContext {
  /** The act map: an open map (village) closes on Escape before anything else. */
  map: "closed" | "open" | "forced";
  /** Focus is in a text box (the devil's wish): keys are text, not commands. */
  typing: boolean;
  /** The ending card is up: it has its own Play again, and there is nothing to pause. */
  ending: boolean;
  /** The credits screen is open (over the title, the pause menu or the ending): Escape closes it before anything else. */
  credits?: boolean;
}

/** Can the pause menu open now? On a run, not already paused, not on the ending card. */
export const canPause = (s: PauseState, ending: boolean): boolean => s.screen === "run" && !s.paused && !ending;

/**
 * What a key does, the topmost open layer first: Escape closes the credits, then an open map, then backs out of the quit question, then resumes, else pauses;
 * P pauses or resumes (not while the quit question is asked). Nothing on the title screen or while typing.
 */
export function pauseKey(s: PauseState, key: string, ctx: KeyContext): PauseAction | "closeMap" | "closeCredits" | null {
  if (ctx.typing) return null;
  const esc = key === "Escape", p = key === "p" || key === "P";
  if (ctx.credits) return esc ? "closeCredits" : null; // nothing else under the credits answers a key
  if (s.screen === "title") return null;
  if (!esc && !p) return null;
  if (s.paused) return s.confirmQuit ? (esc ? "cancelQuit" : null) : s.controls && esc ? "back" : "resume";
  if (esc && ctx.map === "open") return "closeMap";
  return canPause(s, ctx.ending) ? "pause" : null;
}

/** The controls the pause menu lists, as they are in the code (play.ts, WorldScene, ForestScene). */
export const CONTROLS: { keyboard: [string, string][]; touch: [string, string][] } = {
  keyboard: [
    ["WASD / arrow keys", "Move"],
    ["Space / left click", "Attack (fights): the way you are moving; standing still, a click aims at the cursor"],
    ["Shift", "Dash (fights)"],
    ["M", "Open or close the map (village)"],
    ["E / Enter", "Buy at a stall"],
    ["Esc / P", "Pause; Esc closes the top layer first (credits, the map, a sub-menu)"],
  ],
  touch: [
    ["Drag", "Move: the stick (anywhere in the village, the left half in a fight)"],
    ["Attack, Dash", "The buttons at the bottom right (fights)"],
    ["Map", "The Map button, top right (village)"],
    ["Buy", "The Buy button at a stall"],
    ["Pause", "The pause button (two bars), top right"],
  ],
};
