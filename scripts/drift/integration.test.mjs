import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { analyze as currentAnalyze } from "./analyze.mjs";
// ANALYZER=path runs these fixtures against another analyzer (a sabotage leg).
const { analyze } = process.env.ANALYZER ? await import(path.resolve(process.env.ANALYZER)) : { analyze: currentAnalyze };

const RATE = 48000, seconds = 30, frames = RATE * seconds;
const root = fs.mkdtempSync("/tmp/conductor-analyzer-integration-");
const reference = Buffer.alloc(frames * 8);
const wave = new Float32Array(frames);
let seed = 47;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
let amplitude = 0;
for (let i = 0; i < frames; i++) {
  if (i % 127 === 0) amplitude = 0.1 + random() * 0.7;
  const value = amplitude * Math.sin(i * 2 * Math.PI * 440 / RATE);
  wave[i] = value;
  reference.writeFloatLE(value, i * 8); reference.writeFloatLE(value, i * 8 + 4);
}

// A count-in: the first four bars repeat one bar exactly, as the grid does.
const BAR = Math.round(RATE * 12 / 7);
const countIn = Float32Array.from(wave, (x, i) => i < 4 * BAR ? wave[i % BAR] : x);

// Drums whose four beats repeat exactly within a bar, with a different
// pattern each bar (as harmony and fills change): a 1.5 s window a beat off
// still matches three beats in four, an 8 s window does not.
const BEAT = Math.round(RATE * 60 / 140);
const drums = Float32Array.from({ length: frames }, (_, i) => {
  const bar = Math.floor(i / BAR), inBar = i - bar * BAR;
  return wave[(bar * 7919 * 4 + (inBar % BEAT)) % frames];
});

const marks = ["grid", "lap1", "lap2", "hold", "fill", "traced", "uplink", "results"];
function fixture(arm, offset, clockRate = 1, referenceRate = RATE, source = wave, noisyFrom = null, noisyTo = null, delayFrom = null, delay = 0, opts = {}) {
  const run = path.join(root, arm); fs.mkdirSync(run);
  let rendered = reference;
  if (referenceRate !== RATE) {
    rendered = Buffer.alloc(Math.round(frames * referenceRate / RATE) * 8);
    for (let i = 0; i < rendered.length / 8; i++) {
      const source = i * RATE / referenceRate, a = Math.floor(source), fraction = source - a;
      const value = wave[a] * (1 - fraction) + wave[Math.min(a + 1, frames - 1)] * fraction;
      rendered.writeFloatLE(value, i * 8); rendered.writeFloatLE(value, i * 8 + 4);
    }
    fs.writeFileSync(path.join(run, "meta.json"), JSON.stringify({ reference_sample_rate: referenceRate }));
  }
  if (source !== wave) {
    rendered = Buffer.alloc(frames * 8);
    for (let i = 0; i < frames; i++) { rendered.writeFloatLE(source[i], i * 8); rendered.writeFloatLE(source[i], i * 8 + 4); }
  }
  fs.writeFileSync(path.join(run, "reference.pcm"), rendered);
  const capture = Buffer.alloc((frames + RATE * 7) * 4);
  const lead = Math.round((1 + offset) * RATE);
  let blockGain = 1;
  for (let i = 0; i < frames; i++) {
    // After delayFrom s of song, everything is heard delay frames later.
    // Before opts.gapUntil s, everything is heard opts.gap frames late
    // (a race start whose audio began late, until a resync closes it).
    const from = arm === "wrong-material" ? (i + Math.round(RATE * 12 / 7)) % frames
      : delayFrom !== null && i >= delayFrom * RATE ? Math.max(0, i - delay)
      : opts.gapUntil !== undefined && i < opts.gapUntil * RATE ? Math.max(0, i - opts.gap) : i;
    // Over [opts.garbleFrom, opts.garbleTo) s, the capture holds unrelated noise.
    const garbled = opts.garbleFrom !== undefined && i >= opts.garbleFrom * RATE && i < opts.garbleTo * RATE;
    // Noise in 64-sample blocks over [noisyFrom, noisyTo) s of song, so it
    // survives the 16-sample envelope: the true lag there scores under a
    // clean copy of the same bar elsewhere.
    const noisy = noisyFrom !== null && i >= noisyFrom * RATE && i < noisyTo * RATE;
    if (noisy && i % 64 === 0) blockGain = 1 + 0.6 * (random() - 0.5);
    const sample = garbled ? (random() - 0.5) * 0.8 : arm === "wrong-material" ? wave[from] : source[from] * (noisy ? blockGain : 1);
    const value = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    capture.writeInt16LE(value, (i + lead) * 4);
    capture.writeInt16LE(value, (i + lead) * 4 + 2);
  }
  fs.writeFileSync(path.join(run, "capture.pcm"), capture);
  fs.writeFileSync(path.join(run, "capclock.txt"), "1000100 19200\n1000200 38400\n1000300 57600\n");
  let log = "signal-overdrive: conductor reset wall 1001000 mark grid\n";
  marks.forEach((mark, bar) => { log += `signal-overdrive: conductor intended tick ${Math.ceil(bar * 720 / 7)} bar ${bar} mark ${mark}\n`; });
  for (let i = 0; i <= (seconds + 1) * 10; i++) {
    const wallSeconds = i / 10, song = wallSeconds * clockRate;
    log += `signal-overdrive: conductor clock wall ${1001000 + wallSeconds * 1000} song ${song} audio ${song} tick ${Math.floor(song * 60)} phase race music on music-ms 1.2\n`;
  }
  fs.writeFileSync(path.join(run, "game.log"), log);
  return analyze(run);
}

