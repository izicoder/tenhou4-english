// ==UserScript==
// @name         Tenhou /4 English (full)
// @name:ja      天鳳 /4 英語化
// @namespace    https://github.com/local/tenhou4-english
// @version      0.1.0
// @description  Completes the English UI on tenhou.net/4 (Desktop4K) and translates the Japanese the official EN option leaves behind.
// @author       you
// @match        https://tenhou.net/4/*
// @match        https://tenhou.net/4/
// @run-at       document-start
// @grant        none
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
 */

(function () {
  "use strict";

  if (window.__tenhou4enInstalled) return;
  window.__tenhou4enInstalled = true;

  const DEBUG =
    /[?&]tenhou_en_debug=1\b/.test(location.search) ||
    (() => {
      try {
        return localStorage.getItem("tenhou4enDebug") === "1";
      } catch (e) {
        return false;
      }
    })();

  // ---------------------------------------------------------------- language

  // Must happen before latest.js reads it.  "en" and "EN" both resolve to en.
  try {
    localStorage.setItem("lang", "en");
  } catch (e) {
    /* private mode etc. */
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
  };

  const EXACT = Object.assign({}, MISC, RANKS, YAKU);

  const WIND = { 東: "East", 南: "South", 西: "West", 北: "North" };

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
    // 供託 / ドラ etc. handled by EXACT.
  ];

  function translateString(text) {
    const direct = EXACT[text];
    if (direct != null) return direct;

    for (const [re, fn] of RULES) {
      const m = re.exec(text);
      if (m) return fn(m);
    }
    return null;
  }

  const seenUnknown = new Set();

  function translateTextNode(node) {
    const raw = node.nodeValue;
    if (!raw) return;

    const text = raw.trim();
    if (!text) return;

    const out = translateString(text);
    if (out != null) {
      if (out === text) return;
      const i = raw.indexOf(text);
      node.nodeValue = raw.slice(0, i) + out + raw.slice(i + text.length);
      return;
    }

    if (DEBUG && /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) && !seenUnknown.has(text)) {
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

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
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

  // --------------------------------------------------------------- debugging

  window.__tenhou4en = {
    yaku: YAKU,
    ranks: RANKS,
    misc: MISC,
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
})();
