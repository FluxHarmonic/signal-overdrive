// gen-logo.mjs - the Signal Overdrive logo, made from text drawn by hand.
//
//   node scripts/art/gen-logo.mjs [NAME...] [--out DIR] [--still]
//   node scripts/art/gen-logo.mjs --export NAME DIR
//   node scripts/art/gen-logo.mjs --game NAME
//
// For each assets/src/logo/NAME.spec (default: every spec there) it writes
// DIR/NAME/ (DIR defaults to docs/logo):
//
//   wordmark.png                  the wordmark at 1x, transparent ground
//   wordmark@2x.png, @4x.png      the same with each pixel 2x2 and 4x4
//   mark-16.png, mark-32.png, mark-180.png, favicon.ico (16 and 32)
//   title.png                     the title screen's animation, frames in a
//                                 grid read row by row
//   title.json                    frame size, count, grid columns, frame
//                                 rate, and the frame's place in the view
//
// --still skips the title animation (the slow part) for quick looks.
// --export writes the site's files and --game the game's title logo (see
// below).
//
// No image generation and no font. The letters are ALPHABET.txt, drawn by
// hand one character a pixel (logo-text.mjs reads them); the marks are
// marks/NAME-SIZE.txt pixel maps, also drawn by hand. This script lays the
// letters out, shades them with a ramp of palette colours through the same
// 4x4 Bayer matrix the game's post pass uses, and adds the spec's effects:
// the signal's channels split, bands torn sideways, corrupt blocks, and
// the beat's flash. Every pixel is an embers colour, the check refuses
// anything else, and the same sources give the same bytes.
//
// The dither's phase: everything is drawn on a plane whose origin is a
// multiple of 4, and crops snap outward to multiples of 4, so an image
// placed at a multiple of 4 in the 480x270 view keeps the view's Bayer
// phase. Whether a palette colour comes through the post pass unchanged
// depends on the colour, not the phase: the pass adds up to 3.75 to each
// channel, so two palette colours that close (#2E1D48 and #2E1C4D are 5.1
// apart) can swap. postPassCheck() runs both of the game's passes (the
// lookup and the exact one) at its spread of 8 over every pixel written and
// refuses any that would change.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EMBERS, hex, bayerOn, BAYER4, Canvas, writePNG } from "./lib.mjs";
import { readAlphabet, readPicture } from "./logo-text.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SRC = path.join(ROOT, "assets/src/logo");
const VIEW_W = 480, VIEW_H = 270;
const FPS = 60;

// ---- the spec ----------------------------------------------------------------------

const EMBER_SET = new Set(EMBERS);

function colour(s, where) {
  if (s === "none") return null;
  const c = s.toUpperCase();
  if (!EMBER_SET.has(c)) throw new Error(`${where}: ${s} is not an embers colour`);
  return c;
}

// key=value pairs after an effect's name. A value with commas is a list;
// each item is a colour (checked against the palette), a number, or text.
function params(words, where) {
  const item = (s) => {
    if (s.startsWith("#") || s === "none") return colour(s, where);
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    return s;
  };
  const p = {};
  for (const w of words) {
    const m = w.match(/^([a-z-]+)=(.+)$/);
    if (!m) throw new Error(`${where}: expected key=value, got ${w}`);
    p[m[1]] = m[2].includes(",") ? m[2].split(",").map(item) : item(m[2]);
  }
  return p;
}

export function readSpec(file) {
  const spec = {
    file, name: path.basename(file, ".spec"), line: null, gap: 2, space: 10,
    margin: [16, 16, 16, 16], ramp: [], effects: [], outline: null,
    title: { y: 60 }, bpm: 140, bars: 2,
  };
  fs.readFileSync(file, "utf8").split("\n").forEach((text, i) => {
    const where = `${file}:${i + 1}`;
    const t = text.trim();
    if (t === "" || t.startsWith("#")) return;
    const [k, ...a] = t.split(/\s+/);
    const int = (s) => { if (!/^-?\d+$/.test(s ?? "")) throw new Error(`${where}: ${s} is not a whole number`); return parseInt(s, 10); };
    switch (k) {
      case "alphabet": spec.alphabet = a[0]; break;
      case "line": spec.line = a.join(" "); break;
      case "gap": spec.gap = int(a[0]); break;
      case "space": spec.space = int(a[0]); break;
      case "margin":
        if (a.length !== 4) throw new Error(`${where}: margin takes four numbers: left top right bottom`);
        spec.margin = a.map(int);
        break;
      case "ramp":
        if (a.length % 2) throw new Error(`${where}: ramp takes ROW COLOUR pairs`);
        for (let j = 0; j < a.length; j += 2) spec.ramp.push([int(a[j]), colour(a[j + 1], where)]);
        break;
      case "outline": spec.outline = colour(a[0], where); break;
      case "title-y": spec.title.y = int(a[0]); break;
      case "bpm": spec.bpm = int(a[0]); break;
      case "bars": spec.bars = int(a[0]); break;
      case "effect": spec.effects.push({ name: a[0], p: params(a.slice(1), where), where }); break;
      default: throw new Error(`${where}: unknown setting ${k}`);
    }
  });
  if (!spec.alphabet) throw new Error(`${file}: no alphabet`);
  if (!spec.line) throw new Error(`${file}: no line`);
  if (spec.ramp.length < 1) throw new Error(`${file}: no ramp`);
  for (const e of spec.effects) {
    const impl = EFFECTS[e.name];
    if (!impl) throw new Error(`${e.where}: unknown effect ${e.name}`);
    checkParams(e, impl.params);
  }
  return spec;
}

