"use strict";

/*
 * Quick diagnostic: loads the client with the userscript, waits, and reports
 * what screen it lands on. Used when the coverage harness cannot reach the
 * login panel.
 *
 * Usage: $env:TENHOU_ID="..."; node test/diag.js [--noguest] [--nouserscript]
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const USCRIPT = fs.readFileSync(path.join(ROOT, "tenhou4-english.user.js"), "utf8");

const EDGE = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((p) => fs.existsSync(p));

const PROXY = process.env.SOCKS_PROXY || "socks5://127.0.0.1:10808";

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: process.env.HEADLESS === "1",
    proxy: { server: PROXY },
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
  });
  const context = await browser.newContext({ viewport: null, locale: "en-US" });
  const page = await context.newPage();

  page.on("console", (m) => console.log("[console]", m.text().slice(0, 200)));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("requestfailed", (r) =>
    console.log("[reqfail]", r.url().slice(0, 120), r.failure() && r.failure().errorText)
  );
  page.on("response", (r) => {
    const u = r.url();
    if (/tenhou\.net/.test(u)) console.log("[res]", r.status(), u.slice(0, 110));
  });

  if (!process.argv.includes("--nouserscript")) await page.addInitScript(USCRIPT);

  await page.goto("https://tenhou.net/4/?lang=en", { waitUntil: "load", timeout: 60000 });

  // The splash may wait for a click before showing the login panel.
  await page.waitForTimeout(6000);
  await page.mouse.click(640, 450);
  console.log("[diag] clicked page centre");

  // Dismiss the notice dialog ("OK") and any other modal, then poll.
  for (let i = 0; i < 20; i++) {
    const clicked = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = [...document.querySelectorAll("*")].find(
        (e) =>
          visible(e) &&
          e.childElementCount === 0 &&
          /^OK$/.test((e.textContent || "").trim())
      );
      if (!el) return null;
      const info = el.tagName.toLowerCase() + " " + (el.className || "");
      el.click();
      return info;
    });
    if (clicked) console.log("[diag] clicked OK:", clicked);
    await page.waitForTimeout(1500);
  }

  for (const wait of [0, 3000, 5000]) {
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const inputs = [...document.querySelectorAll("input")].filter(visible);
      const buttons = [...document.querySelectorAll("button, label.btn, [onclick]")]
        .filter(visible)
        .map((el) => ((el.textContent || "").trim() || el.value || "").slice(0, 30))
        .filter(Boolean);
      return {
        title: document.title,
        url: location.href,
        inputs: inputs.length,
        inputInfo: inputs.map((i) => ({ type: i.type, ph: i.placeholder, v: i.value })),
        buttons: [...new Set(buttons)].slice(0, 40),
        bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
      };
    });
    console.log("\n--- after", wait, "ms ---");
    console.log(JSON.stringify(info, null, 2));
  }

  await page.screenshot({ path: path.join(ROOT, "shots", "diag.png") });
  console.log("\nscreenshot: shots/diag.png");

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
