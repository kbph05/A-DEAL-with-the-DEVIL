# Credits

## Scene art

Devil, forest, well and village art by Armand (Big Chungus).

## Sprite packs

These packs are used under their licences. The list below is `assets/attribution.txt`, word for word (it is plaintext in the repo):

```
Tiny RPG Character Asset Pack 01
by Zerie (itch.io)
https://zerie.itch.io/tiny-rpg-character-asset-pack

Tiny RPG Character Asset Pack 02
by Zerie (itch.io)
https://zerie.itch.io/tiny-rpg-character-asset-pack-02

Warrior Character Animation
By Corwin (itch.io)
https://lmaomonkey.itch.io/character-animation
```

| Pack | Used for |
| --- | --- |
| Tiny RPG Character Asset Pack 01 | the player (Soldier) and every regular enemy (Orc) |
| Tiny RPG Character Asset Pack 02 | both minibosses (Demon_A) |
| Warrior Character Animation (`WarriorChAnimation`) | the final boss (WarriorCh) |

Each pack also ships its own `attribution.txt`, encrypted with the sheets in `assets/encrypted/` (`<pack>/attribution.txt.enc`). With `ASSET_KEY`, `npm run assets:decrypt` writes the originals to the gitignored `assets/private-src/`.

## In the game

The play page has a **Credits** screen, from the title screen, the pause menu and the ending card. It always shows the scene-art line and `assets/attribution.txt` (bundled into the build, `src/render/credits.ts`), with or without the key. When the build has the key it adds each pack's own encrypted `attribution.txt`, read at runtime.
