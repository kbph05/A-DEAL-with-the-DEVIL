/** Test-only "Run & dev tools" column: seed, map, autoplay, raw state, and the devil lab (HTTP backend tester). Loaded by dynamic import in test builds only; final builds tree-shake it out. */
import { autoplay, sanitizeDeal, setDevil, HttpDevil, DEFAULT_DEVIL_URL, type Exchange } from "../game";
import type { Session } from "../game/session";
import { diffDeal } from "./dealDiff";
import { renderMap } from "./mapView";

export interface DevilConfig { mode: "stub" | "http"; url: string }
const KEY = "devil-lab.config";
const FALLBACK: DevilConfig = { mode: "stub", url: import.meta.env.VITE_DEVIL_URL || DEFAULT_DEVIL_URL };
const HISTORY_MAX = 10;

const history: Exchange[] = [];
const listeners = new Set<() => void>();
const record = (x: Exchange) => { history.unshift(x); history.length = Math.min(history.length, HISTORY_MAX); listeners.forEach((f) => f()); };

export function loadDevilConfig(): DevilConfig {
  try { return { ...FALLBACK, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return FALLBACK; }
}
/** Install the chosen devil for all future games (a running game keeps the devil it was created with). */
export function applyDevilConfig(c: DevilConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: just don't persist */ }
  setDevil(c.mode === "http" ? new HttpDevil(c.url, { onExchange: record }) : null);
}
/** Call once at boot, before the first game is created. */
export const applyStoredDevil = (): void => applyDevilConfig(loadDevilConfig());

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e;
};
const pretty = (v: unknown) => JSON.stringify(v, null, 2) ?? "";

