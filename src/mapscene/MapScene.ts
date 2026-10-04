/**
 * The map scene: the act as a Slay-the-Spire-style parchment map, drawn with Phaser. It only draws and reports taps;
 * which node is where comes from layout.ts, what each node is (current, visited, next, far, the lock) from the DAG model
 * in src/ui/logic.ts, and the DOM around it (the accessible button list, tooltips, the lock hint) from index.ts.
 *
 * Two cameras: the main one shows the world (parchment, edges, icons; zoomed to fit the width, scrolled up and down);
 * a fixed UI camera shows the legend, which is not part of the parchment. Beside the parchment when the screen is wide
 * enough (open by default); on narrow screens it is a card over the bottom-left corner, collapsed until the player opens it
 * with the "Legend" button (index.ts). The HUD's stats strip covers the top of the screen on phones, so the camera may scroll
 * the top of the parchment down clear of it (`covers`).
 */
import Phaser from "phaser";
import { hashSeed, mulberry32 } from "../map/rng";
import { ensureIcons, iconKey, loadPrivateIcons, type IconKey } from "./icons";
import { bandCenter, clampCenter, coveredTop, focusY, legendBeside, legendShown, mapZoom, MAP_WIDTH, type Cover, type LaidNode, type MapLayout } from "./layout";

export interface MapSceneModel {
  layout: MapLayout;
  seed: string;
  act: number;
  /** The one reason nothing can be clicked (the DAG's lock), or null. */
  lock: string | null;
}

export interface MapSceneHooks {
  /** A tap or click on a node (not a drag). */
  onTap(node: LaidNode): void;
  /** The pointer is over a node (or left it: null), at canvas coordinates. */
  onHover(node: LaidNode | null, x: number, y: number): void;
  /** The legend was opened or closed (by the toggle, or because the screen changed shape). */
  onLegend?(open: boolean): void;
  /** Overlays drawn over the map right now (canvas px), e.g. the HUD's stats strip: the camera keeps the top nodes clear of them. */
  covers?(): Cover[];
}

const INK = 0x24150e, INK_SOFT = 0x5a4632, GOLD = 0xffd34a, DEVIL_RED = 0xe02a1c;
const PARCH = { base: "#dcc79c", shades: ["#d3bd90", "#e4d1a8", "#cdb687", "#d8c296"], stain: "#c4a978", burn: ["#4a2c16", "#7a5230", "#a8844f", "#c4a674"] };
/** Icon display size (world units) by role. */
const SIZE = { node: 44, boss: 84, top: 50, legend: 24, star: 20, here: 30 };
const LEGEND: Array<{ key: IconKey; word: string }> = [
  { key: "village", word: "Village" }, { key: "fight", word: "Fight" }, { key: "campfire", word: "Campfire" },
  { key: "well", word: "Well" }, { key: "deal", word: "Devil's deal" }, { key: "boss", word: "Boss" },
  { key: "stairs", word: "Stairs down" }, { key: "final", word: "Final door" }, { key: "rewritten", word: "Devil's mark" },
];
const FONT = "ui-monospace, Menlo, Consolas, monospace";
const ROMAN = ["I", "II", "III", "IV", "V"];
/** Height (px) of the "Legend" toggle button (a DOM button, index.ts) that the narrow-screen legend card sits above. */
const LEGEND_BTN_H = 44;
/** Pointer travel (px) after which a press is a drag, not a tap. */
const DRAG_PX = 7;

export class MapScene extends Phaser.Scene {
  private model: MapSceneModel | null = null;
  private ready = false;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private worldObjs: Phaser.GameObjects.GameObject[] = [];
  private uiObjs: Phaser.GameObjects.GameObject[] = [];
  private parchKey = "";
  private centerY = 0;
  private zoomLevel = 1;
  /** True when there is no room beside the parchment: the legend is a card over the map's corner instead. */
  private legendOnMap = true;
  /** The player's own toggle; null follows the screen (legendShown). */
  private legendChoice: boolean | null = null;
  private legendWas: boolean | null = null;
  private legendRect: { x: number; y: number; w: number; h: number } | null = null;
  /** px at the top of the screen covered by overlays over the parchment (the HUD): the camera may go that far past the top. */
  private inset = 0;
  private worldH = 0;
  private press: { x: number; y: number; center: number; drag: boolean } | null = null;
  private scrollTween: Phaser.Tweens.Tween | null = null;
  private cursor: Phaser.GameObjects.Graphics | null = null;
  private focusId: string | null = null;
  private hoverId: string | null = null;
  /** Icons that came from public/assets/private/map/ (for the debug hook). */
  privateArt = new Set<IconKey>();

