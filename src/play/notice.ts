/**
 * The play page's notice card (docs/play.md, "Notices"): what the toast shows for the events one menu choice produced,
 * as data. Pure (no DOM): `noticeOf` picks the icon and wording and turns each stat change into a coloured chip;
 * `shopIcon` picks the shop prompt's icon; `sceneTheme` says which palette (play.css, `data-scene`) the page wears.
 * Tested in notice.test.ts.
 */
import type { GameEvent } from "../game";
import { eventText, rejectedText } from "../ui/logic";

/** The notice's small pixel icon (noticeIcons.ts): coin for gold, heart for HP, sword for attack, flame for a rest, devil for a deal, X for a rejection. */
export type NoticeIcon = "coin" | "heart" | "sword" | "flame" | "devil" | "cross";
/** A chip's colour: gold, gold lost (dim red), HP gained (green), HP lost (red), attack (silver), anything else (plain). */
export type ChipTone = "gold" | "gold-loss" | "hp-up" | "hp-down" | "atk" | "plain";
export interface NoticeChip { text: string; tone: ChipTone }
export interface Notice {
  icon: NoticeIcon;
  /** Rejections get the red border. */
  reject: boolean;
  /** The line: the engine's own words, trimmed where the chips say the rest. */
  title: string;
  /** Anything else the choice did (a curse, a rewrite), in dim text. */
  detail: string;
  chips: NoticeChip[];
}

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** One stat change as a chip: "+12 HP" (green), "−8 gold" (dim red), "+1 ATK" (silver), "+3 max HP" (green). Zero is no chip. */
export function deltaChip(stat: string, amount: number): NoticeChip | null {
  if (!amount) return null;
  const up = amount > 0, n = Math.abs(amount), sign = up ? "+" : "−";
  switch (stat) {
    case "gold": return { text: `${sign}${n} gold`, tone: up ? "gold" : "gold-loss" };
    case "hp": return { text: `${sign}${n} HP`, tone: up ? "hp-up" : "hp-down" };
    case "max_hp": return { text: `${sign}${n} max HP`, tone: up ? "hp-up" : "hp-down" };
    case "attack": return { text: `${sign}${n} ATK`, tone: up ? "atk" : "hp-down" };
    case "soul": return { text: `${sign}${n} soul`, tone: "plain" };
    default: return { text: `${sign}${n} ${stat}`, tone: "plain" };
  }
}

/** A whole `Deltas` as chips, in the order gold, HP, max HP, attack, then the rest. */
export function deltaChips(d: Record<string, number | undefined>): NoticeChip[] {
  const order = ["gold", "hp", "max_hp", "attack", "soul"];
  const keys = Object.keys(d).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return keys.map((k) => deltaChip(k, d[k] ?? 0)).filter((c): c is NoticeChip => c !== null);
}

/** The icon for a stat. */
const STAT_ICON: Record<string, NoticeIcon> = { gold: "coin", hp: "heart", max_hp: "heart", attack: "sword" };
const firstStatIcon = (d: Record<string, number | undefined>): NoticeIcon =>
  Object.keys(d).map((k) => (d[k] ? STAT_ICON[k] : undefined)).find((i) => i !== undefined) ?? "coin";

/**
 * The notice for the events a toast shows (`toastEvents`, flow.ts); null when they say nothing. The first event that
 * names the choice sets the icon and the line; every stat change becomes a chip (a purchase also shows its price as a
 * dim-red gold chip); other events (a curse, a rewrite) go in the detail line in the engine's words.
 */
export function noticeOf(events: readonly GameEvent[], kindOf?: Parameters<typeof eventText>[1]): Notice | null {
  const n: Notice = { icon: "devil", reject: false, title: "", detail: "", chips: [] };
  let iconSet = false;
  const lead = (icon: NoticeIcon, title: string): void => { if (!iconSet) { n.icon = icon; n.title = title; iconSet = true; } else n.detail = [n.detail, title].filter(Boolean).join(" "); };
  for (const e of events) {
    switch (e.type) {
      case "rejected": n.reject = true; lead("cross", rejectedText(e.reason)); break;
      case "bought":
        lead(firstStatIcon(e.changes), `Bought ${e.item}`);
        n.chips.push(...deltaChips({ gold: -e.cost }), ...deltaChips(e.changes));
        break;
      case "healed":
        lead(/campfire|fire/i.test(e.source) ? "flame" : "heart", /campfire/i.test(e.source) ? "You rest by the campfire" : `You heal (${e.source})`);
        n.chips.push(...deltaChips({ hp: e.amount }));
        break;
      case "trained": lead("sword", "You sharpen your weapon by the fire"); n.chips.push(...deltaChips({ attack: e.amount })); break;
      case "damaged": lead("heart", `You take damage (${e.source})`); n.chips.push(...deltaChips({ hp: -e.amount })); break;
      case "deal_applied": lead("devil", "Deal struck"); n.chips.push(...deltaChips(e.changes)); break;
      case "curse_fired": n.chips.push(...deltaChips(e.changes)); break;
      default: { const t = eventText(e, kindOf).replace(/\s+/g, " ").trim(); if (t) lead("devil", t); }
    }
  }
  if (!n.title && !n.chips.length) return null;
  if (!n.title) n.title = "The curse fires";
  n.title = capital(n.reject ? n.title : n.title.replace(/[.:]+$/, ""));
  return n;
}

/** The shop prompt's icon, from the item on sale (the well sells a blessing). */
export function shopIcon(item: string | undefined): NoticeIcon {
  return item === "heal" ? "heart" : item === "blade" ? "sword" : "coin";
}

/** The palettes (play.css, `data-scene` on the play root): the scene the popups sit in. The devil's overlay stays dark. */
export type SceneTheme = "village" | "forest" | "well" | "campfire" | "map" | "dark";
export function sceneTheme(screen: string, map: "closed" | "open" | "forced", devil = false): SceneTheme {
  if (devil || screen === "deal" || screen === "ending") return "dark";
  if (map !== "closed") return "map";
  switch (screen) {
    case "village": return "village";
    case "fight": return "forest";
    case "well": return "well";
    case "campfire": return "campfire";
    default: return "dark";
  }
}
