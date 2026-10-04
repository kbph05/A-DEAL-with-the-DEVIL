import Phaser from "phaser";
import { FloatingStick } from "../input/stick";
import { ARENA, PLAYER, STEP_MS, moveDir, type Circle, type FightLayout, type FightResult, type Vec } from "./logic";
import { FightSim, type FightControls } from "./sim";
import type { FightInput } from "./logic";

export interface FightSceneConfig {
  input: Required<FightInput>;
  layout: FightLayout;
  /** Show the virtual joystick and buttons from the start (they also appear on the first touch). */
  touch: boolean;
  onEnd: (result: FightResult) => void;
  onDebug?: (sim: FightSim) => void;
}

type KeyName = "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT" | "SPACE" | "SHIFT";

const COL = {
  floor: 0x231515, grid: 0x2c1b1b, wall: 0x6b3a3a, pillar: 0x3b2626, pillarEdge: 0x7a4c4c,
  player: 0x6fb7ff, enemy: 0xa33b3b, boss: 0x7a2bb0, telegraph: 0xffe066, recover: 0x4a3434, bullet: 0xff7ad9,
  hpBack: 0x2a1a1a, hpPlayer: 0x4cc36a, hpEnemy: 0xd8443c, text: "#eeeeee", dim: "#a99",
};

/**
 * The realtime fight: draws a `FightSim` with plain shapes (no textures) and feeds it keyboard, mouse and touch
 * input at a fixed 60 Hz step. All rules live in `sim.ts` / `logic.ts`.
 */
export class FightScene extends Phaser.Scene {
  private cfg: FightSceneConfig;
  private sim!: FightSim;
  private g!: Phaser.GameObjects.Graphics;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private finished = false;
  private touchUI: boolean;
  // Queued presses survive frames that run no sim step (very fast displays).
  private attackQueued = false;
  private dashQueued = false;
  private mouseDown = false;
  private mouseAim: Vec | null = null;
  private stick: FloatingStick;
  private attackPtr: number | null = null;
  private texts!: { hp: Phaser.GameObjects.Text; foe: Phaser.GameObjects.Text; clock: Phaser.GameObjects.Text; help: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text; banner: Phaser.GameObjects.Text; attack: Phaser.GameObjects.Text; dash: Phaser.GameObjects.Text };

  constructor(cfg: FightSceneConfig) {
    super({ key: "fight" });
    this.cfg = cfg;
    this.touchUI = cfg.touch;
    this.stick = new FloatingStick(cfg.layout.stick, cfg.layout);
  }

  create(): void {
    const L = this.cfg.layout;
    this.sim = new FightSim(this.cfg.input);
    this.cfg.onDebug?.(this.sim);
    this.g = this.add.graphics();

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT", true) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.on("keydown-SPACE", () => { this.attackQueued = true; });
    kb.on("keydown-SHIFT", () => { this.dashQueued = true; });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on("gameout", () => { this.mouseDown = false; });

    const font = (size: number, color = COL.text) => ({ fontFamily: "system-ui, sans-serif", fontSize: `${size}px`, color });
    const e = this.sim.enemy;
    this.texts = {
      hp: this.add.text(L.arena.x + 4, 14, "", font(20)).setDepth(2),
      foe: this.add.text(L.arena.x + ARENA - 4, 14, "", font(20)).setOrigin(1, 0).setDepth(2),
      clock: this.add.text(L.arena.x + ARENA - 4, 40, "", font(18, COL.dim)).setOrigin(1, 0).setDepth(2),
      help: this.add.text(L.width / 2, L.arena.y + ARENA + 6, "Move: WASD / arrows   Attack: Space / click   Dash: Shift", font(16, COL.dim)).setOrigin(0.5, 0).setDepth(2),
      name: this.add.text(0, 0, e.name, font(e.boss ? 18 : 14, COL.dim)).setOrigin(0.5, 1).setDepth(2),
      banner: this.add.text(L.arena.x + ARENA / 2, L.arena.y + ARENA / 2, "", { ...font(64), fontStyle: "bold", stroke: "#000", strokeThickness: 8 }).setOrigin(0.5).setDepth(3).setVisible(false),
      attack: this.add.text(L.attackBtn.x, L.attackBtn.y, "Attack", font(24)).setOrigin(0.5).setDepth(2),
      dash: this.add.text(L.dashBtn.x, L.dashBtn.y, "Dash", font(20)).setOrigin(0.5).setDepth(2),
    };
    this.render();
  }