  private hooks: MapSceneHooks;

  constructor(hooks: MapSceneHooks) {
    super("mapscene");
    this.hooks = hooks;
  }

  /** New model (after every engine step). Safe before `create`: it is kept and drawn then. */
  setModel(m: MapSceneModel): void {
    const first = !this.model || this.model.seed !== m.seed || this.model.act !== m.act;
    this.model = m;
    if (this.ready) this.rebuild(first);
  }

  /** Keyboard focus moved to a node in the accessible list (or off it): draw the cursor and scroll it into view. */
  setFocus(id: string | null): void {
    this.focusId = id;
    if (!this.ready) return;
    this.drawCursor();
    const n = id ? this.model?.layout.byId.get(id) : null;
    if (n) {
      const half = this.cameras.main.height / (2 * this.zoomLevel);
      if (n.y < this.centerY - half + 60 + this.inset / this.zoomLevel || n.y > this.centerY + half - 60) this.scrollTo(bandCenter(n.y, this.zoomLevel, this.inset), true);
    }
  }

  /** Canvas coordinates of a node's centre (for tests and for placing DOM tooltips), or null. */
  screenOf(id: string): { x: number; y: number } | null {
    const n = this.model?.layout.byId.get(id);
    if (!n || !this.ready) return null;
    const cam = this.cameras.main;
    return { x: cam.width / 2 + (n.x - MAP_WIDTH / 2) * this.zoomLevel, y: cam.height / 2 + (n.y - this.centerY) * this.zoomLevel };
  }

  get view(): { zoom: number; centerY: number; worldH: number; legendOnMap: boolean; legendOpen: boolean; inset: number } {
    return { zoom: this.zoomLevel, centerY: this.centerY, worldH: this.worldH, legendOnMap: this.legendOnMap, legendOpen: this.legendOpen, inset: this.inset };
  }

  /** Is the legend showing (the player's choice, else open beside the parchment and collapsed over it). */
  get legendOpen(): boolean {
    const { width, height } = this.scale;
    return legendShown(width, height, this.legendChoice);
  }

  /** The "Legend" button: open it if it is collapsed, collapse it if it is open. From then on the screen's shape no longer decides. */
  toggleLegend(): void {
    this.legendChoice = !this.legendOpen;
    this.syncLegend();
  }

  private syncLegend(): void {
    if (this.ready) this.drawLegendUi();
    const open = this.legendOpen;
    if (open !== this.legendWas) { this.legendWas = open; this.hooks.onLegend?.(open); }
  }

  preload(): void {
    loadPrivateIcons(this); // a file that fails to load leaves its key free, and ensureIcons draws the generated one
  }

