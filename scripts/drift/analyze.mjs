import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RATE = 48000;
const ENVELOPE_RATE = 3000;
const DECIMATION = RATE / ENVELOPE_RATE;

function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let width = 2; width <= n; width *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / width;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let base = 0; base < n; base += width) {
      let wr = 1, wi = 0;
      for (let k = 0; k < width / 2; k++) {
        const a = base + k, b = a + width / 2;
        const br = real[b] * wr - imag[b] * wi;
        const bi = real[b] * wi + imag[b] * wr;
        real[b] = real[a] - br; imag[b] = imag[a] - bi;
        real[a] += br; imag[a] += bi;
        const nextR = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = nextR;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
}

// Valid-lag, normalized cross-correlation. The capture mean and energy
// are recomputed for each candidate window, so a loud engine cannot
// win just by raising the captured envelope's DC level.
export function correlate(reference, capture) {
  if (reference.length < 2 || capture.length < reference.length) throw new Error("short correlation window");
  let size = 1;
  while (size < reference.length + capture.length) size *= 2;
  const ar = new Float64Array(size), ai = new Float64Array(size);
  const br = new Float64Array(size), bi = new Float64Array(size);
  const mean = reference.reduce((sum, x) => sum + x, 0) / reference.length;
  let energy = 0;
  for (let i = 0; i < reference.length; i++) {
    const value = reference[i] - mean;
    br[reference.length - 1 - i] = value; energy += value * value;
  }
  ar.set(capture);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < size; i++) {
    const real = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = real;
  }
  fft(ar, ai, true);
  const sums = new Float64Array(capture.length + 1);
  const squares = new Float64Array(capture.length + 1);
  for (let i = 0; i < capture.length; i++) {
    sums[i + 1] = sums[i] + capture[i];
    squares[i + 1] = squares[i] + capture[i] * capture[i];
  }
  let best = { lag: 0, norm: -Infinity };
  for (let lag = 0; lag <= capture.length - reference.length; lag++) {
    const end = lag + reference.length;
    const sum = sums[end] - sums[lag];
    const variance = Math.max(0, squares[end] - squares[lag] - sum * sum / reference.length);
    // FFT rounding residue divided by a silent window's zero energy
    // must never outrank a real match. Captures include silent tails.
    if (energy <= 1e-12 || variance <= 1e-12 * reference.length) continue;
    const norm = ar[lag + reference.length - 1] / Math.sqrt(energy * variance + 1e-30);
    if (norm > best.norm) best = { lag, norm };
  }
  return best;
}