try {
  const normal = fixture("normal", 0.007);
  assert.ok(normal.pass, JSON.stringify({ p95: normal.p95_ms, worst: normal.worst_ms, coverage: normal.coverage }));
  assert.ok(Math.abs(normal.p95_ms - 7) < 0.5);
  assert.equal(normal.insert_cost_ms.p95, 1.2);
  const nativeRate = fixture("native-rate", 0.007, 1, 44100);
  assert.ok(nativeRate.pass, JSON.stringify(nativeRate));
  assert.ok(Math.abs(nativeRate.p95_ms - 7) < 0.5);
  assert.equal(nativeRate.reference_sample_rate, 44100);
  const depth = fixture("depth", 0.25);
  assert.ok(!depth.pass);
  assert.ok(depth.p95_ms > 240);
  const wrong = fixture("wrong-material", 0);
  assert.ok(!wrong.pass);
  assert.ok(wrong.p95_ms > 1600 || wrong.coverage < 0.95);
  // The count-in alias: the true lag at song 2 is noisy, a bar later clean.
  const countInRun = fixture("count-in", 0.007, 1, RATE, countIn, 2.0, 3.6);
  assert.ok(countInRun.pass, JSON.stringify({ p95: countInRun.p95_ms, worst: countInRun.worst_ms, coverage: countInRun.coverage }));
  assert.ok(Math.abs(countInRun.p95_ms - 7) < 1);
  // A whole beat lost mid-race: tracking alone follows the beat alias.
  const beatLate = fixture("beat-late", 0.007, 1, RATE, drums, null, null, 10, BEAT);
  assert.ok(!beatLate.pass, JSON.stringify({ p95: beatLate.p95_ms, coverage: beatLate.coverage }));
  assert.ok(beatLate.p95_ms > 400, JSON.stringify({ p95: beatLate.p95_ms }));
  const drumsOnTime = fixture("drums", 0.007, 1, RATE, drums);
  assert.ok(drumsOnTime.pass, JSON.stringify({ p95: drumsOnTime.p95_ms, coverage: drumsOnTime.coverage }));
  // A late race start: heard 590 ms late until a resync at 4.8 s. The
  // capture is RED for the lock, and the late windows score the true lag.
  const lateStart = fixture("late-start", 0.007, 1, RATE, wave, null, null, null, 0, { gapUntil: 4.8, gap: Math.round(0.59 * RATE) });
  assert.ok(!lateStart.pass);
  assert.ok(lateStart.lock_failure, JSON.stringify({ acquisition: lateStart.acquisition, lock: lateStart.lock_failure }));
  assert.ok(lateStart.worst_ms > 560 && lateStart.worst_ms < 620, JSON.stringify({ worst: lateStart.worst_ms }));
  // Unrelated material for 3 s mid-race: windows there cannot be aligned,
  // and three in a row is a lost lock, RED, not windows dropped.
  const garbled = fixture("garbled", 0.007, 1, RATE, wave, null, null, null, 0, { garbleFrom: 14, garbleTo: 17 });
  assert.ok(!garbled.pass);
  assert.match(garbled.lock_failure ?? "", /consecutive windows under 0.5/);
  assert.ok(garbled.worst_ms < 20, JSON.stringify({ worst: garbled.worst_ms }));
  const skew = fixture("skew", 0, 1.01);
  assert.ok(!skew.pass);
  assert.ok(skew.p95_ms > 100);
  console.log(JSON.stringify({ normal: { p95: normal.p95_ms, worst: normal.worst_ms, coverage: normal.coverage }, count_in_p95: countInRun.p95_ms,
    depth_p95: depth.p95_ms, wrong_material_p95: wrong.p95_ms, skew_p95: skew.p95_ms, late_start_worst: lateStart.worst_ms, late_start_lock: lateStart.lock_failure, garbled_lock: garbled.lock_failure }));
  console.log("Synthetic PCM and dated-clock integration: normal, count-in and on-time drums GREEN; depth, wrong material, skew, a beat lost mid-race, a late start (at its true lag) and a lost lock RED");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
