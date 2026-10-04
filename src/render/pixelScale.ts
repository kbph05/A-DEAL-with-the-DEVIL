/**
 * The one pixel scale (Big Chungus, 4 Oct: "make sure pixel sizes are standardized"): world pixels per source pixel,
 * for every piece of pixel art. The scene backgrounds are drawn at it (assets/village.png, 384×256, fills the 768×512
 * village; assets/forest.png, a 256 px band, fills the 512 px forest), and so is every character sprite (the Tiny RPG
 * Soldier, Orc and Demon_A, WarriorCh, and the generated fallbacks), so one source pixel of a sprite is the same size
 * on screen as one source pixel of the ground it stands on. Bosses may add a multiplier on top (sprites.ts ROLES).
 */
export const PIXEL_SCALE = 2;
