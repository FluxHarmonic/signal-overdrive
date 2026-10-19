// Shared offline geometry: the exact 0.1 interpolation and sampling arithmetic.
import { worldSize } from "./format.mjs";
export const STEP = 16, BARRIER = 14;

// Circumradius of three consecutive local spline points. Unlike the racing
// line curvature this is never smoothed. Dense samples are ~1–5 texels apart.
function localRadius(a, b, c) {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (ab < 1e-9 || bc < 1e-9) return 0;
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return cross < 1e-12 ? Infinity : ab * bc * ca / (2 * cross);
}

// A stadium: two straights joined by half circles, sampled as control
// points for the spline (the same machinery as any other track). It runs
// east along the bottom straight (y down), so it goes anticlockwise on the
// map and its bends are left turns.
export function stadium(cx, cy, straight, radius, n) {
  const pts = [];
  const per = Math.PI * radius;
  const total = 2 * straight + 2 * per;
  for (let k = 0; k < n; k++) {
    let s = (k / n) * total;
    if (s < straight) { pts.push([cx - straight / 2 + s, cy + radius]); continue; }
    s -= straight;
    if (s < per) { const a = Math.PI / 2 - s / radius; pts.push([cx + straight / 2 + radius * Math.cos(a), cy + radius * Math.sin(a)]); continue; }
    s -= per;
    if (s < straight) { pts.push([cx + straight / 2 - s, cy - radius]); continue; }
    s -= straight;
    const a = -Math.PI / 2 - s / radius;
    pts.push([cx - straight / 2 + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

// ---- the spline -------------------------------------------------------------------------

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

// Resample at exactly STEP texels of arc (the last gap is whatever closes
// the loop, within STEP).
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

export function sampleDefinition(def) {
  const HW = def.hw;
  const n = def.control.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p = (k) => def.control[(i + k + n) % n];
    for (let j = 0; j < 200; j++) dense.push(catmull(p(-1), p(0), p(1), p(2), j / 200));
  }
  let TRUE_MIN_RADIUS = Infinity, TRUE_RADIUS_WITNESS = null;
  for (let i = 0; i < dense.length; i++) {
    const radius = localRadius(dense[(i - 1 + dense.length) % dense.length], dense[i], dense[(i + 1) % dense.length]);
    if (radius < TRUE_MIN_RADIUS) {
      TRUE_MIN_RADIUS = radius;
      TRUE_RADIUS_WITNESS = { segment: Math.floor(i / 200), t: (i % 200) / 200, point: dense[i] };
    }
  }
  const P = resample(dense);
  const N = P.length;
  const S = [0];
  for (let i = 1; i <= N; i++) S.push(S[i - 1] + Math.hypot(P[i % N][0] - P[i - 1][0], P[i % N][1] - P[i - 1][1]));
  const LENGTH = S[N];
  const TAN = P.map((_, i) => {
    const a = P[(i - 1 + N) % N], b = P[(i + 1) % N];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  });
  // curvature: + turning right on the map (clockwise), smoothed; the racing
  // line sits toward the inside of each bend (+ offset is right of travel)
  const CURV = P.map((_, i) => { const a = TAN[(i - 1 + N) % N], b = TAN[(i + 1) % N]; return (a[0] * b[1] - a[1] * b[0]) / (2 * STEP); });
  const smooth = (arr, r) => arr.map((_, i) => { let s = 0; for (let k = -r; k <= r; k++) s += arr[(i + k + N) % N]; return s / (2 * r + 1); });
  const CURV_S = smooth(smooth(CURV, 12), 12);
  const LINE = smooth(CURV_S.map((k) => Math.max(-0.62, Math.min(0.62, k * 260))), 20);

  return { P, N, S, LENGTH, TAN, CURV_S, LINE, HW, TRUE_MIN_RADIUS, TRUE_RADIUS_WITNESS };
}

export function trackDefinition(source, seed = 0) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("seed must be a uint32");
  const g = source.geometry;
  // Mixed-radix seed selection covers every layout product with seeds
  // 0..product-1. The compiled samples/zones and painted ICE use this same
  // selection; gates independently enumerate the entire product.
  let remaining = seed;
  const ice = [...source.zones.ice], selectedLayouts = [];
  for (const layer of source.iceLayers) {
    const layout = layer.layouts[remaining % layer.layouts.length];
    remaining = Math.floor(remaining / layer.layouts.length);
    ice.push(...layout.zones);
    selectedLayouts.push(`${layer.id}/${layout.id}`);
  }
  return { hw: g.halfWidth, world: worldSize(source),
    control: g.type === "stadium" ? stadium(...g.center, g.straight, g.radius, g.points) : g.control,
    ...source.zones, ice, seed, selectedLayouts,
    puddles: source.decoration.puddles };
}
