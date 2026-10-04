/**
 * The team's own scene backgrounds, bundled by Vite (Big Chungus, 4 Oct: assets/forest.png, a 256×256 pixel-art band:
 * trees on top, a dirt path across the middle, bushes at the bottom; assets/village.png, 384×256: shopfronts along the
 * top, a path, a stream. The village scene is sized to it at exactly 2×, so it lays as one copy). Precedence: a private file
 * (scenes/<id>/background.png, docs/world.md) > this > the def's key or URL > the generated placeholder. A band
 * replaces the placeholder canopy overlay too: the trees are in the picture. Phaser-only (node can't import a PNG),
 * so the pure layout is `bandLayout` in scene.ts.
 */
import Phaser from "phaser";
import forest from "../../assets/forest.png";
import village from "../../assets/village.png";
import { applyGamma } from "../fight/gamma";
import { bandLayout, type SceneDef } from "./scene";

export const BUNDLED_BACKGROUNDS: Readonly<Record<string, string>> = { forest, village };

export const bundledKey = (sceneId: string): string => `bundled:${sceneId}:background`;

/** Queue the scene's bundled background, if it has one. A failed load leaves the placeholder (the loader's error hook). */
export function preloadBand(scene: Phaser.Scene, def: SceneDef): void {
  const url = BUNDLED_BACKGROUNDS[def.id];
  if (url) scene.load.image(bundledKey(def.id), url);
}

const laidKey = (def: SceneDef, gamma: number): string => `${bundledKey(def.id)}:laid${gamma === 1 ? "" : `:g${gamma}`}`;

/**
 * Lay the loaded band along the scene (`bandLayout`): one canvas texture holding the copies, the odd ones mirrored,
 * nearest-neighbour. One image, so no hairline seams at the joins. A `gamma` other than 1 is baked into the pixels
 * once, here (a fight's forest background, src/fight/art.ts); the texture is cached per gamma, so there is no
 * per-frame cost. Returns the texture key.
 */
function bandTexture(scene: Phaser.Scene, def: SceneDef, gamma: number): string {
  const key = laidKey(def, gamma);
  if (scene.textures.exists(key)) return key;
  const src = scene.textures.get(bundledKey(def.id)).getSourceImage() as HTMLImageElement;
  const L = bandLayout({ w: src.width, h: src.height }, def.size);
  const tex = scene.textures.createCanvas(key, L.width, src.height)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < L.copies; i++) {
    ctx.save();
    if (i % 2 === 1) { ctx.translate((i + 1) * src.width, 0); ctx.scale(-1, 1); } else ctx.translate(i * src.width, 0);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
  if (gamma !== 1) {
    const px = ctx.getImageData(0, 0, L.width, src.height);
    applyGamma(px.data, gamma);
    ctx.putImageData(px, 0, 0);
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

/** The loaded band laid along the scene as one image scaled to the scene height; `gamma` as in `bandTexture`. */
export function addBand(scene: Phaser.Scene, def: SceneDef, depth: number, gamma = 1): Phaser.GameObjects.Image {
  const src = scene.textures.get(bundledKey(def.id)).getSourceImage() as HTMLImageElement;
  const L = bandLayout({ w: src.width, h: src.height }, def.size);
  return scene.add.image(0, 0, bandTexture(scene, def, gamma)).setOrigin(0, 0).setScale(L.scale).setDepth(depth);
}

/** Re-process a laid band at a new gamma (the fight lab's slider): swap its texture, dropping the old one. */
export function setBandGamma(scene: Phaser.Scene, def: SceneDef, image: Phaser.GameObjects.Image, gamma: number): void {
  const old = image.texture.key;
  const key = bandTexture(scene, def, gamma);
  if (key === old) return;
  image.setTexture(key);
  if (old.startsWith(`${bundledKey(def.id)}:laid`)) scene.textures.remove(old);
}
