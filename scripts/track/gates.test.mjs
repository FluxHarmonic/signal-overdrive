import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTrack, validateTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition } from "./geometry.mjs";
import { geometryGates, parGate, freeLane, tileGate, readability, projectGround } from "./gates.mjs";
import { Canvas, C } from "../art/lib.mjs";
import { timeline } from "./preview.mjs";

const source = loadTrack("test/fixtures/tracks/retired-loop.json");
const geometry = sampleDefinition(trackDefinition(source));
const gates = geometryGates(source, geometry);

test("legacy radius, clearance, world bounds and static lane gates pass", () => {
  for (const name of ["radius", "separation", "world", "freeLane"]) {
    assert.equal(gates[name].pass, true, name);
  }
});

test("sabotage: folded inner wall fails radius", () => {
  const bad = { ...geometry, CURV_S: geometry.CURV_S.map(k => k * 100) };
  assert.equal(geometryGates(source, bad).radius.pass, false);
});

test("true radius: a sharp corner can pass smoothing and must fail local curvature", () => {
  // Pull one control point of the authored Quayside draft into its neighbour.
  // Search a small deterministic set, then prove both gate outcomes on the
  // same actual spline, rather than planting a fabricated curvature number.
  const fixture = loadTrack("test/fixtures/tracks/quayside.json");
  let witness = null;
  for (const distance of [30, 60, 90, 120, 150, 180, 210]) {
    const bad = structuredClone(fixture);
    const p = bad.geometry.control[5];
    bad.geometry.control[5] = [p[0] - distance, p[1]];
    const sampled = sampleDefinition(trackDefinition(bad));
    const oldRadius = Math.min(...sampled.CURV_S.map(k => Math.abs(k) > 1e-9 ? 1 / Math.abs(k) : 1e9));
    if (oldRadius >= sampled.HW * 1.6 && sampled.TRUE_MIN_RADIUS < sampled.HW * 1.6) {
      witness = { source: bad, sampled };
      break;
    }
  }
  assert.ok(witness, "sabotage fixture must expose the smoothed-radius gap");
  const result = geometryGates(witness.source, witness.sampled);
  assert.equal(result.radius.pass, true);
  assert.equal(result.trueRadius.pass, false);
});

test("authored Docklands drafts validate and enumerate every seeded layout", () => {
  for (const id of ["quayside", "basin"]) {
    const fixture = loadTrack(`test/fixtures/tracks/${id}.json`);
    const result = geometryGates(fixture, sampleDefinition(trackDefinition(fixture)));
    assert.equal(result.freeLane.combinations, 6);
    assert.equal(result.freeLane.pass, true);
    // Draft gate results are reported, not presumed green.
    assert.ok(Number.isFinite(result.trueRadius.minimum));
  }
});

test("mixed-radix seeds select every authored layout product deterministically", () => {
  const fixture = loadTrack("test/fixtures/tracks/basin.json");
  const selections = new Set();
  for (let seed = 0; seed < 6; seed++) {
    const a = trackDefinition(fixture, seed);
    assert.deepEqual(a, trackDefinition(fixture, seed));
    selections.add(a.selectedLayouts.join(","));
    assert.ok(a.ice.length > fixture.zones.ice.length);
  }
  assert.equal(selections.size, 6);
  assert.throws(() => trackDefinition(fixture, -1));
});

test("sabotage: non-neighbouring crossing fails separation", () => {
  const bad = structuredClone(geometry);
  bad.P[Math.floor(bad.N / 2)] = [...bad.P[0]];
  assert.equal(geometryGates(source, bad).separation.pass, false);
});

test("sabotage: road outside world fails bounds", () => {
  const bad = { ...geometry, P: geometry.P.map(([x, y]) => [x + 4096, y]) };
  assert.equal(geometryGates(source, bad).world.pass, false);
});

