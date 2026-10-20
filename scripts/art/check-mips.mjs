// check-mips.mjs [NAME...] [--old-avg NAME=FILE ...]
// Read each track's atlas and mip texture back from assets/signal/ and check
// the mip texture against the atlas: its size (24x16 per atlas cell), and
// every texel of levels 1 to 5 the rounded mean of its block of the tile
// (layout: MIP_CELL and MIP_OFFSETS in lib.mjs). With --old-avg NAME=FILE,
// also that level 5 equals a 0.1 avg texture (one texel per tile) exactly.
// Exit 0 GREEN, 1 RED (the first problems listed), 2 usage.
import fs from "node:fs";
import path from "node:path";
import { readRGBA } from "./gen-logo.mjs";
import { MIP_CELL, MIP_OFFSETS } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const old = {};
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--old-avg") { const [n, f] = (args[++i] || "").split("="); if (!n || !f) { console.error("check-mips: --old-avg NAME=FILE"); process.exit(2); } old[n] = f; }
  else names.push(args[i]);
}
// default: the tracks gen-track generates (tracks/*.json); the retired
// loop's textures stay in 0.1's format, and nothing draws them
if (!names.length) for (const f of fs.readdirSync(path.join(ROOT, "tracks"))) { const m = /^(.+)\.json$/.exec(f); if (m) names.push(m[1]); }

const TILE = 32, PER_ROW = 64;
let problems = [];
// the ground shader reads the same layout from its own copy (mipFetch in
// mode7/render.sgl): its cell stride and level offsets must match lib.mjs
{
  const src = fs.readFileSync(path.join(ROOT, "src/signal/mode7/render.sgl"), "utf8");
  const off = /ivec2 off = (.*);/.exec(src), stride = /cell \* ivec2\((\d+), (\d+)\) \+ off/.exec(src);
  const got = off ? [...off[1].matchAll(/ivec2\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]) : [];
  const want = MIP_OFFSETS.slice(1);
  if (!stride || Number(stride[1]) !== MIP_CELL[0] || Number(stride[2]) !== MIP_CELL[1]) problems.push(`shader: mip cell stride ${stride ? stride[1] + "x" + stride[2] : "not found"}, lib.mjs ${MIP_CELL.join("x")}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`shader: mip offsets ${JSON.stringify(got)}, lib.mjs ${JSON.stringify(want)}`);
  else console.log(`shader: mipFetch layout matches lib.mjs (${MIP_CELL.join("x")} cells, offsets ${JSON.stringify(want)})`);
}
for (const name of names) {
  const atlas = readRGBA(path.join(ROOT, `assets/signal/${name}-atlas.png`));
  const mips = readRGBA(path.join(ROOT, `assets/signal/${name}-avg.png`));
  const rows = atlas.h / TILE;
  const wantW = PER_ROW * MIP_CELL[0], wantH = rows * MIP_CELL[1];
  if (atlas.w !== PER_ROW * TILE || !Number.isInteger(rows)) { problems.push(`${name}: atlas ${atlas.w}x${atlas.h} is not 64 cells of 32 wide`); continue; }
  if (mips.w !== wantW || mips.h !== wantH) { problems.push(`${name}: mip texture ${mips.w}x${mips.h}, want ${wantW}x${wantH}`); continue; }
  const A = (x, y) => (y * atlas.w + x) * 4, M = (x, y) => (y * mips.w + x) * 4;
  let bad = 0, checked = 0;
  for (let id = 0; id < PER_ROW * rows; id++) {
    const ax = (id % PER_ROW) * TILE, ay = Math.floor(id / PER_ROW) * TILE;
    const cx = (id % PER_ROW) * MIP_CELL[0], cy = Math.floor(id / PER_ROW) * MIP_CELL[1];
    for (let L = 1; L <= 5; L++) {
      const s = 1 << L, n = TILE >> L, [ox, oy] = MIP_OFFSETS[L];
      for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
        const sum = [0, 0, 0];
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const k = A(ax + u * s + i, ay + v * s + j); for (let c = 0; c < 3; c++) sum[c] += atlas.px[k + c]; }
        const k = M(cx + ox + u, cy + oy + v);
        checked++;
        for (let c = 0; c < 3; c++) if (mips.px[k + c] !== Math.round(sum[c] / (s * s))) {
          if (bad < 5) problems.push(`${name}: tile ${id} level ${L} texel (${u},${v}) channel ${c}: ${mips.px[k + c]}, want ${Math.round(sum[c] / (s * s))}`);
          bad++; break;
        }
      }
    }
  }
  if (bad > 5) problems.push(`${name}: ... ${bad} wrong texels in all`);
  if (old[name]) {
    const o = readRGBA(old[name]);
    let diff = 0;
    for (let id = 0; id < o.w * o.h; id++) {
      const ko = id * 4, km = M((id % PER_ROW) * MIP_CELL[0] + MIP_OFFSETS[5][0], Math.floor(id / PER_ROW) * MIP_CELL[1] + MIP_OFFSETS[5][1]);
      for (let c = 0; c < 3; c++) if (o.px[ko + c] !== mips.px[km + c]) { diff++; break; }
    }
    if (o.w !== PER_ROW || o.h !== rows) problems.push(`${name}: the old avg is ${o.w}x${o.h}, want ${PER_ROW}x${rows}`);
    else if (diff) problems.push(`${name}: level 5 differs from the old avg in ${diff} tiles`);
    console.log(`${name}: level 5 against ${old[name]}: ${diff} tiles differ`);
  }
  console.log(`${name}: ${checked} mip texels checked, ${bad} wrong`);
}
if (problems.length) { console.log("RED"); for (const p of problems) console.log("  " + p); process.exit(1); }
console.log("GREEN");
