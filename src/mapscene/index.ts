/**
 * The map scene, public API (docs/mapscene.md). `mountMap(parent, { onGo, map, view })` mounts the act's map in `parent`
 * (which must be positioned: the scene fills it) and returns `{ update(map, view), destroy() }`. Call `update` after
 * every engine step. A tap on a pulsing node calls `onGo(n)` with the engine's `go` exit number, exactly as the DOM DAG
 * does; send `{ cmd: "go", n }`. The HUD (mountHud) can be mounted over it in the same parent.
 *
 * The canvas is drawn by Phaser (MapScene.ts); this file adds the DOM around it: a visually hidden list of buttons for
 * the next nodes (keyboard and screen readers: Tab to it, arrow keys move between nodes, Enter goes), the hover
 * tooltip, and the hint line that shows why nothing can be clicked (the devil is speaking, a fight is on).
 */
import Phaser from "phaser";
import { destroyGame } from "../destroyGame";
import type { MapView, View } from "../game";
import { dagModel, type Dag, type DagNode } from "../ui/logic";
import { layoutMap, type Cover, type LaidNode, type MapLayout } from "./layout";
import { MapScene } from "./MapScene";
import "./mapscene.css";
import { GAME_FPS } from "../gameLoop";

export { layoutMap, focusY, MAP_WIDTH, type MapLayout, type LaidNode, type LaidEdge } from "./layout";
export { ICONS, ICON_KINDS, iconKey, privateIconFile, type IconKey } from "./icons";

export interface MountMapOptions {
  /** A next node was chosen: send `{ cmd: "go", n }` to the engine. */
  onGo(n: number): void;
  /** The current act (`view.map`, `game.map()`). */
  map: MapView;
  /** The engine's view (`game.view()`): where you stand, the lock, and the legal `actions`. */
  view: View;
  /** The UI is waiting on something of its own (e.g. a network devil): lock the map as "The devil considers…". */
  busy?: boolean;
  /**
   * Elements drawn over the map that should not hide its topmost nodes, e.g. `() => [hud.querySelector(".hud-stats")]`.
   * Called on every layout: the camera may scroll the top of the parchment down clear of the ones that cover it (those over
   * the parchment's top half; a strip beside it on a wide screen does not count). Hidden elements are ignored.
   */
  overlays?: () => Array<Element | null | undefined>;
}

export interface MapDebug {
  dag: Dag;
  layout: MapLayout;
  /** Canvas-relative centre of a node on screen, or null before the scene is up. */
  screenOf(id: string): { x: number; y: number } | null;
  zoom: number;
  centerY: number;
  /** No room beside the parchment: the legend is a card over the map's corner, behind the "Legend" button. */
  legendOnMap: boolean;
  /** Is the legend showing right now? */
  legendOpen: boolean;
  /** px at the top of the map kept clear of `overlays`. */
  inset: number;
  /** Icons replaced by private art. */
  privateArt: string[];
}

