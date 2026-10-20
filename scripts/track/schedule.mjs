// Approved Neon Row bible section3. Shared authoring/runtime data contract.
// Arc distances are texels, lateral coordinates are road half-width units.
import { sampleDefinition, trackDefinition } from "./geometry.mjs";
import { scheduleLayer } from "./format.mjs";
export { scheduleLayer } from "./format.mjs";

export const ICE_RULES = Object.freeze({ lane: 27, neighbour: 960, padding: 300,
  tracerHalfLength: 460, tracerHalfWidth: 34, tracerAhead: 600,
  tracerLifeTicks: 6, telegraphBars: 1, reserveBars: 1 });
export const mod = (n, d) => ((n % d) + d) % d;

export function splitArc(from, to, length) {
  const span = to - from;
  if (span >= length - 1e-8) return [[0, length]];
  const start = mod(from, length);
  return start + span <= length ? [[start, start + span]] : [[start, length], [0, start + span - length]];
}

export function arcsOverlap(a, b, length) {
  return splitArc(a[0], a[1], length).some(x => splitArc(b[0], b[1], length)
    .some(y => x[0] <= y[1] + 1e-8 && y[0] <= x[1] + 1e-8));
}

export function mergeArcs(arcs, length) {
  const pieces = arcs.flatMap(arc => splitArc(arc.from, arc.to, length)
    .map(([from, to]) => ({ from, to, owners: [...arc.owners] })));
  pieces.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && piece.from <= last.to + 1e-8) {
      last.to = Math.max(last.to, piece.to);
      last.owners = [...new Set([...last.owners, ...piece.owners])];
    } else merged.push(piece);
  }
  if (merged.length > 1 && merged[0].from <= 1e-8 && merged.at(-1).to >= length - 1e-8) {
    const first = merged.shift(), last = merged.pop();
    merged.push({ from: last.from, to: first.to + length,
      owners: [...new Set([...last.owners, ...first.owners])] });
  }
  return merged;
}

export function physicalRuns(g) {
  // Reuse the frozen physical straight/bend partition, never author labels.
  const signs = g.CURV_S.map(k => Math.abs(k) < 1 / 5000 ? 0 : Math.sign(k));
  const starts = signs.flatMap((sign, i) => sign !== signs[(i - 1 + g.N) % g.N] ? [i] : []);
  if (!starts.length) return [{ from: 0, to: g.LENGTH, direction: signs[0] }];
  return starts.map((i, n) => ({ from: g.S[i], direction: signs[i],
    to: n + 1 < starts.length ? g.S[starts[n + 1]] : g.S[starts[0]] + g.LENGTH }));
}

export function buildStretches(g, layers) {
  const runs = physicalRuns(g);
  const occupied = runs.flatMap(run => {
    const owners = layers.filter(layer => layer.layouts.some(layout => layout.zones
      .some(zone => arcsOverlap([run.from, run.to], zone, g.LENGTH)))).map(layer => layer.id);
    return owners.length ? [{ from: run.from - ICE_RULES.padding,
      to: run.to + ICE_RULES.padding, owners }] : [];
  });
  const merged = mergeArcs(occupied, g.LENGTH);
  // Untouched run portions are available to a tracer. Keep complete strip
  // containment; a centre point in a free gap is insufficient.
  const pieces = merged.flatMap(arc => splitArc(arc.from, arc.to, g.LENGTH)).sort((a, b) => a[0] - b[0]);
  const free = [];
  let edge = 0;
  for (const [from, to] of pieces) { if (from > edge) free.push([edge, from]); edge = Math.max(edge, to); }
  if (edge < g.LENGTH) free.push([edge, g.LENGTH]);
  const empty = runs.flatMap(run => {
    const intervals = splitArc(run.from, run.to, g.LENGTH).flatMap(a => free.flatMap(b => {
      const from = Math.max(a[0], b[0]), to = Math.min(a[1], b[1]);
      return to > from ? [{ from, to, owners: [] }] : [];
    }));
    return mergeArcs(intervals, g.LENGTH);
  });
  return [...merged, ...empty].map((arc, i) => ({ id: i, ...arc }));
}

function rounded(value) {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rounded(v)]));
  return value;
}

export function liveContract(source, g = sampleDefinition(trackDefinition(source))) {
  const layers = [
    { id: "$road", kind: "seeded-static", fromLap: 1, phraseBars: 0, upBars: 1, downBars: 0, phaseBars: 0,
      layouts: [{ id: "fixed", zones: source.zones.ice.map(([a, b, ...u]) => [a * g.LENGTH, b * g.LENGTH, ...u]) }] },
    ...source.iceLayers.map(layer => ({ ...scheduleLayer(source, layer),
      layouts: layer.layouts.map(layout => ({ ...layout,
        zones: layout.zones.map(([a, b, ...u]) => [a * g.LENGTH, b * g.LENGTH, ...u]) })) })),
  ];
  return rounded({ version: 1, length: g.LENGTH, halfWidth: g.HW, bpm: source.song.bpm,
    rules: ICE_RULES, layers, stretches: buildStretches(g, layers),
    tracer: { enabled: source.role === "race", fromLap: 3, periodBars: 1, ...source.tracer } });
}

