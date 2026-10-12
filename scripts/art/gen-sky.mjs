// gen-sky.mjs - the skyline: three parallax layers of the city above the
// horizon, stacked in one texture.
//
//   node scripts/art/gen-sky.mjs [--zoom]
//
// Writes assets/signal/sky.png, 1024x288: three layers of 96 rows each, far
// (rows 0-95), mid (96-191), near (192-287). Each layer's bottom row sits
// on the horizon; transparent pixels show the layer behind or the sky's
// gradient (drawn by the ground shader). Every layer wraps sideways
// seamlessly (buildings are drawn modulo 1024), so a full turn never shows
// a seam. With --zoom, docs/sky-zoom.png: the three layers composited over
// the sky colour, at 2x.
//
// The far layer is silhouettes with a few lit floors and the Gibson's
// spire; the mid layer is towers with grids of lit windows; the near layer
// is low dark blocks carrying neon signs, the brightest things on the
// skyline (the HIGHLIGHT, SELECTED and ICE roles).

import fs from "node:fs";
import path from "node:path";
import { Canvas, C, rng, bayerOn } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const W = 1024, LH = 96;
const sky = new Canvas(W, LH * 3);
const set = (layer, x, y, c) => { if (y >= 0 && y < LH) sky.set(((x % W) + W) % W, layer * LH + y, c); };
const get = (layer, x, y) => sky.get(((x % W) + W) % W, layer * LH + y);

// A building: columns x0..x0+w-1, from row top to the bottom of the layer.
function block(layer, x0, w, top, body, edge) {
  for (let x = x0; x < x0 + w; x++) for (let y = top; y < LH; y++) set(layer, x, y, x === x0 && edge ? edge : body);
}

// ---- far ---------------------------------------------------------------------------------
{
  const R = rng(101);
  for (let x = 0; x < W;) {
    const w = 10 + Math.floor(R() * 30), h = 18 + Math.floor(R() * 52);
    block(0, x, w, LH - h, C.BAR_B, null);
    // a few lit floors
    for (let y = LH - h + 4; y < LH - 4; y += 6) if (R() < 0.25) {
      for (let k = x + 2; k < x + w - 2; k += 3) if (R() < 0.5) set(0, k, y, C.ARCHIVE);
    }
    x += w + Math.floor(R() * 4) - 2;
  }
  // the Gibson's spire: tall, stepped, a red light on top
  const gx = 610;
  block(0, gx - 14, 28, 30, C.BAR_C, C.ARCHIVE);
  block(0, gx - 9, 18, 14, C.BAR_C, C.ARCHIVE);
  block(0, gx - 4, 8, 4, C.BAR_C, null);
  for (let y = 0; y < 4; y++) set(0, gx, y, C.SIDE_DARK);
  set(0, gx, 0, C.TRACE_HOT);
  for (let y = 18; y < LH; y += 5) for (let k = gx - 7; k < gx + 8; k += 2) set(0, k, y, C.VIOLET_MID);
}

// ---- mid ----------------------------------------------------------------------------------
{
  const R = rng(202);
  for (let x = 0; x < W;) {
    const w = 16 + Math.floor(R() * 34), h = 16 + Math.floor(R() * 50);
    const top = LH - h;
    block(1, x, w, top, C.BAR_C, C.SIDE_DARK);
    // a roof line
    for (let k = x; k < x + w; k++) set(1, k, top, C.SIDE_DARK);
    // windows: 2x1, every 4 columns and 3 rows, lit at random
    const lit = [C.LABEL_LIT, C.SELECTED, C.TEXT_DIM, C.ICE];
    const style = Math.floor(R() * lit.length);
    for (let y = top + 3; y < LH - 2; y += 3) for (let k = x + 2; k < x + w - 2; k += 4) {
      const on = R() < 0.32;
      const c = on ? lit[R() < 0.8 ? style : Math.floor(R() * lit.length)] : C.BAR_B;
      set(1, k, y, c); set(1, k + 1, y, c);
    }
    // an antenna with a red light
    if (R() < 0.35) {
      const ax = x + Math.floor(w / 2), ah = 4 + Math.floor(R() * 8);
      for (let y = top - ah; y < top; y++) set(1, ax, y, C.SIDE_DARK);
      set(1, ax, top - ah, C.TRACE_HOT);
    }
    x += w + 2 + Math.floor(R() * 10);
  }
}

