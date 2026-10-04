/**
 * npm run assets:keygen | assets:encrypt [-- --force] | assets:check | assets:decrypt [-- --force]
 * See docs/assets.md. ASSET_KEY comes from the environment or .env / .env.local (never printed, except by keygen,
 * which prints a new one).
 */
import { join, resolve } from "node:path";
import { AssetKeyError, ENC_DIR, SRC_DIR, checkAll, decryptAll, encryptAll, generateKey, loadAssetKey, parseKey } from "./asset-crypt.ts";

const root = resolve(process.cwd());
const [command, ...flags] = process.argv.slice(2);
const force = flags.includes("--force");
const srcDir = join(root, SRC_DIR);
const encDir = join(root, ENC_DIR);

function key(): Buffer {
  const raw = loadAssetKey(root);
  if (!raw) throw new AssetKeyError("ASSET_KEY is not set: put it in .env (see docs/assets.md), or make one with: npm run -s assets:keygen");
  return parseKey(raw);
}

const list = (label: string, items: string[]): void => {
  if (items.length) console.log(`${label}: ${items.length}\n${items.map((f) => `  ${f}`).join("\n")}`);
};

function main(): number {
  switch (command) {
    case "keygen":
      console.log(generateKey());
      return 0;
    case "encrypt": {
      const r = encryptAll({ srcDir, encDir, key: key(), force });
      if (!r.written.length && !r.skipped.length) console.log(`Nothing to encrypt: ${SRC_DIR}/ is empty or missing.`);
      list(`Encrypted into ${ENC_DIR}/`, r.written);
      if (r.skipped.length) console.log(`Unchanged, skipped: ${r.skipped.length}`);
      if (r.orphans.length) list(`In ${ENC_DIR}/ with no source in ${SRC_DIR}/ (left as they are; delete them by hand to drop them)`, r.orphans);
      return 0;
    }
    case "check": {
      const r = checkAll({ encDir, key: key() });
      for (const e of r.errors) console.error(`FAIL ${e}`);
      console.log(`${r.ok.length} encrypted file(s) OK, ${r.errors.length} problem(s).`);
      return r.errors.length ? 1 : 0;
    }
    case "decrypt": {
      const r = decryptAll({ encDir, outDir: srcDir, key: key(), force });
      list(`Decrypted into ${SRC_DIR}/`, r.written);
      if (r.same.length) console.log(`Already there and identical: ${r.same.length}`);
      if (r.kept.length) list(`Differ from ${SRC_DIR}/ and were kept (use -- --force to overwrite)`, r.kept);
      return 0;
    }
    default:
      console.error("usage: tsx tools/assets.ts keygen | encrypt [--force] | check | decrypt [--force]");
      return 2;
  }
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`assets: ${(e as Error).message}`);
  process.exitCode = 1;
}
