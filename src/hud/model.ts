/**
 * The in-game HUD's data: a pure projection of the engine's `View` (or a whole `GameState`) into exactly what the HUD
 * draws. No DOM, no CSS: it runs in Node tests. Everything is read defensively, so a partial object, an older save or
 * a newer engine with extra fields (a movement `speed`, an `inventory`) never throws. See docs/hud.md.
 */
import { isGameState, MAX_DEVIL_QUERIES, WARES, type Command, type GameState } from "../game/gameState";
import { view, type View } from "../game/view";
import { pointlessBuy } from "../ui/shopGuard";

/** One slot in the item bar: a ware you can buy here, or a consumable you hold. */
export interface HudItem {
  id: string;
  /** Short name for the slot ("Heal"). */
  label: string;
  /** What it does, one line ("+12 HP"). */
  hint: string;
  /** "ware": bought with gold on the spot (the engine's shop and well); "consumable": held, with a count. */
  kind: "ware" | "consumable";
  /** Gold cost (wares), else null. */
  cost: number | null;
  /** How many you hold (consumables), else null. The engine has no inventory yet, so this is null for every ware. */
  count: number | null;
  /** The engine would accept `command` right now (it is in the view's legal `actions`). */
  usable: boolean;
  /** Why not, in a few words, when not usable ("need 5g more"); null when usable. */
  reason: string | null;
  /** The command that uses it (`{cmd:"buy",item}` for wares; the matching legal command for consumables). */
  command: Command | null;
}

export interface HudCurse {
  trigger: string;
  /** Short chip text: "On hit: -4 HP". */
  label: string;
  /** Longer text for the tooltip and the aria-label. */
  tooltip: string;
}

export interface HudModel {
  hp: number;
  maxHp: number;
  gold: number;
  attack: number;
  /** Movement speed, only when the player state carries a numeric `speed`; else null (not shown). */
  speed: number | null;
  /** "kept": still yours; "sold": sold to the devil; "spent": paid for a revival. */
  soul: "kept" | "sold" | "spent";
  /** The one revival a kept soul pays for: "available", "used", or "forfeit" (soul sold, so no revival). */
  revive: "available" | "used" | "forfeit";
  /** The item bar: wares for sale at this node, then held consumables. Empty when there is nothing to show. */
  items: HudItem[];
  curses: HudCurse[];
  /** Devil questions: `questionsLeft` of `max` this run (MAX_DEVIL_QUERIES); `asksLeft` at this deal node, null elsewhere. */
  devil: { questionsLeft: number; max: number; asksLeft: number | null };
  /** 1-based act. */
  act: number;
  /** 1-based layer of the current node within the act, and the act's layer count; null at the final door or if unknown. */
  layer: number | null;
  layers: number | null;
  /** The current node's kind ("village", "fight", ...), or "" if unknown. */
  kind: string;
  ending: "win" | "lose" | "hell" | null;
  /** Waiting on the outside world: the devil's reply or a realtime fight's result. Items are not usable meanwhile. */
  busy: "devil" | "fight" | null;
}

// What each ware does, as the engine's `buy` applies it (src/game/state-machine.ts) and which node sells it
// (src/game/actions.ts). Copied here because the engine does not export them; costs come from WARES.
const WARE_INFO: Record<string, { label: string; hint: string; at: string }> = {
  heal: { label: "Heal", hint: "+12 HP", at: "village" },
  blade: { label: "Blade", hint: "+1 ATK", at: "village" },
  blessing: { label: "Blessing", hint: "+3 max HP, +1 ATK or +8 HP", at: "well" },
};

const TRIGGERS: Record<string, { short: string; when: string }> = {
  on_hit: { short: "On hit", when: "the next time an enemy hits you and survives the round" },
  on_enter: { short: "On arrival", when: "when you arrive at the next node" },
  on_fight: { short: "On fight", when: "when the next enemy appears" },
  next_node: { short: "On leaving", when: "when you leave this node" },
};

const STAT_NAMES: Record<string, string> = {
  hp: "HP", max_hp: "max HP", maxHp: "max HP", gold: "gold", attack: "ATK", damage: "ATK", soul: "soul", speed: "speed",
};

type Loose = Record<string, unknown>;
const obj = (x: unknown): Loose => (typeof x === "object" && x !== null ? x as Loose : {});
const num = (x: unknown, fallback: number): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** "-4 HP, +10 gold" from a curse or deal effect object (unknown keys keep their own name). */
export function effectText(effect: unknown): string {
  const parts = Object.entries(obj(effect))
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([k, v]) => `${signed(v as number)} ${STAT_NAMES[k] ?? k}`);
  return parts.join(", ") || "no effect";
}

export function curseInfo(c: unknown): HudCurse {
  const o = obj(c);
  const trigger = typeof o.trigger === "string" ? o.trigger : "unknown";
  const t = TRIGGERS[trigger] ?? { short: trigger, when: `on ${trigger}` };
  const fx = effectText(o.effect);
  return { trigger, label: `${t.short}: ${fx}`, tooltip: `Curse, fires once ${t.when}: ${fx}.` };
}

