import assert from "node:assert/strict";
import { test } from "node:test";
import { BUNDLED_ICON_KINDS, BUNDLED_KINDS, ICONS, ICON_KINDS, bundledIconFile, iconSource, privateIconFile, privateIcons } from "./icons";

test("bundled icons: each designer file is the right kind (fire = campfire, sword = fight)", () => {
  assert.deepEqual({ ...BUNDLED_ICON_KINDS }, {
    "boss.png": "boss", "fire.png": "campfire", "stairs.png": "stairs", "sword.png": "fight", "village.png": "village", "well.png": "well",
  });
  assert.equal(bundledIconFile("campfire"), "fire.png");
  assert.equal(bundledIconFile("fight"), "sword.png");
});

test("bundled icons: deal, final, the devil's mark and the token have none; every other kind has exactly one file", () => {
  for (const k of ["deal", "final", "rewritten", "here"] as const) assert.equal(bundledIconFile(k), undefined, k);
  const rest = ICON_KINDS.filter((k) => k !== "deal" && k !== "final");
  assert.deepEqual([...BUNDLED_KINDS].sort(), [...rest].sort());
  assert.equal(new Set(Object.values(BUNDLED_ICON_KINDS)).size, Object.keys(BUNDLED_ICON_KINDS).length);
  for (const k of BUNDLED_KINDS) assert.ok(k in ICONS);
});

test("icon source: a private override > the bundled art > generated", () => {
  assert.equal(iconSource("campfire", []), "bundled");
  assert.equal(iconSource("campfire", [privateIconFile("campfire")]), "private");
  assert.equal(iconSource("deal", []), "generated");
  assert.equal(iconSource("deal", [privateIconFile("deal")]), "private");
  assert.equal(iconSource("final", ["map/other.png"]), "generated");
  assert.equal(iconSource("here", ["map/here.png"]), "generated"); // the token has no hook
  // A private file for one kind leaves the others on the bundled art.
  assert.equal(iconSource("well", [privateIconFile("campfire")]), "bundled");
  assert.deepEqual(privateIcons([privateIconFile("boss"), privateIconFile("deal"), "map/here.png"]).sort(), ["boss", "deal"]);
});
