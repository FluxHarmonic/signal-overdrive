import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTrack } from "./format.mjs";
import { combinedIce } from "./combined-ice.mjs";

const timing = { crossings: [{ lap: 1, tick: 500 }, { lap: 2, tick: 2300 },
  { lap: 3, tick: 4100 }, { lap: 4, tick: 5900 }] };
const makeSource = () => {
  const source = structuredClone(loadTrack("tracks/oval.json"));
  source.role = "race";
  source.zones.ice = [];
  source.iceLayers = [];
  return source;
};
const layer = (id, zones) => ({ id, layouts: [{ id: "live", zones }] });
const schedule = kind => ({ kind, fromLap: 3, phraseBars: 4, upBars: 4, downBars: 0, phaseBars: 0 });

test("an adaptive tracer alone leaves a lane at every legal lateral target", () => {
  const result = combinedIce(makeSource(), timing);
  assert.equal(result.pass, true);
  assert.ok(Math.abs(result.narrowest - 58) < 1e-9);
});

test("sabotage: tracer plus firewall closes a lane that each kind alone leaves free", () => {
  const source = makeSource();
  source.iceLayers = [layer("wall", [[0.2, 0.3, -1, 0.2]])];
  const policy = { layers: { wall: schedule("firewall") } };
  assert.equal(combinedIce(source, timing, { ...policy, tracer: { enabled: false } }).pass, true);
  const result = combinedIce(source, timing, policy);
  assert.equal(result.pass, false);
  assert.equal(result.firstFailure.lap, 3);
  assert.equal(result.witness.tracerLive, true);
  assert.ok(result.narrowest < result.required);
  assert.ok(result.firstTracerFirewallFailure.beforeTracer >= result.required);
  assert.ok(result.firstTracerFirewallFailure.width < result.required);
});

test("zero-rest phrase swaps need a common corridor; a full down bar restores it", () => {
  const source = makeSource();
  source.iceLayers = [{ id: "wall", layouts: [
    { id: "left", zones: [[0.2, 0.3, -1, 0.2]] },
    { id: "right", zones: [[0.2, 0.3, -0.2, 1]] },
  ] }];
  const base = { tracer: { enabled: false }, layers: { wall: schedule("firewall") } };
  const result = combinedIce(source, timing, base);
  assert.equal(result.pass, false);
  assert.equal(result.narrowest, 0);
  assert.equal(result.firstFailure.transition, true);
  assert.equal(combinedIce(source, timing, { ...base,
    layers: { wall: { ...schedule("firewall"), upBars: 1, downBars: 1, phraseBars: 2 } },
  }).pass, true);
});

test("drone and firewall layouts are combined, including complementary cadence boundaries", () => {
  const source = makeSource();
  source.iceLayers = [layer("wall", [[0.2, 0.3, -1, 0.1]])];
  const result = combinedIce(source, timing, {
    tracer: { enabled: false }, layers: { wall: { ...schedule("firewall"), upBars: 1, downBars: 1 } },
    extraLayers: [{ ...layer("drones", [[0.2, 0.3, -0.1, 1]]), ...schedule("drone"), upBars: 1, downBars: 1, phaseBars: 1 }],
  });
  assert.equal(result.pass, false);
  assert.equal(result.narrowest, 0);
});

test("actual crossing times control lap activation; missing timing fails closed", () => {
  const source = makeSource();
  assert.throws(() => combinedIce(source, { lapTicks: [1800, 1800, 1800] }), /actual ordered/);
  assert.throws(() => combinedIce(source, timing, { layers: { absent: schedule("firewall") } }), /unknown ICE layer/);
  source.iceLayers = [layer("wall", [[0.2, 0.3, -1, 0.1]])];
  assert.throws(() => combinedIce(source, timing, { layers: { wall: { layouts: [] } } }), /authored layouts/);
  assert.throws(() => combinedIce(source, timing, { tracer: { period: 4 } }), /unknown tracer/);
  assert.throws(() => combinedIce(source, { ...timing, id: "other-track" }), /another track/);
});
