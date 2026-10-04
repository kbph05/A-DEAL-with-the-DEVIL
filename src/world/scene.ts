/**
 * The scene model (Big Chungus, 4 Oct): a scene is one large background texture, a foreground overlay texture,
 * a playable rectangle the player can't leave, a spawn, zones (exits and triggers) and actors. Everything here is
 * pure (no Phaser) and tested in node (scene.test.ts). Coordinates are world pixels: (0, 0) is the background's
 * top-left, and an actor's (x, y) is its feet.
 */
import type { Vec } from "../input/dir";
import { NPC_KINDS, isNpcKind, type NpcKind } from "./npc";

export interface Rect { x: number; y: number; w: number; h: number }

export interface SceneZone extends Rect {
  id: string;
  /**
   * "exit" leads somewhere (later: a node of the act map); "shop" sells one engine ware (`item`); "trigger" is
   * anything else. Default "trigger".
   */
  kind?: "exit" | "trigger" | "shop";
  label?: string;
  /** For `kind: "shop"`: the engine item id it sells (`{cmd:"buy", item}`), e.g. "heal", "blade", "blessing". */
  item?: string;
  /** Free-form link to an act-map node, for later. Not used by the engine yet. */
  node?: string;
}

export interface SceneActor {
  id: string;
  /** Feet position. */
  x: number;
  y: number;
  /** Texture key or image URL. Missing or not loadable: a labelled placeholder box. */
  texture?: string;
  label?: string;
  /**
   * A vendor: "healer" or "smith". It gets a small generated figure (npc.ts), or assets/npc/<kind>.png if the designer
   * adds one (docs/world.md). It idles with a one-pixel bob.
   */
  npc?: NpcKind;
  /**
   * For an npc standing behind a counter: the world y of the counter's top edge. The figure is hidden below it, so it
   * reads as standing behind the counter (`y` is where the feet would be, a little below it).
   */
  counterY?: number;
  /** For an npc: the id of the zone that makes it hop when the player enters (its shop). */
  zone?: string;
}

/** One scene, JSON-friendly. `background` and `overlay` are a texture key or an image URL. */
export interface SceneDef {
  id: string;
  size: { w: number; h: number };
  background: string;
  overlay?: string;
  /** The playable rectangle: the player's feet never leave it. Not the texture size. */
  bounds: Rect;
  spawn: Vec;
  zones?: SceneZone[];
  actors?: SceneActor[];
  /**
   * Fight scenes (the forest path): where enemies may stand, as feet positions inside `bounds`. The fight places
   * its encounter on these, nearest the spawn first (docs/fight.md, "Forest mode"). Other scenes ignore them.
   */
  spawns?: Vec[];
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Does rect `a` lie inside rect `b` (edges may touch)? */
export const rectInside = (a: Rect, b: Rect): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
/** Is point `p` inside rect `r` (left/top edges in, right/bottom edges out)? */
export const pointIn = (p: Vec, r: Rect): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function rectErrors(v: unknown, what: string): string[] {
  if (!isObj(v)) return [`${what} is missing`];
  const out: string[] = [];
  for (const k of ["x", "y", "w", "h"]) if (!fin(v[k])) out.push(`${what}.${k} is not a finite number`);
  if (out.length === 0 && ((v.w as number) <= 0 || (v.h as number) <= 0)) out.push(`${what} has no area (w and h must be > 0)`);
  return out;
}

/**
 * Everything wrong with a scene definition, as readable messages (empty: it's valid). Checks: finite numbers,
 * a positive size, bounds inside the size, spawn inside the bounds, zones and actors well-formed with unique ids,
 * zones touching the bounds (else unreachable), actors inside the size (an `npc` one of the known vendors, its `counterY`
 * not below its feet, its `zone` a zone of the scene), enemy spawns inside the bounds.
 */
export function sceneErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ["the scene is not an object"];
  const e: string[] = [];
  if (!str(raw.id)) e.push("id must be a non-empty string");
  const size = raw.size;
  let sizeOk = false;
  if (!isObj(size) || !fin(size.w) || !fin(size.h)) e.push("size must be { w, h } with finite numbers");
  else if (size.w <= 0 || size.h <= 0) e.push("size must be positive");
  else sizeOk = true;
  const sizeRect: Rect = sizeOk ? { x: 0, y: 0, w: (size as { w: number }).w, h: (size as { h: number }).h } : { x: 0, y: 0, w: 0, h: 0 };
  if (!str(raw.background)) e.push("background must be a texture key or URL");
  if (raw.overlay !== undefined && !str(raw.overlay)) e.push("overlay, when given, must be a texture key or URL");

