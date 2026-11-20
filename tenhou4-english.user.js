// ==UserScript==
// @name         Tenhou /4 English (full)
// @name:ja      天鳳 /4 英語化
// @namespace    https://github.com/local/tenhou4-english
// @version      0.5.2
// @description  Completes the English UI on tenhou.net/4 (Desktop4K), translates the Japanese the official EN option leaves behind, and labels every face-up tile (1m 5p E Wh Gr Rd ...).
// @author       you
// @match        https://tenhou.net/4/*
// @match        https://tenhou.net/4/
// @match        https://tenhou.net/man/*
// @match        https://tenhou.net/man/
// @match        https://tenhou.net/reg/*
// @match        https://tenhou.net/reg/
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

  const VERSION = "0.5.2";
  if (window.__tenhou4enInstalled) {
    console.warn(
      "[tenhou4-en] v" + VERSION + " not started: another copy of this script is " +
      "already running.  Disable the duplicate userscript and reload."
    );
    return;
  }
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
    // /reg/ paid-membership page.
    "有料版有効期限の購入": "Purchase Paid Membership",
    "有料会員にのみ提供されているサービス(Windows版天鳳/鳳凰卓での対戦/有料の大会への参加/有料のトレーニングコンテンツ)を利用するには、 １つのプレーヤIDにつき「25日で550円」または「22日500円」の利用料金をお支払いいただく必要があります。 数か月分まとめてお支払いいただくこともできます。 お支払いには以下の決済サービスがご利用いただけます。":
      'To use services available only to paid members (Windows Tenhou / Phoenix table matches / paid tournament entry / paid training content), you must pay a usage fee of "550 yen for 25 days" or "500 yen for 22 days" per player ID. You can pay for several months at once. The following payment services are accepted.',
    "- クレジットカード(VISA/MasterCard/JCB/AmericanExpress/Diners/Discover)":
      "- Credit card (VISA/MasterCard/JCB/AmericanExpress/Diners/Discover)",
    "- ドコモケータイ払い": "- Docomo Mobile Payment",
    "- au かんたん決済／au WALLET": "- au Simple Payment / au WALLET",
    "- WebMoney(コンビニ他/カード/銀行振り込み)":
      "- WebMoney (convenience store / card / bank transfer)",
    "- BitCash(コンビニ他/カード/銀行振り込み)":
      "- BitCash (convenience store / card / bank transfer)",
    "- NetCash(コンビニ他/カード/銀行振り込み)":
      "- NetCash (convenience store / card / bank transfer)",
    "プレーヤIDの３文字目から'-'までの８文字を正確に入力してください。":
      "Enter the 8 characters from the 3rd character of your Player ID up to the '-'.",
    "-abcdefgh」の「00112233」に対応する部分":
      'the "00112233" part of "ID00112233-abcdefgh"',
    "※アルファベットの部分は大文字で入力してください":
      "* Enter the alphabetical part in uppercase.",
    "お問い合わせ": "Contact",
    "特定商取引に関する法律に基づく表記":
      "Notation under the Act on Specified Commercial Transactions",
  };

  const EXACT = Object.assign({}, MISC, RANKS, YAKU);

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

  function setNodeValue(node, value) {
    if (!ORIGINALS.has(node)) ORIGINALS.set(node, node.nodeValue);
    if (node.nodeValue !== value) node.nodeValue = value;
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
      node.nodeValue = raw.slice(0, i) + out + raw.slice(i + text.length);
      return true;
    }
    return false;
  }

  const PLAYER_SCORE_LINE_RE = /^[A-D]:.*\([+-]?\d+(?:\.\d)?\)$/;

  function translateTextNode(node) {
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

    // Static-page paragraphs can contain newlines/tabs; match them normalized
    // and replace the whole node.
    const normalized = text.replace(/\s+/g, " ");
    const normalizedHit = EXACT[normalized];
    if (normalizedHit != null && normalizedHit !== normalized) {
      node.nodeValue = normalizedHit;
      return;
    }

    const out = translateString(text);
    if (out != null) {
      if (out === text) return;
      const i = raw.indexOf(text);
      node.nodeValue = raw.slice(0, i) + out + raw.slice(i + text.length);
      return;
    }

    // "D:name(-21.0)" lines of the final score table carry player names.
    if (PLAYER_SCORE_LINE_RE.test(text)) return;

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
  const TILES_ENABLED = (() => {
    try {
      return localStorage.getItem("tenhou4enTiles") !== "0";
    } catch (e) {
      return true;
    }
  })();
  // "tl" = top-left corner of the tile face (default), "c" = centred.
  const TILE_POS = (() => {
    try {
      return localStorage.getItem("tenhou4enTilePos") === "c" ? "c" : "tl";
    } catch (e) {
      return "tl";
    }
  })();
  const TILE_SCALE = 0.42; // font size relative to the smaller side of the face
  // Nudge as fractions of the face rect, e.g. "0.05,0" moves 5% right.
  const TILE_OFF = (() => {
    try {
      const v = (localStorage.getItem("tenhou4enTileOff") || "0,0").split(",").map(Number);
      return [v[0] || 0, v[1] || 0];
    } catch (e) {
      return [0, 0];
    }
  })();

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

  function tileText(face) {
    if (face >= 30 && face <= 36) {
      return {
        text: ["E", "S", "W", "N", "Wh", "Gr", "Rd"][face - 30],
        bg: "#6c3483",
        fg: "#fff",
      };
    }
    const suit = face < 10 ? "m" : face < 20 ? "p" : "s";
    const n = face % 10;
    const bg = { m: "#b03a2e", p: "#1f618d", s: "#1e8449" }[suit];
    if (n === 0) return { text: "5" + suit, bg: "#c9a000", fg: "#000" }; // red five
    return { text: n + suit, bg, fg: "#fff" };
  }

  function drawTileLabel(ctx, job) {
    const info = tileText(job.face);
    const r = job.rect;
    const fs = Math.max(8, Math.round(Math.min(r.w, r.h) * TILE_SCALE));
    ctx.save();
    ctx.font = "bold " + fs + "px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padX = Math.round(fs * 0.22);
    const padY = Math.round(fs * 0.12);
    const w = Math.ceil(ctx.measureText(info.text).width + padX * 2);
    const h = Math.ceil(fs + padY * 2);
    let x = (TILE_POS === "c" ? r.x + (r.w - w) / 2 : r.x) + TILE_OFF[0] * r.w;
    let y = (TILE_POS === "c" ? r.y + (r.h - h) / 2 : r.y) + TILE_OFF[1] * r.h;
    x = Math.max(0, Math.min(job.w - w, x));
    y = Math.max(0, Math.min(job.h - h, y));
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = info.bg;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
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
    if (!TILES_ENABLED) return;
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
            if (img && img.width === job.w && img.height === job.h) {
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
      return Object.assign({ enabled: TILES_ENABLED, pos: TILE_POS }, tileStats);
    },
    setEnabled(on) {
      try {
        localStorage.setItem("tenhou4enTiles", on ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      console.log("[tenhou4-en] tile labels " + (on ? "on" : "off") + " - reload the page");
    },
    setPosition(pos) {
      try {
        localStorage.setItem("tenhou4enTilePos", pos === "c" ? "c" : "tl");
      } catch (e) {
        /* ignore */
      }
      console.log("[tenhou4-en] tile label position set - reload the page");
    },
    setOffset(dx, dy) {
      try {
        localStorage.setItem("tenhou4enTileOff", (Number(dx) || 0) + "," + (Number(dy) || 0));
      } catch (e) {
        /* ignore */
      }
      console.log("[tenhou4-en] tile label offset set - reload the page");
    },
    _test: { normalizeKey, parseObjBuffer, onInflate, wrapZlib, makeJob, tileText, tileHealthMessage },
  };
  // </tiles>

  tilesApi.install();

  // --------------------------------------------------------------- debugging

  window.__tenhou4en = {
    version: VERSION,
    tiles: tilesApi,
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