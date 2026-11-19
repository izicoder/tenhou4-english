"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { load } = require("./helpers/load");

const EN = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "str_en.json"), "utf8")
);

const OVERRIDE_IDS = [20, 214, 223, 224, 225, 226, 300, 301, 341, 1029, 1103];

function hasJapanese(value) {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(JSON.stringify(value));
}

test("patchTable replaces every override id with English", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/?lang=en");
  const { patchTable } = dom.window.__tenhou4en;

  const out = patchTable(JSON.stringify(EN));
  assert.ok(out, "patchTable returned a table");

  for (const id of OVERRIDE_IDS) {
    assert.ok(id in out, `id ${id} is present`);
    assert.equal(hasJapanese(out[id]), false, `id ${id} is English: ${JSON.stringify(out[id])}`);
  }

  // Arrays come from the jsdom realm, so compare serialized values.
  assert.equal(
    JSON.stringify(out[20]),
    JSON.stringify(["Default", "2 TAPs", "3 TAPs"])
  );
  assert.equal(
    JSON.stringify(out[214]),
    JSON.stringify([
      "General",
      "Advanced",
      "Expert",
      "Phoenix",
      "Wakaba",
      "Silver",
      "Amber",
      "Peacock",
    ])
  );
  assert.equal(out[300], "Private Room");
  assert.equal(out[301], "Tournament");

  dom.window.close();
});

test("patchTable keeps the official entries it does not override", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const { patchTable } = dom.window.__tenhou4en;
  const out = patchTable(JSON.stringify(EN));

  assert.equal(out[10], EN[10]);
  assert.equal(out[200], EN[200]);
  assert.equal(out[1003], EN[1003]);

  dom.window.close();
});

test("patchTable accepts the array form the server may send", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const { patchTable } = dom.window.__tenhou4en;

  const out = patchTable([1, "one", 2, "two"]);
  assert.equal(out[1], "one");
  assert.equal(out[2], "two");
  assert.equal(out[300], "Private Room");

  dom.window.close();
});

test("patchTable returns null for invalid input", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const { patchTable } = dom.window.__tenhou4en;

  assert.equal(patchTable("not json"), null);
  assert.equal(patchTable(null), null);
  assert.equal(patchTable(42), null);

  dom.window.close();
});

test("the script forces localStorage.lang to en", () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  assert.equal(dom.window.localStorage.getItem("lang"), "en");
  dom.window.close();
});
