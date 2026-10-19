// gen-track.mjs - a track: a closed spline painted texel by texel into a
// per-track rectangular world, cut into 32x32 tiles, deduplicated into an atlas, and
// described for the game.
//
//   node scripts/art/gen-track.mjs [--track ID | --file tracks/ID.json]
//     [--preview] [--seed N] [--output DIR]
//   --draft requires an isolated --output directory and retains red reports.
//
// With no --track, every track in TRACKS. Per track NAME, writes:
//   assets/signal/NAME-atlas.png   the unique tiles, 64 per row (2048 wide)
//   assets/signal/NAME-map.png     world.width/32 by world.height/32: R + 256*G is
//                                 the tile's index in the atlas
//   assets/signal/NAME-avg.png     the atlas at one texel per tile (each
//                                 tile's average colour): what the ground
//                                 shader fades to far away, against shimmer
//   src/signal/track/NAME-data.sgl the centreline the game drives on (one
//                                 sample per 16 texels: x y tx ty half-width
//                                 racing-line offset), and the zones
//   docs/NAME-preview.png         (--preview) the whole world at 1/8
//
// The same samples drive the paint and the game's walls, so a wall is
// exactly where it is drawn. The paint is in world coordinates where a
// pattern should repeat (the road's plates, the grid floor), so those tiles
// deduplicate; the edges, pads and lanes follow the track and are unique.
//
// Edges are anti-aliased in the palette's own way: the distance that
// decides road, barrier or run-off is jittered by the 4x4 Bayer threshold
// (+-0.5 texel), so a curved edge dithers between its two sides instead of
// stepping. The barrier is 14 texels wide with a lit rail in 24-texel
// blocks, wide enough to stay visible to the horizon (at the far end of the
// view a pixel covers several texels; the first draft's 3-texel rail was
// averaged away there).

import fs from "node:fs";
import path from "node:path";
import { Canvas, C, ramp, bayerOn, BAYER4, rng } from "./lib.mjs";
import { sampleDefinition, trackDefinition } from "../track/geometry.mjs";
import { loadTrack } from "../track/format.mjs";
import { geometryGates, tileGate } from "../track/gates.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const option = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`missing ${name} value`);
  return process.argv[index + 1];
};
const ROOT = option("--output") ? path.resolve(option("--output")) : SOURCE_ROOT;
const DRAFT = process.argv.includes("--draft");
if (DRAFT && ROOT === SOURCE_ROOT) throw new Error("--draft requires an isolated --output directory");
const SEED = Number(option("--seed") ?? 0);
const TILE = 32;
const STEP = 16;              // centreline sample spacing, texels
const BARRIER = 14;           // barrier band beyond the road edge
const RUNOFF = 12;            // dithered run-off beyond the barrier
const PREVIEW = process.argv.includes("--preview");
const ONLY = option("--track");
const INPUT = option("--file");
if (ONLY && INPUT) throw new Error("choose --track or --file");

// Track sources live in tracks/; retired layouts remain regression fixtures.
const TRACKS = Object.fromEntries(
  (INPUT ? [path.resolve(INPUT)] : fs.readdirSync(path.join(SOURCE_ROOT, "tracks"))
    .filter(file => file.endsWith(".json")).sort().map(file => path.join(SOURCE_ROOT, "tracks", file)))
    .map(file => {
      const source = loadTrack(file);
      return [source.id, { ...trackDefinition(source, SEED), source }];
    })
);

