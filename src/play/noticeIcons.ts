/** The notice card's pixel icons the map's icon set lacks (coin, heart, X), in the same style: 16x16 grids of palette letters, `k` the dark outline. The flame, sword and devil are the map's campfire, fight and deal icons (play.ts). */
const BASE: Record<string, string> = { k: "#24150e" };
interface Grid { palette: Record<string, string>; rows: string[] }

export const NOTICE_ICONS: Record<"coin" | "heart" | "cross", Grid> = {
  coin: {
    palette: { Y: "#ffd34a", W: "#fff6c8", O: "#d89a1c" },
    rows: [
      "................",
      ".....kkkkkk.....",
      "...kkYYYYYYkk...",
      "..kYYWWYYYYOYk..",
      "..kYWYYYYYYYOk..",
      ".kYWYYYkkYYYYOk.",
      ".kYYYYkYYkYYYOk.",
      ".kYYYYkYYkYYYOk.",
      ".kYYYYkYYkYYYOk.",
      ".kYYYYkYYkYYYOk.",
      ".kYYYYYkkYYYYOk.",
      "..kYYYYYYYYYOk..",
      "..kYYYYYYYYOOk..",
      "...kkOOOOOOkk...",
      ".....kkkkkk.....",
      "................",
    ],
  },
  heart: {
    palette: { R: "#d8372a", r: "#a8201a", W: "#ffb0a0" },
    rows: [
      "................",
      "................",
      "..kkkk....kkkk..",
      ".kRRRRk..kRRRRk.",
      "kRWWRRRkkRRRRRRk",
      "kRWRRRRRRRRRRRRk",
      "kRRRRRRRRRRRRRrk",
      "kRRRRRRRRRRRRrrk",
      ".kRRRRRRRRRRrrk.",
      "..kRRRRRRRRrrk..",
      "...kRRRRRRrrk...",
      "....kRRRRrrk....",
      ".....kRRrrk.....",
      "......kRrk......",
      ".......kk.......",
      "................",
    ],
  },
  cross: {
    palette: { R: "#e04a3a" },
    rows: [
      "................",
      "................",
      "..kk........kk..",
      ".kRRk......kRRk.",
      "..kRRk....kRRk..",
      "...kRRk..kRRk...",
      "....kRRkkRRk....",
      ".....kRRRRk.....",
      ".....kRRRRk.....",
      "....kRRkkRRk....",
      "...kRRk..kRRk...",
      "..kRRk....kRRk..",
      ".kRRk......kRRk.",
      "..kk........kk..",
      "................",
      "................",
    ],
  },
};

export function paintNoticeIcon(ctx: CanvasRenderingContext2D, k: keyof typeof NOTICE_ICONS): void {
  const g = NOTICE_ICONS[k], pal = { ...BASE, ...g.palette };
  g.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = pal[ch];
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  }));
}
