// Fast, file-only authoring preview; no server, browser or game loop required.
import fs from "node:fs";
import path from "node:path";
import { loadTrack } from "./format.mjs";
import { sampleDefinition, trackDefinition } from "./geometry.mjs";
import { DEFAULTS, geometryGates, pointAt } from "./gates.mjs";

const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const colors = ["#3be8da", "#ffa04b", "#d691ff", "#a6d46b", "#ff74aa", "#a6bbff"];

export function timeline(source, g, contract) {
  if (contract.id !== source.song.id || contract.cues !== source.song.cues
    || contract.bpm !== source.song.bpm) throw new Error("track binding disagrees with exported song contract");
  const section = mark => {
    const found = contract.sections.find(s => s.mark === mark);
    if (!found) throw new Error(`missing conductor mark ${mark}`);
    return found;
  };
  const lapSeconds = g.LENGTH / contract.camera.top;
  const barSeconds = contract.barSeconds;
  const gridSeconds = section("grid").bars * barSeconds;
  const entries = source.song.sections.map(target => {
    const distance = ((target.targetLap ?? target.lap) - 1 + (target.targetAt ?? target.at)) * g.LENGTH;
    const targetSeconds = gridSeconds + distance / contract.camera.top;
    const idealSeconds = targetSeconds - (target.leadBars ?? 0) * barSeconds;
    const aimedSeconds = Math.round(idealSeconds / barSeconds) * barSeconds;
    const progress = (aimedSeconds - gridSeconds) / lapSeconds;
    return { ...target, ...section(target.mark), targetSeconds, aimedSeconds,
      aimErrorSeconds: aimedSeconds - idealSeconds,
      lapAtAim: Math.floor(progress) + 1, fractionAtAim: ((progress % 1) + 1) % 1 };
  });
  return { description: "Ideal constant top-speed crossing predictions, quantized to nearest song bar. Actual autopilot conductor landings are a separate replay measurement.",
    lapSeconds, gridSeconds, barSeconds, entries };
}

