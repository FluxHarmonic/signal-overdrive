// The standard native race check: one full graphical autopilot race on a
// private Xvfb with software GL, the game's audio forced to the verified
// worker-null sink. PASS needs every intended section, music sounding
// throughout, zero sounding music underruns and a clean Escape exit.
// It never uses the desktop's display or speakers and starts no host.
//
//   node scripts/drift/native-race.mjs RUNDIR
//
// RUNDIR must not exist. CONDUCTOR_BINARY, CONDUCTOR_CPU_LIST,
// CONDUCTOR_NICE and CONDUCTOR_GC_PROFILE=1 behave as in capture.mjs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { localProcesses, privateDisplay, cachedTool, sleep } from "./native.mjs";
import { parseTrace } from "./analyze.mjs";

// Clear the inherited desktop before launching any helper. Only the
// private Xvfb display is given to the game and xdotool below.
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;
process.env.XDG_SESSION_TYPE = "x11";

const ROOT = path.resolve(process.env.CONDUCTOR_ROOT || process.cwd());
const RUN = path.resolve(process.argv[2]);
const BIN = path.resolve(process.env.CONDUCTOR_BINARY || path.join(ROOT, "build/release/bin/signal-overdrive"));
const GC_PROFILE = process.env.CONDUCTOR_GC_PROFILE === "1";
// A null sink with no loopback, used by nothing else during the run.
const SINK = process.env.CONDUCTOR_SINK || "worker-null";
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
if (fs.existsSync(RUN)) throw new Error("the check requires a fresh evidence directory");
if (!fs.existsSync(BIN)) throw new Error("no release binary");
fs.mkdirSync(RUN, { recursive: true });
const pool = localProcesses(ROOT);
const pulse = args => execFileSync("pactl", args, { encoding: "utf8", timeout: 5000 });
let game, text = "", fd, monitor, samples = 0, energy = 0, window;
const limit = setTimeout(() => pool.cleanup(), 600000);

// A sink input belongs to the game when its PID is the game or a descendant.
function owned(pid) {
  for (let i = 0; i < 32 && pid > 1; i++) {
    if (pid === game.pid) return true;
    try { pid = Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s*(\d+)/m)[1]); }
    catch { return false; }
  }
  return false;
}

