# Deploying to Vercel

One Vercel project serves the whole game: the static build (`npm run build` → `dist/`) at `/`, and the LLM devil as a serverless function at `/api/deal`, on the same origin, so there's no CORS and no separate server to keep running. The Hobby (free) plan is enough.

| File | What it does |
| --- | --- |
| `vercel.json` | Vite preset, `npm ci`, `npm run build` → `dist`, bakes `VITE_DEVIL_URL=/api/deal` into the build, and gives `api/deal.ts` up to 30 s (`maxDuration`). |
| `api/deal.ts` | The function: `POST /api/deal {state, context, playerText}` → a Deal (contract: [devil-api.md](devil-api.md)). `OPTIONS` → 204, other methods → 405, bodies over 512 KB → 413, a bad body → 400. |
| `server/devil-core.ts` | The devil itself, shared with `npm run devil:oai` (`scripts/oai-devil.ts` is now just its Node server). It does the same as that server: strikes rolled server-side, every offer priced, `sanitizeDeal`, and the StubDevil on any model error or timeout. |
| `api/tsconfig.json` | The compiler settings Vercel uses for `api/` (the root tsconfig is `noEmit`-only). |
| `api/_lib/devil.mjs` | **Generated.** The core bundled into one file with `devil_prompt.txt` inlined (`npm run build:api`). Vercel compiles `api/*.ts` one file at a time, and Node can't resolve the extensionless imports in `src/`, so the function imports this bundle. **After changing the devil (server/, src/game/, devil_prompt.txt), run `npm run build:api` and commit the result.** `npm test` fails while it's stale. |

## Environment variables

Set these in the Vercel project, for the Production environment (and Preview, if you use preview deploys):

| Name | Value | Used |
| --- | --- | --- |
| `OAI_BASE_URL` | `https://openrouter.ai/api/v1` | by the function. Without it, the function answers with the StubDevil straight away. |
| `OAI_MODEL` | `google/gemini-2.5-flash` | by the function |
| `OAI_API_KEY` | the OpenRouter key (`sk-or-...`) | by the function. Mark it **Sensitive**. It's sent only as the `Authorization` header and is redacted from logs and responses. |
| `ASSET_KEY` | the team's art key ([assets.md](assets.md)) | at build time, to decrypt the art into `dist/`. Without it, the build uses the placeholder art. |
| `TIMEOUT_MS` | optional, default `10000` | The model's time budget per ask. The game gives up after 15 s, and a cold start uses some of that, so keep it at 12000 or lower. |

**Gemini direct instead of OpenRouter.** Use `OAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `OAI_MODEL=gemini-2.5-flash` and `OAI_API_KEY=` a Google AI Studio key. Gemini's OpenAI-compatible endpoint rejects strict `json_schema`, and the devil steps down to `json_object` on its own (the first ask after each cold start pays one extra round trip).

**OpenRouter notes.** The function sends OpenRouter's optional `X-Title: A DEAL with the DEVIL` and `HTTP-Referer: https://<the production domain>` headers. Set `OAI_REFERER` to override the referer. If a model's providers can't take the JSON schema, OpenRouter answers 404 "No endpoints found…", and the devil steps down to `json_object` exactly as it does on a 400. Any other OpenRouter model works too, e.g. `OAI_MODEL=openai/gpt-4o-mini`.

**The llama-swap server on the team VPN (`169.254.1.3`) can't be reached from Vercel.** For the local model, run `npm run devil:oai` on the LAN instead ([devil-api.md](devil-api.md)).

**`VITE_DEVIL_URL`** is set to `/api/deal` in `vercel.json` (`build.env`) and baked into the JS at build time. To point the game at another devil, change it there. To use the built-in StubDevil only, remove it.

**The art becomes public.** With `ASSET_KEY` set, the build writes the decrypted images into `dist/assets/private/`, so anyone can download them from the site. That's normal game use, the same as any web build with the key (see "Limits" in assets.md). The key itself never reaches the client ([assets.md](assets.md)). The repo still holds only the encrypted copies.

**Haggle memory is per warm instance.** The devil counts haggles at each node in memory. A cold start forgets them, so after one the player's next haggle is priced like a first ask. It's harmless; the Node server forgets them on restart the same way.

## Before deploying: the real game at `/`

The `deploy` branch (main + `vercel` + `prod-play`) already serves the play flow as `index.html`, so the Vercel site shows the real game at `/`. Deploy that branch. `vercel.json` needs no change, because the production build stays a single `index.html`; the old DOM UI (`classic.html`) and the labs are test builds only.

## Option A: the CLI, from any machine with the repo

This works from a laptop, or from the phone's Xed proot (it needs Node 20+ and the repo checked out on the branch you want live; no `npm ci` needed, Vercel builds remotely):

```sh
npx vercel login                       # once: pick "Continue with GitHub" or email
npx vercel link                        # once: create the project ("A DEAL with the DEVIL"), accept the detected settings
npx vercel env add OAI_BASE_URL production   # paste: https://openrouter.ai/api/v1
npx vercel env add OAI_MODEL production      # paste: google/gemini-2.5-flash
npx vercel env add OAI_API_KEY production    # paste the OpenRouter key
npx vercel env add ASSET_KEY production      # paste the art key
npx vercel --prod                      # build on Vercel and deploy; prints the URL
```

`vercel env add` asks for the value interactively, so the key never lands in your shell history. To redeploy after a change, just run `npx vercel --prod` again. The CLI uploads your working tree, minus what `.vercelignore` lists (`.env*`, `node_modules`, the plaintext art, local builds), and Vercel builds it there.

## Option B: the dashboard, deploying from GitHub

1. The repo is kbph05's and private, so **kbph** installs the Vercel GitHub app with access to `A-DEAL-with-the-DEVIL` (GitHub → Settings → Applications, or Vercel's "Import Git Repository" → "Adjust GitHub App Permissions"). Without that, T's Vercel account can't see the repo.
2. On vercel.com: **Add New → Project**, import `kbph05/A-DEAL-with-the-DEVIL`. The settings come from `vercel.json`, so leave the build settings alone.
3. Before the first deploy, open **Environment Variables** and add the four variables above.
4. **Settings → Git → Production Branch:** the branch to serve (`main` once `vercel` and `prod-play` are merged, or `vercel` for now).
5. Deploy. Each push to the production branch redeploys, and other branches get preview URLs (which need the variables in Preview too).

## Checking it

- `https://<project>.vercel.app/` should load the game. Talk to the devil: replies in the devil's voice that aren't one of the stub's lines mean the model is answering.
- **Vercel → the project → Logs** (or `npx vercel logs <url>`) has one line per ask, e.g. `1834ms offer via model tries=1 ...`, or `FALLBACK to StubDevil (model failed)` with the reason in the line above it. `OAI_BASE_URL not set` means the variables are missing from that environment. Add them, then redeploy.
- Directly:

```sh
curl -s https://<project>.vercel.app/api/deal -H 'content-type: application/json' \
  -d '{"state":{"hp":30,"maxHp":30,"gold":10,"attack":3,"soul":1,"act":0,"nodeId":"a0n0","log":[]},"context":{"seed":"demo","act":0,"nodeId":"a0n0","kind":"deal","askIndex":1,"questionsLeft":9,"rewritable":[],"curses":[]},"playerText":"make me stronger"}'
```

Locally, the same devil runs as `npm run devil:oai` (same env vars, plus `PORT`). `src/game/vercelDeal.test.ts` tests the function without a network.