// Every effect names its parameters and their kinds: num, colour,
// colours (a list), cells (X:Y:W:H:COLOUR, ...), bands (ROW:HEIGHT:DX,
// ...). An unknown key, a missing required one (kind ending in !) or a
// value of the wrong kind is a refusal at the spec's line, so a typo can't
// silently switch an effect off.
function checkParams(e, schema) {
  const where = `${e.where}: effect ${e.name}`;
  const list = (v) => (Array.isArray(v) ? v : [v]);
  for (const [k, kind] of Object.entries(schema)) {
    if (kind.endsWith("!") && e.p[k] === undefined) throw new Error(`${where} needs ${k}=`);
  }
  for (const [k, v] of Object.entries(e.p)) {
    const kind = schema[k];
    if (!kind) throw new Error(`${where} has no parameter ${k} (it takes ${Object.keys(schema).join(", ")})`);
    const bad = (why) => { throw new Error(`${where}: ${k}=${list(v).join(",")} ${why}`); };
    switch (kind.replace("!", "")) {
      case "num": if (typeof v !== "number") bad("is not a number"); break;
      case "colours": if (!list(v).every((c) => c === null || (typeof c === "string" && c.startsWith("#")))) bad("are not all colours"); break;
      case "cells":
        e.p[k] = list(v).map((c) => {
          const m = typeof c === "string" && c.match(/^(-?\d+):(-?\d+):(\d+):(\d+):(#[0-9A-Fa-f]{6}|none)$/);
          if (!m) bad(`: ${c} is not X:Y:W:H:COLOUR`);
          return [+m[1], +m[2], +m[3], +m[4], colour(m[5], where)];
        });
        break;
      case "bands":
        e.p[k] = list(v).map((b) => {
          const m = typeof b === "string" && b.match(/^(-?\d+):(\d+):(-?\d+)$/);
          if (!m) bad(`: ${b} is not ROW:HEIGHT:DX`);
          return [+m[1], +m[2], +m[3]];
        });
        break;
      default: throw new Error(`${where}: unknown kind ${kind}`);
    }
  }
  if (schema.colours === "colours!" && e.name === "split" && list(e.p.colours).length !== 2) throw new Error(`${where}: colours= takes two, left and right`);
}

// ---- the plane -----------------------------------------------------------------------
//
// Everything is drawn on a plane of materials: 0 nothing, 1 letter ink
// (coloured by the ramp), and from 2 up an entry in the render's colour
// table (a flat colour, or two mixed by Bayer). `row` is each pixel's row
// in the cap height (0 at the cap line).

class Plane {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.mat = new Uint8Array(w * h);
    this.row = new Int16Array(w * h);
    this.colours = [null, null];     // index 2 up: { a, b, t }
  }
  at(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? y * this.w + x : -1; }
  colourIndex(a, b = null, t = 0) {
    const key = `${a}|${b}|${t}`;
    if (!this.keys) this.keys = new Map();
    if (this.keys.has(key)) return this.keys.get(key);
    const k = this.colours.length;
    if (k > 255) throw new Error("more than 254 decoration colours");
    this.colours.push({ a, b, t });
    this.keys.set(key, k);
    return k;
  }
}

// Lay the line out: each glyph instance with its plane position.
function layout(spec, A) {
  const cap = A.height;
  let x = 0;
  const items = [];
  for (const ch of spec.line) {
    if (ch === " ") { x += spec.space; continue; }
    const g = A.glyphs.get(ch);
    if (!g) throw new Error(`${spec.file}: ${A.file} has no glyph ${ch}`);
    items.push({ g, x });
    x += g.w + spec.gap;
  }
  const [ml, mt, mr, mb] = spec.margin;
  const wide = x - spec.gap;
  const placed = items.map((it) => ({ g: it.g, x: ml + it.x, y: mt, ch: it.g.ch }));
  // the plane's size, rounded up to whole Bayer tiles
  const w = Math.ceil((ml + wide + mr) / 4) * 4;
  const h = Math.ceil((mt + cap + mb) / 4) * 4;
  return { cap, placed, w, h };
}

// ---- rendering ---------------------------------------------------------------------------

function rampColour(ramp, r, x, y, lift) {
  // lift moves the ramp up by that many rows (a beat's flash)
  const rr = r + lift;
  if (rr <= ramp[0][0]) return ramp[0][1];
  for (let k = 1; k < ramp.length; k++) {
    const [r1, c1] = ramp[k], [r0, c0] = ramp[k - 1];
    if (rr <= r1) return bayerOn((rr - r0) / (r1 - r0), x, y) ? c1 : c0;
  }
  return ramp[ramp.length - 1][1];
}

// One frame: time t in seconds (null for the still wordmark), or a clock
// given whole ({ t, beat, sub, quiet, lift }) for a chosen moment.
export function render(spec, A, t = null) {
  const L = layout(spec, A);
  const P = new Plane(L.w, L.h);
  const clock = t === null ? null : typeof t === "object" ? t : { t, beat: (t * spec.bpm) / 60 };
  const fx = spec.effects.map((e) => ({ ...e, impl: EFFECTS[e.name] }));

  for (const it of L.placed) {
    for (let r = 0; r < it.g.h; r++) for (let i = 0; i < it.g.w; i++) {
      if (!it.g.rows[r][i]) continue;
      const k = P.at(it.x + i, it.y + r);
      if (k < 0) continue;
      P.mat[k] = 1; P.row[k] = r;
    }
  }
  for (const e of fx) if (e.impl.plane) e.impl.plane(e.p, L, P, clock, spec);

  // colour it; a quiet clock (the web's glitch frames) has no beat flash,
  // and clock.lift sets the flash directly (the game's atlas)
  const lift = clock && clock.lift !== undefined ? clock.lift
    : clock && clock.quiet ? 0 : fx.reduce((s, e) => s + (e.impl.lift ? e.impl.lift(e.p, clock) : 0), 0);
  const C = new Canvas(P.w, P.h);
  const drawn = new Uint8Array(P.w * P.h);
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
    const k = y * P.w + x, m = P.mat[k];
    if (!m) continue;
    let c;
    if (m === 1) c = rampColour(spec.ramp, P.row[k], x, y, lift);
    else { const d = P.colours[m]; c = d.b === null || !bayerOn(d.t, x, y) ? d.a : d.b; }
    if (c === null) continue;
    C.set(x, y, c);
    drawn[k] = 1;
  }

  // the outline: every empty pixel touching a drawn one, all eight ways
  if (spec.outline) {
    const ring = [];
    for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
      if (drawn[y * P.w + x]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = P.at(x + dx, y + dy);
        if (k >= 0 && drawn[k]) { near = true; break; }
      }
      if (near) ring.push(y * P.w + x);
    }
    for (const k of ring) { C.set(k % P.w, Math.floor(k / P.w), spec.outline); drawn[k] = 2; }
  }

  for (const e of fx) if (e.impl.after) e.impl.after(e.p, L, P, C, drawn, clock, spec);
  C.checkPalette(`${spec.name} ${clock === null ? "still" : `beat=${clock.beat.toFixed(3)}`}`);
  return C;
}

