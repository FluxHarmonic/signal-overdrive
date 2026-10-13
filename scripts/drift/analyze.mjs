import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RATE = 48000;
const ENVELOPE_RATE = 3000;

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

// Peaks within this of the best normalized score are treated as equally
// good: identical bars (the count-in) correlate at 0.99-1.00 one bar apart,
// and the envelope cannot tell them apart.
export const TIE = 0.05;

// Valid-lag, normalized cross-correlation. The capture mean and energy
// are recomputed for each candidate window, so a loud engine cannot
// win just by raising the captured envelope's DC level. With preferLag,
// among local peaks within TIE of the best, the one nearest preferLag
// wins; without it, the best does.
export function correlate(reference, capture, preferLag) {
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
  const lags = capture.length - reference.length + 1;
  const norms = new Float64Array(lags).fill(-Infinity);
  for (let lag = 0; lag < lags; lag++) {
    const end = lag + reference.length;
    const sum = sums[end] - sums[lag];
    const variance = Math.max(0, squares[end] - squares[lag] - sum * sum / reference.length);
    // FFT rounding residue divided by a silent window's zero energy
    // must never outrank a real match. Captures include silent tails.
    if (energy <= 1e-12 || variance <= 1e-12 * reference.length) continue;
    const norm = ar[lag + reference.length - 1] / Math.sqrt(energy * variance + 1e-30);
    norms[lag] = norm;
    if (norm > best.norm) best = { lag, norm };
  }
  if (preferLag === undefined || !Number.isFinite(best.norm)) return best;
  let chosen = best;
  for (let lag = 0; lag < lags; lag++) {
    const n = norms[lag];
    if (n < best.norm - TIE) continue;
    if ((lag > 0 && norms[lag - 1] > n) || (lag + 1 < lags && norms[lag + 1] > n)) continue;
    if (Math.abs(lag - preferLag) < Math.abs(chosen.lag - preferLag)) chosen = { lag, norm: n };
  }
  return chosen;
}

function envelope(file, format, rate = RATE) {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error("invalid PCM sample rate");
  const bytes = fs.readFileSync(file);
  const frameBytes = format === "s16" ? 4 : 8;
  const frames = Math.floor(bytes.length / frameBytes);
  const result = new Float32Array(Math.floor(frames / rate * ENVELOPE_RATE));
  let squareSum = 0, samples = 0;
  for (let i = 0; i < result.length; i++) {
    let sum = 0;
    const first = Math.floor(i * rate / ENVELOPE_RATE);
    const end = Math.floor((i + 1) * rate / ENVELOPE_RATE);
    for (let frame = first; frame < end; frame++) {
      const offset = frame * frameBytes;
      const value = format === "s16"
        ? (bytes.readInt16LE(offset) + bytes.readInt16LE(offset + 2)) / 65536
        : (bytes.readFloatLE(offset) + bytes.readFloatLE(offset + 4)) / 2;
      if (!Number.isFinite(value)) throw new Error(`nonfinite PCM in ${file}`);
      sum += Math.abs(value); squareSum += value * value;
      samples++;
    }
    result[i] = sum / (end - first);
  }
  return { values: result, seconds: frames / rate, rms: Math.sqrt(squareSum / samples) };
}

