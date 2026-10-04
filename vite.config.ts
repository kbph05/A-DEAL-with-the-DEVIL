import { existsSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig } from "vite";
import { encryptedAssets } from "./tools/vite-plugin-encrypted-assets.ts";

// The realtime fight (src/fight, with Phaser: about 1.2 MB) is part of the game and loads lazily on the first fight, as
// its own chunk, so the page itself stays light; hence the higher chunk-size warning limit in both modes. Test builds
// (mode "test": `npm run dev`, `npm run game`, `npm run build:test`) also ship the lab pages (fight.html,
// world.html, hud.html, map.html) and the old DOM UI, classic.html (src/main.ts, with its dev tools). The entry
// index.html is the play page (docs/play.md) in every mode; the final build has only that entry, so the labs and
// the classic UI are not in dist/ (nor are the test-only flags: see src/play/play.ts).
//
// Private art hook (docs/world.md): the files in the gitignored public/assets/private/ (and its subfolders, e.g.
// scenes/<id>/background.png) are listed at startup and baked in as __PRIVATE_ASSETS__ (paths relative to that
// folder, with "/"), so the world scene only requests files that exist (no 404s). Restart the dev server after
// adding files.
//
// Encrypted art (docs/assets.md): with ASSET_KEY set, the encryptedAssets plugin decrypts assets/encrypted/*.enc in
// memory, adds them to __PRIVATE_ASSETS__, serves them at /assets/private/ in dev and preview, and emits them into
// builds. Without the key it does nothing. A real file in public/assets/private/ still wins.
const privateDir = "public/assets/private";
const privateAssets = existsSync(privateDir)
  ? readdirSync(privateDir, { recursive: true, encoding: "utf8" }).map((f) => f.split(sep).join("/")).filter((f) => /\.(png|jpe?g|webp|json)$/i.test(f)).sort()
  : [];
const define = { __PRIVATE_ASSETS__: JSON.stringify(privateAssets) };
// The designer's art in assets/ (the devil's poses, the forest band) is imported by the code; keep each a hashed file in
// the build instead of inlining the small ones (under 4 KB) as data URIs in the JS.
const repoArt = resolve("assets") + sep;
const assetsInlineLimit = (file: string): boolean | undefined => (file.startsWith(repoArt) ? false : undefined);
const plugins = [encryptedAssets()];
// Test builds have two Phaser pages (fight lab, world lab) sharing Phaser: give that shared chunk a clear name.
const phaserChunk = { codeSplitting: { groups: [{ name: "phaser", test: /[\\/]node_modules[\\/]phaser[\\/]/ }] } };

export default defineConfig(({ mode }) => (mode === "test"
  ? { define, plugins, build: { assetsInlineLimit, chunkSizeWarningLimit: 1400, rolldownOptions: { input: { index: "index.html", classic: "classic.html", fight: "fight.html", world: "world.html", hud: "hud.html", map: "map.html" }, output: phaserChunk } } }
  : { define, plugins, build: { assetsInlineLimit, chunkSizeWarningLimit: 1400 } }));
