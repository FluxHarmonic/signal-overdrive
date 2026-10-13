// The whole drift gate, one capture at a time: the music-only normal arm,
// the full-mix companion (reported, never a verdict), then the depth,
// immediate and skew sabotage arms. A SETUP-FAILED capture (the device or
// sink dropped out) is re-run, at most twice.
//
//   node scripts/drift/gate.mjs ROOT
//
// ROOT must not exist. Each capture goes to ROOT/<arm>[-mix][-try2|3].
// ROOT/GATE holds one line per capture and the verdict: PASS when the
// normal arm is GREEN and every sabotage arm is RED for its own defect.
// The environment (CONDUCTOR_SINK, CONDUCTOR_CPU_LIST, CONDUCTOR_NICE,
// CONDUCTOR_BINARY, CONDUCTOR_HEADLESS, CONDUCTOR_GC_PROFILE) passes
// through to capture.mjs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2]);
if (fs.existsSync(root)) throw new Error("the gate requires a fresh ROOT");
fs.mkdirSync(root, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const lines = [];
function log(line) { lines.push(line); fs.writeFileSync(path.join(root, "GATE"), lines.join("\n") + "\n"); console.log(line); }

function capture(arm, mix) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const name = `${arm}${mix === "full" ? "-mix" : ""}${attempt > 1 ? `-try${attempt}` : ""}`;
    const run = path.join(root, name);
    spawnSync("node", [path.join(here, "capture.mjs"), run, arm],
      { env: { ...process.env, CONDUCTOR_MIX: mix }, stdio: ["ignore", "ignore", "ignore"], timeout: 15 * 60 * 1000 });
    const result = fs.existsSync(path.join(run, "RESULT")) ? fs.readFileSync(path.join(run, "RESULT"), "utf8").trim() : "RESULT: SETUP-FAILED — no RESULT written";
    log(`${name}: ${result}`);
    if (!result.includes("SETUP-FAILED")) return result;
  }
  return "RESULT: SETUP-FAILED — three attempts";
}

const verdicts = { normal: capture("normal", "music") };
capture("normal", "full");
for (const arm of ["depth", "immediate", "skew"]) verdicts[arm] = capture(arm, "music");
const pass = Object.values(verdicts).every(v => v.startsWith("RESULT: PASS"));
log(`GATE: ${pass ? "PASS" : "FAIL"} — normal GREEN and each sabotage arm RED for its own defect: ${pass ? "yes" : "no"}`);
process.exitCode = pass ? 0 : 1;
