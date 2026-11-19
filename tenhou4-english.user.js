// ==UserScript==
// @name         Tenhou /4 English + Tile Overlay
// @name:ja      天鳳 /4 英語化 + 牌ラベル
// @namespace    https://github.com/local/tenhou4-english
// @version      0.2.0
// @description  Completes the English UI on tenhou.net/4 (Desktop4K) and adds Majsoul-style tile number/letter overlays.
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
 * 1. String-table patch (official EN JSON)
 * 2. MutationObserver for hard-coded Japanese strings
 * 3. Tile Overlay (Majsoul-style indices)
 *
 * Toggle the overlay anytime with:
 *   localStorage.setItem("tenhou4enTiles", "1")   // on
 *   localStorage.setItem("tenhou4enTiles", "0")   // off
 * or press  Ctrl+Shift+T
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
  try {
    localStorage.setItem("lang", "en");
  } catch (e) { }

  // ------------------------------------------------------- string table patch
  const LANG_URL_RE = /\/res\/lang\/string\d+_en\.json(?:[?#]|$)/;

  const TABLE_OVERRIDES = {
    20: ["Default", "2 TAPs", "3 TAPs"],
    214: [
      "General", "Advanced", "Expert", "Phoenix",
      "Wakaba", "Silver", "Amber", "Peacock",
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
    } catch (e) { }
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
    "五": "Five",
    "ガリ": "Gari",
    "セット": "Set",
    "カラス": "Karasu",
    "全ガリ": "Zen Gari",
    "バンバン": "Banban",
  };

  const RANKS = {
    "新人": "Newcomer",
    "１級": "1 Kyu", "２級": "2 Kyu", "３級": "3 Kyu",
    "４級": "4 Kyu", "５級": "5 Kyu", "６級": "6 Kyu",
    "７級": "7 Kyu", "８級": "8 Kyu", "９級": "9 Kyu",
    "初段": "1 Dan", "二段": "2 Dan", "三段": "3 Dan",
    "四段": "4 Dan", "五段": "5 Dan", "六段": "6 Dan",
    "七段": "7 Dan", "八段": "8 Dan", "九段": "9 Dan",
    "十段": "10 Dan", "天鳳": "Tenhou",
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
    "10/21,11/08に発生した障害の戦績修正を受け付けています":
      "Accepting results corrections for the 10/21 and 11/08 outages",
    "※喰断ナシON/OFF": "* Kuitan Nashi ON/OFF",
    "天鳳 / Desktop4K版": "Tenhou / Desktop4K",
    "對局": "Game",
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

  const TAB_LABELS = {
    四: "4P", 三: "3P", 東: "East", 南: "South",
    鳳: "Phoenix", 特: "Expert", 雀: "Jansou",
  };

  const ROUND_RE = /^([東南西北])(\d+)局$/;
  const NOPP_ROUND_RE = /^([東南西北])(\d+)局$/;
  const NOPP_SEAT_RE = /^([東南西北])\s+(.+)$/;
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

    const original = nodes.map(originalValue).join("").trim();

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

  function translateResultSeat(node) {
    const text = node.nodeValue.trim();
    if (!WIND[text]) return false;

    let box = node.parentElement;
    for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
      const nodes = childTextNodes(box).filter((n) => originalValue(n).trim());
      if (!nodes.length || nodes[0] !== node) continue;
      const joined = nodes.map(originalValue).join(" ");
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

    const original = nodes.map(originalValue).join("").replace(/\s+/g, "");
    const m = ROUND_RE.exec(original);
    if (!m) return false;

    const wind = WIND[m[1]];
    const whole = `${m[1]}${m[2]}局`;

    for (const n of nodes) {
      const value = originalValue(n);
      const text = value.trim();
      if (text === whole) setNodeValue(n, `${wind} ${m[2]}`);
      else if (text === m[1]) setNodeValue(n, `${wind} `);
      else if (text === "局") setNodeValue(n, "");
    }
    return true;
  }

  const SPLIT_COUNTER_RE = /^(\d+)(本場|枚|点|翻|飜|符|人|位|戦|日)$/;

  function ordinal(n) {
    const i = Number(n);
    const v = i % 100;
    const s = ["th", "st", "nd", "rd"];
    return i + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function counterSuffix(unit, n) {
    switch (unit) {
      case "本場": return " Honba";
      case "枚": return " tiles";
      case "点": return " pts";
      case "翻":
      case "飜": return " han";
      case "符": return " fu";
      case "人": return n === "1" ? " player" : " players";
      case "戦": return " games";
      case "日": return " days";
      case "位": return "";
    }
    return null;
  }

  function translateSplitCounter(node) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== 1) return false;
    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return false;

    const nodes = childTextNodes(parent);
    if (nodes.length < 2) return false;

    const original = nodes.map(originalValue).join("").replace(/\s+/g, "");
    const m = SPLIT_COUNTER_RE.exec(original);
    if (!m) return false;

    const num = m[1];
    const unit = m[2];

    for (const n of nodes) {
      const text = originalValue(n).trim();
      if (text === unit) setNodeValue(n, counterSuffix(unit, num));
      else if (unit === "位" && text === num) setNodeValue(n, ordinal(num));
    }
    return true;
  }

  const TABLE_TIERS = {
    般: "General", 上: "Advanced", 特: "Expert", 鳳: "Phoenix",
    若: "Wakaba", 銀: "Silver", 琥: "Amber", 孔: "Peacock", 雀: "Jansou",
  };

  function translateTableName(text) {
    const m = /^([四三])([般上特鳳若銀琥孔雀])([東南])(喰|断)?(赤)?(速|光)?(祝[０-９0-9]?)?$/.exec(text);
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
      const n = m[7].slice(1).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
      parts.push(n ? `Anniv ${n}` : "Anniv");
    }
    return parts.join(" ");
  }

  const RULES = [
    [/^([東南西北])(\d+)局$/, (m) => `${WIND[m[1]]} ${m[2]}`],
    [/^([東南西北])場$/, (m) => `${WIND[m[1]]} Round`],
    [/^(\d+)本場$/, (m) => `${m[1]} Honba`],
    [/^(\d+)枚$/, (m) => `${m[1]} tiles`],
    [/^(\d+)点$/, (m) => `${m[1]} pts`],
    [/^(\d+)[翻飜]$/, (m) => `${m[1]} han`],
    [/^(\d+)符$/, (m) => `${m[1]} fu`],
    [/^(\d+)人$/, (m) => `${m[1]} ${m[1] === "1" ? "player" : "players"}`],
    [/^(\d+)位$/, (m) => ordinal(m[1])],
    [/^(\d+)戦$/, (m) => `${m[1]} games`],
    [/^(\d+)日$/, (m) => `${m[1]} days`],
    [/^R(\d+)$/, (m) => `R${m[1]}`],
    [/^([四三][般上特鳳若銀琥孔雀][東南][^\s　]*)$/, (m) => translateTableName(m[1])],
    [
      /^([四三][般上特鳳若銀琥孔雀][東南][^\s　]*)[\s　]+(\d+):$/,
      (m) => `${translateTableName(m[1])}  ${m[2]}:`,
    ],
    [
      /^※([四三])麻(一般卓|上級卓|特上卓|鳳凰卓|若葉卓|雀荘戦)$/,
      (m) => {
        const table = {
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

    const parent = node.parentNode;
    if (parent && parent.nodeType === 1) {
      const ptag = parent.tagName;
      if (ptag === "SCRIPT" || ptag === "STYLE" || ptag === "TEXTAREA") return;
    }

    const pel = node.parentElement;
    if (pel && pel.closest && pel.closest('a[href*="tenhou.net/0/?wg="]')) return;

    if (translateContext(node)) return;
    if (translateNoppContainer(node)) return;
    if (translateResultSeat(node)) return;
    if (translateRoundParent(node)) return;
    if (translateSplitCounter(node)) return;

    const text = raw.trim();
    if (!text) return;

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

  // ===============================================================
  // TILE OVERLAY  (Majsoul-style indices)
  // ===============================================================

  let tilesEnabled = true;
  try {
    const v = localStorage.getItem("tenhou4enTiles");
    if (v === "0") tilesEnabled = false;
  } catch (e) { }

  // Inject CSS for the overlay
  const style = document.createElement("style");
  style.textContent = `
    .tenhou4en-tile-label {
      position: absolute;
      top: 2px;
      left: 2px;
      font-family: "Segoe UI", "Arial", sans-serif;
      font-weight: 700;
      font-size: 13px;
      line-height: 1;
      color: #111;
      background: rgba(255,255,255,0.82);
      border-radius: 3px;
      padding: 1px 3px;
      pointer-events: none;
      z-index: 20;
      text-shadow: 0 0 2px #fff;
      box-shadow: 0 0 1px rgba(0,0,0,0.4);
    }
    .tenhou4en-tile-label.aka {
      color: #c00;
      background: rgba(255,230,230,0.9);
    }
    .tenhou4en-tile-label.honor {
      font-size: 12px;
    }
  `;
  document.documentElement.appendChild(style);

  // Simple hotkey: Ctrl+Shift+T
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
      tilesEnabled = !tilesEnabled;
      try {
        localStorage.setItem("tenhou4enTiles", tilesEnabled ? "1" : "0");
      } catch (err) { }
      document.querySelectorAll(".tenhou4en-tile-label").forEach((el) => {
        el.style.display = tilesEnabled ? "" : "none";
      });
      console.log("[tenhou4-en] Tile overlay:", tilesEnabled ? "ON" : "OFF");
    }
  });

  // Debug helper
  window.__tenhou4en = {
    yaku: YAKU,
    ranks: RANKS,
    misc: MISC,
    overrides: TABLE_OVERRIDES,
    patchTable,
    translateString,
    translateTextNode,
    walk,
    tilesEnabled: () => tilesEnabled,
    toggleTiles() {
      tilesEnabled = !tilesEnabled;
      try {
        localStorage.setItem("tenhou4enTiles", tilesEnabled ? "1" : "0");
      } catch (e) { }
      document.querySelectorAll(".tenhou4en-tile-label").forEach((el) => {
        el.style.display = tilesEnabled ? "" : "none";
      });
      return tilesEnabled;
    },
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
    "%c[tenhou4-en] v0.2.0 loaded — Ctrl+Shift+T toggles tile overlay",
    "color:#0a0;font-weight:bold"
  );
})();
