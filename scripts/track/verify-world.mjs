import fs from "node:fs";
import assert from "node:assert/strict";
import { loadTrack, worldSize } from "./format.mjs";
import { parGate } from "./gates.mjs";

const run = process.argv[2];
const json = file => JSON.parse(fs.readFileSync(`${run}/${file}`));
const status = file => Number(fs.readFileSync(`${run}/${file}`, "utf8").trim());
function mapSize(file, world) {
  const png = fs.readFileSync(`${run}/${file}`);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), world.width / 32, "map width must match world");
  assert.equal(png.readUInt32BE(20), world.height / 32, "map height must match world");
}
for (const id of ["oval", "quayside", "basin"]) {
  const source = loadTrack(id === "oval" ? "tracks/oval.json" : `test/fixtures/tracks/reshaped/${id}.json`);
  const world = worldSize(source);
  assert.deepEqual(world, {width:5120, height:5120});
  const artifact = json(`pipeline/art/build/track/${id}-generated.json`);
  assert.deepEqual(artifact.world, world);
  assert.equal(artifact.canvasBytes, 104857600);
  for (const [name, gate] of Object.entries(artifact.gates)) assert.equal(gate.pass, true, `${id} ${name}`);
  for (const phase of ["art", "ai"]) assert.equal(status(`pipeline/${id}-${phase}-status`), 0);
  const ai = json(`pipeline/${id}-ai.json`);
  assert.deepEqual(ai.world, world);
  assert.equal(ai.pass, true);
  assert.equal(parGate(source, ai).pass, true);
  const combined = json(`pipeline/${id}-combined.json`);
  assert.deepEqual(combined.world, world);
  assert.deepEqual(combined.crossings, ai.crossings);
  assert.equal(combined.pass, id === "oval", "unsafe authored drafts must remain RED");
  assert.equal(status(`pipeline/${id}-combined-status`), id === "oval" ? 0 : 1);
  mapSize(`pipeline/art/assets/signal/${id}-map.png`, world);
}
const loop = json("retired/build/track/loop-generated.json");
assert.equal(loop.draft, true);
assert.equal(loop.gates.trueRadius.pass, false);
assert.equal(loop.gates.readability.pass, false);
assert.equal(loop.gates.world.pass, true);
assert.equal(loop.gates.tiles.pass, true);
mapSize("retired/assets/signal/loop-map.png", {width:5120, height:5120});
assert.equal(json("loop-ai.json").pass, true, "loop passes measured par only");
assert.equal(status("loop-combined-status"), json("loop-combined.json").pass ? 0 : 1);
for (const [name, world] of [["rectangle", {width:4128, height:5152}], ["maximum", {width:8192, height:8192}]]) {
  const artifact = json(`${name}/build/track/oval-generated.json`);
  assert.deepEqual(artifact.world, world);
  assert.equal(artifact.canvasBytes, world.width * world.height * 4);
  for (const [gate, result] of Object.entries(artifact.gates)) assert.equal(result.pass, true, `${name} ${gate}`);
  assert.ok(artifact.memory.maxRSSKiB < 2 * 1024 * 1024, "generation stays within2GiB RSS (4GiB address-space cap)");
  mapSize(`${name}/assets/signal/oval-map.png`, world);
}
assert.equal(status("pipeline/oval-stall-status"), 1);
assert.equal(json("pipeline/oval-stall.json").threeLapsAllRacers, false);
assert.equal(status("pipeline/too-short-ai-status"), 1);
assert.equal(json("pipeline/too-short-ai.json").threeLapsAllRacers, true);
assert.equal(json("pipeline/too-short-ai.json").parGate, false);
assert.deepEqual(json("pipeline/preview/oval-report.json").acceptance, {complete:true, pass:true});
console.log("PASS:5120 regeneration, every current gate/verdict, rectangular and8192 maps, metadata roundtrips, bounded memory; known RED radius/readability/combined hazards retained");