export function previewSvg(source, g, song, gates, driven = null) {
  const height = driven ? 1400 : 1100;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}">`,
    '<style>text{font:16px monospace;fill:#e3e3ec}.small{font-size:13px}.title{font-size:28px}</style>',
    `<rect width="1200" height="${height}" fill="#151321"/>`,
    `<text class="title" x="32" y="44">${escape(source.title)} · ${escape(source.id)}</text>`,
    `<text x="32" y="76">${g.LENGTH.toFixed(1)} texels · ${song.lapSeconds.toFixed(2)} s at top speed · ${source.song.bpm} BPM</text>`,
    '<g transform="translate(20 100) scale(.15)">'];
  const polyline = (points, width, color, extra = "") => `<polyline points="${points.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`;
  const range = (from, to, u = 0) => {
    const points = [];
    for (let s = from * g.LENGTH; s < to * g.LENGTH; s += 16) {
      const p = pointAt(g, s, u);
      points.push([p.x, p.y]);
    }
    const end = pointAt(g, to * g.LENGTH, u);
    return [...points, [end.x, end.y]];
  };
  parts.push(polyline([...g.P, g.P[0]], 2 * (g.HW + 14), "#737383"));
  source.sections.forEach((section, i) => parts.push(polyline(range(section.from, section.to), g.HW * 2, colors[i % colors.length], 'stroke-opacity=".38"')));
  const zone = (z, color, dashed = false) => parts.push(polyline(range(z[0], z[1], (z[2] + z[3]) / 2), (z[3] - z[2]) * g.HW, color,
    dashed ? 'stroke-dasharray="25 18" stroke-opacity=".6"' : ""));
  for (const [f, l, r] of source.zones.boost) zone([f, f + 100 / g.LENGTH, l, r], "#ffd36e");
  zone(source.zones.repair, "#3be8da");
  source.zones.ice.forEach(z => zone(z, "#ff7457"));
  for (const layer of source.iceLayers) for (const layout of layer.layouts) layout.zones.forEach(z => zone(z, "#ffa04b", true));
  const racing = g.P.map(([x, y], i) => [x - g.TAN[i][1] * g.LINE[i] * g.HW, y + g.TAN[i][0] * g.LINE[i] * g.HW]);
  parts.push(polyline([...racing, racing[0]], 7, "#fff4c2"));
  const a = pointAt(g, 0, -1), b = pointAt(g, 0, 1);
  parts.push(polyline([[a.x, a.y], [b.x, b.y]], 24, "white"));
  for (const event of gates.readability.events) {
    parts.push(`<circle cx="${event.entrance.x}" cy="${event.entrance.y}" r="38" fill="${event.pass ? "#a6d46b" : "#ff5353"}"/>`,
      `<text x="${event.entrance.x + 45}" y="${event.entrance.y}" style="font-size:85px">${event.sample}</text>`);
  }
  parts.push("</g>");
  let y = 126;
  source.sections.forEach((section, i) => {
    parts.push(`<rect x="670" y="${y - 12}" width="16" height="16" fill="${colors[i % colors.length]}"/>`,
      `<text x="698" y="${y}">${escape(section.label)} (${section.from}–${section.to})</text>`);
    y += 27;
  });
  y += 28;
  for (const [name, gate] of Object.entries(gates)) {
    parts.push(`<text x="670" y="${y}">${gate.exempt ? "EXEMPT" : gate.pass ? "PASS" : "FAIL"} ${escape(name)}</text>`);
    y += 26;
  }
  parts.push('<text x="32" y="758">Song targets across three laps — ideal top-speed prediction</text>');
  for (let lap = 1; lap <= 3; lap++) {
    const row = 785 + (lap - 1) * 70;
    parts.push(`<text x="32" y="${row + 20}">Lap ${lap}</text>`, `<rect x="125" y="${row}" width="1000" height="35" fill="#333144"/>`);
    for (const entry of song.entries) {
      if (entry.lapAtAim !== lap && !(entry.mark === "uplink" && lap === 3)) continue;
      const fraction = entry.mark === "uplink" ? 1 : entry.fractionAtAim;
      const x = 125 + Math.min(1, fraction) * 1000;
      parts.push(`<line x1="${x}" x2="${x}" y1="${row}" y2="${row + 35}" stroke="#ffa04b" stroke-width="3"/>`,
        `<text class="small" text-anchor="${fraction > .85 ? "end" : "start"}" x="${x}" y="${row + 54}">${escape(entry.mark)} ${entry.aimedSeconds.toFixed(2)}s</text>`);
    }
  }
  parts.push('<text class="small" x="32" y="1025">Grid precedes GO. Fill aims two bars before traced; results follows the uplink coda.</text>',
    '<text class="small" x="32" y="1051">Dashed orange: all authored seed alternatives overlaid; gates check each combination separately.</text>',
    '<text class="small" x="32" y="1077">Actual race speed and committed predictions can move landings. The driven probe uses the game conductor.</text>');
  if (driven) {
    parts.push(`<text x="32" y="1120">Actual AI landings · best lap ${driven.bestLapSeconds == null ? "n/a" : driven.bestLapSeconds.toFixed(3)} s · all six racers: ${driven.threeLapsAllRacers ? "finished" : "incomplete"}</text>`);
    for (let lap = 1; lap <= 3; lap++) {
      const row = 1145 + (lap - 1) * 65;
      parts.push(`<text x="32" y="${row + 20}">Lap ${lap}</text>`, `<rect x="125" y="${row}" width="1000" height="30" fill="#333144"/>`);
      for (const entry of driven.landings) {
        const entryLap = entry.mark === "lap1" ? 1 : entry.lap;
        if (entryLap !== lap || entry.mark === "results") continue;
        const fraction = entry.mark === "lap1" ? 0 : entry.finishTick > 0 ? 1 : entry.s / g.LENGTH;
        const x = 125 + fraction * 1000;
        parts.push(`<line x1="${x}" x2="${x}" y1="${row}" y2="${row + 30}" stroke="#3be8da" stroke-width="3"/>`,
          `<text class="small" text-anchor="${fraction > .85 ? "end" : "start"}" x="${x}" y="${row + 49}">${escape(entry.mark)} ${(entry.tick / 60).toFixed(2)}s</text>`);
      }
    }
    const results = driven.landings.find(entry => entry.mark === "results");
    parts.push(`<text class="small" x="32" y="1375">${results ? `Results after coda at ${(results.tick / 60).toFixed(2)} s.` : "Probe has not reached the results coda."} Times include grid; post-finish landings use the finish boundary.</text>`);
  }
  parts.push('</svg>');
  return parts.join("\n");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [trackPath, contractPath, output = "build/track", drivenPath] = process.argv.slice(2);
  if (!trackPath || !contractPath) throw new Error("usage: node scripts/track/preview.mjs tracks/<id>.json <song-contract.json> [output-directory] [ai-report.json]");
  const source = loadTrack(trackPath);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const driven = drivenPath ? JSON.parse(fs.readFileSync(drivenPath, "utf8")) : null;
  if (driven && (driven.id !== source.id || driven.activeSong !== contract.id)) throw new Error("AI report belongs to a different track or song");
  const g = sampleDefinition(trackDefinition(source));
  const gates = geometryGates(source, g, { ...DEFAULTS, ...contract.camera });
  const song = timeline(source, g, contract);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${source.id}-preview.svg`), previewSvg(source, g, song, gates, driven));
  fs.writeFileSync(path.join(output, `${source.id}-report.json`), JSON.stringify({ id: source.id, gates, song, actual: driven }, null, 2) + "\n");
  console.log(JSON.stringify({ id: source.id, gates }));
  if (Object.values(gates).some(gate => !gate.pass)) process.exitCode = 1;
}