// ---- near ----------------------------------------------------------------------------------
// 3x5 capitals for the signs
const FONT = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111", V: "101101101101010", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", 0: "010101101101010", 2: "110001010100111", 4: "101101111001001",
  7: "111001010010010", " ": "000000000000000",
};
{
  const R = rng(303);
  const WORDS = ["NET", "24H", "RAM", "GIBSON", "BYTE", "ZERO", "SIGNAL", "NOODLES", "DATA", "SYNC", "LINK", "TRACE", "ICE"];
  const NEON = [C.HIGHLIGHT, C.SELECTED, C.ICE, C.GIBSON, C.LABEL_LIT];
  let wi = 0;
  for (let x = 0; x < W;) {
    const w = 24 + Math.floor(R() * 44), h = 8 + Math.floor(R() * 26);
    const top = LH - h;
    block(2, x, w, top, C.BG, C.BAR_A);
    for (let k = x; k < x + w; k++) set(2, k, top, C.BAR_A);
    // a few dim windows
    for (let y = top + 3; y < LH - 1; y += 4) for (let k = x + 3; k < x + w - 2; k += 5) if (R() < 0.2) set(2, k, y, C.AMBER);
    // a sign on most buildings: on the wall, or up on a pole
    if (R() < 0.8) {
      const word = WORDS[wi++ % WORDS.length];
      const neon = NEON[Math.floor(R() * NEON.length)];
      const sw = word.length * 4 + 3, sh = 9;
      const pole = R() < 0.45;
      const sx = x + Math.max(1, Math.floor((w - sw) / 2));
      const sy = pole ? top - sh - 4 - Math.floor(R() * 8) : top + 2;
      if (pole) for (let y = sy + sh; y < top; y++) { set(2, sx + 2, y, C.SIDE_DARK); set(2, sx + sw - 3, y, C.SIDE_DARK); }
      for (let k = 0; k < sw; k++) for (let y = 0; y < sh; y++) {
        const border = k === 0 || y === 0 || k === sw - 1 || y === sh - 1;
        set(2, sx + k, sy + y, border ? neon : C.BG);
      }
      [...word].forEach((ch, i) => {
        const g = FONT[ch] || FONT[" "];
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++)
          if (g[gy * 3 + gx] === "1") set(2, sx + 2 + i * 4 + gx, sy + 2 + gy, neon);
      });
    }
    x += w + 3 + Math.floor(R() * 22);
  }
  // a low haze line along the bottom of the near layer, dithered
  for (let x = 0; x < W; x++) for (let y = LH - 6; y < LH; y++)
    if (get(2, x, y)[3] && bayerOn((y - (LH - 6)) / 7, x, y)) set(2, x, y, C.BAR_A);
}

sky.checkPalette("sky");
sky.save(path.join(ROOT, "assets/signal/sky.png"));
console.log(`gen-sky: ${W}x${LH * 3}, ${sky.colourCount()} colours`);

if (process.argv.includes("--zoom")) {
  const z = 2, out = new Canvas(W * z, LH * z);
  for (let y = 0; y < LH; y++) for (let x = 0; x < W; x++) {
    let c = [0x2e, 0x1c, 0x4d];
    for (let l = 0; l < 3; l++) { const p = get(l, x, y); if (p[3]) c = p.slice(0, 3); }
    for (let j = 0; j < z; j++) for (let i = 0; i < z; i++) out.set(x * z + i, y * z + j, c);
  }
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  out.save(path.join(ROOT, "docs/sky-zoom.png"));
}
