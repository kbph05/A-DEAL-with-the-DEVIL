/**
 * Placeholder enemy art for forest mode, in the world's generated pixel-art style (drawn in code onto canvas
 * textures; no image files, no generative models). One still frame per roster enemy, facing right, feet at the bottom
 * centre; ForestScene flips, tints and squashes it to animate. Real art can replace a texture under the same key.
 */
import type Phaser from "phaser";
import type { EnemyId } from "./enemies";

export const enemyTextureKey = (id: EnemyId): string => `forest-enemy-${id}`;

/** Texture size per enemy, world pixels. */
export const ENEMY_ART_SIZE: Readonly<Record<EnemyId, { w: number; h: number }>> = {
  slime: { w: 16, h: 12 },
  demon: { w: 18, h: 22 },
  skeleton_archer: { w: 16, h: 24 },
  miniboss1: { w: 28, h: 34 },
  miniboss2: { w: 28, h: 34 },
  final_boss: { w: 32, h: 40 },
};

type P = (x: number, y: number, w: number, h: number, c: string) => void;
const SHADOW = "rgba(0,0,0,0.3)";

function slime(p: P): void {
  p(2, 10, 12, 2, SHADOW);
  const rows: [number, number][] = [[5, 6], [3, 10], [2, 12], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [2, 12]];
  rows.forEach(([x, w], i) => p(x, 2 + i, w, 1, "#4caf50"));
  p(1, 9, 14, 1, "#2e7d32");
  p(2, 10, 12, 1, "#1f5e23");
  p(4, 3, 3, 2, "#a5e0a0"); // shine
  p(5, 3, 1, 1, "#ffffff");
  p(9, 5, 2, 3, "#123814"); // eyes
  p(12, 5, 2, 3, "#123814");
  p(9, 5, 1, 1, "#ffffff");
  p(12, 5, 1, 1, "#ffffff");
  p(10, 8, 3, 1, "#1f5e23"); // mouth
}

function demon(p: P): void {
  p(3, 20, 12, 2, SHADOW);
  // Wings behind.
  p(0, 7, 4, 7, "#4a1f3a");
  p(1, 6, 2, 1, "#4a1f3a");
  p(14, 7, 4, 7, "#4a1f3a");
  p(15, 6, 2, 1, "#4a1f3a");
  // Legs and tail.
  p(6, 17, 2, 4, "#7a1e1a");
  p(10, 17, 2, 4, "#7a1e1a");
  p(5, 20, 3, 1, "#2a0e0c");
  p(10, 20, 3, 1, "#2a0e0c");
  p(2, 16, 4, 1, "#7a1e1a");
  p(1, 15, 1, 1, "#7a1e1a");
  // Body.
  p(5, 9, 8, 8, "#b0302a");
  p(5, 9, 8, 1, "#d0503a");
  p(7, 12, 4, 4, "#8a2420");
  p(3, 10, 2, 5, "#b0302a"); // arms
  p(13, 10, 2, 5, "#b0302a");
  p(13, 15, 2, 1, "#f0e0c0"); // claws
  // Head and horns.
  p(5, 3, 8, 6, "#b0302a");
  p(5, 3, 8, 1, "#d0503a");
  p(4, 1, 2, 3, "#e8d8b0");
  p(12, 1, 2, 3, "#e8d8b0");
  p(4, 0, 1, 1, "#e8d8b0");
  p(13, 0, 1, 1, "#e8d8b0");
  p(8, 5, 2, 1, "#ffd23a"); // eyes, looking right
  p(11, 5, 2, 1, "#ffd23a");
  p(9, 7, 4, 1, "#3a0e0c"); // grin
}

function skeletonArcher(p: P): void {
  p(3, 22, 10, 2, SHADOW);
  const bone = "#e8e2d0", shade = "#b8b09a", dark = "#2a2420";
  // Legs.
  p(5, 16, 2, 6, bone);
  p(9, 16, 2, 6, bone);
  p(4, 21, 3, 1, shade);
  p(9, 21, 3, 1, shade);
  p(5, 15, 6, 2, shade); // pelvis
  // Ribs.
  p(4, 8, 8, 7, bone);
  for (const y of [9, 11, 13]) p(5, y, 6, 1, dark);
  p(7, 8, 2, 7, shade); // spine
  // Arms reaching to the bow.
  p(11, 9, 3, 1, bone);
  p(11, 12, 3, 1, bone);
  // Skull.
  p(4, 1, 8, 7, bone);
  p(4, 6, 8, 1, shade);
  p(7, 3, 2, 2, dark); // sockets, facing right
  p(10, 3, 2, 2, dark);
  p(9, 6, 1, 1, dark);
  p(10, 6, 1, 1, dark);
  // Bow and string on the right.
  p(14, 4, 1, 2, "#7a5230");
  p(15, 6, 1, 8, "#7a5230");
  p(14, 14, 1, 2, "#7a5230");
  p(13, 5, 1, 10, "#d8d0c0");
  // Quiver on the back.
  p(2, 8, 2, 7, "#5b3b22");
  p(2, 7, 1, 1, "#c05050");
  p(3, 6, 1, 2, "#c05050");
}

