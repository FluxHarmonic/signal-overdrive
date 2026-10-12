// gen-machines.mjs - the machines' sprite sheet, rendered from a low-poly
// model by a tiny software rasterizer, straight at sprite size.
//
//   node scripts/art/gen-machines.mjs [--zoom]
//
// Writes assets/racer/machines.png, 2048x400, in rows 80 px tall (scene.sgl's
// CELL-H) with the ground point 48 px down (ANCHOR-Y), centred across:
//   row 0   80 px cells (PLAYER-CELL-W): the player from behind: hard left, left, centre, right, hard
//           right (banked and slightly yawed), then the same five boosting
//   rows 1-3 128 px cells (RIVAL-CELL-W; a side view is ~116 px long):
//           a rival in each colour, 16 directions: k * 22.5 degrees, the
//           machine turned right of the line of sight (0: its back to you)
//   row 4   the shadow, in an 80 px cell
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

function model(boost) {
  const parts = [];
  // the deck: one wide flat wedge, full width at the back, a narrow nose
  parts.push(hexa([[-0.52, -0.70, 0.05], [0.52, -0.70, 0.05], [0.50, -0.70, 0.16], [-0.50, -0.70, 0.16]],
                  [[-0.10, 0.88, 0.05], [0.10, 0.88, 0.05], [0.08, 0.88, 0.09], [-0.08, 0.88, 0.09]], "body"));
  // side skirts: the deck's lower edge in the dark trim, a little wider
  for (const s of [-1, 1]) {
    const x0 = Math.min(0.46 * s, 0.55 * s), x1 = Math.max(0.46 * s, 0.55 * s);
    parts.push(hexa([[x0, -0.72, 0.03], [x1, -0.72, 0.03], [x1, -0.72, 0.09], [x0, -0.72, 0.09]],
                    [[x0 * 0.45, 0.55, 0.03], [x1 * 0.45, 0.55, 0.03], [x1 * 0.45, 0.55, 0.06], [x0 * 0.45, 0.55, 0.06]], "trim"));
  }
  // the spine, raised down the middle, with the canopy on it
  parts.push(hexa([[-0.20, -0.66, 0.15], [0.20, -0.66, 0.15], [0.15, -0.66, 0.30], [-0.15, -0.66, 0.30]],
                  [[-0.07, 0.55, 0.08], [0.07, 0.55, 0.08], [0.04, 0.55, 0.12], [-0.04, 0.55, 0.12]], "stripe"));
  parts.push(hexa([[-0.12, -0.25, 0.25], [0.12, -0.25, 0.25], [0.08, -0.20, 0.36], [-0.08, -0.20, 0.36]],
                  [[-0.06, 0.30, 0.12], [0.06, 0.30, 0.12], [0.03, 0.22, 0.17], [-0.03, 0.22, 0.17]], "glass"));
  // the engine block across the back
  parts.push(box(-0.40, 0.40, -0.84, -0.66, 0.05, 0.27, "pod"));
  // three exhausts and their flames
  for (const cx of [-0.25, 0, 0.25]) {
    parts.push(box(cx - 0.08, cx + 0.08, -0.855, -0.84, 0.09, 0.22, "glow"));
    const len = (boost ? 0.42 : 0.10) * (cx === 0 ? 1.15 : 1);
    parts.push(hexa([[cx - 0.06, -0.855, 0.11], [cx + 0.06, -0.855, 0.11], [cx + 0.06, -0.855, 0.20], [cx - 0.06, -0.855, 0.20]],
                    [[cx - 0.005, -0.855 - len, 0.15], [cx + 0.005, -0.855 - len, 0.15], [cx + 0.005, -0.855 - len, 0.16], [cx - 0.005, -0.855 - len, 0.16]], "glow"));
  }
  // two fins at the rear corners
  for (const s of [-1, 1]) {
    const x0 = Math.min(0.44 * s, 0.48 * s), x1 = Math.max(0.44 * s, 0.48 * s);
    parts.push(hexa([[x0, -0.72, 0.15], [x1, -0.72, 0.15], [x1, -0.80, 0.34], [x0, -0.80, 0.34]],
                    [[x0, -0.36, 0.15], [x1, -0.36, 0.15], [x1, -0.56, 0.20], [x0, -0.56, 0.20]], "stripe"));
  }
  return parts;
}

// ---- rasterize -------------------------------------------------------------------------
const FACES = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
const LIGHT = (() => { const l = [-0.45, 0.35, 0.82]; const n = Math.hypot(...l); return l.map((v) => v / n); })();

function render(canvas, ox, oy, colours, { yaw, roll, elev, boost, cw, scale }) {
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
  for (const part of model(boost)) {
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
      const lit = part.mat === "glow" ? 0.42 + 0.3 * Math.max(0, n[2])
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
const sheet = new Canvas(RW * 16, CH * 5);
const PLAYER = { body: RAMPS.player, pod: RAMPS.trim, stripe: RAMPS.player };
const RIVALS = [
  { body: RAMPS.orange, pod: RAMPS.trim, stripe: RAMPS.magenta },
  { body: RAMPS.magenta, pod: RAMPS.trim, stripe: RAMPS.player },
  { body: RAMPS.violet, pod: RAMPS.trim, stripe: RAMPS.orange },
];
const ELEV_PLAYER = 17 * DEG, ELEV_RIVAL = 12 * DEG;
const LEAN = [[-26, -10], [-12, -4], [0, 0], [12, 4], [26, 10]];   // roll, yaw (deg)
for (let boost = 0; boost < 2; boost++) LEAN.forEach(([r, y], i) =>
  render(sheet, (i + boost * 5) * PW, 0, PLAYER, { yaw: y * DEG, roll: r * DEG, elev: ELEV_PLAYER, boost: !!boost, cw: PW, scale: PLAYER_SCALE }));
RIVALS.forEach((col, row) => {
  for (let k = 0; k < 16; k++) render(sheet, k * RW, (row + 1) * CH, col, { yaw: k * 22.5 * DEG, roll: 0, elev: ELEV_RIVAL, boost: false, cw: RW, scale: RIVAL_SCALE });
});
// the shadow: a dithered ellipse under the anchor
for (let y = 0; y < CH; y++) for (let x = 0; x < PW; x++) {
  const e = ((x + 0.5 - PW / 2) / 34) ** 2 + ((y + 0.5 - AY - 2) / 9) ** 2;
  if (e < 1 && ((x + y) & 1) === 0) sheet.set(x, 4 * CH + y, C.BG);
}
sheet.checkPalette("machines");
fs.mkdirSync(path.join(ROOT, "assets/racer"), { recursive: true });
sheet.save(path.join(ROOT, "assets/racer/machines.png"));
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