// The beat's envelope: 1 on the beat, falling to 0 over `len` beats.
function onBeat(clock, len = 0.25, every = 1) {
  if (!clock) return 0;
  const b = clock.beat % every;
  return b < len ? 1 - b / len : 0;
}

// ---- the effects ---------------------------------------------------------------------------
//
// An effect may have any of: plane(p, L, P, clock, spec), on the plane of
// materials before colouring; lift(p, clock), rows to move the ramp up by
// (the beat's flash); after(p, L, P, C, drawn, clock, spec), on the
// coloured canvas.

const EFFECTS = {
  // The beat's flash: the ramp moves up `rows` rows on the beat and settles.
  pulse: {
    params: { rows: "num", len: "num" },
    lift(p, clock) { return Math.round((p.rows || 2) * onBeat(clock, p.len || 0.3)); },
  },

  // The signal's channels coming apart: the ink's silhouette again, `dx`
  // px to the left in one colour and to the right in another, on empty
  // pixels only, so each letter carries a fringe on either side.
  split: {
    params: { dx: "num", colours: "colours!" },
    plane(p, L, P) {
      const dx = Math.round(p.dx || 2);
      const [left, right] = p.colours;
      const li = P.colourIndex(left), ri = P.colourIndex(right);
      const ink = [];
      for (let k = 0; k < P.mat.length; k++) if (P.mat[k] === 1) ink.push(k);
      for (const [d, c] of [[-dx, li], [dx, ri]]) {
        for (const k of ink) {
          const x = (k % P.w) + d, y = Math.floor(k / P.w);
          const j = P.at(x, y);
          if (j >= 0 && !P.mat[j]) P.mat[j] = c;
        }
      }
    },
  },

  // Bands of the finished image torn sideways: bands=ROW:HEIGHT:DX,... in
  // cap rows. With a clock, each glitch adds bands from the glitch's own
  // seed.
  tear: {
    params: { bands: "bands!", reach: "num", every: "num", hold: "num", seed: "num" },
    after(p, L, P, C, drawn, clock) {
      const y0 = L.placed[0].y;
      const bands = p.bands.map((b) => b.slice());
      const g = glitch(p, clock);
      if (g > 0) {
        const rnd = seeded(glitchSeed(p, clock, 7919, 1));
        const n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          bands.push([Math.floor(rnd() * 40) - 2, 1 + Math.floor(rnd() * 4), Math.round((rnd() * 2 - 1) * (p.reach || 10) * g)]);
        }
      }
      for (const [r, h, dx] of bands) {
        if (!dx) continue;
        for (let y = y0 + r; y < y0 + r + h; y++) {
          if (y < 0 || y >= C.h) continue;
          // the pixels and the mask of what is drawn move together, so a
          // later effect sees the letters where they now are
          const row = Buffer.from(C.px.subarray(y * C.w * 4, (y + 1) * C.w * 4));
          const was = drawn.slice(y * C.w, (y + 1) * C.w);
          C.px.fill(0, y * C.w * 4, (y + 1) * C.w * 4);
          drawn.fill(0, y * C.w, (y + 1) * C.w);
          for (let x = 0; x < C.w; x++) {
            const sx = x - dx;
            if (sx < 0 || sx >= C.w) continue;
            C.px.set(row.subarray(sx * 4, sx * 4 + 4), (y * C.w + x) * 4);
            drawn[y * C.w + x] = was[sx];
          }
        }
      }
    },
  },

  // Corrupt blocks: small runs of the letters replaced by static or ICE,
  // or dropped out (none). cells=X:Y:W:H:COLOUR,... in plane pixels
  // relative to the first glyph's cap corner, for the still; with a
  // clock a glitch adds more from its seed.
  blocks: {
    params: { cells: "cells!", colours: "colours", count: "num", every: "num", hold: "num", seed: "num" },
    after(p, L, P, C, drawn, clock, spec) {
      const x0 = L.placed[0].x, y0 = L.placed[0].y;
      const list = p.cells.map((c) => c.slice());
      const placed = list.length;
      const g = glitch(p, clock);
      if (g > 0) {
        const rnd = seeded(glitchSeed(p, clock, 104729, 2));
        const cols = Array.isArray(p.colours) ? p.colours : [p.colours];
        const n = Math.round((p.count || 6) * g);
        for (let i = 0; i < n; i++) {
          list.push([Math.floor(rnd() * (P.w - x0)), Math.floor(rnd() * 40), 2 + Math.floor(rnd() * 8), 1 + Math.floor(rnd() * 3), cols[Math.floor(rnd() * cols.length)] ?? null]);
        }
      }
      list.forEach(([bx, by, bw, bh, col], n) => {
        let hit = 0;
        for (let y = y0 + by; y < y0 + by + bh; y++) for (let x = x0 + bx; x < x0 + bx + bw; x++) {
          const k = P.at(x, y);
          if (k < 0 || drawn[k] !== 1) continue;     // only over letters
          hit++;
          if (col === null) { C.px.fill(0, k * 4, k * 4 + 4); drawn[k] = 0; }
          else C.set(x, y, col);
        }
        // a block drawn by hand that touches no letter is a mistake in the
        // spec (a letter moved under it), not a glitch
        if (!clock && n < placed && hit === 0) {
          throw new Error(`${spec.file}: blocks cell ${n + 1} (${bx}:${by}:${bw}:${bh}) lands on no letter`);
        }
      });
    },
  },
};

