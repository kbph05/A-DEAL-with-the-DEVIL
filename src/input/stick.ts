/**
 * The hand-written floating touch joystick (no rexrainbow dependency), shared by the fight and the world scene.
 * It re-centres where the thumb lands (kept on screen), follows that one pointer, and springs back home on release.
 * Coordinates are canvas (game) pixels, i.e. Phaser's `pointer.x/y`, not world coordinates. No Phaser at runtime:
 * the scene feeds it pointer events and passes its Graphics to `draw`.
 */
import type Phaser from "phaser";
import { clampStick, stickDir, type Vec } from "./dir";

export interface StickCircle { x: number; y: number; r: number }
export interface StickPointer { id: number; x: number; y: number }

export class FloatingStick {
  /** The pointer holding the stick, or null. */
  ptr: number | null = null;
  base: Vec;
  knob: Vec = { x: 0, y: 0 };
  home: StickCircle;
  /** Canvas size, to keep the floating base on screen. */
  bounds: { width: number; height: number };

  constructor(home: StickCircle, bounds: { width: number; height: number }) {
    this.home = home;
    this.bounds = bounds;
    this.base = { x: home.x, y: home.y };
  }

  get active(): boolean { return this.ptr !== null; }

  /** Take hold of the stick with a new touch at `p` (the caller decides where touches may grab it). */
  grab(p: StickPointer): boolean {
    if (this.ptr !== null) return false;
    const r = this.home.r;
    this.base = { x: Math.min(this.bounds.width - r, Math.max(r, p.x)), y: Math.min(this.bounds.height - r, Math.max(r, p.y)) };
    this.knob = clampStick(p.x - this.base.x, p.y - this.base.y, r);
    this.ptr = p.id;
    return true;
  }

  move(p: StickPointer): boolean {
    if (p.id !== this.ptr) return false;
    this.knob = clampStick(p.x - this.base.x, p.y - this.base.y, this.home.r);
    return true;
  }

  release(p: { id: number }): boolean {
    if (p.id !== this.ptr) return false;
    this.ptr = null;
    this.knob = { x: 0, y: 0 };
    this.base = { x: this.home.x, y: this.home.y };
    return true;
  }

  /** 8-way unit direction (zero in the dead zone or when not held). */
  dir(): Vec {
    return this.ptr === null ? { x: 0, y: 0 } : stickDir(this.knob.x, this.knob.y, this.home.r);
  }

  draw(g: Phaser.GameObjects.Graphics): void {
    const r = this.home.r;
    g.fillStyle(0xffffff, 0.08).fillCircle(this.base.x, this.base.y, r).lineStyle(3, 0xffffff, 0.35).strokeCircle(this.base.x, this.base.y, r);
    g.fillStyle(0xffffff, this.ptr !== null ? 0.6 : 0.35).fillCircle(this.base.x + this.knob.x, this.base.y + this.knob.y, r * 0.42);
  }
}
