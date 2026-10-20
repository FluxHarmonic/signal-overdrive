// Produce a data-only matrix for the actual Sigil runtime consumer.
import fs from "node:fs";
import { loadTrack } from "./format.mjs";
import { liveContract, contractList, sigilData, barTick, zonesAt, mod } from "./schedule.mjs";
import { tracerAllowed } from "./combined-ice.mjs";

const output=process.argv[2];
if(!output) throw new Error("usage: schedule-parity.mjs output.sgv");
const ticks=[500,2300,4100,5900];
const crossings=ticks.map((tick,i)=>({lap:i+1,tick}));
const empty=loadTrack("tracks/oval.json");
empty.role="race";empty.zones.ice=[];empty.tracer={enabled:true};
const future=structuredClone(empty);
future.iceLayers=[{id:"wall",kind:"firewall",fromLap:3,phraseBars:2,upBars:1,downBars:1,phaseBars:1,
  layouts:[{id:"left",zones:[[.2,.3,-1,.2]]},{id:"right",zones:[[.2,.3,-.2,1]]}]}];
const staticRoad=structuredClone(empty);
staticRoad.zones.ice=[[.97,.99,-1,.2],[.01,.03,-1,.2]];
const drone=structuredClone(future);
drone.iceLayers.push({id:"swarm",kind:"drone",fromLap:2,phraseBars:4,upBars:1,downBars:1,phaseBars:0,
  layouts:[{id:"left",zones:[[.4,.42,-1,-.2]]},{id:"right",zones:[[.4,.42,.2,1]]},{id:"absent",zones:[]}]});
const earlyTracer=structuredClone(future);
earlyTracer.tracer.fromLap=2;
const sources=[empty,future,staticRoad,drone,loadTrack("test/fixtures/tracks/scheduled/quayside.json"),loadTrack("test/fixtures/tracks/scheduled/basin.json")];
const cases=[...sources.map(source=>[source,ticks]),
  ...sources.slice(0,4).map(source=>[source,[500,2300,4100,false]]),
  [earlyTracer,[500,2300,false,false]]].map(([source,observed])=>{
  const crossings=observed.map((tick,i)=>({lap:i+1,tick}));
  const c=liveContract(source),queries=[];
  const count=c.layers.reduce((p,l)=>p*l.layouts.length,1);
  for(let seed=0;seed<count;seed++) for(const bar of [4,5,6,22,23,24,25,39,40,41,42,43,44,45,46,47,48,49,50,55,57]) {
    const tick=barTick(c,bar);
    for(const at of [tick-1,tick,tick+1]) {
      const owned=zonesAt(c,crossings,seed,at).map(z=>[z.owner,z.kind,z.layout,z.zone]);
      queries.push(["zones",seed,at,owned]);
    }
    if(bar<40) continue;
    // Full fit, crossing an edge, wrap, lateral extremes, and reservations.
    for(const stretch of c.stretches.filter(s=>s.to-s.from>=920).slice(0,3)) {
      for(const raw of [stretch.from+100,(stretch.from+stretch.to)/2]) for(const u of [-.8,0,.8]) {
        const center=mod(raw,c.length),target=mod(center-c.rules.tracerAhead,c.length);
        for(const reserved of [false,true]) {
          const reservations=reserved?[{tick:tick-1,until:tick+200,stretch:stretch.id}]:[];
          const result=tracerAllowed(c,crossings,seed,tick,target,u,reservations);
          queries.push(["tracer",seed,tick,target,u,reservations.map(r=>[r.tick,r.until,r.stretch]),result.pass]);
        }
      }
    }
  }
  return [contractList(c),observed,queries];
});
fs.writeFileSync(output,sigilData(cases)+"\n");
console.log(`runtime parity matrix: ${cases.length} contracts, ${cases.reduce((n,c)=>n+c[2].length,0)} queries`);
