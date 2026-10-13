import assert from "node:assert/strict";
import { correlate, assess, parseTrace } from "./analyze.mjs";

let seed = 42;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const ref = Float32Array.from({ length: 4500 }, () => random());
for (const shift of [900, 1650, 12000]) {
  const capture = Float32Array.from({ length: 24000 }, () => random() * 0.01 + 0.7);
  for (let i = 0; i < ref.length; i++) capture[i + shift] = ref[i] * 0.8 + 0.7 + random() * 0.002;
  const peak = correlate(ref, capture);
  assert.equal(peak.lag, shift);
  assert.ok(peak.norm > 0.999);
}
const unrelated = Float32Array.from({ length: 24000 }, () => random());
assert.ok(correlate(ref, unrelated).norm < 0.1);
assert.ok(correlate(ref, new Float32Array(24000)).norm < 0.5);
assert.ok(correlate(ref, new Float32Array(24000).fill(0.7)).norm < 0.5);
assert.ok(assess(Array(100).fill(29), 1).pass);
assert.ok(assess(Array(100).fill(30), 1).pass);
assert.ok(!assess(Array(100).fill(30.1), 1).pass);
assert.ok(!assess([61, ...Array(99).fill(0)], 1).pass);
assert.ok(!assess(Array(100).fill(0), 0.94).pass);
assert.ok(!assess(Array(100).fill(250), 1).pass);
assert.ok(!assess(Array(100).fill(1714), 1).pass);
assert.ok(!assess(Array.from({ length: 100 }, (_, i) => i * 12), 1).pass);
const trace = parseTrace("signal-overdrive: conductor reset wall 1000 mark grid\nsignal-overdrive: conductor intended tick 0 bar 0 mark grid\nsignal-overdrive: conductor clock wall 1001 song 0.01 audio 0 tick 0 phase countdown music on music-ms 1.2\n");
assert.deepEqual(trace.jumps, [{ tick: 0, bar: 0, mark: "grid" }]);
assert.equal(trace.clocks[0].metrics["music-ms"], "1.2");
console.log("FFT correlation, unrelated material, threshold boundaries, coverage, offsets and growing drift: PASS");
