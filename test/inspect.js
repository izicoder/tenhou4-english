"use strict";

/*
 * Exploration helper: logs in, then dumps the visible DOM so the coverage
 * harness can target real controls. Not part of the test suite.
 *
 * Usage:
 *   $env:TENHOU_ID="..."; node test/inspect.js
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
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

const VISIBLE = `(el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)`;

async function clickLabel(page, re) {
  return page.evaluate(
    ({ source }) => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const re = new RegExp(source, "i");
      const els = [
        ...document.querySelectorAll(
          "button, input, a, [role=button], div, span"
        ),
      ]
        .filter((el) => {
          const label = ((el.textContent || "") + " " + (el.value || "")).trim();
          return visible(el) && re.test(label) && el.childElementCount <= 3;
        })
        .sort((a, b) => a.childElementCount - b.childElementCount);
      if (!els.length) return null;
      const label = ((els[0].textContent || "") + " " + (els[0].value || "")).trim();
      els[0].click();
      return label;
    },
    { source: re.source }
  );
}

async function dismissModals(page) {
  for (let i = 0; i < 8; i++) {
    const label = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = [
        ...document.querySelectorAll("button, input, [role=button]"),
      ].find((b) => {
        const label = ((b.textContent || "") + " " + (b.value || "")).trim();
        return visible(b) && /^(OK|Close|CANCEL)$/i.test(label);
      });
      if (!el) return null;
      el.click();
      return ((el.textContent || "") + " " + (el.value || "")).trim();
    });
    if (!label) break;
    await page.waitForTimeout(800);
  }
}

async function waitForLogin(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await dismissModals(page);
    const inputs = await page.evaluate(
      () =>
        [...document.querySelectorAll("input")].filter(
          (el) =>
            !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        ).length
    );
    if (inputs > 0) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

(async () => {
  if (!EDGE) throw new Error("Edge not found");
  fs.mkdirSync(SHOTS, { recursive: true });

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
  page.on("console", (m) => console.log("[page]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  try {
    await page.addInitScript(USCRIPT);
    await page.goto("https://tenhou.net/4/?lang=en", {
      waitUntil: "load",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);
    await dismissModals(page);

    // Login: Existing ID.
    console.log("click Existing ID:", await clickLabel(page, /existing\s*id/i));
    await page.waitForTimeout(1500);

    await page.evaluate((id) => {
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
      setter.call(input, id);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, process.env.TENHOU_ID || "");

    console.log("click OK:", await clickLabel(page, /^OK$/));

    // Wait for the lobby: login inputs disappear.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      const hasInputs = await page.evaluate(
        () =>
          [...document.querySelectorAll("input")].filter(
            (el) =>
              !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          ).length
      );
      if (!hasInputs && i > 2) break;
    }

    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOTS, "inspect-lobby.png") });

    const dump = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const describe = (el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        class: el.className && typeof el.className === "string" ? el.className : null,
        text: ((el.textContent || "").trim() || el.value || "").slice(0, 60),
        href: el.getAttribute && el.getAttribute("href"),
        title: el.getAttribute && el.getAttribute("title"),
        visible: visible(el),
      });
      const clickable = [
        ...document.querySelectorAll(
          "button, input, a, [role=button], [onclick], .btn, [class*=button]"
        ),
      ]
        .filter(visible)
        .map(describe);
      const textEls = [...document.querySelectorAll("*")]
        .filter(
          (el) =>
            visible(el) &&
            el.children.length === 0 &&
            (el.textContent || "").trim()
        )
        .map(describe);
      return {
        title: document.title,
        lang: localStorage.getItem("lang"),
        bodyText: (document.body.innerText || "").slice(0, 4000),
        clickable,
        textEls: textEls.slice(0, 300),
        storage: Object.keys(localStorage),
        canvases: [...document.querySelectorAll("canvas")].map((c) => ({
          id: c.id,
          w: c.width,
          h: c.height,
        })),
      };
    });

    fs.writeFileSync(
      path.join(SHOTS, "inspect.json"),
      JSON.stringify(dump, null, 2),
      "utf8"
    );
    console.log(JSON.stringify(dump, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
