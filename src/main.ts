// Console-only prototype round. To switch back to Phaser: restore the previous main.ts (git show HEAD:src/main.ts) and the #app container in index.html.
import { installConsole } from "./game/console";

const seed = new URLSearchParams(location.search).get("seed") ?? undefined;
installConsole(window, seed);
