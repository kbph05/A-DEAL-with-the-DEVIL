/** Test-only tools: the devil lab (HTTP backend tester) and autoplay. Loaded by dynamic import in test builds only; final builds tree-shake it out. */
import { autoplay, sanitizeDeal, setDevil, HttpDevil, DEFAULT_DEVIL_URL, type Exchange } from "../game";
import type { Session } from "../game/session";
import { diffDeal } from "./dealDiff";

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

export function mountTools(slot: HTMLElement, session: Session): void {
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
    const col = (title: string, ...kids: Node[]) => { const d = el("div"); d.append(el("h3", "", title), ...kids); return d; };
    const diff = el("ul", "diff"); for (const c of changes) diff.append(el("li", "", `${c.path}: ${c.note}`));
    const pre = (v: string) => el("pre", "", v);
    out.replaceChildren(
      col(`Request to ${x.url}`, pre(pretty(x.request))),
      col("Raw response", el("p", x.ok ? "ok" : "err", `${x.status !== null ? `HTTP ${x.status}` : "no response"} · ${x.ms} ms${x.error ? ` · ${x.error}` : ""}`), pre(x.raw !== undefined ? pretty(x.raw) : x.rawText || "(empty)")),
      col("Sanitized deal (what the engine uses)", pre(pretty(clean)), changes.length ? diff : el("p", "ok", "unchanged")),
    );
  }
  listeners.add(() => { sel = null; show(); });

  slot.replaceChildren(
    el("h2", "", "Test tools"),
    el("div", "row", "Autoplay:"), (() => { const r = el("div", "row"); r.append(apBtn); return r; })(), apOut,
    el("h2", "", "Devil lab"),
    (() => { const r = el("div", "row"), a = el("label", "", "Stub "), b = el("label", "", "HTTP backend "); a.prepend(stubR); b.prepend(httpR); r.append(a, b, url, apply); return r; })(),
    status,
    (() => { const r = el("div", "row"); r.append(text, send); return r; })(),
    hist, out,
  );
  show();
}
