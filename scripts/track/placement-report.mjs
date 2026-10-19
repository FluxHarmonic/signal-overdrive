// Phantom-only: execute the game's placement implementation over every layout.
import fs from "node:fs";
import {loadTrack} from "./format.mjs";
import {liveContract} from "./schedule.mjs";
import {verifyCanonicalSchedule} from "./scheduler-check.mjs";

const [output,...files]=process.argv.slice(2);
if (!output || !files.length) throw new Error("usage: placement-report.mjs output.json tracks/*.json");
const results=files.map(file=>{
  const source=loadTrack(file),contract=liveContract(source),queries=[];
  for (const layer of contract.layers) for (const layout of layer.layouts)
    for (const zone of layout.zones) queries.push({op:"placement",owned:{owner:layer.id,kind:layer.kind,layout:layout.id,zone}});
  const crossings=[{lap:1,tick:0},{lap:2,tick:2000},{lap:3,tick:4000},{lap:4,tick:6000}];
  return {id:source.id,source:file,...verifyCanonicalSchedule(contract,crossings,queries,source)};
});
fs.writeFileSync(output,JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify(results));
if (results.some(r=>!r.pass)) process.exitCode=1;
