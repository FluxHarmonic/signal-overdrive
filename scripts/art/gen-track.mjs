// gen-track.mjs - the track: a closed spline painted texel by texel into a
// 4096x4096 world, cut into 32x32 tiles, deduplicated into an atlas, and
// described for the game.
//
//   node scripts/art/gen-track.mjs [--preview]
//
// Writes:
//   assets/racer/track-atlas.png   the unique tiles, 64 per row (2048 wide)
//   assets/racer/track-map.png     128x128, one texel per tile: R + 256*G is
//                                  the tile's index in the atlas
//   assets/racer/track-avg.png     the atlas at one texel per tile (each
//                                  tile's average colour): what the ground
//                                  shader fades to far away, against shimmer
//   src/racer/track/loop-data.sgl  the centreline the game drives on (one
//                                  sample per 16 texels: x y tx ty half-width
//                                  racing-line offset), and the zones
//   docs/track-preview.png         (--preview) the whole world at 1/8
//
// The same samples drive the paint and the game's walls, so a wall is
// exactly where it is drawn. The paint is in world coordinates where a
// pattern should repeat (the road's panels, the grid floor), so those tiles
// deduplicate; the edges, pads and lanes follow the track and are unique.

import fs from "node:fs";
import path from "node:path";
import { Canvas, C, ramp, bayerOn, rng, writePNG, hex } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const WORLD = 4096, TILE = 32, MAP = WORLD / TILE;
const STEP = 16;              // centreline sample spacing, texels
const HW = 60;                // the road's half-width
const BARRIER = 7;            // barrier band beyond the road edge
const PREVIEW = process.argv.includes("--preview");

// ---- the centreline ---------------------------------------------------------------
// Control points, clockwise on the map (y down). Start/finish is on the
// bottom straight heading east; then a long right-hander north, an S,
// a sweeping left across the top, the hairpin, the west side's chicane.
// [x, y, half-width scale]
const CONTROL = [
  [700, 3560], [1500, 3580], [2300, 3560], [2950, 3480],
  [3420, 3200], [3620, 2720], [3560, 2250],          // long right-hander, north
  [3220, 1960], [3320, 1560], [3660, 1180],          // the S
  [3640, 640], [3260, 380], [2780, 470],             // sweeping left over the top
  [2520, 820], [2440, 1350], [2330, 1720],           // south toward the hairpin
  [2120, 1860], [1920, 1720], [1880, 1350],          // the hairpin
  [1860, 900], [1640, 540], [1180, 420],             // back north, then west
  [720, 560], [470, 1000], [560, 1520],              // down the west side
  [940, 1830], [1060, 2240], [760, 2620],            // the chicane
  [440, 2980], [430, 3360],                          // the last bend onto the straight
];

// Centripetal Catmull-Rom, closed.
function catmull(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-6;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => [0, 1].map((k) => ((tb - u) * a[k] + (u - ta) * b[k]) / (tb - ta));
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function dense() {
  const n = CONTROL.length, pts = [];
  for (let i = 0; i < n; i++) {
    const p = (k) => CONTROL[(i + k + n) % n];
    for (let j = 0; j < 200; j++) pts.push(catmull(p(-1), p(0), p(1), p(2), j / 200));
  }
  return pts;
}

// Resample the dense curve at exactly STEP texels of arc (the last gap is
// whatever closes the loop, within STEP).
function resample(pts) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = STEP - carry;
    while (s <= len) {
      const t = s / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      s += STEP;
    }
    carry = len - (s - STEP);
  }
  const last = out[out.length - 1];
  if (Math.hypot(last[0] - out[0][0], last[1] - out[0][1]) < STEP * 0.5) out.pop();
  return out;
}

const P = resample(dense());
const N = P.length;
const S = [0];
for (let i = 1; i <= N; i++) S.push(S[i - 1] + Math.hypot(P[i % N][0] - P[i - 1][0], P[i % N][1] - P[i - 1][1]));
const LENGTH = S[N];
const TAN = P.map((_, i) => {
  const a = P[(i - 1 + N) % N], b = P[(i + 1) % N];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
});

