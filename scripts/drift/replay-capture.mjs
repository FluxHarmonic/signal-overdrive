// Re-render an intended-log reference for saved real PCM. Never mutate
// the original capture, clocks, logs, metadata, reference or verdict.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { analyze, parseTrace } from "./analyze.mjs";
import { localProcesses } from "./native.mjs";

const ROOT = process.cwd(), SOURCE = path.resolve(process.argv[2]), RUN = path.resolve(process.argv[3]);
if (SOURCE === RUN || (fs.existsSync(RUN) && fs.readdirSync(RUN).length))
  throw new Error("saved-capture replay requires a fresh output directory");
fs.mkdirSync(RUN, { recursive: true });
const pool = localProcesses(ROOT);
const deadline = setTimeout(() => pool.cleanup(), 120000);
let fd;
try {
  for (const file of ["capture.pcm", "capclock.txt", "game.log", "intended.sgv"])
    fs.copyFileSync(path.join(SOURCE, file), path.join(RUN, file));
  const text = fs.readFileSync(path.join(RUN, "game.log"), "utf8");
  const rate = Number(text.match(/sigil-audio: backend=.* format=\S+ channels=\d+ rate=(\d+)/)?.[1]);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000)
    throw new Error("saved capture has no actual native device rate");
  const clocks = parseTrace(text).clocks;
  if (!clocks.length) throw new Error("saved capture has no intended simulation clock");
  const frames = Math.ceil((clocks.at(-1).song + 2) * rate);
  const binary = path.join(RUN, "signal-overdrive");
  fs.copyFileSync(process.env.CONDUCTOR_BINARY || path.join(ROOT, "build/release/bin/signal-overdrive"), binary);
  fs.chmodSync(binary, 0o755);
  const meta = JSON.parse(fs.readFileSync(path.join(SOURCE, "meta.json"), "utf8"));
  meta.source_capture = SOURCE;
  meta.reference_sample_rate = rate;
  meta.reference_binary_sha256 = createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
  fs.writeFileSync(path.join(RUN, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  fd = fs.openSync(path.join(RUN, "reference.log"), "w");
  const child = pool.launch(path.join(ROOT, "scripts/dev"),
    [binary, "--music-reference", path.join(RUN, "intended.sgv"), path.join(RUN, "reference.pcm"), String(frames), String(rate)],
    { env: { ...process.env, SIGIL_AUDIO_BACKEND: "null", SIGIL_APP_PLATFORM: "x11",
      DISPLAY: "", WAYLAND_DISPLAY: "", SIGIL_GC_STATS_FILE: path.join(RUN, "reference-gc.jsonl") },
      stdio: ["ignore", fd, fd] });
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve); child.once("error", reject);
  });
  if (code !== 0 || fs.statSync(path.join(RUN, "reference.pcm")).size !== frames * 8)
    throw new Error(`saved-capture reference failed (${code})`);
  const result = analyze(RUN);
  fs.writeFileSync(path.join(RUN, "analysis.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: ${result.pass ? "PASS" : "FAIL"} — saved actual capture ${result.pass ? "GREEN" : "RED"}\n`);
  console.log(JSON.stringify({ ...result, rows: undefined }));
  process.exitCode = result.pass ? 0 : 1;
} catch (error) {
  fs.writeFileSync(path.join(RUN, "RESULT"), `RESULT: SETUP-FAILED — ${error.message}\n`);
  console.error(error.message); process.exitCode = 125;
} finally {
  clearTimeout(deadline); pool.cleanup();
  if (fd !== undefined) fs.closeSync(fd);
}
