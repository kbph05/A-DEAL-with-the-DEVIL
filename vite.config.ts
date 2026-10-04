import { defineConfig } from "vite";

// The realtime fight (src/fight, with Phaser: about 1.2 MB) is part of the game and loads lazily on the first fight, as
// its own chunk, so the page itself stays light; hence the higher chunk-size warning limit in both modes. Test builds
// (mode "test": `npm run dev`, `npm run build:test`) also ship the fight lab page, fight.html; the final build has the
// single entry index.html, so the lab is not in dist/ (nor are the dev tools: see src/main.ts).
export default defineConfig(({ mode }) => (mode === "test"
  ? { build: { chunkSizeWarningLimit: 1400, rolldownOptions: { input: { index: "index.html", fight: "fight.html" } } } }
  : { build: { chunkSizeWarningLimit: 1400 } }));
