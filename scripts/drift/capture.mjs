// One actual native autopilot race, on a private headless X server and
// verified worker-null. No runner, speaker, Python or hosting is used.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { analyze, armSignature, classifyCapture, parseTrace } from "./analyze.mjs";
import { cachedTool, localProcesses, privateDisplay, sleep } from "./native.mjs";

const ROOT = path.resolve(process.env.CONDUCTOR_ROOT || process.cwd());
const RUN = path.resolve(process.argv[2]);
const ARM = process.argv[3] || "normal";
if (!["normal", "depth", "immediate", "skew"].includes(ARM)) throw new Error("invalid capture arm");
const GL_THREADS = process.env.CONDUCTOR_GL_THREADS || "1";
if (!["1", "2"].includes(GL_THREADS)) throw new Error("at most two software-rendering threads");
const HEADLESS = process.env.CONDUCTOR_HEADLESS === "1";
const GC_PROFILE = process.env.CONDUCTOR_GC_PROFILE === "1";
// The gate judges the music alone (sfx=0: engine silent, no one-shots, the
// synth still rendering): the conductor clocks only the music, and the
// engine and one-shots in a full mix only mask the correlation.
// CONDUCTOR_MIX=full captures the full mix as a reported companion,
// never a verdict.
const MIX = process.env.CONDUCTOR_MIX === "full" ? "full" : "music";
const MUSIC_ONLY = MIX === "music";
// The capture sink must be a null sink with no loopback to any device,
// used by nothing else during the run (worker-null is shared by sessions).
const SINK = process.env.CONDUCTOR_SINK || "worker-null";
// A failure of the game itself (a crash, a hang, a stream that goes away, a
// race that misses sections): a product FAIL, never re-run as a setup fault.
class ProductError extends Error {}

