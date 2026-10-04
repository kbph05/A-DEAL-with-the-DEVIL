// Encrypted art pipeline (tools/asset-crypt.ts, tools/vite-plugin-encrypted-assets.ts; docs/assets.md).
// Network-free: everything happens in a temp folder; the server test listens on a random localhost port.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { build, createServer, type Plugin } from "vite";
import { AssetKeyError, checkAll, decryptBuffer, encryptAll, encryptBuffer, generateKey, keyId, parseKey, readManifest } from "./asset-crypt.ts";
import { contentType, encryptedAssets } from "./vite-plugin-encrypted-assets.ts";

const KEY = parseKey(generateKey());
const OTHER = parseKey(generateKey());

/** A tiny self-made test fixture: the PNG signature plus random bytes (content type comes from the extension). */
const fixture = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(48)]);

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "adwd-assets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

test("keys: hex and base64 parse to 32 bytes; bad keys throw without echoing the value", () => {
  const key = randomBytes(32);
  assert.ok(parseKey(key.toString("hex")).equals(key));
  assert.ok(parseKey(key.toString("base64")).equals(key));
  assert.ok(parseKey(key.toString("base64url")).equals(key));
  assert.ok(parseKey(` ${key.toString("base64")}\n`).equals(key));
  for (const bad of ["", "abc", randomBytes(16).toString("base64"), randomBytes(31).toString("hex"), `${"!".repeat(43)}=`, "z".repeat(64)]) {
    assert.throws(() => parseKey(bad), (e: unknown) => e instanceof AssetKeyError && (bad.length < 4 || !(e as Error).message.includes(bad)));
  }
  assert.equal(keyId(key), keyId(Buffer.from(key)));
  assert.notEqual(keyId(key), keyId(randomBytes(32)));
});

test("round trip: ADWD1 header, random IV, plaintext back", () => {
  const plain = fixture();
  const a = encryptBuffer(KEY, "scenes/village/background.png", plain);
  const b = encryptBuffer(KEY, "scenes/village/background.png", plain);
  assert.equal(a.subarray(0, 5).toString("ascii"), "ADWD1");
  assert.equal(a.length, 5 + 12 + plain.length + 16);
  assert.ok(!a.equals(b), "a fresh IV each time");
  assert.ok(decryptBuffer(KEY, "scenes/village/background.png", a).equals(plain));
  assert.ok(decryptBuffer(KEY, "./scenes/village/background.png", b).equals(plain), "paths are normalized");
});

test("a wrong key fails", () => {
  const enc = encryptBuffer(KEY, "hero.png", fixture());
  assert.throws(() => decryptBuffer(OTHER, "hero.png", enc), /hero\.png: cannot decrypt/);
});

test("any tampered byte fails (header, IV, body, tag)", () => {
  const enc = encryptBuffer(KEY, "hero.png", fixture());
  for (const i of [0, 4, 5, 16, 17, 40, enc.length - 16, enc.length - 1]) {
    const bad = Buffer.from(enc);
    bad[i] ^= 0x01;
    assert.throws(() => decryptBuffer(KEY, "hero.png", bad), Error, `byte ${i}`);
  }
  assert.throws(() => decryptBuffer(KEY, "hero.png", enc.subarray(0, 20)), /not an ADWD1/);
});

test("swapped paths fail: the relative path is authenticated", () => {
  const a = encryptBuffer(KEY, "map/fight.png", fixture());
  assert.throws(() => decryptBuffer(KEY, "map/deal.png", a), /map\/deal\.png: cannot decrypt/);
});

