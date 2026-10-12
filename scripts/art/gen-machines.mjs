// gen-machines.mjs - the machines' sprite sheet, rendered from a low-poly
// model by a tiny software rasterizer, straight at sprite size.
//
//   node scripts/art/gen-machines.mjs [--zoom]
//
// Writes assets/signal/machines.png, 2048x640, in rows 80 px tall (scene.sgl's
// CELL-H) with the ground point 48 px down (ANCHOR-Y), centred across:
//   row 0    80 px cells (PLAYER-CELL-W): the player (the falcon) from
//            behind, in four runs of five leans (hard left, left, centre,
//            right, hard right; banked and slightly yawed): idle, boosting,
//            then both again with the thrusters' second flicker frame
//   rows 1-3 128 px cells (RIVAL-CELL-W; a side view is ~116 px long): a
//            rival per colour and model (orange needle, magenta brick,
//            violet delta), 16 directions: k * 22.5 degrees, the machine
//            turned right of the line of sight (0: its back to you)
//   rows 4-6 the same, the thrusters' second flicker frame
//   row 7    the shadow in an 80 px cell, then four 32x32 spark frames
// and with --zoom docs/machines-zoom.png, the sheet at 4x for review.
//
// How: each part of the model is a hexahedron (eight corners, so a box that
// tapers); every face is lit flat by one light and its tone is picked from
// the part's colour ramp with the 4x4 Bayer dither, so shading lands in
// palette colours with the post pass's own pattern. An orthographic view
// from behind and above (the game camera's elevation), a z-buffer, pixel
// centres, no anti-aliasing; then a one-pixel outline in the darkest
// colour around the silhouette. Every pixel is checked against the palette.

import fs from "node:fs";
import path from "node:path";
import { Canvas, C, ramp } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const PW = 80, RW = 128, CH = 80, AY = 48;
let CW = PW, AX = PW / 2;         // the cell being drawn
// pixels per model unit: the body is ~1.07 units wide, so 64 px for the
// player and 58 for a rival (a rival's side view, ~1.9 units long, must fit
// 128 px; scene.sgl's PLAYER-BODY and RIVAL-BODY)
const PLAYER_SCALE = 60, RIVAL_SCALE = 54;
let SCALE = PLAYER_SCALE;
const DEG = Math.PI / 180;

// ---- colour ramps (dark to light) -------------------------------------------------
const RAMPS = {
  player: [C.WIRE_DARK, C.TEAL, C.TEAL_MID, C.SELECTED, C.TEXT],
  orange: [C.RUST, C.AMBER_DARK, C.HOT, C.ICE, C.LABEL_LIT],
  magenta: [C.PLUM, C.PLUM_MID, C.ORCHID, C.HIGHLIGHT, C.FACE],
  violet: [C.INDIGO, C.VIOLET, C.VIOLET_MID, C.GIBSON, C.TEXT],
  trim: [C.BG, C.STATIC_B, C.SIDE_DARK, C.SIDE, C.STATIC_A],
  glass: [C.BAR_A, C.WIRE_DARK, C.COLD, C.SLATE_LIGHT, C.FACE_EDGE],
  glow: [C.HOT, C.ICE, C.LABEL_LIT, C.FACE_EDGE, C.FACE_EDGE],
};

// ---- the model (x right, y forward, z up) -------------------------------------------
// A hexahedron: rear face then front face, each [bottom-left, bottom-right,
// top-right, top-left].
function hexa(rear, front, mat) { return { v: [...rear, ...front], mat }; }
function box(x0, x1, y0, y1, z0, z1, mat) {
  return hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
              [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], mat);
}

// Shared: the exhausts and their flames at the back. len: the flame's
// length; flick: the second flicker frame (a longer flame).
function exhausts(parts, xs, y, z0, z1, w, len) {
  for (const cx of xs) {
    parts.push(box(cx - w, cx + w, y - 0.015, y, z0, z1, "glow"));
    const zm = (z0 + z1) / 2, h = (z1 - z0) * 0.35;
    parts.push(hexa([[cx - w * 0.75, y - 0.015, zm - h], [cx + w * 0.75, y - 0.015, zm - h], [cx + w * 0.75, y - 0.015, zm + h], [cx - w * 0.75, y - 0.015, zm + h]],
                    [[cx - 0.005, y - 0.015 - len, zm - 0.005], [cx + 0.005, y - 0.015 - len, zm - 0.005], [cx + 0.005, y - 0.015 - len, zm + 0.005], [cx - 0.005, y - 0.015 - len, zm + 0.005]], "glow"));
  }
}
const sym = (s, a, b) => [Math.min(a * s, b * s), Math.max(a * s, b * s)];