  update(_time: number, delta: number): void {
    if (!this.finished) {
      this.acc = Math.min(this.acc + delta, STEP_MS * 6); // after a stall, catch up at most 0.1 s
      while (this.acc >= STEP_MS && !this.sim.over) {
        this.sim.step(this.controls());
        this.attackQueued = false;
        this.dashQueued = false;
        this.acc -= STEP_MS;
        if (this.sim.fx.includes("hurt")) this.cameras.main.shake(140, 0.008);
        if (this.sim.fx.includes("burst")) this.cameras.main.shake(100, 0.004);
      }
      if (this.sim.over) this.end(this.sim.result!);
    }
    this.render();
  }

  private end(result: FightResult): void {
    this.finished = true;
    this.texts.banner.setText(result.won ? "VICTORY" : "DEFEATED").setColor(result.won ? "#ffe066" : "#ff5a4f").setVisible(true);
    this.time.delayedCall(1100, () => this.cfg.onEnd(result));
  }

  // --- input ------------------------------------------------------------------------------------------------------

  private controls(): FightControls {
    const k = this.keys;
    let move = moveDir({
      up: k.W.isDown || k.UP.isDown, down: k.S.isDown || k.DOWN.isDown,
      left: k.A.isDown || k.LEFT.isDown, right: k.D.isDown || k.RIGHT.isDown,
    });
    if (this.stick.active) {
      const s = this.stick.dir();
      if (s.x !== 0 || s.y !== 0) move = s;
    }
    const mouse = this.mouseDown || (this.attackQueued && this.mouseAim !== null);
    return {
      move,
      attack: this.attackQueued || k.SPACE.isDown || this.mouseDown || this.attackPtr !== null,
      dash: this.dashQueued,
      aim: mouse ? this.mouseAim : null,
    };
  }

  private toArena(p: Phaser.Input.Pointer): Vec {
    return { x: p.x - this.cfg.layout.arena.x, y: p.y - this.cfg.layout.arena.y };
  }

  private pointerDown(p: Phaser.Input.Pointer): void {
    const L = this.cfg.layout;
    if (p.wasTouch) {
      this.touchUI = true;
      if (inCircle(p, L.attackBtn, 1.2)) { this.attackPtr = p.id; this.attackQueued = true; return; }
      if (inCircle(p, L.dashBtn, 1.2)) { this.dashQueued = true; return; }
      // Floating stick: it re-centres where the thumb lands (kept on screen) and springs back on release.
      if (p.x < L.width / 2) this.stick.grab(p);
      return;
    }
    this.mouseAim = this.toArena(p);
    if (p.leftButtonDown()) { this.mouseDown = true; this.attackQueued = true; }
  }

  private pointerMove(p: Phaser.Input.Pointer): void {
    if (this.stick.move(p)) return;
    if (!p.wasTouch) this.mouseAim = this.toArena(p);
  }

  private pointerUp(p: Phaser.Input.Pointer): void {
    this.stick.release(p);
    if (p.id === this.attackPtr) this.attackPtr = null;
    if (!p.wasTouch) this.mouseDown = false;
  }

  // --- drawing ----------------------------------------------------------------------------------------------------