// A glitch's strength at this moment: 1 at the start of every `every`
// beats (a bar by default), held `hold` beats, then gone. 0 for the still.
function glitch(p, clock) {
  if (!clock) return 0;
  const b = clock.beat % (p.every || 4);
  return b < (p.hold || 0.25) ? 1 : 0;
}

// A glitch's seed: one per glitch (every `every` beats), and a second
// state halfway through it, so a burst flickers once instead of holding
// one picture. clock.sub, when given, picks the state directly.
function glitchSeed(p, clock, mul, base) {
  const every = p.every || 4;
  const sub = clock.sub ?? ((clock.beat % every) < (p.hold || 0.25) / 2 ? 0 : 1);
  return Math.floor(clock.beat / every) * mul + (p.seed || base) + 31 * sub;
}

// A small deterministic generator (mulberry32) for a glitch's own choices.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the post pass, simulated ---------------------------------------------------------------
//
// The game snaps every pixel of its frame to the palette after adding the
// 4x4 Bayer threshold, t = ((M[y%4][x%4] + 0.5) / 16 - 0.5) * spread, to
// all three channels (src/signal/lut.sgl's lookup pass, the default, and
// src/signal/dither.sgl's exact pass behind the lut knob). This runs both
// at the game's spread over a picture placed at a multiple of 4 and names
// any pixel either would change.

const SPREAD = 8;
let LUT = null;
const EMBER_RGB = EMBERS.map(hex);

function postPass(c, x, y) {
  const t = ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * SPREAD;
  const q = c.map((v) => Math.max(0, Math.min(255, v + t)));
  if (!LUT) LUT = readRGBA(path.join(ROOT, "assets/signal/lut-embers.png"));
  const b = q.map((v) => Math.min(63, Math.floor(v / 4)));
  const k = ((b[1] + 64 * Math.floor(b[2] / 8)) * LUT.w + b[0] + 64 * (b[2] % 8)) * 4;
  const viaLut = [LUT.px[k], LUT.px[k + 1], LUT.px[k + 2]];
  let best = Infinity, exact = EMBER_RGB[0];
  for (const p of EMBER_RGB) {
    const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (e < best) { best = e; exact = p; }
  }
  return [viaLut, exact];
}

export function postPassCheck(C, label) {
  let bad = 0, first = null;
  for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) {
    const k = (y * C.w + x) * 4;
    if (!C.px[k + 3]) continue;
    const c = [C.px[k], C.px[k + 1], C.px[k + 2]];
    const [a, b] = postPass(c, x, y);
    const same = (o) => o[0] === c[0] && o[1] === c[1] && o[2] === c[2];
    if (!same(a) || !same(b)) {
      bad++;
      if (!first) first = `(${x},${y}) ${c.join(",")} -> lookup ${a.join(",")}, exact ${b.join(",")}`;
    }
  }
  if (bad) throw new Error(`${label}: ${bad} pixels the game's post pass would change, first ${first}`);
}

// ---- the marks ----------------------------------------------------------------------------

// A picture at 1x, with a border of ground `pad` pixels wide.
function pictureCanvas(pic, pad = 0) {
  if (pad && !pic.ground) throw new Error(`${pic.file}: a border needs a \`ground K\` line naming its colour`);
  const w = pic.w + 2 * pad, h = pic.h + 2 * pad;
  const C = new Canvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x - pad, py = y - pad;
    const inside = px >= 0 && py >= 0 && px < pic.w && py < pic.h;
    const r = inside ? pic.rows[py][px] : pic.ground;
    if (!r) continue;
    const c = r.b && bayerOn(r.t, x, y) ? r.b : r.a;
    if (!EMBER_SET.has(c)) throw new Error(`${pic.file}: ${c} is not an embers colour`);
    C.set(x, y, c);
  }
  return C;
}

