import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTrack, validateTrack } from "./format.mjs";
import { ICE_RULES, liveContract, contractList, sigilData, mergeArcs,
  buildStretches, barTick, layerLive, layoutAt } from "./schedule.mjs";

const source = () => structuredClone(loadTrack("tracks/oval.json"));
test("music annotations preserve an authored drone schedule binding",()=>{
  const track=source();
  track.musicZones.push({id:"swarm-drone",kind:"drone",from:.2,to:.3,sections:["traced"]});
  track.iceLayers=[{id:"swarm",fromLap:3,phraseBars:4,upBars:1,downBars:1,phaseBars:1,
    layouts:[{id:"left",zones:[[.2,.3,-1,-.2]]}]}];
  validateTrack(track);
  assert.equal(liveContract(track).layers.find(layer=>layer.id==="swarm").kind,"drone");
});
test("author schedule fields use drone and reject unknown/malformed cadence", () => {
  const track = source();
  track.iceLayers = [{ id:"swarm", kind:"drone", fromLap:2, phraseBars:4,
    upBars:1, downBars:1, phaseBars:1, layouts:[{id:"left", zones:[[.2,.3,-1,-.2]]}] }];
  assert.equal(validateTrack(track), track);
  for (const patch of [{kind:"swarm"}, {upBars:0}, {downBars:-1}, {phaseBars:.5}, {fromLap:4}]) {
    const bad = structuredClone(track);
    Object.assign(bad.iceLayers[0], patch);
    assert.throws(() => validateTrack(bad));
  }
  assert.throws(() => validateTrack({...track,iceLayers:[{...track.iceLayers[0],kind:"seeded-static"}]}), /seeded-static/);
});
test("runtime contract preserves cadence and immutable tracer dimensions", () => {
  const track = source();
  track.iceLayers = [{ id:"wall", kind:"firewall", fromLap:2, phraseBars:4,
    upBars:1, downBars:1, phaseBars:1, layouts:[{id:"left",zones:[[.2,.3,-1,.2]]}] }];
  const c = liveContract(track);
  const layer = c.layers.find(l => l.id === "wall");
  assert.deepEqual([layer.kind,layer.fromLap,layer.phraseBars,layer.upBars,layer.downBars,layer.phaseBars],
    ["firewall",2,4,1,1,1]);
  assert.equal(c.rules.tracerHalfLength * 2, 920);
  assert.equal(c.rules.tracerHalfWidth * 2, 68);
  assert.equal(c.rules.tracerAhead, 600);
  assert.equal(c.rules.lane, 27);
  assert.equal(c.rules.neighbour, 960);
  assert.equal(contractList(c)[6][1][1], "firewall");
  assert.match(sigilData(contractList(c)), /^\(1 /);
  assert.throws(() => validateTrack({...track,tracer:{halfWidth:1}}));
});
test("stretches merge through the lap seam and retain every owner", () => {
  const result = mergeArcs([{from:-200,to:300,owners:["a"]},
    {from:5900,to:6200,owners:["b"]}],6000);
  assert.equal(result.length,1);
  assert.equal(result[0].from,5800);
  assert.equal(result[0].to,6300);
  assert.deepEqual(new Set(result[0].owners),new Set(["a","b"]));
});
test("an ICE stretch reserves the whole physical run plus300, not only its patch", () => {
  const g={N:6,LENGTH:6000,S:[0,1000,2000,3000,4000,5000,6000],CURV_S:[0,0,.001,.001,0,0]};
  const stretches=buildStretches(g,[{id:"static",layouts:[{zones:[[100,200,-1,0]]}]}]);
  const occupied=stretches.find(s=>s.owners.includes("static"));
  assert.deepEqual([occupied.from,occupied.to],[3700,8300]);
  assert.ok(stretches.some(s=>s.owners.length===0 && s.from===2300 && s.to===3700));
  assert.equal(ICE_RULES.padding,300);
});
test("cadence starts on a downbeat after a full telegraph bar and phase selects layouts", () => {
  const c=liveContract(source());
  const crossings=[{tick:500},{tick:2300},{tick:4100},{tick:5900}];
  const layer={kind:"firewall",fromLap:2,phraseBars:4,upBars:1,downBars:1,phaseBars:0,
    layouts:[{id:"left"},{id:"right"}]};
  // crossing2300 is in bar22; bar23 telegraphs, first eligible bar24 rises.
  assert.equal(layerLive(c,layer,crossings,barTick(c,23)),false);
  assert.equal(layerLive(c,layer,crossings,barTick(c,24)),true);
  assert.equal(layerLive(c,layer,crossings,barTick(c,25)),false);
  assert.equal(layoutAt(layer,24,0).id,"left");
  assert.equal(layoutAt(layer,28,0).id,"right");
});
