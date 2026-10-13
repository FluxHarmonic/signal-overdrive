// Muted graphical focus check using a binary snapshot and private Xvfb.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseTrace } from "./analyze.mjs";
import { cachedTool, localProcesses, privateDisplay, sleep } from "./native.mjs";

const ROOT = process.cwd(), RUN = path.resolve(process.argv[2]);
fs.mkdirSync(RUN, { recursive: true });
const pool = localProcesses(ROOT);
let logFD, text = "", timedOut = false;
const deadline = setTimeout(() => { timedOut = true; pool.cleanup(); }, 60000);
try {
  const snapshot = path.join(RUN, "signal-overdrive");
  fs.copyFileSync(process.env.CONDUCTOR_BINARY || path.join(ROOT, "build/release/bin/signal-overdrive"), snapshot);
  fs.chmodSync(snapshot, 0o755);
  const { display } = await privateDisplay(pool, RUN);
  const env = { ...process.env, DISPLAY: display, SIGIL_APP_PLATFORM: "x11",
    SIGIL_AUDIO_BACKEND: "null", XDG_DATA_HOME: path.join(RUN, "xdg"),
    LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "1", GALLIUM_DRIVER: "llvmpipe" };
  delete env.WAYLAND_DISPLAY;
  fs.mkdirSync(path.join(env.XDG_DATA_HOME, "signal-overdrive"), { recursive: true });
  fs.writeFileSync(path.join(env.XDG_DATA_HOME, "signal-overdrive", "scale.sgl"), "2\n");
  logFD = fs.openSync(path.join(RUN, "game.log"), "w");
  const gameArgs = [snapshot, "--mute", "--start", "--autopilot",
    "--track=loop", "--musiclog", "--quit-after", "14"];
  const launchArgs = process.env.CONDUCTOR_GDB === "1"
    ? [cachedTool("gdb", "gdb"), "--batch", "--return-child-result", "-ex", "run",
      "-ex", "thread apply all bt", "--args", ...gameArgs]
    : gameArgs;
  const game = pool.launch(path.join(ROOT, "scripts/dev"), launchArgs,
    { env, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolve, reject) => { game.once("close", resolve); game.once("error", reject); });
  const output = bytes => { fs.writeSync(logFD, bytes); text += bytes; };
  game.stdout.on("data", output); game.stderr.on("data", output);
  const xdotool = cachedTool("xdotool", "xdotool");
  let window;
  for (let i = 0; i < 300 && !window; i++) {
    try { window = execFileSync(xdotool, ["search", "--onlyvisible", "--name", "^Signal Overdrive$"],
      { env, encoding: "utf8", timeout: 2000 }).trim().split("\n")[0]; }
    catch { /* graphics still initializing */ }
    if (game.exitCode !== null) throw new Error("game exited before its headless window appeared");
    if (!window) await sleep(100);
  }
  if (!window) throw new Error("no private game window");
  const windowCommand = command => execFileSync(xdotool, [command, window], { env, timeout: 5000 });
  windowCommand("windowfocus");
  await sleep(2500);
  const unmap = Date.now(); windowCommand("windowunmap");
  await sleep(3500);
  const remap = Date.now(); windowCommand("windowmap"); windowCommand("windowfocus");
  const code = await closed;
  if (timedOut || code !== 0) throw new Error(`game did not exit cleanly (${code})`);
  const { clocks } = parseTrace(text);
  const paused = clocks.filter(c => c.wall >= unmap + 500 && c.wall < remap - 250);
  const after = clocks.filter(c => c.wall >= remap + 500);
  if (paused.length < 2 || after.length < 2) throw new Error("insufficient dated focus samples");
  const pass = paused.every(c => c.tick === paused[0].tick) && after.at(-1).tick > paused[0].tick
    && clocks.every(c => c.metrics.music === "off");
  const result = { pass, muted: true, display, unmap_ms: unmap, remap_ms: remap,
    paused_samples: paused.length, paused_tick: paused[0].tick, resumed_tick: after.at(-1).tick,
    binary_sha256: createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex") };
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: ${pass ? "PASS" : "FAIL"} — native graphical focus pause/resume, muted\n`);
  console.log(JSON.stringify(result)); process.exitCode = pass ? 0 : 1;
} catch (error) {
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: SETUP-FAILED — ${error.message}\n`);
  console.error(error.message); process.exitCode = 125;
} finally {
  clearTimeout(deadline); pool.cleanup();
  if (logFD !== undefined) fs.closeSync(logFD);
}
