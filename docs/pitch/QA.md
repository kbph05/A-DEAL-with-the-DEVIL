# Judge Q&A: A DEAL with the DEVIL (team Spin 2 Win)

Refreshed 4 Oct 2026 against `origin/main` at **e7e879c**. **[check]** = not shown by the repo, or not run by me; confirm first.
Rule for every LLM number below: the red-team and latency figures are from **local gemma4 models** on a llama-swap box (RTX 3060 Ti), temperature 0.8, one sample per text, a scratch backend, on the repo as of 6e6de17 (before the 30-gold deal cap). They are not Gemini numbers and the suite has not been re-run since. Say so if asked.
Numbers I re-ran on e7e879c: 286 tests passing, and the scripted bot on the stub devil (1000 runs, below).

---

**1. What about prompt injection and jailbreaks?**
We wrote 75 attack texts in 14 families (override, fake system message, role play, prompt extraction, JSON and tag injection, unicode and emoji tricks, floods, other languages), 51 of them hostile. On the local gemma4:26b, all 51 got an angry, in-character reply, with 0 prompt leaks and 0 payout attempts. The smaller gemma4:e4b was angry on 43 of 51 and obeyed some JSON injections: in 7 hostile rows its raw reply tried to pay out. Where it marked such a payout as a "strike", our sanitizer turned it into a strike that does nothing; the others came back as ordinary deals that still sat inside the hard limits (question 2). We have not run this suite on Gemini. **[check: Gemini results]**

**2. What stops the LLM from breaking the game, say by giving itself a million gold?**
The model only returns a JSON proposal; our engine decides. `sanitizeDeal` clamps every number per deal (HP +/-25, max HP +/-10, gold -100 to **+30**, attack +/-3, soul +/-1), drops unknown fields, and caps dialogue at 600 characters. An angry "strike" can take HP only, at most 8, and strips everything else, including soul, curses and rewrites. Stats also have absolute ranges (attack 1 to 12, max HP up to 60). A junk reply, a timeout or a server error becomes a harmless "the devil only smiles" and the run goes on. What the clamp does not do: judge whether an offer is a good one (see the spare answers).

**3. What does it cost?**
The engine caps a run at 10 devil questions, 3 asks per devil node and 5 curses held. On top of that he makes one free opening offer each time he appears, which is a model call but not a question. So calls per run are 10 plus roughly one per campfire, well or table he sits at; the exact ceiling per run was not worked out. **[check]** The actual Gemini price per call and our token use have not been measured. **[check: model name, price per run]**

**4. What about latency, and what if the model is slow or down?**
The game waits up to 15 seconds and shows the devil considering while the buttons are locked. The opener is fetched the moment he appears, so the first wait is on arrival. Local models measured 0.8 s (gemma4:e4b) and 2.0 s (gemma4:26b) median; Gemini latency is unmeasured. **[check]** If the backend fails, the devil only smiles and the run continues, and there is a built-in offline StubDevil that needs no network.

**5. Why use an LLM at all? Could a script do it?**
The stub devil is our script: 8 canned offers, keyword matching, and rules for nonsense and jailbreaks. A language model can answer what you actually typed, judge nonsense and trickery, and write a different bad-faith deal each time. We keep it safe by putting it behind a clamp: the LLM supplies the voice and the offers, the engine owns the rules. The player's counterplay is language too: on the stub, "I read the fine print" makes him strike the curse. Whether the Gemini devil honours that depends on its prompt. **[check]**

**6. Why Gemini, and did you try other models?**
Gemini is our hosted devil; the team chose it for the sponsor prize and the backend is kbph's. **[check: sponsor prize exists at StormHacks, model name, backend deployed]** For offline and dev use we tested six local models. With grammar-constrained JSON, all returned valid JSON on every call (180 of 180). Rule following grew with size: gemma4:26b was perfect on injections and off-topic refusals; the smaller models were not.

**7. What did you build, and what is library code?**
Library: Phaser 3 (the only runtime dependency), Vite, TypeScript, tsx, and the Gemini SDK on the backend. **[check: SDK in use]** Ours: the stateless game engine, the seeded map generator, the sanitizer and curse system, the realtime fight sim and enemy AI with scaling by height of the map, the forest and village scenes, the Slay-the-Spire map scene, the HUD, the play page's flow controller, the touch joystick, the stub devil, the encrypted-asset tooling, the tests, and the placeholder art, drawn in code.

