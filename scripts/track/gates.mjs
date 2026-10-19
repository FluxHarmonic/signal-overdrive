import { WORLD, BARRIER } from "./geometry.mjs";

// Default race camera at top speed, no transient boost/drop kick. Matches
// (signal scene), (signal tuning) and the machine's wall-collision diameter.
export const DEFAULTS = Object.freeze({
  top: 560, machineWidth: 18, ahead: 1900,
  width: 480, height: 270, cameraHeight: 40, behind: 104,
  pitch: 0.16, fov: 1.33, horizon: 80, fogEnd: 2800,
});

export function pointAt(g, distance, lateral = 0) {
  const s = ((distance % g.LENGTH) + g.LENGTH) % g.LENGTH;
  let lo = 0, hi = g.N - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.S[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const j = (lo + 1) % g.N;
  const f = (s - g.S[lo]) / (g.S[lo + 1] - g.S[lo]);
  const lerp = (a, b) => a + f * (b - a);
  const tx = lerp(g.TAN[lo][0], g.TAN[j][0]);
  const ty = lerp(g.TAN[lo][1], g.TAN[j][1]);
  const norm = Math.hypot(tx, ty);
  return {
    x: lerp(g.P[lo][0], g.P[j][0]) - ty / norm * lateral * g.HW,
    y: lerp(g.P[lo][1], g.P[j][1]) + tx / norm * lateral * g.HW,
    tx: tx / norm, ty: ty / norm,
  };
}

// The camera-project equations, expressed in tangent coordinates. Flat
// ground has no occluders. Any future terrain/crest format MUST add a
// line-of-sight occlusion test before those features can pass this gate.
export function projectGround(observer, target, c = DEFAULTS) {
  const dx = target.x - observer.x + observer.tx * c.behind;
  const dy = target.y - observer.y + observer.ty * c.behind;
  const along = dx * observer.tx + dy * observer.ty;
  const side = -dx * observer.ty + dy * observer.tx;
  const depth = along * Math.cos(c.pitch) + c.cameraHeight * Math.sin(c.pitch);
  const up = along * Math.sin(c.pitch) - c.cameraHeight * Math.cos(c.pitch);
  const focal = c.width / 2 / Math.tan(c.fov / 2);
  const x = c.width / 2 + focal * side / depth;
  const y = c.horizon + focal * Math.tan(c.pitch) - focal * up / depth;
  return { x, y, depth, along,
    visible: depth > 4 && along < c.fogEnd && x >= 0 && x < c.width && y >= 0 && y < c.height };
}

export function readability(g, c = DEFAULTS) {
  // Leader 14:56: frozen physical bend-entry definition. A bend is a
  // contiguous same-sign run at |curvature| >= 1/5000. Split S-bends at
  // the sign change; road edge/apex visibility is not the rule.
  const threshold = 1 / 5000;
  const signs = g.CURV_S.map(k => Math.abs(k) < threshold ? 0 : Math.sign(k));
  const entries = [];
  for (let i = 0; i < g.N; i++) {
    if (signs[i] && signs[i] !== signs[(i - 1 + g.N) % g.N]) entries.push(i);
  }
  // A continuous same-sign loop has one bend crossing the start line.
  // It must not silently pass with zero observed entrances.
  if (!entries.length && signs.some(Boolean)) entries.push(0);
  const events = entries.map(i => {
    const observer = pointAt(g, g.S[i] - c.ahead);
    const entrance = pointAt(g, g.S[i]);
    const continuation = pointAt(g, g.S[i] + 96);
    const entry = projectGround(observer, entrance, c);
    const cue = projectGround(observer, continuation, c);
    return { sample: i, s: g.S[i], fraction: g.S[i] / g.LENGTH,
      direction: signs[i] > 0 ? "right" : "left", observer, entrance,
      continuation, entry, cue, pass: entry.visible && cue.visible };
  });
  const failures = events.filter(event => !event.pass);
  return { pass: failures.length === 0, ahead: c.ahead, continuation: 96,
    curvatureThreshold: threshold, bends: entries.length, events,
    failed: failures.length, firstFailure: failures[0] ?? null,
    occlusion: "flat ground only; future terrain/crests require line-of-sight occlusion" };
}

function widestGap(intervals) {
  let end = -1, gap = 0;
  for (const [left, right] of intervals.sort((a, b) => a[0] - b[0])) {
    gap = Math.max(gap, left - end);
    end = Math.max(end, right);
  }
  return Math.max(gap, 1 - end);
}

export function freeLane(source, c = DEFAULTS) {
  let combinations = [{ ids: [], zones: source.zones.ice }];
  for (const layer of source.iceLayers) {
    if (combinations.length * layer.layouts.length > 4096) {
      throw new Error("ICE layout product exceeds 4096; split the authoring fixture");
    }
    combinations = combinations.flatMap(combination => layer.layouts.map(layout => ({
      ids: [...combination.ids, `${layer.id}/${layout.id}`],
      zones: [...combination.zones, ...layout.zones],
    })));
  }
  let narrowest = 2 * source.geometry.halfWidth, witness = null;
  for (const combination of combinations) {
    const ends = [...new Set([0, 1, ...combination.zones.flatMap(z => z.slice(0, 2))])].sort((a, b) => a - b);
    const probes = [...ends, ...ends.slice(1).map((s, i) => (s + ends[i]) / 2)];
    for (const s of probes) {
      const atLine = s === 0 || s === 1;
      const active = combination.zones.filter(z => (z[0] <= s && s <= z[1])
        || (atLine && (z[0] === 0 || z[1] === 1))).map(z => z.slice(2));
      const width = widestGap(active) * source.geometry.halfWidth;
      if (width < narrowest) {
        narrowest = width;
        witness = { layouts: combination.ids, at: s, active };
      }
    }
  }
  return { pass: narrowest >= 1.5 * c.machineWidth, combinations: combinations.length,
    required: 1.5 * c.machineWidth, narrowest, witness };
}

export function geometryGates(source, g, c = DEFAULTS) {
  const minRadius = Math.min(...g.CURV_S.map(k => Math.abs(k) > 1e-9 ? 1 / Math.abs(k) : 1e9));
  const clearance = 2 * (g.HW + BARRIER) + 40;
  let separation = Infinity;
  for (let i = 0; i < g.N; i++) for (let j = i + 1; j < g.N; j++) {
    const ds = Math.min(g.S[j] - g.S[i], g.LENGTH - (g.S[j] - g.S[i]));
    if (ds < clearance * 2) continue;
    separation = Math.min(separation, Math.hypot(g.P[i][0] - g.P[j][0], g.P[i][1] - g.P[j][1]));
  }
  const margin = Math.min(...g.P.flatMap(([x, y]) => [x, y, WORLD - x, WORLD - y]));
  const seconds = g.LENGTH / c.top;
  return {
    radius: { pass: minRadius >= g.HW * 1.6, minimum: minRadius, required: g.HW * 1.6 },
    trueRadius: { pass: g.TRUE_MIN_RADIUS >= g.HW * 1.6, minimum: g.TRUE_MIN_RADIUS,
      required: g.HW * 1.6, witness: g.TRUE_RADIUS_WITNESS,
      method: "unsmoothed circumradius of consecutive dense spline samples (200 samples/control interval)" },
    separation: { pass: separation >= clearance, minimum: separation, required: clearance },
    world: { pass: margin >= g.HW + 200, margin, required: g.HW + 200 },
    lapLength: { pass: source.role === "test" || (seconds >= 25 && seconds <= 35),
      seconds, exempt: source.role === "test", reason: source.role === "test" ? "design section 6.1: handling fixture" : null },
    readability: readability(g, c),
    freeLane: freeLane(source, c),
  };
}

export function tileGate(count) {
  return { pass: Number.isInteger(count) && count > 0 && count <= 4096, count, maximum: 4096 };
}
