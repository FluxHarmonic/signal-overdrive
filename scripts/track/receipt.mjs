// Phantom-only: derive a durable receipt from actual, individually passed jobs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { loadTrack, worldSize } from "./format.mjs";

const [commit, driving, combined, geometryFile, output, archivedSource] = process.argv.slice(2);
assert.match(commit ?? "", /^[0-9a-f]{40}$/, "exact production source commit required");
assert.ok(driving && combined && geometryFile && output && archivedSource,
  "receipt requires completed job inputs, an output and the exact archived source commit");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const status = file => assert.equal(fs.readFileSync(file, "utf8").trim(), "0", file);
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const ids = ["breakwater", "quayside", "basin"];
const tiers = ["learner", "courier", "elite"];
const geometry = read(geometryFile);
assert.deepEqual(geometry.map(result => result.id).sort(), [...ids, "oval"].sort());
for (const result of geometry) {
  for (const [name, gate] of Object.entries(result.gates))
    assert.equal(gate.pass, true, `${result.id} ${name}`);
}
const races = [];
for (const id of ids) {
  const source = loadTrack(`tracks/${id}.json`);
  for (const tier of tiers) {
    const key = `${id}-${tier}`;
    status(path.join(driving, `${key}-status`));
    status(path.join(combined, `${key}-status`));
    const ai = read(path.join(driving, `${key}-ai.json`));
    const gate = read(path.join(combined, `${key}-combined.json`));
    assert.equal(ai.id, id);
    assert.equal(ai.tier, tier);
    assert.equal(ai.pass, true);
    assert.equal(ai.threeLapsAllRacers, true);
    assert.equal(ai.parGate, true);
    assert.equal(ai.lapTicks.length, 3);
    assert.ok(ai.bestLapSeconds >= 25 && ai.bestLapSeconds <= 35);
    assert.ok(ai.landings.some(landing => landing.mark === "results"));
    assert.deepEqual(ai.world, worldSize(source));
    assert.equal(gate.id, id);
    assert.equal(gate.pass, true);
    assert.equal(gate.canonical.pass, true);
    assert.ok(gate.canonical.queries > 0);
    assert.deepEqual(gate.canonical.tiers.ids, tiers);
    assert.deepEqual(gate.world, ai.world);
    assert.deepEqual(gate.crossings, ai.crossings);
    for (const rule of Object.values(gate.rules)) assert.equal(rule.pass, true);
    races.push({ id, tier, world: ai.world, song: ai.activeSong,
      parSeconds: ai.bestLapSeconds, lapTicks: ai.lapTicks, crossings: ai.crossings,
      allRacersThreeLapsAndCoda: true, hazards: ai.hazardTicks,
      pair: { rivals: ai.rivalNames, nullAttackTicks: ai.nullAttackTicks,
        voidAttackTicks: ai.voidAttackTicks, nullWarningTicks: ai.nullWarningTicks },
      combined: { pass: gate.pass, minimumLane: gate.narrowest, requiredLane: gate.required,
        combinations: gate.combinations, rules: gate.rules, canonical: gate.canonical } });
  }
}
const files = [...ids.map(id => `tracks/${id}.json`), "tracks/oval.json",
  "src/signal/tiers.sgl", "src/signal/race.sgl", "src/signal/ice/schedule.sgl",
  "src/signal/ice/runtime.sgl", "src/signal/ice/placement.sgl", "src/signal/ice/tier.sgl",
  "src/signal/rivals/turns.sgl", "src/signal/rivals/tactics.sgl", "src/signal/rivals/wake.sgl"];
const exactSourceSHA256 = {};
const jsonFormattingOnly = [];
for (const file of files) {
  const archived = path.join(archivedSource, file);
  exactSourceSHA256[file] = digest(archived);
  if (digest(file) !== exactSourceSHA256[file]) {
    // Reports predate the review commit's preservation of control-array
    // formatting. Executable source must match byte for byte; JSON values
    // must match recursively, with both file digests retained explicitly.
    assert.ok(file.endsWith(".json"), `executable source mismatch: ${file}`);
    assert.deepEqual(read(file), read(archived), `track value mismatch: ${file}`);
    jsonFormattingOnly.push(file);
  }
}
const receipt = { sourceCommit: commit,
  scope: "Current geometry and nine actual cup/tier histories; native/web build evidence is separate",
  provenance: { geometry: geometryFile, driving, combined },
  sourceSHA256: Object.fromEntries(files.map(file => [file, digest(file)])),
  sourceVerification: { archivedSource, exactSourceSHA256, jsonFormattingOnly,
    method: "Executable source bytes match; differing JSON formatting requires exact recursive value identity" },
  geometry, races,
  limitations: ["Flat ground only: future crests/terrain require line-of-sight occlusion",
    "Actual Quayside/Basin seed0 AI paths admit no tracer; reservation yields are intentional",
    "Actual Basin ELITE seed0 admits no Void wake; LEARNER and COURIER do",
    "Complete-scene swarm state may be offscreen; visible curved geometry is proven separately",
    "Fast fixed-tick scene capture is not a frame-time or audio-pacing measurement"] };
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
console.log("PASS receipt: all four current geometries and nine actual cup/tier canonical histories");
