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
//
// Under the mark, GAP pixels down, the word PRESENTS in the site's orange,
// from the hand-drawn companion alphabet assets/src/logo/presents.txt, a
// cell 2x2 pixels, the letters TRACK cells apart, centred: the picture
// grows to 380x222, all of it one decal on the road. Every colour in it
// must come through the game's post pass unchanged at every Bayer phase
// (the decal lands on the screen at any phase). It also writes
// src/signal/intro/mark.sgl, (signal intro mark): the picture's size and
// where the mark and the word sit in it.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Canvas, EMBERS, hex } from "./lib.mjs";
import { readRGBA, postPassCheck } from "./gen-logo.mjs";
import { readAlphabet } from "./logo-text.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const RAW = path.join(ROOT, "refs/mark/flux-harmonic.png");
const NOTE = path.join(ROOT, "refs/mark/flux-harmonic.txt");
const OUT = path.join(ROOT, "assets/signal/fh-mark.png");
const MOD = path.join(ROOT, "src/signal/intro/mark.sgl");
const FACE = path.join(ROOT, "assets/src/logo/presents.txt");
const WORD = "PRESENTS", CELL = 2, TRACK = 4, GAP = 14;
const STEP = 8;
// the three colours: the lettering, the ring's darker orange, its yellow
const LETTER = "#F0F0F0", RING = "#F2731A", GOLD = "#FFCC33";
// the word's: the site's orange, an accent that reads on the road (against
// the road under it at the zoom's end, 5.25:1 by WCAG's measure, where the
// first choice, the grey #8A8FA0, gave 3.35:1), between the ring's two
// colours so it belongs to the mark
const WORD_COLOUR = "#FF9F1A";

const want = fs.readFileSync(NOTE, "utf8").match(/^sha256: ([0-9a-f]{64})$/m)?.[1];
const got = createHash("sha256").update(fs.readFileSync(RAW)).digest("hex");
if (!want || want !== got) throw new Error(`gen-mark: ${RAW} does not hash to its note's sha256`);
for (const c of [LETTER, RING, GOLD, WORD_COLOUR]) if (!EMBERS.includes(c)) throw new Error(`gen-mark: ${c} is not an embers colour`);

const raw = readRGBA(RAW);
const w = Math.floor(raw.w / STEP), h = Math.ceil(raw.h / STEP);
// the word, laid out first so the picture knows its height
const face = readAlphabet(FACE);
const glyphs = [...WORD].map((ch) => {
  const g = face.glyphs.get(ch);
  if (!g) throw new Error(`gen-mark: ${FACE} has no glyph ${ch}`);
  return g;
});
const wordW = (glyphs.reduce((n, g) => n + g.w, 0) + TRACK * (glyphs.length - 1)) * CELL;
const wordH = face.height * CELL;
const wordX = Math.floor((w - wordW) / 2), wordY = h + GAP;
if (wordX < 0) throw new Error(`gen-mark: ${WORD} is ${wordW} wide, wider than the mark's ${w}`);
const H = wordY + wordH;
const C = new Canvas(w, H);
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
// the word, a glyph cell CELL x CELL pixels
let wx = wordX, quiet = 0;
for (const g of glyphs) {
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    if (!g.rows[r][c]) continue;
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) { C.set(wx + c * CELL + i, wordY + r * CELL + j, WORD_COLOUR); quiet++; }
  }
  wx += (g.w + TRACK) * CELL;
}
count.word = quiet;
// the plant-landed checks: a classification that fell through would paint
// the mark one colour, and a lost word would leave no grey
for (const [k, n] of Object.entries(count)) if (n < 100) throw new Error(`gen-mark: only ${n} ${k} pixels; refusing`);
C.checkPalette("fh-mark");
// every colour through the post pass at all 16 Bayer phases
const colours = new Map();
for (let k = 0; k < C.px.length; k += 4) if (C.px[k + 3]) colours.set(`${C.px[k]},${C.px[k + 1]},${C.px[k + 2]}`, [C.px[k], C.px[k + 1], C.px[k + 2]]);
for (const [key, rgb] of colours) {
  const T = new Canvas(4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) T.set(x, y, rgb);
  postPassCheck(T, `fh-mark colour ${key}`);
}
C.save(OUT);
fs.mkdirSync(path.dirname(MOD), { recursive: true });
fs.writeFileSync(MOD, `;;; (signal intro mark) - GENERATED by scripts/art/gen-mark.mjs; do not edit.
;;;
;;; The card's picture, assets/signal/fh-mark.png, MARK-PX-W x MARK-PX-H
;;; pixels: the Flux Harmonic mark in its rows 0 to MARK-ART-H - 1, and
;;; under it the word PRESENTS (assets/src/logo/presents.txt) at
;;; PRESENTS-X, PRESENTS-Y, PRESENTS-W x PRESENTS-H pixels. (signal intro)
;;; lays the whole picture on the road as one decal. Every colour in it
;;; comes through the post pass unchanged at every Bayer phase.

(define-library (signal intro mark)
  (import (sigil core))

  (export MARK-PX-W MARK-PX-H MARK-ART-H PRESENTS-X PRESENTS-Y PRESENTS-W PRESENTS-H)

  (begin
    (define MARK-PX-W ${w})
    (define MARK-PX-H ${H})
    (define MARK-ART-H ${h})
    (define PRESENTS-X ${wordX})
    (define PRESENTS-Y ${wordY})
    (define PRESENTS-W ${wordW})
    (define PRESENTS-H ${wordH})))
`);
console.log(`gen-mark: ${path.relative(ROOT, OUT)} ${w}x${H}: ${count.letter} lettering, ${count.ring} orange, ${count.gold} yellow; ${WORD} ${wordW}x${wordH} at (${wordX},${wordY}), ${quiet} px; ${colours.size} colours through the post pass`);
console.log(`gen-mark: ${path.relative(ROOT, MOD)}`);
