import Phaser from "phaser";
import { moveDir, type Vec } from "../input/dir";
import { FloatingStick } from "../input/stick";
import { PRIVATE_PLAYER, privateFiles, privateUrl } from "./assets";
import { FEET, WALK, facingOf, stepVelocity, type Facing, type WorldLayout } from "./logic";
import {
  BG_DEPTH, ZoneTracker, actorDepth, artSource, clampToBounds, footY, isUrl, overlayDepth, privateSceneFile,
  type Rect, type SceneActor, type SceneDef, type SceneZone,
} from "./scene";
import { addBand, bundledKey, preloadBand } from "./bandArt";
import { actorPlaceholder, backgroundPlaceholder, overlayPlaceholder } from "./scenePlaceholders";
import { HERO_COLS, HERO_ROWS, HERO_SIZE, PLACEHOLDER_HERO, ensurePlaceholderTextures } from "./textures";
import { buildCharacter, preloadCharacters, type CharacterArt } from "../render/spriteArt";
import { fitScale, roleArt } from "../render/sprites";

/**
 * Where a texture came from: a private file, the team's bundled band (bandArt.ts; backgrounds only), a URL in the def,
 * a texture key in the def, or a generated placeholder.
 */
export type Art = "private" | "bundled" | "url" | "key" | "placeholder";

/** Live, read-only view of the scene for dev pages and smoke tests. */
export interface WorldDebug {
  scene: string;
  /** Centre of the feet box, world pixels (what zones test against). */
  pos: Vec;
  /** Bottom of the feet: the player's y-sort key. */
  footY: number;
  vel: Vec;
  /** Ids of the zones the feet are in. */
  zones: string[];
  facing: Facing;
  /** Movement input this frame (unit or zero). */
  input: Vec;
  bounds: Rect;
  /** Current depths: the player, each actor by id, the overlay. */
  depth: { player: number; actors: Record<string, number>; overlay: number };
  /** Which art is in use. */
  /** player: "private" is the local player-idle/walk hook (assets.ts), "soldier" the licensed Soldier (src/render/sprites.ts). */
  art: { player: "private" | "soldier" | "placeholder"; background: Art; overlay: Art | "none"; actors: Record<string, Art> };
  frames: number;
}

export interface WorldSceneConfig {
  scene: SceneDef;
  layout: WorldLayout;
  /** Show the touch stick from the start (it also appears on the first touch). */
  touch: boolean;
  /** Top walking speed, px/s. Default WALK.speed. */
  speed?: number;
  /** Draw the bounds rect, the zones and the feet box as outlines. */
  outlines?: boolean;
  onEnterZone?: (zone: SceneZone, scene: SceneDef) => void;
  onLeaveZone?: (zone: SceneZone, scene: SceneDef) => void;
  onDebug?: (debug: WorldDebug) => void;
  /** Show the help line at the bottom (default true). */
  help?: boolean;
}

type KeyName = "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT";

const KEY = { idle: "priv-player-idle", walk: "priv-player-walk" };

/**
 * One scene: a background texture (depth 0), actors and the player y-sorted by their feet every frame, then the
 * overlay texture above them all. The player's Arcade body is a small box at the feet, kept inside `scene.bounds`
 * by the physics world bounds. The main camera is zoomed (integer, crisp) and follows the player inside the
 * texture; a second, unzoomed camera draws the touch stick and the help line.
 */
export class WorldScene extends Phaser.Scene {
  private cfg: WorldSceneConfig;
  private def: SceneDef;
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private actors: { def: SceneActor; sprite: Phaser.GameObjects.Image }[] = [];
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private stick: FloatingStick;
  private touchUI: boolean;
  private ui!: Phaser.GameObjects.Graphics;
  private outlines!: Phaser.GameObjects.Graphics;
  private help!: Phaser.GameObjects.Text;
  private failed = new Set<string>();
  private privatePlayer = false;
  /** The Soldier's sheets (the encrypted art, with ASSET_KEY), when the local player hook isn't there; else null. */
  private soldier: CharacterArt | null = null;
  /** Its feet box and mirroring, sheet pixels: set in create. */
  private soldierFeet = { w: 0, h: 0, cx: 0, feet: 0, fw: 1, fh: 1 };
  private soldierLeft = false;
  private soldierPlaced = false;
  private zones: ZoneTracker;
  private walk: typeof WALK;
  private debug: WorldDebug;

