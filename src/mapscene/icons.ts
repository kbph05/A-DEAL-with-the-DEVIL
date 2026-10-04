/**
 * The map's node icons: small pixel-art sprites drawn in code (16×16 grids of palette letters, painted onto canvas
 * textures), in the same generated style as the world scene's placeholders (src/world/textures.ts). No image files.
 *
 * Private art hook: a PNG at the gitignored public/assets/private/map/<kind>.png (campfire, fight, deal, well, village,
 * boss, final, stairs, and `rewritten` for the devil's mark) replaces the generated icon. As in the world scene,
 * vite.config.ts lists that folder into __PRIVATE_ASSETS__ at startup, so only files that exist are requested; a file
 * that fails to load falls back to the generated icon. Any size works: the scene scales it to the node's size.
 */
import type Phaser from "phaser";
import { privateFiles, privateUrl } from "../world/assets";
import type { DagKind } from "../ui/logic";

/** The node kinds, the devil's mark for rewritten nodes, and `here`: the player's token on the current node. */
export type IconKey = DagKind | "rewritten" | "here";
export const ICON_SIZE = 16;
export const ICON_KINDS: readonly DagKind[] = ["village", "fight", "campfire", "well", "deal", "boss", "stairs", "final"];
/** Texture key of an icon. */
export const iconKey = (k: IconKey): string => `mapicon-${k}`;
/** The private override's path inside public/assets/private/ (the `here` marker has none). */
export const privateIconFile = (k: IconKey): string => `map/${k}.png`;

/** Shared colours. `.` is transparent; `k` is the dark outline every icon has, so it reads on the parchment. */
const BASE: Record<string, string> = { k: "#24150e" };

interface Grid { palette: Record<string, string>; rows: string[] }

