import Phaser from "phaser";
import { moveDir, type Vec } from "../input/dir";
import { FloatingStick } from "../input/stick";
import { PRIVATE_PLAYER, PRIVATE_TILESET, privateFiles, privateUrl } from "./assets";
import { FEET, WALK, facingOf, stepVelocity, type Facing, type WorldLayout } from "./logic";
import { HERO_COLS, HERO_ROWS, HERO_SIZE, PLACEHOLDER_HERO, PLACEHOLDER_TILES, ensurePlaceholderTextures } from "./textures";
import { BLOCKING_IDS, TILE_SIZE, tileAt, tileCenter, tileName, toRows, toTile, type WorldMap } from "./tiles";

/** Live, read-only view of the scene for dev pages and smoke tests. */
export interface WorldDebug {
  /** Feet position, world pixels. */
  pos: Vec;
  vel: Vec;
  /** Tile under the feet. */
  tile: { x: number; y: number; id: number; name: string };
  facing: Facing;
  /** Movement input this frame (unit or zero). */
  input: Vec;
  /** Which art is in use. */
  art: { player: "private" | "placeholder"; tiles: "private" | "placeholder" };
  frames: number;
}

export interface WorldSceneConfig {
  map: WorldMap;
  layout: WorldLayout;
  /** Show the touch stick from the start (it also appears on the first touch). */
  touch: boolean;
  /** Outline the tile under the player (dev page). */
  showTile?: boolean;
  onEnterTile?: (tileId: number, x: number, y: number) => void;
  onDebug?: (debug: WorldDebug) => void;
}

type KeyName = "W" | "A" | "S" | "D" | "UP" | "DOWN" | "LEFT" | "RIGHT";

const KEY = { tiles: "priv-tiles", idle: "priv-player-idle", walk: "priv-player-walk" };

/**
 * Top-down walking around a tile map. The map is one Phaser tilemap layer whose blocking tiles collide with the
 * player's Arcade body (a small box at the feet, so one-tile gaps fit). The main camera is zoomed (integer, crisp)
 * and follows the player inside the map bounds; a second, unzoomed camera draws the touch stick and the help text.
 */
export class WorldScene extends Phaser.Scene {
  private cfg: WorldSceneConfig;
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private stick: FloatingStick;
  private touchUI: boolean;
  private ui!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Graphics;
  private help!: Phaser.GameObjects.Text;
  private failed = new Set<string>();
  private privatePlayer = false;
  private debug: WorldDebug;

  constructor(cfg: WorldSceneConfig) {
    super({ key: "world" });
    this.cfg = cfg;
    this.touchUI = cfg.touch;
    this.stick = new FloatingStick(cfg.layout.stick, cfg.layout);
    const s = cfg.map.spawn;
    this.debug = {
      pos: { x: tileCenter(s.x), y: tileCenter(s.y) }, vel: { x: 0, y: 0 },
      tile: { x: s.x, y: s.y, id: tileAt(cfg.map, s.x, s.y), name: tileName(tileAt(cfg.map, s.x, s.y)) },
      facing: "down", input: { x: 0, y: 0 }, art: { player: "placeholder", tiles: "placeholder" }, frames: 0,
    };
  }

