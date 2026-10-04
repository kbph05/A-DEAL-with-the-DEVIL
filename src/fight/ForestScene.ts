import Phaser from "phaser";
import { FloatingStick } from "../input/stick";
import { privateFiles, privateUrl } from "../world/assets";
import { facingOf, type Facing } from "../world/logic";
import { addBand, bundledKey, preloadBand, setBandGamma } from "../world/bandArt";
import { BG_DEPTH, actorDepth, artSource, isUrl, overlayDepth, privateSceneFile, type SceneDef } from "../world/scene";
import { backgroundPlaceholder, overlayPlaceholder } from "../world/scenePlaceholders";
import { HERO_COLS, HERO_ROWS, HERO_SIZE, PLACEHOLDER_HERO, ensurePlaceholderTextures } from "../world/textures";
import { FOREST_BG_GAMMA } from "./art";
import { COL, bar, button, inCircle, lerpColor } from "./draw";
import { ENEMY_ART_SIZE, enemyTextureKey, ensureEnemyTextures } from "./enemyArt";
import { encounterSummary, type Encounter } from "./encounters";
import { UNITS_PER_PX, footPx, forestLayout, playerFeetPx, toPx, type ForestLayout } from "./forest";
import { PLAYER, STEP_MS, aimAtPointer, moveDir, swingArc, swingDrawOrigin, type FightInput, type FightResult, type Vec } from "./logic";
import { FightSim, type EnemyBody, type FightControls, type SimWorld } from "./sim";
import { ActorSprite, buildCharacter, figureHeight, preloadCharacters, type CharacterArt } from "../render/spriteArt";
import { enemyAnim, playerAnim, roleArt, roleScale, type CharacterId } from "../render/sprites";

/** Live, read-only view of the forest scene for the lab and smoke tests (the sim itself comes via `onDebug` too). */
export interface ForestView {
  frames: number;
  width: number;
  height: number;
  portrait: boolean;
  zoom: number;
  /** The camera's top-left, world pixels. */
  scroll: Vec;
  /** Current depths: the player, each enemy (in `sim.enemies` order), the overlay. */
  depth: { player: number; enemies: number[]; overlay: number };
  /** "bundled": the team's band (src/world/bandArt.ts), which also drops the placeholder canopy (overlay "none"). */
  /** The gamma baked into the bundled forest background now, and a way to change it live (the lab's slider). */
  gamma: number;
  setGamma: (gamma: number) => void;
  art: { background: "file" | "bundled" | "key" | "placeholder"; overlay: "file" | "key" | "placeholder" | "none" };
  /**
   * The licensed sprites (src/render/sprites.ts): which character draws the player and each enemy (null: generated
   * art), and the animation each is playing now.
   */
  sprites: { player: string | null; enemies: (string | null)[]; anims: { player: string | null; enemies: (string | null)[] } };
}

export interface ForestSceneConfig {
  input: Required<FightInput>;
  scene: SceneDef;
  world: SimWorld;
  encounter: Encounter;
  /** Show the virtual joystick and buttons from the start (they also appear on the first touch). */
  touch: boolean;
  onEnd: (result: FightResult) => void;
  onDebug?: (sim: FightSim, view: ForestView) => void;
  /** Gamma for the bundled forest background (default `FOREST_BG_GAMMA`; the lab passes its slider's value). */
  gamma?: number;
  /** Show the controls line at the bottom (default true). */
  help?: boolean;
}

type KeyName = "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT" | "SPACE" | "SHIFT";
type Texts = Record<"hp" | "title" | "foes" | "clock" | "help" | "banner" | "summary" | "attack" | "dash", Phaser.GameObjects.Text>;

const K = UNITS_PER_PX;
/** The Soldier's swing animation length (the sword's cooldown is 420 ms) and its flinch after a hit, ms. */
const HERO_SWING_MS = 360;
const HERO_HURT_MS = 300;
/** An enemy this fast (units/s, after scaling) runs instead of walking, where it has a run (the warrior). */
const WARRIOR_RUN_SPEED = 110;

