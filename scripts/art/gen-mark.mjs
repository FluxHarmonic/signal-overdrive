// gen-mark.mjs - the Flux Harmonic mark for the card before the title, in
// embers, from David's own mark (no image generation on this path).
//
//   node scripts/art/gen-mark.mjs
//
// Reads refs/mark/flux-harmonic.png (3040x1502, kept outside assets/ so it
// never ships; checked against the sha256 in its note) and writes
// assets/signal/fh-mark.png, 380x188: the raw box-filtered 8 to 1, each
// pixel classed by its colour as Harkfell's scripts/art/mark does (a
// saturated pixel is the ring: yellow where green is at least 0.72 of red,
// else the darker orange; anything else is the lettering), then painted
// one of three embers colours, opaque where the raw covers at least half
// the pixel and clear elsewhere: the card lays it on the Mode 7 road, where
// a texel is either drawn or not. The mark is RESERVED (assets/RESERVED.md).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Canvas, EMBERS, hex } from "./lib.mjs";
import { readRGBA } from "./gen-logo.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const RAW = path.join(ROOT, "refs/mark/flux-harmonic.png");
const NOTE = path.join(ROOT, "refs/mark/flux-harmonic.txt");
const OUT = path.join(ROOT, "assets/signal/fh-mark.png");
const STEP = 8;
// the three colours: the lettering, the ring's darker orange, its yellow
const LETTER = "#F0F0F0", RING = "#F2731A", GOLD = "#FFCC33";

const want = fs.readFileSync(NOTE, "utf8").match(/^sha256: ([0-9a-f]{64})$/m)?.[1];
const got = createHash("sha256").update(fs.readFileSync(RAW)).digest("hex");
if (!want || want !== got) throw new Error(`gen-mark: ${RAW} does not hash to its note's sha256`);
for (const c of [LETTER, RING, GOLD]) if (!EMBERS.includes(c)) throw new Error(`gen-mark: ${c} is not an embers colour`);

const raw = readRGBA(RAW);
const w = Math.floor(raw.w / STEP), h = Math.ceil(raw.h / STEP);
const C = new Canvas(w, h);
const count = { letter: 0, ring: 0, gold: 0 };
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < STEP; j++) for (let i = 0; i < STEP; i++) {
    const sx = x * STEP + i, sy = y * STEP + j;
    if (sy >= raw.h) continue;
    const k = (sy * raw.w + sx) * 4, al = raw.px[k + 3] / 255;
    r += raw.px[k] * al; g += raw.px[k + 1] * al; b += raw.px[k + 2] * al; a += al;
  }
  if (a / (STEP * STEP) < 0.5) continue;
  r /= a; g /= a; b /= a;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const ring = (mx - mn) / (mx + 0.0001) > 0.45;
  const c = !ring ? LETTER : g / (r + 0.0001) >= 0.72 ? GOLD : RING;
  count[c === LETTER ? "letter" : c === GOLD ? "gold" : "ring"]++;
  C.set(x, y, c);
}
// the plant-landed checks: a classification that fell through would paint
// the mark one colour
for (const [k, n] of Object.entries(count)) if (n < 100) throw new Error(`gen-mark: only ${n} ${k} pixels; refusing`);
C.checkPalette("fh-mark");
C.save(OUT);
console.log(`gen-mark: ${path.relative(ROOT, OUT)} ${w}x${h}: ${count.letter} lettering, ${count.ring} orange, ${count.gold} yellow`);
