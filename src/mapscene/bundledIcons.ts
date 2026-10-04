/**
 * The designer's map icons, bundled by Vite (Big Chungus, 8b31d8d: assets/map/*.png, all 16×16 pixel art). Which file is
 * which kind is the pure table BUNDLED_ICON_KINDS in icons.ts (fire = campfire, sword = fight); precedence is there too.
 * Vite/Phaser only (node can't import a PNG), so the tests cover the table, not this file.
 */
import boss from "../../assets/map/boss.png";
import fire from "../../assets/map/fire.png";
import stairs from "../../assets/map/stairs.png";
import sword from "../../assets/map/sword.png";
import village from "../../assets/map/village.png";
import well from "../../assets/map/well.png";
import { bundledIconFile, iconSource, privateIconFile, type BundledIconFile, type IconKey } from "./icons";
import { privateUrl } from "../world/assets";

const URLS: Readonly<Record<BundledIconFile, string>> = {
  "boss.png": boss, "fire.png": fire, "stairs.png": stairs, "sword.png": sword, "village.png": village, "well.png": well,
};

/** The bundled art's URL for a kind, if it has any. */
export function bundledUrl(k: IconKey): string | undefined {
  const f = bundledIconFile(k);
  return f && URLS[f];
}

/** The URL of the picture a kind shows (private override, else bundled), or undefined for the generated icon: for DOM use. */
export function iconArtUrl(k: IconKey): string | undefined {
  const s = iconSource(k);
  return s === "private" ? privateUrl(privateIconFile(k)) : s === "bundled" ? bundledUrl(k) : undefined;
}