function envelope(file, format) {
  const bytes = fs.readFileSync(file);
  const frameBytes = format === "s16" ? 4 : 8;
  const frames = Math.floor(bytes.length / frameBytes);
  const result = new Float32Array(Math.floor(frames / DECIMATION));
  let squareSum = 0;
  for (let i = 0; i < result.length; i++) {
    let sum = 0;
    for (let j = 0; j < DECIMATION; j++) {
      const offset = (i * DECIMATION + j) * frameBytes;
      const value = format === "s16"
        ? (bytes.readInt16LE(offset) + bytes.readInt16LE(offset + 2)) / 65536
        : (bytes.readFloatLE(offset) + bytes.readFloatLE(offset + 4)) / 2;
      if (!Number.isFinite(value)) throw new Error(`nonfinite PCM in ${file}`);
      sum += Math.abs(value); squareSum += value * value;
    }
    result[i] = sum / DECIMATION;
  }
  return { values: result, seconds: frames / RATE, rms: Math.sqrt(squareSum / (result.length * DECIMATION)) };
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function assess(errors, coverage) {
  const absolute = errors.map(Math.abs);
  const p95 = percentile(absolute, 0.95), worst = Math.max(...absolute);
  return { pass: errors.length >= 20 && coverage >= 0.95 && p95 <= 30 && worst <= 60, p95_ms: p95, worst_ms: worst, coverage };
}

export function parseTrace(text) {
  const clocks = [], jumps = [];
  for (const line of text.split("\n")) {
    if (/conductor reset .* mark grid/.test(line)) { clocks.length = 0; jumps.length = 0; }
    const jump = line.match(/conductor intended tick (\d+) bar (\d+) mark (\w+)/);
    if (jump) jumps.push({ tick: +jump[1], bar: +jump[2], mark: jump[3] });
    const clock = line.match(/conductor clock wall (\S+) song (\S+) audio (\S+) tick (\d+) phase (\w+)(.*)/);
    if (clock) {
      const fields = clock[6].trim().split(/\s+/), metrics = {};
      for (let i = 0; i + 1 < fields.length; i += 2) metrics[fields[i]] = fields[i + 1];
      clocks.push({ wall: +clock[1], song: +clock[2], audio: clock[3] === "-" ? null : +clock[3], tick: +clock[4], phase: clock[5], metrics });
    }
  }
  return { clocks, jumps };
}

export function analyze(run) {
  const trace = parseTrace(fs.readFileSync(path.join(run, "game.log"), "utf8"));
  if (!trace.clocks.length || trace.jumps[0]?.mark !== "grid") throw new Error("missing grid race trace");
  const required = ["grid", "lap1", "lap2", "hold", "fill", "traced", "uplink", "results"];
  if (required.some(mark => !trace.jumps.some(j => j.mark === mark))) throw new Error("race did not visit every intended section");
  const cap = envelope(path.join(run, "capture.pcm"), "s16");
  const ref = envelope(path.join(run, "reference.pcm"), "f32");
  if (!(cap.rms > 1e-4)) return { pass: false, reason: "silent actual-game capture", rms: cap.rms };
  const observations = fs.readFileSync(path.join(run, "capclock.txt"), "utf8").trim().split("\n")
    .map(line => line.split(/\s+/).map(Number)).filter(([wall, bytes]) => Number.isFinite(wall) && bytes > 0);
  if (!observations.length) throw new Error("no capture timing observations");
  const first = observations[0][0];
  const bounds = observations.filter(([wall]) => wall - first < 10000).map(([wall, bytes]) => wall - bytes / 4 / RATE * 1000);
  const start = Math.min(...bounds);
  const clocks = trace.clocks.filter(c => c.audio !== null);
  let index = 0;
  function wallAt(song) {
    while (index + 1 < clocks.length && clocks[index + 1].song < song) index++;
    const a = clocks[index], b = clocks[index + 1];
    if (!a || !b || song < a.song || b.song <= a.song) return null;
    return a.wall + (b.wall - a.wall) * (song - a.song) / (b.song - a.song);
  }
  const rows = [], halfWindow = 0.75, searchSeconds = 4.0;
  const end = Math.min(ref.seconds - 2 * halfWindow, clocks.at(-1).song - halfWindow);
  for (let song = 2; song < end; song += 60 / 140) {
    const wall = wallAt(song);
    if (wall === null) continue;
    const expected = (wall - start) / 1000;
    const from = Math.max(0, Math.floor((expected - searchSeconds) * ENVELOPE_RATE));
    const to = Math.min(cap.values.length, Math.ceil((expected + 2 * halfWindow + searchSeconds) * ENVELOPE_RATE));
    const refFrom = Math.round(song * ENVELOPE_RATE), length = Math.round(2 * halfWindow * ENVELOPE_RATE);
    if (to - from < length) { rows.push({ song, norm: 0, reason: "capture too short" }); continue; }
    const peak = correlate(ref.values.subarray(refFrom, refFrom + length), cap.values.subarray(from, to));
    const heard = start + (from + peak.lag) / ENVELOPE_RATE * 1000;
    rows.push({ song, norm: peak.norm, error_ms: wall - heard });
  }
  const good = rows.filter(r => r.norm >= 0.5 && Number.isFinite(r.error_ms));
  const verdict = assess(good.map(r => r.error_ms), good.length / rows.length);
  const costs = clocks.map(c => +c.metrics["music-ms"]).filter(Number.isFinite);
  return { ...verdict, windows: rows.length, correlated: good.length, capture_rms: cap.rms,
    capture_start_ms: start, capture_clock_spread_ms: Math.max(...bounds) - start,
    insert_cost_ms: { samples: costs.length, p50: percentile(costs, 0.5), p95: percentile(costs, 0.95), worst: Math.max(...costs) },
    intended_jumps: trace.jumps, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = analyze(process.argv[2]);
    fs.writeFileSync(path.join(process.argv[2], "analysis.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ ...result, rows: undefined }));
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) { console.error(`SETUP-FAILED: ${error.message}`); process.exitCode = 125; }
}
