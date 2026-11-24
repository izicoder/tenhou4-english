// ==UserScript==
// @name         Tenhou /4 English + Tile Labels
// @name:ja      天鳳 /4 英語化 + 牌ラベル
// @namespace    https://github.com/izicoder/tenhou4-english
// @version      0.8.0
// @description  Completes the English UI on tenhou.net/4 (Desktop4K), translates the Japanese the official EN option leaves behind, and labels every face-up tile (1m 5p E Wh Gr Rd ...).
// @author       izicoder
// @homepageURL  https://github.com/izicoder/tenhou4-english
// @supportURL   https://github.com/izicoder/tenhou4-english/issues
// @updateURL    https://raw.githubusercontent.com/izicoder/tenhou4-english/master/tenhou4-english.user.js
// @downloadURL  https://raw.githubusercontent.com/izicoder/tenhou4-english/master/tenhou4-english.user.js
// @match        https://tenhou.net/4/*
// @match        https://tenhou.net/4/
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

/*
 * How this works
 * --------------
 * The /4 client keeps its UI strings in a per-language table loaded from
 *   https://cdn.tenhou.net/4/res/lang/string<date>_<lang>.json
 * and looks them up as  hb[lang][id] || hb.en[id] || hb.ja[id].
 *
 * The official EN table is missing a few ids and leaves a few values in
 * Japanese.  We intercept the XHR for the EN table and merge our overrides
 * in, so the client itself renders English everywhere the table is used.
 *
 * Everything else (yaku names, ranks, room names, counters) is hard-coded
 * Japanese inside latest.js and written into the DOM, so a MutationObserver
 * swaps those text nodes by exact match.
 *
 * Tile labels: tiles are canvas sprites decoded on demand from obj*.dat files.
 * We watch Zlib.Inflate to learn which face a sprite is being decoded for and
 * draw the label onto the sprite canvas right after putImageData().  No
 * client patching, no extra canvases.  Console helpers:
 *   __tenhou4en.tiles.stats()            counters, to see if it is working
 *   __tenhou4en.tiles.setPosition("c")   centre the labels (reload after)
 *   __tenhou4en.tiles.setOffset(dx, dy)  nudge, fractions of the tile face
 *   __tenhou4en.tiles.setEnabled(false)  turn the labels off
 *
 * Only run ONE copy of this script: another Tenhou /4 userscript (anything
 * that sets window.__tenhou4enInstalled) will make the second one bow out.
 */