/** Adds the "Run & dev tools" column to the UI layout (see mountUI). */
export function mountTools(layout: HTMLElement, session: Session): void {
  const slot = el("aside", "devtools");
  slot.setAttribute("aria-label", "Run and dev tools");
  layout.append(slot); layout.classList.add("with-tools");
  const cfg = loadDevilConfig();
  let sel: Exchange | null = null;

  // ---- autoplay ----
  const apBtn = el("button", "", "Autoplay to end"), apOut = el("p");
  apBtn.onclick = async () => {
    apBtn.disabled = true; apOut.textContent = "the bot is playing…";
    try {
      const seed = session.game().seed, r = await autoplay(seed); // default bot, devil = whichever is installed
      apOut.textContent = `seed "${r.seed}": ${r.outcome} in ${r.steps} steps, ${r.events.length} events (devil: ${loadDevilConfig().mode})`;
    } catch (e) { apOut.textContent = `autoplay failed: ${String(e)}`; }
    apBtn.disabled = false;
  };

  // ---- devil lab ----
  const stubR = el("input"), httpR = el("input");
  stubR.type = httpR.type = "radio"; stubR.name = httpR.name = "devil-mode";
  stubR.checked = cfg.mode === "stub"; httpR.checked = cfg.mode === "http";
  const url = el("input"); url.value = cfg.url; url.placeholder = DEFAULT_DEVIL_URL;
  const apply = el("button", "", "Apply & restart (same seed)");
  const status = el("p", "", `Active devil: ${cfg.mode}. A running game keeps its devil, so applying restarts the run.`);
  const read = (): DevilConfig => ({ mode: httpR.checked ? "http" : "stub", url: url.value.trim() || DEFAULT_DEVIL_URL });
  apply.onclick = () => { const c = read(); applyDevilConfig(c); session.newGame(session.game().seed); status.textContent = `Active devil: ${c.mode}${c.mode === "http" ? ` (${c.url})` : ""}.`; };

  const text = el("input"); text.placeholder = "player text to send";
  const send = el("button", "primary", "Send test offer");
  const hist = el("div", "hist"), out = el("div", "lab-cols");
  send.onclick = async () => {
    send.disabled = true;
    const g = session.game();
    sel = await new HttpDevil(read().url, { onExchange: record }).exchange(g.observe().state, g.context(), text.value || undefined);
    send.disabled = false; show();
  };

  function show() {
    const x = sel ?? history[0];
    hist.replaceChildren(...history.map((h) => {
      const b = el("button", h === x ? "sel" : "", `${new Date(h.at).toLocaleTimeString()} ${h.status ?? "ERR"} ${h.ms}ms${h.ok ? "" : " ✗"}`);
      b.onclick = () => { sel = h; show(); };
      return b;
    }));
    if (!x) { out.replaceChildren(el("p", "", "No exchanges yet. Send a test offer, or ask the devil in the game with HTTP mode on.")); return; }
    const clean = sanitizeDeal(x.ok ? x.raw : undefined);
    const changes = x.ok ? diffDeal(x.raw, clean, x.request.context.rewritable) : [{ path: "(request)", note: `${x.error}; the engine falls back to the silent devil` }];
    const col = (title: string, ...kids: Node[]) => { const d = el("div"); d.append(el("h4", "", title), ...kids); return d; };
    const diff = el("ul", "diff"); for (const c of changes) diff.append(el("li", "", `${c.path}: ${c.note}`));
    const pre = (v: string) => el("pre", "", v);
    out.replaceChildren(
      col(`Request to ${x.url}`, pre(pretty(x.request))),
      col("Raw response", el("p", x.ok ? "ok" : "err", `${x.status !== null ? `HTTP ${x.status}` : "no response"} · ${x.ms} ms${x.error ? ` · ${x.error}` : ""}`), pre(x.raw !== undefined ? pretty(x.raw) : x.rawText || "(empty)")),
      col("Sanitized deal (what the engine uses)", pre(pretty(clean)), changes.length ? diff : el("p", "ok", "unchanged")),
    );
  }
  listeners.add(() => { sel = null; show(); });

  // ---- run: seed, map, raw state ----
  const seedNow = el("code"), seedIn = el("input");
  seedIn.placeholder = "seed (blank = random)"; seedIn.setAttribute("aria-label", "Seed for the next run");
  const newBtn = el("button", "", "New game");
  newBtn.onclick = () => session.newGame(seedIn.value.trim() || undefined);
  const mapTitle = el("h3"), mapEl = el("div", "map");
  const rawState = el("pre"), rawMap = el("pre");

  const refresh = () => {
    const g = session.game(), m = g.map();
    seedNow.textContent = g.seed;
    mapTitle.textContent = `Map, act ${m.act + 1} (entry at bottom)`;
    renderMap(mapEl, m);
    rawState.textContent = pretty(g.observe()); rawMap.textContent = pretty(m);
  };
  session.subscribe(refresh);

  const row = (...kids: Node[]) => { const r = el("div", "row"); r.append(...kids); return r; };
  const det = (title: string, ...kids: Node[]) => { const d = el("details"); d.append(el("summary", "", title), ...kids); return d; };
  const lab = (...kids: Node[]) => { const d = el("div", "lab"); d.append(...kids); return d; };
  const radios = (() => { const a = el("label", "", "Stub "), b = el("label", "", "HTTP backend "); a.prepend(stubR); b.prepend(httpR); return [a, b]; })();
  text.setAttribute("aria-label", "Player text for a test offer");
  url.setAttribute("aria-label", "Devil backend URL");

  slot.replaceChildren(
    el("h2", "", "Run & dev tools"),
    row(el("span", "", "Seed:"), seedNow, seedIn, newBtn),
    el("h3", "", "Autoplay"), row(apBtn), apOut,
    mapTitle, mapEl,
    det("Raw state", el("h3", "", "observe()"), rawState, el("h3", "", "map()"), rawMap),
    el("h3", "", "Devil lab"),
    lab(row(...radios, url, apply), status, row(text, send), hist, out),
  );
  refresh();
  show();
}