// Curvature (signed: + turning right on the map, i.e. clockwise), smoothed
// over +-12 samples; the racing line sits toward the inside of each bend.
const CURV = P.map((_, i) => {
  const a = TAN[(i - 1 + N) % N], b = TAN[(i + 1) % N];
  return (a[0] * b[1] - a[1] * b[0]) / (2 * STEP);
});
const smooth = (arr, r) => arr.map((_, i) => {
  let s = 0; for (let k = -r; k <= r; k++) s += arr[(i + k + N) % N]; return s / (2 * r + 1);
});
const CURV_S = smooth(smooth(CURV, 12), 12);
// right-hand bend (curv > 0): the inside is the right, so a positive offset
const LINE = smooth(CURV_S.map((k) => Math.max(-0.62, Math.min(0.62, k * 260))), 20);

// ---- checks: the loop must be drivable --------------------------------------------
{
  const minR = Math.min(...CURV_S.map((k) => Math.abs(k) > 1e-9 ? 1 / Math.abs(k) : 1e9));
  if (minR < HW * 1.6) throw new Error(`gen-track: tightest bend radius ${minR.toFixed(0)} < ${HW * 1.6} (the inner wall would fold)`);
  // no two parts of the track within a road's width of each other
  const clear = 2 * (HW + BARRIER) + 40;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const ds = Math.min(S[j] - S[i], LENGTH - (S[j] - S[i]));
    if (ds < clear * 2) continue;
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (d < clear) throw new Error(`gen-track: samples ${i} and ${j} are ${d.toFixed(0)} apart (< ${clear})`);
  }
  for (const [x, y] of P) if (x < HW + 200 || y < HW + 200 || x > WORLD - HW - 200 || y > WORLD - HW - 200)
    throw new Error(`gen-track: the track leaves the world at ${x.toFixed(0)},${y.toFixed(0)}`);
  console.log(`gen-track: ${N} samples, length ${LENGTH.toFixed(0)}, tightest radius ${minR.toFixed(0)}`);
}

// ---- zones (by arc length s and lateral position u in -1..1 of the half-width) -----
// u < 0 is the left of the direction of travel.
const at = (f) => f * LENGTH;
const ZONES = {
  start: 0,
  // boost pads: [s0, s1, u0, u1]
  boost: [
    [at(0.050), at(0.050) + 56, -0.55, 0.05],
    [at(0.205), at(0.205) + 56, -0.10, 0.55],
    [at(0.560), at(0.560) + 56, -0.30, 0.30],
    [at(0.760), at(0.760) + 56, 0.00, 0.60],
  ],
  // the repair strip ("checksum lane") on the left of the run to the line
  repair: [[at(0.905), at(0.985), -1.0, -0.42]],
};

function inZone(z, s, u) {
  let ds = s - z[0]; if (ds < 0) ds += LENGTH;
  return ds <= z[1] - z[0] && u >= z[2] && u <= z[3];
}

// ---- the nearest sample, fast ---------------------------------------------------------
const CELL = 128, GRID = WORLD / CELL;
const buckets = Array.from({ length: GRID * GRID }, () => []);
for (let i = 0; i < N; i++) {
  const gx = Math.floor(P[i][0] / CELL), gy = Math.floor(P[i][1] / CELL);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = gx + dx, y = gy + dy;
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) buckets[y * GRID + x].push(i);
  }
}

