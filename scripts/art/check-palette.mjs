// check-palette.mjs - the Docklands district palette's checks.
//
//   node scripts/art/check-palette.mjs [--verbose]
//
// Docklands' palette is embers plus the seven DOCK colours (scripts/art/
// lib.mjs), listed as `docklands` in src/signal/dither.sgl. It exits 1 when:
//   - the two copies disagree (dither.sgl's list must be EMBERS then DOCK,
//     in order), or the palette is over PALETTE-MAX (60);
//   - a new colour is under 14 from any other colour (the post pass moves a
//     channel by up to 3.75, so closer colours can swap after the dither);
//   - a new colour is under 60 from a role colour other than magenta (P16);
//   - the glow check finds a regression it does not list as accepted.
//
// The glow check, after the Neon Row bible's, but against embers: each
// non-magenta role colour blended into the harbour's dark bases, as a fade
// (mix) and as additive light, in 5% steps, quantized to the nearest palette
// colour with the dither's spread of 8 as slack (any colour within 8 of the
// nearest can be picked). A REGRESSION is a step whose picks under docklands
// include the city's new colour (REFLECT_COLD, the cold signs' reflection)
// when its picks under embers did not: that role's light would newly show in
// the city's colour. Steps that land on the new ground colours (the water,
// the wet road, the fog, the sheen, the floodlight) are the ground the light
// falls on, counted with --verbose. It models a simple blend, not the
// shader; scripts/palette-runtime.mjs checks captured frames.

import fs from "node:fs";
import path from "node:path";
import { EMBERS, DOCK, DOCKLANDS, hex } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const src = fs.readFileSync(path.join(ROOT, "src/signal/dither.sgl"), "utf8");
const VERBOSE = process.argv.includes("--verbose");

function palette(name) {
  const m = src.match(new RegExp(`\\(${name}\\s+((?:"#[0-9A-Fa-f]{6}"\\s*)+)\\)`));
  if (!m) throw new Error(`check-palette: palette ${name} not found in dither.sgl`);
  return [...m[1].matchAll(/"#([0-9A-Fa-f]{6})"/g)].map((x) => `#${x[1].toUpperCase()}`);
}
const PALETTE_MAX = Number(src.match(/\(define PALETTE-MAX (\d+)\)/)[1]);

export const ROLES = { cyan: "#4DF2D9", amber: "#FF9F1A", violet: "#B36BFF", red: "#FF5959", orange: "#F2731A", magenta: "#FF59D9" };
const CITY = new Set([DOCK.REFLECT_COLD]);
// Accepted regressions, each "role mode t base": Gibson's violet at 15% to
// 30% over the dark water and wet road, where embers' picks are greys or
// #583681 and docklands' also include the cold blue. Gibson's tower draws
// its bands in full violet; only the faint edge of a violet glow can go
// blue, and only on water or a wet road. Ruled by the worker, 2026-10-19,
// for David's review (the runtime check measures the tower in a frame).
const ACCEPTED = new Set([
  "violet add 0.25 BAR_A", "violet add 0.15 WET_ASPHALT", "violet fade 0.20 WET_ASPHALT",
  "violet add 0.25 HARBOUR_DEEP", "violet fade 0.30 HARBOUR_DEEP", "violet add 0.30 HARBOUR_DEEP",
  "violet add 0.20 HARBOUR", "violet fade 0.25 HARBOUR",
]);
const NAME = Object.fromEntries(Object.entries(DOCK).map(([k, v]) => [v, k]));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

export function check() {
  const problems = [], report = [], ground = {}, accepted = [];
  const dock = palette("docklands"), embers = palette("embers");
  if (embers.join() !== EMBERS.join()) problems.push("dither.sgl's embers differs from lib.mjs's EMBERS");
  if (dock.join() !== DOCKLANDS.join()) problems.push("dither.sgl's docklands is not lib.mjs's EMBERS then DOCK, in order");
  if (dock.length > PALETTE_MAX) problems.push(`docklands has ${dock.length} colours, over PALETTE-MAX ${PALETTE_MAX}`);
  if (new Set(dock).size !== dock.length) problems.push("docklands repeats a colour");

  for (const [name, c] of Object.entries(DOCK)) {
    let near = Infinity, who = null;
    for (const o of dock) if (o !== c && dist(hex(c), hex(o)) < near) { near = dist(hex(c), hex(o)); who = o; }
    let role = Infinity, rname = null;
    for (const [rn, rc] of Object.entries(ROLES)) if (dist(hex(c), hex(rc)) < role) { role = dist(hex(c), hex(rc)); rname = rn; }
    report.push(`${name.padEnd(13)} ${c}  nearest ${who} at ${near.toFixed(1)}; nearest role ${rname} at ${role.toFixed(1)}`);
    if (near < 14) problems.push(`${name} ${c} is ${near.toFixed(1)} from ${who}`);
    if (rname !== "magenta" && role < 60) problems.push(`${name} ${c} is ${role.toFixed(1)} from the ${rname} role`);
  }

  // the bases the district's light falls on: the frame's black, the night
  // floor, the dry and the wet road, the water and the fog
  const bases = { BG: "#0D0A1A", BAR_A: "#17122E", SLATE: "#333648", WET_ASPHALT: DOCK.WET_ASPHALT,
                  HARBOUR_DEEP: DOCK.HARBOUR_DEEP, HARBOUR: DOCK.HARBOUR, HARBOUR_FOG: DOCK.HARBOUR_FOG };
  const picks = (pal, rgb) => {
    const ds = pal.map((c) => dist(hex(c), rgb)), best = Math.min(...ds);
    return pal.filter((_, i) => ds[i] <= best + 8);
  };
  let steps = 0;
  for (const [rn, rc] of Object.entries(ROLES)) {
    if (rn === "magenta") continue;
    for (const [bn, bc] of Object.entries(bases)) for (let k = 1; k <= 20; k++) {
      const t = k / 20, r = hex(rc), b = hex(bc);
      for (const [mode, rgb] of [["fade", b.map((v, i) => v + (r[i] - v) * t)], ["add", b.map((v, i) => Math.min(255, v + r[i] * t))]]) {
        steps++;
        const pd = picks(dock, rgb), pe = new Set(picks(embers, rgb));
        for (const c of pd) {
          if (!NAME[c]) continue;
          if (CITY.has(c) && !pe.has(c)) {
            const key = `${rn} ${mode} ${t.toFixed(2)} ${bn}`;
            if (ACCEPTED.has(key)) accepted.push(key);
            else problems.push(`glow: ${key} can newly quantize to ${NAME[c]} ${c} (embers: ${[...pe].join(",")})`);
          } else { const key = `${rn} -> ${NAME[c]}`; ground[key] = (ground[key] || 0) + 1; }
        }
      }
    }
  }
  for (const a of ACCEPTED) if (!accepted.includes(a)) problems.push(`glow: accepted step "${a}" no longer occurs; remove it from ACCEPTED`);
  report.push(`glow check: ${steps} blend steps of the five non-magenta roles over ${Object.keys(bases).length} bases; ` +
              `${accepted.length} accepted regressions (faint violet), ${problems.filter((p) => p.startsWith("glow")).length} others`);
  if (VERBOSE) for (const [k, n] of Object.entries(ground).sort()) report.push(`  lands on new ground: ${k} (${n} steps)`);
  return { problems, report };
}

if (process.argv[1] && process.argv[1].endsWith("check-palette.mjs")) {
  const { problems, report } = check();
  console.log(report.join("\n"));
  console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : `palette ok: docklands, ${DOCKLANDS.length} colours`);
  process.exitCode = problems.length ? 1 : 0;
}
