// Data-only bridge to the actual Sigil handling/race modules. Keep the exact
// 0.001 rounding and 20-sample chunks used by the generated runtime modules.
import fs from "node:fs";
import { loadTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition, STEP } from "./geometry.mjs";
import { liveContract, contractList, sigilData } from "./schedule.mjs";

export const numberText = value => {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : rounded.toString();
};
const list = values => `(${values.map(numberText).join(" ")})`;

export function runtimeData(source, seed = 0) {
  const def = trackDefinition(source, seed);
  const g = sampleDefinition(def);
  const zones = {
    boost: def.boost.map(([f, l, r]) => [f * g.LENGTH, f * g.LENGTH + 100, l, r]),
    repair: [[def.repair[0] * g.LENGTH, def.repair[1] * g.LENGTH, ...def.repair.slice(2)]],
    ice: def.ice.map(([a, b, l, r]) => [a * g.LENGTH, b * g.LENGTH, l, r]),
  };
  const chunks = [];
  for (let i = 0; i < g.N; i += 20) {
    const rows = [];
    for (let j = i; j < Math.min(i + 20, g.N); j++) rows.push(
      [...g.P[j], ...g.TAN[j], g.HW, g.LINE[j]].map(numberText).join(" "));
    chunks.push(`#(\n${rows.join("\n")}\n)`);
  }
  return `(${source.id} ${source.role} ${numberText(STEP)}\n` +
    [zones.boost, zones.repair, zones.ice].map(zs => `(${zs.map(list).join(" ")})`).join("\n") +
    // district before the schedule, as in the generated runtime modules
    `\n(${chunks.join("\n")}) ${def.world.width} ${def.world.height} ${source.district}\n` +
    `${sigilData(contractList(liveContract(source, g)))})\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [input, output, seed = "0"] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: runtime.mjs tracks/<id>.json output.sgv [seed]");
  fs.writeFileSync(output, runtimeData(loadTrack(input), Number(seed)));
}
