# Tenhou /4 English + Tile Labels

![version](https://img.shields.io/badge/version-0.8.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![userscript](https://img.shields.io/badge/userscript-Violentmonkey%20%7C%20Tampermonkey-8a4fff?logo=javascript&logoColor=white) ![platform](https://img.shields.io/badge/Tenhou-%2F4%20Desktop4K-e0522b)

A userscript for the [Tenhou /4 (Desktop4K) client](https://tenhou.net/4/) that makes the game readable without knowing Japanese:

- **Finishes the English UI.** The official `EN` setting still leaves yaku names, ranks, room names, counters and some dialogs in Japanese.
- **Labels every face-up tile.** `3m`, `7p`, `E`, `Wh`, ... drawn straight onto the tile face, so you can read your hand at a glance.

It works on the game page only, runs inside your browser and only changes what you *see*. It does not modify the game, play for you, or talk to any server the page does not already use.

> Unofficial fan project. Not affiliated with or endorsed by Tenhou / C-EGG Inc.

## Install

Requires a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) (recommended) or [Tampermonkey](https://www.tampermonkey.net/). On recent Chrome and Edge you may also have to enable **Developer mode** (or "Allow user scripts") for the extension.

**→ [Install the script](https://raw.githubusercontent.com/izicoder/tenhou4-english/master/tenhou4-english.user.js)**

1. Click the link above; your userscript manager asks to confirm the install.
2. Open <https://tenhou.net/4/>.
3. Click the small gear button in the top-left corner to open the settings panel.

> **Run only one Tenhou /4 userscript at a time.** If a second copy (or another script doing the same job) is enabled, one of them silently bows out and logs a warning.

Tested on Microsoft Edge (Chromium). Other Chromium browsers should work; Firefox is untested.

## Updates

The script updates itself. Because you installed it from the link above, your userscript manager checks this repository about once a day and installs new versions automatically.

- **Update now:** use "Check for updates" in your manager's dashboard, or the **Check for updates** button in the settings panel (Panel & data tab). The panel button contacts GitHub only when you click it, and tells you if a newer version exists.
- **Installed it another way** (pasted the code, or from a file)? Install once from the link above so the manager knows where to look. Remove the old copy first, otherwise two copies run.

## Tile labels

Every face-up tile gets a small coloured chip on its face: your hand, all discards, melds, dora indicators and the winning hand in the result popup. Face-down tiles are left alone.

| Chip | Meaning |
|------|---------|
| red `1m`-`9m` | man (characters) |
| blue `1p`-`9p` | pin (circles) |
| green `1s`-`9s` | sou (bamboo) |
| purple `E` `S` `W` `N` | winds: East, South, West, North |
| purple `Wh` `Gr` `Rd` | dragons: white (haku), green (hatsu), red (chun) |
| **gold** `5m` `5p` `5s` | the red five (aka dora) |

## Settings panel

Click the **gear button** in the top-left corner (or press **Alt+T**) to open it. Everything is saved in your browser. Most changes apply immediately; the panel tells you when something needs a reload.

### Tiles tab

| Setting | What it does |
|---|---|
| Show tile labels | Master switch. |
| Which tiles | Choose where labels appear: your hand, discards (all players), melds / dora / result screen, the wall and revealed dora, other players' hands when they are shown. |
| Position | Top-left corner of the tile (default) or centre of the tile. |
| Size, Left / right, Up / down | Make the chips bigger or smaller and nudge them. |
| Opacity | How see-through the chips are. |
| Text | `3m` (number + suit) or `3` (number only; the colour tells the suit). |
| Honors | `E S W N Wh Gr Rd` or `E S W N P F C`. |
| Red fives | `5m` or `0m` on a gold chip. |
| Colours | Standard, High contrast (outlined text) or Colour-blind friendly. |

A live preview at the top of the tab shows what the chips will look like. New tiles use your settings straight away; tiles already on screen keep their old look until you reload (do it between games).

### Translation tab

| Setting | What it does |
|---|---|
| Translate hard-coded Japanese | Yaku, ranks, rooms, counters and dialogs. Switching it off puts the Japanese back immediately. |
| Fix gaps in the game's English text table | Fills the ids the official English table is missing or leaves in Japanese. Applies after a reload. |
| Force the game language to English | Turn off if you want to pick another language with Tenhou's own selector. Applies after a reload. |
| Log untranslated text to the console | For developers and bug hunters. |
| Scan this screen | Lists Japanese text that is still untranslated on the current screen (player names are left out), ready to copy. |
| My own translations | One per line as `日本語 = English`. Yours win over the built-in ones. Lines starting with `#` are ignored. |

Player names are never translated. The script learns them from the game's own messages, so a player called `ドラ` or `平和` stays `ドラ` / `平和`.

### Panel & data tab

- **Gear button:** choose its corner, fade it out until the mouse is over it, and change the shortcut key (Alt + any letter or digit).
- **Backup:** export your settings as text and import them in another browser.
- **Copy bug report:** copies the version, your settings and the Japanese still on screen, ready to paste into an issue. Player names are left out.
- **Reset all settings.**
- **About & updates:** version, links to this page, and the update check described above.

## Missing a translation?

Use **Scan this screen** in the Translation tab, or add the line yourself under **My own translations**. Then please [open an issue](https://github.com/izicoder/tenhou4-english/issues) with the Japanese text, the English you would suggest, and a screenshot of where it appears.

## Known limitations

- Game page only. The Tenhou website, manual and registration pages are not translated.
- The event notice on the start screen (`/ads/eventinfo.js`) changes every week and stays in Japanese. The banner images are pictures and cannot be translated.
- In replays, player names are not learned, so a name that equals a game term could be translated there.

## Troubleshooting

- **Nothing is translated:** check that the script is enabled and that no second copy is running. The console (F12) should print `[tenhou4-en] vX.Y.Z loaded`.
- **Labels missing or in the wrong place:** open the settings panel; the status line on the Tiles tab says whether the labels are working. If Tenhou updates its client the labels may stop working, and the panel (and, after about 30 seconds of play, the console) will say so. Please use **Copy bug report** and open an issue.
- **Labels look slightly off:** try the Position, Size and nudge sliders.
- **I hid the gear button and can't find it:** move the mouse to its corner, or press Alt+T.

## How it works

- **Strings:** the page's `XMLHttpRequest` is wrapped just enough to merge our overrides into the English string table before the client reads it. A `MutationObserver` translates the remaining hard-coded text as it appears, by exact match or anchored pattern, and remembers the original text so translation can be switched off again.
- **Tiles:** tiles are canvas sprites decoded on demand from the client's `obj*.dat` files. The script watches `Zlib.Inflate` to learn which tile face a sprite is being decoded for and draws the chip onto that sprite right after `putImageData()`. No client code is rewritten and no extra canvas is added.
- **Settings panel:** a small shadow-DOM widget, so the page's own styles cannot affect it and the game's mouse and key handlers never see clicks inside it. Every option lives in one validated settings object.

The script runs with `@grant none`, in the page's own context, and starts at `document-start` so it is in place before the client loads.

## Development

The whole project is the single file [`tenhou4-english.user.js`](tenhou4-english.user.js).

To publish a new version:

1. Edit the script.
2. Raise the version in **both** places: `// @version` in the header and `const VERSION` near the top of the code. Managers only update when `@version` goes up.
3. Commit and push to `master`. Installed copies pick it up within about a day (GitHub's raw files are cached for a few minutes).

## Contributing

Translations are the easiest thing to contribute: an untranslated string, the suggested English, and where it appears is enough. Bug reports are welcome too: the **Copy bug report** button in the settings panel collects everything needed.

## License

[MIT](LICENSE) © izicoder