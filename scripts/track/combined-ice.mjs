// Time-aware authoring proof. It checks potential live hazards at every
// actual lap/bar boundary, not merely the one seed an autopilot encountered.
// Current runtime has no automatic firewall scheduler; inferred schedules
// below are deliberately conservative until an explicit policy is supplied.
import fs from "node:fs";
import { loadTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition } from "./geometry.mjs";

const mod = (x, n) => ((x % n) + n) % n;

function gap(intervals) {
  let edge = -1, widest = 0;
  for (const [left, right] of [...intervals].sort((a, b) => a[0] - b[0])) {
    widest = Math.max(widest, left - edge);
    edge = Math.max(edge, right);
  }
  return Math.max(widest, 1 - edge);
}

function product(choices) {
  let result = [{ ids: [], zones: [], owners: [], transition: false }];
  for (const choice of choices) {
    if (result.length * choice.length > 4096) throw new Error("combined ICE state product exceeds 4096");
    result = result.flatMap(state => choice.map(option => ({
      ids: [...state.ids, option.id], zones: [...state.zones, ...option.zones],
      owners: [...state.owners, ...option.zones.map(zone => ({ zone, id: option.id }))],
      transition: state.transition || Boolean(option.transition),
    })));
  }
  return result;
}

function occupiedAt(z, s) {
  return (z[0] <= s && s <= z[1]) || ((s === 0 || s === 1) && (z[0] === 0 || z[1] === 1));
}

function tracerCanReach(s, centers, halfLength) {
  return centers.some(([a, b]) => [-1, 0, 1].some(offset =>
    s + offset >= a - halfLength && s + offset <= b + halfLength));
}

// Exact piecewise-linear minimax for one adaptive tracer. Breakpoints occur
// when either edge touches an occupied edge; between them the optimum is a
// free interval's midpoint. This covers every legal lateral target, not a
// handful of sampled lanes. Other tracer/drone patterns use finite layouts.
function tracerCandidates(intervals, halfWidth, radius) {
  const bounds = [-1, 1, ...intervals.flat()];
  const lo = -1 + radius, hi = 1 - radius;
  const candidates = [lo, hi];
  for (const x of bounds) candidates.push(x - halfWidth, x + halfWidth);
  for (const a of bounds) for (const b of bounds) if (a < b) candidates.push((a + b) / 2);
  return [...new Set(candidates.map(x => Math.max(lo, Math.min(hi, x))))];
}

function inferredLayer(source, layer) {
  const zone = source.musicZones.find(zone => zone.kind === "firewall"
    && (zone.id === layer.id || zone.id === `${layer.id}-firewall`));
  return { ...layer, kind: zone ? "firewall" : "seeded-static",
    fromLap: zone ? (zone.sections.includes("lap2") ? 2 : 3) : 1,
    // No authored cadence exists in v1: allow a change on ANY bar. This
    // conservatively includes every phase of four/eight-bar phrases.
    phraseBars: zone ? 1 : 0, upBars: 1, downBars: 0, phaseBars: 0 };
}

