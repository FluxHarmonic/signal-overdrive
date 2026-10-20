// Phantom-only concrete source proposals. Geometry, song and footprint spans
// stay authored; acceptance still requires the joint gate and actual driving.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {loadTrack,validateTrack} from "./format.mjs";

const [scans,output,originals="tracks"]=process.argv.slice(2);
if (!scans||!output) throw new Error("usage: propose-placements.mjs scan-directory output-directory");
const choices={quayside:{"$road:0":4480,"$road:1":14848,"harbour-wall":5888,"back-basin":2816},
  basin:{"$road:0":1536,"$road:1":12160,gantry:10496,"west-road":13952}};
fs.mkdirSync(output,{recursive:true});
for (const [id,starts] of Object.entries(choices)) {
  const originalFile=path.join(originals,`${id}.json`);
  const original=loadTrack(originalFile),source=structuredClone(original);
  const scan=JSON.parse(fs.readFileSync(path.join(scans,`${id}.json`)));
  for (const [owner,start] of Object.entries(starts)) {
    const group=scan.groups.find(group=>group.id===owner);
    assert.ok(group.starts.includes(start),`${id}/${owner} must be a shared-predicate candidate`);
    if (owner.startsWith("$road:")) {
      const zone=source.zones.ice[Number(owner.slice(6))],span=zone[1]-zone[0];
      zone[0]=start/scan.length;zone[1]=zone[0]+span;
    } else {
      const layer=source.iceLayers.find(layer=>layer.id===owner);
      const delta=(start-group.originalFrom)/scan.length;
      for (const layout of layer.layouts) for (const zone of layout.zones) {
        zone[0]+=delta;zone[1]+=delta;
      }
      for (const binding of source.musicZones) if (binding.id===`${owner}-${layer.kind}`) {
        binding.from+=delta;binding.to+=delta;
      }
    }
  }
  for (const key of ["geometry","world","song","sections","decoration"])
    assert.deepEqual(source[key],original[key],`${id} preserves ${key}`);
  assert.deepEqual(source.zones.boost,original.zones.boost);
  assert.deepEqual(source.zones.repair,original.zones.repair);
  validateTrack(source);
  const controlPattern=/"control": \[[\s\S]*?\n    \]/;
  const originalControl=fs.readFileSync(originalFile,"utf8").match(controlPattern)?.[0];
  assert.ok(originalControl,"preserve the author's unchanged control-point formatting");
  const text=JSON.stringify(source,null,2).replace(controlPattern,()=>originalControl)+"\n";
  assert.deepEqual(JSON.parse(text),source);
  fs.writeFileSync(path.join(output,`${id}.json`),text);
  console.log(JSON.stringify({id,starts,scope:"arc relocation only; preserve cadence, layout widths and spans"}));
}
