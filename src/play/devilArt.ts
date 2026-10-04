/**
 * The devil's portrait in his overlay: the designer's seven silhouettes (assets/devil_*.png, Big Chungus, 4 Oct),
 * bundled by Vite, stacked and cross-faded (play.css, `.play-devil-art`). Decorative: aria-hidden, never focusable,
 * no pointer events. Which pose shows is devilPose.ts; play.ts drives it. docs/play.md, "The devil's portrait".
 */
import headTilt from "../../assets/devil_head_tilt.png";
import laugh from "../../assets/devil_laugh.png";
import leanIn from "../../assets/devil_lean_in.png";
import leanLeft from "../../assets/devil_lean_left.png";
import left from "../../assets/devil_left.png";
import normal from "../../assets/devil_normal.png";
import right from "../../assets/devil_right.png";
import type { DevilPose } from "./devilPose";

const ART: Record<DevilPose, string> = { normal, lean_in: leanIn, head_tilt: headTilt, laugh, left, right, lean_left: leanLeft };

export interface DevilArt {
  el: HTMLElement;
  /** Show `pose`: a cross-fade, or an instant swap with `instant` (reduced motion). */
  set(pose: DevilPose, instant: boolean): void;
  pose(): DevilPose;
}

export function mountDevilArt(): DevilArt {
  const el = document.createElement("div");
  el.className = "play-devil-art";
  el.setAttribute("aria-hidden", "true");
  const imgs = new Map<DevilPose, HTMLImageElement>();
  for (const [pose, src] of Object.entries(ART) as [DevilPose, string][]) {
    const img = document.createElement("img");
    img.src = src; // all seven load up front, so a swap never waits on the network
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    img.dataset.pose = pose;
    imgs.set(pose, img);
    el.append(img);
  }
  let current: DevilPose = "normal";
  imgs.get(current)!.classList.add("on");
  el.dataset.pose = current;
  return {
    el,
    pose: () => current,
    set(pose, instant) {
      el.classList.toggle("instant", instant);
      if (pose === current) return;
      imgs.get(current)!.classList.remove("on");
      imgs.get(pose)!.classList.add("on");
      current = pose;
      el.dataset.pose = pose;
    },
  };
}
