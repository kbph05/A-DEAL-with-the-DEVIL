/**
 * Drawing helpers for the forest fight, in the arena's style (FightScene.ts has the same bars, buttons and colours;
 * they live here so forest mode doesn't need to change the arena scene).
 */
import type Phaser from "phaser";
import type { Circle } from "./logic";

export const COL = {
  player: 0x6fb7ff, telegraph: 0xffe066, recover: 0x4a3434, bullet: 0xff7ad9, arrow: 0xe8e2d0,
  hpBack: 0x2a1a1a, hpPlayer: 0x4cc36a, hpEnemy: 0xd8443c, text: "#eeeeee", dim: "#a99",
};

/** An HP (or cooldown) bar: dark back, coloured fill, thin black outline. */
export function bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, color: number, outline = 1): void {
  g.fillStyle(COL.hpBack).fillRect(x, y, w, h);
  g.fillStyle(color).fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  g.lineStyle(outline, 0x000000, 0.8).strokeRect(x, y, w, h);
}

/** A round touch button; `ready` (0..1) fills a cooldown pie. */
export function button(g: Phaser.GameObjects.Graphics, c: Circle, alpha: number, ready: number): void {
  g.fillStyle(0xffffff, alpha).fillCircle(c.x, c.y, c.r);
  if (ready < 1) g.fillStyle(0x000000, 0.45).slice(c.x, c.y, c.r, -Math.PI / 2 + ready * Math.PI * 2, -Math.PI / 2 + Math.PI * 2, false).fillPath();
  g.lineStyle(3, 0xffffff, 0.6).strokeCircle(c.x, c.y, c.r);
}

export function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return mix(16) | mix(8) | mix(0);
}

export function inCircle(p: { x: number; y: number }, c: Circle, scale = 1): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r * scale;
}
