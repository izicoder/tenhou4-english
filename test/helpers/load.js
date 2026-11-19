"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(
  path.join(__dirname, "..", "..", "tenhou4-english.user.js"),
  "utf8"
);

/**
 * Load the userscript into a jsdom window.
 * @param {string} html
 * @param {string} url
 * @param {{ beforeEval?: (win: Window) => void }} [opts]
 */
function load(html, url, opts = {}) {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  if (opts.beforeEval) opts.beforeEval(dom.window);

  dom.window.eval(SCRIPT);
  return dom;
}

module.exports = { load, SCRIPT };
