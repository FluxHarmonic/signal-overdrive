// Approved Neon Row section3 contract. No unbound external policy overrides.
import fs from "node:fs";
import { verifyCanonicalSchedule } from "./scheduler-check.mjs";
import { loadTrack, worldSize } from "./format.mjs";
import { liveContract, splitArc, arcsOverlap, mod, barAt, barTick, firstBar,
  zonesAt, layerLive, layoutAt, tracerReservation } from "./schedule.mjs";

export function freeIntervals(intervals) {
  let edge = -1;
  const free = [];
  for (const [left, right] of [...intervals].sort((a,b) => a[0]-b[0])) {
    if (left > edge) free.push([edge, left]);
    edge = Math.max(edge, right);
  }
  if (edge < 1) free.push([edge, 1]);
  return free;
}
const widest = intervals => Math.max(0, ...freeIntervals(intervals).map(([a,b]) => b-a));
function distance(a, b, length) {
  if (arcsOverlap(a, b, length)) return 0;
  return Math.min(mod(b[0]-a[1], length), mod(a[0]-b[1], length));
}

export function corridor(contract, zones) {
  const length = contract.length, half = contract.halfWidth;
  const ends = [...new Set([0, length, ...zones.flatMap(({zone}) => splitArc(zone[0],zone[1],length).flat())])].sort((a,b) => a-b);
  // Closed footprints change only at endpoints. Every interior occupied set
  // is a subset of an endpoint set; closest gaps between disjoint sets are
  // also attained at endpoints. Include0/L to union the lap seam.
  const probes = ends.map(s => [s,s]);
  const slices = probes.map(([from,to]) => {
    const s = (from+to)/2;
    const active = zones.filter(({zone}) => arcsOverlap([s,s], zone, length));
    return {from,to,s,intervals:active.map(z => z.zone.slice(2)),owners:[...new Set(active.map(z => z.owner))]};
  }).filter(s => s.intervals.length);
  let minimum = 2*half, first = null, neighbour = null;
  for (const slice of slices) {
    const width = widest(slice.intervals)*half;
    if (width < minimum) { minimum=width; first={...slice,width}; }
  }
  // Compare complete occupied cross-sections, not individual patches.
  let sharedMinimum = 2*half;
  for (let i=0; i<slices.length; i++) for (let j=i+1; j<slices.length; j++) {
    const a=slices[i], b=slices[j];
    const apart = distance([a.from,a.to],[b.from,b.to],length);
    if (apart >= contract.rules.neighbour-1e-8) continue;
    const width = widest([...a.intervals,...b.intervals])*half;
    if (width < sharedMinimum) { sharedMinimum=width; neighbour={a,b,distance:apart,width}; }
  }
  return {pass:minimum+1e-8>=contract.rules.lane && sharedMinimum+1e-8>=contract.rules.lane,
    minimum,sharedMinimum,first,neighbour};
}

function validateTiming(source, timing) {
  if (timing.id!==undefined && timing.id!==source.id) throw new Error("ICE timing belongs to another track");
  const world = worldSize(source);
  if (timing.world!==undefined && (timing.world?.width!==world.width || timing.world?.height!==world.height)) throw new Error("ICE timing world dimensions disagree with track");
  const crossings = timing.crossings;
  if (!Array.isArray(crossings) || crossings.length!==4 || crossings.some((e,i) => e.lap!==i+1
    || !Number.isInteger(e.tick) || e.tick<0 || (i && e.tick<=crossings[i-1].tick))) throw new Error("combined ICE needs actual ordered lap 1..4 crossing ticks");
}

function sideChange(contract, oldLayout, newLayout) {
  return oldLayout.zones.some(a => newLayout.zones.some(b => {
    if (!arcsOverlap(a,b,contract.length)) return false;
    const oldSide=Math.sign(a[2]+a[3]), newSide=Math.sign(b[2]+b[3]);
    return oldSide*newSide<0 || widest([a.slice(2),b.slice(2)])*contract.halfWidth+1e-8<contract.rules.lane;
  }));
}

