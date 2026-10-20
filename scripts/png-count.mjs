// png-count.mjs IMG X Y W H COLOUR[,COLOUR...] [--shadow D SHADOW]: how
// many pixels in the rectangle (in the image's pixels) are exactly one of
// the colours (#RRGGBB). For the gates: the HUD draws after the palette
// pass, so its text keeps its colours exactly, whatever is under it.
// --shadow D SHADOW: only those with the colour SHADOW D pixels right and
// D down: a HUD text's glyph edges (text! draws each glyph over its shadow,
// #0D0A1A, one view pixel down and right), not the same colour in the
// world under it (a boost pad's #FFCC33 stripes under the title prompt).
import { readRGBA } from "./art/gen-logo.mjs";

const [file, X, Y, W, H, colours, flag, D, shadow] = process.argv.slice(2);
if (!colours || (flag !== undefined && (flag !== "--shadow" || !(+D > 0) || !/^#[0-9A-Fa-f]{6}$/.test(shadow || "")))) {
  console.error("png-count: IMG X Y W H COLOUR[,COLOUR...] [--shadow D #SHADOW]"); process.exit(2);
}
const sd = flag ? +D : 0, sc = flag ? parseInt(shadow.slice(1), 16) : 0;
const want = colours.split(",").map((c) => parseInt(c.replace("#", ""), 16));
const img = readRGBA(file);
const x0 = +X, y0 = +Y, x1 = Math.min(img.w, x0 + +W), y1 = Math.min(img.h, y0 + +H);
let n = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const k = (y * img.w + x) * 4;
  if (!want.includes((img.px[k] << 16) | (img.px[k + 1] << 8) | img.px[k + 2])) continue;
  if (sd) {
    if (x + sd >= img.w || y + sd >= img.h) continue;
    const q = ((y + sd) * img.w + x + sd) * 4;
    if (((img.px[q] << 16) | (img.px[q + 1] << 8) | img.px[q + 2]) !== sc) continue;
  }
  n++;
}
console.log(n);
