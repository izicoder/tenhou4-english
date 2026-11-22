# Tenhou /4 English + Tile Labels

A userscript for the [Tenhou Desktop4K client](https://tenhou.net/4/) that

1. **finishes the English UI**: the official `EN` setting still leaves yaku names, ranks, room names, counters and some dialogs in Japanese, and
2. **labels every face-up tile** (`3m`, `7p`, `E`, `Wh`, ...), so you can read your hand at a glance.

It runs inside your browser and only changes what you see. It does not modify the game, play for you, or talk to any server other than the ones the page already uses.

> Unofficial fan project. Not affiliated with or endorsed by Tenhou / C-EGG Inc.

## Install

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
   On recent Chrome and Edge you may also have to enable **Developer mode** (or "Allow user scripts") for the extension.
2. Open [`tenhou4-english.user.js`](tenhou4-english.user.js), click **Raw**, and confirm the install.
3. Open <https://tenhou.net/4/>. The console (F12) should print `[tenhou4-en] vX.Y.Z loaded`.

**Run only one Tenhou /4 userscript at a time.** If a second copy (or another script that does the same job) is enabled, one of them silently bows out and logs a warning.

Tested on Microsoft Edge (Chromium). Other Chromium browsers should work; Firefox is untested.

## Tile labels

Every face-up tile gets a small coloured chip on its face: your hand, all discards, melds, dora indicators and the winning hand in the result popup. Face-down tiles and the wall are left alone.

| Chip | Meaning |
|------|---------|
| red `1m`-`9m` | man (characters) |
| blue `1p`-`9p` | pin (circles) |
| green `1s`-`9s` | sou (bamboo) |
| purple `E` `S` `W` `N` | winds: East, South, West, North |
| purple `Wh` `Gr` `Rd` | dragons: white (haku), green (hatsu), red (chun) |
| **gold** `5m` `5p` `5s` | the red five (aka dora) |

### Settings

There is no settings screen yet. Run these in the browser console (F12), then reload the page:

```js
__tenhou4en.tiles.setPosition("c");     // centre the chip on the tile ("tl" = top-left, default)
__tenhou4en.tiles.setOffset(0.05, 0);   // nudge by a fraction of the tile face (right, down)
__tenhou4en.tiles.setEnabled(false);    // turn the labels off (true = on)
__tenhou4en.tiles.stats();              // counters, useful for bug reports
```

## Translation

- Forces `localStorage.lang = "en"` before the client starts.
- Fills the holes in the official English string table (ids `20, 214, 223-226, 300, 301, 341, 1029, 1103`). The table is intercepted when the client downloads it, so every string the client draws from it is fixed at the source.
- Translates the Japanese that is hard-coded in the client and never goes through the string table: all 67 yaku, ranks (`９級`, `七段`, `天鳳`), room and table names, round and honba counters (`東1局`, `3本場`), limit hands (`満貫` ... `役満`), result and game-over dialogs, and the rank-promotion notice.
- **Player names are never translated.** The script learns names from the game's own messages, so a player called `ドラ` or `平和` stays `ドラ` / `平和`.

### Missing a translation?

Turn on debug mode by opening <https://tenhou.net/4/?tenhou_en_debug=1>. Untranslated Japanese is then logged to the console:

```
[tenhou4-en] untranslated: "何とか"
```

You can add a translation on the fly, or list everything still untranslated on the current screen:

```js
__tenhou4en.add("何とか", "Something");
__tenhou4en.scan();
```

If you find one, please open an issue with the Japanese text and a screenshot of where it appears.

## Known limitations

- The event notice on the start screen (`/ads/eventinfo.js`) changes every week and stays in Japanese. The banner images are pictures and cannot be translated.
- Only the static strings of the `/man/` manual and the `/reg/` purchase page are translated, not the manual's long prose.
- Settings are console commands, not a menu.
- Replays: tile labels work, but player names in replays are not learned, so a name that equals a game term could be translated there.

## Troubleshooting

- **Nothing is translated**: check that the script is enabled and that no second copy is running. The console should show the `loaded` line.
- **Labels missing or in the wrong place**: run `__tenhou4en.tiles.stats()` and look at the numbers. After about 30 seconds of play the script prints a warning on its own if it detects that the labels cannot work, for example after Tenhou updates its client. Please include the stats output in a bug report.
- **Labels look slightly off**: try `setPosition("c")` or `setOffset(...)` above.

## How it works

- **Strings:** the page's `XMLHttpRequest` is wrapped just enough to merge our overrides into the English string table before the client reads it. A `MutationObserver` translates the remaining hard-coded text as it appears, by exact match or anchored pattern.
- **Tiles:** tiles are canvas sprites decoded on demand from the client's `obj*.dat` files. The script watches `Zlib.Inflate` to learn which tile face a sprite is being decoded for and draws the chip onto that sprite right after `putImageData()`. No client code is rewritten and no extra canvas is added.

The script runs with `@grant none`, in the page's own context, and starts at `document-start` so it is in place before the client loads.

## Development

The whole project is the single file `tenhou4-english.user.js`. Edit it and reinstall it in your userscript manager (paste the new contents over the old script).

## License

[MIT](LICENSE)