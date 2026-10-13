// gen-site.mjs - the website's own art, from the game's look:
//
//   site/logo.png       SIGNAL OVERDRIVE in the game's 5x7 title font
//                       (Substratic's (substratic text font) glyphs, one cell
//                       of space between letters, as the title screen draws
//                       it), magenta, with two rows torn a cell to the right
//                       and the cyan signal showing where they were
//   site/favicon.png    32x32: Zero's machine from behind, 16x16 cells at 2x
//   site/favicon.ico    the same machine at 16 and 32 (PNG entries)
//   site/shots/og.png   1200x630 link preview: site/shots/title.png at 2x
//                       (nearest), centred on the game's darkness
//
//   node scripts/art/gen-site.mjs
//
// Same pixels in, same bytes out (lib.mjs's writer has no timestamps).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { writePNG, hex } from "./lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = path.join(REPO, "site");

// ---- the title font: (substratic text font)'s rows for the letters used ----------
const GLYPHS = {
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  D: ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

// the cells of TEXT: lit[y][x], 7 rows, 6 columns a letter less the last gap
function cells(text) {
  const w = text.length * 6 - 1;
  const lit = Array.from({ length: 7 }, () => new Array(w).fill(false));
  [...text].forEach((ch, i) => {
    const rows = GLYPHS[ch];
    if (!rows) throw new Error(`gen-site: no glyph for ${JSON.stringify(ch)}`);
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") lit[y][i * 6 + x] = true; }));
  });
  return { w, h: 7, lit };
}

function canvas(w, h) { return { w, h, px: new Uint8Array(w * h * 4) }; }
function put(cv, x, y, rgb, a = 255) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  cv.px[i] = rgb[0]; cv.px[i + 1] = rgb[1]; cv.px[i + 2] = rgb[2]; cv.px[i + 3] = a;
}
function block(cv, x, y, s, rgb) { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) put(cv, x + i, y + j, rgb); }

// ---- the logo ----------------------------------------------------------------------
// At the title screen's own scale, 3 game pixels a cell, on a transparent
// ground; the page draws it at a whole multiple, pixelated.
{
  const SCALE = 3, PAD = 1;                  // PAD cells round the word, for the split
  const t = cells("SIGNAL OVERDRIVE");
  const cv = canvas((t.w + PAD * 2) * SCALE, (t.h + PAD * 2) * SCALE);
  const MAGENTA = hex("#FF59D9"), CYAN = hex("#4DF2D9");
  const SPLIT = new Set([2, 5]);             // the rows the cyan copy tears out on
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (!t.lit[y][x]) continue;
    if (SPLIT.has(y)) block(cv, (x + PAD) * SCALE, (y + PAD) * SCALE, SCALE, CYAN);
  }
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (t.lit[y][x]) block(cv, (x + PAD + (SPLIT.has(y) ? 1 : 0)) * SCALE, (y + PAD) * SCALE, SCALE, MAGENTA);
  }
  writePNG(path.join(SITE, "logo.png"), cv.w, cv.h, cv.px);
  console.log(`logo.png ${cv.w}x${cv.h}`);
}

// ---- the machine, 16x16 --------------------------------------------------------------
// Zero's machine from behind as the race draws it: a cyan wedge, its cockpit
// glass, a dark skirt and three yellow thrusters.
const MACHINE = [
  "................",
  "................",
  "................",
  "......cccc......",
  ".....cgggwc.....",
  "....ccgggwcc....",
  "....cccccccc....",
  "...cctccccccc...",
  "...ctcccccccc...",
  "..cccccccccccc..",
  ".kcccccccccccck.",
  ".kkkkkkkkkkkkkk.",
  "..kyykkyykkyyk..",
  "...yy..yy..yy...",
  "................",
  "................",
];
const COLORS = { c: hex("#4DF2D9"), t: hex("#3AACA0"), g: hex("#1F3A4D"), w: hex("#CCE6FF"), k: hex("#17122E"), y: hex("#FFCC33") };
const DARK = hex("#0D0A1A");

function machine(scale) {
  const cv = canvas(16 * scale, 16 * scale);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = MACHINE[y][x];
    block(cv, x * scale, y * scale, scale, c === "." ? DARK : COLORS[c]);
  }
  return cv;
}
function pngBytes(cv) {
  const tmp = path.join(SITE, `.gen-site-${process.pid}.png`);
  writePNG(tmp, cv.w, cv.h, cv.px);
  const b = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return b;
}
{
  for (const row of MACHINE) if (row.length !== 16) throw new Error(`gen-site: a machine row is ${row.length} wide: ${row}`);
  const fav = machine(2);
  writePNG(path.join(SITE, "favicon.png"), fav.w, fav.h, fav.px);
  // ICO with PNG entries (16 and 32), which every current browser reads
  const imgs = [pngBytes(machine(1)), pngBytes(machine(2))];
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((b, i) => {
    const e = 6 + 16 * i, s = i === 0 ? 16 : 32;
    head[e] = s; head[e + 1] = s; head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += b.length;
  });
  fs.writeFileSync(path.join(SITE, "favicon.ico"), Buffer.concat([head, ...imgs]));
  console.log("favicon.png 32x32, favicon.ico 16+32");
}

// ---- the link preview -------------------------------------------------------------------
// A PNG's pixels (8-bit RGB or RGBA, not interlaced: what the captures are).
function readPNG(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, h = 0, ch = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString("latin1", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || (d[9] !== 6 && d[9] !== 2) || d[12] !== 0) throw new Error(`gen-site: ${file} is not 8-bit RGB(A), non-interlaced`);
      ch = d[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y > 0 ? px[(y - 1) * stride + x] : 0,
            c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}
{
  const src = readPNG(path.join(SITE, "shots", "title.png"));
  if (src.w !== 480 || src.h !== 270) throw new Error(`gen-site: shots/title.png is ${src.w}x${src.h}, want 480x270`);
  const W = 1200, H = 630, S = 2, X0 = (W - src.w * S) / 2, Y0 = (H - src.h * S) / 2;
  const cv = canvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(cv, x, y, DARK);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const i = (y * src.w + x) * src.ch;
    block(cv, X0 + x * S, Y0 + y * S, S, [src.px[i], src.px[i + 1], src.px[i + 2]]);
  }
  writePNG(path.join(SITE, "shots", "og.png"), W, H, cv.px);
  console.log("shots/og.png 1200x630");
}
