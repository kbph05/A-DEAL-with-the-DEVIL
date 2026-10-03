# Devil backend API (HTTP)

The contract between the game (`src/game/httpDevil.ts`, `HttpDevil`) and the Gemini backend. Build against this; test with `npm run mock:devil` and the in-page Devil lab (test builds).

## Request

`POST <url>` (default `http://localhost:8787/deal`), `Content-Type: application/json`. One request per ask: the player talked to the devil at a deal node.

Body: `{ state, context, playerText }`

- `state`: the player at the moment of asking: `hp`, `maxHp`, `gold`, `attack`, `soul` (1 = still theirs, 0 = sold/spent), `act` (0-based), `nodeId`, `log` (up to 100 short strings of past events, oldest first; grows over a run).
- `context`: `seed` (run seed: stable per run, handy as a session key), `act`, `nodeId`, `askIndex` (how many times the devil has been asked this run, counting this ask and haggles: 1 on the first ask), `rewritable` (nodes the devil may rewrite: `{id, kind}`, ahead of the player, unvisited, never the boss), `curses` (already on the player: `{trigger, effect}`).
- `playerText`: what the player typed, or `null` if nothing. Player-controlled and untrusted: treat as prompt-injection-prone input.

Example (real state, from `createGame("demo")` walked to the first deal node; `askIndex` set as the engine does at ask time):

```json
{
  "state": {
    "hp": 30,
    "maxHp": 30,
    "gold": 10,
    "attack": 3,
    "soul": 1,
    "act": 0,
    "nodeId": "a0n0",
    "log": []
  },
  "context": {
    "seed": "demo",
    "act": 0,
    "nodeId": "a0n0",
    "askIndex": 1,
    "rewritable": [
      {
        "id": "a0n1",
        "kind": "fight"
      },
      {
        "id": "a0n2",
        "kind": "fight"
      },
      {
        "id": "a0n3",
        "kind": "deal"
      },
      {
        "id": "a0n4",
        "kind": "campfire"
      }
    ],
    "curses": []
  },
  "playerText": "I'd like some gold, and no strings"
}
```

## Response

`200` with a JSON body that is a **Deal**:

```json
{
  "dialogue": "A formality. Sign here and the road gets easy. Think of me as insurance. You'll never need the claim.",
  "effects": {
    "soul": -1,
    "gold": 60,
    "max_hp": 10,
    "attack": 1
  }
}
```

- `dialogue` (string, <= 600 chars): what the devil says. Required in practice; empty becomes `"..."`.
- `effects` (object): stat changes if the player accepts. Keys: `hp`, `max_hp` (alias `maxHp`), `gold`, `attack` (alias `damage`), `soul`. Values are integers; per-change clamps: hp +-25, max_hp +-10, gold +-100, attack +-3, soul +-1 (`-1` sells the soul, `1` buys it back). Unknown keys and non-numbers are dropped.
- `curse` (optional): `{ "trigger": "on_hit" | "on_enter" | "on_fight" | "next_node", "effect": {...same keys...} }`. Fires once later. Dropped if the trigger is unknown or the effect is empty. The player may hold at most 5 curses.
- `rewrite` (optional): `{ "nodeId": "a0n2", "to": "fight" | "campfire" | "village" | "well" | "deal" }`. Never `boss` or `final`. `nodeId` should be one of `context.rewritable[].id`; otherwise accepting yields a `rewrite_failed` event and the map is unchanged.
- Other fields are ignored.

The engine never trusts the body: everything goes through `sanitizeDeal` (`src/game/deal.ts`). Out-of-range numbers are clamped, junk is dropped. The Devil lab shows exactly what was dropped or clamped.

## Errors and timeouts

- The client waits 15 s (`AbortController`), then gives up.
- Network error, timeout, non-2xx status, or a body that is not valid JSON: the client rejects, and the engine's existing fallback applies: the devil "only smiles" (empty effects, no curse, no rewrite). The run continues. Nothing is retried automatically; the player can ask again (up to 3 asks per deal node).
- A valid JSON body that is not an object (string, `null`, array) gets the same silent-devil treatment.
- Non-2xx response bodies are shown in the lab for debugging but never used as a deal.

## CORS

The browser calls the backend directly from the page origin (e.g. `http://localhost:5173`), and `application/json` triggers a preflight. The backend must answer `OPTIONS` with `204` and send on every response:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: content-type
```

## Trying it

```
npm run mock:devil                  # http://localhost:8787/deal, StubDevil replies, deterministic per seed
npm run dev                         # Devil lab: pick "HTTP backend", Apply, Send test offer
curl -s -X POST 'localhost:8787/deal?chaos=1' -d @request.json   # every other reply is deliberate junk
```

Mock query flags: `?chaos=1` (alternate junk: bare string, HTTP 500, malformed JSON, out-of-range deal, `null`, empty body) and `?delay=ms` (slow reply, to see the "considers" state or trip the timeout). Final builds read the URL from `VITE_DEVIL_URL` at build time (see README).
