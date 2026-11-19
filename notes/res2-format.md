# Tenhou /4 resource format — findings

Everything here comes from reading `/4/latest.js` and probing the CDN. Marked
`confirmed` where I verified against the actual files.

## `.ini` manifest (confirmed)

Requested over the resource WebSocket:

```js
new WebSocket("wss://b-wk.mjv.jp")
ws.send('<GET id="NoName" file="0/_res0_01440x01080.ini"/>')
```

Reply:

```json
{"tag":"FILE","name":"0/_res0_01440x01080.ini","content":"<base64>"}
```

Decoded content is **only**:

```
[INFO]
_=2097365
```

i.e. the byte size of the matching `.dat`. **There is no sprite table in the
`.ini`** — so the earlier plan of reading sprite rects from it does not work.
The rects live in separate `obj*` / `sdw*` files and are parsed by the bundle.

Files requested by the client:

```
0/_res0_<w>x<h>.ini      -> texture atlas (res2)
2/_obj1_<w>x<h>.ini
3/_sdw0_<w>x<h>.ini
9/_obj0_<w>x<h>.ini
```

`<w>`/`<h>` are 5-digit zero-padded (`01440x01080`).

## Texture atlas: `res2` (confirmed)

`https://cdn.tenhou.net/4/res/0/_res0_01440x01080.dat` (2,097,365 bytes).

Layout, from `rc.kc` / `rc.createImageData` in `latest.js`:

```
u32 magic = "res2"
repeat until EOF:
  u32 key          // texture id
  i16 width
  i16 height
  u32 dataLen
  u8  data[dataLen]
```

- If `dataLen === width*height*4`, `data` is raw pixels.
- If `dataLen <  width*height*4`, `data` is **zlib**; inflate to `w*h*4`.
- Pixels are **BGRA**, swapped to RGBA in place before `new ImageData(...)`.

Verified first entries of `_res0_01440x01080.dat`:

```
key 401  7x13    364 bytes
key 402  7x13    364 bytes
key 403  32x31  3968 bytes
...
key 412  45x45  1872 bytes   (1872 < 45*45*4, so zlib)
```

Note: the `01440x01080` in the filename is **not** the atlas dimensions; it is
the screen/viewport size the atlas was built for. The file is a bag of small
textures, which is why raw BGRA of the whole name was never going to match.

## Sprite tables: `obj*` / `sdw*` (confirmed structure, not fully decoded)

Files `_obj0_`, `_obj1_`, `_obj2_`, `_obj3_`, `_sdw0_`, `_sdw2_` start with the
ASCII magic (`obj0`, `obj1`, `obj2`, `obj3`, `sdw0`, `sdw2`) and are parsed by
`sc.kc(buffer)`.

`sdc`/`obj` entry (from `sc.kc`):

```
u32 key
i16 x, y, w, h
u32 textureKey      // points at a key in the res2 atlas
u32 ...             // obj only: two more u32s
```

`sc.Tc[key] = {oa, x, y, w, i, xb, dc, ec, s}` where `dc` is the texture key in
the `res2` atlas and `ec` is the byte offset.

Sprite key is packed as:

```js
yc(p, q, b, r) = p | q<<8 | b<<16 | r<<24
// p = sheet id (121 = tiles, 116, 107, 110 = UI)
// q = row / group
// b = column / variant
// r = flags (colour, rotation, state)
```

`sc.Ej()` validates sheet 121 (tiles) as:

- `q` in `[0,17)`, `b` in `[0,37)` or `38`, `r` in `[0,4)`
- plus `q` in `[17,34)`, `[40,57)`, `[57,74)` for the other tile orientations
- `b` 37/39 are the "shadow/glow" variants

## Consequence for numbered tiles

Route A′ (patch the decoded atlas canvas in memory) is viable:

1. Hook `CanvasRenderingContext2D.prototype.drawImage` to discover the sprite
   canvases (`p.ea.canvas`) and their source rects.
2. Look up the tile id → `sc.Tc[yc(121, q, b, r)]` → `{dc, ec}` → `res2`
   texture → pixels.
3. Draw the label once into that sprite canvas.

Still open: the exact `q`/`b` mapping from tile id 0–135 to sprite key. Two
sources to cross-check:

- the bundle's tile-draw path (`vc.$a` / `vc.wa`, around offset 87123)
- `sc.Ej()`'s sheet-121 count table
- tile id rule: `kind = id >> 2`; 0–8 man, 9–17 pin, 18–26 sou, 27–33 honors
  (E S W N Haku Hatsu Chun); red fives are ids 16, 52, 88.
