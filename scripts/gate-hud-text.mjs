// gate-hud-text.mjs DIR NAME: scripts/gate-hud-text's judgement of one
// tier's shots (DIR/s000.png ...). For each line, the shots it is in (its
// colour's pixels in its box at least MIN), its span (first to last), and
// the shots in the span it is missing from. Prints one line a line and
// exits 0 (whole), 1 (a line under the band missing within its span) or 2
// (a line never seen or barely seen; at CRITICAL, LAP never dropping out).
import fs from "node:fs";
import path from "node:path";
import { readRGBA } from "./art/gen-logo.mjs";

const [dir, name] = process.argv.slice(2);
// boxes in view pixels (scale 1): x y w h, the line's colour, and the
// fewest shots its span must cover for the check to mean something
const LINES = [
  { key: "card", box: [70, 58, 340, 10], colour: 0x4df2d9, span: 20, under: true },   // DELIVER THE SIGNAL TO THE UPLINK.
  { key: "count", box: [200, 94, 80, 32], colour: 0xffcc33, span: 4, under: true },   // 3, 2, 1
  { key: "go", box: [190, 88, 100, 32], colour: 0x4df2d9, span: 4, under: true },     // GO
  { key: "lap", box: [6, 6, 100, 18], colour: 0xcce6ff, span: 20, under: false },     // LAP 1/3, in the band
];
const MIN = 40;

const shots = fs.readdirSync(dir).filter((f) => /^s\d+\.png$/.test(f)).sort();
const counts = shots.map((f) => {
  const img = readRGBA(path.join(dir, f));
  return LINES.map(({ box: [x0, y0, w, h], colour }) => {
    let n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const k = (y * img.w + x) * 4;
      if (((img.px[k] << 16) | (img.px[k + 1] << 8) | img.px[k + 2]) === colour) n++;
    }
    return n;
  });
});
let code = 0;
const say = [];
LINES.forEach((l, i) => {
  const on = counts.map((c) => c[i] >= MIN);
  const first = on.indexOf(true), last = on.lastIndexOf(true);
  if (first < 0) { say.push(`${l.key}: never seen`); code = Math.max(code, 2); return; }
  const span = last - first + 1;
  const holes = [];
  for (let k = first; k <= last; k++) if (!on[k]) holes.push(k);
  say.push(`${l.key}: span ${span} shots (${first}..${last}), missing from ${holes.length}${holes.length ? ` (${holes.slice(0, 8).join(" ")})` : ""}`);
  if (span < l.span) { say.push(`  ${l.key}: span under ${l.span} shots, too short to judge`); code = Math.max(code, 2); }
  if (l.under && holes.length) code = Math.max(code === 2 ? 2 : 1, 1);
  if (!l.under && name === "critical" && !holes.length) { say.push("  lap: never dropped out at CRITICAL: the dropouts did not run"); code = 2; }
});
console.log(`${name}: ${shots.length} shots`);
for (const s of say) console.log(`  ${s}`);
process.exit(code);