test("encryptAll writes .enc files and a manifest, skips unchanged files, re-encrypts on change or new key", (t) => {
  const root = tempDir(t);
  const srcDir = join(root, "assets/private-src");
  const encDir = join(root, "assets/encrypted");
  put(join(srcDir, "scenes/village/background.png"), fixture());
  put(join(srcDir, "map/fight.png"), fixture());
  put(join(srcDir, ".DS_Store"), "junk");

  const first = encryptAll({ srcDir, encDir, key: KEY });
  assert.deepEqual(first.written, ["map/fight.png", "scenes/village/background.png"]);
  assert.ok(existsSync(join(encDir, "scenes/village/background.png.enc")));
  const m = readManifest(encDir);
  assert.equal(m?.keyId, keyId(KEY));
  assert.deepEqual(Object.keys(m?.files ?? {}), ["map/fight.png", "scenes/village/background.png"]);
  assert.ok(!JSON.stringify(m).includes(KEY.toString("hex")) && !JSON.stringify(m).includes(KEY.toString("base64")));
  const before = readFileSync(join(encDir, "map/fight.png.enc"));

  const second = encryptAll({ srcDir, encDir, key: KEY });
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.skipped, ["map/fight.png", "scenes/village/background.png"]);
  assert.ok(readFileSync(join(encDir, "map/fight.png.enc")).equals(before), "unchanged file not rewritten");

  put(join(srcDir, "map/fight.png"), fixture());
  assert.deepEqual(encryptAll({ srcDir, encDir, key: KEY }).written, ["map/fight.png"]);
  assert.deepEqual(encryptAll({ srcDir, encDir, key: KEY, force: true }).written.length, 2);

  assert.deepEqual(checkAll({ encDir, key: KEY }), { ok: ["map/fight.png", "scenes/village/background.png"], errors: [] });
  const wrong = checkAll({ encDir, key: OTHER });
  assert.equal(wrong.ok.length, 0);
  assert.ok(wrong.errors.some((e) => /different key/.test(e)) && wrong.errors.some((e) => /cannot decrypt/.test(e)));

  // A new key re-encrypts everything (no stale ciphertext after a rotation).
  assert.equal(encryptAll({ srcDir, encDir, key: OTHER }).written.length, 2);
  assert.deepEqual(checkAll({ encDir, key: OTHER }).errors, []);

  // check catches an edited .enc and a file missing from the manifest.
  const enc = join(encDir, "map/fight.png.enc");
  const bytes = readFileSync(enc);
  bytes[30] ^= 0xff;
  writeFileSync(enc, bytes);
  put(join(encDir, "stray.png.enc"), encryptBuffer(OTHER, "stray.png", fixture()));
  const errors = checkAll({ encDir, key: OTHER }).errors;
  assert.ok(errors.some((e) => e.startsWith("map/fight.png: cannot decrypt")));
  assert.ok(errors.some((e) => e.startsWith("stray.png: not in manifest.json")));
});

/** A temp project with assets/encrypted/ holding `files` (encrypted with `key`) and an optional public override. */
function project(t: { after: (fn: () => void) => void }, files: Record<string, Buffer>, key = KEY): string {
  const root = tempDir(t);
  const srcDir = join(root, "assets/private-src");
  for (const [rel, data] of Object.entries(files)) put(join(srcDir, rel), data);
  encryptAll({ srcDir, encDir: join(root, "assets/encrypted"), key });
  rmSync(srcDir, { recursive: true });
  return root;
}

/** Runs the plugin's config hook the way Vite does, returning what it adds. */
function configHook(plugin: Plugin, root: string): unknown {
  const hook = plugin.config as (c: object, e: object) => unknown;
  return hook({ root, define: { __PRIVATE_ASSETS__: JSON.stringify(["hero.png"]) } }, { mode: "test", command: "serve" });
}

test("no key: the plugin is a no-op (placeholder art), and a wrong key falls back per file", (t) => {
  const root = project(t, { "map/fight.png": fixture() });
  assert.equal(configHook(encryptedAssets({ key: null }), root), undefined);
  assert.equal(configHook(encryptedAssets({ key: "not a key" }), root), undefined);
  assert.equal(configHook(encryptedAssets({ key: OTHER.toString("hex") }), root), undefined);
  assert.deepEqual(configHook(encryptedAssets({ key: KEY.toString("base64") }), root), {
    define: { __PRIVATE_ASSETS__: JSON.stringify(["hero.png", "map/fight.png"]) },
  });
});

