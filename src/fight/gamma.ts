/**
 * Gamma for the forest background (pure, so node tests it; the canvas work is in src/world/bandArt.ts).
 * out = 255 * (in / 255) ^ (1 / gamma) per RGB channel, alpha untouched. Above 1 it lifts the midtones (lighter,
 * flatter: the darker, saturated sprites stand out against it); 1 is the identity; 0 and 255 never move.
 */
export function applyGamma(data: Uint8ClampedArray, gamma: number): void {
  if (!Number.isFinite(gamma) || gamma <= 0) throw new RangeError(`gamma must be a positive number, got ${gamma}`);
  if (gamma === 1) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, 1 / gamma));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}
