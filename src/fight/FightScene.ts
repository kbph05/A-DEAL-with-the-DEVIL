import Phaser from "phaser";
import { FloatingStick } from "../input/stick";
import { ARENA, PLAYER, STEP_MS, moveDir, type Circle, type FightLayout, type FightResult, type Vec } from "./logic";
import { FightSim, type FightControls } from "./sim";
import type { FightInput } from "./logic";
import { placeholderTexture } from "../render/placeholder";

export interface FightSceneConfig {
  input: Required<FightInput>;
  layout: FightLayout;
  /** Show the virtual joystick and buttons from the start (they also appear on the first touch). */
  touch: boolean;
  onEnd: (result: FightResult) => void;
  onDebug?: (sim: FightSim) => void;
}

type KeyName = "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT" | "SPACE" | "SHIFT";

// The art is placeholder black, white and grey (labelled textures from ../render/placeholder.ts) until the team's own
// exists. The HUD bars and the touch controls are UI, not art, and keep their colours.
const COL = {
  floor: 0xc8c8c8, grid: 0xb4b4b4, wall: 0x303030,
  telegraph: 0x000000, bullet: 0x000000,
  hpBack: 0x2a1a1a, hpPlayer: 0x4cc36a, hpEnemy: 0xd8443c, text: "#eeeeee", dim: "#a99",
};
const SCALE_UP = 3; // canvas pixels per logical pixel for the fight's labelled bodies, so their text stays crisp

/**
 * The realtime fight: draws a `FightSim` (placeholder labelled sprites for the bodies and pillars, plain shapes for
 * the rest) and feeds it keyboard, mouse and touch input at a fixed 60 Hz step. All rules live in `sim.ts` / `logic.ts`.
 */
export class FightScene extends Phaser.Scene {
  private cfg: FightSceneConfig;
  private sim!: FightSim;
  private g!: Phaser.GameObjects.Graphics; // room, lane and trail, under the sprites
  private g2!: Phaser.GameObjects.Graphics; // swing, bullets, HUD and touch controls, over them
  private playerImg!: Phaser.GameObjects.Image;
  private enemyImg!: Phaser.GameObjects.Image;
  private enemyKeys!: { normal: string; flash: string };
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
    this.makeBodies();
    this.g2 = this.add.graphics().setDepth(2);

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

