# Encrypted art

Most of the art packs we want to use (for example zerie's Tiny RPG pack) may be used in a game but not redistributed as files. This repo is public, so those files can't be committed as they are. This pipeline encrypts them with a key kept out of the repo, in the `ASSET_KEY` environment variable. Vite decrypts them on the developer's machine and in CI, and the game gets ordinary images.

It sits on top of the existing private art hook (docs/world.md, "Dropping in real art") and doesn't change it. A file in the gitignored `public/assets/private/` still works exactly as before, and wins over an encrypted copy of the same path.

**Status:** the tooling is in the repo, but no encrypted art is yet. Whether encrypted copies of a given pack may be committed to this public repo is a licence question for the team (see "Limits" below). Until the team says yes, keep `assets/encrypted/` local too.

## How it works

| Where | What |
| --- | --- |
| `assets/private-src/` | The plaintext originals, in the same layout as `public/assets/private/` (e.g. `scenes/village/background.png`, `map/fight.png`, `player-walk.png`). **Gitignored.** |
| `assets/encrypted/<path>.enc` | One encrypted file per original. |
| `assets/encrypted/manifest.json` | Each path with the SHA-256 and size of its plaintext, plus a short key fingerprint (`keyId`, an HMAC of a constant, which reveals nothing about the key). |
| `ASSET_KEY` | 32 random bytes, as base64 (what `assets:keygen` prints) or 64 hex characters. It lives in `.env` (gitignored, like every `.env*` file) or in the environment. |

**File format.** Each file is `"ADWD1"` (5 bytes), a random 12-byte IV, the AES-256-GCM ciphertext, and the 16-byte GCM tag. The file's relative path (with `/`) is the additional authenticated data, so a renamed or swapped file fails to decrypt, as does a file with any byte changed. It uses Node's built-in `crypto`, with no extra dependencies. The code is in `tools/asset-crypt.ts`.

**In Vite** (`tools/vite-plugin-encrypted-assets.ts`, registered in `vite.config.ts`):

- **With `ASSET_KEY` set:** every `.enc` file is decrypted in memory when the config is resolved. Its path is added to `__PRIVATE_ASSETS__` (the list the game checks before it asks for private art). Then:
  - the dev server (`npm run dev`, `npm run game`, ...) and `vite preview` answer `/assets/private/<path>` with the decrypted bytes and the right `Content-Type`;
  - `npm run build` and `npm run build:test` write the decrypted files to `assets/private/<path>` in the output. The built game has plain images at the same URLs as the private hook.
- **Without `ASSET_KEY`:** one line, `ASSET_KEY not set: using generated placeholder art`, and nothing else happens. The game uses the generated art, exactly as before. A missing key never fails a build.
- **Wrong or malformed key, or a damaged file:** one warning per file, and that file falls back to the placeholder. The build still succeeds. `npm run assets:check` is the strict check.
- **The key never reaches the client.** It is read with Vite's `loadEnv` using the prefix `ASSET_KEY`. Only `VITE_*` variables are exposed to client code, and the plugin never puts the key in `define`. `tools/encrypted-assets.test.ts` builds a small project with the key in its `.env` and checks that neither the base64 nor the hex form appears anywhere in the output.

As with the private hook, restart the dev server after changing the encrypted files.

## Workflow

One-time setup, for the person who sets up the key:

```sh
npm run -s assets:keygen            # prints a fresh key (-s keeps npm's banner out of it)
echo "ASSET_KEY=$(npm run -s assets:keygen)" >> .env   # or paste one key into .env yourself
```

Share that one key with the team privately, for example in a password manager. Never share it in the repo, an issue or a public chat. Everyone puts the same line in their own `.env`.

Adding or changing art:

1. Put the original files in `assets/private-src/<same path as public/assets/private>`.
2. Run `npm run assets:encrypt`. It writes `assets/encrypted/<path>.enc` and `manifest.json`, and skips files that haven't changed: same hash, same key, and the existing `.enc` still decrypts. Use `npm run assets:encrypt -- --force` to redo them all.
3. Run `npm run assets:check`. Every `.enc` must decrypt with your key and match the manifest. It exits non-zero otherwise.
4. Restart `npm run dev` and look at the art in the game.
5. **Only once the team has approved committing encrypted copies of that pack:** `git add assets/encrypted` and commit. Before committing, check `git status`. It must not list `.env`, `assets/private-src/` or anything in `public/assets/private/`.

A teammate who pulls new encrypted art just needs `ASSET_KEY` in their `.env`. `npm run assets:decrypt` writes the originals back into `assets/private-src/`, for editing or for a key rotation. It doesn't overwrite a file there that differs unless you pass `-- --force`.

Encrypted files whose original is no longer in `assets/private-src/` are left alone and reported by `assets:encrypt`. To drop one, delete its `.enc` and run `assets:encrypt` again.

## CI (GitHub Actions)

Store the key as a repository secret, and pass it to the build step as an environment variable:

1. On GitHub, go to the repo's **Settings → Secrets and variables → Actions → New repository secret**. Name it `ASSET_KEY` and paste the key as the value.
2. In the workflow:

```yaml
      - run: npm ci
      - run: npm run assets:check     # optional: fail early on a wrong key or a damaged file
        env:
          ASSET_KEY: ${{ secrets.ASSET_KEY }}
      - run: npm run build
        env:
          ASSET_KEY: ${{ secrets.ASSET_KEY }}
```

- GitHub masks the secret in the logs, and the tools never print it.
- Pull requests from forks don't get secrets, so they build with the placeholder art, which is fine.
- Don't use `assets:check` in a job that has to pass without the key: it fails when `ASSET_KEY` is missing.

Other hosts (Netlify, Vercel, Cloudflare Pages, itch.io via butler in CI) work the same way: set `ASSET_KEY` as a build-time environment variable or secret.

## Key rotation

Rotate the key when someone who had it leaves the team, or if it may have leaked. Treat the art in the old commits as readable to whoever holds the old key: rotation only protects what you commit from then on.

1. With the **old** key in `.env`, run `npm run assets:decrypt`. This fills `assets/private-src/` if you don't already have the originals.
2. Run `npm run -s assets:keygen`. Put the new key in `.env` as `ASSET_KEY`.
3. Run `npm run assets:encrypt`. The manifest's `keyId` no longer matches, so every file is encrypted again (`-- --force` does the same).
4. Run `npm run assets:check`, then commit `assets/encrypted/`.
5. Update the `ASSET_KEY` secret in CI, and give the new key to the team. The old key can't read the new files.

## Limits (read before committing any encrypted art)

- **The built game contains the decrypted images.** It has to: the browser has to draw them. Anyone who plays the game can save them from the browser's network tab, just as with any web game. That is normal use for a game, and most game-art licences are written for exactly that. **Encryption protects the source repo, not the built game.**
- **Encrypted copies in a public repo are a licence question, not a technical one.** Some licences forbid redistributing the files in any form, and some may count an encrypted copy as redistribution. Others only care that the assets can't be easily extracted and reused. Read the licence text of each pack (and ask the author if it is unclear) before committing its `.enc` files. That decision is the team's.
- **Anyone with the key can decrypt the whole history.** Git keeps every version forever. If the key leaks, rotating it doesn't protect what was already committed. Only rewriting history would, and we don't do that.
- **File names and sizes are visible.** The paths, sizes and SHA-256 of the originals are in the clear in `assets/encrypted/` and the manifest. Someone holding the original pack could confirm that we use a given file.
- **Keep the key out of anything client-side.** Never name it `VITE_*`, never put it in `define`, and never import it in `src/`.