(function () {
  "use strict";

  const VERSION = "0.8.0";
  if (window.__tenhou4enInstalled) {
    console.warn(
      "[tenhou4-en] v" + VERSION + " not started: another copy of this script is " +
      "already running.  Disable the duplicate userscript and reload."
    );
    return;
  }
  window.__tenhou4enInstalled = true;

  // ---------------------------------------------------------------- settings
  //
  // Every user-facing option lives here, is validated on the way in and out,
  // and is saved as one JSON object.  The settings panel is just a view of it.
  //
  // <store>
  const SETTINGS_KEY = "tenhou4enSettings";

  // null / "" / junk -> default.  (Number(null) is 0, which must not count.)
  const clampNum = (v, lo, hi, dflt) => {
    const n = v === null || v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };

  const SETTING_DEFS = {
    // --- tile labels
    enabled: { def: true },
    showHand: { def: true },
    showDiscards: { def: true },
    showMelds: { def: true },
    showWall: { def: true },
    showOthers: { def: true },
    pos: { def: "tl", oneOf: ["tl", "c"] },
    scale: { def: 1, min: 0.5, max: 2 },
    dx: { def: 0, min: -0.5, max: 0.5 },
    dy: { def: 0, min: -0.5, max: 0.5 },
    opacity: { def: 0.9, min: 0.3, max: 1 },
    text: { def: "full", oneOf: ["full", "number"] },
    honors: { def: "wh", oneOf: ["wh", "pfc"] },
    red: { def: "five", oneOf: ["five", "zero"] },
    palette: { def: "default", oneOf: ["default", "contrast", "cb"] },
    // --- translation
    translate: { def: true },
    fillTable: { def: true },
    forceEn: { def: true },
    debug: { def: false },
    custom: { def: "", maxLen: 20000 },
    // --- panel
    buttonPos: { def: "tl", oneOf: ["tl", "tr", "bl", "br"] },
    buttonHidden: { def: false },
    hotkey: { def: "t", pattern: /^[a-z0-9]$/i },
  };
  const TILE_KEYS = [
    "enabled", "showHand", "showDiscards", "showMelds", "showWall", "showOthers",
    "pos", "scale", "dx", "dy", "opacity", "text", "honors", "red", "palette",
  ];

  function coerceSetting(key, v) {
    const d = SETTING_DEFS[key];
    if (!d) return undefined;
    if (typeof d.def === "boolean") {
      if (typeof v === "boolean") return v;
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
      return d.def;
    }
    if (typeof d.def === "number") return clampNum(v, d.min, d.max, d.def);
    if (d.oneOf) return d.oneOf.indexOf(v) >= 0 ? v : d.def;
    if (typeof v !== "string") return d.def;
    if (d.pattern) return d.pattern.test(v) ? v.toLowerCase() : d.def;
    return v.slice(0, d.maxLen || 200);
  }

  function loadSettings() {
    const s = {};
    for (const k in SETTING_DEFS) s[k] = SETTING_DEFS[k].def;
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (stored && typeof stored === "object") {
        for (const k in SETTING_DEFS) if (k in stored) s[k] = coerceSetting(k, stored[k]);
        return s;
      }
    } catch (e) {
      /* fall through to the legacy keys */
    }
    // v0.5.x / v0.6.0 kept a few options under separate keys.
    try {
      const g = (k) => localStorage.getItem(k);
      if (g("tenhou4enTiles") !== null) s.enabled = g("tenhou4enTiles") !== "0";
      if (g("tenhou4enTilePos") !== null) s.pos = coerceSetting("pos", g("tenhou4enTilePos"));
      if (g("tenhou4enTileScale") !== null) s.scale = coerceSetting("scale", g("tenhou4enTileScale"));
      const off = String(g("tenhou4enTileOff") || "").split(",");
      if (off.length === 2) {
        s.dx = coerceSetting("dx", off[0]);
        s.dy = coerceSetting("dy", off[1]);
      }
      if (g("tenhou4enDebug") === "1") s.debug = true;
    } catch (e) {
      /* storage unavailable: defaults */
    }
    return s;
  }

  const settings = loadSettings();
  const settingListeners = [];

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      /* private mode etc. */
    }
  }

  // Apply a patch; unknown keys are ignored, bad values fall back to defaults.
  function setSettings(patch) {
    const changed = [];
    for (const k in patch) {
      if (!(k in SETTING_DEFS)) continue;
      const v = coerceSetting(k, patch[k]);
      if (v !== settings[k]) {
        settings[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) {
      saveSettings();
      for (const fn of settingListeners.slice()) {
        try {
          fn(changed);
        } catch (e) {
          /* a broken listener must not block the others */
        }
      }
    }
    return Object.assign({}, settings);
  }

  function resetSettings(keys) {
    const patch = {};
    for (const k of keys || Object.keys(SETTING_DEFS)) if (k in SETTING_DEFS) patch[k] = SETTING_DEFS[k].def;
    return setSettings(patch);
  }

  function exportSettings() {
    return JSON.stringify(Object.assign({ tenhou4en: "settings" }, settings), null, 2);
  }

  function importSettings(text) {
    let obj;
    try {
      obj = JSON.parse(String(text));
    } catch (e) {
      return { ok: false, error: "That is not valid JSON." };
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, error: "That is not a settings object." };
    }
    const known = Object.keys(obj).filter((k) => k in SETTING_DEFS);
    if (!known.length) return { ok: false, error: "No known settings found." };
    const patch = {};
    for (const k of known) patch[k] = obj[k];
    setSettings(patch);
    return { ok: true, count: known.length };
  }
  // </store>

  const QUERY_DEBUG = /[?&]tenhou_en_debug=1\b/.test(location.search);
  const isDebug = () => QUERY_DEBUG || settings.debug;

  // ---------------------------------------------------------------- language

  // Must happen before latest.js reads it.  "en" and "EN" both resolve to en.
  if (settings.forceEn) {
    try {
      localStorage.setItem("lang", "en");
    } catch (e) {
      /* private mode etc. */
    }
  }

  // ------------------------------------------------------- string table patch

  const LANG_URL_RE = /\/res\/lang\/string\d+_en\.json(?:[?#]|$)/;

  // IDs the official EN table is missing (20, 214, 1029, 1103) or leaves in
  // Japanese (223-226, 300, 301, 341).
  const TABLE_OVERRIDES = {
    20: ["Default", "2 TAPs", "3 TAPs"],

    214: [
      "General",
      "Advanced",
      "Expert",
      "Phoenix",
      "Wakaba",
      "Silver",
      "Amber",
      "Peacock",
    ],

    223:
      "You don't meet the requirements for <b>Advanced</b> tables " +
      "(1 Kyu or above, or 60+ days of Premium). " +
      "*Players at 7 Dan / R2000 or above cannot enter.",
    224:
      "You don't meet the requirements for <b>Expert</b> tables " +
      "(4 Dan / R1800 or above).",
    225:
      "You don't meet the requirements for <b>Phoenix</b> tables " +
      "(Premium + 7 Dan / R2000 or above).",
    226:
      "You don't meet the requirements for <b>Jansou</b> tables " +
      "(Premium + 4 Dan / R1800 or above).",

    300: "Private Room",
    301: "Tournament",
    341: "<div class=desc>(Ranked / Jansou)</div>",

    1029:
      "ID or password is incorrect. You can reset your password on the " +
      "member page below.<br>" +
      "<a href='https://ron2.jp/3/member/' target=_blank>https://ron2.jp/3/member/</a><br>" +
      "Contact: support@ron2.jp",

    1103:
      "Special Promotion tables are open daily 21:00-25:00 (JST). " +
      "Entry requires 100 games played and R1800 or above.",
  };

  function patchTable(raw) {
    let obj;
    try {
      obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
    if (!obj) return null;

    // The server may send either {id: text} or [id, text, id, text, ...].
    if (Array.isArray(obj)) {
      const o = {};
      for (let i = 0; i + 1 < obj.length; i += 2) o[obj[i]] = obj[i + 1];
      obj = o;
    }
    if (typeof obj !== "object") return null;

    for (const id in TABLE_OVERRIDES) obj[id] = TABLE_OVERRIDES[id];
    return obj;
  }

  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;

  XHR.open = function (method, url) {
    try {
      this.__tenhouUrl = String(url);
    } catch (e) {
      /* ignore */
    }
    return nativeOpen.apply(this, arguments);
  };

  for (const prop of ["response", "responseText"]) {
    const desc = Object.getOwnPropertyDescriptor(XHR, prop);
    if (!desc || !desc.get) continue;

    Object.defineProperty(XHR, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        let value;
        try {
          value = desc.get.call(this);
        } catch (e) {
          // responseText throws when responseType is not "" / "text".
          return undefined;
        }

        if (this.readyState !== 4) return value;
        if (!settings.fillTable) return value;
        if (!LANG_URL_RE.test(this.__tenhouUrl || "")) return value;
        if (value == null) return value;

        const type = this.responseType;
        const wantText = prop === "responseText" || type === "" || type === "text";

        if (this.__tenhouPatched) {
          return wantText ? this.__tenhouPatched.text : this.__tenhouPatched.obj;
        }

        const obj = patchTable(value);
        if (!obj) return value;

        this.__tenhouPatched = { obj, text: JSON.stringify(obj) };
        return wantText ? this.__tenhouPatched.text : this.__tenhouPatched.obj;
      },
    });
  }

  // ------------------------------------------------------------- DOM strings

  // Yaku ids are indices into the client's hard-coded Japanese array, and the
  // result panel writes them straight into <div class="ym"> / <div class="yk">.
  const YAKU = {
    "門前清自摸和": "Menzen Tsumo",
    "立直": "Riichi",
    "一發": "Ippatsu",
    "槍槓": "Chankan",
    "嶺上開花": "Rinshan Kaihou",
    "海底摸月": "Haitei Raoyue",
    "河底撈魚": "Houtei Raoyui",
    "平和": "Pinfu",
    "斷么九": "Tanyao",
    "一盃口": "Iipeikou",
    "自風 東": "Seat Wind: East",
    "自風 南": "Seat Wind: South",
    "自風 西": "Seat Wind: West",
    "自風 北": "Seat Wind: North",
    "場風 東": "Round Wind: East",
    "場風 南": "Round Wind: South",
    "場風 西": "Round Wind: West",
    "場風 北": "Round Wind: North",
    "役牌 白": "Haku",
    "役牌 發": "Hatsu",
    "役牌 中": "Chun",
    "兩立直": "Double Riichi",
    "七對子": "Chiitoitsu",
    "混全帶么九": "Chanta",
    "一氣通貫": "Ittsu",
    "三色同順": "Sanshoku Doujun",
    "三色同刻": "Sanshoku Doukou",
    "三槓子": "Sankantsu",
    "對對和": "Toitoi",
    "三暗刻": "Sanankou",
    "小三元": "Shousangen",
    "混老頭": "Honroutou",
    "二盃口": "Ryanpeikou",
    "純全帶么九": "Junchan",
    "混一色": "Honitsu",
    "清一色": "Chinitsu",
    "人和": "Renhou",
    "天和": "Tenhou",
    "地和": "Chiihou",
    "大三元": "Daisangen",
    "四暗刻": "Suuankou",
    "四暗刻單騎": "Suuankou Tanki",
    "字一色": "Tsuuiisou",
    "綠一色": "Ryuuiisou",
    "清老頭": "Chinroutou",
    "九蓮寶燈": "Chuuren Poutou",
    "純正九蓮寶燈": "Junsei Chuuren Poutou",
    "國士無雙": "Kokushi Musou",
    "國士無雙13面": "Kokushi Musou 13-wait",
    "大四喜": "Daisuushii",
    "小四喜": "Shousuushii",
    "四槓子": "Suukantsu",
    "ドラ": "Dora",
    "裏ドラ": "Ura Dora",
    "赤ドラ": "Aka Dora",
    "親": "Dealer",
    "門前": "Concealed",
    "榮和": "Ron",
    "本場": "Honba",
    "明槓": "Open Kan",
    "暗槓": "Closed Kan",
    // Non-standard labels at the end of the client's array.  Transliterated;
    // verify against a real game if they ever show up.
    "五": "Five",
    "ガリ": "Gari",
    "セット": "Set",
    "カラス": "Karasu",
    "全ガリ": "Zen Gari",
    "バンバン": "Banban",
  };

  const RANKS = {
    "新人": "Newcomer",
    "１級": "1 Kyu",
    "２級": "2 Kyu",
    "３級": "3 Kyu",
    "４級": "4 Kyu",
    "５級": "5 Kyu",
    "６級": "6 Kyu",
    "７級": "7 Kyu",
    "８級": "8 Kyu",
    "９級": "9 Kyu",
    "初段": "1 Dan",
    "二段": "2 Dan",
    "三段": "3 Dan",
    "四段": "4 Dan",
    "五段": "5 Dan",
    "六段": "6 Dan",
    "七段": "7 Dan",
    "八段": "8 Dan",
    "九段": "9 Dan",
    "十段": "10 Dan",
    "天鳳": "Tenhou",
  };

  const MISC = {
    "個室": "Private Room",
    "大会": "Tournament",
    "一般": "General",
    "上級": "Advanced",
    "特上": "Expert",
    "鳳凰": "Phoenix",
    "若葉": "Wakaba",
    "銀": "Silver",
    "琥珀": "Amber",
    "孔雀": "Peacock",
    "流局": "Exhaustive Draw",
    "九種九牌": "Nine Terminals",
    "四風連打": "Four Winds",
    "三家和了": "Triple Ron",
    "四家立直": "Four Riichi",
    "四槓散了": "Four Kans",
    "流局滿貫": "Nagashi Mangan",
    "有効期限": "Expires",
    "祝": "Congrats",
    "固定": "Fixed",
    "だれでも": "Anyone",
    "喰断ナシ": "Kuitan Nashi",
    "東天紅": "Toutenkou",
    "拡張": "Extended",
    "以上": "or above",
    "以下": "or below",
    "点": "pts",
    "枚": "tiles",
    // Limit hands and result-screen terms.  Tenhou uses the traditional
    // forms (滿 / 數 / 役滿); the simplified forms are kept as a fallback.
    "認定": "Certification",
    "滿貫": "Mangan",
    "跳滿": "Haneman",
    "倍滿": "Baiman",
    "三倍滿": "Sanbaiman",
    "役滿": "Yakuman",
    "數え役滿": "Kazoe Yakuman",
    "數え役満": "Kazoe Yakuman",
    "満貫": "Mangan",
    "跳満": "Haneman",
    "倍満": "Baiman",
    "三倍満": "Sanbaiman",
    "役満": "Yakuman",
    "数え役満": "Kazoe Yakuman",
    "終局": "Game Over",
    "供託": "Riichi Sticks",
    "荒牌平局": "Exhaustive Draw",
    "順位": "Rank",
    "段位": "Dan Rank",
    "聴牌": "Tenpai",
    "不聴": "Noten",
    // Lobby / room selection.
    "準備中": "Loading...",
    "四麻:": "4-player:",
    "三麻:": "3-player:",
    "東風戦": "East-only",
    "東南戦": "East-South",
    "喰アリ赤": "Kuitan Ari Red",
    "喰アリ赤速": "Kuitan Ari Red Fast",
    "喰アリ赤光": "Kuitan Ari Red Flash",
    "三喰赤": "3P Kuitan Red",
    "三喰赤速": "3P Kuitan Red Fast",
    // Lobby notice bar (outage announcement).
    "10/21,11/08に発生した障害の戦績修正を受け付けています":
      "Accepting results corrections for the 10/21 and 11/08 outages",
    "※喰断ナシON/OFF": "* Kuitan Nashi ON/OFF",
    // Browser tab title.
    "天鳳 / Desktop4K版": "Tenhou / Desktop4K",
    // In-game.
    "對局": "Game",
  };

  const EXACT = Object.assign({}, MISC, RANKS, YAKU);

  // ------------------------------------------------- user's own translations
  // One per line:  日本語 = English   ("#" or "//" start a comment).
  // <custom>
  function parseCustom(text) {
    const entries = new Map();
    const errors = [];
    const lines = String(text || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line[0] === "#" || line.slice(0, 2) === "//") continue;
      const eq = line.indexOf("=");
      if (eq <= 0) {
        errors.push("line " + (i + 1) + ": no \"=\" found");
        continue;
      }
      const ja = line.slice(0, eq).trim();
      const en = line.slice(eq + 1).trim();
      if (!ja || !en) errors.push("line " + (i + 1) + ": needs text on both sides of \"=\"");
      else if (ja.length > 200 || en.length > 400) errors.push("line " + (i + 1) + ": too long");
      else if (entries.size >= 300) errors.push("line " + (i + 1) + ": limit of 300 entries reached");
      else entries.set(ja, en);
    }
    return { entries, errors };
  }

  const customPrev = new Map(); // Japanese -> value it replaced (undefined = none)
  function applyCustom(text) {
    for (const [ja, prev] of customPrev) {
      if (prev === undefined) delete EXACT[ja];
      else EXACT[ja] = prev;
    }
    customPrev.clear();
    const res = parseCustom(text);
    for (const [ja, en] of res.entries) {
      customPrev.set(ja, EXACT[ja]);
      EXACT[ja] = en;
    }
    return res;
  }
  // </custom>
  applyCustom(settings.custom);

  const WIND = { 東: "East", 南: "South", 西: "West", 北: "North" };

  // Lobby tabs are single characters inside div.tab3 label.btn[for].  They must
  // not be translated anywhere else (a player name could be 東).
  const TAB_LABELS = {
    四: "4P",
    三: "3P",
    東: "East",
    南: "South",
    鳳: "Phoenix",
    特: "Expert",
    雀: "Jansou",
  };

  // The round indicator (東1局) is split into separate text nodes: 東 / 1 / 局.
  // Match the parent's reconstructed text, never a lone wind character, and
  // rewrite the child nodes in place so the client keeps its own elements.
  const ROUND_RE = /^([東南西北])(\d+)局$/;

  // The in-game panel wraps the round and seat wind in nested spans inside
  // div.nopp, e.g. <div class=nopp><span>東</span><span>1</span><span>局</span>.
  const NOPP_ROUND_RE = /^([東南西北])(\d+)局$/;
  const NOPP_SEAT_RE = /^([東南西北])\s+(.+)$/;

  // Original value of every text node we have rewritten.  Lets us rebuild the
  // parent string on later mutations (the digit changes, 東 and 局 do not).
  const ORIGINALS = new WeakMap();

  function originalValue(node) {
    return ORIGINALS.has(node) ? ORIGINALS.get(node) : node.nodeValue;
  }

  // What we last wrote into each node.  If the client later writes something
  // else, that is a new original (so restoring never brings back stale text).
  const WRITTEN = new WeakMap();

  function setNodeValue(node, value) {
    const cur = node.nodeValue;
    if (!ORIGINALS.has(node) || (WRITTEN.has(node) && WRITTEN.get(node) !== cur)) {
      ORIGINALS.set(node, cur);
    }
    WRITTEN.set(node, value);
    if (cur !== value) node.nodeValue = value;
  }

  // Put the Japanese back everywhere we replaced it.
  function restoreOriginals() {
    const root = document.documentElement;
    if (!root) return 0;
    const walker = document.createTreeWalker(root, 4, null);
    let n;
    let count = 0;
    while ((n = walker.nextNode())) {
      if (!ORIGINALS.has(n)) continue;
      const o = ORIGINALS.get(n);
      if (n.nodeValue !== o) {
        n.nodeValue = o;
        count++;
      }
      ORIGINALS.delete(n);
      WRITTEN.delete(n);
    }
    return count;
  }

  function childTextNodes(parent) {
    const doc = parent.ownerDocument;
    if (!doc) return [];
    const out = [];
    // NodeFilter.SHOW_TEXT === 4; avoid the global, which can be gone after a
    // window closes (jsdom) or during teardown.
    const w = doc.createTreeWalker(parent, 4, null);
    let n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }

  function translateNoppContainer(node) {
    const start = node.parentElement;
    if (!start || !start.closest) return false;

    const container = start.closest("div.nopp");
    if (!container) return false;

    const nodes = childTextNodes(container);
    if (!nodes.length) return false;

    const original = nodes
      .map(originalValue)
      .join("")
      .trim();

    // Round: 東1局 -> East 1
    let m = NOPP_ROUND_RE.exec(original);
    if (m) {
      const wind = WIND[m[1]];
      for (const n of nodes) {
        const text = originalValue(n).trim();
        if (text === m[1]) setNodeValue(n, `${wind} `);
        else if (text === "局") setNodeValue(n, "");
      }
      return true;
    }

    // Seat wind + score or player name: 南 25000 / 北 COM / 南 vanicake
    m = NOPP_SEAT_RE.exec(original);
    if (m) {
      const wind = WIND[m[1]];
      for (const n of nodes) {
        const value = originalValue(n);
        if (value.trim() === m[1]) {
          const trailing = /\s$/.test(value) ? " " : "";
          setNodeValue(n, wind + trailing);
          break;
        }
      }
      return true;
    }

    return false;
  }

  let RANK_WORDS = null;
  function rankWords() {
    if (!RANK_WORDS) {
      RANK_WORDS = new Set([...Object.keys(RANKS), ...Object.values(RANKS)]);
    }
    return RANK_WORDS;
  }

  // Result dialog: the seat wind is a lone text node before the player name,
  // e.g. [西][ COM][25000][-2600].  Translate it only when it is the first
  // text of a box that also shows a score, so a bare 東 elsewhere is safe.
  function translateResultSeat(node) {
    const text = node.nodeValue.trim();
    if (!WIND[text]) return false;

    let box = node.parentElement;
    for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
      const nodes = childTextNodes(box).filter((n) => originalValue(n).trim());
      if (!nodes.length || nodes[0] !== node) continue;
      const joined = nodes.map(originalValue).join(" ");
      // Result dialog: a score follows.  Match-start dialog: a rank follows
      // (東 / 新人 / COM).  Either way the wind is the first text of its box.
      const nextText = nodes[1] ? originalValue(nodes[1]).trim() : "";
      if (/\d{4,6}/.test(joined) || rankWords().has(nextText)) {
        setNodeValue(node, WIND[text] + " ");
        return true;
      }
    }
    return false;
  }

  function translateRoundParent(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1) return false;

    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return false;

    const nodes = childTextNodes(parent);
    if (!nodes.length) return false;

    const original = nodes
      .map(originalValue)
      .join("")
      .replace(/\s+/g, "");
    const m = ROUND_RE.exec(original);
    if (!m) return false;

    const wind = WIND[m[1]];
    const whole = `${m[1]}${m[2]}局`;

    for (const n of nodes) {
      const value = originalValue(n);
      const text = value.trim();

      if (text === whole) {
        setNodeValue(n, `${wind} ${m[2]}`);
      } else if (text === m[1]) {
        setNodeValue(n, `${wind} `);
      } else if (text === "局") {
        setNodeValue(n, "");
      }
    }
    return true;
  }

  // Counters whose number and unit can be split into separate text nodes,
  // e.g. 3 / 本場 or 12000 / 点.
  const SPLIT_COUNTER_RE = /^(\d+)(本場|枚|点|翻|飜|符|人|位|戦|日)$/;

  function ordinal(n) {
    const i = Number(n);
    const v = i % 100;
    const s = ["th", "st", "nd", "rd"];
    return i + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function counterSuffix(unit, n) {
    switch (unit) {
      case "本場":
        return " Honba";
      case "枚":
        return " tiles";
      case "点":
        return " pts";
      case "翻":
      case "飜":
        return " han";
      case "符":
        return " fu";
      case "人":
        return n === "1" ? " player" : " players";
      case "戦":
        return " games";
      case "日":
        return " days";
      case "位":
        return ""; // the number node becomes 1st / 2nd / ...
    }
    return null;
  }

  function translateSplitCounter(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1) return false;

    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return false;

    const nodes = childTextNodes(parent);
    if (nodes.length < 2) return false; // single node is handled by RULES

    const original = nodes
      .map(originalValue)
      .join("")
      .replace(/\s+/g, "");
    const m = SPLIT_COUNTER_RE.exec(original);
    if (!m) return false;

    const num = m[1];
    const unit = m[2];

    for (const n of nodes) {
      const text = originalValue(n).trim();
      if (text === unit) {
        setNodeValue(n, counterSuffix(unit, num));
      } else if (unit === "位" && text === num) {
        setNodeValue(n, ordinal(num));
      }
    }
    return true;
  }

  // Table names are generated by the client as:
  //   [四三][tier][東南] + (喰|断)? + 赤? + (速|光)? + 祝N?
  // e.g. 四鳳南喰赤 = 4P Phoenix South Open Red
  //      四若東速祝５ = 4P Wakaba East Fast Anniv 5
  const TABLE_TIERS = {
    般: "General",
    上: "Advanced",
    特: "Expert",
    鳳: "Phoenix",
    若: "Wakaba",
    銀: "Silver",
    琥: "Amber",
    孔: "Peacock",
    雀: "Jansou",
  };

  function translateTableName(text) {
    const m = /^([四三])([般上特鳳若銀琥孔雀])([東南])(喰|断)?(赤)?(速|光)?(祝[０-９0-9]?)?$/.exec(
      text
    );
    if (!m) return null;
    const parts = [
      m[1] === "四" ? "4P" : "3P",
      TABLE_TIERS[m[2]],
      m[3] === "東" ? "East" : "South",
    ];
    if (m[4] === "喰") parts.push("Open");
    else if (m[4] === "断") parts.push("No Open");
    if (m[5]) parts.push("Red");
    if (m[6] === "速") parts.push("Fast");
    else if (m[6] === "光") parts.push("Flash");
    if (m[7]) {
      const n = m[7]
        .slice(1)
        .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
      parts.push(n ? `Anniv ${n}` : "Anniv");
    }
    return parts.join(" ");
  }

  const RULES = [
    // 東1局 / 南3局
    [/^([東南西北])(\d+)局$/, (m) => `${WIND[m[1]]} ${m[2]}`],
    // 東場
    [/^([東南西北])場$/, (m) => `${WIND[m[1]]} Round`],
    // 3本場
    [/^(\d+)本場$/, (m) => `${m[1]} Honba`],
    // 25枚
    [/^(\d+)枚$/, (m) => `${m[1]} tiles`],
    // 12000点
    [/^(\d+)点$/, (m) => `${m[1]} pts`],
    // 3翻
    [/^(\d+)[翻飜]$/, (m) => `${m[1]} han`],
    // 40符
    [/^(\d+)符$/, (m) => `${m[1]} fu`],
    // 4人 / 1人
    [/^(\d+)人$/, (m) => `${m[1]} ${m[1] === "1" ? "player" : "players"}`],
    // 1位 / 2位
    [/^(\d+)位$/, (m) => ordinal(m[1])],
    // 100戦
    [/^(\d+)戦$/, (m) => `${m[1]} games`],
    // 30日
    [/^(\d+)日$/, (m) => `${m[1]} days`],
    // R1800 stays as-is; kept explicit so the rule set is complete.
    [/^R(\d+)$/, (m) => `R${m[1]}`],
    // Table name, generated by the client as:
    //   [四三][tier][東南] + (喰|断)? + 赤? + (速|光)? + 祝N?
    [/^([四三][般上特鳳若銀琥孔雀][東南][^\s　]*)$/, (m) => translateTableName(m[1])],
    // Game-select list: table name followed by the player count, e.g.
    //   四般東喰赤　  2:
    [
      /^([四三][般上特鳳若銀琥孔雀][東南][^\s　]*)[\s　]+(\d+):$/,
      (m) => `${translateTableName(m[1])}  ${m[2]}:`,
    ],
    // Room notes in the game-select list: ※四麻上級卓 etc.
    [
      /^※([四三])麻(一般卓|上級卓|特上卓|鳳凰卓|若葉卓|雀荘戦)$/,
      (m) => {
        const table =
          {
            一般卓: "General table",
            上級卓: "Advanced table",
            特上卓: "Expert table",
            鳳凰卓: "Phoenix table",
            若葉卓: "Wakaba table",
            雀荘戦: "Jansou match",
          }[m[2]];
        return `* ${m[1] === "四" ? "4P" : "3P"} ${table}`;
      },
    ],
    // 供託 / ドラ etc. handled by EXACT.
  ];

  // A rank embedded in a sentence ("promoted to: ９級 ...").  Only matches when
  // the rank stands alone as a word, so names that merely contain one are safe.
  const INLINE_RANK_RE = new RegExp(
    "(^|[\\s:：(（])(" +
    Object.keys(RANKS)
      .sort((a, b) => b.length - a.length)
      .join("|") +
    ")(?=$|[\\s.,!?)）。、])",
    "g"
  );

  function translateString(text) {
    const direct = EXACT[text];
    if (direct != null) return direct;

    for (const [re, fn] of RULES) {
      const m = re.exec(text);
      if (m) return fn(m);
    }

    INLINE_RANK_RE.lastIndex = 0;
    const inline = text.replace(INLINE_RANK_RE, (m, pre, rank) => pre + RANKS[rank]);
    if (inline !== text) return inline;
    return null;
  }

  const seenUnknown = new Set();

  function translateContext(node) {
    const el = node.parentElement;
    if (!el || !el.matches) return false;

    // <div class="tab3"><label class="btn" for="wg02">四</label></div>
    if (el.matches("div.tab3 label.btn[for]")) {
      const raw = node.nodeValue;
      const text = raw.trim();
      const out = TAB_LABELS[text];
      if (out == null) return false;
      const i = raw.indexOf(text);
      setNodeValue(node, raw.slice(0, i) + out + raw.slice(i + text.length));
      return true;
    }
    return false;
  }

  // <names>
  // Player names are user content, never UI text.  A player called "ドラ" or
  // "平和" must not become "Dora" / "Pinfu".  The game announces the names in
  // WebSocket messages (UN: n0..n3, URL-encoded; HELO: uname; CHAT: uname), so
  // we listen for those and remember them.
  const PLAYER_NAMES = new Set();

  function learnNames(data) {
    if (typeof data !== "string" || data.length > 20000 || data.charCodeAt(0) !== 123) return;
    let d;
    try {
      d = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!d || typeof d !== "object") return;
    const add = (v) => {
      if (typeof v !== "string" || !v) return;
      try {
        v = decodeURIComponent(v);
      } catch (e) {
        /* keep the raw value */
      }
      v = v.trim();
      if (v && PLAYER_NAMES.size < 500) PLAYER_NAMES.add(v);
    };
    if (d.tag === "UN") {
      for (let i = 0; i < 4; i++) add(d["n" + i]);
    } else if (d.tag === "HELO" || d.tag === "CHAT") {
      add(d.uname);
    }
  }

  // True when this text node is a player name.  Yaku cells (.ym / .yk) are
  // exempt so a player named "平和" cannot stop the yaku "平和" being translated.
  function isProtectedName(raw, el) {
    if (!PLAYER_NAMES.size) return false;
    const t = String(raw).trim();
    if (!t || !PLAYER_NAMES.has(t)) return false;
    return !(el && el.closest && el.closest(".ym, .yk"));
  }

  function installNameTracker() {
    const WS = window.WebSocket;
    if (typeof WS !== "function" || WS.__t4en || typeof Proxy !== "function") return;
    window.WebSocket = new Proxy(WS, {
      construct(target, args) {
        const ws = new target(...args);
        try {
          ws.addEventListener("message", (e) => learnNames(e.data));
        } catch (e) {
          /* never break the game's connection */
        }
        return ws;
      },
      get(target, key) {
        return key === "__t4en" ? true : Reflect.get(target, key, target);
      },
    });
  }
  // </names>
  installNameTracker();

  const PLAYER_SCORE_LINE_RE = /^[A-D]:.*\([+-]?\d+(?:\.\d)?\)$/;

  function translateTextNode(node) {
    if (!settings.translate) return;
    const raw = node.nodeValue;
    if (!raw) return;

    // Never touch executable or style content.  walk() prunes these subtrees,
    // but characterData callbacks can still land on them.
    const parent = node.parentNode;
    if (parent && parent.nodeType === 1) {
      const ptag = parent.tagName;
      if (ptag === "SCRIPT" || ptag === "STYLE" || ptag === "TEXTAREA") return;
    }

    // Player names are user content, never UI strings.
    const pel = node.parentElement;
    if (
      pel &&
      pel.closest &&
      pel.closest('a[href*="tenhou.net/0/?wg="]')
    ) {
      return;
    }

    // A player whose name is also a game term stays exactly as typed.
    if (isProtectedName(raw, pel)) return;

    // Context-only labels (single-character lobby tabs).
    if (translateContext(node)) return;

    // In-game round / seat panel (nested spans inside div.nopp).
    if (translateNoppContainer(node)) return;

    // Result dialog seat winds (西 COM 25000 -2600).
    if (translateResultSeat(node)) return;

    // Round text is split across sibling nodes; handle it at the parent level.
    if (translateRoundParent(node)) return;

    // Numbers and their unit may also be separate nodes (3 / 本場).
    if (translateSplitCounter(node)) return;

    const text = raw.trim();
    if (!text) return;

    // Text with newlines/tabs or runs of spaces: match it normalized and
    // replace the whole node.
    const normalized = text.replace(/\s+/g, " ");
    const normalizedHit = EXACT[normalized];
    if (normalizedHit != null && normalizedHit !== normalized) {
      setNodeValue(node, normalizedHit);
      return;
    }

    const out = translateString(text);
    if (out != null) {
      if (out === text) return;
      const i = raw.indexOf(text);
      setNodeValue(node, raw.slice(0, i) + out + raw.slice(i + text.length));
      return;
    }

    // "D:name(-21.0)" lines of the final score table carry player names.
    if (PLAYER_SCORE_LINE_RE.test(text)) return;

    if (isDebug() && /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) && !seenUnknown.has(text)) {
      seenUnknown.add(text);
      console.log("[tenhou4-en] untranslated:", JSON.stringify(text));
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;

    if (root.nodeType === 1) {
      const tag = root.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return;
    }

    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    if (!doc) return;

    const walker = doc.createTreeWalker(root, 4, null);
    let n;
    while ((n = walker.nextNode())) translateTextNode(n);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") {
        translateTextNode(m.target);
      } else {
        for (const n of m.addedNodes) walk(n);
      }
    }
  });

  function start() {
    walk(document.documentElement);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  settingListeners.push((keys) => {
    if (keys.indexOf("custom") >= 0) applyCustom(settings.custom);
    if (keys.indexOf("custom") >= 0 || keys.indexOf("translate") >= 0) {
      restoreOriginals();
      if (settings.translate) walk(document.documentElement);
    }
  });

  // ------------------------------------------------------------- tile labels
  //
  // How it works (derived from latest.js):
  //   * Every tile sprite is a record in an "obj0".."obj3" .dat file, keyed by
  //       key = sheet | slot<<8 | face<<16 | seat<<24
  //     sheet: 116 hand, 121 wall, 107 discards, 110 melds/dora/etc.
  //     face : 0 red 5m, 1-9 man, 10 red 5p, 11-19 pin, 20 red 5s, 21-29 sou,
  //            30-33 E S W N, 34 white, 35 green, 36 red dragon, 37 back.
  //   * Ac.zb() builds the pixels for one sprite: it inflates the blank base
  //     tile (face 34), inflates the face record (the artwork delta), then
  //     inflates the shadow record (face 38/39), and the caller immediately
  //     writes the ImageData to a per-slot canvas with putImageData().
  //     The canvas is re-decoded whenever its face changes, so painting on it
  //     once would be wiped.  Instead we watch the three inflates, remember
  //     which face was just decoded, and draw the label right after the
  //     matching putImageData().
  //   * The artwork rect inside the sprite is face.xy - base.xy, size face.wh.
  //
  // <tiles>
  const TILE_BASE_SCALE = 0.42; // font size relative to the smaller side of the face
  // Settings (enabled, pos, scale, dx, dy, opacity, text, honors, red, palette
  // and the "which tiles" switches) come from the shared store above.  New
  // sprites use whatever is set when they are decoded; sprites already on
  // screen keep their old label until the page is reloaded.

  const OBJ_STRUCT = {
    812278383: 103780, // obj0
    829055599: 3856, // obj1
    845832815: 103780, // obj2
    862610031: 3856, // obj3
  };
  const TILE_SHEETS = { 107: 1, 110: 1, 116: 1, 121: 1 };

  const tileStats = {
    zlibWrapped: false,
    putWrapped: false,
    buffers: 0,
    records: 0,
    rawInflates: 0,
    inflates: 0,
    jobs: 0,
    labeled: 0,
    sizeMismatch: 0,
    errors: 0,
  };

  // Per (sheet, slot, seat): the union of the artwork rects of all faces, so
  // every tile in a slot gets its label at the same spot.  One map per parsed
  // file: after a window resize the client reloads the sprites at another
  // resolution, and those coordinates must never mix with the old ones.
  // The blank base tiles and the printed faces come from different sprite
  // files, so a base-only decode (the white dragon has no printed face) must
  // look the union up in the face file.  Keep the few newest maps; a resize
  // pushes the new resolution last, and an old map must also pass the bounds
  // check in makeJob() to be used.
  const RECENT_GROUPS = [];
  function noteGroup(groups, rec) {
    const face = (rec.key >>> 16) & 255;
    if (face === 34 || face > 36 || rec.w <= 0 || rec.i <= 0) return;
    const gk = (rec.key & 0xff00ffff) >>> 0;
    let g = groups.get(gk);
    if (!g) {
      g = { u: { x0: rec.x, y0: rec.y, x1: rec.x + rec.w, y1: rec.y + rec.i } };
      groups.set(gk, g);
      return;
    }
    g.u.x0 = Math.min(g.u.x0, rec.x);
    g.u.y0 = Math.min(g.u.y0, rec.y);
    g.u.x1 = Math.max(g.u.x1, rec.x + rec.w);
    g.u.y1 = Math.max(g.u.y1, rec.y + rec.i);
  }

  // Same key normalisation as sc.kc(): sheet 110 slots are remapped.
  function normalizeKey(x) {
    const sheet = x & 255;
    let slot = (x >>> 8) & 255;
    if (sheet === 110) {
      if (slot >= 20 && slot < 38) slot = 40 + (slot % 20);
      else if (slot >= 40 && slot < 58) slot = 98 + (slot % 20);
      else if (slot >= 60 && slot < 78) slot = 120 + (slot % 20);
    }
    return (
      (sheet | (slot << 8) | (((x >>> 16) & 255) << 16) | (((x >>> 24) & 255) << 24)) >>> 0
    );
  }

  // Replica of the obj* branch of sc.kc().  Returns { byOffset: Map(dataOffset
  // -> record), groups } for tile sheets, or null when it is not an obj file.
  function parseObjBuffer(buf) {
    if (!buf || typeof buf.byteLength !== "number" || buf.byteLength < 28) return null;
    const dv = new DataView(buf);
    const magic = dv.getUint32(0, true);
    const structSize = OBJ_STRUCT[magic];
    if (!structSize || dv.getUint32(4, true) !== structSize) return null;

    let p = 12;
    if (magic === 829055599 || magic === 862610031) p += 12; // 3 floats
    const byOffset = new Map();
    const groups = new Map();
    const end = Math.min(structSize, buf.byteLength);
    for (let a = p; a + 4 <= end; a += 4) {
      const m = dv.getUint32(a, true);
      if (!m || m + 20 > buf.byteLength) continue;
      const key = normalizeKey(dv.getUint32(m + 8, true));
      if (!TILE_SHEETS[key & 255]) continue;
      const rec = {
        x: dv.getInt16(m, true),
        y: dv.getInt16(m + 2, true),
        w: dv.getInt16(m + 4, true),
        i: dv.getInt16(m + 6, true),
        key,
        dc: dv.getUint32(m + 16, true),
      };
      noteGroup(groups, rec);
      byOffset.set(m + 20, rec);
    }
    if (groups.size) {
      RECENT_GROUPS.push(groups);
      if (RECENT_GROUPS.length > 4) RECENT_GROUPS.shift();
    }
    tileStats.buffers++;
    tileStats.records += byOffset.size;
    return { byOffset, groups };
  }

  const BUF_TABLES = new WeakMap();
  let curSprite = null; // { base, face } for the sprite being decoded
  let pendingJob = null; // label waiting for the next putImageData()

  function makeJob(base, face, groups) {
    const faceId = (face.key >>> 16) & 255;
    if (faceId > 36) return null; // back / shadow variants get no label
    let rect = null;
    const gk = (face.key & 0xff00ffff) >>> 0;
    const maps = groups ? [groups] : [];
    for (let i = RECENT_GROUPS.length - 1; i >= 0; i--) {
      if (RECENT_GROUPS[i] !== groups) maps.push(RECENT_GROUPS[i]);
    }
    for (const gm of maps) {
      const grp = gm.get(gk);
      if (!grp) continue;
      const u = grp.u;
      const r = { x: u.x0 - base.x, y: u.y0 - base.y, w: u.x1 - u.x0, h: u.y1 - u.y0 };
      if (r.w > 0 && r.h > 0 && r.x >= -1 && r.y >= -1 && r.x + r.w <= base.w + 1 && r.y + r.h <= base.i + 1) {
        rect = r;
        break;
      }
    }
    if (!rect && face !== base) {
      rect = { x: face.x - base.x, y: face.y - base.y, w: face.w, h: face.i };
      if (rect.w <= 0 || rect.h <= 0 || rect.x < 0 || rect.y < 0) rect = null;
    }
    if (!rect) {
      // The white dragon has no artwork record: use the inner tile area.
      rect = { x: base.w * 0.14, y: base.i * 0.1, w: base.w * 0.72, h: base.i * 0.8 };
    }
    return {
      face: faceId,
      w: base.w,
      h: base.i,
      rect,
      sheet: face.key & 255,
      slot: (face.key >>> 8) & 255,
      seat: face.key >>> 24,
    };
  }

  function onInflate(u8) {
    if (!u8 || !u8.buffer) return;
    tileStats.rawInflates++;
    let tab = BUF_TABLES.get(u8.buffer);
    if (tab === undefined) {
      tab = parseObjBuffer(u8.buffer);
      BUF_TABLES.set(u8.buffer, tab);
    }
    if (!tab) return;
    const rec = tab.byOffset.get(u8.byteOffset);
    if (!rec) return;
    tileStats.inflates++;

    const face = (rec.key >>> 16) & 255;
    if (face === 38 || face === 39) {
      // Shadow record: always the last inflate of one sprite decode.
      pendingJob = curSprite ? makeJob(curSprite.base, curSprite.face, curSprite.groups) : null;
      if (pendingJob) tileStats.jobs++;
      curSprite = null;
    } else if (face === 34 || face === 37) {
      curSprite = { base: rec, face: rec, groups: tab.groups }; // a new decode starts at its base
    } else if (curSprite) {
      curSprite.face = rec;
      curSprite.groups = tab.groups; // the face file's resolution wins
    }
  }

  const PALETTES = {
    default: { m: "#b03a2e", p: "#1f618d", s: "#1e8449", z: "#6c3483", aka: "#c9a000", akaFg: "#000", fg: "#fff", outline: false },
    contrast: { m: "#e00000", p: "#0050e6", s: "#008a2e", z: "#8000c8", aka: "#ffd400", akaFg: "#000", fg: "#fff", outline: true },
    // Okabe-Ito colours: distinguishable with the common colour-blindness types.
    cb: { m: "#d55e00", p: "#0072b2", s: "#009e73", z: "#cc79a7", aka: "#f0e442", akaFg: "#000", fg: "#fff", outline: false },
  };

  function tileText(face) {
    const pal = PALETTES[settings.palette] || PALETTES.default;
    if (face >= 30 && face <= 36) {
      const names = settings.honors === "pfc" ? ["E", "S", "W", "N", "P", "F", "C"] : ["E", "S", "W", "N", "Wh", "Gr", "Rd"];
      return { text: names[face - 30], bg: pal.z, fg: pal.fg, outline: pal.outline };
    }
    const suit = face < 10 ? "m" : face < 20 ? "p" : "s";
    const n = face % 10;
    const tail = settings.text === "number" ? "" : suit;
    if (n === 0) return { text: (settings.red === "zero" ? "0" : "5") + tail, bg: pal.aka, fg: pal.akaFg, outline: false };
    return { text: n + tail, bg: pal[suit], fg: pal.fg, outline: pal.outline };
  }

  // The "which tiles" switches.  Sheets: 116 hand, 107 discards, 110 melds /
  // dora / result-screen tiles, 121 wall.
  function tileScopeAllowed(job) {
    switch (job.sheet) {
      case 116:
        return job.seat === 0 ? settings.showHand : settings.showOthers;
      case 107:
        return settings.showDiscards;
      case 110:
        return settings.showMelds;
      case 121:
        return settings.showWall;
      default:
        return true;
    }
  }

  function drawTileLabel(ctx, job) {
    const info = tileText(job.face);
    const r = job.rect;
    const fs = Math.max(8, Math.round(Math.min(r.w, r.h) * TILE_BASE_SCALE * settings.scale));
    ctx.save();
    ctx.font = "bold " + fs + "px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padX = Math.round(fs * 0.22);
    const padY = Math.round(fs * 0.12);
    const w = Math.ceil(ctx.measureText(info.text).width + padX * 2);
    const h = Math.ceil(fs + padY * 2);
    let x = (settings.pos === "c" ? r.x + (r.w - w) / 2 : r.x) + settings.dx * r.w;
    let y = (settings.pos === "c" ? r.y + (r.h - h) / 2 : r.y) + settings.dy * r.h;
    x = Math.max(0, Math.min(job.w - w, x));
    y = Math.max(0, Math.min(job.h - h, y));
    ctx.globalAlpha = settings.opacity;
    ctx.fillStyle = info.bg;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = Math.min(1, settings.opacity + 0.1);
    if (info.outline) {
      ctx.lineWidth = Math.max(2, fs * 0.16);
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.strokeText(info.text, x + padX, y + h / 2 + 0.5);
    }
    ctx.fillStyle = info.fg;
    ctx.fillText(info.text, x + padX, y + h / 2 + 0.5);
    ctx.restore();
  }

  function wrapZlib(Z) {
    if (!Z || typeof Z.Inflate !== "function" || Z.Inflate.__t4en) return Z;
    const Orig = Z.Inflate;
    const Wrapped = function (input, opts) {
      try {
        onInflate(input);
      } catch (e) {
        tileStats.errors++;
      }
      return new Orig(input, opts);
    };
    Wrapped.prototype = Orig.prototype;
    for (const k of Object.keys(Orig)) Wrapped[k] = Orig[k];
    Wrapped.__t4en = true;
    Z.Inflate = Wrapped;
    tileStats.zlibWrapped = true;
    return Z;
  }

  // If Tenhou ships a new client the sprite files may change shape.  Say so
  // once, instead of leaving the user with silently missing labels.
  function tileHealthMessage() {
    if (!settings.enabled) return "";
    if (!tileStats.zlibWrapped) return "Zlib was not found, so tile labels cannot work.";
    if (!tileStats.putWrapped) return "putImageData could not be hooked.";
    if (tileStats.rawInflates > 20 && tileStats.buffers === 0) {
      return "sprite files were not recognised (Tenhou may have updated its client).";
    }
    if (tileStats.inflates > 0 && tileStats.labeled === 0) {
      return "tiles were decoded but no label was drawn (" + JSON.stringify(tileStats) + ").";
    }
    return "";
  }

  function installTileHooks() {
    if (String(location.pathname).indexOf("/4/") !== 0) return;

    const proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (proto && typeof proto.putImageData === "function" && !proto.putImageData.__t4en) {
      const nativePut = proto.putImageData;
      const put = function (img) {
        const r = nativePut.apply(this, arguments);
        const job = pendingJob;
        if (job) {
          pendingJob = null;
          try {
            if (!settings.enabled || !tileScopeAllowed(job)) {
              /* labels off, or not wanted on this kind of tile */
            } else if (img && img.width === job.w && img.height === job.h) {
              drawTileLabel(this, job);
              tileStats.labeled++;
            } else {
              tileStats.sizeMismatch++;
            }
          } catch (e) {
            tileStats.errors++;
          }
        }
        return r;
      };
      put.__t4en = true;
      proto.putImageData = put;
      tileStats.putWrapped = true;
    }

    // Wrap Zlib.Inflate as soon as the page defines Zlib.
    let zlib = window.Zlib;
    try {
      Object.defineProperty(window, "Zlib", {
        configurable: true,
        enumerable: true,
        get() {
          return zlib;
        },
        set(v) {
          zlib = wrapZlib(v);
        },
      });
    } catch (e) {
      /* fall back to polling below */
    }
    if (zlib) zlib = wrapZlib(zlib);

    let warned = false;
    let healthRuns = 0;
    const healthTimer = setInterval(() => {
      const msg = tileHealthMessage();
      if (msg && !warned) {
        warned = true;
        console.warn(
          "[tenhou4-en] Tile labels are not working: " + msg +
          "  Run __tenhou4en.tiles.stats() and report the output."
        );
      }
      if (warned || tileStats.labeled > 5 || ++healthRuns >= 10) clearInterval(healthTimer);
    }, 30000);
    if (healthTimer && typeof healthTimer.unref === "function") healthTimer.unref();

    let tries = 0;
    const timer = setInterval(() => {
      if (window.Zlib && window.Zlib.Inflate && !window.Zlib.Inflate.__t4en) wrapZlib(window.Zlib);
      if (tileStats.zlibWrapped || ++tries > 600) clearInterval(timer);
    }, 100);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  const tilesApi = {
    install: installTileHooks,
    stats() {
      const tile = {};
      for (const k of TILE_KEYS) tile[k] = settings[k];
      return Object.assign(tile, tileStats);
    },
    getConfig() {
      return Object.assign({}, settings);
    },
    setConfig: setSettings,
    resetConfig() {
      return resetSettings(TILE_KEYS);
    },
    setEnabled(on) {
      setSettings({ enabled: on });
      console.log("[tenhou4-en] tile labels " + (on ? "on" : "off") + " (new tiles; reload to update all)");
    },
    setPosition(pos) {
      setSettings({ pos });
      console.log("[tenhou4-en] tile label position set (new tiles; reload to update all)");
    },
    setOffset(dx, dy) {
      setSettings({ dx, dy });
      console.log("[tenhou4-en] tile label offset set (new tiles; reload to update all)");
    },
    setScale(scale) {
      setSettings({ scale });
      console.log("[tenhou4-en] tile label size set (new tiles; reload to update all)");
    },
    _test: { normalizeKey, parseObjBuffer, onInflate, wrapZlib, makeJob, tileText, tileHealthMessage, tileScopeAllowed },
  };
  // </tiles>

  tilesApi.install();

  // ------------------------------------------------------------ update check
  //
  // Userscript managers update this script by themselves (see @updateURL in
  // the header).  This is only for the "Check for updates" button in the
  // panel: it reads the @version line of the published script and compares
  // it with VERSION.  It runs only when the button is clicked, and the text it
  // downloads is never executed - only the version number is read from it.
  //
  // <update>
  const REPO_URL = "https://github.com/izicoder/tenhou4-english";
  const UPDATE_URL = "https://raw.githubusercontent.com/izicoder/tenhou4-english/master/tenhou4-english.user.js";

  function parseScriptVersion(text) {
    const m = /\/\/\s*@version\s+(\d+(?:\.\d+)*)/.exec(String(text).slice(0, 4000));
    return m ? m[1] : null;
  }

  // 1 if a is newer than b, -1 if older, 0 if equal ("0.10.0" > "0.9.0").
  function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  async function checkForUpdate(current, fetchImpl) {
    try {
      const res = await (fetchImpl || fetch)(UPDATE_URL, { cache: "no-store" });
      if (!res.ok) return { state: "error", error: "GitHub answered " + res.status + "." };
      const latest = parseScriptVersion(await res.text());
      if (!latest) return { state: "error", error: "Could not read a version number from GitHub." };
      const c = compareVersions(latest, current);
      return { state: c > 0 ? "available" : c < 0 ? "newer" : "latest", latest };
    } catch (e) {
      return { state: "error", error: "Could not reach GitHub." };
    }
  }

  function describeUpdate(r, current) {
    if (r.state === "latest") return { text: "You are up to date (v" + current + ").", warn: false };
    if (r.state === "newer") {
      return { text: "This copy (v" + current + ") is newer than the one on GitHub (v" + r.latest + ").", warn: false };
    }
    if (r.state === "available") {
      return {
        text:
          "Version " + r.latest + " is available (you have " + current + "). Your userscript manager normally " +
          "installs it by itself; to update right now, open the install link.",
        warn: true,
        link: UPDATE_URL,
        linkText: "Install v" + r.latest,
      };
    }
    return { text: (r.error || "Update check failed.") + " You can also use your userscript manager's own update check.", warn: true };
  }
  // </update>

  // ---------------------------------------------------------- settings panel
  //
  // A small gear button opens a panel with every option, so nothing needs the
  // console.  Also opens with Alt+T (the key is a setting).  It lives in a
  // shadow root, so the page's global CSS (INPUT, BUTTON, LABEL ... rules)
  // cannot restyle it, and the game's own mouse/touch/key handlers never see
  // events from inside it - otherwise a click on the panel could be taken for
  // a click on the tile underneath.
  //
  // <settings>
  const SETTINGS_CSS = `
    :host { all: initial; }
    /* Page styles (e.g. "* { line-height: 1 }") reach the host and are inherited,
       so everything inherited is reset here, on the wrapper. */
    .ui { all: initial; display: flex; flex-direction: column; align-items: flex-start;
      font: 13px/1.35 system-ui, "Segoe UI", Roboto, sans-serif; color: #e8e8ee; text-align: left; }
    .ui.bottom { flex-direction: column-reverse; }
    .ui.right { align-items: flex-end; }
    *, *::before, *::after { box-sizing: border-box; }
    .fab { width: 34px; height: 34px; padding: 0; border-radius: 50%; border: 1px solid #666; flex: none;
      background: rgba(10,10,14,.6); color: #fff; font-size: 17px; line-height: 1; cursor: pointer; opacity: .5; }
    .fab:hover, .fab.on, .fab:focus-visible { opacity: 1; background: rgba(30,30,40,.92); }
    .ui.fade .fab:not(:hover):not(.on):not(:focus-visible) { opacity: 0; }
    .panel { display: none; margin: 6px 0; width: 340px; max-width: calc(100vw - 16px);
      max-height: calc(100vh - 56px); overflow-y: auto;
      background: rgba(14,14,20,.97); border: 1px solid #4a4a58; border-radius: 10px;
      padding: 10px 12px 12px; box-shadow: 0 8px 28px rgba(0,0,0,.6); }
    .panel.open { display: block; }
    h1 { margin: 0 0 8px; font-size: 14px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
    h1 small { font-weight: 400; color: #9a9aa8; margin-left: 6px; }
    h2 { margin: 12px 0 5px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #9a9aa8; }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; border-bottom: 1px solid #3a3a48; }
    .tab { flex: 1; background: none; border: none; border-bottom: 2px solid transparent; color: #9a9aa8;
      padding: 6px 4px; cursor: pointer; font: inherit; }
    .tab:hover { color: #fff; }
    .tab.on { color: #fff; border-bottom-color: #4aa3ff; font-weight: 600; }
    .page { display: none; }
    .page.on { display: block; }
    .off { opacity: .4; pointer-events: none; }
    .chk { display: flex; align-items: flex-start; gap: 8px; margin: 5px 0; cursor: pointer; color: #dcdce4; }
    .chk.big { font-weight: 600; font-size: 14px; }
    .toprow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    button.b.small { flex: none; padding: 2px 9px; font-size: 12px; }
    .chk input { margin-top: 2px; }
    .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .lab { flex: 0 0 86px; color: #cfcfd8; }
    .ctl { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
    input[type=range] { flex: 1; min-width: 0; accent-color: #4aa3ff; }
    .val { flex: 0 0 42px; text-align: right; color: #9a9aa8; font-variant-numeric: tabular-nums; }
    select, input[type=text] { background: #22222c; color: #eee; border: 1px solid #555; border-radius: 5px;
      padding: 3px 6px; font: inherit; min-width: 0; }
    select { flex: 1; }
    input[type=text] { width: 42px; text-align: center; }
    input[type=checkbox] { width: 16px; height: 16px; accent-color: #4aa3ff; flex: none; }
    .preview { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 10px 0 2px; color: #9a9aa8; font-size: 11.5px; }
    .chip { display: inline-block; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 12px; }
    .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    button.b { flex: 1 1 auto; background: #2a2a36; color: #eee; border: 1px solid #55556a; border-radius: 6px;
      padding: 6px 8px; cursor: pointer; font: inherit; }
    button.b:hover { background: #38384a; }
    button.b.warn { border-color: #b8860b; color: #ffd479; }
    button.x { background: none; border: none; color: #aaa; font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1; }
    button.x:hover { color: #fff; }
    .status { margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: #1c2a1f; color: #b9e0bd; font-size: 12px; word-break: break-word; }
    .status.warn { color: #ffd479; background: #3a2e12; }
    .reload { display: none; position: sticky; bottom: 0; margin-top: 10px; padding: 6px 8px; border-radius: 6px; background: #1c2538; color: #b9d2f5;
      border: 1px solid #2f4468;
      font-size: 12px; align-items: center; gap: 8px; justify-content: space-between; }
    .reload.show { display: flex; }
    .hint { margin-top: 6px; color: #8a8a98; font-size: 11.5px; }
    .muted { color: #8a8a98; font-size: 11.5px; }
    kbd { background: #2a2a36; border: 1px solid #55556a; border-radius: 4px; padding: 0 5px; font: inherit; }
    textarea { display: block; width: 100%; margin-top: 6px; background: #101018; color: #ddd;
      border: 1px solid #444; border-radius: 6px; padding: 5px 6px; font: 12px/1.35 ui-monospace, Consolas, monospace; resize: vertical; }
    textarea[hidden], .status[hidden] { display: none; }
    a { color: #7cc0ff; }
  `;

  const SETTINGS_HTML = `
    <div class="ui" id="ui">
      <button class="fab" title="Tenhou English settings">&#9881;</button>
      <div class="panel" id="panel">
        <h1><span>Tenhou English<small id="ver"></small></span><button class="x" data-act="close" title="Close">&times;</button></h1>
        <div class="tabs">
          <button class="tab on" data-tab="tiles">Tiles</button>
          <button class="tab" data-tab="tr">Translation</button>
          <button class="tab" data-tab="panel">Panel &amp; data</button>
        </div>

        <div class="page on" data-page="tiles">
          <div class="toprow">
            <label class="chk big"><input type="checkbox" data-key="enabled"> Show tile labels</label>
            <button class="b small" data-act="reset-tiles" title="Put every tile setting back to its default">Reset</button>
          </div>
          <div class="status" id="status"></div>
          <div id="tiledep">
            <div class="preview" id="preview"></div>
            <h2>Which tiles</h2>
            <label class="chk"><input type="checkbox" data-key="showHand"> My hand</label>
            <label class="chk"><input type="checkbox" data-key="showDiscards"> Discards (all players)</label>
            <label class="chk"><input type="checkbox" data-key="showMelds"> Melds, dora and result screen</label>
            <label class="chk"><input type="checkbox" data-key="showWall"> Wall and revealed dora</label>
            <label class="chk"><input type="checkbox" data-key="showOthers"> Other players' hands (when shown)</label>
            <h2>Look</h2>
            <div class="row"><span class="lab">Position</span><div class="ctl">
              <select data-key="pos"><option value="tl">Top-left corner</option><option value="c">Centre of tile</option></select></div></div>
            <div class="row"><span class="lab">Size</span><div class="ctl">
              <input type="range" data-key="scale" data-mul="100" min="50" max="200" step="5">
              <span class="val" data-val="scale" data-mul="100" data-suffix="%"></span></div></div>
            <div class="row"><span class="lab">Left / right</span><div class="ctl">
              <input type="range" data-key="dx" data-mul="100" min="-30" max="30" step="1">
              <span class="val" data-val="dx" data-mul="100" data-suffix="%"></span></div></div>
            <div class="row"><span class="lab">Up / down</span><div class="ctl">
              <input type="range" data-key="dy" data-mul="100" min="-30" max="30" step="1">
              <span class="val" data-val="dy" data-mul="100" data-suffix="%"></span></div></div>
            <div class="row"><span class="lab">Opacity</span><div class="ctl">
              <input type="range" data-key="opacity" data-mul="100" min="30" max="100" step="5">
              <span class="val" data-val="opacity" data-mul="100" data-suffix="%"></span></div></div>
            <div class="row"><span class="lab">Text</span><div class="ctl">
              <select data-key="text"><option value="full">Number + suit (3m)</option><option value="number">Number only (3)</option></select></div></div>
            <div class="row"><span class="lab">Honors</span><div class="ctl">
              <select data-key="honors"><option value="wh">E S W N Wh Gr Rd</option><option value="pfc">E S W N P F C</option></select></div></div>
            <div class="row"><span class="lab">Red fives</span><div class="ctl">
              <select data-key="red"><option value="five">5m (gold chip)</option><option value="zero">0m (gold chip)</option></select></div></div>
            <div class="row"><span class="lab">Colours</span><div class="ctl">
              <select data-key="palette"><option value="default">Standard</option><option value="contrast">High contrast</option><option value="cb">Colour-blind friendly</option></select></div></div>
          </div>
        </div>

        <div class="page" data-page="tr">
          <label class="chk"><input type="checkbox" data-key="translate"><span>Translate hard-coded Japanese<br><span class="muted">yaku, ranks, rooms, counters, dialogs</span></span></label>
          <label class="chk"><input type="checkbox" data-key="fillTable"><span>Fix gaps in the game's English text table <span class="muted">(needs reload)</span></span></label>
          <label class="chk"><input type="checkbox" data-key="forceEn"><span>Force the game language to English <span class="muted">(needs reload)</span></span></label>
          <label class="chk"><input type="checkbox" data-key="debug"><span>Log untranslated text to the browser console</span></label>
          <h2>Find untranslated text</h2>
          <div class="btns" style="margin-top:2px">
            <button class="b" data-act="scan">Scan this screen</button>
            <button class="b" data-act="copyscan">Copy result</button>
          </div>
          <textarea id="scanout" rows="5" readonly hidden></textarea>
          <h2>My own translations</h2>
          <div class="muted">One per line, as <b>日本語 = English</b>. Lines starting with # are ignored. They win over the built-in ones.</div>
          <textarea id="custom" rows="6" spellcheck="false" placeholder="役満 = Yakuman&#10;# my notes"></textarea>
          <div class="btns" style="margin-top:6px"><button class="b" data-act="savecustom">Save my translations</button></div>
          <div class="hint" id="customstat"></div>
        </div>

        <div class="page" data-page="panel">
          <h2>Gear button</h2>
          <div class="row"><span class="lab">Corner</span><div class="ctl">
            <select data-key="buttonPos"><option value="tl">Top-left</option><option value="tr">Top-right</option>
              <option value="bl">Bottom-left</option><option value="br">Bottom-right</option></select></div></div>
          <label class="chk"><input type="checkbox" data-key="buttonHidden"> Fade the button out until the mouse is over it</label>
          <div class="row"><span class="lab">Shortcut</span><div class="ctl"><kbd>Alt</kbd> + <input type="text" data-key="hotkey" maxlength="1" spellcheck="false"></div></div>
          <h2>Backup</h2>
          <div class="muted">Export copies your settings. To import, paste them below and press Import.</div>
          <textarea id="io" rows="4" spellcheck="false" placeholder="{ ... }"></textarea>
          <div class="btns">
            <button class="b" data-act="export">Export</button>
            <button class="b" data-act="import">Import</button>
          </div>
          <h2>Help</h2>
          <div class="btns" style="margin-top:2px">
            <button class="b" data-act="report">Copy bug report</button>
            <button class="b warn" data-act="reset-all">Reset all settings</button>
          </div>
          <h2>About &amp; updates</h2>
          <div class="muted"><span id="aboutver"></span> &middot; <a id="repolink" target="_blank" rel="noopener">GitHub page</a> &middot; <a id="buglink" target="_blank" rel="noopener">Report a problem</a></div>
          <div class="btns" style="margin-top:6px"><button class="b" data-act="update">Check for updates</button></div>
          <div class="status" id="updatestat" hidden></div>
          <div class="hint">Your userscript manager also keeps this script up to date by itself. This button contacts GitHub only when you click it.</div>
        </div>

        <div class="reload" id="reload"><span>Some changes need a reload. Tiles already on screen keep their old look until then.</span>
          <button class="b" data-act="reload" style="flex:none">Reload now</button></div>
      </div>
    </div>`;

  // Japanese still on screen, minus player names and score lines.
  function untranslatedOnScreen() {
    const api = window.__tenhou4en;
    return (api && api.scan ? api.scan() : []).filter((t) => !PLAYER_NAMES.has(t) && !PLAYER_SCORE_LINE_RE.test(t));
  }

  // Text for a bug report: versions, settings, counters and the Japanese still
  // on screen.  Player names and score lines are left out.
  function buildReport() {
    const left = untranslatedOnScreen().slice(0, 60);
    const warn = tileHealthMessage();
    const cfg = Object.assign({}, settings);
    const customCount = parseCustom(cfg.custom).entries.size;
    delete cfg.custom;
    return [
      "Tenhou /4 English v" + VERSION,
      "Browser: " + navigator.userAgent,
      "Page: " + location.origin + location.pathname,
      "Settings: " + JSON.stringify(cfg),
      "Custom translations: " + customCount,
      "Tile stats: " + JSON.stringify(tileStats),
      "Tile warning: " + (warn || "none"),
      "Untranslated Japanese on screen (" + left.length + "):",
    ]
      .concat(left.map((t) => "  " + JSON.stringify(t)))
      .join("\n");
  }

  const RELOAD_KEYS = new Set(TILE_KEYS.concat(["forceEn", "fillTable"]));

  function installSettingsUI() {
    if (String(location.pathname).indexOf("/4/") !== 0) return null;
    const ui = { open() { }, close() { }, toggle() { }, buildReport, host: null };

    const mount = () => {
      if (!document.body || document.getElementById("tenhou4en-settings")) return;
      const host = document.createElement("div");
      host.id = "tenhou4en-settings";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + SETTINGS_CSS + "</style>" + SETTINGS_HTML;
      const $ = (id) => root.getElementById(id);
      ui.host = host;

      // Keep every pointer / touch / key event inside the panel away from the
      // game's window-level handlers.
      for (const ev of [
        "mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu",
        "pointerdown", "pointerup", "pointermove", "touchstart", "touchend", "touchmove",
        "keydown", "keyup", "wheel",
      ]) {
        host.addEventListener(ev, (e) => e.stopPropagation());
      }
      // The game also listens for wheel in the capture phase on document.
      window.addEventListener(
        "wheel",
        (e) => {
          if (e.composedPath && e.composedPath().indexOf(host) >= 0) e.stopImmediatePropagation();
        },
        true
      );

      $("ver").textContent = "v" + VERSION;
      $("aboutver").textContent = "Version " + VERSION;
      $("repolink").href = REPO_URL;
      $("buglink").href = REPO_URL + "/issues";
      const panel = $("panel");
      const fab = root.querySelector(".fab");
      let timer = null;
      let flashUntil = 0;
      let needsReload = false;
      let resetArmed = 0;

      // ---------- drawing the current state
      const renderPreview = () => {
        const box = $("preview");
        box.textContent = "";
        box.appendChild(document.createTextNode("Preview:"));
        for (const f of [1, 11, 21, 30, 34, 0]) {
          const t = tileText(f);
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = t.text;
          chip.style.background = t.bg;
          chip.style.color = t.fg;
          if (t.outline) chip.style.textShadow = "0 0 2px #000, 0 0 2px #000";
          box.appendChild(chip);
        }
      };

      const renderStatus = () => {
        if (Date.now() < flashUntil) return;
        const st = $("status");
        const warn = tileHealthMessage();
        st.className = "status";
        if (!settings.enabled) st.textContent = "Tile labels are off.";
        else if (warn) {
          st.className = "status warn";
          st.textContent = "Tile labels are not working: " + warn;
        } else if (tileStats.labeled > 0) st.textContent = "Tile labels are working (" + tileStats.labeled + " tile images labelled).";
        else st.textContent = "Waiting for a game to start...";
      };

      const renderCustomStat = () => {
        const r = parseCustom(settings.custom);
        const el = $("customstat");
        el.textContent =
          r.entries.size + " of your translation" + (r.entries.size === 1 ? "" : "s") + " active" +
          (r.errors.length ? ". Ignored: " + r.errors.slice(0, 3).join("; ") + (r.errors.length > 3 ? "; ..." : "") : ".");
      };

      const applyChrome = () => {
        const pos = settings.buttonPos;
        const bottom = pos[0] === "b";
        const right = pos[1] === "r";
        host.style.cssText =
          "all:initial;position:fixed;z-index:2147483000;display:block;" +
          (bottom ? "bottom:8px;" : "top:8px;") + (right ? "right:8px;" : "left:8px;");
        const ui_ = $("ui");
        ui_.classList.toggle("bottom", bottom);
        ui_.classList.toggle("right", right);
        ui_.classList.toggle("fade", settings.buttonHidden);
        $("reload").classList.toggle("show", needsReload);
      };

      const render = () => {
        root.querySelectorAll("[data-key]").forEach((el) => {
          const key = el.getAttribute("data-key");
          const v = settings[key];
          if (el.type === "checkbox") el.checked = !!v;
          else if (el.type === "range") el.value = Math.round(v * Number(el.getAttribute("data-mul") || 1));
          else el.value = String(v);
        });
        root.querySelectorAll("[data-val]").forEach((el) => {
          const mul = Number(el.getAttribute("data-mul") || 1);
          el.textContent = Math.round(settings[el.getAttribute("data-val")] * mul) + (el.getAttribute("data-suffix") || "");
        });
        $("tiledep").classList.toggle("off", !settings.enabled);
        renderPreview();
        renderStatus();
        renderCustomStat();
        applyChrome();
      };

      const flash = (text, warn) => {
        const st = $("status");
        st.className = "status" + (warn ? " warn" : "");
        st.textContent = text;
        flashUntil = Date.now() + 3500;
        setTimeout(renderStatus, 3600);
      };

      // ---------- opening, closing, tabs
      const showTab = (name) => {
        root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.getAttribute("data-tab") === name));
        root.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.getAttribute("data-page") === name));
        if (name === "tiles") renderStatus();
      };
      const setOpen = (want) => {
        panel.classList.toggle("open", want);
        fab.classList.toggle("on", want);
        clearInterval(timer);
        if (want) {
          $("custom").value = settings.custom;
          render();
          timer = setInterval(renderStatus, 1000);
        }
      };
      ui.open = () => setOpen(true);
      ui.close = () => setOpen(false);
      ui.toggle = () => setOpen(!panel.classList.contains("open"));
      ui.showTab = showTab;

      // ---------- clipboard
      const copyText = async (text, area) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (e) {
          /* fall through to the manual route */
        }
        try {
          const ta = area || $("scanout");
          ta.hidden = false;
          ta.value = text;
          ta.focus();
          ta.select();
          return document.execCommand("copy");
        } catch (e) {
          return false;
        }
      };

      fab.addEventListener("click", ui.toggle);

      // ---------- controls bound to settings
      root.querySelectorAll("[data-key]").forEach((el) => {
        const key = el.getAttribute("data-key");
        if (el.type === "checkbox") el.addEventListener("change", () => setSettings({ [key]: el.checked }));
        else if (el.type === "range") {
          el.addEventListener("input", () => setSettings({ [key]: Number(el.value) / Number(el.getAttribute("data-mul") || 1) }));
        } else el.addEventListener("change", () => setSettings({ [key]: el.value }));
      });

      settingListeners.push((keys) => {
        if (keys.some((k) => RELOAD_KEYS.has(k))) needsReload = true;
        render();
      });

      // ---------- buttons
      root.addEventListener("click", async (e) => {
        const tab = e.target.closest && e.target.closest("[data-tab]");
        if (tab) return showTab(tab.getAttribute("data-tab"));
        const btn = e.target.closest && e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");

        if (act !== "reset-all") {
          resetArmed = 0;
          const b = root.querySelector('[data-act="reset-all"]');
          if (b) b.textContent = "Reset all settings";
        }

        if (act === "close") ui.close();
        else if (act === "reload") location.reload();
        else if (act === "reset-tiles") {
          resetSettings(TILE_KEYS);
          flash("Tile settings reset.");
        } else if (act === "reset-all") {
          if (Date.now() > resetArmed) {
            resetArmed = Date.now() + 3000;
            btn.textContent = "Click again to confirm";
            setTimeout(() => {
              if (Date.now() >= resetArmed) btn.textContent = "Reset all settings";
            }, 3100);
          } else {
            resetArmed = 0;
            btn.textContent = "Reset all settings";
            resetSettings();
            $("custom").value = settings.custom;
            flash("All settings reset.");
          }
        } else if (act === "scan") {
          const left = untranslatedOnScreen();
          const out = $("scanout");
          out.hidden = false;
          out.value = left.length ? left.join("\n") : "Nothing untranslated on this screen.";
        } else if (act === "copyscan") {
          const left = untranslatedOnScreen();
          const ok = await copyText(left.length ? left.join("\n") : "(nothing untranslated)", $("scanout"));
          flash(ok ? "Copied." : "Could not copy - select the text and copy it.", !ok);
        } else if (act === "savecustom") {
          setSettings({ custom: $("custom").value });
          renderCustomStat();
          const r = parseCustom(settings.custom);
          flash("Saved. " + r.entries.size + " translation" + (r.entries.size === 1 ? "" : "s") + " active.");
        } else if (act === "export") {
          const text = exportSettings();
          const io = $("io");
          io.value = text;
          const ok = await copyText(text, io);
          flash(ok ? "Settings copied." : "Could not copy - select the text and copy it.", !ok);
        } else if (act === "import") {
          const r = importSettings($("io").value);
          $("custom").value = settings.custom;
          flash(r.ok ? "Imported " + r.count + " settings." : r.error, !r.ok);
        } else if (act === "update") {
          const out = $("updatestat");
          out.hidden = false;
          out.className = "status";
          out.textContent = "Checking GitHub...";
          const d = describeUpdate(await checkForUpdate(VERSION), VERSION);
          out.className = "status" + (d.warn ? " warn" : "");
          out.textContent = d.text;
          if (d.link) {
            out.appendChild(document.createTextNode(" "));
            const a = document.createElement("a");
            a.href = d.link;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = d.linkText;
            out.appendChild(a);
          }
        } else if (act === "report") {
          const ok = await copyText(buildReport(), $("scanout"));
          flash(ok ? "Copied. Paste it into your bug report." : "Could not copy - select the text and copy it.", !ok);
        }
      });
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape") ui.close();
      });

      render();
      document.body.appendChild(host);
    };

    // Capture phase: must run even when focus is still inside the panel, whose
    // host swallows key events before they bubble to the window.
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === settings.hotkey) {
          e.preventDefault();
          ui.toggle();
        }
      },
      true
    );

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
    return ui;
  }
  // </settings>
  const settingsUi = installSettingsUI();

  // --------------------------------------------------------------- debugging

  window.__tenhou4en = {
    version: VERSION,
    playerNames: () => [...PLAYER_NAMES],
    tiles: tilesApi,
    ui: settingsUi,
    settings: {
      get: () => Object.assign({}, settings),
      set: setSettings,
      reset: resetSettings,
      export: exportSettings,
      import: importSettings,
    },
    yaku: YAKU,
    ranks: RANKS,
    misc: MISC,
    overrides: TABLE_OVERRIDES,
    patchTable,
    translateString,
    translateTextNode,
    translateContext,
    translateNoppContainer,
    translateResultSeat,
    rankWords,
    translateRoundParent,
    translateSplitCounter,
    walk,
    add(ja, en) {
      EXACT[ja] = en;
      walk(document.body);
    },
    scan() {
      const found = new Set();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (t && /[\u3040-\u30ff\u4e00-\u9fff]/.test(t)) found.add(t);
      }
      return [...found];
    },
  };

  console.log(
    "%c[tenhou4-en] v" + VERSION + " loaded - English UI + tile labels",
    "color:#0a0;font-weight:bold"
  );
})();