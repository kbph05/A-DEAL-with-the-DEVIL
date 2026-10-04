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
import type { MapView, View } from "../game";
import { dagModel, type Dag, type DagNode } from "../ui/logic";
import { layoutMap, type LaidNode, type MapLayout } from "./layout";
import { MapScene } from "./MapScene";
import "./mapscene.css";

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
}

export interface MapDebug {
  dag: Dag;
  layout: MapLayout;
  /** Canvas-relative centre of a node on screen, or null before the scene is up. */
  screenOf(id: string): { x: number; y: number } | null;
  zoom: number;
  centerY: number;
  legendOnMap: boolean;
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
  el.append(host, nav, hint, tip);
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

  const scene = new MapScene({
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
    pixelArt: true,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, activePointers: 2 },
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth || 360, height: host.clientHeight || 640 },
    scene: [scene],
  });

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
      game.destroy(true);
      el.remove();
    },
    debug: () => ({ dag, layout, screenOf: (nid) => scene.screenOf(nid), ...scene.view, privateArt: [...scene.privateArt] }),
  };
}
