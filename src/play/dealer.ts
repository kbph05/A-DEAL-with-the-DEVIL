/**
 * The devil as a casino dealer, behind his table, at the top of his overlay (kbph, 4 Oct: "a devil png (which will look
 * like a shadow character, dark and mysterious) should be taking up some of the scene, sitting like a dealer at a
 * casino"). Decorative: aria-hidden, never focusable.
 *
 * Placeholder: a pixel-art shadow figure painted in code on a 160×120 canvas (scaled up, pixelated): a near-black
 * silhouette with a soft red edge glow, a hint of horns, two glowing eyes that blink, shoulders that breathe, forearms
 * resting on a green-felt table with a dark-wood edge, two cards and a contract in front of him.
 * Real art: `public/assets/private/devil/dealer.png` (or the encrypted asset of that name) replaces it when present
 * (docs/play.md, "The devil's dealer"). The pose math is pure and tested (dealer.test.ts).
 */
import { privateFiles, privateUrl } from "../world/assets";

/** The private file that replaces the placeholder. */
export const DEALER_FILE = "devil/dealer.png";
/** Placeholder canvas size (art pixels) and where the table's top edge sits. */
export const DEALER_W = 160, DEALER_H = 120, TABLE_Y = 84;
/** Breathing period and blink timing (ms). */
/** Table colours, shared with play.css (.play-dealer and .play-devil backgrounds). */
export const FELT = "#0e2a1a", RIM = "#3a1d0d";
export const BREATH_MS = 3200, BLINK_EVERY_MS = 4100, BLINK_MS = 150;

/** What to show: the private PNG when it was found at startup, else the painted placeholder. */
export function dealerSource(files: readonly string[], url: (f: string) => string = privateUrl): { kind: "private"; url: string } | { kind: "placeholder" } {
  return files.includes(DEALER_FILE) ? { kind: "private", url: url(DEALER_FILE) } : { kind: "placeholder" };
}

/** The idle pose at time `t` (ms): head and shoulders lifted a pixel on the in-breath; eyes shut briefly every few seconds. */
export function dealerPose(t: number): { lift: 0 | 1; eyesOpen: boolean; glow: number } {
  const phase = (((t % BREATH_MS) + BREATH_MS) % BREATH_MS) / BREATH_MS;
  return {
    lift: Math.sin(phase * 2 * Math.PI) > 0.2 ? 1 : 0,
    eyesOpen: ((t % BLINK_EVERY_MS) + BLINK_EVERY_MS) % BLINK_EVERY_MS >= BLINK_MS,
    glow: 0.8 + 0.2 * Math.sin(phase * 4 * Math.PI),
  };
}