  constructor(cfg: WorldSceneConfig) {
    super({ key: "world" });
    this.cfg = cfg;
    this.def = cfg.scene;
    this.touchUI = cfg.touch;
    this.walk = { ...WALK, speed: cfg.speed ?? WALK.speed };
    this.stick = new FloatingStick(cfg.layout.stick, cfg.layout);
    const start = clampToBounds(this.def.spawn, this.def.bounds, { x: FEET.w / 2, y: FEET.h / 2 });
    this.zones = new ZoneTracker(this.def.zones, start);
    this.debug = {
      scene: this.def.id, pos: start, footY: start.y + FEET.h / 2, vel: { x: 0, y: 0 }, zones: [...this.zones.current],
      facing: "down", input: { x: 0, y: 0 }, bounds: { ...this.def.bounds },
      depth: { player: 0, actors: {}, overlay: overlayDepth(this.def.size.h) },
      art: { player: "placeholder", background: "placeholder", overlay: this.def.overlay ? "placeholder" : "none", actors: {} },
      frames: 0,
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Art: private file > the def's URL or key > a generated placeholder

  /** Loader key for a scene part loaded from a file. */
  private partKey(name: string): string { return `scene:${this.def.id}:${name}`; }

  preload(): void {
    // Private art only if the files are there (listed at build time), so a clean checkout makes no requests.
    const files = privateFiles();
    const have = new Set(files);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.failed.add(file.key));
    const P = PRIVATE_PLAYER;
    if (have.has(P.idle.file) && have.has(P.walk.file)) {
      this.load.spritesheet(KEY.idle, privateUrl(P.idle.file), { frameWidth: P.frameWidth, frameHeight: P.frameHeight });
      this.load.spritesheet(KEY.walk, privateUrl(P.walk.file), { frameWidth: P.frameWidth, frameHeight: P.frameHeight });
    }
    for (const [name, value] of this.parts()) {
      const src = artSource(files, this.def.id, name, value, privateUrl);
      if (src && src.kind !== "key") this.load.image(this.partKey(name), src.url);
    }
    if (!privateSceneFile(files, this.def.id, "background")) preloadBand(this, this.def);
    // The Soldier (Big Chungus, 4 Oct), unless the local player hook above is in use.
    if (!(have.has(P.idle.file) && have.has(P.walk.file))) preloadCharacters(this, ["soldier"]);
  }

  private parts(): [string, string | undefined][] {
    const out: [string, string | undefined][] = [["background", this.def.background], ["overlay", this.def.overlay]];
    for (const a of this.def.actors ?? []) out.push([`actors/${a.id}`, a.texture]);
    return out;
  }

  private loaded(key: string): boolean {
    return this.textures.exists(key) && !this.failed.has(key);
  }

  /**
   * The texture for a scene part and where it came from. Falls back to `draw(key)`, a placeholder made under the
   * def's own key when it names one (so a key nobody loaded still shows something), else under `fallbackKey`.
   */
  private resolve(name: string, value: string | undefined, fallbackKey: string, draw: (key: string) => void): { key: string; art: Art } {
    const src = artSource(privateFiles(), this.def.id, name, value, privateUrl);
    if (src && src.kind !== "key" && this.loaded(this.partKey(name))) return { key: this.partKey(name), art: src.kind };
    if (src?.kind === "key" && this.loaded(src.key)) return { key: src.key, art: "key" };
    const key = value && !isUrl(value) ? value : fallbackKey;
    draw(key);
    return { key, art: "placeholder" };
  }

  // -------------------------------------------------------------------------------------------------------------

  create(): void {
    const { layout: L } = this.cfg;
    const def = this.def;
    const world: Phaser.GameObjects.GameObject[] = [];
    ensurePlaceholderTextures(this);
    this.privatePlayer = this.loaded(KEY.idle) && this.loaded(KEY.walk);
    this.soldier = this.privatePlayer ? null : buildCharacter(this, "soldier");
    const art = this.debug.art;
    art.player = this.privatePlayer ? "private" : this.soldier ? "soldier" : "placeholder";

    // Background, depth 0: a private file or the def's art, stretched to the scene size; else the bundled band, laid
    // along the scene (bandArt.ts), which brings its own trees, so the placeholder canopy overlay is left out.
    const band = !privateSceneFile(privateFiles(), def.id, "background") && this.loaded(bundledKey(def.id));
    if (band) {
      art.background = "bundled";
      world.push(addBand(this, def, BG_DEPTH));
    } else {
      const bg = this.resolve("background", def.background, `scene-ph:${def.id}:bg`, (k) => backgroundPlaceholder(this, k, def));
      art.background = bg.art;
      world.push(this.add.image(0, 0, bg.key).setOrigin(0, 0).setDisplaySize(def.size.w, def.size.h).setDepth(BG_DEPTH));
    }

    // Actors: feet at (x, y), origin bottom centre; y-sorted every frame.
    for (const a of def.actors ?? []) {
      const r = this.resolve(`actors/${a.id}`, a.texture, `scene-ph:actor:${a.id}`, (k) => actorPlaceholder(this, k, a.id));
      art.actors[a.id] = r.art;
      const sprite = this.add.image(a.x, a.y, r.key).setOrigin(0.5, 1);
      this.actors.push({ def: a, sprite });
      world.push(sprite);
      // Placeholder actors carry their label as a small sign above them (real art draws its own).
      if (a.label && r.art === "placeholder") {
        const sign = this.add.text(a.x, a.y - sprite.displayHeight - 2, a.label, {
          fontFamily: "system-ui, sans-serif", fontSize: "8px", color: "#ffe9b0", backgroundColor: "rgba(20,10,10,0.75)", padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 1).setResolution(4).setDepth(this.debug.depth.overlay - 1);
        world.push(sign);
      }
    }

    // Player: origin at the bottom of the feet box, so y is the feet whatever the art (the placeholder's feet box
    // ends at the frame's bottom; the private sheet's is higher up in its frame).
    this.createAnims();
    const spec = this.privatePlayer
      ? { key: KEY.idle, fw: PRIVATE_PLAYER.frameWidth, fh: PRIVATE_PLAYER.frameHeight, feet: PRIVATE_PLAYER.feet, scale: PRIVATE_PLAYER.scale }
      : this.soldier ? this.soldierSpec(this.soldier)
      : { key: PLACEHOLDER_HERO, fw: HERO_SIZE, fh: HERO_SIZE, feet: FEET, scale: 1 };
    const half = { x: (spec.scale * spec.feet.w) / 2, y: (spec.scale * spec.feet.h) / 2 };
    const start = clampToBounds(def.spawn, def.bounds, half);
    const fx = spec.scale * (spec.feet.x + spec.feet.w / 2 - spec.fw / 2);
    this.player = this.physics.add.sprite(start.x - fx, start.y + half.y, spec.key, 0);
    this.player.setOrigin(0.5, (spec.feet.y + spec.feet.h) / spec.fh).setScale(spec.scale);
    this.player.body.setSize(spec.feet.w, spec.feet.h, false).setOffset(spec.feet.x, spec.feet.y);
    if (this.soldier) this.player.setOrigin(this.soldierFeet.cx / this.soldierFeet.fw, this.soldierFeet.feet / this.soldierFeet.fh);
    // The playable rect, not the texture size: the feet box can't leave it.
    this.physics.world.setBounds(def.bounds.x, def.bounds.y, def.bounds.w, def.bounds.h);
    this.player.setCollideWorldBounds(true);
    this.setPose(false);
    world.push(this.player);

    // Overlay above every actor (not over the bundled band: see above).
    if (band) art.overlay = "none";
    else if (def.overlay) {
      const ov = this.resolve("overlay", def.overlay, `scene-ph:${def.id}:overlay`, (k) => overlayPlaceholder(this, k, def));
      art.overlay = ov.art;
      world.push(this.add.image(0, 0, ov.key).setOrigin(0, 0).setDisplaySize(def.size.w, def.size.h).setDepth(this.debug.depth.overlay));
    }
    this.outlines = this.add.graphics().setDepth(this.debug.depth.overlay + 1).setVisible(this.cfg.outlines === true);
    world.push(this.outlines);
    this.sortDepths();

    // Cameras: the zoomed world camera follows, clamped to the texture; the UI camera is 1:1 over the canvas.
    const cam = this.cameras.main;
    const viewW = L.width / L.zoom;
    const viewH = L.height / L.zoom;
    const { w: worldW, h: worldH } = def.size;
    // A scene smaller than the view is centred: widen the bounds evenly around it on that axis.
    const bx = Math.min(0, (worldW - viewW) / 2);
    const by = Math.min(0, (worldH - viewH) / 2);
    cam.setZoom(L.zoom).setBounds(bx, by, Math.max(worldW, viewW), Math.max(worldH, viewH)).setRoundPixels(true);
    cam.startFollow(this.player, true, 1, 1); // no follow lag: a lagging camera reads as a slow start
    cam.centerOn(this.player.x, this.player.y);
    this.ui = this.add.graphics().setDepth(10);
    const font = { fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ddd", stroke: "#000", strokeThickness: 4 };
    this.help = this.add.text(L.width / 2, L.height - 12, "Walk: WASD / arrow keys", font).setOrigin(0.5, 1).setDepth(10);
    const uiCam = this.cameras.add(0, 0, L.width, L.height, false, "ui");
    cam.ignore([this.ui, this.help]);
    uiCam.ignore(world);

    // Keys: WASD are not captured (typing in a text box still works); arrows are, so they don't scroll the page.
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT", false) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.addCapture("UP,DOWN,LEFT,RIGHT");

    // Touch: the floating stick grabs anywhere (no buttons yet).
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { if (p.wasTouch) { this.touchUI = true; this.stick.grab(p); } });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => { this.stick.move(p); });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => { this.stick.release(p); });
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => { this.stick.release(p); });

