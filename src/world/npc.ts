/**
 * Vendor NPCs (kbph, 4 Oct: "put vendors at the stores so they're not empty"): a small figure behind each shop's
 * window in the village. Pure (no Phaser, no canvas), tested in node (npc.test.ts):
 * - which kinds there are, and their generated art as a list of rects (`npcRects`, drawn by scenePlaceholders.ts);
 * - how the figure is cropped behind the counter (`counterRows`) and how it idles and hops (`npcOffset`).
 * Art override: assets/npc/<kind>.png, bundled by Vite (npcArt.ts, docs/world.md).
 */

import { PIXEL_SCALE } from "../render/pixelScale";

export const NPC_KINDS = ["healer", "smith"] as const;
export type NpcKind = (typeof NPC_KINDS)[number];
export const isNpcKind = (v: unknown): v is NpcKind => typeof v === "string" && (NPC_KINDS as readonly string[]).includes(v);

/** The generated figure's size, source pixels. */
export const NPC_SIZE = { w: 16, h: 24 };
/**
 * World pixels per source pixel for the vendors: the global PIXEL_SCALE (src/render/pixelScale.ts), the backgrounds' scale.
 */
export const NPC_SCALE = PIXEL_SCALE;

export interface NpcRect { x: number; y: number; w: number; h: number; c: string }

const SKIN = "#f1c27d", SKIN_SHADE = "#d9a35f", EYE = "#1a1010";

/** A vendor's generated art: rects in a 16×24 box, drawn in order. Pure. */
export function npcRects(kind: NpcKind): NpcRect[] {
  const r = (x: number, y: number, w: number, h: number, c: string): NpcRect => ({ x, y, w, h, c });
  if (kind === "healer") {
    const robe = "#efe6cf", shade = "#cfc3a3", edge = "#a89a78", red = "#c0302f";
    return [
      r(3, 12, 10, 12, robe), r(2, 16, 12, 8, robe), // robe, flaring
      r(11, 12, 2, 12, shade), r(2, 21, 12, 3, shade), // shaded right side and hem
      r(7, 14, 1, 10, shade), // fold
      r(2, 11, 2, 6, robe), r(12, 11, 2, 6, robe), r(12, 11, 2, 6, shade), // sleeves
      r(2, 17, 2, 2, SKIN), r(12, 17, 2, 2, SKIN), // hands
      r(4, 1, 8, 10, robe), r(4, 1, 8, 1, edge), r(3, 2, 1, 9, edge), r(12, 2, 1, 9, edge), // hood
      r(5, 3, 6, 6, SKIN), r(5, 8, 6, 1, SKIN_SHADE), // face
      r(6, 5, 1, 1, EYE), r(9, 5, 1, 1, EYE),
      r(7, 10, 2, 5, red), r(5, 12, 6, 2, red), // the red cross on the chest
    ];
  }
  const shirt = "#3a3f4a", shirtLight = "#4c5361", apron = "#7a5230", apronDark = "#5b3b22", iron = "#8e949c";
  return [
    r(3, 10, 10, 14, shirt), r(2, 11, 2, 6, shirt), r(12, 11, 2, 6, shirt), r(3, 10, 10, 1, shirtLight), // shirt and sleeves
    r(5, 11, 6, 13, apron), r(5, 11, 1, 13, apronDark), r(10, 11, 1, 13, apronDark), r(6, 16, 4, 1, apronDark), // leather apron
    r(5, 10, 1, 2, apronDark), r(10, 10, 1, 2, apronDark), // straps
    r(2, 17, 2, 2, SKIN), r(12, 15, 2, 2, SKIN), // hands
    r(14, 6, 1, 11, "#8a5a2b"), r(12, 4, 4, 3, iron), r(12, 4, 4, 1, "#c4c9d0"), // hammer: haft and head
    r(5, 3, 6, 6, SKIN), r(5, 8, 6, 1, SKIN_SHADE), // head
    r(4, 1, 8, 3, "#2a1d14"), r(4, 3, 1, 3, "#2a1d14"), r(11, 3, 1, 3, "#2a1d14"), // dark hair
    r(6, 5, 1, 1, EYE), r(9, 5, 1, 1, EYE),
    r(5, 7, 6, 2, "#3b2a1c"), r(6, 6, 4, 1, "#3b2a1c"), // beard
  ];
}

/**
 * Source rows of the figure that show above the counter. The figure stands with its feet at `feetY`, drawn `scale`×; the
 * counter's top edge is at world y `counterY`; the rows below it are hidden. 0 to `rows` (the texture height). Pure.
 */
export function counterRows(feetY: number, counterY: number, rows: number, scale = NPC_SCALE): number {
  const top = feetY - rows * scale;
  return Math.max(0, Math.min(rows, Math.round((counterY - top) / scale)));
}

/** Idle bob period, ms, and how long the figure is up within it. */
export const IDLE_PERIOD = 2400;
export const IDLE_UP = 800;
/** The hop on the player entering the shop zone, ms and height (world px). */
export const HOP_MS = 360;
export const HOP_HEIGHT = 4;

/**
 * The figure's vertical offset (world px, negative is up) at `now` ms. Idle: up one source pixel (`scale` px) for
 * `IDLE_UP` ms every `IDLE_PERIOD`, phase-shifted by `phase` so the two vendors don't move together. A hop started at
 * `hopAt` (or null) is a parabola of `HOP_HEIGHT` over `HOP_MS`, snapped to whole source pixels. `reduced` (the
 * prefers-reduced-motion setting) holds the figure still. Pure.
 */
export function npcOffset(now: number, phase: number, hopAt: number | null, reduced: boolean, scale = NPC_SCALE): number {
  if (reduced) return 0;
  if (hopAt !== null && now >= hopAt && now < hopAt + HOP_MS) {
    const u = (now - hopAt) / HOP_MS;
    return -Math.round((4 * u * (1 - u) * HOP_HEIGHT) / scale) * scale;
  }
  const t = (((now + phase) % IDLE_PERIOD) + IDLE_PERIOD) % IDLE_PERIOD;
  return t < IDLE_UP ? -scale : 0;
}
