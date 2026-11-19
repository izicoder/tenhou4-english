"use strict";

/*
 * Dumps every unique text node from a static Tenhou page as JSON, for building
 * translation maps. Not part of the test suite.
 *
 * Usage: node test/dump-static.js https://tenhou.net/reg/
 */

const { JSDOM } = require("jsdom");

const JP = /[\u3040-\u30ff\u4e00-\u9fff]/;

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error("usage: node test/dump-static.js <url>");

  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  let html = buf.toString("utf8");
  if (!JP.test(html) && /charset=shift_jis/i.test(html)) {
    html = new TextDecoder("shift_jis").decode(buf);
  }

  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const out = [];
  const seen = new Set();

  const walker = doc.createTreeWalker(doc.body, 4, null);
  let n;
  while ((n = walker.nextNode())) {
    const text = (n.nodeValue || "").replace(/\s+/g, " ").trim();
    if (!text || !JP.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    const el = n.parentElement;
    out.push({
      text,
      tag: el ? el.tagName.toLowerCase() : null,
      class: el && typeof el.className === "string" ? el.className : null,
      id: el ? el.id || null : null,
    });
  }

  const fs = require("fs");
  const json = JSON.stringify(out, null, 2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], json, "utf8");
  else console.log(json);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
