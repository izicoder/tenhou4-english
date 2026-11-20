"use strict";
// Tests for the tile-label module of tenhou4-english.user.js.
// The module sits between "// <tiles>" and "// </tiles>" and is run here with
// mocks, so no browser or jsdom is needed.  Run: node --test test/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  process.env.TENHOU_SCRIPT || path.join(__dirname, "..", "tenhou4-english.user.js"),
  "utf8"
);
const CODE = SRC.split("// <tiles>")[1].split("// </tiles>")[0];

// A fresh class per load(): the module marks the prototype method it wraps.
function makeFakeCtxClass(log) {
  return class FakeCtx {
    save() {}
    restore() {}
    measureText(t) {
      return { width: t.length * 6 };
    }
    fillRect(...a) {
      log.push(["rect", ...a]);
    }
    fillText(...a) {
      log.push(["text", ...a]);
    }
    putImageData() {}
  };
}

function load(pathname = "/4/", storage = {}) {
  const log = [];
  const warnings = [];
  const FakeCtx = makeFakeCtxClass(log);
  const win = { CanvasRenderingContext2D: FakeCtx };
  const api = new Function(
    "window",
    "location",
    "localStorage",
    "console",
    "setInterval",
    "clearInterval",
    CODE + "\nreturn tilesApi;"
  )(
    win,
    { pathname },
    { getItem: (k) => (k in storage ? storage[k] : null), setItem() {} },
    { log() {}, warn: (...a) => warnings.push(a.join(" ")) },
    () => 1,
    () => {}
  );
  return { api, win, log, warnings, ctx: new FakeCtx() };
}

// --- synthetic obj file -------------------------------------------------
const KEY = (sheet, slot, face, seat) => ((sheet | (slot << 8) | (face << 16) | (seat << 24)) >>> 0);

// records: [x, y, w, h, key]; every record gets 10 bytes of "data".
function makeObj(records, { dx = 0 } = {}) {
  const buf = new ArrayBuffer(9000);
  const dv = new DataView(buf);
  dv.setUint32(0, 829055599, true); // obj1
  dv.setUint32(4, 3856, true);
  const offsets = [];
  records.forEach(([x, y, w, h, key], i) => {
    const ptr = 4000 + i * 100;
    dv.setUint32(24 + i * 4, ptr, true);
    dv.setInt16(ptr, x + dx, true);
    dv.setInt16(ptr + 2, y, true);
    dv.setInt16(ptr + 4, w, true);
    dv.setInt16(ptr + 6, h, true);
    dv.setUint32(ptr + 8, key, true);
    dv.setUint32(ptr + 16, 10, true);
    offsets.push(ptr + 20);
  });
  return { buf, offsets };
}

class FakeInflate {
  constructor() {}
  decompress() {}
}
FakeInflate.BufferType = { ADAPTIVE: 1 };

function decode(env, obj, recordIdx, w, h) {
  const Z = env.win.Zlib;
  for (const i of recordIdx) new Z.Inflate(new Uint8Array(obj.buf, obj.offsets[i], 10));
  env.ctx.putImageData({ width: w, height: h }, 0, 0);
}

function setup(records, opts) {
  const env = load();
  env.win.Zlib = { Inflate: FakeInflate };
  env.api.install();
  return { env, obj: makeObj(records, opts) };
}

const texts = (env) => env.log.filter((c) => c[0] === "text").map((c) => c[1]);
const rects = (env) => env.log.filter((c) => c[0] === "rect");

// base (face 34), a face, shadow (38) for one slot
const SLOT = [
  [100, 200, 60, 80, KEY(116, 5, 34, 0)], // 0 base / white dragon
  [110, 210, 40, 50, KEY(116, 5, 3, 0)], // 1 3m
  [112, 222, 36, 40, KEY(116, 5, 23, 0)], // 2 3s, artwork starts lower
  [108, 206, 44, 56, KEY(116, 5, 12, 0)], // 3 2p
  [100, 200, 60, 80, KEY(116, 5, 38, 0)], // 4 shadow
  [100, 200, 60, 80, KEY(116, 6, 37, 0)], // 5 tile back
  [100, 200, 60, 80, KEY(116, 6, 39, 0)], // 6 back shadow
  [0, 0, 9, 9, KEY(50, 1, 1, 0)], // 7 not a tile sheet
];

test("normalizeKey remaps sheet 110 slots like the client", () => {
  const { api } = load();
  const n = api._test.normalizeKey;
  assert.strictEqual(n(KEY(110, 20, 3, 1)), KEY(110, 40, 3, 1));
  assert.strictEqual(n(KEY(110, 40, 3, 1)), KEY(110, 98, 3, 1));
  assert.strictEqual(n(KEY(110, 60, 3, 1)), KEY(110, 120, 3, 1));
  assert.strictEqual(n(KEY(116, 20, 3, 1)), KEY(116, 20, 3, 1));
});

test("tile text: suits, honors, red fives", () => {
  const { api } = load();
  const t = api._test.tileText;
  assert.strictEqual(t(1).text, "1m");
  assert.strictEqual(t(9).text, "9m");
  assert.strictEqual(t(13).text, "3p");
  assert.strictEqual(t(29).text, "9s");
  assert.deepStrictEqual([30, 31, 32, 33, 34, 35, 36].map((f) => t(f).text), ["E", "S", "W", "N", "Wh", "Gr", "Rd"]);
  for (const f of [0, 10, 20]) assert.strictEqual(t(f).bg, "#c9a000"); // red five chip
  assert.strictEqual(t(0).text, "5m");
  assert.strictEqual(t(10).text, "5p");
  assert.strictEqual(t(20).text, "5s");
});

