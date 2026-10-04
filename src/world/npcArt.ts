/**
 * Art override for the vendors: assets/npc/healer.png and assets/npc/smith.png, if the designer adds them. Bundled by
 * Vite (import.meta.glob), so a missing file is fine: that vendor keeps its generated figure (npc.ts). Phaser-free
 * but Vite-only (node can't resolve the glob), like bandArt.ts. The image is drawn at NPC_SCALE, feet at the bottom
 * centre; docs/world.md.
 */
import { NPC_KINDS, type NpcKind } from "./npc";

const files = import.meta.glob("../../assets/npc/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** The bundled override image URL for a vendor, or undefined. */
export function npcArtUrl(kind: NpcKind): string | undefined {
  for (const [path, url] of Object.entries(files)) if (path.endsWith(`/npc/${kind}.png`)) return url;
  return undefined;
}

/** The kinds that have an override. */
export const npcArtKinds = (): NpcKind[] => NPC_KINDS.filter((k) => npcArtUrl(k) !== undefined);

export const npcArtKey = (kind: NpcKind): string => `npc-art:${kind}`;