/**
 * Forest mode: the fight plays on a forest path scene (one background texture, the playable rect, a canopy overlay),
 * against the encounter's enemies placed along the path. Everything is y-sorted by the feet, under the canopy.
 * Rules are `FightSim`'s (the arena's, with a `SimWorld`); this scene only reads input and draws. It uses Phaser's
 * RESIZE scale mode and re-lays out the camera, HUD and touch controls on every resize (a phone rotating mid-fight).
 */
export class ForestScene extends Phaser.Scene {
  private cfg: ForestSceneConfig;
  private sim!: FightSim;
  private L!: ForestLayout;
  private player!: Phaser.GameObjects.Sprite;
  private foes: { body: EnemyBody; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite; art: ActorSprite | null; name: Phaser.GameObjects.Text; last: Vec }[] = [];
  /** The Soldier (src/render/sprites.ts) when its sheets loaded; null: the generated hero. */
  private hero: ActorSprite | null = null;
  /** Sim time of the last swing and the last hit taken (the Soldier's attack and hurt animations). */
  private swingAt = -1e9;
  private hurtAt = -1e9;
  private ground!: Phaser.GameObjects.Graphics;
  private fxg!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private texts!: Texts;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private stick: FloatingStick;
  private acc = 0;
  private finished = false;
  private touchUI: boolean;
  private attackQueued = false;
  /** The queued attack came from a mouse click (only those aim at the pointer: `aimAtPointer`). */
  private clickQueued = false;
  private dashQueued = false;
  private mouseDown = false;
  private mouseScreen: Vec | null = null;
  private attackPtr: number | null = null;
  private facing: Facing = "right";
  private lastPos: Vec = { x: 0, y: 0 };
  private failed = new Set<string>();
  readonly view: ForestView;

  constructor(cfg: ForestSceneConfig) {
    super({ key: "forest-fight" });
    this.cfg = cfg;
    this.touchUI = cfg.touch;
    const L0 = forestLayout(960, 540);
    this.stick = new FloatingStick({ ...L0.stick }, { width: L0.width, height: L0.height });
    this.view = {
      frames: 0, width: 0, height: 0, portrait: false, zoom: 1, scroll: { x: 0, y: 0 },
      depth: { player: 0, enemies: [], overlay: overlayDepth(cfg.scene.size.h) },
      gamma: cfg.gamma ?? FOREST_BG_GAMMA, setGamma: () => {}, // setGamma is wired up when the bundled band is drawn
      art: { background: "placeholder", overlay: cfg.scene.overlay ? "placeholder" : "none" },
      sprites: { player: null, enemies: [], anims: { player: null, enemies: [] } },
    };
  }

  // --- art: a private file > the def's URL or key > the generated placeholder (as in the world scene) --------------

  private partKey(name: string): string { return `forest:${this.cfg.scene.id}:${name}`; }

