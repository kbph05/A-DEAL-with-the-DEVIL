# Credits

## Sprite packs

**TO FILL IN: copy each pack's own attribution text here.** These packs are used under their licences:

| Pack | Used for | Attribution file (encrypted in `assets/encrypted/`) |
| --- | --- | --- |
| Tiny RPG Character Asset Pack 01 | the player (Soldier) and every regular enemy (Orc) | `Tiny RPG Character Asset Pack 01/attribution.txt` |
| Tiny RPG Character Asset Pack 02 | both minibosses (Demon_A) | `Tiny RPG Character Asset Pack 02/attribution.txt` |
| WarriorChAnimation | the final boss (WarriorCh) | `WarriorChAnimation/attribution.txt` |

This page was written without `ASSET_KEY`, so the attribution files could not be read. To fill it in, with the key in `.env`:

```sh
npm run assets:decrypt   # writes the originals, attribution.txt included, to the gitignored assets/private-src/
```

Then paste each `attribution.txt` under its pack's heading below, word for word, and delete this note.

### Tiny RPG Character Asset Pack 01

(attribution text to come)

### Tiny RPG Character Asset Pack 02

(attribution text to come)

### WarriorChAnimation

(attribution text to come)

## In the game

The play page has a **Credits** screen, from the title screen, the pause menu and the ending card. It reads the same three `attribution.txt` files at runtime (`src/render/credits.ts`), so it shows them whenever the build has the key, even before this page is filled in. Without the key it says that the packs' credits need the art.
