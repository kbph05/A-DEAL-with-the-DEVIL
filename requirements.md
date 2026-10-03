# A DEAL with the DEVIL: requirements

StormHacks 2026, team Spin 2 Win. Drafted from the team chat on 3 Oct. **Locked** means agreed; **Open** means still to decide.

## Concept (locked)
- A roguelike in which you make deals with an LLM devil (Gemini) who argues in bad faith.
- The devil wants your soul and a good time. He makes bets to make you lose, but he can slip up, and you can trick him.
- Bad faith can end a run but must **never crash the game**, and every deal must have counterplay.

## Run structure (locked)
- A run is a DAG of nodes, Slay the Spire style.
- It has **3 acts of 6–8 seeded-random nodes** each. Each act has one entry node and one exit node, the acts are chained together, and the **final win/lose node** comes after act 3.
- Act 1 is generated at the start; acts 2–3 are generated when the player reaches them.
- **Devil deals can rewrite nodes further along the run** (swap or replace upcoming nodes).

## Nodes (proposed)
- **Good:** deal (a bet or a deal), village (trade or sell), campfire (heal or cook), well (blessings for coins).
- **Bad:** fight, boss, and the final node (win or lose).
- Every path converges on the final boss.
- Open: do good and bad nodes strictly alternate by layer?

## Player (partly locked)
- **HP:** at 0 or below, the player loses. (locked)
- **Soul:** exactly 1, the last resort. Trading it revives you once, but winning after selling it sends you to hell. (locked)
- Other stats (speed, money, attack rate, …) and items: **open**. The list needs exact names and ranges.

## Deal format (proposed)
Gemini returns JSON. The game validates it, clamps every number to its stat's range, and ignores unknown keys.
```json
{
  "dialogue": "Double damage? Done. Mind the stairs.",
  "effects": { "damage": 5, "max_hp": -2 },
  "curse": { "trigger": "on_hit", "effect": { "stun_secs": 2 } }
}
```
- `dialogue` is shown as the devil's speech.
- `effects` holds signed stat changes, applied right away.
- `curse` is optional and fires later on a trigger. This is where the bad faith lives.

## Prototype scope (proposed by Big Chungus)
- A top-down or orthographic 2D character controller.
- A 2D tile system.
- Basic enemies.
- A drawable map or image system.
- A map generator, with random nodes each run.

## Tech (locked)
- **Platforms:** mobile and desktop web app (locked 3 Oct). Use responsive scaling (Phaser `Scale.FIT`) and an on-screen joystick for touch (rexrainbow VirtualJoystick).
- **TypeScript end to end.** The web frontend and the backend share the deal types.
- **Backend (owner: kbph):** a Gemini harness and key proxy. The browser never sees the API key. SDK: `@google/genai`.
- **Frontend:** owner and framework **open**. Phaser 3 is the suggestion, with Tiled tilemaps and Arcade physics; Kaplay is the simpler alternative.
- **Assets:** no generative models for textures. OpenGameArt is fine; prefer CC0, and keep a credits list for CC-BY.
- **Repo:** kbph05/A-DEAL-with-the-DEVIL.

## Still open
- Frontend owner and framework.
- Player stats and items list.
- How each stage plays in detail (fight, village, campfire, well, deal).
- 3 example bets (stake, what you win, how the devil slips up). Owner: kbph.
- Whether every deal is with the same devil.
