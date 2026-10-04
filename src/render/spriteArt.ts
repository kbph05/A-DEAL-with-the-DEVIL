/**
 * The Phaser side of the sprite registry (sprites.ts): load a character's sheets when the build lists them (only with
 * ASSET_KEY, docs/assets.md), cut them into frames from their real size, measure the visible figure, make the
 * animations, and drive one sprite from an actor's state. Everything here degrades to "no art": a sheet that is not
 * listed, fails to load, or throws while being cut leaves the role on its generated art (the callers check for null).
 */
import type Phaser from "phaser";
import { privateFiles } from "../world/assets";
import {
  CHARACTERS, FRAME_OVERRIDES, PLAYS_ONCE, WARRIOR_RUN, characterFiles, characterListed, detectCharacterFrames, detectFrames, feetOrigin,
  opaqueBBox, privateAssetUrl, unionBox, type AnimName, type Box, type CharacterId, type FrameLayout, type SheetRef,
} from "./sprites";

export const sheetKey = (file: string): string => `spr:${file}`;

/** Ask the loader for every listed sheet of these characters. No key, no listing, no request. */
export function preloadCharacters(scene: Phaser.Scene, ids: Iterable<CharacterId>): void {
  const files = privateFiles();
  for (const id of new Set(ids)) {
    if (!characterListed(id, files)) continue;
    for (const f of characterFiles(id)) {
      if (files.includes(f) && !scene.textures.exists(sheetKey(f))) scene.load.image(sheetKey(f), privateAssetUrl(f, import.meta.env.BASE_URL));
    }
  }
}

export interface SheetInfo { key: string; file: string; fw: number; fh: number; frames: number; fig: Box }

export interface CharacterArt {
  id: CharacterId;
  /** Animation keys per state; attack (and heavy) may have several, cycled. */
  anims: Partial<Record<AnimName, string[]>>;
  /** The warrior's run, if loaded. */
  run: string | null;
  sheets: Map<string, SheetInfo>;
  /** The idle sheet: its frame size and the visible figure (the union over its frames). */
  idle: SheetInfo;
  /** Where each sheet's feet and centre are (normalised origin), facing right. */
  origin: Map<string, { cx: number; feet: number }>;
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

const sourceOf = (scene: Phaser.Scene, file: string): HTMLImageElement | HTMLCanvasElement | null =>
  scene.textures.exists(sheetKey(file)) ? (scene.textures.get(sheetKey(file)).getSourceImage() as HTMLImageElement | HTMLCanvasElement) : null;

/** Cut one loaded sheet into frames (its layout from `detectCharacterFrames`) and measure its figure. Null if it isn't loaded. */
function cutSheet(scene: Phaser.Scene, ref: SheetRef, layouts: Map<string, FrameLayout>): SheetInfo | null {
  const key = sheetKey(ref.file);
  const img = sourceOf(scene, ref.file);
  if (!img) return null;
  const tex = scene.textures.get(key);
  const L = layouts.get(ref.file) ?? detectFrames(img.width, img.height, FRAME_OVERRIDES[ref.file]);
  if (L.odd) warnOnce(`sprites: ${ref.file} is ${img.width}×${img.height}: ${L.odd}`);
  else if (ref.file.startsWith(CHARACTERS.warrior.pack)) console.info(`sprites: ${ref.file} ${img.width}×${img.height} → ${L.frames} frames of ${L.frameWidth}×${L.frameHeight}`);
  for (let i = 0; i < L.frames; i++) if (!tex.has(String(i))) tex.add(String(i), 0, i * L.frameWidth, 0, L.frameWidth, L.frameHeight);
  let fig: Box | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      fig = unionBox(Array.from({ length: L.frames }, (_, i) => opaqueBBox(data, img.width, i * L.frameWidth, 0, L.frameWidth, L.frameHeight)));
    }
  } catch { /* unreadable pixels: use the whole frame */ }
  if (!fig) {
    warnOnce(`sprites: ${ref.file}: no visible pixels measured, using the whole frame`);
    fig = { x: 0, y: 0, w: L.frameWidth, h: L.frameHeight };
  }
  return { key, file: ref.file, fw: L.frameWidth, fh: L.frameHeight, frames: L.frames, fig };
}

function makeAnim(scene: Phaser.Scene, animKey: string, s: SheetInfo, fps: number, once: boolean): string {
  if (!scene.anims.exists(animKey)) {
    scene.anims.create({ key: animKey, frames: Array.from({ length: s.frames }, (_, i) => ({ key: s.key, frame: String(i) })), frameRate: fps, repeat: once ? 0 : -1 });
  }
  return animKey;
}

