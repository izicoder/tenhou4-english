// ==UserScript==
// @name         Tenhou /4 English + Compact Tile Names
// @name:ja      天鳳 /4 英語化 + 英語牌名
// @namespace    https://github.com/local/tenhou4-english
// @version      0.3.2
// @description  Completes the English UI on tenhou.net/4 (Desktop4K) and draws always-on compact English tile names over every face-up tile.
// @author       you
// @match        https://tenhou.net/4/*
// @match        https://tenhou.net/4/
// @match        https://tenhou.net/man/*
// @match        https://tenhou.net/man/
// @match        https://tenhou.net/reg/*
// @match        https://tenhou.net/reg/
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

/*
 * How this works
 * --------------
 * 1. String-table patch (official EN JSON)
 * 2. MutationObserver for hard-coded Japanese strings
 * 3. Compact English tile-name overlay (always on)
 *
 * Tenhou /4 draws tiles on canvases, not DOM tiles. At document-start this
 * script fetches /4/latest.js, injects two tiny hooks into its minified
 * tile-canvas factories, and loads the patched client from a Blob URL. It then
 * wraps CanvasRenderingContext2D.drawImage / clearRect and the canvas width /
 * height setters so transparent overlay canvases stay in sync with every
 * visible game canvas.
 *
 * Labels are permanent: no hotkey, no localStorage on/off switch. Face-down
 * tile backs are skipped. Red fives get a red badge.
 *
 * Debug / verification:
 *   add ?tenhou_en_debug=1 to the URL (or localStorage.tenhou4enDebug = "1")
 *   then run:  __tenhou4en.tileOverlay.dump()
 * If Tenhou ships a new minified client and a patch point moves, the dump
 * includes the exact snippets needed to update the replacements below.
 */

