// Phantom-only: these tests execute the installed game-language interpreter.
import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyCanonicalSchedule} from "./scheduler-check.mjs";
import {loadTrack} from "./format.mjs";
import {liveContract,zonesAt,barTick} from "./schedule.mjs";

test("canonical gate refuses an oracle that claims a real hazard is absent",()=>{
  const source=structuredClone(loadTrack("tracks/oval.json"));
  source.zones.ice=[[.2,.3,-1,-.2]];
  source.iceLayers=[];
  const contract=liveContract(source);
  const crossings=[{lap:1,tick:0},{lap:2,tick:1000},{lap:3,tick:2000},{lap:4,tick:3000}];
  const zones=zonesAt(contract,crossings,0,100);
  assert.ok(zones.length);
  assert.equal(verifyCanonicalSchedule(contract,crossings,[{op:"zones",seed:0,tick:100,zones}]).pass,true);
  const tampered=verifyCanonicalSchedule(contract,crossings,[{op:"zones",seed:0,tick:100,zones:[]}]);
  assert.equal(tampered.pass,false);
  assert.match(tampered.error,/canonical scheduler disagrees/);
});

test("canonical acceptance executes every tier on shifted tracer bars",()=>{
  const source=structuredClone(loadTrack("tracks/oval.json"));
  source.zones.ice=[];
  source.iceLayers=[];
  const contract=liveContract(source);
  contract.tracer={enabled:true,fromLap:1,periodBars:3};
  const crossings=[{lap:1,tick:0},{lap:2,tick:10000},{lap:3,tick:20000},{lap:4,tick:30000}];
  // Base strikes on bars 1,4,7. LEARNER starts on bar2 and strikes
  // every4 bars, so bar2 must be admitted despite the base oracle's #f.
  const tick=barTick(contract,2);
  const stretch=contract.stretches.find(s=>s.to-s.from>920);
  const targetS=((stretch.from+stretch.to)/2-600+contract.length)%contract.length;
  const result=verifyCanonicalSchedule(contract,crossings,[
    {op:"zones",seed:0,tick,zones:[]},
    {op:"tracer",seed:0,tick,targetS,u:0,pass:false},
  ]);
  assert.equal(result.pass,true,result.error);
  assert.deepEqual(result.tiers.ids,["learner","courier","elite"]);
  assert.equal(result.tiers.states,3);
  assert.equal(result.tiers.targets,3);
  assert.equal(result.tiers.admitted,1);
});
