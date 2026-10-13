import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { analyze } from "./analyze.mjs";

const RATE = 48000, seconds = 18, frames = RATE * seconds;
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

const marks = ["grid", "lap1", "lap2", "hold", "fill", "traced", "uplink", "results"];
function fixture(arm, offset, clockRate = 1, referenceRate = RATE) {
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
  fs.writeFileSync(path.join(run, "reference.pcm"), rendered);
  const capture = Buffer.alloc((frames + RATE * 7) * 4);
  const lead = Math.round((1 + offset) * RATE);
  for (let i = 0; i < frames; i++) {
    const source = arm === "wrong-material" ? (i + Math.round(RATE * 12 / 7)) % frames : i;
    const value = Math.round(wave[source] * 32767);
    capture.writeInt16LE(value, (i + lead) * 4);
    capture.writeInt16LE(value, (i + lead) * 4 + 2);
  }
  fs.writeFileSync(path.join(run, "capture.pcm"), capture);
  fs.writeFileSync(path.join(run, "capclock.txt"), "1000100 19200\n1000200 38400\n1000300 57600\n");
  let log = "signal-overdrive: conductor reset wall 1001000 mark grid\n";
  marks.forEach((mark, bar) => { log += `signal-overdrive: conductor intended tick ${Math.ceil(bar * 720 / 7)} bar ${bar} mark ${mark}\n`; });
  for (let i = 0; i <= 190; i++) {
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
  const skew = fixture("skew", 0, 1.01);
  assert.ok(!skew.pass);
  assert.ok(skew.p95_ms > 100);
  console.log(JSON.stringify({ normal: { p95: normal.p95_ms, worst: normal.worst_ms, coverage: normal.coverage },
    depth_p95: depth.p95_ms, wrong_material_p95: wrong.p95_ms, skew_p95: skew.p95_ms }));
  console.log("Synthetic PCM and dated-clock integration: normal GREEN, depth/wrong-material/skew RED");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
