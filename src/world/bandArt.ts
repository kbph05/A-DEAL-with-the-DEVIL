/**
 * The team's own scene backgrounds, bundled by Vite (Big Chungus, 4 Oct: assets/forest.png, a 256×256 pixel-art band:
 * trees on top, a dirt path across the middle, bushes at the bottom). Precedence: a private file
 * (scenes/<id>/background.png, docs/world.md) > this > the def's key or URL > the generated placeholder. A band
 * replaces the placeholder canopy overlay too: the trees are in the picture. Phaser-only (node can't import a PNG),
 * so the pure layout is `bandLayout` in scene.ts.
 */
import Phaser from "phaser";
import forest from "../../assets/forest.png";
import { bandLayout, type SceneDef } from "./scene";

export const BUNDLED_BACKGROUNDS: Readonly<Record<string, string>> = { forest };

export const bundledKey = (sceneId: string): string => `bundled:${sceneId}:background`;

/** Queue the scene's bundled background, if it has one. A failed load leaves the placeholder (the loader's error hook). */
export function preloadBand(scene: Phaser.Scene, def: SceneDef): void {
  const url = BUNDLED_BACKGROUNDS[def.id];
  if (url) scene.load.image(bundledKey(def.id), url);
}

/**
 * Lay the loaded band along the scene (`bandLayout`): one canvas texture holding the copies, the odd ones mirrored,
 * drawn as a single image scaled to the scene height, nearest-neighbour. One image, so no hairline seams at the joins.
 */
export function addBand(scene: Phaser.Scene, def: SceneDef, depth: number): Phaser.GameObjects.Image {
  const src = scene.textures.get(bundledKey(def.id)).getSourceImage() as HTMLImageElement;
  const L = bandLayout({ w: src.width, h: src.height }, def.size);
  const key = `${bundledKey(def.id)}:laid`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, L.width, src.height)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < L.copies; i++) {
      ctx.save();
      if (i % 2 === 1) { ctx.translate((i + 1) * src.width, 0); ctx.scale(-1, 1); } else ctx.translate(i * src.width, 0);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  return scene.add.image(0, 0, key).setOrigin(0, 0).setScale(L.scale).setDepth(depth);
}
