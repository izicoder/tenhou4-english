"use strict";

/*
 * Manual coverage recorder.
 *
 * Opens tenhou.net/4 in Edge and stays open. You log in, click everywhere and
 * play a game; the script watches the DOM and, whenever the set of leftover
 * Japanese strings changes, saves a screenshot and appends the strings (with
 * their element markup and ancestor classes) to shots/report.json.
 *
 * Usage:
 *   $env:TENHOU_ID="..."   (optional, prefills the ID dialog)
 *   node test/record.js
 *
 * Stop with Ctrl+C. Everything is written under shots/rec/.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const REC = path.join(SHOTS, "rec");
const REPORT = path.join(SHOTS, "report.json");
const USCRIPT = fs.readFileSync(
  path.join(ROOT, "tenhou4-english.user.js"),
  "utf8"
);

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
const PROXY = process.env.SOCKS_PROXY || "socks5://127.0.0.1:10808";
const POLL_MS = Number(process.env.POLL_MS || 2000);

const JP = /[\u3040-\u30ff\u4e00-\u9fff]/;

// Runs inside the page. Returns every leftover Japanese string together with
// the markup that produced it.
function scanPage() {
  const visible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  const jp = /[\u3040-\u30ff\u4e00-\u9fff]/;

  const ancestorClasses = (el) => {
    const out = [];
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1; i++) {
      out.push(
        n.tagName.toLowerCase() +
          (n.id ? "#" + n.id : "") +
          (typeof n.className === "string" && n.className
            ? "." + n.className.trim().replace(/\s+/g, ".")
            : "")
      );
      n = n.parentElement;
    }
    return out;
  };

  const entries = [];
  const add = (kind, el, string, extra) => {
    if (!jp.test(string)) return;
    entries.push({
      kind,
      string: string.trim(),
      outerHTML: (el.outerHTML || "").slice(0, 700),
      ancestors: ancestorClasses(el),
      ...extra,
    });
  };

  // Text nodes.
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || "").trim();
    if (!text || !jp.test(text)) continue;
    const el = node.parentElement;
    if (!el) continue;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    // Player names / user content.
    if (el.closest && el.closest('a[href*="tenhou.net/0/?wg="]')) continue;
    add("text", el, text, { visible: visible(el) });
  }

  // Attribute strings.
  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of ["value", "title", "placeholder", "alt", "aria-label"]) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && jp.test(v)) add("attr:" + attr, el, v, { visible: visible(el) });
    }
  }

  // Body text, in case something is rendered outside a text node.
  const bodyText = document.body.innerText || "";
  const bodyMatches = [
    ...new Set((bodyText.match(/[\u3040-\u30ff\u4e00-\u9fff][^\n]*/g) || []).map((s) => s.trim())),
  ];

  const heading =
    [...document.querySelectorAll("h1,h2,h3,.title,.head,.caption")]
      .filter(visible)
      .map((e) => (e.textContent || "").trim())
      .find(Boolean) || "";

  return {
    title: document.title,
    heading,
    url: location.href,
    bodyText: bodyText.slice(0, 1200),
    bodyMatches,
    entries,
    storage: Object.keys(localStorage),
  };
}

function loadReport() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    /* no report yet */
  }
  return [];
}

function mergeReport(report, screen, snap) {
  const seen = new Set(
    report.map((r) => `${r.screen}\u0000${r.string}`)
  );

  let added = 0;
  for (const e of snap.entries) {
    const key = `${screen}\u0000${e.string}`;
    if (seen.has(key)) continue;
    seen.add(key);
    report.push({
      screen,
      string: e.string,
      kind: e.kind,
      outerHTML: e.outerHTML,
      ancestors: e.ancestors,
      visible: e.visible,
      at: new Date().toISOString(),
    });
    added++;
  }

  // Body matches that did not come from a text node.
  // (Kept out of the report: text-node entries are precise and player names
  // otherwise flood the list. bodyMatches is still shown in the console.)

  return added;
}

(async () => {
  if (!EDGE) throw new Error("Edge not found. Set EDGE_PATH to msedge.exe.");

  fs.mkdirSync(REC, { recursive: true });

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: false,
    proxy: { server: PROXY },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      "--disable-features=msEdgeFirstRunExperience,msEdgeSidebarV2",
    ],
  });

  const context = await browser.newContext({ viewport: null, locale: "en-US" });
  const page = await context.newPage();

  const consoleJp = new Set();

  page.on("console", (m) => {
    const text = m.text();
    const match = /\[tenhou4-en\] untranslated:\s*(.*)$/.exec(text);
    if (match) {
      let s = match[1];
      try {
        s = JSON.parse(s);
      } catch (e) {
        /* keep raw */
      }
      if (typeof s === "string" && JP.test(s)) consoleJp.add(s);
    }
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.addInitScript(USCRIPT);

  console.log("=".repeat(70));
  console.log("Tenhou /4 coverage recorder");
  console.log("=".repeat(70));
  console.log("A browser window is open. Log in and click through everything:");
  console.log("  login -> lobby -> rooms -> rules -> settings tabs -> help/info");
  console.log("  -> ranking/records -> start a bot game -> play a hand -> result");
  console.log("");
  console.log("The script saves a screenshot + leftover Japanese whenever the");
  console.log("screen changes. Leave it running, then press Ctrl+C here when done.");
  console.log("=".repeat(70));

  await page.goto("https://tenhou.net/4/?lang=en&tenhou_en_debug=1", {
    waitUntil: "load",
    timeout: 60000,
  });

  if (process.env.TENHOU_ID) {
    // Prefill the Existing ID dialog if it is already reachable. Purely a
    // convenience; you can still log in by hand.
    await page.waitForTimeout(4000);
  }

  const report = loadReport();
  let lastKey = "";
  let index = 0;
  let running = true;

  browser.on("disconnected", () => {
    try {
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
    } catch (e) {
      /* ignore */
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    running = false;
    console.log("\n[stop] writing report...");
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
    await browser.close().catch(() => {});
    process.exit(0);
  });

  while (running) {
    let snap;
    try {
      snap = await page.evaluate(scanPage);
    } catch (e) {
      await page.waitForTimeout(POLL_MS);
      continue;
    }

    const strings = [
      ...new Set([
        ...snap.entries.map((e) => e.string),
        ...consoleJp,
      ]),
    ].sort();

    const key = snap.url + "\u0000" + strings.join("\u0001");
    if (key !== lastKey) {
      lastKey = key;
      index++;

      const screen =
        (snap.heading || snap.title || "screen").slice(0, 40) +
        " #" +
        String(index).padStart(3, "0");

      const shot = path.join(
        REC,
        `rec-${String(index).padStart(3, "0")}.png`
      );
      await page
        .screenshot({ path: shot, fullPage: false })
        .catch(() => {});

      // Fold in console-reported strings that have no DOM entry.
      if (consoleJp.size) {
        for (const s of consoleJp) {
          if (!snap.entries.some((e) => e.string === s)) {
            snap.entries.push({
              kind: "console",
              string: s,
              outerHTML: null,
              ancestors: [],
              visible: false,
            });
          }
        }
      }

      const added = mergeReport(report, screen, snap);
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

      console.log(
        `\n[${screen}] +${added} new  (${strings.length} total on screen)`
      );
      for (const s of strings.slice(0, 30)) console.log("   ", JSON.stringify(s));
      if (strings.length > 30) console.log(`    ... and ${strings.length - 30} more`);
      console.log("    screenshot:", path.relative(ROOT, shot));
    }

    await page.waitForTimeout(POLL_MS);
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