function lateralTargets(contract, zones) {
  const half=contract.rules.tracerHalfWidth/contract.halfWidth;
  const radius=9/contract.halfWidth, lo=-1+radius, hi=1-radius;
  const bounds=[-1,1,...zones.flatMap(z => z.zone.slice(2))];
  const points=[lo,hi];
  for (const x of bounds) points.push(x-half,x+half);
  for (const a of bounds) for (const b of bounds) if (a<b) points.push((a+b)/2);
  return [...new Set(points.map(x => Math.max(lo,Math.min(hi,x))))];
}

function longitudinalTargets(contract, stretch, zones) {
  const half=contract.rules.tracerHalfLength;
  if (stretch.to-stretch.from<2*half) return [];
  const lo=stretch.from+half, hi=stretch.to-half, points=[lo,hi];
  // Every occupancy and960-neighbour breakpoint, plus intervening cells.
  for (const item of zones) for (const end of item.zone.slice(0,2)) {
    for (const delta of [-half,half,-half-contract.rules.neighbour,half+contract.rules.neighbour]) {
      for (const wrap of [-1,0,1,2]) {
        const p=end+delta+wrap*contract.length;
        if (p>lo && p<hi) points.push(p);
      }
    }
  }
  points.sort((a,b) => a-b);
  return [...new Set([...points,...points.slice(1).map((p,i) => (p+points[i])/2)])].map(p => mod(p,contract.length));
}

export function tracerFootprint(contract, center, u) {
  const r=contract.rules;
  return {owner:"$tracer",kind:"tracer",layout:"target",
    zone:[center-r.tracerHalfLength,center+r.tracerHalfLength,
      Math.max(-1,u-r.tracerHalfWidth/contract.halfWidth),Math.min(1,u+r.tracerHalfWidth/contract.halfWidth)]};
}

export function tracerAllowed(contract, crossings, seed, tick, targetS, u, reservations=[]) {
  const r=contract.rules, bar=barAt(contract,tick);
  if (!Number.isInteger(seed) || seed<0 || !Number.isFinite(targetS) || !Number.isFinite(u)
    || Math.abs(u)>1-9/contract.halfWidth+1e-8) return {pass:false,reason:"invalid-tracer-target"};
  if (!Number.isFinite(crossings[contract.tracer.fromLap-1]?.tick)) return {pass:false,reason:"tracer-lap-not-started"};
  const start=firstBar(contract,crossings[contract.tracer.fromLap-1].tick)+r.telegraphBars;
  if (!contract.tracer.enabled || tick!==barTick(contract,bar) || bar<start
    || mod(bar-start,contract.tracer.periodBars)
    || (Number.isFinite(crossings[3]?.tick) && tick>=crossings[3].tick)) return {pass:false,reason:"tracer-not-eligible-downbeat"};
  const center=mod(targetS+r.tracerAhead,contract.length);
  const reservation=tracerReservation(contract,crossings,seed,tick,center,reservations);
  if (!reservation.pass) return {...reservation,center};
  const result=corridor(contract,[...zonesAt(contract,crossings,seed,tick),tracerFootprint(contract,center,u)]);
  if (!result.pass) return {pass:false,reason:"tracer-neighbour-or-lane",center,corridor:result};
  return {...reservation,center,telegraphTick:barTick(contract,bar-r.telegraphBars),corridor:result};
}

export function auditTracerEvents(contract, crossings, events) {
  const failures=[], reservations=[];
  for (const event of [...events].sort((a,b) => a.tick-b.tick)) {
    if (!["tick","until","telegraphTick","targetS","u","center","halfLength","halfWidth"].every(k => Number.isFinite(event[k]))) {
      failures.push({rule:1,reason:"malformed-runtime-event",event});
      continue;
    }
    const r=contract.rules, bar=barAt(contract,event.tick);
    const expectedCenter=mod(event.targetS+r.tracerAhead,contract.length);
    const planned=tracerAllowed(contract,crossings,event.seed??0,event.tick,event.targetS,event.u,reservations);
    let rule=null, reason=null;
    if (event.tick!==barTick(contract,bar) || !Number.isInteger(event.telegraphTick)
      || event.telegraphTick>barTick(contract,bar-r.telegraphBars)) { rule=1; reason="telegraph-shorter-than-bar"; }
    else if (Math.abs(event.center-expectedCenter)>1e-6 || event.until!==event.tick+r.tracerLifeTicks
      || event.halfLength!==r.tracerHalfLength || event.halfWidth!==r.tracerHalfWidth) { rule=3; reason="wrong-whole-strip-or-life"; }
    else if (!planned.pass) { rule=planned.reason==="tracer-neighbour-or-lane"?5:3; reason=planned.reason; }
    if (rule) failures.push({rule,reason,event,planned});
    else reservations.push({tick:event.tick,until:planned.until,stretch:planned.stretch});
  }
  return {pass:!failures.length,failures};
}

