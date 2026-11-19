# Tenhou /4 full English (userscript)

Fills in the gaps left by the official English option on the
[Tenhou Desktop4K client](https://tenhou.net/4/).

## What it does

1. **Forces the client to English** by setting `localStorage.lang = "en"`
   before `latest.js` runs.
2. **Completes the official EN string table.** The client loads
   `https://cdn.tenhou.net/4/res/lang/string<date>_en.json` over XHR. The
   script intercepts that response and merges in translations for the ids the
   official table is missing or leaves in Japanese:
   `20, 214, 223, 224, 225, 226, 300, 301, 341, 1029, 1103`.
3. **Translates the hard-coded Japanese** that never goes through the string
   table — yaku names, rank names, room names and counters — by replacing text
   nodes in the DOM as they appear (MutationObserver).

## Install

### Tampermonkey / Violentmonkey

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open `tenhou4-english.user.js` and confirm the install.
3. Go to <https://tenhou.net/4/>.

### Manual (no manager)

Paste the contents of `tenhou4-english.user.js` into the browser console
**before** the client loads, or add it as a `document_start` content script in
an MV3 extension with `"world": "MAIN"`.

## Debug mode

Open <https://tenhou.net/4/?tenhou_en_debug=1>, or run this once in the
console:

```js
localStorage.setItem("tenhou4enDebug", "1");
```

Unknown Japanese text nodes are then logged as:

```
[tenhou4-en] untranslated: "何とか"
```

To add a translation live:

```js
__tenhou4en.add("何とか", "Something");
```

To list everything still untranslated on the current screen:

```js
__tenhou4en.scan();
```

## Status

- [x] Force English
- [x] Fill missing / untranslated string-table ids
- [x] Yaku / rank / room / counter DOM translation
- [ ] Number-labeled tiles (next step — see `notes/res2-format.md`)

## Notes

- The script runs with `@grant none`, i.e. in page context, so it can patch the
  page's `XMLHttpRequest` and `localStorage`.
- The string-table URL is versioned (`string20220614_…`). The hook matches
  `/res/lang/string\d+_en\.json/` so it survives a version bump.
- The client looks strings up as `hb[lang][id] || hb.en[id] || hb.ja[id]`, so
  filling `en` also fixes any other language that falls back to it.
