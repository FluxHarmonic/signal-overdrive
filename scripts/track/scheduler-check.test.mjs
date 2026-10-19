// Phantom-only: these tests execute the installed game-language interpreter.
import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyCanonicalSchedule} from "./scheduler-check.mjs";
import {loadTrack} from "./format.mjs";
import {liveContract,zonesAt} from "./schedule.mjs";

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
