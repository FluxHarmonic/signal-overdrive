import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DEFAULTS, parGate } from "./gates.mjs";
import { loadTrack, worldSize } from "./format.mjs";
import { liveContract } from "./schedule.mjs";

const run = process.argv[2];
if (!run) throw new Error("usage: verify.mjs <pipeline-output-directory>");
const json = file => JSON.parse(fs.readFileSync(path.join(run, file), "utf8"));
const status = file => Number(fs.readFileSync(path.join(run, file), "utf8").trim());
const contract = json("song-contract.json");
for (const [key, value] of Object.entries(contract.camera)) assert.equal(value, DEFAULTS[key], `runtime default ${key} drifted`);
for (const result of json("current-gates.json")) {
  for (const [name, gate] of Object.entries(result.gates)) assert.equal(gate.pass, true, `${result.id} ${name}`);
}
for (const id of ["oval", "quayside", "basin"]) {
  assert.equal(status(`${id}-ai-status`), 0, `${id} AI process`);
  assert.equal(status(`${id}-art-status`), 0, `${id} art process`);
  assert.equal(status(`${id}-combined-status`), 0, `${id} combined live ICE process`);
  const combined = json(`${id}-combined.json`);
  assert.equal(combined.pass, true, `${id} combined live ICE gate`);
  const ai = json(`${id}-ai.json`);
  assert.equal(combined.id, id);
  assert.deepEqual(combined.crossings, ai.crossings, `${id} combined timing must match actual AI`);
  assert.equal(ai.pass, true, `${id} AI gate`);
  assert.equal(ai.threeLapsAllRacers, true);
  assert.equal(ai.parGate, true);
  const source = loadTrack(id === "oval" ? "tracks/oval.json" : `test/fixtures/tracks/scheduled/${id}.json`);
  assert.deepEqual(ai.world, worldSize(source), `${id} AI world dimensions`);
  assert.deepEqual(combined.world, worldSize(source), `${id} combined world dimensions`);
  assert.equal(parGate(source, ai).pass, true, `${id} measured par lap`);
  assert.equal(ai.lapTicks.length, 3);
  assert.ok(ai.landings.some(landing => landing.mark === "results"), "probe must include the coda exit");
  const artifact = json(`art/build/track/${id}-generated.json`);
  assert.deepEqual(artifact.liveICE, liveContract(source), `${id} generated contract must equal the audited track data`);
  assert.deepEqual(artifact.world, worldSize(source), `${id} painted world dimensions`);
  for (const [name, gate] of Object.entries(artifact.gates)) assert.equal(gate.pass, true, `${id} generated ${name}`);
  assert.ok(artifact.gates.tiles.count > 0);
}
assert.equal(status("oval-stall-status"), 1, "stall must be a caught gate failure, not setup/timeout");
assert.equal(json("oval-stall.json").threeLapsAllRacers, false);
assert.equal(json("oval-stall.json").pass, false);
assert.equal(status("too-short-ai-status"), 1);
assert.equal(json("too-short-ai.json").threeLapsAllRacers, true);
assert.equal(json("too-short-ai.json").parGate, false);
assert.equal(json("too-short-ai.json").pass, false);
assert.ok(json("preview/oval-report.json").actual.landings.some(landing => landing.mark === "results"));
console.log("PASS: geometry, static and timed combined ICE, measured AI/par/coda, tile counts, driven preview, stalled-AI and AI-par sabotage");
