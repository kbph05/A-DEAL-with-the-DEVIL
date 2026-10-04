export const GOOD_KINDS = ["deal", "village", "campfire", "well"] as const;
export const BAD_KINDS = ["fight", "boss"] as const;
export const KINDS = [...GOOD_KINDS, ...BAD_KINDS, "final"] as const;
export type Kind = (typeof KINDS)[number];
export type Polarity = "good" | "bad";

export const isKind = (k: unknown): k is Kind => (KINDS as readonly unknown[]).includes(k);
export const polarity = (k: Kind): Polarity =>
  (GOOD_KINDS as readonly string[]).includes(k) ? "good" : "bad";

export type Seed = number | string;

export interface MapNode {
  id: string;
  kind: Kind;
  /** 0 = entry. Edges only ever go from layer n to layer n+1. */
  layer: number;
  /** Position within the layer (0-based), for x layout. */
  slot: number;
  next: string[];
}

export interface Act {
  /** 0-based act index (0..2). */
  index: number;
  runSeed: Seed;
  /** Whether layers still alternate good/bad. Generated acts do; a devil rewrite that flips a node's polarity clears it. */
  alternate: boolean;
  /** 6-8 nodes, ordered by layer then slot. */
  nodes: MapNode[];
  entry: string;
  exit: string;
  /** Last act only: the win/lose node after the boss. Not in `nodes`; draw exit -> final. */
  final?: MapNode;
  /** Every devil rewrite so far, oldest first, so the UI can show the player what changed. */
  changes: RewriteChange[];
  /** Node ids already visited (not rewritable). */
  visited: string[];
}

export interface Modifiers {
  /** At least this many nodes of each kind (capped by free slots of the right polarity). */
  forceKinds?: Partial<Record<Kind, number>>;
  /** Kinds that never appear (unless that would leave a slot with no legal kind). */
  banKinds?: Kind[];
}

export interface GenOptions {
  /** Layers alternate good/bad so no edge joins same-polarity nodes. Default true. */
  alternate?: boolean;
  /** How often deal nodes come up, relative to a uniform draw over the kinds: 0..1, default DEAL_NODE_RATE (1/3); 1 = the odds before 4 Oct. */
  dealRate?: number;
}

export interface RewriteChange {
  nodeId: string;
  from: Kind;
  to: Kind;
  /** True when the swap crosses good/bad (e.g. campfire -> fight). */
  polarityFlip: boolean;
}

export type RewriteResult = { ok: true; act: Act; change: RewriteChange } | { ok: false; reason: string };
