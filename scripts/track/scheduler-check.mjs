// Execute the same Sigil module the game imports. Never fetch a compiler.
// The JavaScript audit supplies independent expected diagnostics, not approval.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contractList, sigilData } from "./schedule.mjs";
import { sampleDefinition, trackDefinition, STEP } from "./geometry.mjs";

const ownedList = zones => zones.map(z => [z.owner,z.kind,z.layout,z.zone]);
export function verifyCanonicalSchedule(contract, crossings, queries, source) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"signal-scheduler-"));
  try {
    const input=path.join(temporary,"queries.sgv");
    const data=queries.map(q => {
      if (q.op==="zones") return [q.op,q.seed,q.tick,ownedList(q.zones)];
      if (q.op==="corridor") return [q.op,ownedList(q.zones),q.pass];
      if (q.op==="tracer") return [q.op,q.seed,q.tick,q.targetS,q.u,q.pass];
      if (q.op==="placement") return [q.op,ownedList([q.owned])[0],true];
      throw new Error(`unknown canonical schedule query ${q.op}`);
    });
    let geometry=false;
    if (source) {
      const g=sampleDefinition(trackDefinition(source));
      const samples=g.P.flatMap((p,i)=>[...p,...g.TAN[i],g.HW,g.LINE[i]])
        .map(value=>Math.round(value*1000)/1000);
      const [a,b,...u]=source.zones.repair;
      geometry=[samples,STEP,[[a*contract.length,b*contract.length,...u]]];
    }
    fs.writeFileSync(input,sigilData([contractList(contract),crossings.map(e=>e.tick),data,geometry])+"\n");
    const compiler=process.env.SIGIL ?? path.join(os.homedir(),".sigil/versions/0.22.11/sigil");
    const started=Date.now();
    const processResult=spawnSync(compiler,["-L","src","eval","-f","scripts/track/scheduler-check.sgl","--",input],
      {encoding:"utf8",timeout:480000,maxBuffer:1024*1024});
    const output=(processResult.stdout??"")+(processResult.stderr??"");
    const pass=processResult.status===0 && output.includes(`PASS canonical scheduler: ${queries.length} queries`);
    const placements=output.match(/TRACER placements: (\d+) admitted, (\d+) yielded/);
    const tiers=output.match(/TIERS: (\d+) states, (\d+) targets, (\d+) admitted/);
    return {pass,queries:queries.length,durationMs:Date.now()-started,implementation:"src/signal/ice/schedule.sgl",
      placementImplementation:source?"src/signal/ice/placement.sgl":null,
      tracerPlacements:placements?{admitted:Number(placements[1]),yielded:Number(placements[2])}:null,
      tiers:tiers?{ids:["learner","courier","elite"],states:Number(tiers[1]),targets:Number(tiers[2]),admitted:Number(tiers[3])}:null,
      error:pass?null:String(processResult.error??output).slice(0,2000)};
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