// The player's: one wide flat wedge, a raised spine with the canopy, an
// engine block across the back with three exhausts, two fins.
function falcon(len) {
  const parts = [];
  parts.push(hexa([[-0.52, -0.70, 0.05], [0.52, -0.70, 0.05], [0.50, -0.70, 0.16], [-0.50, -0.70, 0.16]],
                  [[-0.10, 0.88, 0.05], [0.10, 0.88, 0.05], [0.08, 0.88, 0.09], [-0.08, 0.88, 0.09]], "body"));
  for (const s of [-1, 1]) {
    const [x0, x1] = sym(s, 0.46, 0.55);
    parts.push(hexa([[x0, -0.72, 0.03], [x1, -0.72, 0.03], [x1, -0.72, 0.09], [x0, -0.72, 0.09]],
                    [[x0 * 0.45, 0.55, 0.03], [x1 * 0.45, 0.55, 0.03], [x1 * 0.45, 0.55, 0.06], [x0 * 0.45, 0.55, 0.06]], "trim"));
  }
  parts.push(hexa([[-0.20, -0.66, 0.15], [0.20, -0.66, 0.15], [0.15, -0.66, 0.30], [-0.15, -0.66, 0.30]],
                  [[-0.07, 0.55, 0.08], [0.07, 0.55, 0.08], [0.04, 0.55, 0.12], [-0.04, 0.55, 0.12]], "stripe"));
  parts.push(hexa([[-0.12, -0.25, 0.25], [0.12, -0.25, 0.25], [0.08, -0.20, 0.36], [-0.08, -0.20, 0.36]],
                  [[-0.06, 0.30, 0.12], [0.06, 0.30, 0.12], [0.03, 0.22, 0.17], [-0.03, 0.22, 0.17]], "glass"));
  parts.push(box(-0.40, 0.40, -0.84, -0.66, 0.05, 0.27, "pod"));
  exhausts(parts, [-0.25, 0, 0.25], -0.84, 0.09, 0.22, 0.08, len);
  for (const s of [-1, 1]) {
    const [x0, x1] = sym(s, 0.44, 0.48);
    parts.push(hexa([[x0, -0.72, 0.15], [x1, -0.72, 0.15], [x1, -0.80, 0.34], [x0, -0.80, 0.34]],
                    [[x0, -0.36, 0.15], [x1, -0.36, 0.15], [x1, -0.56, 0.20], [x0, -0.56, 0.20]], "stripe"));
  }
  return parts;
}

// A needle: a long thin fuselage, two outrigger engines on thin wings, one
// tall fin. Reads long and fast from the side.
function needle(len) {
  const parts = [];
  parts.push(hexa([[-0.15, -0.72, 0.06], [0.15, -0.72, 0.06], [0.13, -0.72, 0.26], [-0.13, -0.72, 0.26]],
                  [[-0.03, 1.00, 0.08], [0.03, 1.00, 0.08], [0.02, 1.00, 0.11], [-0.02, 1.00, 0.11]], "body"));
  parts.push(hexa([[-0.09, -0.10, 0.22], [0.09, -0.10, 0.22], [0.06, -0.05, 0.32], [-0.06, -0.05, 0.32]],
                  [[-0.04, 0.45, 0.12], [0.04, 0.45, 0.12], [0.02, 0.40, 0.16], [-0.02, 0.40, 0.16]], "glass"));
  for (const s of [-1, 1]) {
    const [w0, w1] = sym(s, 0.12, 0.40);
    parts.push(box(w0, w1, -0.55, -0.05, 0.10, 0.14, "stripe"));
    const [p0, p1] = sym(s, 0.36, 0.52);
    parts.push(hexa([[p0, -0.78, 0.04], [p1, -0.78, 0.04], [p1, -0.78, 0.20], [p0, -0.78, 0.20]],
                    [[p0 + 0.02 * s, 0.30, 0.07], [p1 - 0.03 * s, 0.30, 0.07], [p1 - 0.03 * s, 0.30, 0.14], [p0 + 0.02 * s, 0.30, 0.14]], "pod"));
    exhausts(parts, [0.44 * s], -0.78, 0.07, 0.17, 0.06, len);
  }
  parts.push(hexa([[-0.02, -0.70, 0.25], [0.02, -0.70, 0.25], [0.02, -0.82, 0.52], [-0.02, -0.82, 0.52]],
                  [[-0.02, -0.30, 0.25], [0.02, -0.30, 0.25], [0.02, -0.55, 0.30], [-0.02, -0.55, 0.30]], "stripe"));
  return parts;
}

