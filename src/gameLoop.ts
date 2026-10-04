/**
 * The Phaser game loop's settings, shared by every Phaser.Game on the page (village, fights, map).
 *
 * Phaser's default delta smoothing clamps each frame's delta to 1/60 s for `panicMax` frames (120) after the game boots,
 * and again after every resume (the pause menu) and window refocus, then averages it over 10 frames seeded at 1/60 s.
 * At 30 fps that is about 4 s at half speed: the village walk (Arcade physics) and the fight (stepped from delta)
 * crawled at the start, then sped up (kbph, 4 Oct). `smoothStep: false` hands the scenes the real frame time from the
 * first frame, so movement is the same speed at any frame rate. Stalls are bounded where it matters: the fight caps its
 * catch-up at 0.1 s; a hidden tab pauses the loop and resets its clock.
 */
export const GAME_FPS = { smoothStep: false } as const;
