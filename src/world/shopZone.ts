/**
 * Shop zones, the glue between a scene's `kind: "shop"` zones and the engine's `buy`. Pure (no DOM, no Phaser):
 * `shopPrompt(zone, view)` says what the prompt shows and whether Buy is enabled, from the engine's own legal
 * actions. Tested in node (shopZone.test.ts). The world lab (dev.ts) renders it; docs/world.md, "Shop zones".
 */
import { MAX_ASKS, ONE_CHOICE, WARES, type Command } from "../game/gameState";
import { pointlessBuy } from "../ui/shopGuard";
import type { SceneZone } from "./scene";

/** What a shop prompt shows. `command` is what to send to the engine when Buy is pressed (only when `enabled`). */
export interface ShopPrompt {
  title: string;
  /** Gold, or null when the item is unknown to the engine. */
  price: number | null;
  desc: string;
  enabled: boolean;
  /** Why Buy is disabled, in a few words. Absent when enabled. */
  reason?: string;
  command?: Command;
}

/** The slice of the engine's `View` (game.view()) that a shop prompt reads. A whole View fits. */
export interface ShopView {
  kind: string;
  /** `hp` and `maxHp` (a whole View has them) let the prompt refuse a heal at full health. */
  state: { gold: number; hp?: number; maxHp?: number };
  actions: readonly Command[];
  resolved?: boolean;
  ending?: string | null;
  pending?: boolean;
  /** At a well: the devil sits there, and the asks left (fewer than MAX_ASKS once he was asked: the blessing is locked). */
  devilPresent?: boolean;
  asksLeft?: number;
}

// What each ware does and where it is sold, as the engine's `buy` (state-machine.ts) and `legalActions` (actions.ts)
// apply them. Copied because the engine does not export them; prices come from WARES.
const WARE_TEXT: Record<string, { name: string; desc: string; soldAt: string }> = {
  heal: { name: "Heal", desc: "Restores 12 HP.", soldAt: "village" },
  blade: { name: "Blade", desc: "+1 attack, for the rest of the run.", soldAt: "village" },
  blessing: { name: "Blessing", desc: "One of: +3 max HP, +1 attack or +8 HP. Once per well.", soldAt: "well" },
};

const isBuy = (c: Command, item: string): boolean => c.cmd === "buy" && c.item === item;

/** The prompt for standing in shop zone `zone`, given the engine's view. Enabled exactly when the engine lists the buy. */
export function shopPrompt(zone: SceneZone, v: ShopView): ShopPrompt {
  const item = zone.item ?? "";
  const ware = WARES[item as keyof typeof WARES] as { cost: number } | undefined;
  const text = WARE_TEXT[item];
  const title = text ? `${zone.label ? `${zone.label}: ` : ""}${text.name}` : zone.label ?? zone.id;
  if (!ware || !text) return { title, price: null, desc: "", enabled: false, reason: "Nothing for sale here" };
  const base = { title, price: ware.cost, desc: text.desc };
  const command: Command = { cmd: "buy", item };
  if (v.actions.some((c) => isBuy(c, item))) {
    const pointless = pointlessBuy(item, v.state?.hp, v.state?.maxHp); // the engine would take the gold for nothing
    return pointless ? { ...base, enabled: false, reason: pointless } : { ...base, enabled: true, command };
  }
  return { ...base, enabled: false, reason: whyNot(item, ware.cost, text.soldAt, v) };
}

function whyNot(item: string, cost: number, soldAt: string, v: ShopView): string {
  if (v.ending) return "The run is over";
  if (v.pending) return "The devil is speaking";
  if (v.kind !== "village" && v.kind !== "well") return `Not at a shop (this is a ${v.kind} node)`;
  if (v.kind !== soldAt) return `Only sold at a ${soldAt}, not in the ${v.kind}`;
  if (item === "blessing" && v.resolved) return "The well has given what it will give";
  if (item === "blessing" && v.devilPresent && v.asksLeft !== undefined && v.asksLeft < MAX_ASKS) return capital(ONE_CHOICE.well.devil);
  const gold = typeof v.state?.gold === "number" ? v.state.gold : 0;
  if (gold < cost) return `Not enough gold: need ${cost}g, you have ${gold}g`;
  return "Not available right now";
}

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The text for an exit zone while the map is not wired yet. */
export const exitPrompt = (zone: SceneZone): string => `${zone.label ?? zone.id} (map: coming soon)`;