// A brick: wide, tall and square, short nose, armoured sides, four
// engines in two stacks. Reads heavy.
function brick(len) {
  const parts = [];
  parts.push(hexa([[-0.48, -0.70, 0.05], [0.48, -0.70, 0.05], [0.44, -0.70, 0.34], [-0.44, -0.70, 0.34]],
                  [[-0.30, 0.70, 0.05], [0.30, 0.70, 0.05], [0.24, 0.70, 0.16], [-0.24, 0.70, 0.16]], "body"));
  for (const s of [-1, 1]) {
    const [x0, x1] = sym(s, 0.46, 0.54);
    parts.push(hexa([[x0, -0.66, 0.04], [x1, -0.66, 0.04], [x1, -0.66, 0.24], [x0, -0.66, 0.24]],
                    [[x0 - 0.06 * s, 0.50, 0.04], [x1 - 0.12 * s, 0.50, 0.04], [x1 - 0.12 * s, 0.50, 0.14], [x0 - 0.06 * s, 0.50, 0.14]], "pod"));
  }
  parts.push(hexa([[-0.20, -0.30, 0.33], [0.20, -0.30, 0.33], [0.16, -0.26, 0.42], [-0.16, -0.26, 0.42]],
                  [[-0.14, 0.30, 0.18], [0.14, 0.30, 0.18], [0.10, 0.24, 0.24], [-0.10, 0.24, 0.24]], "glass"));
  parts.push(box(-0.44, 0.44, -0.78, -0.68, 0.06, 0.34, "pod"));
  exhausts(parts, [-0.26, 0.26], -0.78, 0.08, 0.18, 0.10, len);
  exhausts(parts, [-0.26, 0.26], -0.78, 0.21, 0.31, 0.10, len * 0.8);
  parts.push(box(-0.30, 0.30, -0.72, -0.52, 0.34, 0.37, "stripe"));
  return parts;
}

// A delta: a flat triangular wing from the nose to the rear corners, a
// central pod and twin fins at the wing tips.
function delta(len) {
  const parts = [];
  parts.push(hexa([[-0.54, -0.70, 0.06], [0.54, -0.70, 0.06], [0.54, -0.70, 0.11], [-0.54, -0.70, 0.11]],
                  [[-0.02, 0.92, 0.06], [0.02, 0.92, 0.06], [0.02, 0.92, 0.08], [-0.02, 0.92, 0.08]], "body"));
  parts.push(hexa([[-0.16, -0.74, 0.08], [0.16, -0.74, 0.08], [0.12, -0.74, 0.28], [-0.12, -0.74, 0.28]],
                  [[-0.05, 0.60, 0.08], [0.05, 0.60, 0.08], [0.03, 0.60, 0.13], [-0.03, 0.60, 0.13]], "pod"));
  parts.push(hexa([[-0.09, -0.20, 0.25], [0.09, -0.20, 0.25], [0.06, -0.15, 0.34], [-0.06, -0.15, 0.34]],
                  [[-0.04, 0.38, 0.12], [0.04, 0.38, 0.12], [0.02, 0.32, 0.16], [-0.02, 0.32, 0.16]], "glass"));
  exhausts(parts, [-0.07, 0.07], -0.74, 0.11, 0.24, 0.05, len);
  for (const s of [-1, 1]) {
    const [x0, x1] = sym(s, 0.46, 0.50);
    parts.push(hexa([[x0, -0.70, 0.10], [x1, -0.70, 0.10], [x1, -0.78, 0.36], [x0, -0.78, 0.36]],
                    [[x0 + 0.02 * s, -0.40, 0.10], [x1 + 0.02 * s, -0.40, 0.10], [x1 + 0.02 * s, -0.55, 0.16], [x0 + 0.02 * s, -0.55, 0.16]], "stripe"));
  }
  return parts;
}

const MODELS = { falcon, needle, brick, delta };
function model(kind, boost, flick) {
  const len = (boost ? 0.42 : 0.10) * (flick ? 1.35 : 1);
  return MODELS[kind](len);
}

// ---- rasterize -------------------------------------------------------------------------
const FACES = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
const LIGHT = (() => { const l = [-0.45, 0.35, 0.82]; const n = Math.hypot(...l); return l.map((v) => v / n); })();

