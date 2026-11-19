"use strict";

/*
 * Loads tenhou.net/4 in your installed Edge (headful), injects the userscript
 * before page scripts, screenshots the result, lists any remaining Japanese
 * text, and dumps every .ini received over the resource WebSocket.
 *
 * Usage:
 *   node test/browser-check.js
 *
 * Env:
 *   EDGE_PATH     override the Edge executable
 *   SOCKS_PROXY   default socks5://127.0.0.1:10808
 *   TENHOU_ID     optional: fill this ID into the login panel
 *   HEADLESS=1    run headless
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
  path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe"
  ),
].filter(Boolean);

const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
const PROXY = process.env.SOCKS_PROXY || "socks5://127.0.0.1:10808";

const INIT = `
(() => {
  window.__iniDumps = {};
  window.__xhrUrls = [];
  const OrigWS = window.WebSocket;
  window.WebSocket = new Proxy(OrigWS, {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener("message", (ev) => {
        try {
          const j = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (j && j.tag === "FILE" && typeof j.name === "string" && j.name.endsWith(".ini")) {
            window.__iniDumps[j.name] = atob(j.content);
          }
        } catch (e) {}
      });
      return ws;
    }
  });
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    try { window.__xhrUrls.push(String(u)); } catch (e) {}
    return origOpen.apply(this, arguments);
  };
})();
`;

async function dismissModals(page) {
  const clicked = await page.evaluate(() => {
    const visible = (el) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const btn = [...document.querySelectorAll("button")].find(
      (b) => visible(b) && /^(OK|Close|×|✕)$/i.test((b.textContent || "").trim())
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  return clicked;
}

async function waitForLogin(page) {
  const deadline = Date.now() + 90000;

  while (Date.now() < deadline) {
    const clicked = await dismissModals(page);
    if (clicked) {
      await page.waitForTimeout(800);
      continue;
    }

    const inputs = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return [...document.querySelectorAll("input")].filter(visible).length;
    });

    if (inputs > 0) return true;
    await page.waitForTimeout(1000);
  }

  return false;
}

async function tryLogin(page, id) {
  const clicked = await page.evaluate(() => {
    const visible = (el) =>
      !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const btn = [...document.querySelectorAll("button")].find(
      (b) => visible(b) && /existing\s*id/i.test((b.textContent || "").trim())
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  console.log("[login] clicked Existing ID:", clicked);
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: path.join(SHOTS, "login-existing.png"),
    fullPage: false,
  });

  const info = await page.evaluate(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return {
      inputs: [...document.querySelectorAll("input")].map((i) => ({
        id: i.id,
        type: i.type,
        placeholder: i.placeholder,
        value: i.value,
        visible: visible(i),
      })),
      buttons: [...document.querySelectorAll("button")].map((b) => ({
        id: b.id,
        name: b.name,
        text: (b.textContent || "").trim().slice(0, 40),
        visible: visible(b),
      })),
    };
  });

  console.log("[login] controls:", JSON.stringify(info, null, 2));

  const filled = await page.evaluate((value) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const input = [...document.querySelectorAll("input")].find(
      (i) => visible(i) && (i.type === "text" || i.type === "" || i.type === "search")
    );
    if (!input) return false;

    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, id);

  console.log("[login] filled ID field:", filled);

  if (filled) {
    // The dialog's OK is not necessarily a <button>; pick the smallest
    // visible element whose text is exactly OK.
    const submitted = await page.evaluate(() => {
      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const ok = [...document.querySelectorAll(
        "button, input, [role=button], div, span, a"
      )]
        .filter((el) => {
          const label = ((el.textContent || "") + " " + (el.value || "")).trim();
          return visible(el) && /^(OK|LOGIN|LOG IN)$/i.test(label);
        })
        .sort((a, b) => a.childElementCount - b.childElementCount)[0];

      if (ok) {
        const label = ((ok.textContent || "") + " " + (ok.value || "")).trim();
        ok.click();
        return label;
      }
      return null;
    });

    console.log("[login] submitted via:", submitted);
    if (!submitted) await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(6000);

    await page.screenshot({
      path: path.join(SHOTS, "after-login.png"),
      fullPage: false,
    });
  }
}

(async () => {
  if (!EDGE) {
    throw new Error(
      "Edge not found. Set EDGE_PATH to msedge.exe."
    );
  }

  fs.mkdirSync(SHOTS, { recursive: true });

  console.log("Edge:  ", EDGE);
  console.log("Proxy: ", PROXY);

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

  const context = await browser.newContext({
    viewport: null,
    locale: "en-US",
  });

  const page = await context.newPage();
  const logs = [];

  page.on("console", (m) => {
    const line = `[${m.type()}] ${m.text()}`;
    logs.push(line);
    console.log("[page]", line);
  });
  page.on("pageerror", (e) => {
    const line = `[pageerror] ${e.message}`;
    logs.push(line);
    console.log(line);
  });
  page.on("dialog", async (d) => {
    logs.push(`[dialog] ${d.message()}`);
    console.log("[dialog]", d.message());
    await d.dismiss().catch(() => {});
  });

  try {
    await page.addInitScript(INIT + "\n" + USCRIPT);

    await page.goto("https://tenhou.net/4/?lang=en", {
      waitUntil: "load",
      timeout: 60000,
    });

    await page.waitForSelector("canvas", { timeout: 60000 }).catch(() => {});

    const ready = await waitForLogin(page);
    console.log("[wait] login panel ready:", ready);

    if (ready && process.env.TENHOU_ID) {
      await tryLogin(page, process.env.TENHOU_ID);
    }

    const hold = Number(process.env.HOLD_SECONDS || 0);
    if (hold > 0) {
      console.log(`[hold] window is open for ${hold}s — log in / play now`);
      const start = Date.now();
      let i = 0;
      while (Date.now() - start < hold * 1000) {
        await page.waitForTimeout(10000);
        i++;
        await page.screenshot({
          path: path.join(SHOTS, `hold-${String(i).padStart(2, "0")}.png`),
          fullPage: false,
        });
        const jp = await page.evaluate(() =>
          [
            ...new Set(
              [
                ...((document.body.innerText || "").matchAll(
                  /[\u3040-\u30ff\u4e00-\u9fff]+/g
                ) || []),
              ].map((m) => m[0])
            ),
          ]
        );
        console.log(`[hold ${i}]`, jp.length ? jp : "(no Japanese)");
      }
    }

    await page.waitForTimeout(3000);

    await page.screenshot({
      path: path.join(SHOTS, "tenhou4-en.png"),
      fullPage: false,
    });

    const report = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const jp = [
        ...new Set(
          [...text.matchAll(/[\u3040-\u30ff\u4e00-\u9fff]+/g)].map((m) => m[0])
        ),
      ];

      const visible = (el) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

      return {
        title: document.title,
        lang: localStorage.getItem("lang"),
        installed: !!window.__tenhou4en,
        canvas: document.querySelectorAll("canvas").length,
        japanese: jp,
        noticeHtml: (() => {
          const el = [...document.body.querySelectorAll("*")].find(
            (e) =>
              e.children.length === 0 &&
              /[\u3040-\u30ff\u4e00-\u9fff]/.test(e.textContent || "")
          );
          return el ? el.outerHTML : null;
        })(),
        xhrUrls: [...new Set(window.__xhrUrls || [])],
        ini: window.__iniDumps || {},
        inputs: [...document.querySelectorAll("input")].filter(visible).map((i) => ({
          id: i.id,
          type: i.type,
          placeholder: i.placeholder,
        })),
        buttons: [...document.querySelectorAll("button")]
          .filter(visible)
          .map((b) => ({ id: b.id, text: (b.textContent || "").trim().slice(0, 40) })),
      };
    });

    const iniDir = path.join(SHOTS, "ini");
    fs.mkdirSync(iniDir, { recursive: true });
    for (const [name, content] of Object.entries(report.ini)) {
      const safe = name.replace(/[\\/]/g, "_");
      fs.writeFileSync(path.join(iniDir, safe + ".txt"), content, "utf8");
    }

    const summary = { ...report, ini: Object.keys(report.ini) };
    fs.writeFileSync(
      path.join(SHOTS, "report.json"),
      JSON.stringify(summary, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(SHOTS, "console.log"), logs.join("\n"), "utf8");

    console.log("\n===== SUMMARY =====");
    console.log(JSON.stringify(summary, null, 2));
    console.log("\nScreenshot:", path.join(SHOTS, "tenhou4-en.png"));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