try {
  const sinks = pulse(["list", "short", "sinks"]).split("\n").map(l => l.split(/\s+/));
  const sink = sinks.find(f => f[1] === SINK);
  const sinkName = index => sinks.find(f => f[0] === String(index))?.[1] ?? "unknown";
  if (!sink) throw new Error(`${SINK} absent; refusing audio`);
  const others = JSON.parse(pulse(["-f", "json", "list", "sink-inputs"])).filter(i => String(i.sink) === sink[0]);
  if (others.length) throw new Error(`${SINK} is in use by another client; refusing`);
  const display = await privateDisplay(pool, RUN);
  const env = { ...process.env, DISPLAY: display.display, XDG_SESSION_TYPE: "x11", SIGIL_APP_PLATFORM: "x11",
    SIGIL_AUDIO_BACKEND: "pulseaudio", SIGIL_AUDIO_VERBOSE: "1", PULSE_SINK: SINK, PIPEWIRE_NODE: SINK,
    XDG_DATA_HOME: path.join(RUN, "xdg"), LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "1", GALLIUM_DRIVER: "llvmpipe" };
  delete env.WAYLAND_DISPLAY;
  if (GC_PROFILE) env.SIGIL_GC_STATS_FILE = path.join(RUN, "game-gc.jsonl");
  fs.mkdirSync(path.join(env.XDG_DATA_HOME, "signal-overdrive"), { recursive: true });
  fs.writeFileSync(path.join(env.XDG_DATA_HOME, "signal-overdrive/scale.sgl"), "2\n");
  monitor = pool.launch("parec", [`--device=${SINK}.monitor`, "--format=s16le", "--rate=48000", "--channels=2", "--raw"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  monitor.stdout.on("data", bytes => {
    for (let i = 0; i + 1 < bytes.length; i += 2) { const x = bytes.readInt16LE(i) / 32768; energy += x * x; samples++; }
  });
  monitor.stderr.on("data", b => fs.appendFileSync(path.join(RUN, "monitor.log"), b));
  await sleep(300);
  if (monitor.exitCode !== null) throw new Error(`${SINK} monitor failed`);
  fd = fs.openSync(path.join(RUN, "game.log"), "w");
  game = pool.launch(path.join(ROOT, "scripts/dev"), [BIN, "--start", "--autopilot", "--track=loop", "--musiclog", "--quit-after", "400"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  // Each output chunk with the wall time it arrived, to date startup steps.
  const timeline = fs.openSync(path.join(RUN, "output-timeline.jsonl"), "w");
  const output = b => {
    text += b; fs.writeSync(fd, b);
    fs.writeSync(timeline, JSON.stringify({ wall_ms: Date.now(), text: b.toString().slice(0, 400) }) + "\n");
  };
  game.stdout.on("data", output); game.stderr.on("data", output);
  function route() {
    const inputs = JSON.parse(pulse(["-f", "json", "list", "sink-inputs"]))
      .filter(i => owned(Number(i.properties?.["application.process.id"])));
    if (!inputs.length) return "absent";
    for (const i of inputs) fs.appendFileSync(path.join(RUN, "routing.jsonl"), JSON.stringify({ wall_ms: Date.now(),
      index: i.index, sink: i.sink, sink_name: sinkName(i.sink), corked: i.corked ?? null }) + "\n");
    if (inputs.some(unlinked)) return "pending";
    const stray = inputs.find(i => String(i.sink) !== sink[0]);
    if (stray) throw new Error(`owned stream ${stray.index} on sink ${stray.sink} (${sinkName(stray.sink)}), not ${SINK}`);
    fs.writeFileSync(path.join(RUN, "routing.json"), JSON.stringify(inputs.map(i =>
      ({ index: i.index, sink: i.sink, pid: i.properties["application.process.id"] })), null, 2));
    return "ok";
  }
  let routed = false;
  for (let i = 0; i < 1000 && !(routed = route() === "ok"); i++) {
    if (game.exitCode !== null) throw new Error("game exited before audio");
    await sleep(10);
  }
  if (!routed) throw new Error("no verified owned stream");
  const xdotool = cachedTool("xdotool", "xdotool");
  for (let i = 0; i < 300 && !window; i++) {
    try { window = execFileSync(xdotool, ["search", "--onlyvisible", "--name", "^Signal Overdrive$"], { env, encoding: "utf8", timeout: 2000 }).trim().split("\n")[0]; }
    catch { /* the private window is still opening */ }
    if (!window) await sleep(100);
  }
  if (!window) throw new Error("no private native window");
  execFileSync(xdotool, ["windowfocus", "--sync", window], { env, timeout: 5000 });
  fs.writeFileSync(path.join(RUN, "launch.json"), JSON.stringify({ root: ROOT, binary: BIN,
    binary_sha256: execFileSync("sha256sum", [BIN], { encoding: "utf8" }).split(/\s+/)[0],
    cpu: pool.cpu, nice: pool.niceness, display: display.display, scale: 2, software_rendering_threads: 1,
    gc_profile: GC_PROFILE, sink: sink[0], load: os.loadavg() }, null, 2));
  let complete = false;
  for (let i = 0; i < 400; i++) {
    await sleep(1000);
    if (game.exitCode !== null) throw new Error("game exited before race completed");
    if (route() === "absent") throw new Error("owned music stream disappeared");
    const trace = parseTrace(text), last = trace.clocks.at(-1), results = trace.jumps.find(j => j.mark === "results");
    if (results && last?.phase === "finished" && last.song > results.bar * 12 / 7 + 4) { complete = true; break; }
  }
  if (!complete) throw new Error("full race/coda timeout");
  execFileSync(xdotool, ["key", "--window", window, "Escape"], { env, timeout: 5000 });
  for (let i = 0; i < 100 && game.exitCode === null; i++) await sleep(100);
  if (game.exitCode !== 0) throw new Error(`native clean shutdown failed: ${game.exitCode}`);
  const trace = parseTrace(text);
  const required = ["grid", "lap1", "lap2", "hold", "fill", "traced", "uplink", "results"];
  if (required.some(mark => !trace.jumps.some(j => j.mark === mark))) throw new Error("missing intended section");
  if (!trace.clocks.length || trace.clocks.some(c => c.metrics.music !== "on" || !Number.isFinite(Number(c.metrics["music-underruns"]))) ||
      trace.clocks.at(-1).audio === null || !trace.clocks.some(c => c.phase === "race" && c.audio !== null))
    throw new Error("music not sounding throughout race");
  // Where each underrun increment happened, so a failure names its frame.
  const increments = [];
  let previous = 0;
  for (const c of trace.clocks) {
    const n = Number(c.metrics["music-underruns"]);
    if (n !== previous) { increments.push({ wall: c.wall, song: c.song, phase: c.phase, frames: n - previous }); previous = n; }
  }
  const underruns = Math.max(...trace.clocks.map(c => Number(c.metrics["music-underruns"])));
  const rms = Math.sqrt(energy / samples);
  const evidence = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    cpu: pool.cpu, nice: pool.niceness, display: display.display, sink: sink[0], marks: trace.jumps,
    clocks: trace.clocks.length, underruns, underrun_increments: increments, rms, exit: game.exitCode,
    resyncs: Number(trace.clocks.at(-1).metrics.resyncs), dropped_ms: Number(trace.clocks.at(-1).metrics["dropped-ms"]) };
  fs.writeFileSync(path.join(RUN, "verification.json"), JSON.stringify(evidence, null, 2));
  if (underruns !== 0) throw new Error(`sounding underruns: ${underruns}`);
  if (!(rms > 1e-4)) throw new Error(`silent actual ${SINK} monitor`);
  fs.writeFileSync(path.join(RUN, "RESULT"), "RESULT: PASS (native graphical full race/music, zero sounding underruns, clean exit)\n");
} catch (error) {
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: FAIL (native race verification: ${error.message})\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(limit); pool.cleanup(); if (fd !== undefined) fs.closeSync(fd);
  console.log(fs.readFileSync(path.join(RUN, "RESULT"), "utf8").trim());
}