function build(name, def) {
  const { width: WIDTH, height: HEIGHT } = def.world;
  const MAP_W = WIDTH / TILE, MAP_H = HEIGHT / TILE;
  const sampled = sampleDefinition(def);
  const { P, N, S, LENGTH, TAN, CURV_S, LINE, HW } = sampled;
  const gates = geometryGates(def.source, sampled);
  const reportDir = path.join(ROOT, "build/track");
  fs.mkdirSync(reportDir, { recursive: true });
  const writeReport = () => fs.writeFileSync(path.join(reportDir, `${name}-generated.json`),
    JSON.stringify({ id: name, seed: def.seed, world: def.world,
      canvasBytes: WIDTH * HEIGHT * 4, mapTiles: { width: MAP_W, height: MAP_H },
      memory: { maxRSSKiB: process.resourceUsage().maxRSS, externalBytes: process.memoryUsage().external },
      selectedLayouts: def.selectedLayouts,
      draft: DRAFT, gates }, null, 2) + "\n");
  writeReport();
  const failed = Object.entries(gates).filter(([, gate]) => !gate.pass).map(([key]) => key);
  if (failed.length && !DRAFT) throw new Error(`${name}: gates failed: ${failed.join(", ")}; see ${reportDir}`);

  // ---- checks: the loop must be drivable --------------------------------------------
  const minR = Math.min(...CURV_S.map((k) => Math.abs(k) > 1e-9 ? 1 / Math.abs(k) : 1e9));
  if (minR < HW * 1.6) throw new Error(`${name}: tightest bend radius ${minR.toFixed(0)} < ${HW * 1.6} (the inner wall would fold)`);
  const clear = 2 * (HW + BARRIER) + 40;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const ds = Math.min(S[j] - S[i], LENGTH - (S[j] - S[i]));
    if (ds < clear * 2) continue;
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (d < clear) throw new Error(`${name}: samples ${i} and ${j} are ${d.toFixed(0)} apart (< ${clear})`);
  }
  for (const [x, y] of P) if (x < HW + 200 || y < HW + 200 || x > WIDTH - HW - 200 || y > HEIGHT - HW - 200)
    throw new Error(`${name}: the track leaves the world at ${x.toFixed(0)},${y.toFixed(0)}`);
  console.log(`${name}: ${N} samples, length ${LENGTH.toFixed(0)}, half-width ${HW}, tightest radius ${minR.toFixed(0)}`);

  // ---- zones: [s0, s1, u0, u1], s from the line, u in -1..1 (left negative) ----------
  const at = (f) => f * LENGTH;
  const ZONES = {
    boost: def.boost.map(([f, u0, u1]) => [at(f), at(f) + 100, u0, u1]),
    repair: [[at(def.repair[0]), at(def.repair[1]), def.repair[2], def.repair[3]]],
    ice: (def.ice || []).map(([f0, f1, u0, u1]) => [at(f0), at(f1), u0, u1]),
  };
  const inZone = (z, s, u) => { let ds = s - z[0]; if (ds < 0) ds += LENGTH; return ds <= z[1] - z[0] && u >= z[2] && u <= z[3]; };

  // ---- the nearest sample, fast ---------------------------------------------------------
  const CELL = 128, GRID_W = Math.ceil(WIDTH / CELL), GRID_H = Math.ceil(HEIGHT / CELL);
  const buckets = Array.from({ length: GRID_W * GRID_H }, () => []);
  for (let i = 0; i < N; i++) {
    const gx = Math.floor(P[i][0] / CELL), gy = Math.floor(P[i][1] / CELL);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) buckets[y * GRID_W + x].push(i);
    }
  }
  function locate(x, y) {
    const b = buckets[Math.floor(y / CELL) * GRID_W + Math.floor(x / CELL)];
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
      if (dd < rd) { rd = dd; const l = Math.sqrt(l2); res = { s: S[i] + t * l, d: (x - px) * (-sy / l) + (y - py) * (sx / l) }; }
    }
    return res;
  }

  // ---- paint ---------------------------------------------------------------------------
  const world = new Canvas(WIDTH, HEIGHT);
  const R = rng(7);
  const PUDDLES = [];
  while (PUDDLES.length < def.puddles) {
    const x = 150 + R() * (WIDTH - 300), y = 150 + R() * (HEIGHT - 300);
    const l = locate(x, y);
    if (l && Math.abs(l.d) < HW + BARRIER + 90) continue;
    PUDDLES.push({ x, y, rx: 26 + R() * 46, ry: 10 + R() * 18, hue: R() < 0.5 ? "pink" : "cyan" });
  }
  function floor(x, y) {
    // the grid floor: lines every 32 texels, brighter every 128 (lines
    // sweeping past carry much of the sense of speed), a dot between them
    const gx = x & 31, gy = y & 31;
    let c = C.BG;
    if ((x & 127) === 0 || (y & 127) === 0) c = C.TEAL;
    else if (gx === 0 || gy === 0) c = C.TEAL_DARK;
    else if (gx === 16 && gy === 16) c = C.BAR_C;
    for (const p of PUDDLES) {
      const e = ((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2;
      if (e < 1) {
        const glow = p.hue === "pink" ? [C.PLUM, C.PLUM_MID, C.HIGHLIGHT] : [C.TEAL_DARK, C.TEAL, C.SELECTED];
        const streak = ((y + Math.floor(x / 9)) % 5 === 0) && ((x * 7 + y * 3) % 11 < 6);
        const v = (1 - e) * 0.9;
        c = streak ? ramp(glow, v + 0.25, x, y) : ramp([C.BG, glow[0]], v, x, y);
        if (e > 0.82) c = gx === 0 || gy === 0 ? glow[0] : c;
      }
    }
    return c;
  }
  function road(x, y) {
    // world-aligned 64-texel plates in two close tones, chequered, with a
    // seam and a rivet near each plate's corners
    const px = x & 63, py = y & 63;
    if (px === 0 || py === 0) return C.SLATE;
    if (px === 1 || py === 1) return C.STATIC_B;
    if ((px === 5 || px === 59) && (py === 5 || py === 59)) return C.SLATE_MID;
    const odd = ((x >> 6) + (y >> 6)) & 1;
    return bayerOn(0.28, x, y) ? (odd ? C.SIDE_DARK : C.SLATE) : (odd ? C.SLATE : C.SIDE_DARK);
  }
  const jitter = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16 - 0.5;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const l = locate(x + 0.5, y + 0.5);
      if (!l || Math.abs(l.d) > HW + BARRIER + RUNOFF + 2) { world.set(x, y, floor(x, y)); continue; }
      const s = l.s, u = l.d / HW;
      // the distance that picks the band, dithered: smooth edges in palette colours
      const ad = Math.abs(l.d) + jitter(x, y);
      let c, code = 0;   // code: the effects code, stored as 255 - alpha (the ground shader reads it)
      if (ad <= HW) {
        c = road(x, y);
        // the start line: a checker band across the road
        if (s < 24) c = ((Math.floor(s / 8) + Math.floor((l.d + HW) / 8)) & 1) ? C.FACE : C.BG;
        for (const z of ZONES.boost) if (inZone(z, s, u)) {
          let zs = s - z[0]; if (zs < 0) zs += LENGTH;
          const zu = (u - z[2]) / (z[3] - z[2]) * 2 - 1;
          const chev = (zs + Math.abs(zu) * 18) % 18;
          const rim = zs < 2 || zs > z[1] - z[0] - 2 || Math.abs(zu) > 0.9;
          c = rim ? C.LABEL_LIT : chev < 7 ? C.LABEL_LIT : chev < 9 ? C.AMBER_DARK : C.HOT;
          code = rim ? 49 : 33 + Math.floor(((zs + Math.abs(zu) * 18) % 72) / 4.5);
        }
        for (const z of ZONES.repair) if (inZone(z, s, u)) {
          let zs = s - z[0]; if (zs < 0) zs += LENGTH;
          const lane = (u - z[2]) * HW;
          const edge = lane < 3 || lane > HW * (z[3] - z[2]) - 3;
          c = edge ? C.SELECTED : glyph(zs, lane) ? C.TEAL_MID : (bayerOn(0.25, x, y) ? C.TEAL : C.TEAL_DARK);
        }
        // ICE: a glitch patch, corrupted blocks in the ICE and TRACE_HOT
        // roles over static (crossing it scrambles the steering)
        for (const z of ZONES.ice) if (inZone(z, s, u)) {
          const bx = Math.floor(x / 6), by = Math.floor(y / 4);
          const h = ((bx * 73856093) ^ (by * 19349663)) >>> 0;
          const v = (h % 97) / 97;
          const lane = (u - z[2]) * HW, zs0 = s - z[0];
          const rim = lane < 2 || lane > (z[3] - z[2]) * HW - 2 || zs0 < 2 || zs0 > z[1] - z[0] - 2;
          c = rim ? C.ICE : v < 0.18 ? C.ICE : v < 0.30 ? C.AMBER : v < 0.40 ? C.FACE_EDGE
            : bayerOn(0.5, x, y) ? C.STATIC_B : C.RUST;
          code = 0;
        }
        // a guide line inside each edge, 4 texels, dashed along the track
        if (ad > HW - 10 && ad <= HW - 6 && (Math.floor(s / 32) & 1) === 0) { c = C.TEXT_DIM; code = 0; }
      } else if (ad <= HW + BARRIER) {
        // the barrier: a white lip, the lit rail in 24-texel blocks (magenta
        // left, cyan right), a dark base
        const k = ad - HW;
        const lit = (Math.floor(s / 24) & 1) === 0;
        // magenta (the city) left, cold blue right: not cyan, which is your signal (P16)
        const hot = l.d < 0 ? C.HIGHLIGHT : C.COLD;
        const dim = l.d < 0 ? C.PLUM_MID : C.WIRE_DARK;
        c = k < 2 ? C.FACE_EDGE : k < 10 ? (lit ? hot : dim) : C.BAR_A;
        if (k >= 2 && k < 10) code = 1 + (Math.floor(s / 24) % 16) + (l.d < 0 ? 0 : 16);
      } else {
        const v = (ad - HW - BARRIER) / RUNOFF;
        c = bayerOn(v, x, y) ? floor(x, y) : C.BAR_A;
      }
      world.set(x, y, c, 255 - code);
    }
  }
  world.checkPalette(name);

  // ---- tiles ------------------------------------------------------------------------------
  const tiles = new Map(), order = [];
  const index = new Uint16Array(MAP_W * MAP_H);
  const keyOf = (cv, ox, oy, w) => {
    const rows = [];
    for (let j = 0; j < TILE; j++) rows.push(Buffer.from(cv.px.buffer, ((oy + j) * w + ox) * 4, TILE * 4).toString("base64"));
    return rows.join("");
  };
  // tile 0: the plain floor (the shader draws it beyond the map's edge)
  const plain = new Canvas(TILE, TILE);
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++)
    plain.set(i, j, i === 0 || j === 0 ? C.TEAL_DARK : i === 16 && j === 16 ? C.BAR_C : C.BG);
  tiles.set(keyOf(plain, 0, 0, TILE), 0); order.push({ canvas: plain });
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const key = keyOf(world, tx * TILE, ty * TILE, WIDTH);
    let id = tiles.get(key);
    if (id === undefined) { id = order.length; tiles.set(key, id); order.push({ tx, ty }); }
    index[ty * MAP_W + tx] = id;
  }
  const PER_ROW = 64, ROWS = Math.ceil(order.length / PER_ROW);
  gates.tiles = tileGate(order.length);
  writeReport();
  if (!gates.tiles.pass) throw new Error(`${name}: ${order.length} unique tiles exceed the 4096 tile budget`);
  if (ROWS * TILE > 2048) throw new Error(`${name}: ${order.length} tiles need an atlas ${ROWS * TILE} tall, over WebGL2's guaranteed 2048`);
  const atlas = new Canvas(PER_ROW * TILE, ROWS * TILE), avg = new Canvas(PER_ROW, ROWS);
  order.forEach((t, id) => {
    const ax = (id % PER_ROW) * TILE, ay = Math.floor(id / PER_ROW) * TILE;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const p = t.canvas ? t.canvas.get(i, j) : world.get(t.tx * TILE + i, t.ty * TILE + j);
      atlas.set(ax + i, ay + j, p.slice(0, 3), p[3]); r += p[0]; g += p[1]; b += p[2];
    }
    avg.set(id % PER_ROW, Math.floor(id / PER_ROW), [Math.round(r / 1024), Math.round(g / 1024), Math.round(b / 1024)]);
  });
  const map = new Canvas(MAP_W, MAP_H);
  for (let k = 0; k < MAP_W * MAP_H; k++) map.set(k % MAP_W, Math.floor(k / MAP_W), [index[k] & 255, index[k] >> 8, 0]);
  fs.mkdirSync(path.join(ROOT, "assets/signal"), { recursive: true });
  atlas.save(path.join(ROOT, `assets/signal/${name}-atlas.png`));
  map.save(path.join(ROOT, `assets/signal/${name}-map.png`));
  avg.save(path.join(ROOT, `assets/signal/${name}-avg.png`));
  console.log(`${name}: ${order.length} unique tiles of ${MAP_W}x${MAP_H} (atlas ${atlas.w}x${atlas.h})`);

  if (PREVIEW) {
    fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
    const k = 8, pv = new Canvas(WIDTH / k, HEIGHT / k);
    for (let y = 0; y < pv.h; y++) for (let x = 0; x < pv.w; x++) pv.set(x, y, world.get(x * k + 3, y * k + 3).slice(0, 3));
    for (let i = 0; i < N; i++) {
      const rx = -TAN[i][1], ry = TAN[i][0];
      pv.set(Math.round((P[i][0] + rx * LINE[i] * HW) / k), Math.round((P[i][1] + ry * LINE[i] * HW) / k), C.LABEL_LIT);
    }
    pv.save(path.join(ROOT, `docs/${name}-preview.png`));
  }

  // ---- the game's data ---------------------------------------------------------------------
  const f = (v) => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? r.toFixed(1) : r.toString(); };
  // in chunks of 20 samples: the reader refuses a vector literal of about a
  // thousand elements, so the module joins the chunks at load
  let body = "";
  for (let i = 0; i < N; i++) {
    if (i % 20 === 0) body += "        #(\n";
    body += `          ${f(P[i][0])} ${f(P[i][1])} ${f(TAN[i][0])} ${f(TAN[i][1])} ${f(HW)} ${f(LINE[i])}\n`;
    if (i % 20 === 19 || i === N - 1) body += "        )\n";
  }
  const zone = (z) => `(${f(z[0])} ${f(z[1])} ${f(z[2])} ${f(z[3])})`;
  const src = `;;; (signal track ${name}-data) - GENERATED by scripts/art/gen-track.mjs; do not edit.
;;;
;;; The ${name} track's centreline, one sample every ${STEP} texels of arc: per
;;; sample x y (world texels, y down), the unit tangent tx ty, the
;;; half-width, and the racing line's offset as a share of the half-width
;;; (+ is right of the direction of travel). The zones are (s0 s1 u0 u1):
;;; arc length from the start line and lateral position in -1..1 of the
;;; half-width. Its textures are assets/signal/${name}-{atlas,map,avg}.png.

(define-library (signal track ${name}-data)
  (export ${name}-track-data)
  (begin
    (define CHUNKS
      '(
${body}        ))
    (define (join chunks)
      (let* ((n (apply + (map vector-length chunks)))
             (v (make-vector n 0.0)))
        (let loop ((cs chunks) (k 0))
          (if (null? cs)
              v
              (let ((c (car cs)))
                (let copy ((i 0))
                  (when (< i (vector-length c))
                    (vector-set! v (+ k i) (vector-ref c i))
                    (copy (+ i 1))))
                (loop (cdr cs) (+ k (vector-length c))))))))
    ;; (name samples step boost repair ice world-width world-height)
    (define (${name}-track-data)
      (list '${name} (join CHUNKS) ${f(STEP)}
            '(${ZONES.boost.map(zone).join(" ")})
            '(${ZONES.repair.map(zone).join(" ")})
            '(${ZONES.ice.map(zone).join(" ")}) ${WIDTH} ${HEIGHT}))))
`;
  fs.mkdirSync(path.join(ROOT, "src/signal/track"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `src/signal/track/${name}-data.sgl`), src);
  writeReport();
}

// 3x5 hex digits stamped along the repair lane, read along the direction of travel.
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

if (ONLY && !TRACKS[ONLY]) throw new Error(`unknown track ${ONLY}`);
for (const [name, def] of Object.entries(TRACKS)) if (!ONLY || ONLY === name) build(name, def);
