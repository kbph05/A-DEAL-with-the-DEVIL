/**
 * Placeholder art: black-and-white textures with a label, used until the team's own textures exist. Nothing here
 * is coloured. Normal = white fill, black border and text; `invert` = black fill, white border and text (for
 * things that must stand out from the background: the player, enemies). The layout maths (`fitLabel`) is pure
 * and tested in node; the drawing needs a canvas, so it only runs in the browser.
 */
import type Phaser from "phaser";

export interface PlaceholderOpts {
  /** Black fill with white text instead of white with black. */
  invert?: boolean;
  /** Draw an ellipse filling the box instead of a rectangle (fight bodies). */
  circle?: boolean;
  /** Canvas pixels per logical pixel (default 1). Use more for sprites that are drawn at their logical size on a
   * large canvas; keep 1 for sheets, whose frames must stay `cellW × cellH`. */
  res?: number;
}

export const BORDER_PX = 1;
export const MIN_FONT_PX = 6;
export const MAX_FONT_PX = 14;
/** Width of a bold monospace glyph, as a fraction of the font size (a little generous). */
const GLYPH_W = 0.62;
const LINE_H = 1.15;

export interface FittedLabel { text: string; fontPx: number }

/**
 * The biggest font (logical px, between MIN_FONT_PX and MAX_FONT_PX) at which `label` fits in a `w × h` box inside
 * its border; if it still does not fit at the minimum, the text is cut short with an ellipsis.
 */
export function fitLabel(label: string, w: number, h: number, circle = false): FittedLabel {
  const room = Math.max(1, (circle ? w * 0.9 : w) - 2 * (BORDER_PX + 1));
  const lines = label.split("\n");
  const chars = Math.max(1, ...lines.map((l) => [...l].length));
  const tall = Math.max(MIN_FONT_PX, Math.floor((h - 2 * (BORDER_PX + 1)) / (lines.length * LINE_H)));
  const cap = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.floor(h * 0.45), tall));
  const fit = Math.floor(room / (chars * GLYPH_W));
  if (fit >= MIN_FONT_PX) return { text: label, fontPx: Math.min(cap, fit) };
  const keep = Math.max(1, Math.floor(room / (MIN_FONT_PX * GLYPH_W)) - 1);
  const cut = lines.map((l) => ([...l].length > keep + 1 ? `${[...l].slice(0, keep).join("")}…` : l));
  return { text: cut.join("\n"), fontPx: MIN_FONT_PX };
}

/** Draw one placeholder cell with its top-left corner at (x, y), all sizes in canvas pixels already scaled by `res`. */
export function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, o: PlaceholderOpts = {}): void {
  const res = o.res ?? 1;
  const [bg, fg] = o.invert ? ["#000", "#fff"] : ["#fff", "#000"];
  const b = BORDER_PX * res;
  ctx.fillStyle = fg;
  if (o.circle) {
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - b, h / 2 - b, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(x + b, y + b, w - 2 * b, h - 2 * b);
  }
  const f = fitLabel(label, w / res, h / res, o.circle);
  ctx.fillStyle = fg;
  ctx.font = `bold ${f.fontPx * res}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = f.text.split("\n");
  const step = f.fontPx * res * LINE_H;
  lines.forEach((line, i) => ctx.fillText(line, Math.round(x + w / 2), Math.round(y + h / 2 + (i - (lines.length - 1) / 2) * step + res * 0.5)));
}

/** Make a `w × h` (logical px) labelled texture under `key`, unless it already exists. */
export function placeholderTexture(scene: Phaser.Scene, key: string, w: number, h: number, label: string, o: PlaceholderOpts = {}): void {
  if (scene.textures.exists(key)) return;
  const res = o.res ?? 1;
  const tex = scene.textures.createCanvas(key, w * res, h * res)!;
  drawPlaceholder(tex.getContext(), 0, 0, w * res, h * res, label, o);
  tex.refresh();
}

/**
 * A sheet of `labels.length` cells, `cols` per row, each `cellW × cellH`, under `key`; frame i (a number) is cell i,
 * the order Phaser tilemaps and `generateFrameNumbers` expect. `style(i)` picks per-cell options.
 */
export function placeholderSheet(scene: Phaser.Scene, key: string, cellW: number, cellH: number, cols: number, labels: readonly string[], style: (i: number) => PlaceholderOpts = () => ({})): void {
  if (scene.textures.exists(key)) return;
  const rows = Math.ceil(labels.length / cols);
  const tex = scene.textures.createCanvas(key, cellW * cols, cellH * rows)!;
  const ctx = tex.getContext();
  labels.forEach((label, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    drawPlaceholder(ctx, x, y, cellW, cellH, label, style(i));
    tex.add(i, 0, x, y, cellW, cellH);
  });
  tex.refresh();
}