/** The pixel art, one string per row, 16 wide. */
export const ICONS: Record<IconKey, Grid> = {
  campfire: {
    palette: { R: "#c8321e", O: "#f08a24", Y: "#ffd34a", W: "#fff6c8", L: "#8a5428", D: "#5d3718", S: "#7d7a80" },
    rows: [
      "........k.......",
      ".......kRk......",
      "......kROk...k..",
      "......kROOk.kRk.",
      ".....kROYOk.kOk.",
      "....kROOYOOkROk.",
      "....kROYYYOROk..",
      "...kROYYWYYOOk..",
      "...kROYWWWYYOk..",
      "...kROYWWWWYOk..",
      "....kOYYWWYOk...",
      "..kkLkkOOOkkLkk.",
      ".kDLLLLkkkLLLLDk",
      "kSkDDLLLLLLLDDkS",
      ".kSSkkkkkkkkkSSk",
      "..kk........kk..",
    ],
  },
  fight: {
    palette: { S: "#e8ecf2", s: "#9aa3b2", G: "#e0b040", H: "#7a4a22" },
    rows: [
      "kk............kk",
      "kSk..........kSk",
      "ksSk........kSsk",
      ".ksSk......kSsk.",
      "..ksSk....kSsk..",
      "...ksSk..kSsk...",
      "....ksSkkSsk....",
      ".....ksSSsk.....",
      ".....kSsSsk.....",
      "....kSskksSk....",
      "..kkGkk..kkGkk..",
      "..kGGGk..kGGGk..",
      "...kHk....kHk...",
      "..kHk......kHk..",
      ".kGk........kGk.",
      ".kk..........kk.",
    ],
  },
  deal: {
    palette: { R: "#c0221c", r: "#8a1410", H: "#efe2c0", h: "#b8a888", Y: "#ffd34a", W: "#fff6e0" },
    rows: [
      ".k............k.",
      "kHk..........kHk",
      "kHhk........khHk",
      ".kHhk......khHk.",
      ".kHHkkkkkkkkHHk.",
      "..kkRRRRRRRRkk..",
      "..kRRRRRRRRRRk..",
      ".kRkkRRRRRRkkRk.",
      ".kRYYkRRRRkYYRk.",
      ".kRRYkRRRRkYRRk.",
      ".kRRRRRrrRRRRRk.",
      ".kRkRRRRRRRRkRk.",
      "..kRkWkWWkWkRk..",
      "..kRRkkkkkkRRk..",
      "...kkRRrrRRkk...",
      ".....kkRRkk.....",
    ],
  },
  well: {
    palette: { R: "#9a3a24", r: "#6e2416", P: "#8a5428", A: "#9a96a0", a: "#6d6672", Q: "#3c7ad0", q: "#8cc0f0", B: "#7a4a22" },
    rows: [
      "......kkkk......",
      "....kkRRRRkk....",
      "..kkRRRRRRRRkk..",
      ".kRRRRRRRRRRRRk.",
      "kkrrrrrrrrrrrrkk",
      "..kPk..k...kPk..",
      "..kPk..k...kPk..",
      "..kPk.kBk..kPk..",
      "..kPk.kBk..kPk..",
      ".kkkkkkkkkkkkkk.",
      "kAkQqQQQQQqQQkAk",
      "kAAkkkkkkkkkkAAk",
      "kAaAAAaAAAaAAAak",
      "kAAAaAAAaAAAaAAk",
      ".kaAAAaAAAaAAak.",
      "..kkkkkkkkkkkk..",
    ],
  },
  village: {
    palette: { R: "#b8402a", r: "#8a2c1c", W: "#e8d4a8", w: "#c4ac80", Y: "#ffd34a", D: "#7a4a22", C: "#7d7a80" },
    rows: [
      "..........kkk...",
      ".......kk.kCk...",
      "......kRRkkCk...",
      ".....kRRRRkCk...",
      "....kRRrRRRkk...",
      "...kRRrRRrRRk...",
      "..kRRrRRrRRrRk..",
      ".kRRrRRrRRrRRRk.",
      "kkkkkkkkkkkkkkkk",
      ".kWWWWWWWWWWWWk.",
      ".kWkkkWWWkkkkWk.",
      ".kWkYkWWWkDDkWk.",
      ".kWkkkWWWkDDkWk.",
      ".kwWWWWWWkDYkWk.",
      ".kwwwwwwwkDDkwk.",
      ".kkkkkkkkkkkkkk.",
    ],
  },
  boss: {
    palette: { H: "#5a1810", h: "#8a2a1a", B: "#efe6d0", b: "#b8ac90", R: "#ff3a20" },
    rows: [
      "k..............k",
      "khk..........khk",
      ".kHk........kHk.",
      ".khHk.kkkk.kHhk.",
      "..khHkBBBBkHhk..",
      "...kkBBBBBBkk...",
      "...kBBBBBBBBk...",
      "..kBBBBBBBBBBk..",
      "..kBkkkBBkkkBk..",
      "..kBkRkBBkRkBk..",
      "..kBkkkbbkkkBk..",
      "..kbBBBkkBBBbk..",
      "...kbBBBBBBbk...",
      "....kBkBkBkBk...",
      "....kbkbkbkbk...",
      ".....kkkkkkk....",
    ],
  },
  stairs: {
    palette: { T: "#c4bcc8", R: "#7d7484", r: "#5a5260", V: "#120a0a" },
    rows: [
      "................",
      "...........kkkkk",
      "...........kTTTk",
      "...........kRRRk",
      "........kkkkrRRk",
      "........kTTTrRRk",
      "........kRRRrRRk",
      ".....kkkkrRRrRRk",
      ".....kTTTrRRrRRk",
      ".....kRRRrRRrRRk",
      "..kkkkrRRrRRrRRk",
      "..kTTTrRRrRRrRRk",
      "..kRRRrRRrRRrRRk",
      "kkVVVVVVVVVVVVVk",
      "kVVVVVVVVVVVVVVk",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  final: {
    palette: { A: "#9a96a0", a: "#6d6672", D: "#8a5428", d: "#5d3718", G: "#ffd34a", V: "#2a1a12" },
    rows: [
      ".....kkkkkk.....",
      "...kkAAAAAAkk...",
      "..kAAkkkkkkAAk..",
      ".kAkkDDdDDdkkAk.",
      ".kAkDDdDDdDDkAk.",
      "kAkDDdDDdDDdDkAk",
      "kAkDdDDdDDdDDkAk",
      "kakDdDDdDDdDDkak",
      "kAkDdDDdDDdGDkAk",
      "kAkDdDDdDDdGDkAk",
      "kakDdDDdDDdDDkak",
      "kAkDdDDdDDdDDkAk",
      "kAkDdDDdDDdDDkAk",
      "kakDdDDdDDdDDkak",
      "kAkDdDDdDDdDDkAk",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  rewritten: {
    palette: { R: "#e02a1c", Y: "#ffd34a" },
    rows: [
      "................",
      ".......kk.......",
      "......kRRk......",
      "......kRRk......",
      ".....kRRRRk.....",
      "kkkkkkRYYRkkkkkk",
      "kRRRRRRYYRRRRRRk",
      ".kRRRRYYYYRRRRk.",
      "..kRRRRYYRRRRk..",
      "...kRRRRRRRRk...",
      "...kRRRkkRRRk...",
      "..kRRRk..kRRRk..",
      "..kRRk....kRRk..",
      ".kRRk......kRRk.",
      ".kkk........kkk.",
      "................",
    ],
  },
  here: {
    palette: { H: "#5a3825", S: "#f1c27d", T: "#3a6fd8", B: "#3b2a1a", L: "#3b3346" },
    rows: [
      "................",
      "......kkkk......",
      ".....kHHHHk.....",
      "....kHHHHHHk....",
      "....kHSSSSHk....",
      "....kSkSSkSk....",
      "....kSSSSSSk....",
      ".....kSSSSk.....",
      "....kTTTTTTk....",
      "...kSTTTTTTSk...",
      "...kSTBBBBTSk...",
      "....kTTTTTTk....",
      "....kLLkkLLk....",
      "....kLLk.kLLk...",
      "....kkk..kkk....",
      "................",
    ],
  },
};

/** Paint one icon's grid at (ox, oy), one canvas pixel per cell. */
export function paintIcon(ctx: CanvasRenderingContext2D, k: IconKey, ox = 0, oy = 0): void {
  const g = ICONS[k], pal = { ...BASE, ...g.palette };
  g.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = pal[ch];
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }));
}

/** Every icon that has a private override file present (by the build-time listing). */
export const privateIcons = (files: readonly string[] = privateFiles()): IconKey[] =>
  (Object.keys(ICONS) as IconKey[]).filter((k) => k !== "here" && files.includes(privateIconFile(k)));

/** Preload hook: queue the private PNGs that exist. Call from the scene's `preload`. */
export function loadPrivateIcons(scene: Phaser.Scene): void {
  for (const k of privateIcons()) scene.load.image(iconKey(k), privateUrl(privateIconFile(k)));
}

/** Create hook: draw the generated texture for every icon without a (loaded) private one. Returns which are private. */
export function ensureIcons(scene: Phaser.Scene): Set<IconKey> {
  const priv = new Set<IconKey>();
  for (const k of Object.keys(ICONS) as IconKey[]) {
    if (scene.textures.exists(iconKey(k))) { if (privateIcons().includes(k)) priv.add(k); continue; }
    const tex = scene.textures.createCanvas(iconKey(k), ICON_SIZE, ICON_SIZE)!;
    paintIcon(tex.getContext(), k);
    tex.refresh();
  }
  return priv;
}
