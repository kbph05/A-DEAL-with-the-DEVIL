# A DEAL with the DEVIL

## Build and run

Needs **Node.js 20+** (`node -v` to check).

```
git pull                 # get the latest
npm install              # install dependencies (first time, or after package.json changes)
npm run dev              # dev server; open the URL it prints (add ?seed=abc for a fixed map)
npm test                 # run the tests
npm run build            # production build into dist/
npm run preview          # serve dist/ locally to check the build
```

To share a build, upload the contents of `dist/` to itch.io (HTML game) or GitHub Pages.

Phaser 3 + Vite + TypeScript. Scaled with `Scale.FIT` (720×1280 design size) for mobile and desktop.
