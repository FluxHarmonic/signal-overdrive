// Compare visibility interpretations. This is evidence for a design ruling,
// not an alternative passing gate or an exemption.
import fs from "node:fs";
import { loadTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition } from "./geometry.mjs";
import { DEFAULTS, pointAt, projectGround } from "./gates.mjs";

export function calibrate(g, camera = DEFAULTS) {
  const views = { bothEdges: [], centreline: [], innerEdge: [], anyRoadPoint: [] };
  let bends = 0;
  for (let i = 0; i < g.N; i++) {
    if (Math.abs(g.CURV_S[i]) < 1e-5) continue;
    bends++;
    const observer = pointAt(g, g.S[i] - camera.ahead);
    const left = projectGround(observer, pointAt(g, g.S[i], -1), camera);
    const right = projectGround(observer, pointAt(g, g.S[i], 1), camera);
    const centreline = projectGround(observer, pointAt(g, g.S[i]), camera);
    const innerEdge = g.CURV_S[i] > 0 ? right : left;
    const outcomes = {
      bothEdges: left.visible && right.visible,
      centreline: centreline.visible,
      innerEdge: innerEdge.visible,
      anyRoadPoint: left.visible || right.visible || centreline.visible,
    };
    for (const [name, visible] of Object.entries(outcomes)) {
      if (!visible) views[name].push({ sample: i, s: g.S[i], observer, left, right, centreline });
    }
  }
  const sampleScores = Object.fromEntries(Object.entries(views).map(([name, failures]) => [name, {
    checked: bends, failed: failures.length, firstFailure: failures[0] ?? null,
  }]));

  // Exploratory bend-entry interpretation. Signs split an S into two turns;
  // threshold sensitivity is reported, rather than selecting one that passes.
  const eventScores = [1 / 10000, 1 / 5000, 1 / 2500].map(threshold => {
    const signs = g.CURV_S.map(k => Math.abs(k) < threshold ? 0 : Math.sign(k));
    const events = [];
    for (let i = 0; i < g.N; i++) {
      if (!signs[i] || signs[i] === signs[(i - 1 + g.N) % g.N]) continue;
      const observer = pointAt(g, g.S[i] - camera.ahead);
      const entry = projectGround(observer, pointAt(g, g.S[i]), camera);
      const cue = projectGround(observer, pointAt(g, g.S[i] + 96), camera);
      events.push({ sample: i, s: g.S[i], entry, cue, pass: entry.visible && cue.visible });
    }
    return { threshold, checked: events.length, failed: events.filter(e => !e.pass).length, events };
  });
  return { ahead: camera.ahead, sampleScores, eventScores };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [output, ...files] = process.argv.slice(2);
  if (!output || !files.length) throw new Error("usage: calibrate.mjs output.json tracks/*.json");
  const results = files.map(file => {
    const source = loadTrack(file);
    const g = sampleDefinition(trackDefinition(source));
    return { id: source.id, ...calibrate(g) };
  });
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
  for (const result of results) console.log(JSON.stringify({
    id: result.id,
    samples: Object.fromEntries(Object.entries(result.sampleScores).map(([name, score]) => [name, `${score.failed}/${score.checked} fail`])),
    bendEntries: result.eventScores.map(score => ({ threshold: score.threshold, failed: score.failed, checked: score.checked })),
  }));
}