  const be = rectErrors(raw.bounds, "bounds");
  e.push(...be);
  const bounds = raw.bounds as Rect;
  if (be.length === 0 && sizeOk && !rectInside(bounds, sizeRect)) e.push("bounds must lie inside size");

  const sp = raw.spawn;
  if (!isObj(sp) || !fin(sp.x) || !fin(sp.y)) e.push("spawn must be { x, y } with finite numbers");
  else if (be.length === 0 && !pointIn(sp as unknown as Vec, bounds)) e.push(`spawn (${sp.x}, ${sp.y}) must lie inside bounds`);

  const ids = (list: unknown, what: string, check: (item: Record<string, unknown>, at: string) => void) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { e.push(`${what} must be an array`); return; }
    const seen = new Set<string>();
    list.forEach((item, i) => {
      const at = `${what}[${i}]`;
      if (!isObj(item)) { e.push(`${at} is not an object`); return; }
      if (!str(item.id)) e.push(`${at}.id must be a non-empty string`);
      else if (seen.has(item.id)) e.push(`${at}.id "${item.id}" is used twice`);
      else seen.add(item.id);
      check(item, item.id && typeof item.id === "string" ? `${what} "${item.id}"` : at);
    });
  };
  ids(raw.zones, "zones", (z, at) => {
    const re = rectErrors(z, at);
    e.push(...re);
    if (re.length === 0 && be.length === 0 && !overlaps(z as unknown as Rect, bounds)) e.push(`${at} lies outside bounds, so it can never be entered`);
    if (z.kind !== undefined && z.kind !== "exit" && z.kind !== "trigger" && z.kind !== "shop") e.push(`${at}.kind must be "exit", "trigger" or "shop"`);
    if (z.kind === "shop" && !str(z.item)) e.push(`${at} is a shop, so it needs an item (an engine item id)`);
    for (const k of ["label", "node", "item"]) if (z[k] !== undefined && typeof z[k] !== "string") e.push(`${at}.${k} must be a string`);
  });
  if (raw.spawns !== undefined) {
    if (!Array.isArray(raw.spawns)) e.push("spawns must be an array");
    else raw.spawns.forEach((sp: unknown, i: number) => {
      if (!isObj(sp) || !fin(sp.x) || !fin(sp.y)) e.push(`spawns[${i}] must be { x, y } with finite numbers`);
      else if (be.length === 0 && !pointIn(sp as unknown as Vec, bounds)) e.push(`spawns[${i}] (${sp.x}, ${sp.y}) must lie inside bounds`);
    });
  }
  ids(raw.actors, "actors", (a, at) => {
    if (!fin(a.x) || !fin(a.y)) e.push(`${at} needs finite x and y`);
    else if (sizeOk && !pointIn(a as unknown as Vec, sizeRect)) e.push(`${at} stands outside size`);
    for (const k of ["texture", "label"]) if (a[k] !== undefined && typeof a[k] !== "string") e.push(`${at}.${k} must be a string`);
    if (a.npc !== undefined && !isNpcKind(a.npc)) e.push(`${at}.npc must be one of ${NPC_KINDS.map((k) => `"${k}"`).join(", ")}`);
    if (a.counterY !== undefined) {
      if (!fin(a.counterY)) e.push(`${at}.counterY must be a finite number`);
      else if (fin(a.y) && a.counterY > a.y) e.push(`${at}.counterY (${a.counterY}) must not lie below the feet (y ${a.y})`);
    }
    if (a.zone !== undefined) {
      if (!str(a.zone)) e.push(`${at}.zone must be a zone id`);
      else if (Array.isArray(raw.zones) && !raw.zones.some((z) => isObj(z) && z.id === a.zone)) e.push(`${at}.zone "${a.zone}" is not a zone of this scene`);
    }
    if ((a.counterY !== undefined || a.zone !== undefined) && a.npc === undefined) e.push(`${at}: counterY and zone are for npc actors`);
  });
  return e;
}

/** A checked SceneDef, or an Error listing every problem. */
export function parseSceneDef(raw: unknown): SceneDef {
  const errs = sceneErrors(raw);
  if (errs.length > 0) {
    const id = isObj(raw) && typeof raw.id === "string" ? ` "${raw.id}"` : "";
    throw new Error(`Bad scene${id}: ${errs.join("; ")}`);
  }
  return raw as unknown as SceneDef;
}

// ---------------------------------------------------------------------------------------------------------------
// Draw order: background (0) < actors sorted by foot y < overlay < debug outlines

export const BG_DEPTH = 0;
/** Actor depths are ACTOR_BASE_DEPTH + foot y. */
export const ACTOR_BASE_DEPTH = 10;

