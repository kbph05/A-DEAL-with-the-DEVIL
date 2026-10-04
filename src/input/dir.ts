/**
 * Shared movement input, pure (no Phaser): keyboard and joystick to a unit direction. Used by the realtime fight
 * (src/fight) and the world scene (src/world). Tested in src/fight/logic.test.ts and src/world/world.test.ts.
 */
export interface Vec { x: number; y: number }

export const ZERO: Vec = { x: 0, y: 0 };

export function norm(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

/** Keyboard to an 8-way unit vector (opposite keys cancel; diagonals are normalized, so not faster). */
export function moveDir(k: { up: boolean; down: boolean; left: boolean; right: boolean }): Vec {
  return norm({ x: (k.right ? 1 : 0) - (k.left ? 1 : 0), y: (k.down ? 1 : 0) - (k.up ? 1 : 0) });
}

/** Joystick knob offset to an 8-way unit vector: zero inside the dead zone, else snapped to the nearest 45 degrees. */
export function stickDir(dx: number, dy: number, radius: number, deadZone = 0.25): Vec {
  if (Math.hypot(dx, dy) < radius * deadZone) return { x: 0, y: 0 };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const r = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n);
  return { x: r(Math.cos(a)), y: r(Math.sin(a)) };
}

/** Clamp a knob offset to the stick radius. */
export function clampStick(dx: number, dy: number, radius: number): Vec {
  const l = Math.hypot(dx, dy);
  return l <= radius ? { x: dx, y: dy } : { x: (dx / l) * radius, y: (dy / l) * radius };
}