export function combinedIce(source, timing, policy = {}) {
  if (timing.id !== undefined && timing.id !== source.id) throw new Error("ICE timing belongs to another track");
  for (const key of Object.keys(policy)) if (!["layers", "extraLayers", "tracer", "machineWidth"].includes(key)) throw new Error(`unknown ICE policy field ${key}`);
  const crossings = timing.crossings;
  if (!Array.isArray(crossings) || crossings.length !== 4
    || crossings.some((entry, i) => entry.lap !== i + 1 || !Number.isInteger(entry.tick) || entry.tick < 0
      || (i && entry.tick <= crossings[i - 1].tick))) throw new Error("combined ICE needs actual ordered lap 1..4 crossing ticks");
  const finish = crossings[3].tick;
  const bpm = source.song.bpm;
  const barTick = bar => Math.ceil(bar * 32 * 60 * 5 * 3 / (bpm * 2) - 1e-9);
  const barAt = tick => Math.floor(tick * bpm * 2 / (32 * 60 * 5 * 3));
  const firstBar = tick => {
    const guess = barAt(tick);
    return barTick(guess) < tick ? guess + 1 : guess;
  };
  const lapAt = tick => crossings.filter(entry => entry.tick <= tick).length;
  for (const override of Object.values(policy.layers ?? {})) {
    for (const key of Object.keys(override)) if (!["kind", "fromLap", "phraseBars", "upBars", "downBars", "phaseBars"].includes(key)) {
      throw new Error(`unknown layer schedule field ${key}; authored layouts cannot be replaced by timing policy`);
    }
  }
  const layers = source.iceLayers.map(layer => ({ ...inferredLayer(source, layer), ...(policy.layers?.[layer.id] ?? {}) }));
  layers.push(...(policy.extraLayers ?? []));
  if (policy.layers && Object.keys(policy.layers).some(id => !source.iceLayers.some(layer => layer.id === id))) throw new Error("policy references unknown ICE layer");
  for (const layer of layers) {
    if (typeof layer.id !== "string" || !layer.id.length
      || !["firewall", "drone", "tracer", "seeded-static"].includes(layer.kind)
      || !Array.isArray(layer.layouts) || !layer.layouts.length
      || !Number.isInteger(layer.fromLap) || layer.fromLap < 1 || layer.fromLap > 3
      || !Number.isInteger(layer.phraseBars) || layer.phraseBars < 0
      || !Number.isInteger(layer.upBars) || layer.upBars < 1
      || !Number.isInteger(layer.downBars) || layer.downBars < 0
      || !Number.isInteger(layer.phaseBars)) throw new Error(`incomplete timed ICE layer ${layer.id}`);
    for (const layout of layer.layouts) for (const z of layout.zones) {
      if (z.length !== 4 || !z.every(Number.isFinite) || z[0] < 0 || z[0] >= z[1]
        || z[1] > 1 || z[2] < -1 || z[2] >= z[3] || z[3] > 1) throw new Error("invalid timed ICE zone");
    }
  }
  for (const key of Object.keys(policy.tracer ?? {})) {
    if (!["enabled", "fromLap", "halfWidth", "halfLength", "liveTicks", "periodBars", "centers"].includes(key)) throw new Error(`unknown tracer policy field ${key}`);
  }
  const tracer = { enabled: source.role === "race", fromLap: 3, halfWidth: 34,
    halfLength: 460, liveTicks: 6, periodBars: 1, centers: [[0, 1]], ...(policy.tracer ?? {}) };
  if (typeof tracer.enabled !== "boolean" || !Number.isInteger(tracer.fromLap) || tracer.fromLap < 1 || tracer.fromLap > 3
    || !Number.isFinite(tracer.halfWidth) || tracer.halfWidth <= 0
    || !Number.isFinite(tracer.halfLength) || tracer.halfLength <= 0
    || !Number.isInteger(tracer.liveTicks) || tracer.liveTicks < 1 || tracer.liveTicks > Math.floor(barTick(1))
    || !Number.isInteger(tracer.periodBars) || tracer.periodBars < 1
    || !Array.isArray(tracer.centers) || tracer.centers.some(z => z.length !== 2
      || !z.every(Number.isFinite) || z[0] < 0 || z[0] >= z[1] || z[1] > 1)) throw new Error("invalid adaptive tracer policy");
  const tracerStart = firstBar(crossings[tracer.fromLap - 1].tick) + 1; // a full telegraph bar
  const boundaries = new Set([crossings[0].tick, ...crossings.map(entry => entry.tick)]);
  for (let bar = 0; barTick(bar) <= finish; bar++) {
    boundaries.add(barTick(bar));
    if (bar >= tracerStart && mod(bar - tracerStart, tracer.periodBars) === 0) boundaries.add(barTick(bar) + tracer.liveTicks);
  }
  const length = sampleDefinition(trackDefinition(source)).LENGTH;
  const half = source.geometry.halfWidth;
  const machineWidth = policy.machineWidth ?? 18;
  if (!Number.isFinite(machineWidth) || machineWidth <= 0 || machineWidth >= 2 * half) throw new Error("invalid machine width");
  let narrowest = 2 * half, witness = null, firstFailure = null;
  let firstTracerFirewallFailure = null, checkedStates = 0, transitions = 0;
  const laps = crossings.slice(0, 3).map((entry, i) => ({ lap: entry.lap,
    fromTick: entry.tick, toTick: crossings[i + 1].tick, narrowest: 2 * half }));
  const active = (layer, tick) => tick >= crossings[layer.fromLap - 1].tick && tick < finish
    && mod(barAt(tick) + layer.phaseBars, layer.upBars + layer.downBars) < layer.upBars;
  for (const tick of [...boundaries].sort((a, b) => a - b)) {
    if (tick < crossings[0].tick || tick >= finish) continue;
    const bar = barAt(tick), lap = lapAt(tick);
    const choices = layers.map(layer => {
      const now = active(layer, tick), before = active(layer, tick - 1);
      if (!now && !before) return [{ id: `${layer.id}/down`, zones: [] }];
      // Preserve ending hazards at a transition so two different kinds
      // cannot silently exchange disjoint free lanes at the same boundary.
      if (!now) return layer.layouts.map(layout => ({ id: `${layer.kind}:${layer.id}/${layout.id}/ending`, zones: layout.zones, transition: true }));
      const rotating = layer.phraseBars > 0 && tick === barTick(bar)
        && mod(bar + layer.phaseBars, layer.phraseBars) === 0 && before;
      if (!rotating) return layer.layouts.map(layout => ({ id: `${layer.kind}:${layer.id}/${layout.id}`, zones: layout.zones }));
      transitions++;
      // Even an instantaneous swap needs a common free corridor. Without a
      // down interval, opposite free lanes cannot be treated independently.
      return layer.layouts.flatMap(before => layer.layouts.map(after => ({
        id: `${layer.kind}:${layer.id}/${before.id}->${after.id}`,
        zones: [...before.zones, ...after.zones],
        transition: before.id !== after.id,
      })));
    });
    const tracerActive = at => {
      const b = barAt(at);
      return tracer.enabled && b >= tracerStart && mod(b - tracerStart, tracer.periodBars) === 0
        && at < barTick(b) + tracer.liveTicks && at >= crossings[tracer.fromLap - 1].tick;
    };
    const tracerLive = tracerActive(tick) || tracerActive(tick - 1);
    for (const state of product(choices)) {
      checkedStates++;
      const zones = [...source.zones.ice, ...state.zones];
      const sweptEnds = tracer.centers.flatMap(([a, b]) => [mod(a - tracer.halfLength / length, 1), mod(b + tracer.halfLength / length, 1)]);
      const ends = [...new Set([0, 1, ...zones.flatMap(z => z.slice(0, 2)), ...sweptEnds])].sort((a, b) => a - b);
      const probes = [...ends, ...ends.slice(1).map((end, i) => (end + ends[i]) / 2)];
      for (const s of probes) {
        const intervals = zones.filter(z => occupiedAt(z, s)).map(z => z.slice(2));
        const activeOwners = [...source.zones.ice.flatMap((z, i) => occupiedAt(z, s) ? [`static/${i}`] : []),
          ...state.owners.filter(owner => occupiedAt(owner.zone, s)).map(owner => owner.id)];
        const beforeTracer = gap(intervals) * half;
        const centers = tracerLive && tracerCanReach(s, tracer.centers, tracer.halfLength / length)
          ? tracerCandidates(intervals, tracer.halfWidth / half, machineWidth / 2 / half) : [null];
        for (const center of centers) {
          const union = center === null ? intervals : [...intervals, [Math.max(-1, center - tracer.halfWidth / half), Math.min(1, center + tracer.halfWidth / half)]];
          const width = gap(union) * half;
          const event = { tick, bar, lap, s, layouts: state.ids, tracerCenter: center,
            tracerLive, active: union, activeOwners, transition: state.transition };
          if (!firstFailure && width < 1.5 * machineWidth) firstFailure = { ...event, width };
          if (!firstTracerFirewallFailure && center !== null && beforeTracer >= 1.5 * machineWidth
            && width < 1.5 * machineWidth && activeOwners.some(id => id.startsWith("firewall:"))) {
            firstTracerFirewallFailure = { ...event, beforeTracer, width };
          }
          laps[lap - 1].narrowest = Math.min(laps[lap - 1].narrowest, width);
          if (width < narrowest) {
            narrowest = width;
            witness = event;
          }
        }
      }
    }
  }
  return { id: source.id, crossings, pass: narrowest >= 1.5 * machineWidth, required: 1.5 * machineWidth,
    narrowest, checkedStates, transitions, witness, firstFailure, firstTracerFirewallFailure,
    laps: laps.map(entry => ({ ...entry, pass: entry.narrowest >= 1.5 * machineWidth })),
    timing: "actual simulation lap crossings; exact conductor bar ticks",
    policySource: Object.keys(policy).length ? "explicit authoring policy" : "conservative unbound live-ICE contract (all bar phases)",
    runtimeParity: "automatic live ICE scheduling is not implemented in the current game; runtime integration must use this policy or export an equivalent exhaustive trace" };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [trackFile, timingFile, output, policyFile] = process.argv.slice(2);
  if (!trackFile || !timingFile || !output) throw new Error("usage: combined-ice.mjs track.json ai.json output.json [policy.json]");
  const result = combinedIce(loadTrack(trackFile), JSON.parse(fs.readFileSync(timingFile)),
    policyFile ? JSON.parse(fs.readFileSync(policyFile)) : {});
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  if (!result.pass) process.exitCode = 1;
}
