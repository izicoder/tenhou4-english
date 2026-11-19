"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { load } = require("./helpers/load");

const YAKU_JA = require(path.join(__dirname, "fixtures", "yaku-ja.json"));

test("every yaku in the client's array has an English mapping", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const { translateString, yaku } = dom.window.__tenhou4en;

  const missing = [];
  for (const ja of YAKU_JA) {
    if (!(ja in yaku)) missing.push(ja);
  }
  assert.deepEqual(missing, [], `unmapped yaku: ${missing.join(", ")}`);

  dom.window.close();
});

test("every yaku translation is non-empty and contains no Japanese", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const { translateString } = dom.window.__tenhou4en;

  for (const ja of YAKU_JA) {
    const en = translateString(ja);
    assert.ok(en, `translation exists for ${ja}`);
    assert.notEqual(en, ja, `translation differs for ${ja}`);
    assert.equal(
      /[\u3040-\u30ff\u4e00-\u9fff]/.test(en),
      false,
      `${ja} -> ${en} is English`
    );
  }

  dom.window.close();
});

test("yaku count matches the client array", () => {
  // Guards against the fixture being edited down by accident.
  assert.equal(YAKU_JA.length, 67);
});
