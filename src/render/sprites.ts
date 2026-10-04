/**
 * The sprite registry (Big Chungus, 4 Oct: "extract the metadata from these assets and apply them to enemies"). Pure
 * data and maths, no Phaser: which licensed sheet draws which role, how a sheet is cut into frames, where the visible
 * figure sits in a frame, and which animation an actor's state plays. The Phaser side is `spriteArt.ts`; the sheets
 * are the encrypted art in assets/encrypted/ (docs/assets.md), served at /assets/private/<path> only with ASSET_KEY.
 * Without the key (or if a sheet fails to load) every role keeps today's generated art.
 *
 * The mapping, as asked (Big Chungus, with his correction: "the orc is small and should be used as a normal enemy"):
 *
 * | Role | Character | Size |
 * | --- | --- | --- |
 * | the player | Soldier (Tiny RPG pack 01) | PIXEL_SCALE |
 * | orc (every regular enemy) | Orc (pack 01) | PIXEL_SCALE |
 * | miniboss1, miniboss2 | Demon_A (pack 02) | PIXEL_SCALE × 1.25 |
 * | final_boss | WarriorCh (WarriorChAnimation) | PIXEL_SCALE |
 * | demon (lab only now) | Demon_A | PIXEL_SCALE |
 *
 * Sizes (Big Chungus, 4 Oct: "make sure pixel sizes are standardized"): every sheet is drawn at PIXEL_SCALE world
 * pixels per sheet pixel, the same as the scene backgrounds (src/render/pixelScale.ts), so the artist's relative sizes
 * hold and a sprite's pixels match the ground's. No fitting to a target height any more.
 * | slime, skeleton archer | none: generated art (they are out of the encounter tables) | |
 *
 * Frame sizes are NOT hard-coded: they are worked out from each loaded image (`detectFrames`), with an override table
 * (`FRAME_OVERRIDES`) for a sheet that turns out to differ. UNVERIFIED against the real files (built without the key).
 */
import type { EnemyId } from "../fight/enemies";
import { PIXEL_SCALE } from "./pixelScale";

// ---------------------------------------------------------------------------------------------------------------
// The sheets

export const PACK1 = "Tiny RPG Character Asset Pack 01";
export const PACK2 = "Tiny RPG Character Asset Pack 02";
export const PACK_WARRIOR = "WarriorChAnimation";
export const PACKS = [PACK1, PACK2, PACK_WARRIOR] as const;

/** What an actor can be doing. `heavy`: the warrior's telegraphed big hit (the boss burst). */
export type AnimName = "idle" | "walk" | "attack" | "heavy" | "hurt" | "death";

export interface SheetRef {
  /** Path under /assets/private/ (and in assets/encrypted/manifest.json), with "/". */
  file: string;
  fps: number;
}

export interface CharacterDef {
  id: CharacterId;
  pack: (typeof PACKS)[number];
  /** Every animation's sheets; several sheets (attack) are cycled, one per attack. idle is required, the rest optional. */
  anims: Partial<Record<AnimName, SheetRef[]>> & { idle: SheetRef[] };
}

export type CharacterId = "soldier" | "orc" | "demon_a" | "warrior";

const tiny = (pack: (typeof PACKS)[number], name: string, anim: string, fps: number): SheetRef => ({ file: `${pack}/${name}_${anim}.png`, fps });
const warrior = (anim: string, fps: number): SheetRef => ({ file: `${PACK_WARRIOR}/WarriorCh${anim}.png`, fps });

