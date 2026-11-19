// ==UserScript==
// @name         Tenhou /4 English (full)
// @name:ja      天鳳 /4 英語化
// @namespace    https://github.com/local/tenhou4-english
// @version      0.1.0
// @description  Completes the English UI on tenhou.net/4 (Desktop4K) and translates the Japanese the official EN option leaves behind.
// @author       you
// @match        https://tenhou.net/4/*
// @match        https://tenhou.net/4/
// @match        https://tenhou.net/man/*
// @match        https://tenhou.net/man/
// @match        https://tenhou.net/reg/*
// @match        https://tenhou.net/reg/
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

  // --------------------------------------------------------------- debugging

  window.__tenhou4en = {
    yaku: YAKU,
    ranks: RANKS,
    misc: MISC,
    overrides: TABLE_OVERRIDES,
    patchTable,
    translateString,
    translateTextNode,
    translateContext,
    translateNoppContainer,
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
})();
