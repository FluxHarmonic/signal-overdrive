// Offline timing diagnostic; shared playback/inserts, no window or device.
// This measures total rendering throughput, not a live per-frame verdict.
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { localProcesses } from "./native.mjs";

const ROOT = process.cwd(), RUN = path.resolve(process.argv[2]);
const PLAN = path.resolve(process.argv[3]), FRAMES = Number(process.argv[4]);
if (!Number.isSafeInteger(FRAMES) || FRAMES <= 0) throw new Error("positive frame count required");
fs.mkdirSync(RUN, { recursive: true });
const pool = localProcesses(ROOT);
const deadline = setTimeout(() => pool.cleanup(), 120000);
let fd;
try {
  const binary = path.join(ROOT, "build/release/bin/signal-overdrive");
  const output = path.join(RUN, "reference.pcm");
  fd = fs.openSync(path.join(RUN, "reference.log"), "w");
  const start = performance.now();
  const child = pool.launch(path.join(ROOT, "scripts/dev"),
    [binary, "--music-reference", PLAN, output, String(FRAMES)],
    { env: { ...process.env, SIGIL_AUDIO_BACKEND: "null", SIGIL_APP_PLATFORM: "x11",
      DISPLAY: "", WAYLAND_DISPLAY: "" }, stdio: ["ignore", fd, fd] });
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve); child.once("error", reject);
  });
  if (code !== 0 || fs.statSync(output).size !== FRAMES * 8)
    throw new Error(`offline render failed (${code})`);
  const elapsed = performance.now() - start;
  const result = { frames: FRAMES, sample_rate: 48000, elapsed_ms: elapsed,
    rendered_seconds: FRAMES / 48000, wall_ms_per_song_second: elapsed / (FRAMES / 48000),
    cpu: pool.cpu, includes: "Guix startup, tune/player setup, shared inserts, PCM writes; excludes graphics/device" };
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(RUN, "RESULT"), "RESULT: PASS — offline throughput measured; not a live cost gate\n");
  console.log(JSON.stringify(result));
} catch (error) {
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: SETUP-FAILED — ${error.message}\n`);
  console.error(error.message); process.exitCode = 125;
} finally {
  clearTimeout(deadline); pool.cleanup();
  if (fd !== undefined) fs.closeSync(fd);
}
