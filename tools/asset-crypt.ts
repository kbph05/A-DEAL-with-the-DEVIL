/**
 * Encrypted licensed art (docs/assets.md). Plaintext lives in the gitignored assets/private-src/, ciphertext in
 * assets/encrypted/<same path>.enc, one file each:
 *
 *   "ADWD1" (5 bytes) | IV (12 random bytes) | AES-256-GCM ciphertext | GCM tag (16 bytes)
 *
 * The file's relative path (with "/") is the additional authenticated data, so a file renamed or swapped with
 * another fails to decrypt. The key is ASSET_KEY: 32 bytes as 64 hex characters or base64. Node's crypto only.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { loadEnv } from "vite";

export const MAGIC = Buffer.from("ADWD1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const SRC_DIR = "assets/private-src";
export const ENC_DIR = "assets/encrypted";
export const MANIFEST = "manifest.json";

/** Bad or missing key. Messages never contain the key itself. */
export class AssetKeyError extends Error {}

/** ASSET_KEY from the environment and the .env files in `envDir` (Vite's loadEnv, only that one variable). */
export function loadAssetKey(envDir: string, mode = "production"): string | undefined {
  const value = loadEnv(mode, envDir, "ASSET_KEY").ASSET_KEY?.trim();
  return value ? value : undefined;
}

/** 32 bytes from 64 hex characters, or from base64 (standard or URL-safe, padding optional). */
export function parseKey(raw: string): Buffer {
  const s = raw.trim();
  if (!s) throw new AssetKeyError("ASSET_KEY is empty");
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) {
    const key = Buffer.from(s, "base64");
    if (key.length === 32) return key;
  }
  throw new AssetKeyError(
    `ASSET_KEY is not a valid key (${s.length} characters): it must be 32 bytes, as 64 hex characters or 44 base64 characters. Make one with: npm run -s assets:keygen`,
  );
}

export const generateKey = (): string => randomBytes(32).toString("base64");

/** A short, non-secret fingerprint of the key (HMAC of a constant), stored in the manifest to notice a key change. */
export const keyId = (key: Buffer): string => createHmac("sha256", key).update("ADWD1 key id").digest("hex").slice(0, 16);

export const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** The path as stored and authenticated: relative, "/" separators, no leading "./" or "/". */
export const normalizeRel = (rel: string): string => rel.split(sep).join("/").replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");