test("a decoded face produces its label, white dragon gets Wh, tile back none", () => {
  const { env, obj } = setup(SLOT);
  decode(env, obj, [0, 1, 4], 60, 80); // 3m
  decode(env, obj, [0], 60, 80); // white dragon: base only ...
  // (a real decode always ends with the shadow record)
  decode(env, obj, [0, 4], 60, 80);
  decode(env, obj, [5, 6], 60, 80); // tile back
  assert.deepStrictEqual(texts(env), ["3m", "Wh"]);
});

test("every face in a slot gets the same label anchor", () => {
  const { env, obj } = setup(SLOT);
  decode(env, obj, [0, 1, 4], 60, 80);
  decode(env, obj, [0, 2, 4], 60, 80);
  decode(env, obj, [0, 3, 4], 60, 80);
  const r = rects(env);
  assert.strictEqual(r.length, 3);
  assert.ok(r.every((x) => x[1] === r[0][1] && x[2] === r[0][2]), JSON.stringify(r));
});

test("non-tile sheets are ignored and a size mismatch draws nothing", () => {
  const { env, obj } = setup(SLOT);
  decode(env, obj, [7], 9, 9);
  assert.strictEqual(texts(env).length, 0);
  decode(env, obj, [0, 1, 4], 61, 80); // wrong ImageData size
  assert.strictEqual(texts(env).length, 0);
  assert.strictEqual(env.api.stats().sizeMismatch, 1);
});

test("a resize (new resolution) never mixes coordinates with the old file", () => {
  const env = load();
  env.win.Zlib = { Inflate: FakeInflate };
  env.api.install();
  const small = makeObj(SLOT);
  // Same keys at twice the size, shifted far right (like a re-download at a
  // bigger window).  Base is at (700,400) and the union of the faces starts at
  // (716,412), so the correct anchor is exactly double the small one.
  const big = makeObj(SLOT.map(([x, y, w, h, k]) => [x * 2 + 500, y * 2, w * 2, h * 2, k]));
  decode(env, small, [0, 1, 4], 60, 80); // 3m, small file
  decode(env, big, [0, 1, 4], 120, 160); // 3m, big file
  const [first, second] = rects(env);
  assert.deepStrictEqual([first[1], first[2]], [8, 6]);
  assert.deepStrictEqual([second[1], second[2]], [16, 12]);
});

test("wrapZlib keeps constructor semantics and statics", () => {
  const env = load();
  const Z = { Inflate: FakeInflate };
  env.api._test.wrapZlib(Z);
  assert.ok(Z.Inflate.__t4en);
  assert.strictEqual(Z.Inflate.BufferType, FakeInflate.BufferType);
  const inst = new Z.Inflate(new Uint8Array(4));
  assert.ok(inst instanceof FakeInflate);
  env.api._test.wrapZlib(Z); // idempotent
  assert.strictEqual(Z.Inflate.__t4en, true);
});

test("hooks stay off outside /4/ and when disabled", () => {
  const a = load("/man/");
  a.win.Zlib = { Inflate: FakeInflate };
  a.api.install();
  assert.strictEqual(a.api.stats().putWrapped, false);
  const b = load("/4/", { tenhou4enTiles: "0" });
  b.win.Zlib = { Inflate: FakeInflate };
  b.api.install();
  assert.strictEqual(b.api.stats().putWrapped, false);
  assert.strictEqual(b.api.stats().enabled, false);
});

test("health message: silent when fine, specific when broken", () => {
  const { env, obj } = setup(SLOT);
  assert.strictEqual(env.api._test.tileHealthMessage(), "");
  decode(env, obj, [0, 1, 4], 60, 80);
  assert.strictEqual(env.api._test.tileHealthMessage(), "");

  // Zlib is used a lot but no sprite file is ever recognised.
  const e2 = setup(SLOT).env;
  for (let i = 0; i < 25; i++) new e2.win.Zlib.Inflate(new Uint8Array(new ArrayBuffer(64), 0, 8));
  assert.match(e2.api._test.tileHealthMessage(), /not recognised/);

  // Tiles decode but nothing gets drawn.
  const e3 = setup(SLOT);
  decode(e3.env, e3.obj, [0, 1, 4], 1, 1); // size mismatch every time
  assert.match(e3.env.api._test.tileHealthMessage(), /no label was drawn/);
});

test("obj parser rejects other files", () => {
  const { api } = load();
  const p = api._test.parseObjBuffer;
  assert.strictEqual(p(new ArrayBuffer(8)), null);
  const wrong = new ArrayBuffer(64);
  new DataView(wrong).setUint32(0, 0x32736572, true); // 'res2'
  assert.strictEqual(p(wrong), null);
  const badSize = new ArrayBuffer(64);
  new DataView(badSize).setUint32(0, 829055599, true);
  new DataView(badSize).setUint32(4, 999, true);
  assert.strictEqual(p(badSize), null);
});

test("result-table score lines are treated as player names", () => {
  const m = /^[A-D]:.*\([+-]?\d+(?:\.\d)?\)$/;
  assert.ok(SRC.includes("PLAYER_SCORE_LINE_RE"));
  for (const s of ["D:ファウ(-21.0)", "A:夕どきハイボール(+72.3)", "C:筒万索(-55.3)"]) assert.ok(m.test(s), s);
  for (const s of ["認定", "対局", "A: something else"]) assert.ok(!m.test(s), s);
});