  preload(): void {
    const def = this.cfg.scene;
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.failed.add(file.key));
    for (const [name, value] of [["background", def.background], ["overlay", def.overlay]] as const) {
      const src = artSource(privateFiles(), def.id, name, value, privateUrl);
      if (src && src.kind !== "key") this.load.image(this.partKey(name), src.url);
    }
    if (!privateSceneFile(privateFiles(), def.id, "background")) preloadBand(this, def);
    preloadCharacters(this, this.characters());
  }

  /** The licensed characters this fight draws: the Soldier, and each enemy's (roles without one keep generated art). */
  private characters(): CharacterId[] {
    const ids: CharacterId[] = ["soldier"];
    for (const e of this.cfg.encounter.enemies) {
      const r = roleArt(e.id);
      if (r) ids.push(r.character, ...(r.like ? [r.like] : []));
    }
    return [...new Set(ids)];
  }

  private resolve(name: string, value: string | undefined, draw: (key: string) => void): { key: string; art: "file" | "key" | "placeholder" } {
    const def = this.cfg.scene;
    const src = artSource(privateFiles(), def.id, name, value, privateUrl);
    const ok = (k: string) => this.textures.exists(k) && !this.failed.has(k);
    if (src && src.kind !== "key" && ok(this.partKey(name))) return { key: this.partKey(name), art: "file" };
    if (src?.kind === "key" && ok(src.key)) return { key: src.key, art: "key" };
    const key = value && !isUrl(value) ? value : `scene-ph:${def.id}:${name}`;
    draw(key);
    return { key, art: "placeholder" };
  }

  // --- setup ------------------------------------------------------------------------------------------------------

  create(): void {
    const def = this.cfg.scene;
    ensurePlaceholderTextures(this);
    ensureEnemyTextures(this);
    this.sim = new FightSim(this.cfg.input, this.cfg.world);
    const OV = this.view.depth.overlay;
    const world: Phaser.GameObjects.GameObject[] = [];

    // A private file or the def's art, stretched to the scene; else the bundled band, which brings its own trees (no canopy).
    const band = !privateSceneFile(privateFiles(), def.id, "background") && this.textures.exists(bundledKey(def.id)) && !this.failed.has(bundledKey(def.id));
    if (band) {
      this.view.art.background = "bundled";
      const bg = addBand(this, def, BG_DEPTH, this.view.gamma);
      this.view.setGamma = (g) => { setBandGamma(this, def, bg, g); this.view.gamma = g; };
      world.push(bg);
    } else {
      const bg = this.resolve("background", def.background, (k) => backgroundPlaceholder(this, k, def));
      this.view.art.background = bg.art;
      world.push(this.add.image(0, 0, bg.key).setOrigin(0, 0).setDisplaySize(def.size.w, def.size.h).setDepth(BG_DEPTH));
    }
    this.ground = this.add.graphics().setDepth(BG_DEPTH + 1);
    world.push(this.ground);

    // The licensed sprites, where loaded (src/render/sprites.ts); a role whose sheets are missing keeps generated art.
    const arts = new Map<CharacterId, CharacterArt | null>();
    for (const id of this.characters()) arts.set(id, buildCharacter(this, id));
    const heightOf = (c: CharacterId) => figureHeight(arts.get(c));
    const label = { fontFamily: "system-ui, sans-serif", fontSize: "6px", color: "#ffe9b0", stroke: "#000", strokeThickness: 2 };
    for (const body of this.sim.enemies) {
      const role = roleArt(body.kind);
      const art = role ? arts.get(role.character) : null;
      const actor = role && art ? new ActorSprite(this, art, roleScale(role, heightOf)) : null;
      const sprite = actor ? actor.sprite : this.add.image(0, 0, enemyTextureKey(body.kind)).setOrigin(0.5, 1);
      const name = this.add.text(0, 0, body.name, label).setOrigin(0.5, 1).setResolution(6).setDepth(OV + 2);
      this.foes.push({ body, sprite, art: actor, name, last: { ...body.pos } });
      world.push(sprite, name);
    }
    for (const f of HERO_ROWS) {
      const key = `ph-walk-${f}`;
      const row = HERO_ROWS.indexOf(f) * HERO_COLS;
      if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(PLACEHOLDER_HERO, { frames: [row + 1, row, row + 2, row] }), frameRate: 8, repeat: -1 });
    }
    const soldier = arts.get("soldier");
    const playerRole = roleArt("player");
    if (soldier && playerRole) {
      this.hero = new ActorSprite(this, soldier, roleScale(playerRole, heightOf));
      this.player = this.hero.sprite;
    } else this.player = this.add.sprite(0, 0, PLACEHOLDER_HERO, 0).setOrigin(0.5, 1);
    world.push(this.player);
    this.fxg = this.add.graphics().setDepth(OV - 1);
    world.push(this.fxg);
    if (band) this.view.art.overlay = "none";
    else if (def.overlay) {
      const ov = this.resolve("overlay", def.overlay, (k) => overlayPlaceholder(this, k, def));
      this.view.art.overlay = ov.art;
      world.push(this.add.image(0, 0, ov.key).setOrigin(0, 0).setDisplaySize(def.size.w, def.size.h).setDepth(OV));
    }
    this.view.sprites.player = this.hero?.art.id ?? null;
    this.view.sprites.enemies = this.foes.map((f) => f.art?.art.id ?? null);
    this.bars = this.add.graphics().setDepth(OV + 1);
    world.push(this.bars);
    this.syncSprites();

    // UI: a second, unzoomed camera over the whole canvas.
    const font = (size: number, color = COL.text) => ({ fontFamily: "system-ui, sans-serif", fontSize: `${size}px`, color, stroke: "#000", strokeThickness: 4 });
    this.ui = this.add.graphics().setDepth(10);
    this.texts = {
      hp: this.add.text(0, 0, "", font(18)).setDepth(11),
      // The engine's enemy is the encounter: its name heads the fight ("Cave rat and its pack"), as the toasts say it.
      title: this.add.text(0, 0, this.cfg.encounter.title, font(18)).setOrigin(1, 0).setDepth(11),
      foes: this.add.text(0, 0, "", font(16)).setOrigin(1, 0).setDepth(11),
      clock: this.add.text(0, 0, "", font(16, COL.dim)).setOrigin(1, 0).setDepth(11),
      help: this.add.text(0, 0, "Move: WASD / arrows   Attack: Space / click   Dash: Shift", font(15, COL.dim)).setOrigin(0.5, 1).setDepth(11),
      banner: this.add.text(0, 0, "", { ...font(56), fontStyle: "bold", strokeThickness: 8 }).setOrigin(0.5).setDepth(12).setVisible(false),
      summary: this.add.text(0, 0, "", font(24)).setOrigin(0.5, 0).setDepth(12).setVisible(false),
      attack: this.add.text(0, 0, "Attack", font(22)).setOrigin(0.5).setDepth(11),
      dash: this.add.text(0, 0, "Dash", font(18)).setOrigin(0.5).setDepth(11),
    };
    const uiObjects = [this.ui, ...Object.values(this.texts)];
    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.startFollow(this.player, true, 0.2, 0.2);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, "ui");
    cam.ignore(uiObjects);
    this.uiCam.ignore(world);

    // Input: as the arena's.
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT", true) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.on("keydown-SPACE", () => { this.attackQueued = true; });
    kb.on("keydown-SHIFT", () => { this.dashQueued = true; });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on("gameout", () => { this.mouseDown = false; });

    // Resize (window resize, phone rotation): re-lay out through the scale manager and the cameras.
    const onResize = (size: Phaser.Structs.Size) => this.relayout(size.width, size.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    this.relayout(this.scale.width, this.scale.height);
    cam.centerOn(this.player.x, this.player.y);

    this.cfg.onDebug?.(this.sim, this.view);
    this.render();
  }

  /** Lay out the camera, HUD and touch controls for a canvas of `w × h` (RESIZE mode: the container's size). */
  private relayout(w: number, h: number): void {
    const L = this.L = forestLayout(w, h);
    const def = this.cfg.scene;
    const cam = this.cameras.main;
    cam.setSize(L.width, L.height).setZoom(L.zoom);
    // The camera stays inside the texture; a scene smaller than the view is centred.
    const viewW = L.width / L.zoom, viewH = L.height / L.zoom;
    const bx = Math.min(0, (def.size.w - viewW) / 2), by = Math.min(0, (def.size.h - viewH) / 2);
    cam.setBounds(bx, by, Math.max(def.size.w, viewW), Math.max(def.size.h, viewH));
    if (this.player) cam.centerOn(this.player.x, this.player.y);
    this.uiCam.setSize(L.width, L.height);
    this.stick.home = { ...L.stick };
    this.stick.bounds = { width: L.width, height: L.height };
    if (!this.stick.active) this.stick.base = { x: L.stick.x, y: L.stick.y };
    const s = L.ui, t = this.texts, pad = 14 * s;
    t.hp.setPosition(pad, pad * 0.6).setFontSize(Math.round(18 * s));
    t.title.setPosition(L.width - pad, pad * 0.6).setFontSize(Math.round(18 * s));
    t.foes.setPosition(L.width - pad, pad * 0.6 + 24 * s).setFontSize(Math.round(15 * s));
    t.clock.setPosition(L.width - pad, pad * 0.6 + 44 * s).setFontSize(Math.round(15 * s));
    t.help.setPosition(L.width / 2, L.height - 8).setFontSize(Math.round(15 * Math.min(1, s)));
    t.banner.setPosition(L.width / 2, L.height * 0.42).setFontSize(Math.round(56 * s));
    t.summary.setPosition(L.width / 2, L.height * 0.42 + 40 * s).setFontSize(Math.round(24 * s));
    t.attack.setPosition(L.attackBtn.x, L.attackBtn.y).setFontSize(Math.round(22 * s));
    t.dash.setPosition(L.dashBtn.x, L.dashBtn.y).setFontSize(Math.round(18 * s));
    Object.assign(this.view, { width: L.width, height: L.height, portrait: L.portrait, zoom: L.zoom });
  }

  update(_time: number, delta: number): void {
    if (!this.finished) {
      this.acc = Math.min(this.acc + delta, STEP_MS * 6); // after a stall, catch up at most 0.1 s
      while (this.acc >= STEP_MS && !this.sim.over) {
        this.sim.step(this.controls());
        this.attackQueued = false;
        this.clickQueued = false;
        this.dashQueued = false;
        this.acc -= STEP_MS;
        if (this.sim.fx.includes("hurt")) { this.cameras.main.shake(140, 0.006); this.hurtAt = this.sim.timeMs; }
        if (this.sim.fx.includes("swing")) { this.swingAt = this.sim.timeMs; this.hero?.play("attack", { restart: true, durationMs: HERO_SWING_MS }); }
        if (this.sim.fx.includes("burst")) this.cameras.main.shake(100, 0.003);
      }
      if (this.sim.over) this.end(this.sim.result!);
    }
    this.view.frames++;
    this.render();
  }

  private end(result: FightResult): void {
    this.finished = true;
    this.texts.banner.setText(result.won ? "PATH CLEAR" : "DEFEATED").setColor(result.won ? "#ffe066" : "#ff5a4f").setVisible(true);
    this.texts.summary.setText(encounterSummary(this.cfg.encounter, result.won)).setVisible(true);
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
    const mouse = aimAtPointer(this.mouseDown || this.clickQueued, this.touchUI) && this.mouseScreen !== null;
    let aim: Vec | null = null;
    if (mouse && this.mouseScreen) {
      const wp = this.cameras.main.getWorldPoint(this.mouseScreen.x, this.mouseScreen.y);
      aim = { x: wp.x * K, y: wp.y * K };
    }
    return { move, attack: this.attackQueued || k.SPACE.isDown || this.mouseDown || this.attackPtr !== null, dash: this.dashQueued, aim };
  }

  private pointerDown(p: Phaser.Input.Pointer): void {
    const L = this.L;
    if (p.wasTouch) {
      this.touchUI = true;
      if (inCircle(p, L.attackBtn, 1.2)) { this.attackPtr = p.id; this.attackQueued = true; return; }
      if (inCircle(p, L.dashBtn, 1.2)) { this.dashQueued = true; return; }
      if (p.x < L.width / 2) this.stick.grab(p);
      return;
    }
    this.mouseScreen = { x: p.x, y: p.y };
    if (p.leftButtonDown()) { this.mouseDown = true; this.attackQueued = true; this.clickQueued = true; }
  }

  private pointerMove(p: Phaser.Input.Pointer): void {
    if (this.stick.move(p)) return;
    if (!p.wasTouch) this.mouseScreen = { x: p.x, y: p.y };
  }

  private pointerUp(p: Phaser.Input.Pointer): void {
    this.stick.release(p);
    if (p.id === this.attackPtr) this.attackPtr = null;
    if (!p.wasTouch) this.mouseDown = false;
  }

  // --- drawing ----------------------------------------------------------------------------------------------------

  /** Place every sprite at its body's feet, y-sorted, with the mode's tint and squash. */
  private syncSprites(): void {
    const s = this.sim;
    const p = s.player;
    const blink = Math.floor(s.timeMs / 80) % 2 === 0;
    // The figure is centred on the sim's centre (the hitbox's and the arc's origin), horizontally and vertically.
    const px = toPx(p.pos.x), pf = playerFeetPx(p.pos, this.hero ? this.hero.figureH : HERO_SIZE);
    const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.y - this.lastPos.y) > 0.5;
    this.lastPos = { ...p.pos };
    this.facing = facingOf(p.facing, this.facing);
    if (this.hero) {
      // The Soldier: death, the flinch, the swing (Attack01 to 03 in turn, facing the swing), walking, idle.
      const swinging = s.timeMs - this.swingAt < HERO_SWING_MS;
      const anim = playerAnim({ dead: p.hp <= 0, hurt: s.timeMs - this.hurtAt < HERO_HURT_MS, swinging, moving: moved && !s.over }, this.hero.has);
      if (anim !== "attack") this.hero.play(anim);
      const dirX = swinging ? p.swingDir.x : p.facing.x;
      const flip = Math.abs(dirX) > 0.01 ? dirX < 0 : this.hero.flipped;
      this.hero.place(px, pf, flip);
      this.player.setDepth(actorDepth(pf));
    } else {
      this.player.setPosition(px, pf).setDepth(actorDepth(pf));
      if (moved && !s.over) this.player.anims.play(`ph-walk-${this.facing}`, true);
      else { this.player.anims.stop(); this.player.setFrame(HERO_ROWS.indexOf(this.facing) * HERO_COLS); }
    }
    this.player.setAlpha(p.iframesMs > 0 && blink ? 0.4 : 1);
    if (p.stunMs > 0) this.player.setTint(0xb8c4ff); else this.player.clearTint();
    this.view.depth.player = this.player.depth;
    this.view.sprites.anims = { player: this.hero?.anim ?? null, enemies: this.foes.map((f) => f.art?.anim ?? null) };

    this.view.depth.enemies = this.foes.map((foe) => {
      const { body: e, sprite, name, art } = foe;
      const ex = toPx(e.pos.x), ef = footPx(e.pos, e.radius);
      const b = e.brain;
      let scale = 1, squash = 1;
      let tint: number | null = null;
      const moving = Math.hypot(e.pos.x - foe.last.x, e.pos.y - foe.last.y) > 0.5;
      foe.last = { ...e.pos };
      if (art) {
        // The sprite's animation: the telegraph and lunge are one attack, timed to last as long as they do; the boss
        // burst's charge is the warrior's heavy hit.
        const anim = enemyAnim({ dead: e.hp <= 0, hurt: e.hurtMs > 0, mode: b.mode, moving: moving && b.mode === "chase" }, art.has);
        const durationMs = anim === "heavy" || (anim === "attack" && b.mode === "burstWindup") ? e.params.burstWindupMs
          : anim === "attack" ? e.params.windupMs + e.params.lungeMs : undefined;
        art.play(anim, { durationMs, run: e.params.speed >= WARRIOR_RUN_SPEED });
      }
      if (e.hp <= 0) {
        // With a death animation it plays, holds, then fades; without one it fades out as before.
        const t = s.timeMs - (e.diedAtMs ?? 0);
        const k = art?.has("death") ? Math.min(1, Math.max(0, (t - 700) / 400)) : Math.min(1, t / 500);
        sprite.setAlpha(1 - k).setVisible(k < 1);
        if (!art?.has("death")) sprite.setTint(0x553333); else sprite.clearTint();
        name.setVisible(false);
      } else {
        sprite.setAlpha(1).setVisible(true);
        name.setVisible(true);
        if (b.mode === "windup") {
          const k = Math.min(1, b.modeMs / e.params.windupMs);
          scale = 1 + 0.25 * k;
          tint = lerpColor(0xffffff, COL.telegraph, k);
          if (b.modeMs >= e.params.windupMs / 2 && blink) tint = -1; // locked: flashing white
        } else if (b.mode === "lunge") { tint = COL.telegraph; scale = 1.1; }
        else if (b.mode === "recover") tint = lerpColor(0x707070, 0xffffff, Math.min(1, b.modeMs / e.params.recoverMs));
        else if (b.mode === "burstWindup") tint = lerpColor(0xffffff, COL.bullet, Math.min(1, b.modeMs / e.params.burstWindupMs));
        else if (b.mode === "chase" && !art && (e.kind === "slime" || e.kind === "orc")) squash = 1 + 0.12 * Math.sin(s.timeMs / 70);
        if (e.stunMs > 0) tint = 0xaab4ff;
        if (e.hurtMs > 0) tint = -1;
        if (tint === -1) sprite.setTintFill(0xffffff);
        else if (tint !== null) sprite.setTint(tint);
        else sprite.clearTint();
      }
      // A sprite keeps its last facing while it lies dead; the generated art always faces you.
      if (art) art.place(ex, ef, e.hp > 0 ? p.pos.x < e.pos.x : art.flipped, e.hp > 0 ? scale : 1);
      else sprite.setPosition(ex, ef).setScale(scale / squash, scale * squash).setFlipX(p.pos.x < e.pos.x);
      sprite.setDepth(actorDepth(ef));
      return sprite.depth;
    });
  }

  private render(): void {
    this.syncSprites();
    const s = this.sim;
    const p = s.player;
    const L = this.L;
    const g = this.ground.clear();
    const f = this.fxg.clear();
    const bars = this.bars.clear();

    for (const { body: e, sprite, name, art } of this.foes) {
      if (e.hp <= 0) continue;
      const ex = toPx(e.pos.x), ey = toPx(e.pos.y), er = toPx(e.radius);
      const b = e.brain;
      if (b.mode === "windup") {
        const locked = b.modeMs >= e.params.windupMs / 2;
        if (e.params.behaviour === "archer") {
          // The aim line: where the arrow will fly. Faint while it follows you, solid once locked.
          const reach = 150;
          g.lineStyle(1, COL.telegraph, locked ? 0.9 : 0.35).lineBetween(ex, ey - 4, ex + e.aim.x * reach, ey - 4 + e.aim.y * reach);
        } else {
          // Where the lunge will go: a fading lane, solid once the aim locks.
          const reach = toPx(e.params.lungeSpeed * e.params.lungeMs / 1000) + er;
          g.lineStyle(er * 1.6, COL.telegraph, locked ? 0.3 : 0.13).lineBetween(ex, ey, ex + e.aim.x * reach, ey + e.aim.y * reach);
        }
      } else if (b.mode === "burstWindup") {
        const k = Math.min(1, b.modeMs / e.params.burstWindupMs);
        f.lineStyle(1.5, COL.bullet, 0.3 + 0.5 * k).strokeCircle(ex, ey - er, er * (1 + 1.4 * k));
      }
      // The top of the visible figure (a sprite's frame is mostly empty space around it).
      const top = art ? art.top : sprite.y - sprite.displayHeight;
      if (b.mode === "recover" || e.stunMs > 0) f.lineStyle(1, 0xffffff, 0.6).strokeEllipse(ex, top - 2, (art ? art.figureW : ENEMY_ART_SIZE[e.kind].w) * 0.6, 3);
      // HP bar and name above the canopy, so the trees never hide them.
      const bw = e.boss ? 30 : 16;
      bar(bars, ex - bw / 2, top - 5, bw, 2.5, e.hp / e.maxHp, COL.hpEnemy, 0.5);
      name.setPosition(ex, top - 6);
    }

    // Projectiles: arrows (a shaft and a head) and boss bullets.
    for (const bl of s.bullets) {
      const bx = toPx(bl.pos.x), by = toPx(bl.pos.y) - 4;
      if (bl.kind === "arrow") {
        const v = Math.hypot(bl.vel.x, bl.vel.y) || 1;
        const d = { x: bl.vel.x / v, y: bl.vel.y / v };
        f.lineStyle(1.2, COL.arrow, 1).lineBetween(bx - d.x * 6, by - d.y * 6, bx + d.x * 2, by + d.y * 2);
        f.fillStyle(0xc0c0c8).fillTriangle(bx + d.x * 4, by + d.y * 4, bx - d.y * 1.5, by + d.x * 1.5, bx + d.y * 1.5, by - d.x * 1.5);
        f.fillStyle(0xc05050).fillRect(bx - d.x * 6 - 0.5, by - d.y * 6 - 0.5, 1.5, 1.5);
      } else {
        const r = toPx(bl.radius);
        f.fillStyle(COL.bullet).fillCircle(bx, by, r).fillStyle(0xffffff).fillCircle(bx, by, r * 0.45);
      }
    }

    // The player's swing and dash trail.
    // The arc is drawn from the hitbox's own origin (the sim's player centre, which the sprite's figure stands on,
    // centred), not a few pixels up: what you see is what hits.
    const { x: px, y: py } = swingDrawOrigin(p.pos, (v) => ({ x: toPx(v.x), y: toPx(v.y) }));
    if (p.swingMs > 0) {
      const arc = swingArc(p.pos, p.swingDir, p.radius); // the hitbox itself, so it turns with the facing
      const k = p.swingMs / PLAYER.swingMs;
      const r = toPx(arc.reach);
      f.fillStyle(0xffffff, 0.3 * k).slice(px, py, r, arc.from, arc.to, false).fillPath();
      f.lineStyle(1.5, 0xffffff, 0.85 * k).beginPath().arc(px, py, r, arc.from, arc.to, false).strokePath();
    }
    if (p.dashMs > 0) for (let i = 1; i <= 3; i++) f.fillStyle(COL.player, 0.2).fillCircle(px - p.dashDir.x * i * 5, py - p.dashDir.y * i * 5, 5);

    // HUD.
    const ui = this.ui.clear();
    const sc = L.ui, pad = 14 * sc;
    const barY = pad * 0.6 + 26 * sc;
    bar(ui, pad, barY, 240 * sc, 14 * sc, p.hp / p.maxHp, COL.hpPlayer);
    bar(ui, pad, barY + 17 * sc, 240 * sc, 4 * sc, 1 - p.dashCdMs / PLAYER.dashCdMs, COL.player); // dash cooldown
    const alive = s.alive.length;
    this.texts.hp.setText(`You  ${p.hp} / ${p.maxHp}`);
    this.texts.foes.setText(`${s.enemies.length > 1 ? `${alive} / ${s.enemies.length} standing  ·  ` : ""}${s.enemyHpLeft} HP`);
    this.texts.clock.setText(`${(s.timeMs / 1000).toFixed(1)} s`);
    this.texts.help.setVisible(this.cfg.help !== false && !this.touchUI && !this.finished);
    this.texts.attack.setVisible(this.touchUI);
    this.texts.dash.setVisible(this.touchUI);
    if (this.touchUI) {
      this.stick.draw(ui);
      button(ui, L.attackBtn, this.attackPtr !== null ? 0.45 : 0.22, 1);
      button(ui, L.dashBtn, 0.22, 1 - p.dashCdMs / PLAYER.dashCdMs);
    }
    const cam = this.cameras.main;
    this.view.scroll = { x: cam.worldView.x, y: cam.worldView.y };
  }
}
