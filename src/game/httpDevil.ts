/** A Devil that asks an HTTP backend (kbph's Gemini proxy). Contract: docs/devil-api.md. DOM-free, no storage. */
import type { Deal, Devil, DevilContext } from "./devil";
import type { PlayerState } from "./state";

export const DEFAULT_DEVIL_URL = "http://localhost:8787/deal";
export const DEFAULT_TIMEOUT_MS = 15000;

export interface DevilRequest { state: PlayerState; context: DevilContext; playerText: string | null }

/** One round trip, success or not. `raw` is whatever JSON came back (even on a non-2xx), undefined if none parsed. */
export interface Exchange {
  at: number; url: string; request: DevilRequest;
  status: number | null; ok: boolean; raw: unknown; rawText: string; error?: string; ms: number;
}

export interface HttpDevilOptions { timeoutMs?: number; onExchange?: (x: Exchange) => void }

export class HttpDevil implements Devil {
  readonly url: string;
  private timeoutMs: number;
  private onExchange?: (x: Exchange) => void;

  constructor(url: string = DEFAULT_DEVIL_URL, opts: HttpDevilOptions = {}) {
    this.url = url;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onExchange = opts.onExchange;
  }

  /** Never throws: network errors, timeouts, non-2xx and bad JSON all come back as `error`. */
  async exchange(state: Readonly<PlayerState>, context: DevilContext, playerText?: string): Promise<Exchange> {
    const request: DevilRequest = { state: { ...state, log: [...state.log] }, context, playerText: playerText ?? null };
    const x: Exchange = { at: Date.now(), url: this.url, request, status: null, ok: false, raw: undefined, rawText: "", ms: 0 };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    const t0 = performance.now();
    try {
      const res = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: ctl.signal });
      x.status = res.status;
      x.rawText = await res.text();
      try { x.raw = JSON.parse(x.rawText); } catch { x.error = "response is not valid JSON"; }
      if (!res.ok) x.error = `HTTP ${res.status}`;
      else if (!x.error) x.ok = true;
    } catch (e) {
      x.error = ctl.signal.aborted ? `timed out after ${this.timeoutMs} ms` : `network error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      clearTimeout(timer);
      x.ms = Math.round(performance.now() - t0);
    }
    this.onExchange?.(x);
    return x;
  }

  /** Rejects on any failure; the engine's deal() catches that and falls back to a safe "silence" deal. */
  async offer(state: Readonly<PlayerState>, context: DevilContext, playerText?: string): Promise<Deal> {
    const x = await this.exchange(state, context, playerText);
    if (!x.ok) throw new Error(x.error ?? "devil backend failed");
    return x.raw as Deal; // unvalidated on purpose: the engine runs it through sanitizeDeal
  }
}
