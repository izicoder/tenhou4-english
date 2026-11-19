"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/load");

test("translates yaku result divs and leaves unknown text alone", () => {
  const dom = load(
    `<body>
       <div class="ym">立直</div>
       <div class="yk">平和</div>
       <div id="unknown">未知の文字</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.querySelector(".ym").textContent, "Riichi");
  assert.equal(d.querySelector(".yk").textContent, "Pinfu");
  assert.equal(d.getElementById("unknown").textContent, "未知の文字");

  dom.window.close();
});

test("translates ranks, rooms and counters", () => {
  const dom = load(
    `<body>
       <div id="rank">七段</div>
       <div id="room">鳳凰</div>
       <div id="round">東1局</div>
       <div id="honba">3本場</div>
       <div id="tiles">25枚</div>
       <div id="points">12000点</div>
       <div id="han">3翻</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("rank").textContent, "7 Dan");
  assert.equal(d.getElementById("room").textContent, "Phoenix");
  assert.equal(d.getElementById("round").textContent, "East 1");
  assert.equal(d.getElementById("honba").textContent, "3 Honba");
  assert.equal(d.getElementById("tiles").textContent, "25 tiles");
  assert.equal(d.getElementById("points").textContent, "12000 pts");
  assert.equal(d.getElementById("han").textContent, "3 han");

  dom.window.close();
});

test("translates nodes added after load", async () => {
  const dom = load("<body></body>", "https://tenhou.net/4/");
  const d = dom.window.document;

  const el = d.createElement("div");
  el.textContent = "本場";
  d.body.appendChild(el);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(el.textContent, "Honba");

  dom.window.close();
});

test("does not touch script or style contents", () => {
  const dom = load(
    `<body><script>var x = "立直";</script><style>.a{content:"平和"}</style></body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.match(d.querySelector("script").textContent, /立直/);
  assert.match(d.querySelector("style").textContent, /平和/);

  dom.window.close();
});

test("logs unknown Japanese only in debug mode", () => {
  const logs = [];

  const quiet = load("<body><div>謎のテキスト</div></body>", "https://tenhou.net/4/");
  quiet.window.console.log = (...a) => logs.push(a.join(" "));
  // Re-run a scan to be sure nothing was logged.
  quiet.window.__tenhou4en.scan();
  assert.equal(logs.length, 0);
  quiet.window.close();

  const loud = load(
    "<body><div>謎のテキスト</div></body>",
    "https://tenhou.net/4/?tenhou_en_debug=1",
    {
      beforeEval(win) {
        win.console.log = (...a) => logs.push(a.join(" "));
      },
    }
  );

  assert.ok(
    logs.some((l) => l.includes("untranslated") && l.includes("謎のテキスト")),
    `expected an untranslated log, got: ${logs.join(" | ")}`
  );

  loud.window.close();
});

test("translates numeric counters", () => {
  const dom = load(
    `<body>
       <div id="players">4人</div>
       <div id="one">1人</div>
       <div id="place">1位</div>
       <div id="place3">3位</div>
       <div id="games">100戦</div>
       <div id="days">30日</div>
       <div id="r">R1800</div>
       <div id="fu">40符</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("players").textContent, "4 players");
  assert.equal(d.getElementById("one").textContent, "1 player");
  assert.equal(d.getElementById("place").textContent, "1st");
  assert.equal(d.getElementById("place3").textContent, "3rd");
  assert.equal(d.getElementById("games").textContent, "100 games");
  assert.equal(d.getElementById("days").textContent, "30 days");
  assert.equal(d.getElementById("r").textContent, "R1800");
  assert.equal(d.getElementById("fu").textContent, "40 fu");

  dom.window.close();
});

test("translates a counter split across sibling text nodes", () => {
  const dom = load(
    `<body>
       <div id="honba">3<!-- -->本場</div>
       <div id="points">12000<!-- -->点</div>
       <div id="place">2<!-- -->位</div>
       <div id="players">4<!-- -->人</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("honba").textContent, "3 Honba");
  assert.equal(d.getElementById("points").textContent, "12000 pts");
  assert.equal(d.getElementById("place").textContent, "2nd");
  assert.equal(d.getElementById("players").textContent, "4 players");

  dom.window.close();
});

test("translates lobby and room-selection labels", () => {
  const dom = load(
    `<body>
       <div id="loading">準備中</div>
       <div id="four">四麻:</div>
       <div id="three">三麻:</div>
       <div id="east">東風戦</div>
       <div id="es">東南戦</div>
       <div id="open">喰アリ赤</div>
       <div id="fast">喰アリ赤速</div>
       <div id="flash">喰アリ赤光</div>
       <div id="san">三喰赤</div>
       <div id="sanfast">三喰赤速</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("loading").textContent, "Loading...");
  assert.equal(d.getElementById("four").textContent, "4-player:");
  assert.equal(d.getElementById("three").textContent, "3-player:");
  assert.equal(d.getElementById("east").textContent, "East-only");
  assert.equal(d.getElementById("es").textContent, "East-South");
  assert.equal(d.getElementById("open").textContent, "Kuitan Ari Red");
  assert.equal(d.getElementById("fast").textContent, "Kuitan Ari Red Fast");
  assert.equal(d.getElementById("flash").textContent, "Kuitan Ari Red Flash");
  assert.equal(d.getElementById("san").textContent, "3P Kuitan Red");
  assert.equal(d.getElementById("sanfast").textContent, "3P Kuitan Red Fast");

  dom.window.close();
});

