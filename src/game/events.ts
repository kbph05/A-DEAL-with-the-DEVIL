import type { Kind, RewriteChange } from "../map";
import type { Curse, Deal } from "./devil";
import type { PlayerState, StatKey } from "./state";

export type ExitKind = Kind | "stairs" | "gate";
export interface Exit { n: number; kind: ExitKind }
export interface EnemyView { name: string; hp: number; maxHp: number; boss: boolean }
export type Stats = Pick<PlayerState, "hp" | "maxHp" | "gold" | "attack" | "soul">;
export type Deltas = Partial<Record<StatKey, number>>;
export type Ending = "win" | "lose" | "hell";

export type GameEvent =
  | { type: "started"; seed: string }
  | { type: "looked"; act: number; nodeId: string; kind: Kind; stats: Stats; exits: Exit[]; enemy: EnemyView | null; resolved: boolean; curses: Curse[]; offer: Deal | null }
  | { type: "moved"; from: string; to: string; kind: Kind; act: number }
  | { type: "act_advanced"; act: number }
  | { type: "enemy_appeared"; enemy: EnemyView }
  | { type: "fought"; dealt: number; enemyHp: number; taken: number }
  | { type: "enemy_slain"; name: string; gold: number; boss: boolean }
  | { type: "damaged"; amount: number; source: string; hp: number }
  | { type: "healed"; amount: number; source: string; hp: number }
  | { type: "bought"; item: string; cost: number; changes: Deltas }
  | { type: "deal_offered"; deal: Deal }
  | { type: "deal_applied"; deal: Deal; changes: Deltas }
  | { type: "deal_refused" }
  | { type: "curse_added"; curse: Curse }
  | { type: "curse_fired"; trigger: Curse["trigger"]; effect: Curse["effect"]; changes: Deltas }
  | { type: "node_rewritten"; change: RewriteChange }
  | { type: "rewrite_failed"; nodeId: string; reason: string }
  | { type: "revived"; hp: number }
  | { type: "won" }
  | { type: "hell" }
  | { type: "lost"; cause: string }
  | { type: "rejected"; reason: string }
  /** Sync points: the player stepped onto / off a deal node (the devil's table). */
  | { type: "devil_stage_entered"; nodeId: string }
  | { type: "devil_stage_left"; nodeId: string };

/** What every command returns. `ok: false` always carries exactly one `rejected` event and changes nothing. */
export interface Result { ok: boolean; events: GameEvent[]; state: PlayerState }

const LABEL: Record<string, string> = { hp: "HP", max_hp: "Max HP", gold: "Gold", attack: "Attack", soul: "Soul" };
export const fmtDeltas = (d: Record<string, number | undefined>): string =>
  Object.entries(d).filter(([, v]) => v).map(([k, v]) => `${LABEL[k] ?? k} ${v! > 0 ? "+" : ""}${v}`).join(", ") || "nothing";
const fmtStats = (s: Stats) => `HP ${s.hp}/${s.maxHp}  Gold ${s.gold}  Attack ${s.attack}  Soul ${s.soul ? "yours" : "gone"}`;

const BLURB: Record<Kind, string[]> = {
  campfire: ["A campfire gutters in a ring of black stones. Someone left it burning for you. Someone always does."],
  village: ["Shuttered windows and one open stall, lit by a lantern that burns too steadily."],
  well: ["A well with no rope. The water far below shows a sky you can't see from here."],
  deal: ["A table and two chairs, one occupied. The devil looks up as if you were late."],
  fight: ["Something stirs in the dark ahead."],
  boss: ["The way down is blocked by something that has been waiting a long time."],
  final: ["The last door."],
};

/** Bookkeeping events (backend sync points) that text front ends need not print. */
export const isSyncMarker = (e: GameEvent): boolean => e.type === "devil_stage_entered" || e.type === "devil_stage_left";

/** One-line (or short multi-line) plain text for an event: for the console and for reading transcripts. */
export function describe(e: GameEvent): string {
  switch (e.type) {
    case "started": return `New run, seed "${e.seed}".`;
    case "looked": {
      const lines = [`[Act ${e.act + 1}] ${e.nodeId} (${e.kind}): ${BLURB[e.kind][0]}`, fmtStats(e.stats)];
      if (e.enemy) lines.push(`Enemy: ${e.enemy.name} ${e.enemy.hp}/${e.enemy.maxHp} HP. fight()`);
      if (e.curses.length) lines.push(`Curses: ${e.curses.map((c) => `${c.trigger} -> ${fmtDeltas(c.effect)}`).join("; ")}`);
      if (e.offer) lines.push(`The devil's offer stands: ${e.offer.dialogue}`);
      if (!e.enemy) lines.push(e.exits.length ? `Exits: ${e.exits.map((x) => `${x.n}) ${x.kind}`).join("  ")}` : "No way onward.");
      return lines.join("\n");
    }
    case "moved": return `You go to ${e.to} (${e.kind}).`;
    case "act_advanced": return `You descend to act ${e.act + 1}.`;
    case "enemy_appeared": return `${e.enemy.boss ? "Boss" : "Enemy"}: ${e.enemy.name} (${e.enemy.hp} HP).`;
    case "fought": return `You hit for ${e.dealt}; it has ${e.enemyHp} HP left${e.taken ? `, and strikes back for ${e.taken}` : ""}.`;
    case "enemy_slain": return `${e.name} falls. +${e.gold} gold.`;
    case "damaged": return `You take ${e.amount} damage from ${e.source}. HP ${e.hp}.`;
    case "healed": return `You heal ${e.amount} (${e.source}). HP ${e.hp}.`;
    case "bought": return `Bought ${e.item} for ${e.cost}g: ${fmtDeltas(e.changes)}.`;
    case "deal_offered": {
      const d = e.deal;
      return [`DEVIL: "${d.dialogue}"`, `  gives: ${fmtDeltas(d.effects)}`,
        ...(d.curse ? [`  curse: ${d.curse.trigger} -> ${fmtDeltas(d.curse.effect)}`] : []),
        ...(d.rewrite ? [`  rewrites: ${d.rewrite.nodeId} -> ${d.rewrite.to}`] : []), "  accept() or refuse()"].join("\n");
    }
    case "deal_applied": return `Deal struck: ${fmtDeltas(e.changes)}.`;
    case "deal_refused": return "You refuse. The devil shrugs, a little too gracefully.";
    case "curse_added": return `A curse settles on you: ${e.curse.trigger} -> ${fmtDeltas(e.curse.effect)}.`;
    case "curse_fired": return `The curse (${e.trigger}) fires: ${fmtDeltas(e.changes)}.`;
    case "node_rewritten": return `The devil rewrote ${e.change.nodeId}: ${e.change.from} -> ${e.change.to}${e.change.polarityFlip ? " (good turned bad, or the reverse)" : ""}.`;
    case "rewrite_failed": return `The devil tried to rewrite ${e.nodeId} but could not: ${e.reason}.`;
    case "revived": return `You die, and your soul pays for it. You wake with ${e.hp} HP, and your soul is gone.`;
    case "won": return "You win. The devil is gracious about it, which is worse.";
    case "hell": return "You win. But you sold your soul: the devil collects. HELL ending.";
    case "lost": return `You died (${e.cause}). The devil keeps the change.`;
    case "rejected": return `(${e.reason})`;
    case "devil_stage_entered": return "You sit down at the devil's table.";
    case "devil_stage_left": return "You leave the devil's table.";
  }
}
