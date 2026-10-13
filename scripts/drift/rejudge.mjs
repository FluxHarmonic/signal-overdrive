// Re-judge a saved capture with the current analyzer, without a new race.
// Reads RUN's capture, reference, clock and trace; writes rejudged.json
// beside them and prints the verdict. The original RESULT and
// analysis.json are left as they were.
//
//   node scripts/drift/rejudge.mjs RUN [normal|depth|immediate|skew]
import fs from "node:fs";
import path from "node:path";
import { analyze, armSignature, classifyCapture, parseTrace } from "./analyze.mjs";

const run = path.resolve(process.argv[2]);
const meta = fs.existsSync(path.join(run, "meta.json")) ? JSON.parse(fs.readFileSync(path.join(run, "meta.json"), "utf8")) : {};
const arm = process.argv[3] || meta.arm || "normal";
if (!["normal", "depth", "immediate", "skew"].includes(arm)) throw new Error("invalid arm");
const result = analyze(run);
const clocks = parseTrace(fs.readFileSync(path.join(run, "game.log"), "utf8")).clocks.filter(c => c.audio !== null);
const signature = arm === "normal" ? null : armSignature(arm, result, clocks);
const verdict = classifyCapture(arm, result, signature);
const mix = meta.music_only === false ? "full" : meta.music_only === true ? "music" : "unrecorded";
fs.writeFileSync(path.join(run, "rejudged.json"), JSON.stringify({ ...result, mix, arm, signature, verdict }, null, 2) + "\n");
console.log(JSON.stringify({ run: path.basename(run), mix, arm, verdict, signature,
  p95_ms: result.p95_ms, worst_ms: result.worst_ms, coverage: result.coverage,
  acquisition: result.acquisition, device_dropouts: result.device_dropouts && { ...result.device_dropouts },
  music_underruns_in_race: result.music_underruns_in_race }));
