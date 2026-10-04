/**
 * Serves and ships the encrypted licensed art (docs/assets.md). With ASSET_KEY set (environment or .env files, via
 * loadEnv with no VITE_ prefix, so it never reaches client code), every assets/encrypted/<path>.enc is decrypted in
 * memory when the config is resolved, then:
 *
 * - its path is added to __PRIVATE_ASSETS__ (the list the game checks before requesting private art; docs/world.md);
 * - dev and preview servers answer /assets/private/<path> with the plaintext;
 * - builds emit it as assets/private/<path>, so the shipped game just has normal images.
 *
 * A real file in public/assets/private/ always wins. Without ASSET_KEY it logs one line and does nothing, so the
 * game uses the generated placeholder art. A bad key or a file that fails to decrypt is a warning and falls back.
 */
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import { ENC_DIR, decryptBuffer, listEncrypted, loadAssetKey, parseKey } from "./asset-crypt.ts";

export interface EncryptedAssetsOptions {
  /** Folder with the .enc files, relative to the Vite root. Default assets/encrypted. */
  encryptedDir?: string;
  /** Tests only: the key to use instead of ASSET_KEY from the environment (null: no key). */
  key?: string | null;
}

/** The same filter vite.config.ts applies to public/assets/private/ for __PRIVATE_ASSETS__. */
const LISTED = /\.(png|jpe?g|webp|json)$/i;

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
export const contentType = (path: string): string => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

type Next = (err?: unknown) => void;

export function encryptedAssets(options: EncryptedAssetsOptions = {}): Plugin {
  /** Relative path → decrypted bytes. Empty without a key. */
  const files = new Map<string, Buffer>();
  const notes: { level: "info" | "warn"; msg: string }[] = [];
  let publicPrivate: string | undefined;
  let base = "/";

  /** True when public/assets/private/ has a real file for this path (the existing override hook wins). */
  const overridden = (rel: string): boolean => publicPrivate !== undefined && existsSync(join(publicPrivate, rel));

  const serve = (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const prefix = `${base}assets/private/`;
    const url = (req.url ?? "").split(/[?#]/)[0];
    if (!files.size || !url.startsWith(prefix) || (req.method !== "GET" && req.method !== "HEAD")) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(url.slice(prefix.length));
    } catch {
      return next();
    }
    const data = files.get(rel);
    if (!data || overridden(rel)) return next();
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType(rel));
    res.setHeader("Content-Length", data.length);
    res.setHeader("Cache-Control", "no-cache");
    res.end(req.method === "HEAD" ? undefined : data);
  };

  return {
    name: "encrypted-assets",

    config(config, { mode }) {
      files.clear();
      notes.length = 0;
      const root = resolve(config.root ?? process.cwd());
      publicPrivate = config.publicDir === false ? undefined : join(resolve(root, config.publicDir ?? "public"), "assets/private");
      const envDir = typeof config.envDir === "string" ? resolve(root, config.envDir) : root;
      const raw = options.key !== undefined ? options.key ?? undefined : loadAssetKey(envDir, mode);
      if (!raw) {
        notes.push({ level: "info", msg: "ASSET_KEY not set: using generated placeholder art" });
        return;
      }
      let key: Buffer;
      try {
        key = parseKey(raw);
      } catch (e) {
        notes.push({ level: "warn", msg: `${(e as Error).message}. Using generated placeholder art.` });
        return;
      }
      const encDir = resolve(root, options.encryptedDir ?? ENC_DIR);
      for (const rel of listEncrypted(encDir)) {
        try {
          files.set(rel, decryptBuffer(key, rel, readFileSync(join(encDir, `${rel}.enc`))));
        } catch (e) {
          notes.push({ level: "warn", msg: `encrypted assets: ${(e as Error).message}; using the placeholder for it` });
        }
      }
      notes.push({ level: "info", msg: `encrypted assets: ${files.size} file(s) decrypted from ${options.encryptedDir ?? ENC_DIR}/` });
      if (!files.size) return;
      const given = config.define?.__PRIVATE_ASSETS__;
      const listed: unknown = typeof given === "string" ? JSON.parse(given) : [];
      const merged = new Set(Array.isArray(listed) ? listed.filter((f): f is string => typeof f === "string") : []);
      for (const rel of files.keys()) if (LISTED.test(rel)) merged.add(rel);
      return { define: { __PRIVATE_ASSETS__: JSON.stringify([...merged].sort()) } };
    },

    configResolved(config) {
      base = config.base.endsWith("/") ? config.base : `${config.base}/`;
      if (!base.startsWith("/")) base = "/"; // relative base ("./"): the servers still serve from the root
      for (const { level, msg } of notes) config.logger[level](msg);
    },

    configureServer(server) {
      server.middlewares.use(serve);
    },

    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },

    generateBundle() {
      for (const [rel, data] of files) {
        if (!overridden(rel)) this.emitFile({ type: "asset", fileName: `assets/private/${rel}`, source: data });
      }
    },
  };
}