function scaled(C, s) {
  const out = new Canvas(C.w * s, C.h * s);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const k = (Math.floor(y / s) * C.w + Math.floor(x / s)) * 4, o = (y * out.w + x) * 4;
    out.px[o] = C.px[k]; out.px[o + 1] = C.px[k + 1]; out.px[o + 2] = C.px[k + 2]; out.px[o + 3] = C.px[k + 3];
  }
  return out;
}

// An ICO holding PNGs (every browser reads PNG entries).
function writeICO(file, pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size; head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...pngs.map((p) => p.data)]));
}

// ---- crops and output ------------------------------------------------------------------------

function bounds(C) {
  let x0 = C.w, y0 = C.h, x1 = -1, y1 = -1;
  for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) if (C.px[(y * C.w + x) * 4 + 3]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

// Snap a box outward to whole 4x4 tiles, so the crop keeps the Bayer phase.
function snap(b) {
  const x0 = Math.floor(b.x0 / 4) * 4, y0 = Math.floor(b.y0 / 4) * 4;
  return { x: x0, y: y0, w: Math.ceil((b.x1 + 1 - x0) / 4) * 4, h: Math.ceil((b.y1 + 1 - y0) / 4) * 4 };
}

function crop(C, r) {
  const out = new Canvas(r.w, r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const sx = r.x + x, sy = r.y + y;
    if (sx < 0 || sy < 0 || sx >= C.w || sy >= C.h) continue;
    const k = (sy * C.w + sx) * 4, o = (y * r.w + x) * 4;
    for (let c = 0; c < 4; c++) out.px[o + c] = C.px[k + c];
  }
  return out;
}

function pngBytes(C) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gen-logo-")), "x.png");
  C.save(tmp);
  const b = fs.readFileSync(tmp);
  fs.rmSync(path.dirname(tmp), { recursive: true });
  return b;
}

function build(spec, outDir, still) {
  const A = readAlphabet(path.join(SRC, `${spec.alphabet}.txt`));
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];

  // the wordmark
  const W = render(spec, A, null);
  const wb = snap(bounds(W));
  const word = crop(W, wb);
  postPassCheck(word, `${spec.name} wordmark`);
  word.save(path.join(outDir, "wordmark.png"));
  scaled(word, 2).save(path.join(outDir, "wordmark@2x.png"));
  scaled(word, 4).save(path.join(outDir, "wordmark@4x.png"));
  report.push(`wordmark ${word.w}x${word.h} ${word.colourCount()} colours`);

  // the marks: 16 and 32 drawn at size; 180 is the 32 drawing on a tile
  // two pixels wider each side (36), at 5x, unless it has its own drawing
  const marks = {};
  for (const size of [16, 32, 180]) {
    let f = path.join(SRC, "marks", `${spec.name}-${size}.txt`);
    let pad = 0;
    if (size === 180 && !fs.existsSync(f)) { f = path.join(SRC, "marks", `${spec.name}-32.txt`); pad = 2; }
    if (!fs.existsSync(f)) { report.push(`mark-${size} (no drawing yet)`); continue; }
    const pic = readPicture(f);
    const side = pic.w + 2 * pad;
    // 16 and 32 are drawn at size; a 180 of its own may be drawn smaller
    if (pic.w !== pic.h || (size !== 180 && pic.w !== size) || size % side) {
      throw new Error(`${f}: ${pic.w}x${pic.h} (pad ${pad}) is not a ${size} px mark`);
    }
    const m = scaled(pictureCanvas(pic, pad), size / side);
    m.save(path.join(outDir, `mark-${size}.png`));
    marks[size] = m;
    report.push(`mark-${size} from ${path.basename(f)}${pad ? ` on a ${side} tile` : ""} x${size / side}`);
  }
  if (marks[16] && marks[32]) writeICO(path.join(outDir, "favicon.ico"), [16, 32].map((s) => ({ size: s, data: pngBytes(marks[s]) })));

  // the title: one loop of `bars` bars at the spec's tempo
  if (!still) {
    const n = Math.round((spec.bars * 4 * 60 * FPS) / spec.bpm);
    const frames = [];
    let box = null;
    for (let f = 0; f < n; f++) {
      const F = render(spec, A, f / FPS);
      frames.push(F);
      const b = bounds(F);
      box = box ? union(box, b) : b;
    }
    const r = snap(box);
    const x = Math.round((VIEW_W - r.w) / 8) * 4;
    const y = Math.round(spec.title.y / 4) * 4;
    if (x < 0 || y < 0 || x + r.w > VIEW_W || y + r.h > VIEW_H) {
      throw new Error(`${spec.name}: the title, ${r.w}x${r.h} at (${x}, ${y}), does not fit the ${VIEW_W}x${VIEW_H} view`);
    }
    const cols = Math.max(1, Math.floor(4096 / r.w));
    const rows = Math.ceil(n / cols);
    const sheet = new Canvas(cols * r.w, rows * r.h);
    frames.forEach((F, f) => {
      const c = crop(F, r);
      postPassCheck(c, `${spec.name} title frame ${f}`);
      const ox = (f % cols) * r.w, oy = Math.floor(f / cols) * r.h;
      for (let y = 0; y < r.h; y++) sheet.px.set(c.px.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((oy + y) * sheet.w + ox) * 4);
    });
    sheet.save(path.join(outDir, "title.png"));
    fs.writeFileSync(path.join(outDir, "title.json"), JSON.stringify({ w: r.w, h: r.h, frames: n, cols, fps: FPS, bpm: spec.bpm, x, y }, null, 1) + "\n");
    report.push(`title ${r.w}x${r.h} x ${n} frames at (${x}, ${y})`);
  }
  console.log(`${spec.name}: ${report.join("; ")}`);
}

