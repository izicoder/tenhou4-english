"use strict";

/*
 * Coverage harness: enters the client, walks the DOM screens, and records every
 * leftover Japanese string with a screenshot.
 *
 * Usage:
 *   node test/coverage.js            # guest login (default)
 *   node test/coverage.js --id       # login with $env:TENHOU_ID
 *   node test/coverage.js --dump     # only print the lobby controls
 *   node test/coverage.js --game     # also start a bot game and play it out
 *
 * Outputs: shots/coverage/*.png, shots/coverage.json, shots/lobby-controls.json
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const OUT = path.join(SHOTS, "coverage");
const REPORT = path.join(SHOTS, "coverage.json");
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
const JP = /[\u3040-\u30ff\u4e00-\u9fff]/;

const visibleFn = `(el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)`;

async function dismissModals(page) {
  for (let i = 0; i < 10; i++) {
    const clicked = await page.evaluate((vis) => {
      const visible = eval(vis);
      const el = [...document.querySelectorAll("*")].find((b) => {
        if (b.childElementCount !== 0 || !visible(b)) return false;
        const label = ((b.textContent || "") + " " + (b.value || "")).trim();
        return /^(OK|Close|CANCEL|×|✕)$/i.test(label);
      });
      if (!el) return false;
      el.click();
      return true;
    }, visibleFn);
    if (!clicked) return;
    await page.waitForTimeout(700);
  }
}

async function hasText(page, re) {
  return page.evaluate(
    ({ src, vis }) => {
      const visible = eval(vis);
      const rx = new RegExp(src);
      return [...document.querySelectorAll("*")].some(
        (e) =>
          e.childElementCount === 0 &&
          visible(e) &&
          rx.test((e.textContent || "").trim())
      );
    },
    { src: re.source, vis: visibleFn }
  );
}

async function waitFor(page, re, ms = 90000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await dismissModals(page);
    if (await hasText(page, re)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function clickText(page, re) {
  return page.evaluate(
    ({ src, vis }) => {
      const visible = eval(vis);
      const rx = new RegExp(src, "i");
      const els = [...document.querySelectorAll("*")].filter((el) => {
        if (!visible(el)) return false;
        const label = ((el.textContent || "") + " " + (el.value || "")).trim();
        return rx.test(label);
      });
      if (!els.length) return null;
      // Prefer the innermost clickable element.
      const el = els.sort((a, b) => a.childElementCount - b.childElementCount)[0];
      el.click();
      return ((el.textContent || "").trim() || el.value || "").slice(0, 40);
    },
    { src: re.source, vis: visibleFn }
  );
}

async function login(page, { id, guest }) {
  await page.goto("https://tenhou.net/4/?lang=en&tenhou_en_debug=1", {
    waitUntil: "load",
    timeout: 60000,
  });

  // The splash needs a user gesture before the title panel appears; a news
  // dialog ("OK") then has to be dismissed.
  await page.waitForTimeout(5000);
  await page.mouse.click(640, 450);

  const title = await waitFor(page, /^(Guest Login|Existing ID)$/);
  console.log("[login] title panel:", title);

  if (guest) {
    console.log("[login] Guest Login:", await clickText(page, /^Guest Login$/));
  } else {
    console.log("[login] Existing ID:", await clickText(page, /^Existing ID$/));
    await page.waitForTimeout(1200);
    await page.evaluate((value) => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const input = [...document.querySelectorAll("input")].find(
        (i) =>
          visible(i) &&
          (i.type === "text" || i.type === "" || i.type === "search")
      );
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, id);
    console.log("[login] OK:", await clickText(page, /^OK$/));
  }

  // Lobby is up when the room-tier tabs are visible.
  const lobby = await waitFor(page, /^(Ge|Ad|Ex|Ph)$/, 60000);
  console.log("[login] lobby reached:", lobby);
  return lobby;
}

function scan() {
  const visible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const jp = /[\u3040-\u30ff\u4e00-\u9fff]/;

  const ancestors = (el) => {
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
  const add = (kind, el, string) => {
    if (!jp.test(string)) return;
    entries.push({
      kind,
      string: string.trim(),
      outerHTML: (el.outerHTML || "").slice(0, 700),
      ancestors: ancestors(el),
      visible: visible(el),
    });
  };

  const walker = document.createTreeWalker(document.body, 4, null);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || "").trim();
    if (!text || !jp.test(text)) continue;
    const el = node.parentElement;
    if (!el) continue;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    if (el.closest && el.closest('a[href*="tenhou.net/0/?wg="]')) continue;
    add("text", el, text);
  }

  for (const el of document.body.querySelectorAll("*")) {
    for (const attr of ["value", "title", "placeholder", "alt", "aria-label"]) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && jp.test(v)) add("attr:" + attr, el, v);
    }
  }

  return {
    title: document.title,
    url: location.href,
    entries,
    bodyText: (document.body.innerText || "").slice(0, 800),
  };
}

async function capture(page, name, report) {
  await page.screenshot({
    path: path.join(OUT, name.replace(/[^a-z0-9_-]/gi, "_") + ".png"),
    fullPage: false,
  });
  const snap = await page.evaluate(scan);
  const seen = new Set(report.map((r) => r.screen + "\u0000" + r.string));
  let added = 0;
  for (const e of snap.entries) {
    const key = name + "\u0000" + e.string;
    if (seen.has(key)) continue;
    seen.add(key);
    report.push({ screen: name, ...e });
    added++;
  }
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[${name}] ${added} new, ${snap.entries.length} on screen` +
      (snap.entries.length
        ? " -> " + [...new Set(snap.entries.map((e) => e.string))].join(" | ")
        : "")
  );
  return snap;
}

async function closeOverlay(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await dismissModals(page);
}

(async () => {
  if (!EDGE) throw new Error("Edge not found. Set EDGE_PATH.");

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: process.env.HEADLESS === "1",
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

  page.on("console", (m) => {
    const t = m.text();
    if (/untranslated|pageerror/.test(t)) console.log("[page]", t);
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.addInitScript(USCRIPT);

  try {
    const useId = process.argv.includes("--id");
    const ok = await login(page, {
      id: process.env.TENHOU_ID || "",
      guest: !useId,
    });
    if (!ok) throw new Error("could not reach the lobby");

    const controls = await page.evaluate((vis) => {
      const visible = eval(vis);
      const describe = (el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        class: typeof el.className === "string" ? el.className : null,
        text: ((el.textContent || "").trim() || el.value || "").slice(0, 40),
        for: el.getAttribute && el.getAttribute("for"),
        href: el.getAttribute && el.getAttribute("href"),
        visible: visible(el),
      });
      return [
        ...document.querySelectorAll(
          "button, input, a, label, [role=button], [onclick], .btn, [class*=tab]"
        ),
      ]
        .filter(visible)
        .map(describe);
    }, visibleFn);

    fs.writeFileSync(
      path.join(SHOTS, "lobby-controls.json"),
      JSON.stringify(controls, null, 2),
      "utf8"
    );

    console.log("\n===== LOBBY CONTROLS =====");
    for (const c of controls) {
      console.log(
        [c.tag, c.id, c.class, JSON.stringify(c.text), c.for, c.href]
          .filter(Boolean)
          .join(" ")
      );
    }

    if (process.argv.includes("--dump")) return;

    const report = [];
    await capture(page, "lobby", report);

    // Top tabs.
    for (const label of ["Mo", "To", "WA", "LO", "TO"]) {
      if (!(await clickText(page, new RegExp(`^${label}$`)))) continue;
      await page.waitForTimeout(1200);
      await capture(page, `lobby-tab-${label}`, report);
    }

    // Room tiers.
    for (const label of ["Ge", "Ad", "Ex", "Ph"]) {
      if (!(await clickText(page, new RegExp(`^${label}$`)))) continue;
      await page.waitForTimeout(1200);
      await capture(page, `lobby-room-${label}`, report);
    }

    // Settings gear: the unlabelled button next to the language selector.
    const gear = await page.evaluate((vis) => {
      const visible = eval(vis);
      const el = [...document.querySelectorAll("button, [onclick]")].find((e) => {
        const cls = typeof e.className === "string" ? e.className : "";
        return visible(e) && /\b(adr|c66)\b/.test(cls);
      });
      if (!el) return null;
      el.click();
      return el.className;
    }, visibleFn);
    console.log("[settings] gear:", gear);
    await page.waitForTimeout(1500);
    await capture(page, "settings", report);

    // Settings tabs.
    const tabs = await page.evaluate((vis) => {
      const visible = eval(vis);
      return [
        ...new Set(
          [...document.querySelectorAll("label, button, .btn")]
            .filter((el) => visible(el) && el.childElementCount <= 1)
            .map((el) => (el.textContent || "").trim())
            .filter((t) => t && t.length <= 12)
        ),
      ];
    }, visibleFn);
    console.log("[settings] tabs:", JSON.stringify(tabs));
    for (const label of tabs) {
      if (/^(OK|Close|CANCEL|×)$/i.test(label)) continue;
      if (!(await clickText(page, new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)))) continue;
      await page.waitForTimeout(900);
      await capture(page, `settings-${label}`, report);
    }
    await closeOverlay(page);

    // Match start via TEST PLAY.
    if (await clickText(page, /^TEST PLAY/)) {
      await page.waitForTimeout(2000);
      await capture(page, "match-start", report);
      await closeOverlay(page);
    }

    console.log("\nReport:", REPORT);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