function render(canvas, ox, oy, colours, { kind, yaw, roll, elev, boost, flick, cw, scale }) {
  CW = cw; AX = cw / 2; SCALE = scale;
  const zbuf = new Float32Array(CW * CH).fill(Infinity);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const ce = Math.cos(elev), se = Math.sin(elev);
  const hover = 0.07;
  // model -> world (roll about forward, then yaw) -> view
  const xf = ([x, y, z]) => {
    const x1 = x * cr + z * sr, z1 = z * cr - x * sr;
    const x2 = x1 * cy + y * sy, y2 = -x1 * sy + y * cy;
    return [x2, y2, z1 + hover];
  };
  const toScreen = ([x, y, z]) => [AX + x * SCALE, AY - (z * ce + y * se) * SCALE, y * ce - z * se];
  for (const part of model(kind, boost, flick)) {
    const wv = part.v.map(xf);
    const centre = wv.reduce((a, v) => [a[0] + v[0] / 8, a[1] + v[1] / 8, a[2] + v[2] / 8], [0, 0, 0]);
    const ramp5 = part.mat === "body" ? colours.body : part.mat === "pod" ? colours.pod
      : part.mat === "stripe" ? colours.stripe : RAMPS[part.mat];
    for (const f of FACES) {
      const q = f.map((i) => wv[i]);
      // the face normal, outward
      const a = q[0], b = q[1], c = q[2], d = q[3];
      const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...n); if (nl < 1e-9) continue;
      n = n.map((k) => k / nl);
      const fc = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
      if ((fc[0] - centre[0]) * n[0] + (fc[1] - centre[1]) * n[1] + (fc[2] - centre[2]) * n[2] < 0) n = n.map((k) => -k);
      // facing the camera? the view looks along +y and down: toward the viewer is (0, -ce, se)
      if (n[1] * -ce + n[2] * se <= 0) continue;
      const lit = part.mat === "glow" ? (flick ? 0.55 : 0.42) + 0.3 * Math.max(0, n[2])
        : Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) * 0.8 + 0.12;
      const s = q.map(toScreen);
      for (const tri of [[s[0], s[1], s[2]], [s[0], s[2], s[3]]]) fill(tri, (x, y, z) => {
        const k = y * CW + x;
        if (z >= zbuf[k] - 1e-6) return;
        zbuf[k] = z;
        canvas.set(ox + x, oy + y, ramp(ramp5, lit, x, y));
      });
    }
  }
  // the outline: an empty pixel beside a filled one
  const filled = (x, y) => x >= 0 && y >= 0 && x < CW && y < CH && canvas.get(ox + x, oy + y)[3] > 0;
  const edge = [];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (filled(x, y)) continue;
    if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) edge.push([x, y]);
  }
  for (const [x, y] of edge) canvas.set(ox + x, oy + y, C.BG);
  // nothing may touch the cell's border (it would bleed into the neighbour)
  for (let x = 0; x < CW; x++) for (const y of [0, CH - 1]) if (filled(x, y)) throw new Error(`machine overflows its cell (row) at ${x},${y}`);
  for (let y = 0; y < CH; y++) for (const x of [0, CW - 1]) if (filled(x, y)) throw new Error(`machine overflows its cell (col) at ${x},${y}`);
}