  create(): void {
    this.privateArt = ensureIcons(this);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, "ui");
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      this.press = { x: p.x, y: p.y, center: this.centerY, drag: false };
      this.hover(null, p);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.press && p.isDown) {
        if (!this.press.drag && Math.hypot(p.x - this.press.x, p.y - this.press.y) > DRAG_PX) {
          this.press.drag = true;
          this.scrollTween?.stop();
          this.hover(null, p);
        }
        if (this.press.drag) this.setCenter(this.press.center - (p.y - this.press.y) / this.zoomLevel);
        return;
      }
      this.hover(this.hit(p), p);
    });
    const release = (p: Phaser.Input.Pointer) => {
      const press = this.press;
      this.press = null;
      if (!press || press.drag) return;
      const n = this.hit(p);
      if (n) this.hooks.onTap(n);
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => { this.press = null; this.hover(null, null); });
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.scrollTween?.stop();
      this.setCenter(this.centerY + dy / this.zoomLevel);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.onResize());
    this.ready = true;
    if (this.model) this.rebuild(true);
  }

  // ---- camera ---------------------------------------------------------------------------------------------------

  /** Fit the parchment's width to the screen (with a little table showing), up to a zoom where icons stay sensible. */
  private fit(): void {
    const { width, height } = this.scale;
    this.zoomLevel = mapZoom(width, height);
    this.legendOnMap = !legendBeside(width, height);
    const half = (MAP_WIDTH * this.zoomLevel) / 2;
    this.inset = coveredTop(this.hooks.covers?.() ?? [], { left: width / 2 - half, right: width / 2 + half }, height);
    const cam = this.cameras.main;
    cam.setSize(width, height).setZoom(this.zoomLevel);
    this.uiCam.setSize(width, height);
  }

  private setCenter(y: number): void {
    this.centerY = clampCenter(y, this.worldH, this.cameras.main.height, this.zoomLevel, this.inset);
    this.cameras.main.centerOn(MAP_WIDTH / 2, this.centerY);
  }

  private scrollTo(y: number, animate: boolean): void {
    this.scrollTween?.stop();
    if (!animate) { this.setCenter(y); return; }
    const from = this.centerY;
    this.scrollTween = this.tweens.addCounter({
      from: 0, to: 1, duration: 450, ease: "Sine.easeInOut",
      onUpdate: (t) => this.setCenter(from + (y - from) * t.getValue()!),
    });
  }

  private onResize(): void {
    if (!this.model) return;
    this.fit();
    this.syncLegend();
    this.setCenter(this.centerY);
  }

  // ---- input ----------------------------------------------------------------------------------------------------

  private hit(p: Phaser.Input.Pointer): LaidNode | null {
    if (!this.model) return null;
    const lr = this.legendOpen ? this.legendRect : null;
    if (lr && p.x >= lr.x && p.x <= lr.x + lr.w && p.y >= lr.y && p.y <= lr.y + lr.h) return null; // the legend card is on top of the map
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    let best: LaidNode | null = null, bestD = Infinity;
    for (const n of this.model.layout.nodes) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d <= Math.max(n.r + 6, 24 / this.zoomLevel) && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  private hover(n: LaidNode | null, p: Phaser.Input.Pointer | null): void {
    const id = n?.id ?? null;
    if (id !== this.hoverId || n) this.hooks.onHover(n, p?.x ?? 0, p?.y ?? 0);
    this.hoverId = id;
    const clickable = !!n && n.node.state === "next" && !n.node.disabled;
    this.input.setDefaultCursor(clickable ? "pointer" : n ? "help" : this.press ? "grabbing" : "grab");
  }

  // ---- drawing --------------------------------------------------------------------------------------------------

  /** Everything in the world camera only, or in the UI camera only. */
  private inWorld<T extends Phaser.GameObjects.GameObject>(o: T): T { this.uiCam.ignore(o); this.worldObjs.push(o); return o; }
  private inUi<T extends Phaser.GameObjects.GameObject>(o: T): T { this.cameras.main.ignore(o); this.uiObjs.push(o); return o; }

  private rebuild(jump: boolean, refocus = true): void {
    const m = this.model!;
    this.fit();
    for (const o of this.worldObjs) { this.tweens.killTweensOf(o); o.destroy(); }
    this.worldObjs = [];
    this.cursor = null;
    const L = m.layout;
    this.worldH = L.height;
    this.drawParchment(m);
    this.drawEdges(m);
    for (const n of L.nodes) this.drawNode(n, m);
    this.syncLegend();
    this.drawCursor();
    this.cameras.main.setBackgroundColor("#1d1210");
    if (refocus) this.scrollTo(bandCenter(focusY(L), this.zoomLevel, this.inset), !jump && !this.press?.drag);
    else this.setCenter(this.centerY);
  }

  private drawParchment(m: MapSceneModel): void {
    const key = `mapscene-parch-${m.seed}-${m.act}-${this.worldH}`;
    if (key !== this.parchKey) {
      if (this.parchKey && this.textures.exists(this.parchKey)) this.textures.remove(this.parchKey);
      this.parchKey = key;
      const tw = MAP_WIDTH / 2, th = Math.ceil(this.worldH / 2);
      const tex = this.textures.createCanvas(key, tw, th)!;
      paintParchment(tex.getContext(), tw, th, hashSeed(`parch:${m.seed}:${m.act}`));
      tex.refresh();
    }
    this.inWorld(this.add.image(0, 0, key).setOrigin(0).setScale(2).setDepth(0));
    this.inWorld(this.add.text(MAP_WIDTH / 2, 46, `ACT ${ROMAN[m.act] ?? m.act + 1}`, { fontFamily: FONT, fontSize: "22px", fontStyle: "bold", color: "#3a2414", resolution: 3 })
      .setOrigin(0.5).setDepth(1).setAlpha(0.8));
    const rule = this.inWorld(this.add.graphics().setDepth(1));
    rule.fillStyle(INK_SOFT, 0.6);
    for (let x = MAP_WIDTH / 2 - 70; x <= MAP_WIDTH / 2 + 70; x += 8) rule.fillRect(x - 1, 66, 3, 2);
  }

  private drawEdges(m: MapSceneModel): void {
    const L = m.layout, g = this.inWorld(this.add.graphics().setDepth(2));
    const st = (id: string) => L.byId.get(id)?.node.state;
    const done = (id: string) => st(id) === "visited" || st(id) === "current";
    for (const e of L.edges) {
      const [a, b] = [e.points[0], e.points[e.points.length - 1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      if (done(e.from) && done(e.to)) { // walked: a solid ink line
        g.lineStyle(4, INK, 0.9).lineBetween(a.x, a.y, b.x, b.y);
        continue;
      }
      const out = st(e.from) === "current" && st(e.to) === "next";
      const far = !out && st(e.from) !== "current" && st(e.to) !== "next" && !done(e.from);
      // Dashes for the ways out of here, dots for the rest (fainter where nothing on it is reachable yet).
      const [dash, gap, w, color, alpha] = out ? [8, 5, 4, INK, m.lock ? 0.55 : 1] : [3, 7, 3, INK_SOFT, far ? 0.4 : 0.7];
      g.fillStyle(color, alpha);
      for (let t = 0; t < len; t += dash + gap) {
        const t1 = Math.min(len, t + dash);
        if (dash <= 3) g.fillRect(a.x + ux * t - w / 2, a.y + uy * t - w / 2, w, w);
        else { g.lineStyle(w, color, alpha).lineBetween(a.x + ux * t, a.y + uy * t, a.x + ux * t1, a.y + uy * t1); }
      }
    }
  }

  private icon(k: IconKey, x: number, y: number, size: number): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, iconKey(k));
    const s = size / Math.max(img.width, img.height);
    return img.setScale(s).setData("baseScale", s);
  }

  private drawNode(n: LaidNode, m: MapSceneModel): void {
    const state = n.node.state, size = n.kind === "boss" ? SIZE.boss : n.row === 0 ? SIZE.top : SIZE.node;
    const under = this.inWorld(this.add.graphics().setDepth(3));
    // A soft shadow, so icons sit on the paper.
    under.fillStyle(INK, 0.16).fillEllipse(n.x, n.y + size * 0.42, size * 0.9, size * 0.22);
    if (n.node.rewritten) under.fillStyle(DEVIL_RED, 0.22).fillCircle(n.x, n.y, n.r + 6);
    if (state === "current") {
      const glow = this.inWorld(this.add.circle(n.x, n.y, n.r + 10, GOLD, 0.45).setDepth(3));
      this.tweens.add({ targets: glow, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    const img = this.inWorld(this.icon(n.kind, n.x, n.y, size).setDepth(5));
    if (state === "far") img.setTint(0xa8987c).setAlpha(0.5);
    else if (state === "visited") img.setTint(0xc8b490).setAlpha(0.8);
    else if (state === "next" && m.lock) img.setAlpha(0.85);
    if (state === "visited" || state === "current") this.inkCircle(n, state === "current" ? 0.95 : 0.8);
    if (state === "next" && !m.lock) {
      const s = img.getData("baseScale") as number;
      this.tweens.add({ targets: img, scale: s * 1.16, duration: 620, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    if (n.node.rewritten) this.inWorld(this.icon("rewritten", n.x + n.r * 0.8, n.y - n.r * 0.8, SIZE.star).setDepth(6));
    if (state === "current") {
      // The player's token stands at the node's lower right, clear of the ways out (they all go up).
      const you = this.inWorld(this.icon("here", n.x + n.r * 0.95, n.y + n.r * 0.3, SIZE.here).setDepth(7));
      this.tweens.add({ targets: you, y: you.y - 3, duration: 420, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  /** The hand-drawn ink ring around a walked node: a little more than one turn, wobbling. */
  private inkCircle(n: LaidNode, alpha: number): void {
    const g = this.inWorld(this.add.graphics().setDepth(4));
    const r = mulberry32(hashSeed(`ink:${n.id}`)), start = r() * Math.PI * 2, R = n.r + 7;
    g.lineStyle(3, INK, alpha).beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = start + (i / 36) * Math.PI * 2, rr = R + (r() - 0.5) * 2.4 + (i / 40) * 2;
      if (i === 0) g.moveTo(n.x + Math.cos(a) * rr, n.y + Math.sin(a) * rr); else g.lineTo(n.x + Math.cos(a) * rr, n.y + Math.sin(a) * rr);
    }
    g.strokePath();
  }

  /** Corner brackets around the keyboard-focused node. */
  private drawCursor(): void {
    if (!this.model) return;
    if (!this.cursor) this.cursor = this.inWorld(this.add.graphics().setDepth(8));
    const g = this.cursor.clear(), n = this.focusId ? this.model.layout.byId.get(this.focusId) : null;
    if (!n) return;
    const R = n.r + 12, c = 9;
    g.lineStyle(3, DEVIL_RED, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = n.x + sx * R, y = n.y + sy * R;
      g.lineBetween(x, y, x - sx * c, y).lineBetween(x, y, x, y - sy * c);
    }
  }

  /**
   * The legend as a parchment card on the UI camera, `cols` columns, with its top-left corner at (left, top) in screen px.
   * Returns its size, so the caller can place it and keep taps on it from reaching the nodes underneath.
   */
  private drawLegend(left: number, top: number, cols: number): { w: number; h: number } {
    const rowH = cols === 1 ? 30 : 28, colW = cols === 1 ? 160 : 128, icon = cols === 1 ? 26 : SIZE.legend;
    const rows = Math.ceil(LEGEND.length / cols), w = cols * colW + 16, h = 40 + rows * rowH, cx = left + w / 2;
    const g = this.inUi(this.add.graphics().setDepth(9));
    g.fillStyle(0xe4d1a8, 1).fillRect(left, top, w, h);
    g.lineStyle(3, 0x5a3a1e, 1).strokeRect(left, top, w, h);
    g.lineStyle(1, 0x5a3a1e, 0.6).strokeRect(left + 4, top + 4, w - 8, h - 8);
    this.inUi(this.add.text(cx, top + 18, "LEGEND", { fontFamily: FONT, fontSize: "15px", fontStyle: "bold", color: "#3a2414", resolution: 3 }).setOrigin(0.5).setDepth(10));
    LEGEND.forEach((e, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = left + 12 + col * colW, y = top + 40 + row * rowH + rowH / 2 - 2;
      this.inUi(this.icon(e.key, x + icon / 2, y, icon).setDepth(10));
      this.inUi(this.add.text(x + icon + 8, y, e.word, { fontFamily: FONT, fontSize: "13px", color: "#24150e", resolution: 3 }).setOrigin(0, 0.5).setDepth(10));
    });
    return { w, h };
  }

  /** The legend, if it is open: beside the parchment on wide screens, else a card over the bottom-left corner above the toggle. */
  private drawLegendUi(): void {
    for (const o of this.uiObjs) o.destroy();
    this.uiObjs = [];
    this.legendRect = null;
    if (!this.legendOpen) return;
    const { width, height } = this.scale;
    if (!this.legendOnMap) {
      const right = width / 2 + (MAP_WIDTH * this.zoomLevel) / 2, h = 40 + LEGEND.length * 30, w = 176;
      const left = right + (width - right) / 2 - w / 2, top = Math.max(12, (height - h) / 2);
      const size = this.drawLegend(left, top, 1);
      this.legendRect = { x: left, y: top, ...size };
      return;
    }
    const h = 40 + Math.ceil(LEGEND.length / 2) * 28, left = 8, top = Math.max(8, height - 8 - LEGEND_BTN_H - 8 - h);
    const size = this.drawLegend(left, top, 2);
    this.legendRect = { x: left, y: top, ...size };
  }
}

/** The paper: speckled, a few stains, and a burnt, ragged edge. One texel is 2×2 world units. */
export function paintParchment(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const r = mulberry32(seed);
  const px = (x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PARCH.base;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.33) px(x, y, PARCH.shades[Math.floor(r() * PARCH.shades.length)]);
  // Stains: blotchy discs.
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < Math.ceil(h / 60); i++) {
    const cx = r() * w, cy = r() * h, rad = 4 + r() * 10;
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad * (0.7 + r() * 0.3)) px(Math.floor(cx + x), Math.floor(cy + y), PARCH.stain);
  }
  ctx.globalAlpha = 1;
  // Ragged, burnt edges: an inset that wanders, then a gradient of browns inward.
  const wander = (n: number) => { const a: number[] = []; let v = 2; for (let i = 0; i < n; i++) { v = Math.max(1, Math.min(5, v + Math.round((r() - 0.5) * 2))); a.push(v); } return a; };
  const left = wander(h), right = wander(h), top = wander(w), bottom = wander(w);
  const edge = (x: number, y: number, d: number) => {
    if (d < 0) { ctx.clearRect(x, y, 1, 1); return; }
    if (d < PARCH.burn.length) px(x, y, PARCH.burn[d]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.min(x - left[y], w - 1 - x - right[y], y - top[x], h - 1 - y - bottom[x]);
    if (d < PARCH.burn.length) edge(x, y, d);
  }
}

/** Kinds that have an icon (for the legend and the docs). */
export const ICON_WORDS: ReadonlyArray<{ key: IconKey; word: string }> = LEGEND;