  /** The labelled placeholder sprites: player and enemy (inverted so they stand out), and one per pillar. */
  private makeBodies(): void {
    const e = this.sim.enemy;
    const pd = this.sim.player.radius * 2;
    const ed = e.radius * 2;
    const ek = `fight-enemy-${e.boss ? "boss" : "enemy"}-${e.name}-${ed}`;
    this.enemyKeys = { normal: ek, flash: `${ek}-flash` };
    const label = e.boss ? `BOSS:\n${e.name}` : "ENEMY";
    placeholderTexture(this, "fight-player", pd, pd, "PLAYER", { invert: true, circle: true, res: SCALE_UP });
    placeholderTexture(this, this.enemyKeys.normal, ed, ed, label, { invert: true, circle: true, res: SCALE_UP });
    placeholderTexture(this, this.enemyKeys.flash, ed, ed, label, { circle: true, res: SCALE_UP }); // white: the windup flash and the hurt flash
    this.playerImg = this.add.image(0, 0, "fight-player").setDisplaySize(pd, pd).setDepth(1);
    this.enemyImg = this.add.image(0, 0, this.enemyKeys.normal).setDisplaySize(ed, ed).setDepth(1);
    for (const r of this.sim.obstacles) {
      const key = `fight-pillar-${r.w}x${r.h}`;
      placeholderTexture(this, key, r.w, r.h, "PILLAR", { res: SCALE_UP });
      this.add.image(this.cfg.layout.arena.x + r.x, this.cfg.layout.arena.y + r.y, key).setOrigin(0, 0).setDisplaySize(r.w, r.h).setDepth(0.5);
    }
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
    const g2 = this.g2.clear();
    const ox = L.arena.x;
    const oy = L.arena.y;
    const blink = Math.floor(s.timeMs / 80) % 2 === 0;

    // Room (pillars are sprites).
    g.fillStyle(COL.floor).fillRect(ox, oy, ARENA, ARENA);
    g.lineStyle(1, COL.grid);
    for (let i = 48; i < ARENA; i += 48) { g.lineBetween(ox + i, oy, ox + i, oy + ARENA); g.lineBetween(ox, oy + i, ox + ARENA, oy + i); }
    g.lineStyle(8, COL.wall).strokeRect(ox - 4, oy - 4, ARENA + 8, ARENA + 8);

    // Enemy: black body; it swells and flashes white to telegraph, and goes faint while it recovers.
    const e = s.enemy;
    const ex = ox + e.pos.x;
    const ey = oy + e.pos.y;
    let flash = false;
    let alpha = 1;
    let scale = 1;
    const b = e.brain;
    if (b.mode === "windup") {
      const k = Math.min(1, b.modeMs / e.params.windupMs);
      scale = 1 + 0.3 * k;
      const locked = b.modeMs >= e.params.windupMs / 2;
      flash = locked && blink; // flashing once the aim locks
      // Where the lunge will go: a fading lane, solid once the aim locks.
      const reach = (e.params.lungeSpeed * e.params.lungeMs) / 1000 + e.radius;
      g.lineStyle(e.radius * 1.6, COL.telegraph, locked ? 0.28 : 0.12).lineBetween(ex, ey, ex + e.aim.x * reach, ey + e.aim.y * reach);
    } else if (b.mode === "lunge") {
      scale = 1.1;
    } else if (b.mode === "recover") {
      alpha = 0.45 + 0.55 * Math.min(1, b.modeMs / e.params.recoverMs);
    } else if (b.mode === "burstWindup") {
      const k = Math.min(1, b.modeMs / e.params.burstWindupMs);
      g.lineStyle(4, COL.bullet, 0.3 + 0.5 * k).strokeCircle(ex, ey, e.radius * (1 + 1.4 * k));
    }
    if (e.hurtMs > 0) flash = true;
    const er = e.radius * scale;
    this.enemyImg.setTexture(flash ? this.enemyKeys.flash : this.enemyKeys.normal).setPosition(ex, ey).setDisplaySize(er * 2, er * 2).setAlpha(alpha);
    if (b.mode === "windup" && b.modeMs >= e.params.windupMs / 2 && blink) g2.lineStyle(4, 0x000000).strokeCircle(ex, ey, er + 4);
    if (b.mode === "recover") g2.lineStyle(2, 0x000000, 0.5).strokeEllipse(ex, ey - er - 6, er * 1.1, 8);
    // Enemy HP bar.
    const bw = e.boss ? 120 : 60;
    bar(g2, ex - bw / 2, ey - er - 18, bw, 8, e.hp / e.maxHp, COL.hpEnemy);
    this.texts.name.setPosition(ex, ey - er - 22);

    // Boss bullets: black with a white core.
    for (const bl of s.bullets) g2.fillStyle(COL.bullet).fillCircle(ox + bl.pos.x, oy + bl.pos.y, bl.radius).fillStyle(0xffffff).fillCircle(ox + bl.pos.x, oy + bl.pos.y, bl.radius * 0.45);

    // Player: black body with a white rim; a white arrow shows the facing.
    const p = s.player;
    const px = ox + p.pos.x;
    const py = oy + p.pos.y;
    if (p.swingMs > 0) {
      const a = Math.atan2(p.swingDir.y, p.swingDir.x);
      const k = p.swingMs / PLAYER.swingMs;
      g2.fillStyle(0xffffff, 0.5 * k).slice(px, py, p.radius + PLAYER.swingRange, a - PLAYER.swingHalfAngle, a + PLAYER.swingHalfAngle, false).fillPath();
      g2.lineStyle(4, 0x000000, 0.8 * k).beginPath().arc(px, py, p.radius + PLAYER.swingRange, a - PLAYER.swingHalfAngle, a + PLAYER.swingHalfAngle, false).strokePath();
    }
    if (p.dashMs > 0) for (let i = 1; i <= 3; i++) g.fillStyle(0x000000, 0.18).fillCircle(px - p.dashDir.x * i * 14, py - p.dashDir.y * i * 14, p.radius);
    const alpha2 = p.iframesMs > 0 && blink ? 0.35 : 1;
    this.playerImg.setPosition(px, py).setAlpha(alpha2);
    const f = p.facing;
    const tip = { x: px + f.x * (p.radius + 9), y: py + f.y * (p.radius + 9) };
    g2.fillStyle(0x000000, alpha2).fillTriangle(tip.x, tip.y, px + f.x * p.radius - f.y * 7, py + f.y * p.radius + f.x * 7, px + f.x * p.radius + f.y * 7, py + f.y * p.radius - f.x * 7);

    // HUD.
    bar(g2, ox, 42, 300, 18, p.hp / p.maxHp, COL.hpPlayer);
    bar(g2, ox, 63, 300, 4, 1 - p.dashCdMs / PLAYER.dashCdMs, 0x6fb7ff); // dash cooldown
    this.texts.hp.setText(`You  ${p.hp} / ${p.maxHp}`);
    this.texts.foe.setText(`${e.boss ? "BOSS  " : ""}${e.name}  ${e.hp} / ${e.maxHp}`);
    this.texts.clock.setText(`${(s.timeMs / 1000).toFixed(1)} s`);
    this.texts.help.setVisible(!this.touchUI);

    // Touch controls.
    this.texts.attack.setVisible(this.touchUI);
    this.texts.dash.setVisible(this.touchUI);
    if (this.touchUI) {
      this.stick.draw(g2);
      button(g2, L.attackBtn, this.attackPtr !== null ? 0.45 : 0.22, 1);
      button(g2, L.dashBtn, 0.22, 1 - p.dashCdMs / PLAYER.dashCdMs);
    }
  }
}

function inCircle(p: { x: number; y: number }, c: Circle, scale = 1): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r * scale;
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