// ---- the export for the site -----------------------------------------------------------------
//
// --export NAME DIR: the chosen direction's files as the site and the game
// take them, from what build() wrote under docs/logo/NAME/:
//   logo.png (the wordmark at 2x), logo-1x.png, logo-4x.png,
//   favicon.ico (16 and 32), favicon.png (32), apple-touch-icon.png (180),
//   og.png (1200x630: the game's title frame at 2x with the logo on it,
//   centred on the game's ground), title.png and title.json (the title
//   animation), and FILES.txt listing every file with its size and hash.

function readRGBA(file) {
  // PNGs this script and lib.mjs wrote: 8-bit RGBA, non-interlaced; and the
  // game's captures (8-bit RGB or RGBA).
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12] !== 0 || (ct !== 6 && ct !== 2)) throw new Error(`${file}: only 8-bit RGB/RGBA non-interlaced PNGs`); }
    if (type === "IDAT") idat.push(d);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, st = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? px[y * st + x - bpp] : 0, b = y ? px[(y - 1) * st + x] : 0, c = x >= bpp && y ? px[(y - 1) * st + x - bpp] : 0;
      let v = raw[y * (st + 1) + 1 + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * st + x] = v & 255;
    }
  }
  const C = new Canvas(w, h);
  for (let i = 0; i < w * h; i++) {
    C.px[i * 4] = px[i * bpp]; C.px[i * 4 + 1] = px[i * bpp + 1]; C.px[i * 4 + 2] = px[i * bpp + 2]; C.px[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return C;
}

function over(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const k = (y * src.w + x) * 4;
    if (!src.px[k + 3]) continue;
    const tx = ox + x, ty = oy + y;
    if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
    dst.px.set(src.px.subarray(k, k + 4), (ty * dst.w + tx) * 4);
  }
}

const WEB_GLITCHES = 4;

// The web's glitch timeline: [frame, ms], frame 0 the still. About 8.8 s
// a loop: the logo holds two seconds or so, then glitches for a tenth of
// one, flickering between the glitch's two states.
const WEB_TIMELINE = [[0, 2200], [1, 60], [2, 70], [0, 1900], [3, 50], [4, 60], [0, 2700], [5, 70], [6, 40], [0, 1500], [7, 60], [8, 80]];

function glitchScript(n) {
  return `// logo-glitch.js - the Signal Overdrive wordmark's glitch, for the web.
// Written by scripts/art/gen-logo.mjs --export.
//
//   <img src="logo.png" alt="Signal Overdrive" data-glitch="logo-glitch-{n}.png">
//   <script src="logo-glitch.js" defer></script>
//
// logo.png is the still wordmark, and it is what shows with JS off and
// under prefers-reduced-motion (checked live, so turning it on stops the
// glitch at once). Otherwise, once every frame has loaded, the img's src
// steps through logo-glitch-1.png to -${n}.png on a fixed timeline: the
// logo holds for a couple of seconds, then glitches for a tenth of one.
// Every frame is the same size as logo.png, so the page's CSS for the img
// applies unchanged; give it image-rendering: pixelated. It stops while
// the tab is hidden.
(() => {
  const T = ${JSON.stringify(WEB_TIMELINE)};
  const rm = matchMedia("(prefers-reduced-motion: reduce)");
  for (const img of document.querySelectorAll("img[data-glitch]")) {
    const urls = [img.getAttribute("src")];
    for (let i = 1; i <= ${n}; i++) urls.push(img.dataset.glitch.replace("{n}", i));
    let step = 0, timer = 0;
    const stop = () => { clearTimeout(timer); timer = 0; img.src = urls[0]; };
    const run = () => {
      if (rm.matches || document.hidden) return stop();
      const [i, ms] = T[step];
      img.src = urls[i];
      step = (step + 1) % T.length;
      timer = setTimeout(run, ms);
    };
    const wake = () => { if (rm.matches || document.hidden) stop(); else if (!timer) run(); };
    Promise.all(urls.slice(1).map((u) => { const p = new Image(); p.src = u; return p.decode(); }))
      .then(() => {
        wake();
        rm.addEventListener("change", wake);
        document.addEventListener("visibilitychange", wake);
      })
      .catch(() => {});   // a frame did not load: the still stays
  }
})();
`;
}

function embedNote(name, word, glitches) {
  const w2 = word.w * 2, h2 = word.h * 2;
  return `Signal Overdrive logo, direction ${name.toUpperCase()}: the files for the site
Written by scripts/art/gen-logo.mjs --export ${name}. Pixel art: show it at
whole multiples of its size where you can, and always nearest-neighbour.

The wordmark
  logo.png ${w2}x${h2} (2x), logo-1x.png ${word.w}x${word.h}, logo-4x.png ${word.w * 4}x${word.h * 4}
${glitches ? `
  With the glitch (logo.png stays the picture with JS off and under
  prefers-reduced-motion):
    <img class="logo" src="/logo.png" width="${w2}" height="${h2}" alt="Signal Overdrive" data-glitch="/logo-glitch-{n}.png">
    <script src="/logo-glitch.js" defer></script>
    .logo { image-rendering: pixelated; max-width: 100%; height: auto; }
  The frames logo-glitch-1.png to -${WEB_GLITCHES * 2}.png are the same size as logo.png.
` : `
    <img class="logo" src="/logo.png" width="${w2}" height="${h2}" alt="Signal Overdrive">
    .logo { image-rendering: pixelated; max-width: 100%; height: auto; }
`}
The icons
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  favicon.ico holds the 16 and 32 px drawings; apple-touch-icon.png is 180x180.

The social preview
    <meta property="og:image" content="https://signaloverdrive.net/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
  og.png is the game's title frame at 2x with the logo on it.
`;
}

