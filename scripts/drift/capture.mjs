// One actual native autopilot race, on a private headless X server and
// verified worker-null. No runner, speaker, Python or hosting is used.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { analyze, parseTrace } from "./analyze.mjs";
import { cachedTool, localProcesses, privateDisplay, sleep } from "./native.mjs";

const ROOT = path.resolve(process.env.CONDUCTOR_ROOT || process.cwd());
const RUN = path.resolve(process.argv[2]);
const ARM = process.argv[3] || "normal";
if (!["normal", "depth", "immediate", "skew"].includes(ARM)) throw new Error("invalid capture arm");
const GL_THREADS = process.env.CONDUCTOR_GL_THREADS || "1";
if (!["1", "2"].includes(GL_THREADS)) throw new Error("at most two software-rendering threads");
const HEADLESS = process.env.CONDUCTOR_HEADLESS === "1";
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
  const nullSink = pulse(["list", "short", "sinks"]).split("\n").map(line => line.split(/\s+/))
    .find(fields => fields[1] === "worker-null");
  if (!nullSink) throw new Error("worker-null is absent; refusing to initialize audio");
  if (!pulse(["list", "short", "sources"]).split("\n").some(line => line.split(/\s+/)[1] === "worker-null.monitor"))
    throw new Error("worker-null monitor is absent");
  const privateX = HEADLESS ? { display: "", child: null } : await privateDisplay(pool, RUN);
  xserver = privateX.child;
  const env = { ...process.env, DISPLAY: privateX.display, SIGIL_APP_PLATFORM: "x11",
    SIGIL_AUDIO_BACKEND: "pulseaudio", SIGIL_AUDIO_VERBOSE: "1", PULSE_SINK: "worker-null",
    PIPEWIRE_NODE: "worker-null", XDG_DATA_HOME: path.join(RUN, "xdg"),
    LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: GL_THREADS, GALLIUM_DRIVER: "llvmpipe" };
  delete env.WAYLAND_DISPLAY;
  const store = path.join(env.XDG_DATA_HOME, "signal-overdrive");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "scale.sgl"), "2\n");
  logFD = fs.openSync(path.join(RUN, "game.log"), "w");
  capFD = fs.openSync(path.join(RUN, "capture.pcm"), "w");
  clockFD = fs.openSync(path.join(RUN, "capclock.txt"), "w");
  capture = launch("parec", ["--device=worker-null.monitor", "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=10", "--raw"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  capture.stdout.on("data", bytes => {
    fs.writeSync(capFD, bytes); captureBytes += bytes.length;
    fs.writeSync(clockFD, `${Date.now()} ${captureBytes}\n`);
  });
  capture.stderr.on("data", bytes => fs.appendFileSync(path.join(RUN, "parec.log"), bytes));
  await sleep(300);
  if (capture.exitCode !== null) throw new Error("parec failed to open the verified monitor");
  game = launch(path.join(ROOT, "scripts/dev"), [BIN, "--start", "--autopilot", "--track=loop", "--musiclog",
    ...(HEADLESS ? ["--music-headless"] : []),
    `--music-sabotage=${ARM === "normal" ? "none" : ARM}`, "--quit-after", "400"],
    { env, stdio: ["ignore", "pipe", "pipe"] });
  function gameOutput(bytes) { fs.writeSync(logFD, bytes); gameText += bytes; }
  game.stdout.on("data", gameOutput); game.stderr.on("data", gameOutput);
  let verifiedPID = null;
  function verifyRoute() {
    const inputs = JSON.parse(pulse(["-f", "json", "list", "sink-inputs"]));
    const ours = inputs.filter(input => {
      const pid = input.properties?.["application.process.id"];
      if (!pid) return false;
      try { return fs.realpathSync(`/proc/${pid}/exe`) === fs.realpathSync(BIN); } catch { return false; }
    });
    if (!ours.length) return false;
    if (ours.some(input => String(input.sink) !== nullSink[0])) throw new Error("game stream escaped worker-null");
    verifiedPID = ours[0].properties["application.process.id"];
    fs.writeFileSync(path.join(RUN, "routing.json"), JSON.stringify(ours.map(input => ({ index: input.index, sink: input.sink, pid: input.properties["application.process.id"] })), null, 2));
    return true;
  }
  for (let i = 0; i < 200 && !verifyRoute(); i++) {
    if (game.exitCode !== null) throw new Error("game exited before opening its Pulse stream");
    await sleep(50);
  }
  if (!verifiedPID) throw new Error("no verified game stream on worker-null");
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
    game_pid: verifiedPID, null_sink: nullSink[0], cpu, headless_race: HEADLESS,
    software_rendering_threads: HEADLESS ? 0 : GL_THREADS,
    load_start: os.loadavg(), commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() }, null, 2));
  let complete = false;
  for (let i = 0; i < 400; i++) {
    await sleep(1000);
    if (i % 2 === 0 && !verifyRoute()) throw new Error("game Pulse stream disappeared");
    const trace = parseTrace(gameText), final = trace.jumps.find(jump => jump.mark === "results");
    if (final && trace.clocks.at(-1)?.song > final.bar * 12 / 7 + 4) { complete = true; break; }
    if (game.exitCode !== null) break;
  }
  if (!complete) throw new Error("full intended race/coda did not complete");
  stop(game); await sleep(1000); stop(game, "SIGKILL");
  await sleep(300); stop(capture); await sleep(100); stop(capture, "SIGKILL");
  const trace = parseTrace(gameText);
  fs.writeFileSync(path.join(RUN, "intended.sgv"), `(${trace.jumps.map(jump => `#(${jump.tick} ${jump.bar} ${jump.mark})`).join("\n ")})\n`);
  const frames = Math.ceil((trace.clocks.at(-1).song + 2) * 48000);
  const renderLog = fs.openSync(path.join(RUN, "reference.log"), "w");
  reference = launch(path.join(ROOT, "scripts/dev"), [BIN, "--music-reference", path.join(RUN, "intended.sgv"), path.join(RUN, "reference.pcm"), String(frames)],
    { env: { ...env, SIGIL_AUDIO_BACKEND: "null" }, stdio: ["ignore", renderLog, renderLog] });
  fs.closeSync(renderLog);
  const code = await new Promise((resolve, reject) => { reference.once("exit", resolve); reference.once("error", reject); });
  if (code !== 0) throw new Error(`offline reference failed (${code})`);
  const result = analyze(RUN);
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(result, null, 2) + "\n");
  const expected = ARM === "normal" ? result.pass : !result.pass;
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: ${expected ? "PASS" : "FAIL"} — ${ARM} captured gate ${result.pass ? "GREEN" : "RED"}\n`);
  console.log(JSON.stringify({ ...result, arm: ARM, expected_verdict: expected, rows: undefined }));
  process.exitCode = expected ? 0 : 1;
} catch (error) {
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: SETUP-FAILED — ${error.message}\n`);
  console.error(`SETUP-FAILED: ${error.message}`); process.exitCode = 125;
} finally {
  clearTimeout(timeout);
  pool.cleanup();
  for (const fd of [logFD, capFD, clockFD]) if (fd !== undefined) fs.closeSync(fd);
}