    this.cfg.onDebug?.(this.debug);
    if (this.cfg.outlines) this.drawOutlines();
    this.drawUI();
  }

  /** Show or hide the debug outlines (bounds, zones, feet box). */
  setOutlines(on: boolean): void {
    this.cfg.outlines = on;
    if (!this.outlines) return;
    this.outlines.setVisible(on);
    if (on) this.drawOutlines();
  }

  private createAnims(): void {
    const A = this.anims;
    for (const f of HERO_ROWS) {
      const row = HERO_ROWS.indexOf(f) * HERO_COLS;
      const key = `ph-walk-${f}`;
      if (!A.exists(key)) A.create({ key, frames: A.generateFrameNumbers(PLACEHOLDER_HERO, { frames: [row + 1, row, row + 2, row] }), frameRate: 8, repeat: -1 });
    }
    if (!this.privatePlayer) return;
    const P = PRIVATE_PLAYER;
    const rows: readonly Facing[] = P.layout === "four" ? HERO_ROWS : ["right"];
    for (const [name, a, key] of [["idle", P.idle, KEY.idle], ["walk", P.walk, KEY.walk]] as const) {
      rows.forEach((f, r) => {
        const k = `pv-${name}-${f}`;
        if (!A.exists(k)) A.create({ key: k, frames: A.generateFrameNumbers(key, { start: r * a.frames, end: r * a.frames + a.frames - 1 }), frameRate: a.fps, repeat: -1 });
      });
    }
  }

  /**
   * The Soldier's spec, like PRIVATE_PLAYER's: its idle frame, a feet box as wide as the generated hero's (in world
   * pixels) under the visible figure, and the scale that makes the figure the hero's height.
   */
  private soldierSpec(art: CharacterArt): { key: string; fw: number; fh: number; feet: { w: number; h: number; x: number; y: number }; scale: number } {
    const fig = art.idle.fig, fw = art.idle.fw, fh = art.idle.fh;
    const scale = fitScale(fig.h, roleArt("player")?.height ?? HERO_SIZE);
    const w = Math.max(1, Math.round(FEET.w / scale)), h = Math.max(1, Math.round(FEET.h / scale));
    const cx = fig.x + fig.w / 2, feet = fig.y + fig.h;
    this.soldierFeet = { w, h, cx, feet, fw, fh };
    // The start position below assumes origin x 0.5; the figure's own centre is used instead (setOrigin after), so the
    // feet box is given centred on the frame here and moved under the figure once the sprite exists.
    return { key: art.idle.key, fw, fh, feet: { w, h, x: fw / 2 - w / 2, y: feet - h }, scale };
  }

  /** The Soldier mirrors around its figure: origin and feet box follow it (the body stays put under the feet). */
  private faceSoldier(left: boolean): void {
    const F = this.soldierFeet, pl = this.player;
    const cx = left ? F.fw - F.cx : F.cx;
    pl.setFlipX(left).setOrigin(cx / F.fw, F.feet / F.fh);
    pl.body.setOffset(cx - F.w / 2, F.feet - F.h);
  }

  /** Pick the animation (or still frame) for the current facing and whether we're walking. */
  private setPose(walking: boolean): void {
    const f = this.debug.facing;
    const pl = this.player;
    if (this.soldier) {
      // Side view: left mirrors; up and down keep the last side.
      if (f === "left" || f === "right") this.soldierLeft = f === "left";
      if (pl.flipX !== this.soldierLeft || !this.soldierPlaced) { this.faceSoldier(this.soldierLeft); this.soldierPlaced = true; }
      const keys = this.soldier.anims[walking ? "walk" : "idle"] ?? this.soldier.anims.idle!;
      pl.anims.play(keys[0], true);
      return;
    }
    if (this.privatePlayer) {
      const side = PRIVATE_PLAYER.layout === "side";
      pl.setFlipX(side && f === "left");
      pl.anims.play(`pv-${walking ? "walk" : "idle"}-${side ? "right" : f}`, true);
      return;
    }
    if (walking) pl.anims.play(`ph-walk-${f}`, true);
    else {
      pl.anims.stop();
      pl.setFrame(HERO_ROWS.indexOf(f) * HERO_COLS);
    }
  }

  /** Y-sort: the player (by the bottom of its feet box) and every actor (by its sprite's bottom). */
  private sortDepths(): void {
    const d = this.debug.depth;
    const pf = this.player.body.bottom;
    this.player.setDepth(actorDepth(pf));
    d.player = this.player.depth;
    this.debug.footY = pf;
    for (const { def, sprite } of this.actors) {
      sprite.setDepth(actorDepth(footY(sprite.y, sprite.displayHeight, sprite.originY)));
      d.actors[def.id] = sprite.depth;
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    const k = this.keys;
    const typing = isTyping();
    let dir = typing ? { x: 0, y: 0 } : moveDir({
      up: k.W.isDown || k.UP.isDown, down: k.S.isDown || k.DOWN.isDown,
      left: k.A.isDown || k.LEFT.isDown, right: k.D.isDown || k.RIGHT.isDown,
    });
    const s = this.stick.dir();
    if (s.x !== 0 || s.y !== 0) dir = s;

    const body = this.player.body;
    const v = stepVelocity({ x: body.velocity.x, y: body.velocity.y }, dir, dt, this.walk);
    body.setVelocity(v.x, v.y);
    const d = this.debug;
    d.facing = facingOf(dir, d.facing);
    d.input = dir;
    d.vel = v;
    this.setPose(Math.hypot(v.x, v.y) > WALK.animMin);
    this.sortDepths();

    // Zones under the feet: each entry and exit is reported once.
    const feet = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
    d.pos = feet;
    const { entered, left } = this.zones.update(feet);
    d.zones = [...this.zones.current];
    for (const z of left) this.cfg.onLeaveZone?.(z, this.def);
    for (const z of entered) this.cfg.onEnterZone?.(z, this.def);
    d.frames++;
    if (this.cfg.outlines) this.drawOutlines();
    this.drawUI();
  }

  private drawOutlines(): void {
    const g = this.outlines.clear();
    const b = this.def.bounds;
    g.lineStyle(1, 0xffe066, 1).strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    for (const z of this.def.zones ?? []) {
      const inside = this.zones.current.includes(z.id);
      const colour = z.kind === "exit" ? 0xff6655 : z.kind === "shop" ? 0xffd27a : 0x66ccff;
      g.lineStyle(1, colour, inside ? 1 : 0.6).strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
      if (inside) g.fillStyle(colour, 0.2).fillRect(z.x, z.y, z.w, z.h);
    }
    // Enemy spawn points of a fight scene (the forest path), as small pink rings.
    for (const sp of this.def.spawns ?? []) g.lineStyle(1, 0xff7ad9, 0.9).strokeCircle(sp.x, sp.y, 4);
    const body = this.player.body;
    g.lineStyle(1, 0xffffff, 1).strokeRect(body.x, body.y, body.width, body.height);
  }

  private drawUI(): void {
    this.ui.clear();
    this.help.setVisible(this.cfg.help !== false && !this.touchUI);
    if (this.touchUI) this.stick.draw(this.ui);
  }
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
