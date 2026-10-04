## Inspiration
Every deal-with-the-devil story is a negotiation with someone smarter than you. LLMs are the opposite: endlessly agreeable. We wanted to flip that and build an AI that is *trying to beat you*, inside a roguelite loop (Slay the Spire's map, Reigns' one-card decisions) where every shortcut has a price.

## What it does
A roguelite across 3 acts. You pick your route on a Slay-the-Spire style map: a village with shops, realtime fights on forest paths (orcs, Demon minibosses, a Warrior final boss), campfires, wells and devil deals. The devil turns up at deal nodes, campfires and wells, opens with an offer aimed at your weakest stat, and you haggle with him in plain English. His deals carry hidden curses, rewrite the map ahead of you, or cost your soul. Try to jailbreak him and he strikes. 10 questions per run, one revive, three endings: win, hell, or lose.

## How we built it
TypeScript + Vite + Phaser 3. The game rules are a pure, stateless engine (`step(state, command)`) behind a frozen JSON contract, so the UI, tests, bots and the devil all speak the same language. The devil is an HTTP endpoint that works with any OpenAI-compatible model: a local Gemma model on our own GPU server, or Gemini. The model only *proposes*. Our server rolls the dice, prices every offer against the player, and clamps it before the engine accepts anything. There's a built-in offline devil if the model is down. Art: our designer's own devil silhouettes plus licensed sprite packs, stored AES-encrypted in the repo and decrypted at build time. ~340 tests, a 75-attack red-team suite, Playwright QA passes, and 100k+ simulated runs for balance. AI pair-programming (Claude Code) helped with the engine, tests and QA.

## Challenges we ran into
LLMs are too nice: early devils gave good deals, so we enforce prices server-side. Prompt injection: a small model handed over 99 gold for a fake JSON block in the player's message. Models don't roll dice fairly, so the server does. Shipping licensed art from a repo, a WebGL context leak that would have crashed a long demo, phones rotating mid-fight, and four people changing the design every hour.

## Accomplishments that we're proud of
The devil can break your run but never the game: 75 attack texts and 35 hostile model replies, with no crashes, no soul taken without consent, and every limit held. A full playable loop from map to ending in one weekend, with balance tuned from simulation instead of guesses.

## What we learned
"The model proposes, the engine decides." Treat LLM output like untrusted user input. Simulate balance before you argue about it. And a villain needs rules to be scary.

## What's next for A Deal with the Devil
Gemini live with a voiced devil, permanent contracts that follow you across the run, more enemies and scenes, a carried inventory, and music.
