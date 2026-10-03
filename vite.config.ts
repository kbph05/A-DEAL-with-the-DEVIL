import { defineConfig } from "vite";

// Test builds (mode "test": `npm run dev`, `npm run build:test`) also ship the fight lab page, fight.html, which
// pulls in Phaser (about 1.2 MB, hence the higher warning limit there). The final build is left on Vite's
// defaults (the single entry index.html), so the lab and Phaser are not in dist/.
export default defineConfig(({ mode }) => (mode === "test"
  ? { build: { chunkSizeWarningLimit: 1400, rolldownOptions: { input: { index: "index.html", fight: "fight.html" } } } }
  : {}));