test("dev server middleware serves decrypted bytes with the right content type; public/assets/private wins", async (t) => {
  const png = fixture();
  const json = Buffer.from('{"frames":4}');
  const root = project(t, { "scenes/crossroads/background.png": png, "data/sheet.json": json, "map/well.png": fixture() });
  const publicCopy = fixture();
  put(join(root, "public/assets/private/map/well.png"), publicCopy);

  const vite = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [encryptedAssets({ key: KEY.toString("hex") })],
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const http = createHttpServer(vite.middlewares);
  t.after(async () => {
    http.close();
    await vite.close();
  });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const at = (p: string) => `http://127.0.0.1:${(http.address() as AddressInfo).port}${p}`;

  let res = await fetch(at("/assets/private/scenes/crossroads/background.png?t=1"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));

  res = await fetch(at("/assets/private/data/sheet.json"));
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(json));

  res = await fetch(at("/assets/private/map/well.png"));
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(publicCopy), "the real public file wins");

  res = await fetch(at("/assets/private/nope.png"));
  assert.notEqual(res.status, 200);

  assert.equal(contentType("a/b.WEBP"), "image/webp");
  assert.equal(contentType("a/b.jpg"), "image/jpeg");
  assert.equal(contentType("a/b.bin"), "application/octet-stream");
});

/** Every file under `dir`, as text, for grepping. */
const allText = (dir: string): string =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
    .map((f) => readFileSync(f).toString("latin1"))
    .join("\n");

async function buildProject(root: string, plugin: Plugin): Promise<string> {
  put(join(root, "index.html"), '<!doctype html><script type="module" src="/main.js"></script>');
  put(join(root, "main.js"), "console.log(__PRIVATE_ASSETS__, JSON.stringify(import.meta.env));\n");
  await build({ root, configFile: false, logLevel: "silent", plugins: [plugin], define: { __PRIVATE_ASSETS__: "[]" } });
  return join(root, "dist");
}

test("build: emits the decrypted files at assets/private/, lists them, and ASSET_KEY never reaches the output", async (t) => {
  const saved = process.env.ASSET_KEY;
  delete process.env.ASSET_KEY; // the key below comes from the temp project's .env, as in real use
  t.after(() => {
    if (saved === undefined) delete process.env.ASSET_KEY;
    else process.env.ASSET_KEY = saved;
  });
  const png = fixture();
  const root = project(t, { "scenes/village/background.png": png });
  const b64 = KEY.toString("base64");
  put(join(root, ".env"), `ASSET_KEY=${b64}\nVITE_HARMLESS=1\n`);

  const dist = await buildProject(root, encryptedAssets());
  assert.ok(readFileSync(join(dist, "assets/private/scenes/village/background.png")).equals(png));
  const out = allText(dist);
  assert.ok(out.includes("scenes/village/background.png"), "__PRIVATE_ASSETS__ lists the decrypted file");
  assert.ok(out.includes("VITE_HARMLESS"), "import.meta.env made it into the bundle, so the check below means something");
  for (const form of [b64, KEY.toString("hex"), KEY.toString("base64url")]) assert.ok(!out.includes(form), "key in the build output");
  assert.ok(!out.includes("ASSET_KEY"));
});

test("build without a key: nothing emitted, the build still succeeds", async (t) => {
  const saved = process.env.ASSET_KEY;
  delete process.env.ASSET_KEY;
  t.after(() => {
    if (saved !== undefined) process.env.ASSET_KEY = saved;
  });
  const root = project(t, { "scenes/village/background.png": fixture() });
  const dist = await buildProject(root, encryptedAssets());
  assert.ok(existsSync(join(dist, "index.html")));
  assert.ok(!existsSync(join(dist, "assets/private")));
});