/** Accepts `{ id: count }` or `[{ id | item | name, count | n }]`; anything else is no inventory. */
function inventoryOf(src: Loose, player: Loose): Array<[string, number]> {
  const raw = src.inventory ?? player.inventory ?? player.items;
  const out: Array<[string, number]> = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      const o = obj(e), id = o.id ?? o.item ?? o.name;
      if (typeof id === "string") out.push([id, Math.max(0, Math.floor(num(o.count ?? o.n, 1)))]);
    }
  } else {
    for (const [id, n] of Object.entries(obj(raw))) if (typeof n === "number") out.push([id, Math.max(0, Math.floor(num(n, 0)))]);
  }
  return out.filter(([, n]) => n > 0);
}

const legal = (actions: unknown[], pred: (c: Loose) => boolean): Command | null =>
  (actions.find((a) => pred(obj(a))) as Command | undefined) ?? null;

/**
 * The HUD model for a `View` (`view(state)`, `Game.view()`) or a whole `GameState` (projected through `view`).
 * Missing fields fall back to neutral values; unknown extra fields are ignored except `speed` and `inventory`.
 */
export function hudModel(source: View | GameState | unknown): HudModel {
  let src: Loose = obj(source), player: Loose;
  if (isGameState(source)) {
    player = obj(source.player);
    try { src = view(source) as unknown as Loose; } catch { src = { state: player, act: player.act, curses: source.curses, ending: source.ending }; }
  } else {
    player = obj(src.state);
  }

  const maxHp = Math.max(1, num(player.maxHp, 1));
  const hp = Math.min(maxHp, Math.max(0, num(player.hp, 0)));
  const gold = Math.max(0, num(player.gold, 0));
  const kept = player.soul === undefined || player.soul === 1;
  const log = Array.isArray(player.log) ? player.log : [];
  const revived = log.some((l) => typeof l === "string" && l.startsWith("soul spent on a revival"));
  const soul = kept ? "kept" : revived ? "spent" : "sold";

  const actions = Array.isArray(src.actions) ? src.actions : [];
  const ending = src.ending === "win" || src.ending === "lose" || src.ending === "hell" ? src.ending : null;
  const busy = src.pending === true ? "devil" : obj(actions[0]).cmd === "fight_result" ? "fight" : null;
  const kind = typeof src.kind === "string" ? src.kind : "";

  // Where we are: the current node's layer in the act's map.
  let layer: number | null = null, layers: number | null = null;
  const mapLayers = obj(src.map).layers;
  if (Array.isArray(mapLayers)) {
    layers = mapLayers.length || null;
    mapLayers.forEach((l, i) => {
      const nodes = obj(l).nodes;
      if (Array.isArray(nodes) && nodes.some((n) => obj(n).current === true)) layer = i + 1;
    });
  }

  const blocked = (): string => ending ? "the run is over" : busy === "devil" ? "the devil is speaking" : busy === "fight" ? "finish the fight" : "not now";
  const items: HudItem[] = [];
  for (const [id, info] of Object.entries(WARE_INFO)) {
    if (info.at !== kind) continue;
    const cost = WARES[id as keyof typeof WARES].cost;
    const command = legal(actions, (c) => c.cmd === "buy" && c.item === id);
    let reason: string | null = null;
    if (!command) reason = ending || busy ? blocked() : kind === "well" && src.resolved === true ? "the well is spent" : gold < cost ? `need ${cost - gold}g more` : "not now";
    const pointless = command ? pointlessBuy(id, hp, maxHp) : null; // legal, but takes the gold for nothing (UI-only guard)
    if (pointless) reason = pointless;
    items.push({ id, label: info.label, hint: info.hint, kind: "ware", cost, count: null, usable: command !== null && !pointless, reason, command: command ?? { cmd: "buy", item: id } });
  }
  for (const [id, count] of inventoryOf(src, player)) {
    const command = legal(actions, (c) => c.item === id && c.cmd !== "buy");
    const name = WARE_INFO[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
    items.push({ id, label: name, hint: WARE_INFO[id]?.hint ?? "", kind: "consumable", cost: null, count, usable: command !== null, reason: command ? null : blocked(), command });
  }

  const asksLeft = kind === "deal" ? Math.max(0, num(src.asksLeft, 0)) : null;
  return {
    hp, maxHp, gold, attack: num(player.attack, 0),
    speed: typeof player.speed === "number" && Number.isFinite(player.speed) ? player.speed : null,
    soul, revive: kept ? "available" : revived ? "used" : "forfeit",
    items,
    curses: (Array.isArray(src.curses) ? src.curses : []).map(curseInfo),
    devil: { questionsLeft: Math.max(0, num(src.questionsLeft, MAX_DEVIL_QUERIES)), max: MAX_DEVIL_QUERIES, asksLeft },
    act: num(src.act ?? player.act, 0) + 1, layer, layers, kind, ending, busy,
  };
}

/**
 * What the HUD's polite live region should say after an update: HP and gold changes only, "" when neither changed
 * (so screen readers are not spammed on every frame).
 */
export function announce(prev: HudModel | null, next: HudModel): string {
  if (!prev) return "";
  const out: string[] = [];
  if (prev.hp !== next.hp || prev.maxHp !== next.maxHp) {
    const d = next.hp - prev.hp;
    out.push(`HP ${next.hp} of ${next.maxHp}${d ? `, ${d > 0 ? "up" : "down"} ${Math.abs(d)}` : ""}.`);
  }
  if (prev.gold !== next.gold) {
    const d = next.gold - prev.gold;
    out.push(`Gold ${next.gold}, ${d > 0 ? "up" : "down"} ${Math.abs(d)}.`);
  }
  if (prev.revive === "available" && next.revive === "used") out.push("Your soul paid for a revival.");
  return out.join(" ");
}
