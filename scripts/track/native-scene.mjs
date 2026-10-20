// Phantom-only complete game scene with real shell/race state and assets.
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
const expected = ["breakwater-grid", "breakwater-firewall-active",
  "breakwater-drone-scheduled", "breakwater-tracer-warning", "basin-grid", "basin-null-warning"];
for (const name of fs.readdirSync("build")) {
  if (/^ice-scene-.*\.png$/.test(name)) fs.rmSync(path.join("build", name));
}
const deadline = setTimeout(() => pool.cleanup(), 1050000);
for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  process.once(signal, () => { pool.cleanup(); process.exit(code); });
}
try {
  const { display } = await privateDisplay(pool, run);
  assert.ok(process.env.SIGIL_TEST_HARNESS, "standard native runner must be staged first");
  const child = pool.launch(path.resolve("scripts/dev"),
    [path.resolve(process.env.SIGIL_TEST_HARNESS), "--sgl", "--no-strict", "test/test-ice-scene.sgl"],
    { env: { ...process.env, DISPLAY: display, SIGNAL_ICE_PRIVATE_DISPLAY: display,
      SIGIL_APP_PLATFORM: "x11", SIGIL_AUDIO_BACKEND: "null",
      XDG_SESSION_TYPE: "x11", LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "1", GALLIUM_DRIVER: "llvmpipe" },
      stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(code, 0, log.slice(-5000));
  assert.doesNotMatch(log, /Scheme error in frame|Error loading|FAIL:|shader.*error/i);
  assert.match(log, /NATIVE ICE TEST RUN: test-ice-scene:/);
  assert.doesNotMatch(log, /SKIP: requires staged SIGIL_TEST_HARNESS/);
  const names = fs.readdirSync("build").filter(name => /^ice-scene-.*\.png$/.test(name));
  for (const name of expected) assert.ok(names.includes(`ice-scene-${name}.png`), `missing ${name}`);
  for (const name of names) {
    const bytes = fs.readFileSync(path.join("build", name));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 480);
    assert.equal(bytes.readUInt32BE(20), 270);
    fs.writeFileSync(path.join(run, name), bytes);
  }
  fs.writeFileSync(path.join(run, "manifest.log"), log.split("\n").filter(line => line.startsWith("SCENE ")).join("\n") + "\n");
  fs.writeFileSync(path.join(run, "RESULT"), `RESULT: complete current game scene PASS; ${names.length} fresh captures, real shell/scheduler/assets\n`);
} finally {
  clearTimeout(deadline);
  pool.cleanup();
  fs.writeFileSync(path.join(run, "game.log"), log);
}