async function exportFor(name, dir) {
  const from = path.join(ROOT, "docs/logo", name);
  if (!fs.existsSync(path.join(from, "title.json"))) throw new Error(`docs/logo/${name}/ is not rendered; run gen-logo.mjs ${name} first`);
  fs.mkdirSync(dir, { recursive: true });
  const copy = (a, b) => fs.copyFileSync(path.join(from, a), path.join(dir, b));
  copy("favicon.ico", "favicon.ico");
  copy("mark-32.png", "favicon.png");
  copy("mark-180.png", "apple-touch-icon.png");

  // The wordmark, and for a direction that glitches, the web's glitch: the
  // still first, then each of WEB_GLITCHES glitches in its two states, all
  // cropped to one box so any of them can stand in for another in an img.
  const spec = readSpec(path.join(SRC, `${name}.spec`));
  const A = readAlphabet(path.join(SRC, `${spec.alphabet}.txt`));
  const glitches = spec.effects.some((e) => e.name === "tear" || e.name === "blocks");
  const pics = [render(spec, A, null)];
  if (glitches) {
    for (let k = 0; k < WEB_GLITCHES; k++) for (const sub of [0, 1]) pics.push(render(spec, A, { t: 0, beat: 4 * k, sub, quiet: true }));
  }
  let box = null;
  for (const P of pics) { const b = bounds(P); box = box ? union(box, b) : b; }
  const frames = pics.map((P) => crop(P, snap(box)));
  const word = frames[0];
  word.save(path.join(dir, "logo-1x.png"));
  scaled(word, 2).save(path.join(dir, "logo.png"));
  scaled(word, 4).save(path.join(dir, "logo-4x.png"));
  if (glitches) {
    frames.slice(1).forEach((F, i) => scaled(F, 2).save(path.join(dir, `logo-glitch-${i + 1}.png`)));
    fs.writeFileSync(path.join(dir, "logo-glitch.js"), glitchScript(frames.length - 1));
  }
  fs.writeFileSync(path.join(dir, "EMBED.txt"), embedNote(name, word, glitches));
  // og.png: the title screen as the game draws it, at 2x, centred on the
  // ground. docs/logo/frames/title-og.png is a capture of the web build's
  // title with ?nohud (the logo drawn by the game, no prompt); without one,
  // the bare title frame with the still wordmark where the title rests.
  const ogCapture = path.join(ROOT, "docs/logo/frames/title-og.png");
  let frame;
  if (fs.existsSync(ogCapture)) {
    frame = readRGBA(ogCapture);
    if (frame.w !== VIEW_W || frame.h !== VIEW_H) throw new Error(`${ogCapture}: ${frame.w}x${frame.h}, not the ${VIEW_W}x${VIEW_H} view`);
  } else {
    const t = JSON.parse(fs.readFileSync(path.join(from, "title.json"), "utf8"));
    frame = readRGBA(path.join(ROOT, "docs/logo/frames/title-bare.png"));
    const still = readRGBA(path.join(from, "title.png"));
    // the frame the animation rests on: the last of the loop, away from the beat
    const rest = new Canvas(t.w, t.h);
    const f = t.frames - 1, sx = (f % t.cols) * t.w, sy = Math.floor(f / t.cols) * t.h;
    for (let y = 0; y < t.h; y++) rest.px.set(still.px.subarray(((sy + y) * still.w + sx) * 4, ((sy + y) * still.w + sx + t.w) * 4), y * t.w * 4);
    over(frame, rest, t.x, t.y);
  }
  const og = new Canvas(1200, 630);
  og.rect(0, 0, 1200, 630, "#0D0A1A");
  over(og, scaled(frame, 2), 120, 45);
  og.checkPalette(`${name} og.png`);
  og.save(path.join(dir, "og.png"));
  const lines = fs.readdirSync(dir).filter((f) => f !== "FILES.txt").sort().map((f) => {
    const b = fs.readFileSync(path.join(dir, f));
    const size = f.endsWith(".png") ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : `${b.length} bytes`;
    return `${f}  ${size}  sha256 ${createHash("sha256").update(b).digest("hex").slice(0, 16)}`;
  });
  fs.writeFileSync(path.join(dir, "FILES.txt"), `Signal Overdrive logo, direction ${name}\n\n${lines.join("\n")}\n`);
  console.log(`export ${name} -> ${dir}\n${lines.join("\n")}`);
}

// ---- the game's title ------------------------------------------------------------------------
//
// --game NAME: the title logo the game draws, and the data it picks frames
// with:
//   assets/signal/title-logo.png  frames of one size stacked top to bottom:
//                                 the still with the beat's flash lifting
//                                 its ramp 0..ROWS rows, then each glitch's
//                                 two states (as the web's glitch frames)
//   src/signal/title/logo.sgl     (signal title logo): the frame size, its
//                                 place in the view, and the timing
// Every frame goes through postPassCheck, since the game draws it before
// its post pass.

const GAME_GLITCHES = 4;

