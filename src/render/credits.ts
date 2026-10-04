/**
 * The credits (Big Chungus, 4 Oct): the licensed sprite packs' own attribution.txt files, read at runtime. They are
 * encrypted with the sheets (docs/assets.md) and served the same way, so they are only asked for when the build lists
 * that pack's sheets (ASSET_KEY set); without the key the screen says where the credits come from instead.
 * docs/CREDITS.md is the written copy.
 */
import { privateFiles } from "../world/assets";
import { attributionFile, listedPacks, privateAssetUrl } from "./sprites";

export interface CreditEntry { pack: string; text: string }

let cache: Promise<CreditEntry[]> | null = null;

/** Each listed pack's attribution text (a pack whose file can't be read is left out). Fetched once per page. */
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
  })).then((list) => list.filter((e): e is CreditEntry => e !== null));
  return cache;
}

/** The credits as DOM: a heading and a <pre> per pack, or a note when none are loaded. */
export function creditsBody(entries: readonly CreditEntry[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "credits-body";
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.textContent = "The sprite packs' credits show here when their art is in the build (it needs the team's ASSET_KEY). Everything on screen now is drawn in code or by the team.";
    box.append(p);
    return box;
  }
  for (const e of entries) {
    const h = document.createElement("h3");
    h.textContent = e.pack;
    const pre = document.createElement("pre");
    pre.textContent = e.text;
    box.append(h, pre);
  }
  return box;
}