// PulseAudio reports a stream that is not linked to any sink yet with
// PA_INVALID_INDEX. While it is also corked it plays nowhere: wait for the
// link (at most 2 s) rather than treat it as a stray route.
const UNLINKED = 4294967295;
const unlinkedSince = new Map();
function unlinked(input) {
  if (Number(input.sink) !== UNLINKED || input.corked !== true) { unlinkedSince.delete(input.index); return false; }
  if (!unlinkedSince.has(input.index)) unlinkedSince.set(input.index, Date.now());
  if (Date.now() - unlinkedSince.get(input.index) > 2000) throw new Error(`stream ${input.index} not linked to any sink after 2 s`);
  return true;
}
const BIN = path.resolve(process.env.CONDUCTOR_BINARY || path.join(ROOT, "build/release/bin/signal-overdrive"));
if (!fs.existsSync(BIN)) throw new Error("no release binary");
fs.mkdirSync(RUN, { recursive: true });
const pool = localProcesses(ROOT);
const { cpu, children, launch, stop } = pool;
const pulse = args => execFileSync("pactl", args, { encoding: "utf8", timeout: 5000 });
let logFD, capFD, clockFD, gameText = "", captureBytes = 0;
let game, capture, xserver, reference;
const timeout = setTimeout(() => { for (const child of children) stop(child, "SIGKILL"); }, 600000);
try {
  const sinks = pulse(["list", "short", "sinks"]).split("\n").map(line => line.split(/\s+/));
  const nullSink = sinks.find(fields => fields[1] === SINK);
  const sinkName = index => sinks.find(fields => fields[0] === String(index))?.[1] ?? "unknown";
  if (!nullSink) throw new Error(`${SINK} is absent; refusing to initialize audio`);
  if (!pulse(["list", "short", "sources"]).split("\n").some(line => line.split(/\s+/)[1] === `${SINK}.monitor`))
    throw new Error(`${SINK} monitor is absent`);
  // Anything else playing into the capture sink would be mixed into the
  // capture: refuse to start, and abort if it appears mid-run.
  // A stream is the game's when its PID is the launched game or one of its
  // descendants (another copy of the same binary is not ours). A stream
  // with no readable PID is never ours.
  function owned(pid) {
    if (!game || !pid) return false;
    for (let i = 0; i < 32 && pid > 1; i++) {
      if (pid === game.pid) return true;
      try { pid = Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s*(\d+)/m)[1]); }
      catch { return false; }
    }
    return false;
  }
  const isOurs = input => owned(Number(input.properties?.["application.process.id"]));
  function foreignOnSink(inputs) {
    return inputs.filter(input => String(input.sink) === nullSink[0] && !isOurs(input))
      .map(input => `${input.properties?.["application.name"] ?? "?"} pid ${input.properties?.["application.process.id"] ?? "?"}`);
  }
  const foreignAtStart = foreignOnSink(JSON.parse(pulse(["-f", "json", "list", "sink-inputs"])));
  if (foreignAtStart.length) throw new Error(`${SINK} is in use by another client (${foreignAtStart.join(", ")}); refusing a mixed capture`);
  const privateX = HEADLESS ? { display: "", child: null } : await privateDisplay(pool, RUN);
  xserver = privateX.child;
  const env = { ...process.env, DISPLAY: privateX.display, SIGIL_APP_PLATFORM: "x11",
    SIGIL_AUDIO_BACKEND: "pulseaudio", SIGIL_AUDIO_VERBOSE: "1", PULSE_SINK: SINK,
    PIPEWIRE_NODE: SINK, XDG_DATA_HOME: path.join(RUN, "xdg"),
    LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: GL_THREADS, GALLIUM_DRIVER: "llvmpipe" };
  delete env.WAYLAND_DISPLAY;
  if (GC_PROFILE) env.SIGIL_GC_STATS_FILE = path.join(RUN, "game-gc.jsonl");
  const store = path.join(env.XDG_DATA_HOME, "signal-overdrive");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "scale.sgl"), "2\n");
  logFD = fs.openSync(path.join(RUN, "game.log"), "w");
  capFD = fs.openSync(path.join(RUN, "capture.pcm"), "w");
  clockFD = fs.openSync(path.join(RUN, "capclock.txt"), "w");
  capture = launch("parec", [`--device=${SINK}.monitor`, "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=10", "--raw"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  capture.stdout.on("data", bytes => {
    fs.writeSync(capFD, bytes); captureBytes += bytes.length;
    fs.writeSync(clockFD, `${Date.now()} ${captureBytes}\n`);
  });
  capture.stderr.on("data", bytes => fs.appendFileSync(path.join(RUN, "parec.log"), bytes));
  await sleep(300);
  if (capture.exitCode !== null) throw new Error("parec failed to open the verified monitor");
  // --damage=0: the gate measures timing; its reference is the clean song,
  // and an ICE strike's dropout would read as a device dropout
  game = launch(path.join(ROOT, "scripts/dev"), [BIN, "--start", "--autopilot", "--track=loop", "--musiclog", "--damage=0",
    ...(HEADLESS ? ["--music-headless"] : []),
    ...(MUSIC_ONLY ? ["--sfx=0"] : []),
    `--music-sabotage=${ARM === "normal" ? "none" : ARM}`, "--quit-after", "400"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  function gameOutput(bytes) { fs.writeSync(logFD, bytes); gameText += bytes; }
  game.stdout.on("data", gameOutput); game.stderr.on("data", gameOutput);
  let verifiedPID = null;
  // "ok", "pending" (corked and not yet linked) or "absent".
  function verifyRoute() {
    const inputs = JSON.parse(pulse(["-f", "json", "list", "sink-inputs"]));
    const ours = inputs.filter(isOurs);
    const foreign = foreignOnSink(inputs);
    if (foreign.length) throw new Error(`another client began playing into ${SINK} (${foreign.join(", ")}); capture is mixed`);
    if (!ours.length) return "absent";
    // Every observation, from the stream's first appearance on.
    for (const input of ours) fs.appendFileSync(path.join(RUN, "routing.jsonl"), JSON.stringify({ wall_ms: Date.now(),
      index: input.index, sink: input.sink, sink_name: sinkName(input.sink), corked: input.corked ?? null }) + "\n");
    if (ours.some(unlinked)) return "pending";
    const stray = ours.find(input => String(input.sink) !== nullSink[0]);
    if (stray) throw new Error(`game stream ${stray.index} on sink ${stray.sink} (${sinkName(stray.sink)}), not ${SINK}`);
    verifiedPID = ours[0].properties["application.process.id"];
    fs.writeFileSync(path.join(RUN, "routing.json"), JSON.stringify(ours.map(input => ({ index: input.index, sink: input.sink, pid: input.properties["application.process.id"] })), null, 2));
    return "ok";
  }
  // Poll fast until the stream appears: a stray route is killed within
  // about one poll plus a pactl call.
  for (let i = 0; i < 1000 && verifyRoute() !== "ok"; i++) {
    if (game.exitCode !== null) throw new ProductError("game exited before opening its Pulse stream");
    await sleep(10);
  }
  if (!verifiedPID) throw new Error(`no verified game stream on ${SINK}`);
  if (!HEADLESS) {
    const xdotool = cachedTool("xdotool", "xdotool");
    let windowID;
    for (let i = 0; i < 300 && !windowID; i++) {
      try { windowID = execFileSync(xdotool, ["search", "--onlyvisible", "--name", "^Signal Overdrive$"], { env, encoding: "utf8", timeout: 2000 }).trim().split("\n")[0]; }
      catch { /* graphics still starting */ }
      if (!windowID) await sleep(100);
    }
    if (!windowID) throw new Error("no private headless game window");
    execFileSync(xdotool, ["windowfocus", "--sync", windowID], { env, timeout: 5000 });
  }
  fs.writeFileSync(path.join(RUN, "meta.json"), JSON.stringify({ arm: ARM, binary: BIN, display: env.DISPLAY,
    game_pid: verifiedPID, null_sink: nullSink[0], sink_name: SINK, cpu, niceness: pool.niceness, headless_race: HEADLESS, music_only: MUSIC_ONLY, gc_profile: GC_PROFILE,
    gc_young_threshold_kb: process.env.SIGIL_YOUNG_THRESHOLD || "default",
    gc_young_threshold_max_kb: process.env.SIGIL_YOUNG_THRESHOLD_MAX || "default",
    software_rendering_threads: HEADLESS ? 0 : GL_THREADS,
    load_start: os.loadavg(), commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() }, null, 2));
  // Own-process counters separate CPU execution from run-queue delay.
  // schedstat uses nanoseconds and does not depend on a clock-tick rate.
  const scheduling = [];
  function sampleScheduling() {
    try {
      const [run, wait, slices] = fs.readFileSync(`/proc/${verifiedPID}/schedstat`, "utf8")
        .trim().split(/\s+/).map(Number);
      const sample = { wall_ms: Date.now(), run_ns: run, wait_ns: wait, slices };
      scheduling.push(sample);
      fs.appendFileSync(path.join(RUN, "scheduling.jsonl"), JSON.stringify(sample) + "\n");
    } catch { /* the owned game may have exited between checkpoints */ }
  }
  sampleScheduling();
  let complete = false;
  for (let i = 0; i < 400; i++) {
    await sleep(1000);
    sampleScheduling();
    if (verifyRoute() === "absent") throw new ProductError("game Pulse stream disappeared");
    const trace = parseTrace(gameText), final = trace.jumps.find(jump => jump.mark === "results");
    if (final && trace.clocks.at(-1)?.song > final.bar * 12 / 7 + 4) { complete = true; break; }
    if (game.exitCode !== null) break;
  }
  if (!complete) throw new ProductError(game.exitCode !== null ? `game exited (${game.exitCode}) before the race and coda completed` : "full intended race/coda did not complete");
  stop(game); await sleep(1000); stop(game, "SIGKILL");
  await sleep(300); stop(capture); await sleep(100); stop(capture, "SIGKILL");
  const trace = parseTrace(gameText);
  fs.writeFileSync(path.join(RUN, "intended.sgv"), `(${trace.jumps.map(jump => `#(${jump.tick} ${jump.bar} ${jump.mark})`).join("\n ")})\n`);
  const deviceRate = gameText.match(/sigil-audio: backend=.* format=\S+ channels=\d+ rate=(\d+)/)?.[1];
  if (!deviceRate) throw new Error("no actual native device sample rate in trace");
  const referenceRate = Number(deviceRate);
  const metaPath = path.join(RUN, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.reference_sample_rate = referenceRate;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  const frames = Math.ceil((trace.clocks.at(-1).song + 2) * referenceRate);
  const renderLog = fs.openSync(path.join(RUN, "reference.log"), "w");
  reference = launch(path.join(ROOT, "scripts/dev"), [BIN, "--music-reference", path.join(RUN, "intended.sgv"), path.join(RUN, "reference.pcm"), String(frames), String(referenceRate)],
    { env: { ...env, SIGIL_AUDIO_BACKEND: "null",
      ...(GC_PROFILE ? { SIGIL_GC_STATS_FILE: path.join(RUN, "reference-gc.jsonl") } : {}) },
      stdio: ["ignore", renderLog, renderLog] });
  fs.closeSync(renderLog);
  const code = await new Promise((resolve, reject) => { reference.once("exit", resolve); reference.once("error", reject); });
  if (code !== 0) throw new ProductError(`offline reference failed (${code})`);
  let result;
  try { result = analyze(RUN); }
  catch (error) {
    // A trace that misses sections is the game's; other analysis errors
    // (no capture clock, unreadable PCM) are the capture's.
    if (/missing grid race trace|did not visit every intended section/.test(error.message)) throw new ProductError(error.message);
    throw error;
  }
  if (scheduling.length > 1) {
    const first = scheduling[0], last = scheduling.at(-1);
    result.process_timing = {
      elapsed_ms: last.wall_ms - first.wall_ms,
      main_thread_cpu_ms: (last.run_ns - first.run_ns) / 1e6,
      run_queue_wait_ms: (last.wait_ns - first.wait_ns) / 1e6,
      time_slices: last.slices - first.slices,
      samples: scheduling.length,
    };
  }
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(result, null, 2) + "\n");
  const verdictClocks = trace.clocks.filter(c => c.audio !== null);
  const signature = ARM === "normal" ? null : armSignature(ARM, result, verdictClocks);
  const verdict = classifyCapture(ARM, result, signature);
  const report = { ...result, mix: MIX, arm: ARM, signature, verdict };
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(report, null, 2) + "\n");
  const timing = `p95 ${result.p95_ms?.toFixed(1)} ms, worst ${result.worst_ms?.toFixed(1)} ms, coverage ${(100 * result.coverage).toFixed(1)}%`;
  let line;
  if (MIX === "full") line = `RESULT: REPORT — full-mix companion (not a verdict), ${ARM}: ${timing}; ${verdict.reason}`;
  else line = `RESULT: ${verdict.status} — ${ARM}: ${verdict.reason}; ${timing}`;
  fs.writeFileSync(path.join(RUN, "RESULT"), line + "\n");
  console.log(JSON.stringify({ ...report, rows: undefined }));
  process.exitCode = MIX === "full" ? 0 : verdict.status === "PASS" ? 0 : verdict.status === "SETUP-FAILED" ? 125 : 1;
} catch (error) {
  const status = error instanceof ProductError ? "FAIL" : "SETUP-FAILED";
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: ${status} — ${status === "FAIL" ? "product: " : ""}${error.message}\n`);
  console.error(`${status}: ${error.message}`); process.exitCode = status === "FAIL" ? 1 : 125;
} finally {
  clearTimeout(timeout);
  pool.cleanup();
  for (const fd of [logFD, capFD, clockFD]) if (fd !== undefined) fs.closeSync(fd);
}