export function combinedIce(source, timing, policy, observe = () => {}) {
  if (policy!==undefined && Object.keys(policy).length) throw new Error("live ICE schedule belongs in track data; external policy overrides are forbidden");
  validateTiming(source,timing);
  const contract=liveContract(source), crossings=timing.crossings, r=contract.rules;
  const rules=Object.fromEntries([1,2,3,4,5,6].map(id => [id,{pass:true,firstFailure:null}]));
  const fail=(id,witness) => { if (rules[id].pass) rules[id]={pass:false,firstFailure:witness}; };
  let combinations=1;
  for (const layer of contract.layers) combinations*=layer.layouts.length;
  if (combinations>4096) throw new Error("combined ICE seed product exceeds4096");
  const firstTick=crossings[0].tick, finish=crossings[3].tick;
  const times=new Set(crossings.slice(0,3).map(e => e.tick));
  for (let b=barAt(contract,firstTick); barTick(contract,b)<finish; b++) if (barTick(contract,b)>=firstTick) times.add(barTick(contract,b));
  const ordered=[...times].sort((a,b) => a-b);
  const laps=crossings.slice(0,3).map((e,i) => ({lap:i+1,fromTick:e.tick,toTick:crossings[i+1].tick,narrowest:2*contract.halfWidth}));
  let narrowest=2*contract.halfWidth, checkedStates=0, ownershipProofs=0;
  const tracer={attempts:0,legalTargets:0,yieldedReservations:0,yieldedNeighbours:0,waitBars:0};
  const repair=[source.zones.repair[0]*contract.length,source.zones.repair[1]*contract.length,...source.zones.repair.slice(2)];
  for (const layer of contract.layers) for (const layout of layer.layouts) {
    if (!["firewall","drone"].includes(layer.kind)) continue;
    const limit=layer.kind==="firewall"?.6:.4;
    const ends=[...new Set(layout.zones.flatMap(z => z.slice(0,2)))].sort((a,b) => a-b);
    const probes=[...ends,...ends.slice(1).map((s,i) => (s+ends[i])/2)];
    for (const s of probes) {
      const intervals=layout.zones.filter(z => arcsOverlap([s,s],z,contract.length)).map(z => z.slice(2));
      const covered=2-freeIntervals(intervals).reduce((n,[a,b]) => n+b-a,0);
      if (covered>2*limit+1e-8) fail(6,{reason:"cover-limit",owner:layer.id,layout:layout.id,at:s,coveredFraction:covered/2,maximum:limit});
    }
    for (const zone of layout.zones) if (arcsOverlap(zone,repair,contract.length)
      && Math.max(zone[2],repair[2])<=Math.min(zone[3],repair[3])) fail(6,{reason:"checksum-lane",owner:layer.id,layout:layout.id,zone});
  }
  for (let seed=0; seed<combinations; seed++) {
    const previous=new Map();
    for (const tick of ordered) {
      const bar=barAt(contract,tick), lap=crossings.filter(e => e.tick<=tick).length;
      const zones=zonesAt(contract,crossings,seed,tick), base=corridor(contract,zones);
      observe({op:"zones",seed,tick,zones});
      observe({op:"corridor",zones,pass:base.pass});
      checkedStates++;
      narrowest=Math.min(narrowest,base.minimum,base.sharedMinimum);
      laps[lap-1].narrowest=Math.min(laps[lap-1].narrowest,base.minimum,base.sharedMinimum);
      const context={seed,tick,bar,lap};
      if (base.minimum+1e-8<r.lane) fail(1,{...context,reason:"combined-lane",...base.first});
      if (base.sharedMinimum+1e-8<r.lane) fail(5,{...context,reason:"neighbours-without-common-lane",...base.neighbour});
      for (const stretch of contract.stretches) {
        const owners=[...new Set(zones.filter(z => stretch.owners.includes(z.owner)
          && arcsOverlap([stretch.from,stretch.to],z.zone,contract.length)).map(z => z.owner))];
        if (owners.length>1) {
          ownershipProofs++;
          // Rule2's explicit exception requires universal combined proof.
          if (!base.pass) fail(2,{...context,reason:"multiple-owners-without-combined-proof",stretch:stretch.id,owners,corridor:base});
        }
      }
      let digits=seed;
      for (const layer of contract.layers) {
        const digit=digits%layer.layouts.length; digits=Math.floor(digits/layer.layouts.length);
        if (layer.kind==="seeded-static" || !layerLive(contract,layer,crossings,tick)) continue;
        const layout=layoutAt(layer,bar,digit);
        if (!layout.zones.length) continue;
        const old=previous.get(layer.id);
        if (old && old.bar!==bar && sideChange(contract,old.layout,layout) && bar-old.bar<2) {
          fail(4,{...context,reason:"opposite-side-swap-without-full-rest",owner:layer.id,from:old.layout.id,to:layout.id,lastLiveBar:old.bar});
        }
        previous.set(layer.id,{bar,layout});
      }
      const start=firstBar(contract,crossings[contract.tracer.fromLap-1].tick)+r.telegraphBars;
      if (!contract.tracer.enabled || tick!==barTick(contract,bar) || bar<start || mod(bar-start,contract.tracer.periodBars)) continue;
      tracer.attempts++;
      let legal=0;
      for (const stretch of contract.stretches) for (const center of longitudinalTargets(contract,stretch,zones)) {
        const reserve=tracerReservation(contract,crossings,seed,tick,center);
        if (!reserve.pass) {
          observe({op:"tracer",seed,tick,targetS:mod(center-r.tracerAhead,contract.length),u:0,pass:false});
          tracer.yieldedReservations++;
          continue;
        }
        for (const u of lateralTargets(contract,zones)) {
          const slot=tracerAllowed(contract,crossings,seed,tick,mod(center-r.tracerAhead,contract.length),u);
          observe({op:"tracer",seed,tick,targetS:mod(center-r.tracerAhead,contract.length),u,pass:slot.pass});
          if (!slot.pass) { tracer.yieldedNeighbours++; continue; }
          legal++; tracer.legalTargets++;
          narrowest=Math.min(narrowest,slot.corridor.minimum,slot.corridor.sharedMinimum);
          laps[lap-1].narrowest=Math.min(laps[lap-1].narrowest,slot.corridor.minimum,slot.corridor.sharedMinimum);
        }
      }
      if (!legal) tracer.waitBars++;
    }
  }
  const failures=Object.entries(rules).filter(([,v]) => !v.pass).map(([rule,v]) => ({rule:Number(rule),...v.firstFailure}));
  return {id:source.id,world:worldSize(source),crossings,pass:!failures.length,required:r.lane,
    narrowest,combinations,checkedStates,ownershipProofs,rules,tracer,
    narrowestScope:"finite layout/critical tracer witnesses; every admitted tracer target also passes the exact continuous corridor guard",
    stretches:contract.stretches,firstFailure:failures[0]??null,
    laps:laps.map(l => ({...l,pass:l.narrowest+1e-8>=r.lane})),
    timing:"actual lap crossings and exact conductor bar ticks",
    policySource:"approved Neon Row bible section3, track-authored cadence",
    runtimeParity:"same compiled schedule data; pure runtime queries verified separately; visual/collision activation remains integration work"};
}

if (process.argv[1]===new URL(import.meta.url).pathname) {
  const [trackFile,timingFile,output,policyFile]=process.argv.slice(2);
  if (!trackFile||!timingFile||!output||policyFile) throw new Error("usage: combined-ice.mjs track.json ai.json output.json (schedule is track data)");
  const source=loadTrack(trackFile), timing=JSON.parse(fs.readFileSync(timingFile));
  const queries=[];
  const result=combinedIce(source,timing,undefined,query=>queries.push(query));
  // Acceptance MUST execute the game's implementation. JS is an independent
  // diagnostic oracle only; unavailable runtime or any disagreement is RED.
  result.canonical=verifyCanonicalSchedule(liveContract(source),timing.crossings,queries);
  result.pass=result.pass && result.canonical.pass;
  result.runtimeParity="acceptance executes (signal ice schedule), the game's implementation; diagnostic disagreement fails closed";
  fs.writeFileSync(output,JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));
  if (!result.pass) process.exitCode=1;
}
