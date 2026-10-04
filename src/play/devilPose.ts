/**
 * Which of the designer's devil poses (assets/devil_*.png, Big Chungus, 4 Oct) the overlay shows: one pure function
 * of the overlay's state and the clock, tested in devilPose.test.ts. play.ts feeds it and cross-fades the pictures;
 * docs/play.md, "The devil's portrait". No DOM, no asset imports (node runs the tests).
 */

export type DevilPose = "normal" | "lean_in" | "head_tilt" | "laugh" | "left" | "right" | "lean_left";

export const DEVIL_POSES: readonly DevilPose[] = ["normal", "lean_in", "head_tilt", "laugh", "left", "right", "lean_left"];

/** The idle shifts, in turn: he glances left, then right, then leans aside, and back to normal after each. */
export const IDLE_SHIFTS: readonly DevilPose[] = ["left", "right", "lean_left"];

/** Timings, milliseconds. */
export const POSE_MS = {
  /** He leans in for this long when an offer lands (the opening offer too), then settles. */
  leanIn: 2200,
  /** A laugh: an accepted deal, a strike, or scorn at gibberish, off-topic text or a jailbreak. */
  laugh: 1600,
  /** Idle: each cycle holds normal, then a shift for `shift`; cycles last `cycleMin` to `cycleMin + cycleSpread`. */
  cycleMin: 4000,
  cycleSpread: 3000,
  shift: 1300,
  /** The cross-fade between poses (play.css uses the same). */
  fade: 200,
} as const;

export interface DevilOverlayState {
  /** The clock, ms (any origin; only differences matter). */
  now: number;
  /** When the overlay last opened, or the player last stopped typing: idle cycling counts from the latest of these. */
  since: number;
  /** The player is typing or haggling: the wish box has text, or the player is working in it. */
  typing: boolean;
  /** When the offer on the table arrived, or null with none. */
  offerAt: number | null;
  /** He laughs until then (0: no laugh). */
  laughUntil: number;
  /** prefers-reduced-motion: no idle cycling (and play.ts swaps instantly). */
  reducedMotion: boolean;
}

/** Cycle `k`'s length: 4 to 7 s, varied but deterministic (a small integer hash), so the shifts don't tick like a clock. */
export function idleCycleMs(k: number): number {
  let h = (k + 1) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  return POSE_MS.cycleMin + (h % (POSE_MS.cycleSpread + 1));
}

/** Idle for `t` ms: normal, then the cycle's shift for the last `shift` ms of each cycle. */
export function idlePose(t: number): DevilPose {
  if (!(t >= 0)) return "normal";
  for (let k = 0; ; k++) {
    const len = idleCycleMs(k);
    if (t < len) return t >= len - POSE_MS.shift ? IDLE_SHIFTS[k % IDLE_SHIFTS.length] : "normal";
    t -= len;
  }
}

/**
 * The pose now. Priority: laugh > head tilt (typing or haggling) > lean in (an offer just landed) > the idle cycle.
 * Idle counts from the latest of `since`, the end of the lean-in and the end of the laugh, so a shift never follows
 * straight on from another pose.
 */
export function devilPose(s: DevilOverlayState): DevilPose {
  if (s.now < s.laughUntil) return "laugh";
  if (s.typing) return "head_tilt";
  const leanEnd = s.offerAt === null ? -Infinity : s.offerAt + POSE_MS.leanIn;
  if (s.now < leanEnd) return "lean_in";
  if (s.reducedMotion) return "normal";
  return idlePose(s.now - Math.max(s.since, leanEnd, s.laughUntil));
}