/** Paint one frame of the placeholder at time `t`. */
export function paintDealer(g: CanvasRenderingContext2D, t: number): void {
  const { lift, eyesOpen, glow } = dealerPose(t);
  const px = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  g.clearRect(0, 0, DEALER_W, DEALER_H);
  const cx = 80, up = -lift;

  // Rows of the silhouette (head, horns, neck, shoulders and torso), as [y, x0, x1] spans; `grow` widens it for the glow.
  const spans = (grow: number): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    for (let y = 8; y < TABLE_Y + 2; y++) {
      const yy = y - up;
      let half = -1;
      const hy = (yy - 38) / 17; // head: an ellipse 14 wide, 17 tall, centred at y 38
      if (Math.abs(hy) <= 1) half = Math.max(half, 13 * Math.sqrt(1 - hy * hy));
      if (yy >= 50 && yy <= 60) half = Math.max(half, 6); // neck
      const ty = (yy - 98) / 42; // shoulders and torso: the top of an ellipse centred below the table
      if (yy >= 56 && Math.abs(ty) <= 1) half = Math.max(half, 44 * Math.sqrt(1 - ty * ty));
      if (half >= 0) out.push([y, Math.round(cx - half - grow), Math.round(cx + half + grow)]);
      for (const side of [-1, 1]) { // horns: short, curving out and up from the brow
        if (yy >= 14 && yy <= 27) { // k: 0 at the base (inside the head), 1 at the tip: out first, then up
          const k = (27 - yy) / 13, x = cx + side * (7 + 9 * Math.sqrt(k)), w = 2.5 * (1 - k) + 0.5 + grow;
          out.push([y, Math.round(x - w), Math.round(x + w)]);
        }
      }
    }
    return out;
  };
  const fill = (s: Array<[number, number, number]>, c: string) => { g.fillStyle = c; for (const [y, a, b] of s) g.fillRect(a, y, b - a + 1, 1); };

  // The table: its far rim (dark wood), then felt to the bottom. The overlay's CSS continues both across the screen
  // and down to the near edge (FELT and RIM must match play.css).
  px(0, TABLE_Y, DEALER_W, 2, RIM);
  px(0, TABLE_Y + 2, DEALER_W, DEALER_H - TABLE_Y - 2, FELT);
  for (let i = 0; i < 90; i++) { // felt grain: a fixed dither
    const x = (i * 53) % DEALER_W, y = TABLE_Y + 3 + ((i * 29) % (DEALER_H - TABLE_Y - 4));
    px(x, y, 1, 1, "rgba(120, 200, 140, 0.07)");
  }

  // The figure: two passes of red glow, then the near-black silhouette.
  fill(spans(3), `rgba(140, 20, 30, ${0.10 * glow})`);
  fill(spans(1), `rgba(170, 30, 40, ${0.22 * glow})`);
  fill(spans(0), "#0a0507");

  // Forearms resting on the felt, hands together near the middle (they don't breathe).
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 34 : 94;
    px(x0, TABLE_Y, 32, 7, "#0c0608");
    px(side < 0 ? 64 : 88, TABLE_Y + 1, 8, 6, "#100809"); // hands
  }

  // Cards and a contract in front of him.
  const card = (x: number, y: number) => { px(x, y, 8, 11, "#d9cfb6"); px(x, y, 8, 1, "#f2ead6"); px(x + 3, y + 4, 2, 3, "#9a1c1c"); };
  card(70, TABLE_Y + 9); card(79, TABLE_Y + 10);
  px(98, TABLE_Y + 8, 22, 13, "#b49c70");
  for (let r = 0; r < 4; r++) px(101, TABLE_Y + 11 + r * 2, r === 3 ? 9 : 16, 1, "#7a6444");
  px(114, TABLE_Y + 17, 3, 3, "#a01818");

  // Eyes: narrow slanted embers with a soft glow around them, or a thin dim line mid-blink.
  const ey = 37 + up;
  for (const side of [-1, 1]) {
    const ex = cx + side * 5;
    if (eyesOpen) {
      const slit: Array<[number, number]> = [[ex - 1, ey + (side < 0 ? 0 : -1)], [ex, ey], [ex + 1, ey + (side < 0 ? -1 : 0)]];
      for (const [x, y] of slit) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) px(x + dx, y + dy, 1, 1, `rgba(255, 90, 30, ${0.16 * glow})`);
      for (const [x, y] of slit) px(x, y, 1, 1, x === ex ? "#fff0b0" : `rgba(255, 170, 70, ${glow})`);
    } else px(ex - 1, ey, 3, 1, "rgba(255, 110, 50, 0.3)");
  }
}

/** Mount the dealer as the first child of `parent`. Animates only while running (`start`/`stop`). */
export function mountDealer(parent: HTMLElement): { el: HTMLElement; start(): void; stop(): void } {
  const el = document.createElement("div");
  el.className = "play-dealer";
  el.setAttribute("aria-hidden", "true");
  parent.prepend(el);
  const src = dealerSource(privateFiles());
  let raf = 0;
  const canvas = document.createElement("canvas");
  canvas.width = DEALER_W; canvas.height = DEALER_H;
  const g = canvas.getContext("2d");
  const placeholder = () => { el.replaceChildren(canvas); };
  if (src.kind === "private") {
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = placeholder;
    img.src = src.url;
    el.replaceChildren(img);
  } else placeholder();
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const frame = (t: number) => { if (g && canvas.isConnected) paintDealer(g, still ? BLINK_MS : t); raf = still ? 0 : requestAnimationFrame(frame); };
  return {
    el,
    start() { if (!raf) raf = requestAnimationFrame(frame); else if (still && g) paintDealer(g, BLINK_MS); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
