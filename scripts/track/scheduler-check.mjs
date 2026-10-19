// Execute the same Sigil module the game imports. Never fetch a compiler.
// The JavaScript audit supplies independent expected diagnostics, not approval.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contractList, sigilData } from "./schedule.mjs";

const ownedList = zones => zones.map(z => [z.owner,z.kind,z.layout,z.zone]);
export function verifyCanonicalSchedule(contract, crossings, queries) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"signal-scheduler-"));
  try {
    const input=path.join(temporary,"queries.sgv");
    const data=queries.map(q => {
      if (q.op==="zones") return [q.op,q.seed,q.tick,ownedList(q.zones)];
      if (q.op==="corridor") return [q.op,ownedList(q.zones),q.pass];
      if (q.op==="tracer") return [q.op,q.seed,q.tick,q.targetS,q.u,q.pass];
      throw new Error(`unknown canonical schedule query ${q.op}`);
    });
    fs.writeFileSync(input,sigilData([contractList(contract),crossings.map(e=>e.tick),data])+"\n");
    const compiler=process.env.SIGIL ?? path.join(os.homedir(),".sigil/versions/0.22.11/sigil");
    const processResult=spawnSync(compiler,["-L","src","eval","-f","scripts/track/scheduler-check.sgl","--",input],
      {encoding:"utf8",timeout:240000,maxBuffer:1024*1024});
    const output=(processResult.stdout??"")+(processResult.stderr??"");
    const pass=processResult.status===0 && output.includes(`PASS canonical scheduler: ${queries.length} queries`);
    return {pass,queries:queries.length,implementation:"src/signal/ice/schedule.sgl",
      error:pass?null:String(processResult.error??output).slice(0,2000)};
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