  private render(): void {
    const L = this.cfg.layout;
    const s = this.sim;
    const g = this.g.clear();
    const ox = L.arena.x;
    const oy = L.arena.y;
    const blink = Math.floor(s.timeMs / 80) % 2 === 0;

    // Room.
    g.fillStyle(COL.floor).fillRect(ox, oy, ARENA, ARENA);
    g.lineStyle(1, COL.grid);
    for (let i = 48; i < ARENA; i += 48) { g.lineBetween(ox + i, oy, ox + i, oy + ARENA); g.lineBetween(ox, oy + i, ox + ARENA, oy + i); }
    g.lineStyle(8, COL.wall).strokeRect(ox - 4, oy - 4, ARENA + 8, ARENA + 8);
    for (const r of s.obstacles) g.fillStyle(COL.pillar).fillRect(ox + r.x, oy + r.y, r.w, r.h).lineStyle(3, COL.pillarEdge).strokeRect(ox + r.x, oy + r.y, r.w, r.h);

    // Enemy.
    const e = s.enemy;
    const ex = ox + e.pos.x;
    const ey = oy + e.pos.y;
    const base = e.boss ? COL.boss : COL.enemy;
    let color = base;
    let scale = 1;
    const b = e.brain;
    if (b.mode === "windup") {
      const k = Math.min(1, b.modeMs / e.params.windupMs);
      color = lerpColor(base, COL.telegraph, k);
      scale = 1 + 0.3 * k;
      // Where the lunge will go: a fading lane, solid once the aim locks.
      const reach = (e.params.lungeSpeed * e.params.lungeMs) / 1000 + e.radius;
      const locked = b.modeMs >= e.params.windupMs / 2;
      g.lineStyle(e.radius * 1.6, COL.telegraph, locked ? 0.28 : 0.12).lineBetween(ex, ey, ex + e.aim.x * reach, ey + e.aim.y * reach);
    } else if (b.mode === "lunge") {
      color = COL.telegraph;
      scale = 1.1;
    } else if (b.mode === "recover") {
      color = lerpColor(COL.recover, base, Math.min(1, b.modeMs / e.params.recoverMs));
    } else if (b.mode === "burstWindup") {
      const k = Math.min(1, b.modeMs / e.params.burstWindupMs);
      color = lerpColor(base, COL.bullet, k);
      g.lineStyle(4, COL.bullet, 0.3 + 0.5 * k).strokeCircle(ex, ey, e.radius * (1 + 1.4 * k));
    }
    if (e.hurtMs > 0) color = 0xffffff;
    const er = e.radius * scale;
    g.fillStyle(color).fillCircle(ex, ey, er);
    g.lineStyle(3, 0x000000, 0.6).strokeCircle(ex, ey, er);
    if (b.mode === "windup" && b.modeMs >= e.params.windupMs / 2 && blink) g.lineStyle(4, 0xffffff).strokeCircle(ex, ey, er + 4);
    // Eyes look at the player.
    const look = unit({ x: s.player.pos.x - e.pos.x, y: s.player.pos.y - e.pos.y });
    const side = { x: -look.y, y: look.x };
    for (const sgn of [-1, 1]) g.fillStyle(0x110808).fillCircle(ex + look.x * er * 0.45 + side.x * er * 0.3 * sgn, ey + look.y * er * 0.45 + side.y * er * 0.3 * sgn, Math.max(3, er * 0.14));
    if (b.mode === "recover") g.lineStyle(2, 0xffffff, 0.5).strokeEllipse(ex, ey - er - 6, er * 1.1, 8);
    // Enemy HP bar.
    const bw = e.boss ? 120 : 60;
    bar(g, ex - bw / 2, ey - er - 18, bw, 8, e.hp / e.maxHp, COL.hpEnemy);
    this.texts.name.setPosition(ex, ey - er - 22);

    // Boss bullets.
    for (const bl of s.bullets) g.fillStyle(COL.bullet).fillCircle(ox + bl.pos.x, oy + bl.pos.y, bl.radius).fillStyle(0xffffff).fillCircle(ox + bl.pos.x, oy + bl.pos.y, bl.radius * 0.45);

    // Player.
    const p = s.player;
    const px = ox + p.pos.x;
    const py = oy + p.pos.y;
    if (p.swingMs > 0) {
      const a = Math.atan2(p.swingDir.y, p.swingDir.x);
      const k = p.swingMs / PLAYER.swingMs;
      g.fillStyle(0xffffff, 0.35 * k).slice(px, py, p.radius + PLAYER.swingRange, a - PLAYER.swingHalfAngle, a + PLAYER.swingHalfAngle, false).fillPath();
      g.lineStyle(4, 0xffffff, 0.8 * k).beginPath().arc(px, py, p.radius + PLAYER.swingRange, a - PLAYER.swingHalfAngle, a + PLAYER.swingHalfAngle, false).strokePath();
    }
    if (p.dashMs > 0) for (let i = 1; i <= 3; i++) g.fillStyle(COL.player, 0.18).fillCircle(px - p.dashDir.x * i * 14, py - p.dashDir.y * i * 14, p.radius);
    const alpha = p.iframesMs > 0 && blink ? 0.35 : 1;
    g.fillStyle(COL.player, alpha).fillCircle(px, py, p.radius);
    g.lineStyle(3, 0xffffff, alpha).strokeCircle(px, py, p.radius);
    const f = p.facing;
    const tip = { x: px + f.x * (p.radius + 9), y: py + f.y * (p.radius + 9) };
    g.fillStyle(0xffffff, alpha).fillTriangle(tip.x, tip.y, px + f.x * p.radius - f.y * 7, py + f.y * p.radius + f.x * 7, px + f.x * p.radius + f.y * 7, py + f.y * p.radius - f.x * 7);

    // HUD.
    bar(g, ox, 42, 300, 18, p.hp / p.maxHp, COL.hpPlayer);
    bar(g, ox, 63, 300, 4, 1 - p.dashCdMs / PLAYER.dashCdMs, 0x6fb7ff); // dash cooldown
    this.texts.hp.setText(`You  ${p.hp} / ${p.maxHp}`);
    this.texts.foe.setText(`${e.boss ? "BOSS  " : ""}${e.name}  ${e.hp} / ${e.maxHp}`);
    this.texts.clock.setText(`${(s.timeMs / 1000).toFixed(1)} s`);
    this.texts.help.setVisible(!this.touchUI);

    // Touch controls.
    this.texts.attack.setVisible(this.touchUI);
    this.texts.dash.setVisible(this.touchUI);
    if (this.touchUI) {
      this.stick.draw(g);
      button(g, L.attackBtn, this.attackPtr !== null ? 0.45 : 0.22, 1);
      button(g, L.dashBtn, 0.22, 1 - p.dashCdMs / PLAYER.dashCdMs);
    }
  }
}

function inCircle(p: { x: number; y: number }, c: Circle, scale = 1): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r * scale;
}

function unit(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 1 };
}

function bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, color: number): void {
  g.fillStyle(COL.hpBack).fillRect(x, y, w, h);
  g.fillStyle(color).fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  g.lineStyle(1, 0x000000, 0.8).strokeRect(x, y, w, h);
}

/** A round touch button; `ready` (0..1) fills a cooldown pie. */
function button(g: Phaser.GameObjects.Graphics, c: Circle, alpha: number, ready: number): void {
  g.fillStyle(0xffffff, alpha).fillCircle(c.x, c.y, c.r);
  if (ready < 1) g.fillStyle(0x000000, 0.45).slice(c.x, c.y, c.r, -Math.PI / 2 + ready * Math.PI * 2, -Math.PI / 2 + Math.PI * 2, false).fillPath();
  g.lineStyle(3, 0xffffff, 0.6).strokeCircle(c.x, c.y, c.r);
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return mix(16) | mix(8) | mix(0);
}