test("translates generated table names", () => {
  const dom = load(
    `<body>
       <div id="a">四鳳南喰赤</div>
       <div id="b">三鳳南喰赤</div>
       <div id="c">四特東喰赤速</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("a").textContent, "4P Phoenix South Open Red");
  assert.equal(d.getElementById("b").textContent, "3P Phoenix South Open Red");
  assert.equal(d.getElementById("c").textContent, "4P Expert East Open Red Fast");

  dom.window.close();
});

test("translates single-character lobby tabs only in the tab container", () => {
  const dom = load(
    `<body>
       <div class="tab3">
         <label class="btn" for="wg02">四</label>
         <label class="btn" for="wg12">東</label>
         <label class="btn" for="wg22">鳳</label>
       </div>
       <div id="player">東</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  const labels = [...d.querySelectorAll("label.btn")].map((l) => l.textContent);
  assert.deepEqual(labels, ["4P", "East", "Phoenix"]);
  assert.equal(d.getElementById("player").textContent, "東");

  dom.window.close();
});

test("translates static /reg/ page strings", () => {
  const dom = load(
    `<body>
       <h3>有料版有効期限の購入</h3>
       <div id="pay">- ドコモケータイ払い</div>
       <a id="contact">お問い合わせ</a>
       <a id="tokusho">特定商取引に関する法律に基づく表記</a>
     </body>`,
    "https://tenhou.net/reg/"
  );

  const d = dom.window.document;
  assert.equal(d.querySelector("h3").textContent, "Purchase Paid Membership");
  assert.equal(d.getElementById("pay").textContent, "- Docomo Mobile Payment");
  assert.equal(d.getElementById("contact").textContent, "Contact");
  assert.equal(
    d.getElementById("tokusho").textContent,
    "Notation under the Act on Specified Commercial Transactions"
  );

  dom.window.close();
});

test("matches static-page paragraphs after whitespace normalization", () => {
  const ja =
    "有料会員にのみ提供されているサービス(Windows版天鳳/鳳凰卓での対戦/有料の大会への参加/有料のトレーニングコンテンツ)を利用するには、" +
    " １つのプレーヤIDにつき「25日で550円」または「22日500円」の利用料金をお支払いいただく必要があります。" +
    " 数か月分まとめてお支払いいただくこともできます。" +
    " お支払いには以下の決済サービスがご利用いただけます。";

  const withNewline = ja.replace(" １つ", "\n\t１つ");

  const dom = load(`<body><div id="p">${withNewline}</div></body>`, "https://tenhou.net/reg/");
  assert.match(
    dom.window.document.getElementById("p").textContent,
    /^To use services available only to paid members/
  );

  dom.window.close();
});

test("translates the browser tab title", () => {
  const dom = load(
    `<head><title>天鳳 / Desktop4K版</title></head><body></body>`,
    "https://tenhou.net/4/"
  );
  assert.equal(dom.window.document.title, "Tenhou / Desktop4K");
  dom.window.close();
});

test("translates the in-game nopp panel with nested spans", () => {
  const dom = load(
    `<body>
       <div class="nopp" id="round"><span>東</span><span class="gray">1</span><span class="gray">局</span></div>
       <div class="nopp" id="seat"><span class="gray">南</span> 25000</div>
       <div class="nopp" id="player"><span>北</span> COM</div>
       <div id="outside"><span>東</span></div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("round").textContent, "East 1");
  assert.equal(d.getElementById("seat").textContent, "South 25000");
  assert.equal(d.getElementById("player").textContent, "North COM");
  assert.equal(d.getElementById("outside").textContent, "東");

  dom.window.close();
});

test("updates the nopp round when the digit span changes", async () => {
  const dom = load(
    `<body><div class="nopp" id="round"><span>東</span><span class="gray">1</span><span class="gray">局</span></div></body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  const round = d.getElementById("round");
  assert.equal(round.textContent, "East 1");

  round.children[1].textContent = "2";
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(round.textContent, "East 2");

  dom.window.close();
});

test("translates the game-start label", () => {
  const dom = load(`<body><div id="g">對局</div></body>`, "https://tenhou.net/4/");
  assert.equal(dom.window.document.getElementById("g").textContent, "Game");
  dom.window.close();
});

test("__tenhou4en.add() translates new strings on demand", () => {
  const dom = load("<body><div id='x'>謎</div></body>", "https://tenhou.net/4/");
  const d = dom.window.document;

  dom.window.__tenhou4en.add("謎", "Mystery");
  assert.equal(d.getElementById("x").textContent, "Mystery");

  dom.window.close();
});

test("translates a round split across three sibling text nodes", () => {
  const dom = load(
    `<body><div id="round">東<!-- -->1<!-- -->局</div></body>`,
    "https://tenhou.net/4/"
  );

  const round = dom.window.document.getElementById("round");
  assert.equal(round.textContent, "East 1");
  assert.equal(round.childNodes.length, 5); // text, comment, text, comment, text

  dom.window.close();
});

test("updates the split round when the digit text node changes", async () => {
  const dom = load(
    `<body><div id="round">東<!-- -->1<!-- -->局</div></body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  const round = d.getElementById("round");
  assert.equal(round.textContent, "East 1");

  // The client updates only the digit node.
  const digit = round.childNodes[2];
  assert.equal(digit.nodeValue, "1");
  digit.nodeValue = "2";
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(round.textContent, "East 2");
  assert.equal(round.childNodes[0].nodeValue, "East ");
  assert.equal(round.childNodes[4].nodeValue, "");

  dom.window.close();
});

test("does not translate a lone wind used as a player name", () => {
  const dom = load(
    `<body>
       <div id="player">東</div>
       <div id="round">東<!-- -->1<!-- -->局</div>
     </body>`,
    "https://tenhou.net/4/"
  );

  const d = dom.window.document;
  assert.equal(d.getElementById("player").textContent, "東");
  assert.equal(d.getElementById("round").textContent, "East 1");

  dom.window.close();
});