// (s, d) of a world point: s along the track, d signed lateral (right +),
// or null when no sample is near. Projects onto the segments either side
// of the nearest sample.
function locate(x, y) {
  const b = buckets[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)];
  if (!b || b.length === 0) return null;
  let best = -1, bd = Infinity;
  for (const i of b) { const d = (P[i][0] - x) ** 2 + (P[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  let res = null, rd = Infinity;
  for (const i of [(best - 1 + N) % N, best]) {
    const a = P[i], c = P[(i + 1) % N];
    const sx = c[0] - a[0], sy = c[1] - a[1], l2 = sx * sx + sy * sy;
    let t = ((x - a[0]) * sx + (y - a[1]) * sy) / l2; t = Math.max(0, Math.min(1, t));
    const px = a[0] + sx * t, py = a[1] + sy * t;
    const dd = (x - px) ** 2 + (y - py) ** 2;
    if (dd < rd) {
      rd = dd;
      const l = Math.sqrt(l2), rx = -sy / l, ry = sx / l;
      res = { s: S[i] + t * l, d: (x - px) * rx + (y - py) * ry, i };
    }
  }
  return res;
}

// ---- paint ---------------------------------------------------------------------------
const world = new Canvas(WORLD, WORLD);
const R = rng(7);

// Neon puddles on the floor: ellipses away from the track.
const PUDDLES = [];
while (PUDDLES.length < 70) {
  const x = 150 + R() * (WORLD - 300), y = 150 + R() * (WORLD - 300);
  const l = locate(x, y);
  if (l && Math.abs(l.d) < HW + BARRIER + 90) continue;
  PUDDLES.push({ x, y, rx: 26 + R() * 46, ry: 10 + R() * 18, hue: R() < 0.5 ? "pink" : "cyan" });
}

function floor(x, y) {
  // the grid floor: lines every 32 texels, a dot between them
  const gx = x & 31, gy = y & 31;
  let c = C.BG;
  if (gx === 0 || gy === 0) c = C.WIRE_DARK;
  else if ((gx === 16 && gy === 16)) c = C.BAR_C;
  for (const p of PUDDLES) {
    const e = ((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2;
    if (e < 1) {
      // a puddle: darker water, the city's neon in it as broken streaks
      const glow = p.hue === "pink" ? [C.PLUM, C.PLUM_MID, C.HIGHLIGHT] : [C.TEAL_DARK, C.TEAL, C.SELECTED];
      const streak = ((y + Math.floor(x / 9)) % 5 === 0) && ((x * 7 + y * 3) % 11 < 6);
      const v = (1 - e) * 0.9;
      c = streak ? ramp(glow, v + 0.25, x, y) : ramp([C.BG, glow[0]], v, x, y);
      if (e > 0.82) c = gx === 0 || gy === 0 ? glow[0] : c;
    }
  }
  return c;
}

function road(x, y, s, d) {
  // world-aligned panels: 64-texel plates, a seam, a fine dither
  const px = x & 63, py = y & 63;
  if (px === 0 || py === 0) return C.SLATE;
  if (px === 1 || py === 1) return C.STATIC_B;
  return bayerOn(0.28, x, y) ? C.SLATE : C.SIDE_DARK;
}

const counts = { road: 0, barrier: 0, floor: 0 };
for (let y = 0; y < WORLD; y++) {
  for (let x = 0; x < WORLD; x++) {
    const l = locate(x + 0.5, y + 0.5);
    if (!l || Math.abs(l.d) > HW + BARRIER + 12) { world.set(x, y, floor(x, y)); counts.floor++; continue; }
    const ad = Math.abs(l.d), u = l.d / HW, s = l.s;
    let c;
    if (ad <= HW) {
      c = road(x, y, s, l.d); counts.road++;
      // the start line: a checker band across the road
      let ds = s - ZONES.start; if (ds < 0) ds += LENGTH;
      if (ds < 24 || LENGTH - ds < 0) c = ((Math.floor(s / 8) + Math.floor((l.d + HW) / 8)) & 1) ? C.FACE : C.BG;
      // boost pads: chevrons pointing along the track
      for (const z of ZONES.boost) if (inZone(z, s, u)) {
        let zs = s - z[0]; if (zs < 0) zs += LENGTH;
        const zu = (u - z[2]) / (z[3] - z[2]) * 2 - 1;         // -1..1 across the pad
        const chev = (zs + Math.abs(zu) * 18) % 18;            // chevrons 18 texels apart
        const rim = zs < 2 || zs > z[1] - z[0] - 2 || Math.abs(zu) > 0.9;
        c = rim ? C.LABEL_LIT : chev < 7 ? C.LABEL_LIT : chev < 9 ? C.ICE : C.HOT;
      }
      // the repair strip: a teal lane of hex digits
      for (const z of ZONES.repair) if (inZone(z, s, u)) {
        let zs = s - z[0]; if (zs < 0) zs += LENGTH;
        const lane = (u - z[2]) / (z[3] - z[2]) * (HW * (z[3] - z[2])); // texels across
        const edge = lane < 2 || lane > HW * (z[3] - z[2]) - 2;
        c = edge ? C.SELECTED : glyph(zs, lane) ? C.TEAL_MID : (bayerOn(0.25, x, y) ? C.TEAL : C.TEAL_DARK);
      }
      // a thin guide line inside each edge, dashed along the track
      if (ad > HW - 6 && ad <= HW - 4 && (Math.floor(s / 24) & 1) === 0) c = C.TEXT_DIM;
    } else if (ad <= HW + BARRIER) {
      // the barrier: a lit rail and a dark base, the rail in alternating
      // blocks (magenta left, cyan right) so speed reads along the wall
      counts.barrier++;
      const k = ad - HW;
      const lit = (Math.floor(s / 20) & 1) === 0;
      const hot = l.d < 0 ? C.HIGHLIGHT : C.SELECTED;
      const dim = l.d < 0 ? C.PLUM_MID : C.TEAL;
      c = k < 1.5 ? C.FACE_EDGE : k < 4.5 ? (lit ? hot : dim) : C.BAR_A;
    } else {
      // run-off: the floor, dimmed toward the barrier
      const v = (ad - HW - BARRIER) / 12;
      c = bayerOn(v, x, y) ? floor(x, y) : C.BAR_A;
    }
    world.set(x, y, c);
  }
}

// 3x5 hex digits stamped along the repair lane, rows of them, read along
// the direction of travel (so they scroll toward you).
function glyph(zs, lane) {
  const DIG = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
               "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
               "010101111101101", "110101110101110", "111100100100111", "110101101101110", "111100110100111", "111100110100100"];
  const col = Math.floor(lane / 6), row = Math.floor(zs / 9);
  const gx = Math.floor(lane) % 6, gy = Math.floor(zs) % 9;
  if (gx >= 3 || gy >= 5) return false;
  const digit = DIG[(col * 7 + row * 13 + ((row * col) >> 1)) % 16];
  return digit[(4 - gy) * 3 + (2 - gx)] === "1";
}
world.checkPalette("world");

// ---- cut into tiles, deduplicate ------------------------------------------------------
const tiles = new Map(), order = [];
const index = new Uint16Array(MAP * MAP);
function tileKey(tx, ty) {
  const rows = [];
  for (let j = 0; j < TILE; j++) {
    const k = ((ty * TILE + j) * WORLD + tx * TILE) * 4;
    rows.push(Buffer.from(world.px.buffer, k, TILE * 4).toString("base64"));
  }
  return rows.join("");
}
// tile 0 is the plain floor (the shader uses it beyond the map's edge)
{
  const plain = new Canvas(TILE, TILE);
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
    const gx = i & 31, gy = j & 31;
    plain.set(i, j, gx === 0 || gy === 0 ? C.WIRE_DARK : gx === 16 && gy === 16 ? C.BAR_C : C.BG);
  }
  const rows = [];
  for (let j = 0; j < TILE; j++) rows.push(Buffer.from(plain.px.buffer, j * TILE * 4, TILE * 4).toString("base64"));
  tiles.set(rows.join(""), 0); order.push({ canvas: plain });
}
for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
  const key = tileKey(tx, ty);
  let id = tiles.get(key);
  if (id === undefined) { id = order.length; tiles.set(key, id); order.push({ tx, ty }); }
  index[ty * MAP + tx] = id;
}
const PER_ROW = 64;
const ROWS = Math.ceil(order.length / PER_ROW);
if (order.length > 65535) throw new Error("gen-track: too many tiles");
const atlas = new Canvas(PER_ROW * TILE, ROWS * TILE);
const avg = new Canvas(PER_ROW, ROWS);
order.forEach((t, id) => {
  const ax = (id % PER_ROW) * TILE, ay = Math.floor(id / PER_ROW) * TILE;
  let r = 0, g = 0, b = 0;
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
    const p = t.canvas ? t.canvas.get(i, j) : world.get(t.tx * TILE + i, t.ty * TILE + j);
    atlas.set(ax + i, ay + j, p.slice(0, 3));
    r += p[0]; g += p[1]; b += p[2];
  }
  const n = TILE * TILE;
  avg.set(id % PER_ROW, Math.floor(id / PER_ROW), [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
});
const map = new Canvas(MAP, MAP);
for (let k = 0; k < MAP * MAP; k++) map.set(k % MAP, Math.floor(k / MAP), [index[k] & 255, index[k] >> 8, 0]);

fs.mkdirSync(path.join(ROOT, "assets/racer"), { recursive: true });
atlas.save(path.join(ROOT, "assets/racer/track-atlas.png"));
map.save(path.join(ROOT, "assets/racer/track-map.png"));
avg.save(path.join(ROOT, "assets/racer/track-avg.png"));
console.log(`gen-track: ${order.length} unique tiles of ${MAP * MAP} (atlas ${atlas.w}x${atlas.h}), ` +
            `texels road ${counts.road} barrier ${counts.barrier} floor ${counts.floor}`);

if (PREVIEW) {
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  const k = 8, pv = new Canvas(WORLD / k, WORLD / k);
  for (let y = 0; y < pv.h; y++) for (let x = 0; x < pv.w; x++) pv.set(x, y, world.get(x * k + 3, y * k + 3).slice(0, 3));
  // the racing line, in yellow
  for (let i = 0; i < N; i++) {
    const rx = -TAN[i][1], ry = TAN[i][0];
    pv.set(Math.round((P[i][0] + rx * LINE[i] * HW) / k), Math.round((P[i][1] + ry * LINE[i] * HW) / k), C.LABEL_LIT);
  }
  pv.save(path.join(ROOT, "docs/track-preview.png"));
}

// ---- the game's data -----------------------------------------------------------------
const f = (v) => (Math.round(v * 1000) / 1000).toString().replace(/^(-?)0\./, "$10.").replace(/^(-?\d+)$/, "$1.0");
// in chunks of 20 samples: the reader refuses a vector literal of
// about a thousand elements, so the module joins the chunks at load
let body = "";
for (let i = 0; i < N; i++) {
  if (i % 20 === 0) body += "      #(\n";
  body += `        ${f(P[i][0])} ${f(P[i][1])} ${f(TAN[i][0])} ${f(TAN[i][1])} ${f(HW)} ${f(LINE[i])}\n`;
  if (i % 20 === 19 || i === N - 1) body += "      )\n";
}
const zone = (z) => `(${f(z[0])} ${f(z[1])} ${f(z[2])} ${f(z[3])})`;
const src = `;;; (racer track loop-data) - GENERATED by scripts/art/gen-track.mjs; do not edit.
;;;
;;; The loop's centreline, one sample every ${STEP} texels of arc: per sample
;;; x y (world texels, y down), the unit tangent tx ty, the half-width, and
;;; the racing line's offset as a share of the half-width (+ is right of
;;; the direction of travel). The zones are (s0 s1 u0 u1): arc length from
;;; the start line and lateral position in -1..1 of the half-width.

(define-library (racer track loop-data)
  (import (sigil core))
  (export LOOP-SAMPLE-COUNT LOOP-STEP LOOP-LENGTH LOOP-SAMPLES LOOP-BOOST LOOP-REPAIR
          LOOP-WORLD LOOP-TILE LOOP-BARRIER)
  (begin
    (define LOOP-SAMPLE-COUNT ${N})
    (define LOOP-STEP ${f(STEP)})
    (define LOOP-LENGTH ${f(LENGTH)})
    (define LOOP-WORLD ${f(WORLD)})
    (define LOOP-TILE ${f(TILE)})
    (define LOOP-BARRIER ${f(BARRIER)})
    (define LOOP-BOOST '(${ZONES.boost.map(zone).join(" ")}))
    (define LOOP-REPAIR '(${ZONES.repair.map(zone).join(" ")}))
    (define LOOP-CHUNKS
     '(
${body}      ))
    (define LOOP-SAMPLES
      (let* ((n (apply + (map vector-length LOOP-CHUNKS)))
             (v (make-vector n 0.0)))
        (let loop ((cs LOOP-CHUNKS) (k 0))
          (if (null? cs)
              v
              (let ((c (car cs)))
                (let copy ((i 0))
                  (when (< i (vector-length c))
                    (vector-set! v (+ k i) (vector-ref c i))
                    (copy (+ i 1))))
                (loop (cdr cs) (+ k (vector-length c))))))))))
`;
fs.mkdirSync(path.join(ROOT, "src/racer/track"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "src/racer/track/loop-data.sgl"), src);
console.log(`gen-track: wrote src/racer/track/loop-data.sgl (${N} samples)`);