// Fill a screen triangle at pixel centres; z interpolated.
function fill([a, b, c], plot) {
  const minx = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxx = Math.min(CW - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const miny = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxy = Math.min(CH - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    plot(x, y, w0 * a[2] + w1 * b[2] + w2 * c[2]);
  }
}

// ---- the sheet --------------------------------------------------------------------------
const sheet = new Canvas(RW * 16, CH * 8);
const PLAYER = { kind: "falcon", body: RAMPS.player, pod: RAMPS.trim, stripe: RAMPS.player };
const RIVALS = [
  { kind: "needle", body: RAMPS.orange, pod: RAMPS.trim, stripe: RAMPS.magenta },
  { kind: "brick", body: RAMPS.magenta, pod: RAMPS.trim, stripe: RAMPS.player },
  { kind: "delta", body: RAMPS.violet, pod: RAMPS.trim, stripe: RAMPS.orange },
];
const ELEV_PLAYER = 17 * DEG, ELEV_RIVAL = 12 * DEG;
const LEAN = [[-26, -10], [-12, -4], [0, 0], [12, 4], [26, 10]];   // roll, yaw (deg)
// row 0: idle, boosting, idle (flicker), boosting (flicker); five leans each
for (let flick = 0; flick < 2; flick++) for (let boost = 0; boost < 2; boost++) LEAN.forEach(([r, y], i) =>
  render(sheet, (i + boost * 5 + flick * 10) * PW, 0, PLAYER,
         { kind: PLAYER.kind, yaw: y * DEG, roll: r * DEG, elev: ELEV_PLAYER, boost: !!boost, flick: !!flick, cw: PW, scale: PLAYER_SCALE }));
// rows 1-3 and, flickering, 4-6
for (let flick = 0; flick < 2; flick++) RIVALS.forEach((col, row) => {
  for (let k = 0; k < 16; k++) render(sheet, k * RW, (row + 1 + flick * 3) * CH, col,
    { kind: col.kind, yaw: k * 22.5 * DEG, roll: 0, elev: ELEV_RIVAL, boost: false, flick: !!flick, cw: RW, scale: RIVAL_SCALE });
});
// row 7: the shadow, a dithered ellipse under the anchor
for (let y = 0; y < CH; y++) for (let x = 0; x < PW; x++) {
  const e = ((x + 0.5 - PW / 2) / 34) ** 2 + ((y + 0.5 - AY - 2) / 9) ** 2;
  if (e < 1 && ((x + y) & 1) === 0) sheet.set(x, 7 * CH + y, C.BG);
}
// row 7 from x 80: four frames of sparks, 32x32, a burst flung outward
// and upward that thins and cools frame by frame
{
  const R2 = (() => { let a = 99; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  const streaks = Array.from({ length: 14 }, () => ({ a: -Math.PI * (0.1 + 0.8 * R2()), v: 4 + 9 * R2(), l: 2 + 3 * R2() }));
  for (let fr = 0; fr < 4; fr++) {
    const ox = PW + fr * 32, oy = 7 * CH, t = (fr + 1) / 4;
    const cols = [C.FACE_EDGE, C.LABEL_LIT, C.ICE, C.HOT];
    streaks.forEach((st, i) => {
      if (i % 4 < fr) return;                       // fewer as it fades
      const r = st.v * t * 1.6;
      for (let k = 0; k < st.l; k++) {
        const x = Math.round(16 + Math.cos(st.a) * (r - k)), y = Math.round(26 + Math.sin(st.a) * (r - k) + 6 * t * t);
        if (x > 0 && y > 0 && x < 31 && y < 31) sheet.set(ox + x, oy + y, cols[Math.min(3, fr + (k > 1 ? 1 : 0))]);
      }
    });
  }
}
// row 7 from x 208: the uplink gate. A pylon (32x80, its foot at the cell's
// bottom) and the beam (32x16, tiled across between the pylon tops).
{
  const ox = 208, oy = 7 * CH;
  for (let y = 0; y < CH; y++) for (let x = 6; x < 26; x++) {
    const edge = x === 6 || x === 25;
    const lit = (x === 11 || x === 20) && ((y >> 2) & 1) === 0;
    sheet.set(ox + x, oy + y, edge ? C.BG : lit ? C.SELECTED : x < 16 ? C.SIDE : C.SIDE_DARK);
  }
  for (let y = 0; y < 6; y++) for (let x = 4; x < 28; x++) sheet.set(ox + x, oy + y, y === 0 || y === 5 ? C.BG : C.HIGHLIGHT);
  const bx = 240;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    const border = y === 0 || y === 15;
    const chev = ((x + Math.abs(y - 7.5)) % 16) < 5;
    sheet.set(bx + x, oy + y, border ? C.BG : y === 1 || y === 14 ? C.HIGHLIGHT : chev ? C.SELECTED : C.BAR_C);
  }
}
sheet.checkPalette("machines");
fs.mkdirSync(path.join(ROOT, "assets/signal"), { recursive: true });
sheet.save(path.join(ROOT, "assets/signal/machines.png"));
console.log(`gen-machines: ${sheet.w}x${sheet.h}, ${sheet.colourCount()} colours`);

if (process.argv.includes("--zoom")) {
  const z = 4, out = new Canvas(sheet.w * z, sheet.h * z);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const p = sheet.get(Math.floor(x / z), Math.floor(y / z));
    out.set(x, y, p[3] ? p.slice(0, 3) : (((x >> 4) + (y >> 4)) & 1 ? [40, 34, 60] : [30, 26, 46]));
  }
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  out.save(path.join(ROOT, "docs/machines-zoom.png"));
}