/** The y of a sprite's bottom edge: y + displayHeight * (1 - originY). With origin (0.5, 1) that's just y. */
export const footY = (y: number, displayHeight: number, originY: number): number => y + displayHeight * (1 - originY);
/** Depth of an actor whose feet are at `foot`: lower on screen draws in front. */
export const actorDepth = (foot: number, base = ACTOR_BASE_DEPTH): number => base + foot;
/** Above every actor that can stand in a scene of height `sceneH` (sprites may hang below it a little). */
export const overlayDepth = (sceneH: number, base = ACTOR_BASE_DEPTH): number => base + 2 * Math.max(0, sceneH) + 1;

// ---------------------------------------------------------------------------------------------------------------
// Movement and zones

/**
 * Clamp point `p` into `r`, keeping a box of half-size `half` around it inside too (e.g. the feet box). If the box
 * is wider than the rect, the point goes to the rect's centre on that axis.
 */
export function clampToBounds(p: Vec, r: Rect, half: { x: number; y: number } = { x: 0, y: 0 }): Vec {
  const axis = (v: number, lo: number, size: number, h: number) => (2 * h >= size ? lo + size / 2 : Math.min(lo + size - h, Math.max(lo + h, v)));
  return { x: axis(p.x, r.x, r.w, half.x), y: axis(p.y, r.y, r.h, half.y) };
}

/** Ids of the zones containing `p`, in the scene's order. */
export function zonesAt(zones: readonly SceneZone[] | undefined, p: Vec): string[] {
  return (zones ?? []).filter((z) => pointIn(p, z)).map((z) => z.id);
}

/** Which zones were entered and left between two frames (`prev` and `next` are the ids from `zonesAt`). */
export function zoneChanges(prev: readonly string[], next: readonly string[]): { entered: string[]; left: string[] } {
  return { entered: next.filter((id) => !prev.includes(id)), left: prev.filter((id) => !next.includes(id)) };
}

/**
 * Tracks the zones under the player and reports each entry and exit once. It starts from the spawn position, so
 * spawning inside a zone (e.g. arriving through an exit) does not fire an entry.
 */
export class ZoneTracker {
  current: string[];
  private zones: readonly SceneZone[];
  constructor(zones: readonly SceneZone[] | undefined, start: Vec) {
    this.zones = zones ?? [];
    this.current = zonesAt(this.zones, start);
  }
  update(p: Vec): { entered: SceneZone[]; left: SceneZone[] } {
    const next = zonesAt(this.zones, p);
    const { entered, left } = zoneChanges(this.current, next);
    this.current = next;
    const byId = (id: string) => this.zones.find((z) => z.id === id)!;
    return { entered: entered.map(byId), left: left.map(byId) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Art: private file > the def's URL or key > a generated placeholder

export type ArtSource = { kind: "private"; url: string } | { kind: "url"; url: string } | { kind: "key"; key: string };

/** A value that looks like an image path or URL rather than a texture key. */
export const isUrl = (s: string): boolean => /^(https?:|data:|blob:|\.{0,2}\/)/.test(s) || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(s);

const ART_EXT = ["png", "webp", "jpg", "jpeg"];

/** Private file for a scene part: scenes/<scene>/<name>.(png|webp|jpg) under public/assets/private/, if listed. */
export function privateSceneFile(files: readonly string[], sceneId: string, name: string): string | null {
  for (const ext of ART_EXT) {
    const f = `scenes/${sceneId}/${name}.${ext}`;
    if (files.includes(f)) return f;
  }
  return null;
}

/**
 * Where a scene texture comes from. `name` is "background", "overlay" or "actors/<actor id>"; `value` is what the
 * def says (key or URL). `files` are the private files present (relative to public/assets/private/).
 */
export function artSource(files: readonly string[], sceneId: string, name: string, value: string | undefined, privateUrl: (f: string) => string): ArtSource | null {
  const f = privateSceneFile(files, sceneId, name);
  if (f) return { kind: "private", url: privateUrl(f) };
  if (!value) return null;
  return isUrl(value) ? { kind: "url", url: value } : { kind: "key", key: value };
}

/**
 * A band background (the designer's 256×256 forest, src/world/bandArt.ts) laid along a scene: scaled to fill the
 * scene's height (nearest-neighbour), then repeated along x, every other copy mirrored so each join meets itself
 * (the band's own left and right edges don't match). `copies` is how many source-width copies cover `size.w` at that
 * scale; `width` is their total width in source pixels.
 */
export function bandLayout(img: { w: number; h: number }, size: { w: number; h: number }): { scale: number; copies: number; width: number } {
  const scale = size.h / img.h;
  const copies = Math.max(1, Math.ceil(size.w / (img.w * scale) - 1e-9));
  return { scale, copies, width: copies * img.w };
}