export function encryptBuffer(key: Buffer, rel: string, plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(normalizeRel(rel), "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

/** Throws if the file is not ADWD1, or the key, the bytes or the path do not match. */
export function decryptBuffer(key: Buffer, rel: string, data: Buffer): Buffer {
  const path = normalizeRel(rel);
  if (data.length < MAGIC.length + IV_BYTES + TAG_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`${path}: not an ADWD1 encrypted file`);
  }
  const iv = data.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(path, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(MAGIC.length + IV_BYTES, data.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error(`${path}: cannot decrypt (wrong ASSET_KEY, or the file was changed or moved)`);
  }
}

/** Files under `dir`, relative with "/", sorted; skips dotfiles and dot-folders (.DS_Store, .git...). */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map(normalizeRel)
    .filter((f) => !f.split("/").some((part) => part.startsWith(".")) && statSync(join(dir, f)).isFile())
    .sort();
}

export interface Manifest {
  format: "ADWD1";
  /** keyId() of the key the files were encrypted with. */
  keyId: string;
  /** Relative path of the plaintext (without .enc) → its SHA-256 and size. */
  files: Record<string, { sha256: string; bytes: number }>;
}

export function readManifest(encDir: string): Manifest | undefined {
  const file = join(encDir, MANIFEST);
  if (!existsSync(file)) return undefined;
  const m = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  if (m.format !== "ADWD1" || typeof m.files !== "object" || m.files === null) throw new Error(`${file}: not an ADWD1 manifest`);
  return m;
}

/** Relative paths (without .enc) of the encrypted files in `encDir`. */
export const listEncrypted = (encDir: string): string[] =>
  listFiles(encDir).filter((f) => f.endsWith(".enc")).map((f) => f.slice(0, -".enc".length));

const write = (file: string, data: Buffer | string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

export interface EncryptReport {
  written: string[];
  skipped: string[];
  /** Encrypted files with no source: left as they are. */
  orphans: string[];
}

/**
 * Encrypts every file in `srcDir` to `encDir/<path>.enc` and rewrites the manifest. A file is skipped when the
 * manifest has its hash, the key is the same and the existing .enc decrypts to it (so a key change re-encrypts).
 */
export function encryptAll(opts: { srcDir: string; encDir: string; key: Buffer; force?: boolean }): EncryptReport {
  const { srcDir, encDir, key } = opts;
  const id = keyId(key);
  const old = readManifest(encDir);
  const manifest: Manifest = { format: "ADWD1", keyId: id, files: {} };
  const report: EncryptReport = { written: [], skipped: [], orphans: [] };
  const sources = listFiles(srcDir);
  for (const rel of sources) {
    const plain = readFileSync(join(srcDir, rel));
    const hash = sha256(plain);
    const encFile = join(encDir, `${rel}.enc`);
    manifest.files[rel] = { sha256: hash, bytes: plain.length };
    if (!opts.force && old?.keyId === id && old.files[rel]?.sha256 === hash && existsSync(encFile)) {
      try {
        if (sha256(decryptBuffer(key, rel, readFileSync(encFile))) === hash) {
          report.skipped.push(rel);
          continue;
        }
      } catch {
        // stale or damaged: encrypt again
      }
    }
    write(encFile, encryptBuffer(key, rel, plain));
    report.written.push(rel);
  }
  for (const rel of listEncrypted(encDir)) {
    if (sources.includes(rel)) continue;
    report.orphans.push(rel);
    const entry = old?.files[rel];
    if (entry) manifest.files[rel] = entry;
  }
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  write(join(encDir, MANIFEST), `${JSON.stringify({ ...manifest, files: sorted }, null, 2)}\n`);
  return report;
}

/** Checks that every .enc decrypts with `key` and matches the manifest, and the manifest has no missing files. */
export function checkAll(opts: { encDir: string; key: Buffer }): { ok: string[]; errors: string[] } {
  const { encDir, key } = opts;
  const ok: string[] = [];
  const errors: string[] = [];
  let manifest: Manifest | undefined;
  try {
    manifest = readManifest(encDir);
  } catch (e) {
    errors.push((e as Error).message);
  }
  const encrypted = listEncrypted(encDir);
  if (!manifest) {
    if (encrypted.length && !errors.length) errors.push(`${MANIFEST} is missing: run npm run assets:encrypt`);
  } else if (manifest.keyId !== keyId(key)) {
    errors.push(`${MANIFEST} was written with a different key than the current ASSET_KEY`);
  }
  for (const rel of encrypted) {
    try {
      const plain = decryptBuffer(key, rel, readFileSync(join(encDir, `${rel}.enc`)));
      const entry = manifest?.files[rel];
      if (!manifest) continue;
      if (!entry) errors.push(`${rel}: not in ${MANIFEST}`);
      else if (entry.sha256 !== sha256(plain)) errors.push(`${rel}: decrypts, but does not match the SHA-256 in ${MANIFEST}`);
      else ok.push(rel);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const rel of Object.keys(manifest?.files ?? {})) {
    if (!encrypted.includes(rel)) errors.push(`${rel}: listed in ${MANIFEST}, but ${rel}.enc is missing`);
  }
  return { ok, errors };
}

/** Restores plaintext from `encDir` into `outDir` (for a teammate with the key, or before a key rotation). */
export function decryptAll(opts: { encDir: string; outDir: string; key: Buffer; force?: boolean }): { written: string[]; same: string[]; kept: string[] } {
  const res = { written: [] as string[], same: [] as string[], kept: [] as string[] };
  for (const rel of listEncrypted(opts.encDir)) {
    const plain = decryptBuffer(opts.key, rel, readFileSync(join(opts.encDir, `${rel}.enc`)));
    const out = join(opts.outDir, rel);
    if (existsSync(out)) {
      const existing = readFileSync(out);
      if (existing.equals(plain)) {
        res.same.push(rel);
        continue;
      }
      if (!opts.force) {
        res.kept.push(rel);
        continue;
      }
    }
    write(out, plain);
    res.written.push(rel);
  }
  return res;
}
