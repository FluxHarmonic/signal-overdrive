import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTrack } from "./format.mjs";
import { combinedIce, corridor, tracerAllowed, auditTracerEvents } from "./combined-ice.mjs";
import { liveContract, barTick, mod, layoutAt } from "./schedule.mjs";

const timing={crossings:[{lap:1,tick:500},{lap:2,tick:2300},{lap:3,tick:4100},{lap:4,tick:5900}]};
const source=()=>{
  const t=structuredClone(loadTrack("tracks/oval.json"));
  t.role="race";t.zones.ice=[];t.iceLayers=[];t.tracer={enabled:false};
  return t;
};
const layer=(id,kind,zones,extra={})=>({id,kind,fromLap:3,phraseBars:0,
  upBars:1,downBars:0,phaseBars:0,layouts:[{id:"live",zones}],...extra});
const eventFor=(c,center,tick=barTick(c,42))=>({tick,until:tick+6,telegraphTick:barTick(c,41),
  targetS:mod(center-600,c.length),center,u:0,halfLength:460,halfWidth:34,seed:0});

test("rule1 sabotage: individually fair firewall and swarm close the road in union",()=>{
  const t=source();
  t.iceLayers=[layer("wall","firewall",[[.2,.3,-1,.2]])];
  assert.equal(combinedIce(t,timing).pass,true);
  t.iceLayers.push(layer("swarm","drone",[[.2,.3,.2,1]]));
  const r=combinedIce(t,timing);
  assert.equal(r.rules[1].pass,false);
  assert.equal(r.rules[2].pass,false);
  assert.equal(r.narrowest,0);
});
test("rule2 sharing requires every seeded layout to prove the combined corridor",()=>{
  const t=source();
  t.iceLayers=[layer("wall","firewall",[[.2,.3,-1,.2]]),
    layer("swarm","drone",[[.2,.3,-1,-.2]])];
  const good=combinedIce(t,timing);
  assert.equal(good.pass,true);
  assert.ok(good.ownershipProofs>0);
  t.iceLayers[1].layouts.push({id:"opposite",zones:[[.2,.3,.2,1]]});
  assert.equal(combinedIce(t,timing).rules[2].pass,false);
});
test("rule1 sabotage: a tracer without a full telegraph bar fails",()=>{
  const t=source();t.tracer.enabled=true;
  const c=liveContract(t),s=c.stretches.find(s=>s.to-s.from>920);
  const e=eventFor(c,mod((s.from+s.to)/2,c.length));
  assert.equal(auditTracerEvents(c,timing.crossings,[e]).pass,true);
  e.telegraphTick=e.tick-1;
  assert.equal(auditTracerEvents(c,timing.crossings,[e]).failures[0].rule,1);
});
test("rule3 sabotage: static ICE owns its whole merged stretch, not just the patch",()=>{
  const t=source();t.tracer.enabled=true;t.zones.ice=[[.2,.21,-1,.2]];
  const c=liveContract(t),s=c.stretches.find(s=>s.owners.includes("$road")&&s.to-s.from>=920);
  const e=eventFor(c,mod((s.from+s.to)/2,c.length));
  const audit=auditTracerEvents(c,timing.crossings,[e]);
  assert.equal(audit.pass,false);
  assert.equal(audit.failures[0].rule,3);
  assert.equal(audit.failures[0].planned.reason,"owned-during-life-plus-bar");
});
test("rule3 sabotage: centre fits but whole920 strip crosses the stretch boundary",()=>{
  const t=source();t.tracer.enabled=true;
  const c=liveContract(t),s=c.stretches.find(s=>s.to-s.from>920);
  const e=eventFor(c,mod(s.from+100,c.length));
  assert.equal(auditTracerEvents(c,timing.crossings,[e]).failures[0].rule,3);
});
test("rule3 sabotage: a hazard due next bar reserves the tracer's full life plus a bar",()=>{
  const t=source();t.tracer.enabled=true;
  t.iceLayers=[layer("wall","firewall",[[.2,.3,-1,.2]],{upBars:1,downBars:1,phaseBars:1})];
  const c=liveContract(t),s=c.stretches.find(s=>s.owners.includes("wall")&&s.to-s.from>=920);
  const e=eventFor(c,mod((s.from+s.to)/2,c.length));
  assert.equal(auditTracerEvents(c,timing.crossings,[e]).failures[0].planned.reason,"owned-during-life-plus-bar");
});
test("rule3 legal tracer waits/rejects an overlapping prior reservation",()=>{
  const t=source();t.tracer.enabled=true;
  const c=liveContract(t),s=c.stretches.find(s=>s.to-s.from>920);
  const center=mod((s.from+s.to)/2,c.length),e=eventFor(c,center);
  const slot=tracerAllowed(c,timing.crossings,0,e.tick,e.targetS,0);
  assert.equal(slot.pass,true);
  const blocked=tracerAllowed(c,timing.crossings,0,barTick(c,43),e.targetS,0,
    [{tick:e.tick,until:slot.until,stretch:slot.stretch}]);
  assert.equal(blocked.pass,false);
  assert.equal(blocked.reason,"tracer-reservation-overlap");
});
test("rule4 sabotage: opposite-side phrase swap needs a complete rest bar",()=>{
  const t=source();
  t.iceLayers=[layer("wall","firewall",[],{phraseBars:1,layouts:[
    {id:"left",zones:[[.2,.3,-1,.2]]},{id:"right",zones:[[.2,.3,-.2,1]]}]})];
  assert.equal(combinedIce(t,timing).rules[4].pass,false);
  Object.assign(t.iceLayers[0],{upBars:1,downBars:1,phraseBars:2});
  assert.notEqual(layoutAt(t.iceLayers[0],42,0).id,layoutAt(t.iceLayers[0],44,0).id);
  assert.equal(combinedIce(t,timing).pass,true);
});
test("rule4 applies to opposite swarm sides even with a narrow middle corridor",()=>{
  const t=source();
  t.iceLayers=[layer("swarm","drone",[],{phraseBars:1,layouts:[
    {id:"left",zones:[[.2,.3,-1,-.2]]},{id:"right",zones:[[.2,.3,.2,1]]}]})];
  const r=combinedIce(t,timing);
  assert.equal(r.rules[1].pass,true);
  assert.equal(r.rules[4].pass,false);
});
test("rule5 sabotage: close neighbours force a lane crossing despite local free lanes",()=>{
  const t=source();
  t.iceLayers=[layer("a","firewall",[[.2,.21,-1,.2]]),layer("b","firewall",[[.25,.26,-.2,1]])];
  const r=combinedIce(t,timing);
  assert.equal(r.rules[1].pass,true);
  assert.equal(r.rules[5].pass,false);
  assert.ok(r.rules[5].firstFailure.distance<960);
});
test("rule5 wraps over the start line and uses the strict960 distance",()=>{
  const t=source();t.zones.ice=[[.97,.99,-1,.2],[.01,.03,-.2,1]];
  assert.equal(combinedIce(t,timing).rules[5].pass,false);
  const c=liveContract(source());
  c.length=10000;
  const zones=[{owner:"a",zone:[1000,1100,-1,.2]},{owner:"b",zone:[2060,2160,-.2,1]}];
  assert.equal(corridor(c,zones).pass,true);
  zones[1].zone[0]-=.01;
  assert.equal(corridor(c,zones).pass,false);
});
test("cover sabotages: firewall61%, drone41%, and any checksum overlap fail",()=>{
  for(const [kind,right] of [["firewall",.22],["drone",-.18]]){
    const t=source();t.iceLayers=[layer("hazard",kind,[[.2,.3,-1,right]])];
    assert.equal(combinedIce(t,timing).rules[6].pass,false);
  }
  const t=source();t.iceLayers=[layer("wall","firewall",[[.9,.95,-1,.2]])];
  assert.equal(combinedIce(t,timing).rules[6].firstFailure.reason,"checksum-lane");
});
test("rivals do not count; unbound overrides and missing timing are rejected",()=>{
  const t=source();
  assert.deepEqual(combinedIce(t,{...timing,rivals:[{zone:[0,1,-1,1]}]}),combinedIce(t,timing));
  assert.throws(()=>combinedIce(t,{lapTicks:[1800,1800,1800]}),/actual ordered/);
  assert.throws(()=>combinedIce(t,timing,{layers:{}}),/track data/);
  assert.throws(()=>combinedIce(t,{...timing,id:"other"}),/another track/);
});

test("live runtime queries need observed history, not knowledge of the finish time",()=>{
  const t=source();t.tracer.enabled=true;
  const c=liveContract(t),s=c.stretches.find(s=>s.to-s.from>920);
  const e=eventFor(c,mod((s.from+s.to)/2,c.length));
  const partial=timing.crossings.map(e=>({...e}));partial[3].tick=false;
  assert.equal(tracerAllowed(c,partial,0,e.tick,e.targetS,0).pass,true);
  partial[2].tick=false;
  assert.equal(tracerAllowed(c,partial,0,e.tick,e.targetS,0).pass,false);
});

test("a not-yet-observed future owner cannot establish a free tracer reservation",()=>{
  const t=source();t.tracer={enabled:true,fromLap:2};
  t.iceLayers=[layer("wall","firewall",[[.2,.3,-1,.2]])];
  const c=liveContract(t),s=c.stretches.find(s=>s.owners.includes("wall")&&s.to-s.from>920);
  const e=eventFor(c,mod((s.from+s.to)/2,c.length));
  const partial=timing.crossings.map(e=>({...e}));partial[2].tick=false;partial[3].tick=false;
  assert.equal(tracerAllowed(c,partial,0,e.tick,e.targetS,0).reason,"unknown-future-owner");
});
