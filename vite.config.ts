import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "vite";

// The realtime fight (src/fight, with Phaser: about 1.2 MB) is part of the game and loads lazily on the first fight, as
// its own chunk, so the page itself stays light; hence the higher chunk-size warning limit in both modes. Test builds
// (mode "test": `npm run dev`, `npm run game`, `npm run build:test`) also ship the lab pages, fight.html and
// world.html; the final build has the single entry index.html, so the labs are not in dist/ (nor are the dev tools:
// see src/main.ts).
//
// Private art hook (docs/world.md): the file names in the gitignored public/assets/private/ are listed at startup
// and baked in as __PRIVATE_ASSETS__, so the world scene only requests files that exist (no 404s). Restart the dev
// server after adding files.
const privateDir = "public/assets/private";
const privateAssets = existsSync(privateDir) ? readdirSync(privateDir).filter((f) => /\.(png|json)$/i.test(f)).sort() : [];
const define = { __PRIVATE_ASSETS__: JSON.stringify(privateAssets) };
// Test builds have two Phaser pages (fight lab, world lab) sharing Phaser: give that shared chunk a clear name.
const phaserChunk = { codeSplitting: { groups: [{ name: "phaser", test: /[\\/]node_modules[\\/]phaser[\\/]/ }] } };

export default defineConfig(({ mode }) => (mode === "test"
  ? { define, build: { chunkSizeWarningLimit: 1400, rolldownOptions: { input: { index: "index.html", fight: "fight.html", world: "world.html" }, output: phaserChunk } } }
  : { define, build: { chunkSizeWarningLimit: 1400 } }));
