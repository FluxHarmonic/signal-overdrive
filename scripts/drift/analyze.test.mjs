import assert from "node:assert/strict";
import { correlate, assess, parseTrace, armSignature, classifyCapture } from "./analyze.mjs";

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

// Equal peaks one period apart: preferLag picks the nearer, the plain search
// whichever scores higher by rounding.
{
  const period = 600, pattern = Float32Array.from({ length: period }, () => random());
  const periodic = Float32Array.from({ length: 6000 }, (_, i) => pattern[i % period]);
  const window = periodic.subarray(1200, 1200 + 1800);
  assert.equal(correlate(window, periodic, 1200 + 600).lag % period, 0);
  assert.equal(correlate(window, periodic, 1200 + 600).lag, 1800);
  assert.equal(correlate(window, periodic, 3000).lag, 3000);
}

// The preference only breaks near-ties: a clearly better peak far from the
// preferred lag must win over a weaker one beside it (measured on a real
// capture: true lag 0.99, beat alias 0.76). A tie threshold of 0.3 fails this.
{
  const window = Float32Array.from({ length: 1500 }, () => random());
  const capture = Float32Array.from({ length: 9000 }, () => random() * 0.02);
  for (let i = 0; i < window.length; i++) {
    capture[6000 + i] = window[i];                                   // the true lag, exact
    capture[1000 + i] = window[i] * 0.6 + (random() - 0.5) * 0.55;   // a weaker look-alike
  }
  const weak = correlate(window, capture.subarray(800, 2700)).norm;
  assert.ok(weak > 0.6 && weak < 0.9, `look-alike score ${weak}`);
  assert.equal(correlate(window, capture, 1000).lag, 6000);
}

// Arm signatures from matched windows.
{
  const rows = (f, from = 0, to = 100) => Array.from({ length: 200 }, (_, i) => ({ song: from + (to - from) * i / 200, norm: 0.9, error_ms: f(from + (to - from) * i / 200) }));
  const clocks = [];
  for (let song = 0; song <= 100; song += 0.1) clocks.push({ song, metrics: { resyncs: String(Math.floor(song / 6)) } });
  assert.ok(armSignature("immediate", { rows: rows(s => s < 6.86 ? 10 : 1725) }, clocks).matched);
  // the displacement may be a different whole number of bars later on
  assert.ok(armSignature("immediate", { rows: rows(s => s < 6.86 ? 10 : s < 50 ? 1725 : -1700) }, clocks).matched);
  assert.ok(!armSignature("immediate", { rows: rows(() => 10) }, clocks).matched);
  assert.ok(armSignature("immediate", { rows: rows(s => s < 6.86 ? 10 : 2575) }, clocks).matched);
  assert.ok(!armSignature("immediate", { rows: rows(() => 860) }, clocks).matched);
  assert.ok(!armSignature("immediate", { rows: rows(() => -240) }, clocks).matched);
  assert.ok(armSignature("depth", { rows: rows(() => -240) }, clocks).matched);
  assert.ok(!armSignature("depth", { rows: rows(() => 1700) }, clocks).matched);
  // 1% fast: the error falls 10 ms a second, and each resync (every 6 s) resets it.
  assert.ok(armSignature("skew", { rows: rows(s => 20 - 10 * (s % 6)) }, clocks).matched);
  assert.ok(!armSignature("skew", { rows: rows(() => 45) }, clocks).matched);
}

// Verdicts by cause.
{
  const base = { pass: true, music_underruns_in_race: 0, device_dropouts: { count: 3, total_ms: 16, longest_ms: 6 } };
  assert.equal(classifyCapture("normal", base).status, "PASS");
  assert.equal(classifyCapture("normal", { ...base, pass: false }).status, "FAIL");
  const lost = classifyCapture("normal", { ...base, pass: false, lock_failure: "acquisition correlated 0.704, under 0.8" });
  assert.equal(lost.status, "FAIL");
  assert.match(lost.reason, /lock lost: acquisition correlated 0.704/);
  assert.equal(classifyCapture("normal", { ...base, music_underruns_in_race: 7407 }).status, "FAIL");
  assert.equal(classifyCapture("normal", { ...base, device_dropouts: { count: 1, total_ms: 51, longest_ms: 51 } }).status, "SETUP-FAILED");
  assert.equal(classifyCapture("normal", { ...base, device_dropouts: { count: 30, total_ms: 251, longest_ms: 10 } }).status, "SETUP-FAILED");
  assert.equal(classifyCapture("normal", { ...base, device_dropouts: { count: 30, total_ms: 250, longest_ms: 50 } }).status, "PASS");
  assert.equal(classifyCapture("skew", { ...base, pass: false }, { matched: true }).status, "PASS");
  assert.equal(classifyCapture("skew", { ...base, pass: false }, { matched: false }).status, "FAIL");
  assert.equal(classifyCapture("skew", base, { matched: true }).status, "FAIL");
}
console.log("FFT correlation, nominal-lag preference, arm signatures, verdict classes, threshold boundaries, coverage, offsets and growing drift: PASS");