**8. Who did what?**
Kirstin (kbph) owns the backend and the Gemini integration and the repo; she also set most design calls: 12 to 14 node acts, the campfire and well choices, the forest fights, the opener, the gold fix. Armand (Big Chungus) is the designer: the game loop, the realtime-fight decision, the scene model, the enemy roster, the map layout rules. legilles gave us the campfire "Rest or Train, choose one" rule **[check: legilles' full role]**. T pitches, builds and deploys. By commit count on `origin/main` it is lopsided: 103 of 111 commits are from T's account, 8 from teammates. **[check: say this on purpose or not, see question 9]**

**9. Did you use AI to write the code?**
**[check: team to agree the wording.]** The facts: the LLM devil is the product. The repo history and the team notes show most of the engine, UI and fight code was written with an AI coding assistant working under T's account, from the team's design decisions. A neutral answer: "Yes, we used an AI assistant for much of the build, and the team set the design and reviewed it." Do not claim a teammate wrote what the assistant wrote. **[check: StormHacks/MLH rule on AI tools]**

**10. How did you test it?**
286 automated tests, all passing, no network needed (one test starts a local mock server). The core of it: 700 recorded runs (500 bot seeds, 200 chaos seeds of random valid and invalid commands) must replay identically after any engine change, a frozen JSON contract test that only allows additive changes, the red-team corpus of 75 hostile texts run through the engine over six seeds, a property test that plays 150 random legal runs through the play page's flow controller, an economy test that guards the gold left at the end, and a test that the art key never reaches the built game. On top of that, two QA passes with Playwright on desktop and a phone-sized screen played all three acts to a win, a hell and a lose ending and found 13 fixed bugs; those scripts live outside the repo. Not covered by tests: how the screen looks, and the feel and balance of the realtime fights.

**11. What about the art, and is it licensed?**
What you see is generated pixel art drawn in code (the team's rule is no generative models for textures). There is no licensed art in the repo. For a licensed pack we may not redistribute (zerie's Tiny RPG), we built an encrypted pipeline: the originals stay local, the repo can hold AES-256-GCM files, and Vite decrypts them with a key kept in `.env`. No encrypted art is committed yet; that is a licence call for the team. One image, `forest.png`, sits at the repo root and came from kbph; its source and licence are **[check]**. **[check: was the pack bought, and is it in the demo build?]**

**12. What is next, and what is missing today?**
Missing today: the public build is still the older plain UI, and the new play page runs in test builds until kbph swaps it in (a two-line change in the repo's docs). **[check: what is deployed]** Campfires and wells are panels, not walkable scenes. No save across reloads. No bets and only stat-change deals. Next: ship the play page as the main build, real art and audio, bets with stakes and more curse types, longer-lasting contracts, and run the red-team suite and measure latency and cost on Gemini.

---

## Spare answers (if asked, not part of the 12)

- **Is it balanced?** Not tuned. A scripted bot on the stub devil (1000 runs, re-run on e7e879c) wins 43.8%, ends in hell 39.8% and dies 16.4%. That bot plays the plain round-based fight, not the realtime one, so it says nothing about how the forest fights feel. Hell is the common ending because the one revival spends the soul. Bosses are the wall.
- **Did you fix the gold?** Yes, kbph's note was "the gold inflation is insane". On the repo's own measurement the bot's median unspent gold at the end fell from 30 to 10, gold per regular kill from 7.0 to 4.7, and the devil now leads with gold rarely early and pays 4 to 18, capped at +30. (`docs/FEATURES.md`, 5.3.)
- **Can the player cheat the devil?** On the stub, yes, too easily: the words "read the contract" or "fine print" strip every curse, every time. The balance report measured a bot using it at an 82.6% win rate, on the build at 6e6de17. The code still has that rule; I have not re-measured since the economy changes. The Gemini prompt needs limits on it. **[check]**
- **What was found in red-teaming?** The model does not randomise: asked to strike "about half the time", gemma4:26b struck 92% of the time. Fix: roll the dice in the backend, not the model. Also a real bug: cutting text mid-emoji sent a broken character that made the server reject the request (fixed in the game and in the scratch backend). **[check: does kbph's Gemini backend cut text safely?]** And the model sometimes punished the game's own fine-print trick as a jailbreak.
- **Known gap:** offer quality is unguarded. A 30-gold, no-curse deal is legal under the clamps, so a model can be generous without breaking a rule.
- **Can we play it?** Only from a test build today (`npm run game`, or `npm run build:game` and `preview:game`). **[check: any deployed link, and which build it is]**
- **Does it work on a phone?** Yes in QA: a full touch run on a 390x844 screen to a win, including turning the phone mid-fight. Not tried on a real phone by me. **[check]**