export const CHARACTERS: Readonly<Record<CharacterId, CharacterDef>> = {
  soldier: {
    id: "soldier", pack: PACK1,
    anims: {
      idle: [tiny(PACK1, "Soldier", "Idle", 8)], walk: [tiny(PACK1, "Soldier", "Walk", 12)],
      attack: [tiny(PACK1, "Soldier", "Attack01", 14), tiny(PACK1, "Soldier", "Attack02", 14), tiny(PACK1, "Soldier", "Attack03", 14)],
      hurt: [tiny(PACK1, "Soldier", "Hurt", 12)], death: [tiny(PACK1, "Soldier", "Death", 10)],
    },
  },
  orc: {
    id: "orc", pack: PACK1,
    anims: {
      idle: [tiny(PACK1, "Orc", "Idle", 8)], walk: [tiny(PACK1, "Orc", "Walk", 10)],
      attack: [tiny(PACK1, "Orc", "Attack01", 12), tiny(PACK1, "Orc", "Attack02", 12)],
      hurt: [tiny(PACK1, "Orc", "Hurt", 12)], death: [tiny(PACK1, "Orc", "Death", 10)],
    },
  },
  demon_a: {
    id: "demon_a", pack: PACK2,
    anims: {
      idle: [tiny(PACK2, "Demon_A", "Idle", 8)], walk: [tiny(PACK2, "Demon_A", "Walk", 10)],
      attack: [tiny(PACK2, "Demon_A", "Attack01", 12), tiny(PACK2, "Demon_A", "Attack02", 12)],
      hurt: [tiny(PACK2, "Demon_A", "Hurt", 12)], death: [tiny(PACK2, "Demon_A", "Death", 10)],
    },
  },
  warrior: {
    // No hurt or death sheets in this pack: a hit flashes white, and death fades out (as the generated art does).
    id: "warrior", pack: PACK_WARRIOR,
    anims: {
      idle: [warrior("Idle", 8)], walk: [warrior("Walk", 10)],
      attack: [warrior("Attack", 12), warrior("Attack2", 12), warrior("Attack3", 12)],
      heavy: [warrior("Heavy", 10)],
    },
  },
};

/** The run animation: the warrior uses it when it chases faster than this (units/s). Others walk. */
export const WARRIOR_RUN: SheetRef = warrior("HRun", 12);

/** Every sheet a character uses (its anims, plus the warrior's run). */
export function characterFiles(id: CharacterId): string[] {
  const c = CHARACTERS[id];
  const files = Object.values(c.anims).flatMap((refs) => (refs ?? []).map((r) => r.file));
  if (id === "warrior") files.push(WARRIOR_RUN.file);
  return [...new Set(files)];
}

/** The credits file of a pack (served like the PNGs, docs/assets.md). */
export const attributionFile = (pack: string): string => `${pack}/attribution.txt`;

// ---------------------------------------------------------------------------------------------------------------
// Roles

/** Who is drawn: the player, or a roster enemy (src/fight/enemies.ts). */
export type RoleId = "player" | EnemyId;

export interface RoleArt {
  character: CharacterId;
  /** A boss's size multiplier on top of PIXEL_SCALE (minibosses: 1.25). Default 1. */
  mult?: number;
}

/** Role → sheet. A role that is missing (slime, skeleton archer) keeps its generated art. */
export const ROLES: Readonly<Partial<Record<RoleId, RoleArt>>> = {
  player: { character: "soldier" },
  orc: { character: "orc" },
  demon: { character: "demon_a" },
  miniboss1: { character: "demon_a", mult: 1.25 },
  miniboss2: { character: "demon_a", mult: 1.25 },
  final_boss: { character: "warrior" },
};

export const roleArt = (role: RoleId): RoleArt | null => ROLES[role] ?? null;

/**
 * Whether a character's art can be used: its idle sheet must be among the private files the build lists
 * (`__PRIVATE_ASSETS__`: present only with ASSET_KEY or a local public/assets/private/). The other sheets are optional.
 */
export const characterListed = (id: CharacterId, files: readonly string[]): boolean => CHARACTERS[id].anims.idle.every((r) => files.includes(r.file));

/** The packs to credit: those with at least one sheet listed. */
export function listedPacks(files: readonly string[]): string[] {
  return PACKS.filter((p) => files.some((f) => f.startsWith(`${p}/`) && /\.png$/i.test(f)));
}

/**
 * The URL of a private file, each path segment percent-encoded (the pack folders have spaces, "Arrow01(32x32).png"
 * has parentheses). The Vite plugin decodes it with decodeURIComponent. `base` is import.meta.env.BASE_URL.
 */
