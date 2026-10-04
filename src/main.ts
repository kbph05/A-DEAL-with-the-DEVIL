// Two flavours (see README): test builds (`npm run dev`, `npm run build:test`, Vite mode "test") add the console, autoplay and
// the devil lab. The final build tree-shakes all of that out: `import.meta.env.MODE` is replaced at build time, so the
// dynamic import below (and everything it pulls in) is dead code.
import { HttpDevil, setDevil } from "./game";
import { createSession } from "./game/session";
import { prefetchOnIdle } from "./ui/prefetch";
import { mountUI } from "./ui/ui";

async function main() {
  const seed = new URLSearchParams(location.search).get("seed") ?? undefined;
  const testTools = import.meta.env.MODE === "test";
  const tools = testTools ? await import("./ui/tools") : null;
  if (tools) tools.applyStoredDevil(); // before the first game is created: a game keeps the devil it starts with
  else if (import.meta.env.VITE_DEVIL_URL) setDevil(new HttpDevil(import.meta.env.VITE_DEVIL_URL)); // else: StubDevil
  const session = createSession(seed);
  const ui = mountUI(document.getElementById("app")!, session, tools ? tools.uiOptions() : {});
  // After first paint, in idle time: fetch the realtime fight's chunk (Phaser, about 1.2 MB) so the first fight starts at once.
  // (Destructuring `runFight` like ui.ts does keeps the chunk tree-shaken to what the UI uses.)
  prefetchOnIdle(async () => { const { runFight } = await import("./fight"); void runFight; });
  if (tools) {
    tools.mountTools(ui.layout, session);
    (await import("./game/console")).installConsole(window, session); // same Game instance as the UI
  }
}
void main();