  preload(): void {
    // Private art only if the files are there (listed at build time), so a clean checkout makes no requests.
    const have = new Set(privateFiles());
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.failed.add(file.key));
    if (have.has(PRIVATE_TILESET.file)) this.load.image(KEY.tiles, privateUrl(PRIVATE_TILESET.file));
    const P = PRIVATE_PLAYER;
    if (have.has(P.idle.file) && have.has(P.walk.file)) {
      this.load.spritesheet(KEY.idle, privateUrl(P.idle.file), { frameWidth: P.frameWidth, frameHeight: P.frameHeight });
      this.load.spritesheet(KEY.walk, privateUrl(P.walk.file), { frameWidth: P.frameWidth, frameHeight: P.frameHeight });
    }
  }

  private loaded(key: string): boolean {
    return this.textures.exists(key) && !this.failed.has(key);
  }

  create(): void {
    const { map, layout: L } = this.cfg;
    ensurePlaceholderTextures(this);
    this.privatePlayer = this.loaded(KEY.idle) && this.loaded(KEY.walk);
    const privateTiles = this.loaded(KEY.tiles);
    this.debug.art = { player: this.privatePlayer ? "private" : "placeholder", tiles: privateTiles ? "private" : "placeholder" };

    // Tiles: one layer, ids = tileset frames; blocking ids collide.
    const tm = this.make.tilemap({ data: toRows(map), tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = tm.addTilesetImage("tiles", privateTiles ? KEY.tiles : PLACEHOLDER_TILES, TILE_SIZE, TILE_SIZE, 0, 0)!;
    const layer = tm.createLayer(0, tileset, 0, 0)!;
    layer.setCollision(BLOCKING_IDS);
    const worldW = map.width * TILE_SIZE;
    const worldH = map.height * TILE_SIZE;

    // Player.
    this.createAnims();
    const spec = this.privatePlayer
      ? { key: KEY.idle, fw: PRIVATE_PLAYER.frameWidth, fh: PRIVATE_PLAYER.frameHeight, feet: PRIVATE_PLAYER.feet, scale: PRIVATE_PLAYER.scale }
      : { key: PLACEHOLDER_HERO, fw: HERO_SIZE, fh: HERO_SIZE, feet: FEET, scale: 1 };
    // Place the sprite so the centre of its feet box sits on the spawn tile's centre (origin is the frame centre).
    const fx = spec.scale * (spec.feet.x + spec.feet.w / 2 - spec.fw / 2);
    const fy = spec.scale * (spec.feet.y + spec.feet.h / 2 - spec.fh / 2);
    this.player = this.physics.add.sprite(tileCenter(map.spawn.x) - fx, tileCenter(map.spawn.y) - fy, spec.key, 0);
    this.player.setScale(spec.scale).setDepth(1);
    this.player.body.setSize(spec.feet.w, spec.feet.h, false).setOffset(spec.feet.x, spec.feet.y);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.physics.add.collider(this.player, layer);
    this.setPose(false);

    this.marker = this.add.graphics().setDepth(2).setVisible(this.cfg.showTile === true);

    // Cameras: the zoomed world camera follows; the UI camera is 1:1 over the whole canvas.
    const cam = this.cameras.main;
    cam.setZoom(L.zoom).setBounds(0, 0, worldW, worldH).setRoundPixels(true);
    cam.startFollow(this.player, true, 0.2, 0.2);
    cam.centerOn(this.player.x, this.player.y);
    this.ui = this.add.graphics().setDepth(10);
    const font = { fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ddd", stroke: "#000", strokeThickness: 4 };
    this.help = this.add.text(L.width / 2, L.height - 12, "Walk: WASD / arrow keys", font).setOrigin(0.5, 1).setDepth(10);
    const uiCam = this.cameras.add(0, 0, L.width, L.height, false, "ui");
    cam.ignore([this.ui, this.help]);
    uiCam.ignore([layer, this.player, this.marker]);

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
    this.drawUI();
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

  /** Pick the animation (or still frame) for the current facing and whether we're walking. */
  private setPose(walking: boolean): void {
    const f = this.debug.facing;
    const pl = this.player;
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
    const v = stepVelocity({ x: body.velocity.x, y: body.velocity.y }, dir, dt);
    body.setVelocity(v.x, v.y);
    const d = this.debug;
    d.facing = facingOf(dir, d.facing);
    d.input = dir;
    d.vel = v;
    this.setPose(Math.hypot(v.x, v.y) > WALK.animMin);

    // Tile under the feet: report changes.
    const cx = body.x + body.width / 2;
    const cy = body.y + body.height / 2;
    d.pos = { x: cx, y: cy };
    const tx = toTile(cx);
    const ty = toTile(cy);
    if (tx !== d.tile.x || ty !== d.tile.y) {
      const id = tileAt(this.cfg.map, tx, ty);
      d.tile = { x: tx, y: ty, id, name: tileName(id) };
      this.cfg.onEnterTile?.(id, tx, ty);
    }
    d.frames++;
    if (this.cfg.showTile) this.marker.clear().lineStyle(1, 0xffe066, 0.9).strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    this.drawUI();
  }

  private drawUI(): void {
    this.ui.clear();
    this.help.setVisible(!this.touchUI);
    if (this.touchUI) this.stick.draw(this.ui);
  }
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