export function privateAssetUrl(file: string, base = "/"): string {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}assets/private/${file.split("/").map(encodeURIComponent).join("/")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cutting a sheet into frames

export interface FrameLayout {
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** How it was found. */
  how: "override" | "square" | "candidate" | "single";
  /** Set when the layout looks odd: worth a one-line console warning. */
  odd: string | null;
}

export interface FrameOverride { frameWidth?: number; frameHeight?: number; frames?: number }

/**
 * Per-file overrides, for a sheet the detection gets wrong. Empty: none was needed as far as anyone could check (the
 * sheets were not decrypted when this was written). Example: `"WarriorChAnimation/WarriorChIdle.png": { frameWidth: 69 }`.
 */
export const FRAME_OVERRIDES: Readonly<Record<string, FrameOverride>> = {};

/** Frame widths to try when a sheet isn't a strip of square frames (common sizes, nearest the height first). */
export const CANDIDATE_WIDTHS: readonly number[] = [64, 69, 80, 96, 100, 128];

/** More frames than this in one strip is suspicious. */
const MAX_FRAMES = 30;

/**
 * How a horizontal strip of `w × h` cuts into frames. Tiny RPG sheets are strips of square frames (frame height =
 * image height, count = width / height). Otherwise: a candidate width that divides the width, the one closest to the
 * height (frames tend to be near square); failing that, the whole image is one frame. `override` wins.
 */
export function detectFrames(w: number, h: number, override?: FrameOverride): FrameLayout {
  const W = Math.max(0, Math.floor(w)), H = Math.max(0, Math.floor(h));
  if (W === 0 || H === 0) return { frameWidth: Math.max(1, W), frameHeight: Math.max(1, H), frames: 1, how: "single", odd: `empty image (${W}×${H})` };
  if (override && (override.frameWidth || override.frames)) {
    const fh = Math.min(H, override.frameHeight ?? H);
    const fw = override.frameWidth ?? Math.floor(W / Math.max(1, override.frames!));
    const frames = Math.max(1, override.frames ?? Math.floor(W / Math.max(1, fw)));
    return { frameWidth: Math.max(1, fw), frameHeight: fh, frames, how: "override", odd: W % fw !== 0 ? `override: ${W} is not a multiple of ${fw}` : null };
  }
  if (W % H === 0) {
    const frames = W / H;
    return { frameWidth: H, frameHeight: H, frames, how: "square", odd: frames > MAX_FRAMES ? `${frames} square frames looks too many` : null };
  }
  const fits = CANDIDATE_WIDTHS.filter((c) => c <= W && W % c === 0).sort((a, b) => Math.abs(a - H) - Math.abs(b - H) || a - b);
  if (fits.length > 0) {
    const fw = fits[0];
    return { frameWidth: fw, frameHeight: H, frames: W / fw, how: "candidate", odd: `not square frames: guessed ${fw}×${H} (${W / fw} frames)${fits.length > 1 ? `; ${fits.slice(1).join(", ")} also divide ${W}` : ""}` };
  }
  return { frameWidth: W, frameHeight: H, frames: 1, how: "single", odd: `${W}×${H}: no frame width found, used as one frame` };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Frame layouts for all of one character's sheets at once. A character's sheets share one frame grid, so a sheet that
 * is not a strip of square frames takes the frame width that divides every non-square sheet of the same height (a
 * candidate width, nearest the height; else their greatest common divisor, if it is a plausible frame, 0.5 to 4
 * times the height). That stops one sheet whose width happens to divide by some other candidate from being cut
 * wrong. Square strips and overrides are as `detectFrames`; a sheet left over is detected on its own.
 */
export function detectCharacterFrames(sheets: readonly { file: string; w: number; h: number }[]): Map<string, FrameLayout> {
  const out = new Map<string, FrameLayout>();
  const rest: { file: string; w: number; h: number }[] = [];
  for (const sh of sheets) {
    const o = FRAME_OVERRIDES[sh.file];
    const L = detectFrames(sh.w, sh.h, o);
    if (L.how === "override" || L.how === "square") out.set(sh.file, L);
    else rest.push(sh);
  }
  for (const h of new Set(rest.map((r) => r.h))) {
    const group = rest.filter((r) => r.h === h);
    const common = CANDIDATE_WIDTHS.filter((c) => group.every((r) => r.w % c === 0 && c <= r.w)).sort((a, b) => Math.abs(a - h) - Math.abs(b - h) || a - b);
    const g = group.map((r) => r.w).reduce(gcd);
    const fw = group.length > 1 ? (common[0] ?? (g >= h / 2 && g <= h * 4 ? g : 0)) : 0;
    for (const r of group) {
      if (fw > 0) out.set(r.file, { frameWidth: fw, frameHeight: h, frames: r.w / fw, how: "candidate", odd: `not square frames: ${fw}×${h} (${r.w / fw} frames), the width shared by ${group.length} sheets` });
      else out.set(r.file, detectFrames(r.w, r.h));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The visible figure inside a frame

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The bounding box of the pixels with alpha above `threshold` inside the rect (`x0, y0, fw, fh`) of an RGBA image
 * `width` pixels wide, relative to the rect; null if it is empty. `rgba` is ImageData.data (4 bytes per pixel).
 */
export function opaqueBBox(rgba: ArrayLike<number>, width: number, x0: number, y0: number, fw: number, fh: number, threshold = 16): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < fh; y++) {
    const row = (y0 + y) * width;
    for (let x = 0; x < fw; x++) {
      if (rgba[(row + x0 + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The smallest box around all of them (nulls skipped). */
export function unionBox(boxes: readonly (Box | null)[]): Box | null {
  const bs = boxes.filter((b): b is Box => b !== null);
  if (bs.length === 0) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** Where the figure stands in its frame: the normalised origin at its feet (bottom centre), facing right and mirrored. */
export function feetOrigin(fig: Box, fw: number, fh: number, flipped: boolean): { x: number; y: number } {
  const cx = (fig.x + fig.w / 2) / fw;
  return { x: flipped ? 1 - cx : cx, y: (fig.y + fig.h) / fh };
}

/** World pixels per sheet pixel to draw a figure `figureH` tall at `targetH`, clamped to something sane. */
export const fitScale = (figureH: number, targetH: number): number =>
  figureH > 0 && targetH > 0 ? Math.min(4, Math.max(0.1, targetH / figureH)) : 1;

/** A role's scale, world pixels per sheet pixel: PIXEL_SCALE, times a boss's `mult`. */
export const roleScale = (role: RoleArt): number => PIXEL_SCALE * (role.mult ?? 1);

// ---------------------------------------------------------------------------------------------------------------
// Which animation plays

export interface EnemyAnimInput {
  dead: boolean;
  /** Flashing from a sword hit. */
  hurt: boolean;
  /** The brain's mode (src/fight/enemies.ts). */
  mode: "idle" | "chase" | "windup" | "lunge" | "recover" | "burstWindup";
  /** Moved since the last frame. */
  moving: boolean;
}

/**
 * The animation for an enemy's state. Death over everything; a hit's flinch; the telegraph and the lunge are one
 * attack; the boss burst's charge is the heavy hit; walking while it moves; idle otherwise (a recovering enemy stands).
 * `has` says which animations the character has: a missing one falls back (heavy → attack, hurt → the state under it,
 * death → idle, walk → idle).
 */
export function enemyAnim(s: EnemyAnimInput, has: (a: AnimName) => boolean): AnimName {
  if (s.dead) return has("death") ? "death" : "idle";
  if (s.hurt && has("hurt")) return "hurt";
  if (s.mode === "burstWindup") return has("heavy") ? "heavy" : has("attack") ? "attack" : "idle";
  if (s.mode === "windup" || s.mode === "lunge") return has("attack") ? "attack" : "idle";
  if (s.moving && has("walk")) return "walk";
  return "idle";
}

export interface PlayerAnimInput { dead: boolean; hurt: boolean; swinging: boolean; moving: boolean }

/** The player's animation: death, the flinch, the swing, walking, idle (same fallbacks as `enemyAnim`). */
export function playerAnim(s: PlayerAnimInput, has: (a: AnimName) => boolean): AnimName {
  if (s.dead) return has("death") ? "death" : "idle";
  if (s.hurt && has("hurt")) return "hurt";
  if (s.swinging && has("attack")) return "attack";
  if (s.moving && has("walk")) return "walk";
  return "idle";
}

/** Animations that play once and hold their last frame; the rest loop. */
export const PLAYS_ONCE: ReadonlySet<AnimName> = new Set<AnimName>(["attack", "heavy", "hurt", "death"]);