(function () {
  "use strict";

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__tenhou4enInstalled) return;
  W.__tenhou4enInstalled = true;
  window.__tenhou4enInstalled = true;

  const D = W.document;

  const DEBUG =
    /[?&]tenhou_en_debug=1\b/.test(W.location.search) ||
    (() => {
      try {
        return W.localStorage.getItem("tenhou4enDebug") === "1";
      } catch (e) {
        return false;
      }
    })();

  const IS_DESKTOP4K = /^\/4\//.test(W.location.pathname);

  // ===================================================================
  // COMPACT ENGLISH TILE NAMES  (always on)
  // ===================================================================

  const TILE_LABELS = {
    0: "5m", 10: "5p", 20: "5s",       // red fives (aka)
    1: "1m", 2: "2m", 3: "3m", 4: "4m", 5: "5m", 6: "6m", 7: "7m", 8: "8m", 9: "9m",
    11: "1p", 12: "2p", 13: "3p", 14: "4p", 15: "5p", 16: "6p", 17: "7p", 18: "8p", 19: "9p",
    21: "1s", 22: "2s", 23: "3s", 24: "4s", 25: "5s", 26: "6s", 27: "7s", 28: "8s", 29: "9s",
    30: "E", 31: "S", 32: "W", 33: "N",
    34: "Haku", 35: "Hatsu", 36: "Chun",
  };
  const AKA_CODES = new Set([0, 10, 20]);
  const SKIP_CODES = new Set([37, 255]); // tile back / unknown

  const CRC2D = W.CanvasRenderingContext2D;
  const HCE = W.HTMLCanvasElement;
  const HSE = W.HTMLScriptElement;
  const ELEM = W.Element;
  const CAN_HOOK = !!(CRC2D && HCE && HSE && ELEM);

  const trackedCanvases = new Set();
  const visibilityCache = new WeakMap();
  const overlayRecords = new WeakMap();
  const raf = W.requestAnimationFrame
    ? W.requestAnimationFrame.bind(W)
    : (cb) => W.setTimeout(cb, 16);

  const clientHook = {
    attempted: false,
    patched: false,
    requestUrl: "",
    finalUrl: "",
    codeLength: 0,
    patchedLength: 0,
    applied: [],
    errors: [],
    snippets: {},
    blobUrl: "",
    scanned: 0,
    replaced: 0,
    alreadyLoaded: false,
    reloadWarned: false,
    insertionHooks: false,
    observer: false,
    styleObserver: false,
    styleInvalidations: 0,
    disabledReason: IS_DESKTOP4K ? "" : "not a /4/ page",
  };

  const tileOverlay = {
    version: "0.3.2",
    mode: "compact",
    scope: "all face-up tiles",
    enabled: true,
    toggle: false,
    hotkey: null,
    labels: TILE_LABELS,
    aka: Array.from(AKA_CODES),
    stats: { draws: 0, labels: 0, clears: 0, overlays: 0, errors: [] },
    dump() {
      const overlays = [];
      for (const c of Array.from(trackedCanvases)) {
        const rec = overlayRecords.get(c);
        if (!rec) continue;
        overlays.push({
          canvas: {
            tagName: c.tagName,
            className: c.className || "",
            width: c.width,
            height: c.height,
            connected: !!c.isConnected,
          },
          labelCount: rec.labels.size,
          sample: Array.from(rec.labels.values()).slice(0, 8).map((l) => ({
            code: l.code,
            name: l.name,
            aka: l.aka,
            x: Math.round(l.rect.x),
            y: Math.round(l.rect.y),
            w: Math.round(l.rect.w),
            h: Math.round(l.rect.h),
          })),
        });
      }
      return {
        version: this.version,
        mode: this.mode,
        scope: this.scope,
        enabled: this.enabled,
        desktop4k: IS_DESKTOP4K,
        canHook: CAN_HOOK,
        debug: DEBUG,
        client: JSON.parse(JSON.stringify(clientHook)),
        stats: Object.assign({}, this.stats, { errors: this.stats.errors.slice() }),
        overlays,
      };
    },
    report() {
      return JSON.stringify(this.dump(), null, 2);
    },
    forceRedraw() {
      for (const c of Array.from(trackedCanvases)) {
        const rec = overlayRecords.get(c);
        if (rec) rec.dirty = true;
      }
      return true;
    },
  };

  function pushClientError(msg) {
    if (clientHook.errors.length < 20) clientHook.errors.push(String(msg));
  }

  function recordError(e) {
    const msg = (e && (e.stack || e.message)) || String(e);
    if (tileOverlay.stats.errors.length < 20) tileOverlay.stats.errors.push(msg);
    if (DEBUG) W.console.warn("[tenhou4-en] tile overlay error:", e);
  }

  function isOverlayCanvas(canvas) {
    return !!(
      canvas &&
      canvas.classList &&
      canvas.classList.contains("tenhou4en-tile-overlay")
    );
  }

  function isClientScriptUrl(value) {
    try {
      return new W.URL(String(value), W.location.href).pathname === "/4/latest.js";
    } catch (e) {
      return /\/4\/latest\.js(?:\?|$)/.test(String(value));
    }
  }

  function snippet(code, needle) {
    const i = code.indexOf(needle);
    if (i < 0) return null;
    return code.slice(
      Math.max(0, i - 140),
      Math.min(code.length, i + needle.length + 180)
    );
  }

  function patchClientScript(code) {
    const applied = [];
    const errors = [];
    const snippets = {};

    function exact(from, to, label) {
      const i = code.indexOf(from);
      if (i < 0) {
        errors.push("missing " + label);
        snippets[label] = snippet(code, from);
        return false;
      }
      code = code.replace(from, to);
      applied.push(label);
      return true;
    }

    const gFrom = ";return p}function e(h,a,n,p,q){";
    const gTo =
      ";p.ea.canvas.__tenhou4enTileKey=h;return p}function e(h,a,n,p,q){";
    if (!exact(gFrom, gTo, "g-canvas")) {
      const re =
        /function\s+g\(h,a\)\{[\s\S]*?return p\}\s*function\s+e\(h,a,n,p,q\)\{/;
      const m = re.exec(code);
      if (m) {
        const injected = m[0].replace(
          "return p}",
          "p.ea.canvas.__tenhou4enTileKey=h;return p}"
        );
        code =
          code.slice(0, m.index) +
          injected +
          code.slice(m.index + m[0].length);
        applied.push("g-canvas-regex");
      } else {
        errors.push("g-canvas regex did not match");
        snippets["g-function"] = snippet(code, "function g(h,a){");
      }
    }

    const eFrom = "f(r,Ac.zb(a,0));return{ea:r,s:a.s,da:q}";
    const eTo =
      "f(r,Ac.zb(a,0));r.canvas.__tenhou4enTileKey=a.oa;return{ea:r,s:a.s,da:q}";
    if (!exact(eFrom, eTo, "e-canvas")) {
      const re =
        /function\s+e\(h,a,n,p,q\)\{[\s\S]*?return\{ea:r,s:a\.s,da:q\}\}/;
      const m = re.exec(code);
      if (m) {
        const injected = m[0].replace(
          "return{ea:r,s:a.s,da:q}",
          "r.canvas.__tenhou4enTileKey=a.oa;return{ea:r,s:a.s,da:q}"
        );
        code =
          code.slice(0, m.index) +
          injected +
          code.slice(m.index + m[0].length);
        applied.push("e-canvas-regex");
      } else {
        errors.push("e-canvas regex did not match");
        snippets["e-function"] = snippet(code, "function e(h,a,n,p,q){");
      }
    }

    // Fallback for the main board when the g() cache hook could not be applied.
    if (!applied.some((a) => a.indexOf("g-canvas") === 0)) {
      const aaFrom =
        "a.drawImage(m[n].ea.canvas,x.x-u,x.y-v,x.w,x.i,x.x,x.y,x.w,x.i),++wc.gg";
      const aaTo =
        "window.__tenhou4enTileDraw&&window.__tenhou4enTileDraw(p.c.oa,{x:x.x,y:x.y,w:x.w,i:x.i},a.canvas)," +
        aaFrom;
      exact(aaFrom, aaTo, "aa-draw");
    }

    if (applied.length) {
      code += "\n/* tenhou4-en tile hooks: " + applied.join(", ") + " */\n";
    }
    return { ok: applied.length > 0, code, applied, errors, snippets };
  }

  function fetchAndPatch(rawUrl) {
    const url = new W.URL(String(rawUrl), W.location.href).href;
    clientHook.requestUrl = url;
    clientHook.attempted = true;
    let code;
    try {
      const xhr = new W.XMLHttpRequest();
      xhr.open("GET", url, false);
      if (xhr.overrideMimeType) xhr.overrideMimeType("text/plain; charset=utf-8");
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        throw new Error("HTTP " + xhr.status);
      }
      code = xhr.responseText;
      clientHook.finalUrl = xhr.responseURL || url;
      clientHook.codeLength = code.length;
    } catch (e) {
      pushClientError("fetch failed: " + ((e && e.message) || e));
      recordError(e);
      return false;
    }

    const result = patchClientScript(code);
    clientHook.applied = result.applied.slice();
    for (const msg of result.errors) pushClientError(msg);
    clientHook.snippets = result.snippets;
    clientHook.patchedLength = result.code.length;

    if (!result.ok) {
      pushClientError("no tile patch points matched; client script left unpatched");
      if (DEBUG) W.console.warn("[tenhou4-en] tile overlay patch failed", result);
      return false;
    }

    let blobUrl = "";
    try {
      const blob = new W.Blob([result.code], {
        type: "text/javascript;charset=utf-8",
      });
      blobUrl = W.URL.createObjectURL(blob);
    } catch (e) {
      blobUrl =
        "data:text/javascript;charset=utf-8," + encodeURIComponent(result.code);
      pushClientError("Blob URL unavailable, used data URL: " + ((e && e.message) || e));
    }
    clientHook.blobUrl = blobUrl;
    clientHook.patched = true;
    if (DEBUG) {
      W.console.log(
        "%c[tenhou4-en] tile hooks applied:",
        "color:#0a0;font-weight:bold",
        result.applied.join(", "),
        clientHook.finalUrl
      );
    }
    return true;
  }

  function resolveClientUrl(value) {
    const raw = String(value);
    if (!isClientScriptUrl(raw)) return raw;
    if (!clientHook.attempted) fetchAndPatch(raw);
    return clientHook.patched && clientHook.blobUrl
      ? clientHook.blobUrl
      : raw;
  }

  function resourceAlreadyLoaded(raw) {
    try {
      const full = new W.URL(raw, W.location.href).href;
      const perf = W.performance;
      if (perf && perf.getEntriesByType) {
        const entries = perf.getEntriesByType("resource");
        for (const e of entries) {
          if (e.name === full && e.responseEnd > 0) return true;
        }
      }
    } catch (e) { }
    return false;
  }

  function patchExistingScript(script) {
    if (!script || script.__tenhou4enPatched) return false;
    const tag = script.tagName ? script.tagName.toUpperCase() : "";
    if (tag !== "SCRIPT") return false;
    const raw = script.getAttribute("src") || script.src || "";
    if (!raw || !isClientScriptUrl(raw)) return false;

    const loaded =
      script.dataset.tenhou4enLoaded === "1" ||
      script.readyState === "complete" ||
      script.readyState === "loaded" ||
      resourceAlreadyLoaded(raw);
    if (loaded) {
      clientHook.alreadyLoaded = true;
      clientHook.disabledReason = "client script already loaded; reload required";
      if (!clientHook.reloadWarned) {
        clientHook.reloadWarned = true;
        pushClientError(
          "client script was already loaded before the hooks were installed; reload the page with the userscript enabled"
        );
        if (DEBUG) {
          W.console.warn(
            "[tenhou4-en] tile overlay: /4/latest.js already loaded; please reload once"
          );
        }
      }
      return false;
    }

    const patchedUrl = resolveClientUrl(raw);
    if (!clientHook.patched || patchedUrl === raw) return false;
    script.__tenhou4enPatched = true;
    script.dataset.tenhou4enPatched = "1";
    script.addEventListener(
      "load",
      () => {
        script.dataset.tenhou4enLoaded = "1";
      },
      { once: true }
    );
    // setAttribute works even when the src property setter lives in another
    // DOM wrapper world; resolveClientUrl() leaves Blob/data URLs untouched.
    script.setAttribute("src", patchedUrl);
    clientHook.replaced++;
    if (DEBUG) {
      W.console.log(
        "[tenhou4-en] rewrote pending /4/latest.js to patched Blob URL"
      );
    }
    return true;
  }

  function patchScriptTree(node) {
    if (!node) return 0;
    if (node.nodeType === 1) {
      const tag = node.tagName ? node.tagName.toUpperCase() : "";
      if (tag === "SCRIPT") return patchExistingScript(node) ? 1 : 0;
    }
    if (node.nodeType === 1 || node.nodeType === 11) {
      let count = 0;
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) count += patchScriptTree(kids[i]);
      return count;
    }
    return 0;
  }

  function scanExistingClientScripts() {
    clientHook.scanned++;
    const scripts = D.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) patchExistingScript(scripts[i]);
  }

  function ensureOverlayForCanvas(canvas) {
    if (!canvas || isOverlayCanvas(canvas)) return false;
    if (canvas.tagName !== "CANVAS") return false;
    if (!(canvas.width > 100 && canvas.height > 100)) return false;
    if (!canvas.parentNode) return false;
    if (!overlayRecords.has(canvas)) getOverlay(canvas);
    visibilityCache.delete(canvas);
    return true;
  }

  function ensureOverlayForTree(node) {
    if (!node) return 0;
    if (node.nodeType === 1 && node.tagName === "CANVAS") {
      return ensureOverlayForCanvas(node) ? 1 : 0;
    }
    if (node.nodeType === 1 || node.nodeType === 9 || node.nodeType === 11) {
      let count = 0;
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) count += ensureOverlayForTree(kids[i]);
      return count;
    }
    return 0;
  }

  function installInsertionHooks() {
    const nodeProto = W.Node && W.Node.prototype;
    if (!nodeProto) {
      pushClientError("Node.prototype unavailable for insertion hooks");
      return;
    }
    let ok = false;
    for (const method of ["appendChild", "insertBefore"]) {
      const desc = Object.getOwnPropertyDescriptor(nodeProto, method);
      if (!desc || !desc.value || !desc.configurable) {
        pushClientError(method + " descriptor unavailable");
        continue;
      }
      const nativeMethod = desc.value;
      Object.defineProperty(nodeProto, method, {
        configurable: true,
        enumerable: desc.enumerable,
        writable: true,
        value: function (node) {
          try {
            patchScriptTree(node);
          } catch (e) {
            recordError(e);
          }
          return nativeMethod.apply(this, arguments);
        },
      });
      ok = true;
    }
    clientHook.insertionHooks = ok;
  }

  function installClientObserver() {
    if (!W.MutationObserver) {
      pushClientError("MutationObserver unavailable");
      return;
    }
    try {
      const mo = new W.MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            patchScriptTree(n);
            ensureOverlayForTree(n);
            if (n.nodeType === 1 && n.tagName === "CANVAS") {
              visibilityCache.delete(n);
            }
          }
        }
      });
      mo.observe(D, { childList: true, subtree: true });
      clientHook.observer = true;
    } catch (e) {
      pushClientError("MutationObserver failed: " + ((e && e.message) || e));
      recordError(e);
    }
  }

  function scanAll() {
    scanExistingClientScripts();
    ensureOverlayForTree(D.documentElement || D);
  }

  function installStyleObserver() {
    if (!W.MutationObserver) {
      pushClientError("MutationObserver unavailable for style observer");
      return;
    }
    try {
      const mo = new W.MutationObserver((muts) => {
        for (const m of muts) {
          const t = m.target;
          if (t && t.tagName === "CANVAS") {
            visibilityCache.delete(t);
            const rec = overlayRecords.get(t);
            if (rec) rec.dirty = true;
            clientHook.styleInvalidations++;
          }
        }
      });
      mo.observe(D, {
        attributes: true,
        attributeFilter: ["style", "class"],
        subtree: true,
      });
      clientHook.styleObserver = true;
    } catch (e) {
      pushClientError("style observer failed: " + ((e && e.message) || e));
      recordError(e);
    }
  }

  function scheduleScans() {
    scanAll();
    W.setTimeout(scanAll, 0);
    W.setTimeout(scanAll, 50);
    W.setTimeout(scanAll, 250);
    D.addEventListener("DOMContentLoaded", scanAll, { once: true });
  }

  function normalizeRect(r) {
    if (!r) return null;
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w != null ? r.w : r.width);
    const hRaw = r.h != null ? r.h : r.i != null ? r.i : r.height;
    const h = Number(hRaw);
    if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function intersects(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function parseDrawArgs(img, args) {
    const n = args.length;
    const iw = Number(img && (img.width || img.naturalWidth)) || 0;
    const ih = Number(img && (img.height || img.naturalHeight)) || 0;
    if (n >= 8) {
      const sx = Number(args[0]), sy = Number(args[1]);
      const sw = Number(args[2]), sh = Number(args[3]);
      const dx = Number(args[4]), dy = Number(args[5]);
      const dw = Number(args[6]), dh = Number(args[7]);
      if (![sx, sy, sw, sh, dx, dy, dw, dh].every((v) => Number.isFinite(v))) {
        return null;
      }
      if (sw <= 0 || sh <= 0) return null;
      const scaleX = dw / sw;
      const scaleY = dh / sh;
      return normalizeRect({
        x: dx - sx * scaleX,
        y: dy - sy * scaleY,
        w: (iw || sw) * scaleX,
        h: (ih || sh) * scaleY,
      });
    }
    if (n >= 4) {
      return normalizeRect({ x: args[0], y: args[1], w: args[2], h: args[3] });
    }
    if (n >= 2) {
      return normalizeRect({ x: args[0], y: args[1], w: iw, h: ih });
    }
    return null;
  }

  function isVisibleCanvas(canvas) {
    if (!canvas || canvas.isConnected === false || isOverlayCanvas(canvas)) {
      return false;
    }
    if (!(canvas.width > 0 && canvas.height > 0)) return false;
    const now = Date.now();
    const cached = visibilityCache.get(canvas);
    if (cached && now - cached.ts < 16) return cached.value;
    let visible = true;
    try {
      if (canvas.getClientRects && canvas.getClientRects().length === 0) {
        visible = false;
      }
      const cs = W.getComputedStyle(canvas);
      if (cs.display === "none" || cs.visibility === "hidden") visible = false;
    } catch (e) {
      visible = false;
    }
    visibilityCache.set(canvas, { value: visible, ts: now });
    return visible;
  }

  function getOverlay(canvas) {
    let rec = overlayRecords.get(canvas);
    if (rec) return rec;
    if (!canvas.parentNode) return null;

    const overlay = D.createElement("canvas");
    overlay.className = "tenhou4en-tile-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const s = overlay.style;
    s.position = "absolute";
    s.left = "0";
    s.top = "0";
    s.pointerEvents = "none";
    let cw = canvas.style.width;
    let ch = canvas.style.height;
    try {
      const cs = W.getComputedStyle(canvas);
      if (!cw) cw = cs.width;
      if (!ch) ch = cs.height;
    } catch (e) { }
    s.width = cw || "100%";
    s.height = ch || "100%";
    canvas.parentNode.insertBefore(overlay, canvas.nextSibling);

    rec = {
      overlay,
      labels: new Map(),
      width: 0,
      height: 0,
      dirty: true,
    };
    overlayRecords.set(canvas, rec);
    trackedCanvases.add(canvas);
    tileOverlay.stats.overlays++;
    return rec;
  }

  function syncOverlay(canvas, rec) {
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w <= 0 || h <= 0) return false;
    const o = rec.overlay;
    if (o.width !== w || o.height !== h) {
      o.width = w;
      o.height = h;
      rec.width = w;
      rec.height = h;
      rec.labels.clear();
      rec.dirty = true;
    }
    let cw = canvas.style.width;
    let ch = canvas.style.height;
    try {
      const cs = W.getComputedStyle(canvas);
      if (!cw) cw = cs.width;
      if (!ch) ch = cs.height;
    } catch (e) { }
    if (cw && o.style.width !== cw) o.style.width = cw;
    if (ch && o.style.height !== ch) o.style.height = ch;
    return true;
  }

  function clearOverlayRect(canvas, r) {
    if (isOverlayCanvas(canvas)) return;
    const rec = overlayRecords.get(canvas);
    if (!rec) return;
    visibilityCache.delete(canvas);
    syncOverlay(canvas, rec);
    for (const [id, label] of rec.labels) {
      if (intersects(label.rect, r)) rec.labels.delete(id);
    }
    const octx = rec.overlay.getContext("2d");
    if (octx) octx.clearRect(r.x, r.y, r.w, r.h);
    rec.dirty = true;
  }

  function resetCanvas(canvas) {
    if (isOverlayCanvas(canvas)) return;
    visibilityCache.delete(canvas);
    const rec = overlayRecords.get(canvas);
    if (!rec) return;
    rec.labels.clear();
    rec.dirty = true;
    const octx = rec.overlay.getContext("2d");
    if (octx) octx.clearRect(0, 0, rec.overlay.width, rec.overlay.height);
  }

  function addTileLabel(key, rawRect, canvas) {
    if (!canvas || isOverlayCanvas(canvas) || !isVisibleCanvas(canvas)) return;
    const rect = normalizeRect(rawRect);
    if (!rect) return;
    const k = Number(key);
    if (!Number.isFinite(k)) return;
    const code = (k >>> 16) & 255;
    if (SKIP_CODES.has(code)) return;
    const name = TILE_LABELS[code];
    if (!name) return;
    const rec = getOverlay(canvas);
    if (!rec) return;
    const id = (k & 0xffffff) >>> 0;
    rec.labels.set(id, {
      key: k,
      code,
      name,
      aka: AKA_CODES.has(code),
      rect,
    });
    rec.dirty = true;
    tileOverlay.stats.labels++;
    if (DEBUG && tileOverlay.stats.labels <= 8) {
      W.console.log(
        "[tenhou4-en] tile label",
        name,
        "code=" + code,
        "@" + Math.round(rect.x) + "," + Math.round(rect.y)
      );
    }
  }

  function drawLabel(ctx, label) {
    const r = label.rect;
    ctx.save();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    let fontSize = Math.max(5, Math.min(r.w * 0.42, r.h * 0.34, 20));
    const setFont = () => {
      ctx.font = '700 ' + fontSize + 'px "Segoe UI", Arial, sans-serif';
    };
    const padX = () => Math.max(1, fontSize * 0.2);
    const padY = () => Math.max(1, fontSize * 0.14);
    setFont();
    let textW = ctx.measureText(label.name).width;
    const maxW = r.w - padX() * 2 - 1;
    if (maxW > 0 && textW > maxW) {
      fontSize = Math.max(4, Math.floor((fontSize * maxW) / textW));
      setFont();
      textW = ctx.measureText(label.name).width;
    }
    const boxW = textW + padX() * 2;
    const boxH = fontSize + padY() * 2;
    const x = r.x + Math.max(1, r.w * 0.04);
    const y = r.y + Math.max(1, r.h * 0.04);
    ctx.lineWidth = Math.max(0.5, fontSize * 0.06);
    ctx.fillStyle = label.aka
      ? "rgba(190,25,25,0.9)"
      : "rgba(255,255,255,0.88)";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 2;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.shadowBlur = 0;
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = label.aka ? "#fff" : "#111";
    ctx.fillText(label.name, x + padX(), y + padY());
    ctx.restore();
  }

  function renderFrame() {
    for (const canvas of Array.from(trackedCanvases)) {
      const rec = overlayRecords.get(canvas);
      if (!rec) {
        trackedCanvases.delete(canvas);
        continue;
      }
      if (!canvas.isConnected || !isVisibleCanvas(canvas)) {
        rec.labels.clear();
        const octx = rec.overlay.getContext("2d");
        if (octx) octx.clearRect(0, 0, rec.overlay.width, rec.overlay.height);
        rec.dirty = false;
        continue;
      }
      if (!syncOverlay(canvas, rec)) continue;
      if (!rec.dirty) continue;
      const octx = rec.overlay.getContext("2d");
      if (!octx) continue;
      octx.clearRect(0, 0, rec.overlay.width, rec.overlay.height);
      for (const label of rec.labels.values()) drawLabel(octx, label);
      rec.dirty = false;
    }
    raf(renderFrame);
  }

  function installCanvasHooks() {
    W.__tenhou4enTileDraw = addTileLabel;
    window.__tenhou4enTileDraw = addTileLabel;

    const drawDesc = Object.getOwnPropertyDescriptor(CRC2D.prototype, "drawImage");
    if (drawDesc && drawDesc.value && drawDesc.configurable) {
      const nativeDrawImage = drawDesc.value;
      Object.defineProperty(CRC2D.prototype, "drawImage", {
        configurable: true,
        enumerable: drawDesc.enumerable,
        writable: true,
        value: function (img) {
          const res = nativeDrawImage.apply(this, arguments);
          try {
            if (!img || img.__tenhou4enTileKey == null) return res;
            const canvas = this.canvas;
            if (!canvas || !isVisibleCanvas(canvas)) return res;
            const args = Array.prototype.slice.call(arguments, 1);
            const rect = parseDrawArgs(img, args);
            if (!rect) return res;
            tileOverlay.stats.draws++;
            addTileLabel(img.__tenhou4enTileKey, rect, canvas);
          } catch (e) {
            recordError(e);
          }
          return res;
        },
      });
    } else {
      pushClientError("drawImage descriptor unavailable");
    }

    const clearDesc = Object.getOwnPropertyDescriptor(CRC2D.prototype, "clearRect");
    if (clearDesc && clearDesc.value && clearDesc.configurable) {
      const nativeClearRect = clearDesc.value;
      Object.defineProperty(CRC2D.prototype, "clearRect", {
        configurable: true,
        enumerable: clearDesc.enumerable,
        writable: true,
        value: function (x, y, w, h) {
          const res = nativeClearRect.apply(this, arguments);
          try {
            const canvas = this.canvas;
            if (!canvas || isOverlayCanvas(canvas) || !isVisibleCanvas(canvas)) {
              return res;
            }
            const r = normalizeRect({ x, y, w, h });
            if (!r) return res;
            tileOverlay.stats.clears++;
            clearOverlayRect(canvas, r);
          } catch (e) {
            recordError(e);
          }
          return res;
        },
      });
    } else {
      pushClientError("clearRect descriptor unavailable");
    }

    for (const prop of ["width", "height"]) {
      const desc = Object.getOwnPropertyDescriptor(HCE.prototype, prop);
      if (!desc || !desc.set || !desc.configurable) {
        pushClientError(prop + " descriptor unavailable");
        continue;
      }
      Object.defineProperty(HCE.prototype, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(this);
        },
        set(v) {
          const res = desc.set.call(this, v);
          try {
            if (!isOverlayCanvas(this)) resetCanvas(this);
          } catch (e) {
            recordError(e);
          }
          return res;
        },
      });
    }
  }

  function installScriptHooks() {
    const srcDesc = Object.getOwnPropertyDescriptor(HSE.prototype, "src");
    if (srcDesc && srcDesc.set && srcDesc.configurable) {
      Object.defineProperty(HSE.prototype, "src", {
        configurable: true,
        enumerable: srcDesc.enumerable,
        get() {
          return srcDesc.get.call(this);
        },
        set(value) {
          return srcDesc.set.call(this, resolveClientUrl(value));
        },
      });
    } else {
      pushClientError("HTMLScriptElement.src descriptor unavailable");
    }

    const setAttrDesc = Object.getOwnPropertyDescriptor(ELEM.prototype, "setAttribute");
    if (setAttrDesc && setAttrDesc.value && setAttrDesc.configurable) {
      const nativeSetAttribute = setAttrDesc.value;
      Object.defineProperty(ELEM.prototype, "setAttribute", {
        configurable: true,
        enumerable: setAttrDesc.enumerable,
        writable: true,
        value: function (name, value) {
          const lname = String(name).toLowerCase();
          const tag = this.tagName ? this.tagName.toUpperCase() : "";
          if (tag === "SCRIPT" && lname === "src") {
            return nativeSetAttribute.call(this, name, resolveClientUrl(value));
          }
          const result = nativeSetAttribute.call(this, name, value);
          if (tag === "CANVAS" && (lname === "width" || lname === "height")) {
            try {
              if (!isOverlayCanvas(this)) resetCanvas(this);
            } catch (e) {
              recordError(e);
            }
          }
          return result;
        },
      });
    } else {
      pushClientError("Element.setAttribute descriptor unavailable");
    }
  }

  function installTileOverlay() {
    if (!IS_DESKTOP4K) {
      clientHook.disabledReason = "not a /4/ page";
      return;
    }
    if (!CAN_HOOK) {
      pushClientError("required DOM constructors missing; tile overlay disabled");
      if (DEBUG) {
        W.console.warn("[tenhou4-en] tile overlay: DOM constructors missing");
      }
      return;
    }
    installCanvasHooks();
    installScriptHooks();
    installInsertionHooks();
    installClientObserver();
    installStyleObserver();
    scheduleScans();
    raf(renderFrame);
    if (DEBUG) {
      W.console.log(
        "%c[tenhou4-en] tile overlay installed (compact, always on)",
        "color:#0a0;font-weight:bold"
      );
    }
  }

  installTileOverlay();

  // ---------------------------------------------------------------- language
  try {
    W.localStorage.setItem("lang", "en");
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

  const XHR = W.XMLHttpRequest.prototype;
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

  // Tile overlay hooks are installed above, before /4/latest.js loads.

  // Debug helper
  const debugApi = {
    yaku: YAKU,
    ranks: RANKS,
    misc: MISC,
    overrides: TABLE_OVERRIDES,
    patchTable,
    translateString,
    translateTextNode,
    walk,
    tileOverlay,
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
  W.__tenhou4en = debugApi;
  window.__tenhou4en = debugApi;

  console.log(
    "%c[tenhou4-en] v0.3.2 loaded - compact English tile names are always on" +
    (IS_DESKTOP4K ? "" : " (tile overlay: /4 only)"),
    "color:#0a0;font-weight:bold"
  );
  if (DEBUG && IS_DESKTOP4K) {
    console.log(
      "[tenhou4-en] verify tile hooks with: __tenhou4en.tileOverlay.report()"
    );
  }
})();
