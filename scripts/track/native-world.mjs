// Phantom-only muted native shader smoke on an isolated software-GL display.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { localProcesses, privateDisplay } from "../drift/native.mjs";

const run = path.resolve(process.argv[2]);
fs.mkdirSync(run, { recursive: true });
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;
const pool = localProcesses(process.cwd());
let log = "";
const deadline = setTimeout(() => pool.cleanup(), 60000);
try {
  const { display } = await privateDisplay(pool, run);
  const child = pool.launch(path.resolve("scripts/dev"), [path.resolve("build/release/bin/signal-overdrive"),
    "--start", "--autopilot", "--track=oval", "--mute", "--shots", run, "--shot-times", "2", "--quit-after", "30"],
  { env: { ...process.env, DISPLAY: display, SIGIL_APP_PLATFORM: "x11", SIGIL_AUDIO_BACKEND: "null",
    XDG_SESSION_TYPE: "x11", XDG_DATA_HOME: path.join(run, "xdg"),
    LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "1", GALLIUM_DRIVER: "llvmpipe" },
    stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  assert.equal(code, 0, "native graphical exit");
  assert.match(log, /signal-overdrive: shot /);
  assert.doesNotMatch(log, /FAILED|shader.*error|compile.*error/i);
  const png = fs.readFileSync(path.join(run, "shot-2.png"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.readUInt32BE(16) >= 480 && png.readUInt32BE(20) >= 270);
  fs.writeFileSync(path.join(run, "RESULT"), "RESULT: native graphical shader/world smoke PASS; muted, private Xvfb, captured frame\n");
} finally {
  clearTimeout(deadline);
  pool.cleanup();
  fs.writeFileSync(path.join(run, "game.log"), log);
}
