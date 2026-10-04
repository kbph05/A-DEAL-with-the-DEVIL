/**
 * The credits (Big Chungus, 4 Oct): the licensed sprite packs' own attribution.txt files, read at runtime. They are
 * encrypted with the sheets (docs/assets.md) and served the same way, so they are only asked for when the build lists
 * that pack's sheets (ASSET_KEY set). The plaintext assets/attribution.txt and the scene-art line show in every build.
 * docs/CREDITS.md is the written copy.
 */
import attribution from "../../assets/attribution.txt?raw";
import { privateFiles } from "../world/assets";
import { attributionFile, listedPacks, privateAssetUrl } from "./sprites";

export interface CreditEntry { pack: string; text: string }

let cache: Promise<CreditEntry[]> | null = null;

/**
 * Always shown, with or without ASSET_KEY: who drew the scenes, and assets/attribution.txt (plaintext in the repo,
 * bundled by Vite), which names the sprite packs and their authors.
 */
export const STATIC_CREDITS: readonly CreditEntry[] = [
  { pack: "Scene art", text: "Devil, forest, well and village art by Armand (Big Chungus)." },
  { pack: "Sprite packs", text: attribution.trim() },
];

/** The static credits, then each listed pack's own attribution text (a pack whose file can't be read is left out). Fetched once per page. */
export function loadCredits(): Promise<CreditEntry[]> {
  cache ??= Promise.all(listedPacks(privateFiles()).map(async (pack): Promise<CreditEntry | null> => {
    try {
      const res = await fetch(privateAssetUrl(attributionFile(pack), import.meta.env.BASE_URL));
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("html")) return null; // a dev server's index.html fallback is not a credits file
      const text = (await res.text()).trim();
      return text ? { pack, text } : null;
    } catch {
      return null;
    }
  })).then((list) => [...STATIC_CREDITS, ...list.filter((e): e is CreditEntry => e !== null)]);
  return cache;
}

/** The credits as DOM: a heading and a <pre> per entry. */
export function creditsBody(entries: readonly CreditEntry[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "credits-body";
  for (const e of entries) {
    const h = document.createElement("h3");
    h.textContent = e.pack;
    const pre = document.createElement("pre");
    pre.textContent = e.text;
    box.append(h, pre);
  }
  return box;
}