function miniboss1(p: P): void {
  // The Gatekeeper: an iron knight with a tower shield and a red plume.
  const iron = "#6d6f7a", dark = "#44464f", hi = "#9a9ca8";
  p(4, 31, 20, 3, SHADOW);
  p(9, 24, 4, 8, dark); // legs
  p(15, 24, 4, 8, dark);
  p(8, 31, 5, 1, "#22232a");
  p(15, 31, 5, 1, "#22232a");
  p(7, 12, 14, 13, iron); // body
  p(7, 12, 14, 2, hi);
  p(12, 15, 4, 8, dark);
  p(9, 3, 10, 10, iron); // helm
  p(9, 3, 10, 2, hi);
  p(11, 7, 8, 2, "#1a1a20"); // visor
  p(13, 7, 4, 1, "#ff8a3a");
  p(12, 0, 4, 4, "#c03030"); // plume
  p(10, 1, 2, 2, "#c03030");
  p(0, 12, 8, 16, "#5b3b22"); // shield
  p(1, 13, 6, 14, "#7a5230");
  p(3, 15, 2, 10, "#c9a227");
  p(21, 14, 3, 10, iron); // sword arm
  p(23, 4, 2, 14, "#cfd2dc"); // blade
  p(21, 17, 6, 2, "#c9a227");
}

function miniboss2(p: P): void {
  // The Cartographer of Ruin: a hooded robe, a long map, cyan eyes.
  const robe = "#5b3a8a", dark = "#3a2460", hi = "#7a56b0";
  p(4, 31, 20, 3, SHADOW);
  p(6, 12, 16, 20, robe); // robe
  p(4, 26, 20, 6, robe);
  p(6, 12, 16, 1, hi);
  p(12, 14, 4, 18, dark);
  p(8, 2, 12, 11, robe); // hood
  p(8, 2, 12, 2, hi);
  p(10, 5, 8, 7, "#120a1e");
  p(12, 8, 2, 1, "#5af0ff");
  p(16, 8, 2, 1, "#5af0ff");
  p(19, 15, 8, 12, "#e8d8a0"); // the map
  p(19, 15, 8, 1, "#b8a070");
  p(19, 26, 8, 1, "#b8a070");
  p(21, 18, 4, 1, "#a04040");
  p(20, 21, 2, 3, "#506080");
  p(23, 20, 3, 1, "#a04040");
  p(18, 17, 2, 3, "#f1c27d"); // hand
}

function finalBoss(p: P): void {
  // The Devil's Left Hand: a horned lord in black and red.
  const red = "#8a1a1a", dark = "#3a0a0a", hi = "#b03030";
  p(4, 37, 24, 3, SHADOW);
  p(9, 28, 5, 10, dark); // legs
  p(18, 28, 5, 10, dark);
  p(6, 13, 20, 16, red); // body
  p(6, 13, 20, 2, hi);
  p(13, 16, 6, 12, dark);
  p(14, 18, 4, 3, "#ffb030"); // ember heart
  p(2, 14, 4, 12, red); // arms
  p(26, 14, 4, 12, red);
  p(26, 25, 5, 3, "#1a0505"); // the left hand's claws
  p(9, 3, 14, 11, red); // head
  p(9, 3, 14, 2, hi);
  p(13, 7, 3, 2, "#ffd23a");
  p(18, 7, 3, 2, "#ffd23a");
  p(14, 11, 6, 1, "#1a0505");
  p(6, 0, 3, 6, "#e8d8b0"); // horns
  p(23, 0, 3, 6, "#e8d8b0");
  p(5, 0, 1, 2, "#e8d8b0");
  p(26, 0, 1, 2, "#e8d8b0");
  p(13, 1, 6, 2, "#c9a227"); // crown
}

const DRAW: Record<EnemyId, (p: P) => void> = { slime, demon, skeleton_archer: skeletonArcher, miniboss1, miniboss2, final_boss: finalBoss };

/** Make the enemy textures once per game. */
export function ensureEnemyTextures(scene: Phaser.Scene): void {
  for (const id of Object.keys(DRAW) as EnemyId[]) {
    const key = enemyTextureKey(id);
    if (scene.textures.exists(key)) continue;
    const { w, h } = ENEMY_ART_SIZE[id];
    const tex = scene.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const p: P = (x, y, ww, hh, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, ww, hh); };
    DRAW[id](p);
    tex.refresh();
  }
}