// Runs of exact digital silence (both channels 0) of at least minMs, in
// [fromS, toS) of an s16 48 kHz capture. During a race the engine always
// sounds, so such a run is the output device dropping out: time the game's
// audible clock (frames its callback consumed) never sees.
export function silentRuns(file, fromS, toS, minMs = 5) {
  const bytes = fs.readFileSync(file);
  const frames = Math.floor(bytes.length / 4);
  const first = Math.max(0, Math.floor(fromS * RATE)), last = Math.min(frames, Math.ceil(toS * RATE));
  let run = 0, count = 0, total = 0, longest = 0;
  const runs = [];
  for (let i = first; i <= last; i++) {
    const zero = i < last && bytes.readInt16LE(i * 4) === 0 && bytes.readInt16LE(i * 4 + 2) === 0;
    if (zero) run++;
    else if (run) {
      const ms = run / RATE * 1000;
      if (ms >= minMs) { count++; total += ms; longest = Math.max(longest, ms); runs.push({ at_s: (i - run) / RATE, ms }); }
      run = 0;
    }
  }
  return { min_ms: minMs, count, total_ms: Math.round(total), longest_ms: Math.round(longest), runs };
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

// Each sabotage arm must go RED for its own defect. The signature is read
// from the matched windows: immediate lands a bar early (one bar is 12/7 s
// at 140 BPM), depth runs the simulation a ring ahead of the ear, skew
// makes the error fall by about 10 ms a second between resyncs.
export function armSignature(arm, analysis, clocks) {
  const BAR_MS = 12000 / 7;
  const matched = analysis.rows.filter(r => r.norm >= 0.5 && Number.isFinite(r.error_ms));
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  if (arm === "immediate") {
    const after = matched.filter(r => r.song >= 4 * BAR_MS / 1000).map(r => r.error_ms);
    const m = median(after);
    return { arm, expected: "a bar early: median error within 100 ms of +1714 ms after lap1", median_error_ms: m,
      windows: after.length, matched: m !== null && Math.abs(m - BAR_MS) <= 100 };
  }
  if (arm === "depth") {
    const m = median(matched.map(r => r.error_ms));
    return { arm, expected: "constant offset: median error between -350 and -150 ms", median_error_ms: m,
      windows: matched.length, matched: m !== null && m >= -350 && m <= -150 };
  }
  if (arm === "skew") {
    // Resync executions split the race; fit the error against song time in
    // each resync-free stretch with at least four matched windows.
    const resyncAt = [];
    for (let i = 1; i < clocks.length; i++)
      if (clocks[i].metrics.resyncs !== clocks[i - 1].metrics.resyncs) resyncAt.push(clocks[i].song);
    const edges = [-Infinity, ...resyncAt, Infinity];
    let weighted = 0, total = 0;
    for (let i = 0; i + 1 < edges.length; i++) {
      // Skip the window that straddles a resync and the one after it.
      const seg = matched.filter(r => r.song > edges[i] + 0.9 && r.song + 1.5 < edges[i + 1]);
      if (seg.length < 4) continue;
      const mx = seg.reduce((t, r) => t + r.song, 0) / seg.length, my = seg.reduce((t, r) => t + r.error_ms, 0) / seg.length;
      let num = 0, den = 0;
      for (const r of seg) { num += (r.song - mx) * (r.error_ms - my); den += (r.song - mx) ** 2; }
      if (den > 0) { weighted += (num / den) * seg.length; total += seg.length; }
    }
    const slope = total ? weighted / total : null;
    return { arm, expected: "growing drift: error falls at least 5 ms per second between resyncs (1% is 10)",
      slope_ms_per_s: slope, windows: total, resyncs: resyncAt.length, matched: slope !== null && slope <= -5 };
  }
  return { arm, matched: true };
}

// The capture's verdict, classified by cause:
// - sounding music underruns during the race are a product RED;
// - a device dropout (exact silence where the reference sounds) longer than
//   50 ms, or dropouts totalling more than 250 ms, mean the capture did not
//   play in real time: SETUP-FAILED, re-run. Shorter gaps (a 256-frame
//   PipeWire quantum, 5.3 ms, appears even for a plain pacat tone on a
//   loaded host) are reported only;
// - otherwise the normal arm passes when GREEN, and a sabotage arm passes
//   when RED with its own defect's signature.
export const DROPOUT_LIMITS = { longest_ms: 50, total_ms: 250 };
export function classifyCapture(arm, analysis, signature) {
  const underruns = analysis.music_underruns_total ?? analysis.music_underruns_in_race;
  const d = analysis.device_dropouts;
  const gate = analysis.pass ? "GREEN" : "RED";
  if (!Number.isFinite(underruns))
    return { status: "SETUP-FAILED", gate, reason: "no music underrun counter in the trace" };
  if (underruns > 0)
    return { status: "FAIL", gate, reason: `product RED: ${underruns} sounding music underrun frames since music started` };
  if (d && (d.longest_ms > DROPOUT_LIMITS.longest_ms || d.total_ms > DROPOUT_LIMITS.total_ms))
    return { status: "SETUP-FAILED", gate, reason: `device dropouts ${d.count} / ${d.total_ms} ms (longest ${d.longest_ms} ms) with no game underruns; re-run` };
  if (arm === "normal")
    return { status: analysis.pass ? "PASS" : "FAIL", gate, reason: `normal gate ${gate}` };
  if (analysis.pass) return { status: "FAIL", gate, reason: `${arm} arm GREEN: the gate missed the defect` };
  return signature?.matched
    ? { status: "PASS", gate, reason: `${arm} arm RED for its own defect (${signature.expected})` }
    : { status: "FAIL", gate, reason: `${arm} arm RED but not for its defect (${signature?.expected})` };
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
  const metaPath = path.join(run, "meta.json");
  const referenceRate = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, "utf8")).reference_sample_rate ?? RATE : RATE;
  const ref = envelope(path.join(run, "reference.pcm"), "f32", referenceRate);
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
  // Before the window loop: wallAt only walks forward.
  const raceFrom = wallAt(2);
  const rows = [], halfWindow = 0.75;
  // Acquire once on a long window from the count-in into lap1. The
  // count-in's bars are identical and correlate at 0.99-1.00 one bar
  // apart, so a 1.5 s window there can lock a whole bar off and tracking
  // then follows the alias for the rest of the race. The grid-to-lap1
  // change inside this window makes the alignment unique.
  let trackedOffset = null, acquisition = null;
  {
    const acquireSeconds = 8, acquireWall = raceFrom;
    const refFrom = Math.round(2 * ENVELOPE_RATE), length = Math.round(acquireSeconds * ENVELOPE_RATE);
    if (acquireWall !== null && refFrom + length <= ref.values.length) {
      const expected = (acquireWall - start) / 1000;
      const from = Math.max(0, Math.floor((expected - 4) * ENVELOPE_RATE));
      const to = Math.min(cap.values.length, Math.ceil((expected + acquireSeconds + 4) * ENVELOPE_RATE));
      if (to - from >= length) {
        const peak = correlate(ref.values.subarray(refFrom, refFrom + length), cap.values.subarray(from, to),
          Math.round(expected * ENVELOPE_RATE) - from);
        const heard = start + (from + peak.lag) / ENVELOPE_RATE * 1000;
        acquisition = { song: 2, seconds: acquireSeconds, norm: peak.norm, error_ms: acquireWall - heard };
        if (peak.norm >= 0.5) trackedOffset = (heard - acquireWall) / 1000;
      }
    }
  }
  const end = Math.min(ref.seconds - 2 * halfWindow, clocks.at(-1).song - halfWindow);
  // Tracking alone is blind to a jump of whole beats: the drums make a
  // window a beat or a bar off still correlate above 0.5, and the true lag
  // is outside the 120 ms search, so tracking would follow the alias
  // (shown by shifting a real capture after 25 s by +-1 beat, 2 beats and
  // a bar: all GREEN). Every 8 windows an 8 s window, searched 2 s either
  // side, re-checks the lag. Where the music is distinctive the true lag
  // beats the aliases by a wide margin (0.99 against 0.76 at the count-in);
  // in a beat-periodic stretch (the hold's riser) the true lag and its
  // beat aliases score within 0.05 and no method can tell them apart. So
  // tracking re-locks only when a lag more than 60 ms away scores at least
  // 0.7 and beats the best score within 60 ms of the tracked lag by at least
  // 0.15. (A resync's silence inside the window drops the true lag's score;
  // the aliases that then win score about 0.55.) The long window must lie
  // inside the analyzed race: past it the capture is silence.
  const VERIFY_EVERY = 8, VERIFY_SECONDS = 8, VERIFY_SEARCH = 2, RELOCK_MARGIN = 0.15, RELOCK_FLOOR = 0.7;
  const relocks = [];
  let windowIndex = 0;
  for (let song = 2; song < end; song += 60 / 140) {
    const wall = wallAt(song);
    if (wall === null) continue;
    const expected = (wall - start) / 1000;
    if (trackedOffset !== null && windowIndex++ % VERIFY_EVERY === 0) {
      const vFrom = Math.round(song * ENVELOPE_RATE), vLength = Math.round(VERIFY_SECONDS * ENVELOPE_RATE);
      const c = expected + trackedOffset;
      const from = Math.max(0, Math.floor((c - VERIFY_SEARCH) * ENVELOPE_RATE));
      const to = Math.min(cap.values.length, Math.ceil((c + VERIFY_SECONDS + VERIFY_SEARCH) * ENVELOPE_RATE));
      const nearFrom = Math.max(0, Math.floor((c - 0.06) * ENVELOPE_RATE));
      const nearTo = Math.min(cap.values.length, Math.ceil((c + VERIFY_SECONDS + 0.06) * ENVELOPE_RATE));
      if (song + VERIFY_SECONDS <= end && vFrom + vLength <= ref.values.length && to - from >= vLength && nearTo - nearFrom >= vLength) {
        const window = ref.values.subarray(vFrom, vFrom + vLength);
        const best = correlate(window, cap.values.subarray(from, to));
        const near = correlate(window, cap.values.subarray(nearFrom, nearTo));
        const offset = (start + (from + best.lag) / ENVELOPE_RATE * 1000 - wall) / 1000;
        if (best.norm >= RELOCK_FLOOR && Math.abs(offset - trackedOffset) > 0.06 && best.norm - near.norm >= RELOCK_MARGIN) {
          relocks.push({ song, from_ms: trackedOffset * 1000, to_ms: offset * 1000, norm: best.norm, tracked_norm: near.norm });
          trackedOffset = offset;
        }
      }
    }
    // INTERCEPT follows the last correlated lag after acquisition. A
    // fresh wide search at every beat aliases repeated musical phrases.
    // Tracking changes the search, never the absolute error or verdict.
    // Between windows (0.43 s) the true lag moves at most about 90 ms: a
    // resync jumps up to its 60 ms threshold plus half a row (27 ms). A
    // wider search let tracking step onto a weaker peak in a window that
    // straddles a resync, then walk on by half-beat aliases (214 ms).
    const searchSeconds = trackedOffset === null ? 4.0 : 0.12;
    const center = expected + (trackedOffset ?? 0);
    const from = Math.max(0, Math.floor((center - searchSeconds) * ENVELOPE_RATE));
    const to = Math.min(cap.values.length, Math.ceil((center + 2 * halfWindow + searchSeconds) * ENVELOPE_RATE));
    const refFrom = Math.round(song * ENVELOPE_RATE), length = Math.round(2 * halfWindow * ENVELOPE_RATE);
    if (to - from < length) { rows.push({ song, norm: 0, reason: "capture too short" }); continue; }
    // Among equally good peaks, prefer the lag already being tracked (or
    // the nominal one before acquisition). Beat and half-beat aliases of
    // the drums score within a few hundredths of the true lag; without
    // this, tracking walked one half-beat (214 ms) at a time onto them.
    const acquiring = trackedOffset === null;
    const preferred = Math.round(center * ENVELOPE_RATE) - from;
    const peak = correlate(ref.values.subarray(refFrom, refFrom + length), cap.values.subarray(from, to), preferred);
    const heard = start + (from + peak.lag) / ENVELOPE_RATE * 1000;
    rows.push({ song, norm: peak.norm, error_ms: wall - heard, heard_ms: heard, ...(acquiring ? { acquired: true } : {}) });
    if (peak.norm >= 0.5) trackedOffset = (heard - wall) / 1000;
  }
  const good = rows.filter(r => r.norm >= 0.5 && Number.isFinite(r.error_ms));
  const verdict = assess(good.map(r => r.error_ms), good.length / rows.length);
  const costs = clocks.map(c => +c.metrics["music-ms"]).filter(Number.isFinite);
  // Diagnostic only; the verdict above does not read it.
  const raceTo = clocks.at(-1).wall;
  const silent = raceFrom === null ? null
    : silentRuns(path.join(run, "capture.pcm"), (raceFrom - start) / 1000, (raceTo - start) / 1000);
  // A silent run counts as a device dropout only where the aligned
  // reference sounds: a music-only capture has real rests. Alignment comes
  // from the nearest matched window.
  const matched = rows.filter(r => r.norm >= 0.5 && Number.isFinite(r.heard_ms));
  function songAtCapture(seconds) {
    const ms = start + seconds * 1000;
    let best = null;
    for (const m of matched) if (!best || Math.abs(m.heard_ms - ms) < Math.abs(best.heard_ms - ms)) best = m;
    return best ? best.song + (ms - best.heard_ms) / 1000 : null;
  }
  function referenceLevel(song, seconds) {
    const a = Math.max(0, Math.floor(song * ENVELOPE_RATE)), b = Math.min(ref.values.length, Math.ceil((song + seconds) * ENVELOPE_RATE));
    let sum = 0; for (let i = a; i < b; i++) sum += ref.values[i];
    return b > a ? sum / (b - a) : 0;
  }
  // A resync cuts every sounding note, and a held part stays silent until
  // its next note: silence heard within a second of a resync (the ring's
  // 250 ms plus latency, then the gap) is the product's own resync, not a
  // device fault. Reported apart from dropouts.
  const resyncWalls = [];
  for (let i = 1; i < clocks.length; i++)
    if (clocks[i].metrics.resyncs !== clocks[i - 1].metrics.resyncs) resyncWalls.push(clocks[i].wall);
  // Heard a ring's depth plus latency after the resync frame (229-316 ms
  // measured): only silence starting 100-700 ms after a resync frame counts.
  const afterResync = r => { const w = start + r.at_s * 1000; return resyncWalls.some(x => w - x >= 100 && w - x <= 700); };
  const sounding = (silent?.runs ?? []).filter(r => {
    const song = songAtCapture(r.at_s);
    return song !== null && referenceLevel(song, r.ms / 1000) > 0.005;
  });
  const resyncSilences = sounding.filter(afterResync);
  const dropped = sounding.filter(r => !afterResync(r));
  const tenth = x => Math.round(x * 10) / 10;
  const dropouts = silent === null ? null : { min_ms: silent.min_ms, silent_runs: silent.count, silent_ms: silent.total_ms,
    count: dropped.length, total_ms: tenth(dropped.reduce((t, r) => t + r.ms, 0)),
    longest_ms: tenth(Math.max(0, ...dropped.map(r => r.ms))), first_at_capture_s: dropped.slice(0, 5).map(r => +r.at_s.toFixed(3)),
    resync_silences: { count: resyncSilences.length, total_ms: Math.round(resyncSilences.reduce((t, r) => t + r.ms, 0)),
      longest_ms: Math.round(Math.max(0, ...resyncSilences.map(r => r.ms))) } };
  // The game's own sounding-underrun counter over the analyzed race.
  const raceClocks = clocks.filter(c => c.song >= 2);
  const underrunCount = c => Number(c?.metrics["music-underruns"]);
  const musicUnderruns = raceClocks.length ? underrunCount(raceClocks.at(-1)) - underrunCount(raceClocks[0]) : null;
  // Since music started: the counter keeps closed streams' counts, so this
  // includes the title (a startup stall drains the ring before the race).
  const musicUnderrunsTotal = clocks.length ? underrunCount(clocks.at(-1)) : null;
  return { ...verdict, windows: rows.length, correlated: good.length, capture_rms: cap.rms,
    reference_sample_rate: referenceRate, reference_rms: ref.rms,
    correlation_search: "8 s acquisition from song 2 (count-in into lap1), then 120 ms around the last correlated lag; among peaks within 0.05 of the best, the one nearest the tracked (or nominal) lag",
    acquisition,
    capture_start_ms: start, capture_clock_spread_ms: Math.max(...bounds) - start,
    device_dropouts: dropouts, music_underruns_in_race: musicUnderruns, music_underruns_total: musicUnderrunsTotal,
    relocks,
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
