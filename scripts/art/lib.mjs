// lib.mjs - what the art generators share: a PNG writer, the palette, the
// Bayer 4x4 ordered dither, and an RGBA canvas with a few drawing helpers.
//
// Every generator draws in palette colours and dithers between them with
// the same 4x4 Bayer matrix the post pass uses (src/racer/dither.sgl), so a
// generated asset passes through the post pass unchanged: at spread 8 a
// palette colour plus at most +-4 snaps back to itself (every pair of
// palette colours is further apart than that).

import fs from "node:fs";
import zlib from "node:zlib";

// ---- PNG ---------------------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// RGBA bytes (top row first) to a PNG file. No timestamps, so the same
// pixels always give the same bytes.
export function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// ---- the palette ---------------------------------------------------------------

// Phantom Burn's `embers` (51), in `convert -unique-colors` order: the order
// src/racer/dither.sgl lists and so the post pass's tie order.
export const EMBERS = [
  "#0D0A1A", "#241104", "#261804", "#3D1D07", "#3B1F1A", "#3D281A", "#17122E", "#21173D",
  "#2A2D3A", "#402807", "#74391A", "#7A4D1A", "#4A5A2B", "#2E1D48", "#2E1C4D", "#3D1A40",
  "#1A3840", "#1F3A4D", "#333648", "#7A2E70", "#3D4052", "#2A7270", "#AD541A", "#B6721A",
  "#F2731A", "#CC3340", "#9E5761", "#FF5959", "#1A8C4D", "#FF9F1A", "#FFCC33", "#B89E5C",
  "#583681", "#5C4D8C", "#636D81", "#6B7085", "#1A73D9", "#8C40B3", "#814EBA", "#B641A0",
  "#B36BFF", "#FF59D9", "#3AACA0", "#7380A6", "#4DF2D9", "#8A8FA0", "#93A4BA", "#DBE0E6",
  "#CCE6FF", "#F0F0F0", "#FAFCFF",
];

export function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// Crash The Stack's roles (assets/palette.sgl) that this game draws with,
// plus the embers ramps' names for the extra darks. Every value is in EMBERS.
export const C = {
  BG: "#0D0A1A", BAR_A: "#17122E", BAR_B: "#21173D", BAR_C: "#2E1C4D",
  FACE: "#DBE0E6", FACE_EDGE: "#FAFCFF", SIDE: "#6B7085", SIDE_DARK: "#3D4052",
  SELECTED: "#4DF2D9", HIGHLIGHT: "#FF59D9", TEXT: "#CCE6FF", TEXT_DIM: "#7380A6",
  COLD: "#1A73D9", RED: "#CC3340", GREEN: "#1A8C4D", PURPLE: "#8C40B3",
  HOT: "#F2731A", LABEL_LIT: "#FFCC33", ICE: "#FF9F1A", TRACE_HOT: "#FF5959",
  GIBSON: "#B36BFF", STATIC_A: "#8A8FA0", STATIC_B: "#2A2D3A", WIRE_DARK: "#1F3A4D",
  ARCHIVE: "#5C4D8C", MOSS: "#4A5A2B", DAEMON: "#F0F0F0",
  // embers' extra ramp colours
  TEAL_DARK: "#1A3840", TEAL: "#2A7270", TEAL_MID: "#3AACA0", SLATE: "#333648",
  SLATE_MID: "#636D81", SLATE_LIGHT: "#93A4BA", PLUM: "#3D1A40", PLUM_MID: "#7A2E70",
  ORCHID: "#B641A0", VIOLET: "#583681", VIOLET_MID: "#814EBA", INDIGO: "#2E1D48",
  RUST: "#74391A", AMBER_DARK: "#AD541A", AMBER: "#B6721A", ROSE: "#9E5761",
};

for (const [k, v] of Object.entries(C)) {
  if (!EMBERS.includes(v)) throw new Error(`lib.mjs: C.${k} ${v} is not an embers colour`);
}

// ---- Bayer -----------------------------------------------------------------------

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Is the dither "on" at (x, y) for a mix t in 0..1 (the share of the second
// colour)? The threshold the post pass uses, as a 0..1 fraction.
export function bayerOn(t, x, y) {
  return t > (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
}

// Pick one of a ramp of colours for a tone v in 0..1, dithered: v spread
// over len-1 steps, each step a two-colour Bayer mix.
export function ramp(colors, v, x, y) {
  const n = colors.length - 1;
  const f = Math.max(0, Math.min(1, v)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  return bayerOn(f - i, x, y) ? colors[i + 1] : colors[i];
}

// ---- a canvas ---------------------------------------------------------------------

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4); }
  set(x, y, color, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = typeof color === "string" ? hex(color) : color;
    const k = (y * this.w + x) * 4;
    this.px[k] = r; this.px[k + 1] = g; this.px[k + 2] = b; this.px[k + 3] = a;
  }
  get(x, y) {
    const k = (y * this.w + x) * 4;
    return [this.px[k], this.px[k + 1], this.px[k + 2], this.px[k + 3]];
  }
  rect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
  }
  save(file) { writePNG(file, this.w, this.h, this.px); }
  // every opaque pixel's colour must be a palette colour
  checkPalette(name) {
    const ok = new Set(EMBERS.map((h) => hex(h).join(",")));
    let bad = 0, first = null;
    for (let k = 0; k < this.px.length; k += 4) {
      if (this.px[k + 3] === 0) continue;
      const key = `${this.px[k]},${this.px[k + 1]},${this.px[k + 2]}`;
      if (!ok.has(key)) { bad++; if (!first) first = key; }
    }
    if (bad) throw new Error(`${name}: ${bad} pixels outside the palette (first ${first})`);
  }
  colourCount() {
    const s = new Set();
    for (let k = 0; k < this.px.length; k += 4) if (this.px[k + 3]) s.add(`${this.px[k]},${this.px[k + 1]},${this.px[k + 2]}`);
    return s.size;
  }
}

// A small deterministic PRNG (mulberry32), so every generator gives the same
// bytes on every run.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
