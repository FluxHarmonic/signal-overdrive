// gen-lut.mjs - the post pass's palette lookups: for every colour at 6 bits a
// channel, the nearest palette colour, so the dither pass does one texture
// fetch per pixel instead of comparing against every palette colour.
//
//   node scripts/art/gen-lut.mjs [OUT-DIR]
//
// Writes OUT-DIR/lut-embers.png and OUT-DIR/lut-crash.png (default
// assets/racer), each 512x512: the colour bin (r, g, b), each 0..63 (a
// channel value v in 0..255 is bin floor(v / 4)), is the texel
// (r + 64 * (b mod 8), g + 64 * floor(b / 8)). A bin's colour is the palette
// colour nearest the bin's centre (v = 4 * bin + 1.5) by squared RGB
// distance, the first in palette order on a tie, which is (racer dither)'s
// own rule. The palettes and their order are read from src/racer/dither.sgl,
// so the lookups cannot drift from the exact pass.
//
// The lookup is an approximation of the exact pass: a pixel whose
// dithered value falls in a bin straddling the boundary between two
// palette colours can come out as the other one. The game keeps the exact
// pass behind the `lut` knob (0) for comparison.

import fs from "node:fs";
import path from "node:path";
import { writePNG } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "assets/racer");
const src = fs.readFileSync(path.join(ROOT, "src/racer/dither.sgl"), "utf8");

function palette(name) {
  const m = src.match(new RegExp(`\\(${name}\\s+((?:"#[0-9A-Fa-f]{6}"\\s*)+)\\)`));
  if (!m) throw new Error(`gen-lut: palette ${name} not found in dither.sgl`);
  return [...m[1].matchAll(/"#([0-9A-Fa-f]{6})"/g)].map((x) => [0, 2, 4].map((k) => parseInt(x[1].slice(k, k + 2), 16)));
}

for (const name of ["embers", "crash"]) {
  const pal = palette(name);
  const px = new Uint8Array(512 * 512 * 4);
  for (let b = 0; b < 64; b++) for (let g = 0; g < 64; g++) for (let r = 0; r < 64; r++) {
    const q = [r * 4 + 1.5, g * 4 + 1.5, b * 4 + 1.5];
    let best = Infinity, pick = pal[0];
    for (const c of pal) {
      const e = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2;
      if (e < best) { best = e; pick = c; }
    }
    const x = r + 64 * (b % 8), y = g + 64 * Math.floor(b / 8), k = (y * 512 + x) * 4;
    px[k] = pick[0]; px[k + 1] = pick[1]; px[k + 2] = pick[2]; px[k + 3] = 255;
  }
  fs.mkdirSync(OUT, { recursive: true });
  writePNG(path.join(OUT, `lut-${name}.png`), 512, 512, px);
  console.log(`gen-lut: ${name}, ${pal.length} colours -> ${path.join(OUT, `lut-${name}.png`)}`);
}
