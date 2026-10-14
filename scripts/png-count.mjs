// png-count.mjs IMG X Y W H COLOUR[,COLOUR...]: how many pixels in the
// rectangle (in the image's pixels) are exactly one of the colours (#RRGGBB).
// For the gates: the HUD draws after the palette pass, so its text keeps its
// colours exactly, whatever is under it.
import { readRGBA } from "./art/gen-logo.mjs";

const [file, X, Y, W, H, colours] = process.argv.slice(2);
if (!colours) { console.error("png-count: IMG X Y W H COLOUR[,COLOUR...]"); process.exit(2); }
const want = colours.split(",").map((c) => parseInt(c.replace("#", ""), 16));
const img = readRGBA(file);
const x0 = +X, y0 = +Y, x1 = Math.min(img.w, x0 + +W), y1 = Math.min(img.h, y0 + +H);
let n = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const k = (y * img.w + x) * 4;
  if (want.includes((img.px[k] << 16) | (img.px[k + 1] << 8) | img.px[k + 2])) n++;
}
console.log(n);