function gameExport(name) {
  const spec = readSpec(path.join(SRC, `${name}.spec`));
  const A = readAlphabet(path.join(SRC, `${spec.alphabet}.txt`));
  const fx = (n) => spec.effects.find((e) => e.name === n);
  const pulse = fx("pulse"), timed = fx("tear") || fx("blocks");
  if (!pulse || !timed) throw new Error(`${spec.file}: the game's title needs a pulse and a glitch (tear or blocks)`);
  const rows = pulse.p.rows ?? 2, len = pulse.p.len ?? 0.3;
  const every = timed.p.every ?? 4, hold = timed.p.hold ?? 0.25;
  for (const e of [fx("tear"), fx("blocks")]) {
    if (e && ((e.p.every ?? 4) !== every || (e.p.hold ?? 0.25) !== hold)) throw new Error(`${e.where}: tear and blocks must glitch on the same beats`);
  }
  const pics = [];
  for (let lift = 0; lift <= rows; lift++) pics.push(render(spec, A, { t: 0, beat: 1.5, lift }));
  for (let k = 0; k < GAME_GLITCHES; k++) for (const sub of [0, 1]) pics.push(render(spec, A, { t: 0, beat: every * k, sub, quiet: true }));
  let box = null;
  for (const P of pics) { const b = bounds(P); box = box ? union(box, b) : b; }
  const r = snap(box);
  const frames = pics.map((P, i) => { const F = crop(P, r); postPassCheck(F, `${name} game frame ${i}`); return F; });
  const x = Math.round((VIEW_W - r.w) / 8) * 4, y = Math.round(spec.title.y / 4) * 4;
  if (x < 0 || y < 0 || x + r.w > VIEW_W || y + r.h > VIEW_H) throw new Error(`${name}: the title logo, ${r.w}x${r.h} at (${x}, ${y}), does not fit the view`);
  const atlas = new Canvas(r.w, r.h * frames.length);
  frames.forEach((F, i) => atlas.px.set(F.px, i * r.w * r.h * 4));
  const png = path.join(ROOT, "assets/signal/title-logo.png");
  atlas.save(png);
  const mod = path.join(ROOT, "src/signal/title/logo.sgl");
  fs.mkdirSync(path.dirname(mod), { recursive: true });
  const num = (v) => (Number.isInteger(v) ? String(v) : String(v));
  fs.writeFileSync(mod, `;;; (signal title logo) - GENERATED by scripts/art/gen-logo.mjs --game ${name}; do not edit.
;;;
;;; The title's logo, assets/signal/title-logo.png: LOGO-FRAMES frames of
;;; LOGO-W x LOGO-H stacked top to bottom. Frames 0 to LOGO-LIFTS - 1 are
;;; the still wordmark with the beat's flash lifting its ramp 0, 1, ...
;;; rows; after them come LOGO-GLITCHES glitches, two frames each (the
;;; glitch's first half, then its second). (signal title) picks a frame
;;; from the beat: a glitch for LOGO-GLITCH-HOLD of a beat at the start of
;;; every LOGO-GLITCH-EVERY beats (glitch n for bar n, mod LOGO-GLITCHES),
;;; otherwise the still, its flash falling from LOGO-LIFTS - 1 rows to none
;;; over LOGO-PULSE-LEN of a beat. LOGO-X and LOGO-Y place it in the
;;; 480x270 view, on multiples of 4 so its dither keeps the view's phase.
;;; Every frame is checked to come through the post pass unchanged.

(define-library (signal title logo)
  (import (sigil core))

  (export LOGO-W LOGO-H LOGO-X LOGO-Y LOGO-FRAMES LOGO-LIFTS LOGO-GLITCHES
          LOGO-GLITCH-EVERY LOGO-GLITCH-HOLD LOGO-PULSE-LEN)

  (begin
    (define LOGO-W ${r.w})
    (define LOGO-H ${r.h})
    (define LOGO-X ${x})
    (define LOGO-Y ${y})
    (define LOGO-FRAMES ${frames.length})
    (define LOGO-LIFTS ${rows + 1})
    (define LOGO-GLITCHES ${GAME_GLITCHES})
    (define LOGO-GLITCH-EVERY ${num(every)})
    (define LOGO-GLITCH-HOLD ${num(hold)})
    (define LOGO-PULSE-LEN ${num(len)})))
`);
  console.log(`game ${name}: ${path.relative(ROOT, png)} ${r.w}x${r.h} x ${frames.length} frames at (${x}, ${y}); ${path.relative(ROOT, mod)}`);
}

// ---- main ---------------------------------------------------------------------------------------

// Only when run, not when imported (the game's data and the tests import it).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--game") {
    if (args.length !== 2) throw new Error("usage: gen-logo.mjs --game NAME");
    gameExport(args[1]);
    process.exit(0);
  }
  if (args[0] === "--export") {
    if (args.length !== 3) throw new Error("usage: gen-logo.mjs --export NAME DIR");
    await exportFor(args[1], path.resolve(args[2]));
    process.exit(0);
  }
  const outAt = args.indexOf("--out");
  const OUT = outAt >= 0 ? path.resolve(args[outAt + 1]) : path.join(ROOT, "docs/logo");
  const still = args.includes("--still");
  const names = args.filter((a, i) => !a.startsWith("--") && !(outAt >= 0 && i === outAt + 1));
  const all = fs.readdirSync(SRC).filter((f) => f.endsWith(".spec")).map((f) => f.slice(0, -5)).sort();
  for (const name of names.length ? names : all) {
    if (!all.includes(name)) throw new Error(`no assets/src/logo/${name}.spec`);
    build(readSpec(path.join(SRC, `${name}.spec`)), path.join(OUT, name), still);
  }
}
