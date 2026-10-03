import Phaser from "phaser";
import { generateAct, type Act, type Kind } from "../map";

const COLORS: Record<Kind, number> = {
  deal: 0xb3202a, village: 0x6aa84f, campfire: 0xe69138, well: 0x3d85c6,
  fight: 0x888888, boss: 0x5b0f8a, final: 0xffd966,
};

/** Placeholder map screen: draws act 1 of a seeded run. Tap a node to log it. Swap shapes for art later. */
export class MapScene extends Phaser.Scene {
  constructor() { super("map"); }

  create() {
    const seed = new URLSearchParams(location.search).get("seed") ?? String(Date.now());
    const act = generateAct(seed, 0);
    this.drawAct(act);
    this.add.text(16, 16, `seed ${seed}  ·  act ${act.index + 1}`, { color: "#ddd", fontSize: "24px" });
  }

  private drawAct(act: Act) {
    const { width, height } = this.scale;
    const layers = Math.max(...act.nodes.map((n) => n.layer)) + 1;
    const perLayer = new Map<number, number>();
    for (const n of act.nodes) perLayer.set(n.layer, (perLayer.get(n.layer) ?? 0) + 1);
    // Entry at the bottom, boss at the top, like Slay the Spire.
    const pos = (layer: number, slot: number) => ({
      x: (width * (slot + 1)) / ((perLayer.get(layer) ?? 1) + 1),
      y: height - 140 - (layer * (height - 280)) / Math.max(1, layers - 1),
    });
    const at = new Map(act.nodes.map((n) => [n.id, pos(n.layer, n.slot)]));
    const g = this.add.graphics().lineStyle(4, 0x553333);
    for (const n of act.nodes) for (const t of n.next) g.lineBetween(at.get(n.id)!.x, at.get(n.id)!.y, at.get(t)!.x, at.get(t)!.y);
    for (const n of act.nodes) {
      const { x, y } = at.get(n.id)!;
      this.add.circle(x, y, 38, COLORS[n.kind]).setStrokeStyle(4, 0x000000)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => console.log("node", n.id, n.kind));
      this.add.text(x, y + 50, n.kind, { color: "#eee", fontSize: "22px" }).setOrigin(0.5, 0);
    }
  }
}