export interface MapHandle {
  el: HTMLElement;
  update(map: MapView, view: View, busy?: boolean): void;
  destroy(): void;
  /** Test hook: the current model and where things are on screen. */
  debug(): MapDebug;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let uid = 0;

export function mountMap(parent: HTMLElement, options: MountMapOptions): MapHandle {
  const id = `mapscene-${++uid}`;
  const el = h("div", "mapscene");
  const host = h("div", "mapscene-canvas");
  host.tabIndex = -1; // focusable by click, so arrow keys reach us; not a Tab stop (the buttons are)
  const nav = h("nav", "mapscene-sr");
  nav.setAttribute("aria-label", "Map");
  const title = h("h2"), where = h("p"), list = h("ul");
  nav.append(title, where, list);
  const hint = h("div", "mapscene-hint");
  hint.id = `${id}-hint`;
  hint.setAttribute("role", "status");
  hint.setAttribute("aria-live", "polite");
  const tip = h("div", "mapscene-tip");
  tip.setAttribute("aria-hidden", "true");
  tip.hidden = true;
  // The legend is drawn by the scene; this button shows or hides it (collapsed on narrow screens, open on wide ones).
  const legendBtn = h("button", "mapscene-legend-btn", "Legend");
  legendBtn.type = "button";
  legendBtn.append(h("span", "chev", "▾"));
  legendBtn.setAttribute("aria-expanded", "false");
  legendBtn.onclick = () => scene.toggleLegend();
  el.append(host, nav, hint, tip, legendBtn);
  parent.append(el);

  let dag: Dag, layout: MapLayout;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastText: string | null = null;

  const showHint = () => {
    const text = toastText ?? dag.lock;
    hint.textContent = text ?? "";
    hint.hidden = !text;
  };
  const toast = (text: string) => {
    toastText = text;
    showHint();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastText = null; showHint(); }, 2600);
  };

  const choose = (n: DagNode) => {
    if (n.state === "next" && !n.disabled && n.n !== null) { toastText = null; options.onGo(n.n); return; }
    toast(n.state === "next" ? n.disabled ?? n.label : n.label);
  };

  const covers = (): Cover[] => {
    const base = host.getBoundingClientRect();
    return (options.overlays?.() ?? []).flatMap((o) => {
      const r = o?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? [{ left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top }] : [];
    });
  };
  const scene = new MapScene({
    covers,
    onLegend(open) {
      legendBtn.setAttribute("aria-expanded", String(open));
      legendBtn.classList.toggle("open", open);
    },
    onTap: (n: LaidNode) => choose(n.node),
    onHover(n, x, y) {
      if (!n) { tip.hidden = true; return; }
      tip.textContent = n.node.label;
      tip.hidden = false;
      const w = el.clientWidth;
      tip.style.left = `${Math.max(8, Math.min(w - tip.offsetWidth - 8, x + 14))}px`;
      tip.style.top = `${Math.max(8, y - 44)}px`;
    },
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: "#1d1210",
    banner: false,
    fps: GAME_FPS, // no half-speed start (src/gameLoop.ts)
    pixelArt: true,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, activePointers: 2 },
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth || 360, height: host.clientHeight || 640 },
    scene: [scene],
  });
  // RESIZE mode alone can miss a phone turning: Phaser refreshes on the orientation event before it has read the parent's
  // new size, then its resize poll sees no change, and the map stays laid out for the old shape (half off screen, the
  // next nodes out of reach). Refresh again once the container has its new size, as runForestFight does.
  let pending = 0;
  const watch = new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const b = host.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && (Math.round(b.width) !== game.scale.width || Math.round(b.height) !== game.scale.height)) { game.scale.getParentBounds(); game.scale.refresh(); }
    });
  });
  watch.observe(host);

  /** The accessible list: one button per next node (disabled ones stay focusable and say why), roving tabindex. */
  function renderList() {
    const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;
    const cur = dag.rows.flat().find((n) => n.state === "current");
    title.textContent = `Map, act ${(options.map.act ?? 0) + 1}`;
    where.textContent = cur ? cur.label : "";
    const next = dag.rows.flat().filter((n) => n.state === "next");
    list.replaceChildren(...next.map((n, i) => {
      const b = h("button", "", n.label);
      b.type = "button";
      b.dataset.id = n.id;
      b.tabIndex = i === 0 ? 0 : -1;
      if (n.disabled) { b.setAttribute("aria-disabled", "true"); b.setAttribute("aria-describedby", hint.id); }
      b.onclick = () => choose(n);
      b.onfocus = () => { for (const x of list.querySelectorAll("button")) x.tabIndex = x === b ? 0 : -1; scene.setFocus(n.id); };
      b.onblur = () => setTimeout(() => { if (!list.contains(document.activeElement)) scene.setFocus(null); });
      const li = h("li");
      li.append(b);
      return li;
    }));
    if (focused !== undefined) (list.querySelector<HTMLButtonElement>(`[data-id="${focused}"]`) ?? list.querySelector("button"))?.focus();
  }

  el.addEventListener("keydown", (e) => {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("button")];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (step) {
      e.preventDefault();
      buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length].focus();
    } else if ((e.key === "Enter" || e.key === " ") && i < 0) {
      e.preventDefault();
      buttons[0].focus();
    }
  });
  host.addEventListener("pointerdown", () => host.focus({ preventScroll: true }));

  function update(map: MapView, view: View, busy = false) {
    options.map = map;
    tip.hidden = true; // the map may have scrolled under the pointer

    dag = dagModel(view, map, busy, view.actions);
    layout = layoutMap(dag, view.seed, map.act);
    scene.setModel({ layout, seed: view.seed, act: map.act, lock: dag.lock });
    renderList();
    showHint();
  }
  update(options.map, options.view, options.busy);

  let destroyed = false;
  return {
    el,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(toastTimer);
      cancelAnimationFrame(pending);
      watch.disconnect();
      destroyGame(game);
      el.remove();
    },
    debug: () => ({ dag, layout, screenOf: (nid) => scene.screenOf(nid), ...scene.view, privateArt: [...scene.privateArt] }),
  };
}
