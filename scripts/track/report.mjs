import fs from "node:fs";
import { loadTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition } from "./geometry.mjs";
import { DEFAULTS, geometryGates } from "./gates.mjs";

const [output, ...files] = process.argv.slice(2);
if (!output || !files.length) throw new Error("usage: report.mjs output.json tracks/*.json");
const results = files.map(file => {
  const source = loadTrack(file);
  const g = sampleDefinition(trackDefinition(source));
  return { file, id: source.id, length: g.LENGTH, gates: geometryGates(source, g, DEFAULTS) };
});
fs.writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
for (const result of results) {
  console.log(JSON.stringify({ id: result.id, length: result.length,
    gates: Object.fromEntries(Object.entries(result.gates).map(([name, gate]) => [name, {
      pass: gate.pass, ...(name === "readability" ? { bends: gate.bends, failed: gate.failed } :
        name === "trueRadius" ? { minimum: gate.minimum, required: gate.required, witness: gate.witness } :
          name === "freeLane" ? { narrowest: gate.narrowest, combinations: gate.combinations } : {}),
    }])) }));
}
if (results.some(result => Object.values(result.gates).some(gate => !gate.pass))) process.exitCode = 1;
