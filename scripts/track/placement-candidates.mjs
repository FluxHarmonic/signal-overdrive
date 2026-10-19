// Phantom-only read-only scan. Candidates are proposals, not joint acceptance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {loadTrack} from "./format.mjs";
import {sampleDefinition,trackDefinition,STEP} from "./geometry.mjs";
import {liveContract,sigilData} from "./schedule.mjs";

const [sourceFile,output]=process.argv.slice(2);
if (!sourceFile||!output) throw new Error("usage: placement-candidates.mjs track.json report.json");
const source=loadTrack(sourceFile),g=sampleDefinition(trackDefinition(source)),contract=liveContract(source,g);
const groups=[];
for (const layer of contract.layers) {
  if (layer.id==="$road") {
    layer.layouts[0].zones.forEach((zone,i)=>groups.push({id:`$road:${i}`,kind:layer.kind,
      originalFrom:zone[0],templates:[[0,zone[1]-zone[0],...zone.slice(2)]]}));
  } else {
    const zones=layer.layouts.flatMap(layout=>layout.zones);
    if (!zones.length) continue;
    const from=Math.min(...zones.map(zone=>zone[0]));
    groups.push({id:layer.id,kind:layer.kind,originalFrom:from,
      templates:zones.map(zone=>[zone[0]-from,zone[1]-from,...zone.slice(2)])});
  }
}
const samples=g.P.flatMap((p,i)=>[...p,...g.TAN[i],g.HW,g.LINE[i]])
  .map(value=>Math.round(value*1000)/1000);
const [a,b,...u]=source.zones.repair;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"signal-placement-scan-"));
try {
  const input=path.join(temporary,"input.sgv"),step=128;
  fs.writeFileSync(input,sigilData([source.id,samples,STEP,[[a*contract.length,b*contract.length,...u]],
    groups.map(group=>[group.id,group.kind,group.templates]),step])+"\n");
  const compiler=process.env.SIGIL??path.join(os.homedir(),".sigil/versions/0.22.11/sigil");
  const result=spawnSync(compiler,["-L","src","eval","-f","scripts/track/placement-candidates.sgl","--",input],
    {encoding:"utf8",timeout:240000,maxBuffer:1024*1024});
  if (result.status!==0) throw new Error(String(result.error??result.stdout+result.stderr));
  const candidates=result.stdout.split("\n").filter(line=>line.startsWith('{"owner":')).map(line=>JSON.parse(line));
  if (candidates.length!==groups.length) throw new Error("scan did not report every authored group");
  const report={id:source.id,length:contract.length,step,
    implementation:"src/signal/ice/placement.sgl",scope:"individual all-layout placement proposals; joint combined gate still required",
    groups:groups.map(group=>({...group,starts:candidates.find(candidate=>candidate.owner===group.id).starts}))};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({id:source.id,groups:report.groups.map(group=>({id:group.id,legalStarts:group.starts.length,starts:group.starts}))}));
  if (report.groups.some(group=>!group.starts.length)) process.exitCode=1;
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