/** Build a character from its loaded sheets: frames, figure, animations. Null (generated art) if its idle sheet is missing or anything throws. */
export function buildCharacter(scene: Phaser.Scene, id: CharacterId): CharacterArt | null {
  try {
    const def = CHARACTERS[id];
    const sizes = characterFiles(id).map((file) => ({ file, img: sourceOf(scene, file) }))
      .filter((x): x is { file: string; img: HTMLImageElement | HTMLCanvasElement } => x.img !== null)
      .map(({ file, img }) => ({ file, w: img.width, h: img.height }));
    const layouts = detectCharacterFrames(sizes);
    const idle = cutSheet(scene, def.anims.idle[0], layouts);
    if (!idle) return null;
    const art: CharacterArt = { id, anims: {}, run: null, sheets: new Map([[idle.key, idle]]), idle, origin: new Map() };
    for (const [name, refs] of Object.entries(def.anims) as [AnimName, SheetRef[]][]) {
      const keys: string[] = [];
      refs.forEach((ref, i) => {
        const s = name === "idle" && i === 0 ? idle : cutSheet(scene, ref, layouts);
        if (!s) return;
        art.sheets.set(s.key, s);
        keys.push(makeAnim(scene, `spr:${id}:${name}:${i}`, s, ref.fps, PLAYS_ONCE.has(name)));
      });
      if (keys.length) art.anims[name] = keys;
    }
    if (id === "warrior") {
      const s = cutSheet(scene, WARRIOR_RUN, layouts);
      if (s) { art.sheets.set(s.key, s); art.run = makeAnim(scene, `spr:${id}:run`, s, WARRIOR_RUN.fps, false); }
    }
    // Origins: a sheet on the idle sheet's frame grid shares its feet and centre (the artist's grid); another size
    // keeps the idle figure's offset from the frame centre and stands on its own lowest pixels.
    const dx = idle.fig.x + idle.fig.w / 2 - idle.fw / 2;
    const feetIdle = idle.fig.y + idle.fig.h;
    for (const s of art.sheets.values()) {
      const same = s.fw === idle.fw && s.fh === idle.fh;
      art.origin.set(s.key, { cx: (s.fw / 2 + dx) / s.fw, feet: (same ? feetIdle : s.fig.y + s.fig.h) / s.fh });
    }
    return art;
  } catch (err) {
    warnOnce(`sprites: ${id} could not be set up (${err instanceof Error ? err.message : String(err)}); using the generated art`);
    return null;
  }
}

/** The visible figure's height (sheet pixels), for the scale; null when the character has no art. */
export const figureHeight = (art: CharacterArt | null | undefined): number | null => (art ? art.idle.fig.h : null);

export interface PlayOptions {
  /** Play over this long (attacks timed to the telegraph and lunge). */
  durationMs?: number;
  /** Start it again even if it is already playing (a new swing). */
  restart?: boolean;
  /** Chasing fast: the warrior runs instead of walking. */
  run?: boolean;
}

/** Drives one sprite from an actor's state: animation, mirroring around the figure, scale, the figure's top. */
export class ActorSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly art: CharacterArt;
  readonly scale: number;
  private current: AnimName | null = null;
  private variants: Partial<Record<AnimName, number>> = {};
  flipped = false;

  constructor(scene: Phaser.Scene, art: CharacterArt, scale: number) {
    this.art = art;
    this.scale = scale;
    this.sprite = scene.add.sprite(0, 0, art.idle.key, "0").setScale(scale);
    this.play("idle");
  }

  has = (a: AnimName): boolean => !!this.art.anims[a]?.length;

  play(anim: AnimName, opts: PlayOptions = {}): void {
    const keys = this.art.anims[anim] ?? this.art.anims.idle!;
    const fresh = anim !== this.current || opts.restart === true;
    if (fresh) {
      this.variants[anim] = ((this.variants[anim] ?? -1) + 1) % keys.length; // attacks cycle: Attack01, 02, 03, ...
      this.current = anim;
    }
    const key = anim === "walk" && opts.run && this.art.run ? this.art.run : keys[(this.variants[anim] ?? 0) % keys.length];
    if (!fresh && this.sprite.anims.currentAnim?.key === key) return;
    if (opts.durationMs && PLAYS_ONCE.has(anim)) this.sprite.play({ key, duration: opts.durationMs });
    else this.sprite.play(key);
  }

  get anim(): AnimName | null { return this.current; }
  /** The once-only animation (attack, hurt, death) reached its last frame. */
  get done(): boolean { return !this.sprite.anims.isPlaying; }

  /** Place it with its feet at (x, y), facing left when `flip`, at `k` times its base scale. */
  place(x: number, y: number, flip: boolean, k = 1): void {
    this.flipped = flip;
    const o = this.art.origin.get(this.sprite.texture.key) ?? { cx: 0.5, feet: 1 };
    this.sprite.setPosition(x, y).setFlipX(flip).setOrigin(flip ? 1 - o.cx : o.cx, o.feet).setScale(this.scale * k);
  }

  /** The figure's height and width on screen (world pixels) at the current scale. */
  get figureH(): number { return this.art.idle.fig.h * Math.abs(this.sprite.scaleY); }
  get figureW(): number { return this.art.idle.fig.w * Math.abs(this.sprite.scaleX); }
  /** World y of the top of the visible figure. */
  get top(): number { return this.sprite.y - this.figureH; }
}

/** Where the figure stands in the idle frame, for a body that mirrors with it (the world scene's Arcade body). */
export function idleFeet(art: CharacterArt, flipped: boolean): { x: number; y: number } {
  return feetOrigin(art.idle.fig, art.idle.fw, art.idle.fh, flipped);
}
