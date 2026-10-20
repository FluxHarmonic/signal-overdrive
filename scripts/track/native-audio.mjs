// Phantom-only queued stream proof, isolated with the same native harness.
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
const deadline = setTimeout(() => pool.cleanup(), 180000);
for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  process.once(signal, () => { pool.cleanup(); process.exit(code); });
}
try {
  assert.ok(process.env.SIGIL_TEST_HARNESS, "standard native runner must be staged first");
  const { display } = await privateDisplay(pool, run);
  const child = pool.launch(path.resolve("scripts/dev"),
    [path.resolve(process.env.SIGIL_TEST_HARNESS), "--sgl", "--no-strict", "test/test-live-ice-audio.sgl"],
    { env: { ...process.env, DISPLAY: display, SIGNAL_ICE_PRIVATE_DISPLAY: display,
      SIGIL_APP_PLATFORM: "x11", SIGIL_AUDIO_BACKEND: "null", XDG_SESSION_TYPE: "x11",
      LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "1", GALLIUM_DRIVER: "llvmpipe" },
      stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(code, 0, log.slice(-5000));
  assert.match(log, /NATIVE ICE TEST RUN: test-live-ice-audio:/);
  assert.match(log, /LIVE ICE AUDIO PASS: queued mute, advancing clock, recovery; no device/);
  assert.doesNotMatch(log, /SKIP: requires staged SIGIL_TEST_HARNESS|FAIL live ICE audio|FAIL native ICE test/);
  fs.writeFileSync(path.join(run, "RESULT"), "RESULT: native queued audio PASS; explicit harness, no skip, no audio device\n");
} finally {
  clearTimeout(deadline);
  pool.cleanup();
  fs.writeFileSync(path.join(run, "game.log"), log);
}
