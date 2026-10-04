/**
 * Fight art tuning, in one place. `FOREST_BG_GAMMA` is the gamma baked into the forest background when a fight loads
 * it (T, 4 Oct: so the sprites pop against it). Above 1 lifts the midtones; 1 leaves the picture as drawn. The fight
 * lab (fight.html) has a slider to try values live; set the winner here.
 */
export const FOREST_BG_GAMMA = 1.4;

/** The lab's slider range and step. */
export const BG_GAMMA_MIN = 0.6;
export const BG_GAMMA_MAX = 2.2;
export const BG_GAMMA_STEP = 0.1;
