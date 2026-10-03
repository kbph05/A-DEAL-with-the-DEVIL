import Phaser from "phaser";
import { MapScene } from "./scenes/MapScene";

// Mobile + desktop web: FIT scales the fixed design resolution to any screen, keeping aspect ratio.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#120a0a",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 720, height: 1280 },
  physics: { default: "arcade", arcade: { debug: false } },
  scene: [MapScene],
});