export function barTick(contract, bar) {
  return Math.ceil(bar * 32 * 60 * 5 * 3 / (contract.bpm * 2) - 1e-9);
}
export function barAt(contract, tick) {
  return Math.floor(tick * contract.bpm * 2 / (32 * 60 * 5 * 3));
}
export function firstBar(contract, tick) {
  const bar = barAt(contract, tick);
  return barTick(contract, bar) < tick ? bar + 1 : bar;
}
export function layerLive(contract, layer, crossings, tick) {
  if (!Number.isFinite(crossings[0]?.tick) || tick < crossings[0].tick
    || (Number.isFinite(crossings[3]?.tick) && tick >= crossings[3].tick)) return false;
  if (layer.kind === "seeded-static") return true;
  if (!Number.isFinite(crossings[layer.fromLap - 1]?.tick)) return false;
  const first = firstBar(contract, crossings[layer.fromLap - 1].tick) + contract.rules.telegraphBars;
  const bar = barAt(contract, tick);
  return bar >= first && mod(bar + layer.phaseBars, layer.upBars + layer.downBars) < layer.upBars;
}
export function layoutAt(layer, bar, seedDigit) {
  const phrase = layer.kind !== "seeded-static" && layer.phraseBars ? Math.floor((bar + layer.phaseBars) / layer.phraseBars) : 0;
  return layer.layouts[mod(seedDigit + phrase, layer.layouts.length)];
}

export function zonesAt(contract, crossings, seed, tick) {
  let digit = seed;
  return contract.layers.flatMap(layer => {
    const index = digit % layer.layouts.length;
    digit = Math.floor(digit / layer.layouts.length);
    if (!layerLive(contract, layer, crossings, tick)) return [];
    const layout = layoutAt(layer, barAt(contract, tick), index);
    return layout.zones.map(zone => ({ owner: layer.id, kind: layer.kind, layout: layout.id, zone }));
  });
}

export function containsStrip(contract, stretch, center) {
  const half = contract.rules.tracerHalfLength;
  if (stretch.to - stretch.from >= contract.length - 1e-8) return true;
  const offset = mod(center - stretch.from, contract.length);
  return offset >= half - 1e-8 && offset + half <= stretch.to - stretch.from + 1e-8;
}

export function tracerReservation(contract, crossings, seed, tick, center, reservations = []) {
  const stretch = contract.stretches.find(s => containsStrip(contract, s, center));
  if (!stretch) return { pass:false, reason:"whole-strip-outside-stretch" };
  // A live race has not learned future lap crossings yet. Unknown ownership
  // cannot establish a free reservation; yield until activation is known.
  if (contract.layers.some(l => l.kind !== "seeded-static" && stretch.owners.includes(l.id)
    && !Number.isFinite(crossings[l.fromLap - 1]?.tick))) {
    return {pass:false,reason:"unknown-future-owner",stretch:stretch.id};
  }
  const bar = barAt(contract, tick);
  const until = barTick(contract, bar + contract.rules.reserveBars) + contract.rules.tracerLifeTicks;
  const times = [tick];
  for (let b = bar + 1; barTick(contract,b) < until; b++) times.push(barTick(contract,b));
  for (const at of times) {
    const owners = zonesAt(contract,crossings,seed,at).filter(z => stretch.owners.includes(z.owner)
      && arcsOverlap([stretch.from,stretch.to],z.zone,contract.length));
    if (owners.length) return {pass:false,reason:"owned-during-life-plus-bar",stretch:stretch.id,at,owners:[...new Set(owners.map(z=>z.owner))]};
  }
  if (reservations.some(r => r.stretch === stretch.id && r.tick < until && tick < r.until)) {
    return {pass:false,reason:"tracer-reservation-overlap",stretch:stretch.id};
  }
  return {pass:true,stretch:stretch.id,until};
}

// Stable quoted-data ABI consumed by (signal ice schedule). No runtime eval.
// (version length half-width bpm rules stretches layers tracer)
export function contractList(contract) {
  const r = contract.rules, t = contract.tracer;
  return [contract.version, contract.length, contract.halfWidth, contract.bpm,
    [r.lane, r.neighbour, r.padding, r.tracerHalfLength, r.tracerHalfWidth,
      r.tracerAhead, r.tracerLifeTicks, r.telegraphBars, r.reserveBars],
    contract.stretches.map(s => [s.id, s.from, s.to, s.owners]),
    contract.layers.map(l => [l.id, l.kind, l.fromLap, l.phraseBars, l.upBars, l.downBars, l.phaseBars,
      l.layouts.map(layout => [layout.id, layout.zones])]),
    [t.enabled, t.fromLap, t.periodBars]];
}
export function sigilData(value) {
  if (Array.isArray(value)) return `(${value.map(sigilData).join(" ")})`;
  if (typeof value === "boolean") return value ? "#t" : "#f";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("unsupported schedule data value");
}