test("par timing: 20s and 40s laps fail, 25..35s pass; top speed cannot reject a valid par", () => {
  for (const seconds of [20, 25, 30, 35, 40]) {
    const driven = { id: source.id, threeLapsAllRacers: true,
      lapTicks: [seconds * 60 + 60, seconds * 60, seconds * 60 + 30] };
    assert.equal(parGate(source, driven).pass, seconds >= 25 && seconds <= 35);
    assert.equal(parGate(source, driven).seconds, seconds);
  }
  // Length/top is informational: realistic corner speeds can make a shorter
  // track meet par. Geometry has no separate minimum-length rejection.
  assert.equal(Object.hasOwn(gates, "lapLength"), false);
  assert.equal(parGate(source, null).pass, false);
  const oval = loadTrack("tracks/oval.json");
  const result = parGate(oval, { id: oval.id, threeLapsAllRacers: true, lapTicks: [960, 900, 915] });
  assert.equal(result.pass, true);
  assert.equal(result.exempt, true);
  assert.ok(result.seconds < 25);
});

test("sabotage: hairpin hidden beyond the previous corner fails entrance visibility", () => {
  const sharp = structuredClone(source);
  sharp.geometry = { type: "stadium", center: [2048, 2048], straight: 1900, radius: 140, points: 40, halfWidth: 78 };
  const result = readability(sampleDefinition(trackDefinition(sharp)));
  assert.equal(result.pass, false);
  assert.ok(result.firstFailure);
  assert.equal(result.curvatureThreshold, 1 / 5000);
  assert.equal(result.continuation, 96);
  assert.equal(projectGround({ x: 0, y: 0, tx: 1, ty: 0 }, { x: 1900, y: 0 }).visible, true);
});

test("calibrated entrance rule preserves oval readability and diagnoses prototype loop", () => {
  const oval = loadTrack("tracks/oval.json");
  const result = readability(sampleDefinition(trackDefinition(oval)));
  assert.equal(result.pass, true);
  assert.equal(result.bends, 2);
  assert.equal(gates.readability.failed, 4);
  assert.equal(gates.readability.bends, 7);
});

test("sabotage: simultaneous seed layers block the road, including shared endpoint", () => {
  const bad = structuredClone(source);
  bad.iceLayers = [
    { id: "firewall", layouts: [{ id: "off", zones: [] }, { id: "left", zones: [[0.4, 0.5, -1, 0.1]] }] },
    { id: "tracer", layouts: [{ id: "off", zones: [] }, { id: "right", zones: [[0.5, 0.6, -0.1, 1]] }] },
  ];
  const result = freeLane(bad);
  assert.equal(result.combinations, 4);
  assert.equal(result.pass, false);
  assert.equal(result.witness.at, 0.5);
  assert.equal(result.narrowest, 0);
});

test("sabotage: over-budget atlas fails tile count", () => {
  assert.equal(tileGate(4096).pass, true);
  assert.equal(tileGate(4097).pass, false);
});

test("seeded free-lane union joins both sides of the closed lap line", () => {
  const bad = structuredClone(source);
  bad.zones.ice = [[0, 0.1, -1, 0.1], [0.9, 1, -0.1, 1]];
  const result = freeLane(bad);
  assert.equal(result.pass, false);
  assert.equal(result.witness.at, 0);
});

test("sabotage: a non-palette pixel fails the existing painter palette gate", () => {
  const canvas = new Canvas(2, 1);
  canvas.set(0, 0, C.BG);
  canvas.set(1, 0, C.ICE);
  assert.doesNotThrow(() => canvas.checkPalette("valid fixture"));
  canvas.set(1, 0, [1, 2, 3], 128);
  assert.throws(() => canvas.checkPalette("sabotaged fixture"), /outside the palette/);
});

test("sabotage: a different compiled song cannot silently supply the timeline", () => {
  assert.throws(() => timeline(source, geometry, {
    id: "other-song", cues: source.song.cues, bpm: source.song.bpm,
  }), /binding disagrees/);
});

test("format rejects unsupported versions and nonfinite or reversed zones", () => {
  for (const mutate of [t => { t.version = 2; }, t => { t.zones.ice[0][0] = NaN; },
    t => { t.zones.ice[0][1] = 0.1; }, t => { t.geometry.type = "code"; }]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(() => validateTrack(bad));
  }
});
