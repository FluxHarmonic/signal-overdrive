// rain-occlusion.mjs --max PCT --min-band N [--min-rain PX] SHOT.png...
// The rain's readability check (0.2, David: "the raindrops obscure the
// track"). The shots are of the debug view (fx-rain-debug=1), in which the
// post pass draws pure colours: green over the road ahead (the centreline
// from the machine to 1,900 texels on, the readability rule's look-ahead),
// red where a rain streak or a splash ring touched the pixel, blue added for
// a splash. Per shot: the band's pixels, how many of them the rain touched
// (its occlusion, %), and the splashes among those. The HUD is drawn after
// the post pass, so its pixels count as neither.
// --max PCT (required): exit 1 if any shot's occlusion is over PCT.
// --min-band N (required): exit 1 if a shot's band has fewer than N
// pixels (the band missing would pass any --max). A shot more than 20%
// not in the debug view's pure colours (the HUD is a few %) is RED: it is
// not the debug view. --min-rain PX: exit 1 if the shots' mean count of
// rain pixels outside the band is under PX (the rain gone, or culled to
// nothing, would pass any --max; the guard keeps the band itself clear).
// --report: print the numbers, never RED (for a
// before arm). Exit 0 GREEN, 1 RED, 2 usage.
import { readRGBA } from "./art/gen-logo.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : NaN; };
const REPORT = args.includes("--report");
const MAX = REPORT ? Infinity : opt("--max"), MIN_BAND = REPORT ? 0 : opt("--min-band");
const MIN_RAIN = REPORT || !args.includes("--min-rain") ? 0 : opt("--min-rain");
const files = args.filter((a, i) => !a.startsWith("--") && !["--max", "--min-band", "--min-rain"].includes(args[i - 1]));
if (!files.length || Number.isNaN(MAX) || Number.isNaN(MIN_BAND) || Number.isNaN(MIN_RAIN)) { console.error("rain-occlusion: (--max PCT --min-band N [--min-rain PX] | --report) SHOT.png..."); process.exit(2); }

let worst = 0, sum = 0, outside = 0, red = false;
for (const f of files) {
  const im = readRGBA(f);
  let band = 0, hit = 0, splash = 0, rainElsewhere = 0, other = 0;
  for (let k = 0; k < im.w * im.h * 4; k += 4) {
    const r = im.px[k], g = im.px[k + 1], b = im.px[k + 2];
    const isR = r === 255, isG = g === 255, isB = b === 255;
    const pure = (r === 0 || isR) && (g === 0 || isG) && (b === 0 || isB);
    if (!pure) { other++; continue; }
    if (isG) { band++; if (isR) { hit++; if (isB) splash++; } }
    else if (isR) rainElsewhere++;
  }
  const pct = band ? (100 * hit) / band : 0;
  worst = Math.max(worst, pct); sum += pct; outside += rainElsewhere;
  const notDebug = other > 0.2 * im.w * im.h;
  const bad = pct > MAX || band < MIN_BAND || (!REPORT && notDebug);
  if (bad) red = true;
  console.log(`${f}: band ${band} px, rain on ${hit} (${pct.toFixed(2)}%), splashes ${splash}, rain elsewhere ${rainElsewhere}, not debug ${other}${notDebug ? " (not the debug view)" : ""}${bad ? "  <- RED" : ""}`);
}
const mean = sum / files.length, rainOut = outside / files.length;
const thin = rainOut < MIN_RAIN;
if (thin) red = true;
console.log(`shots ${files.length}: occlusion mean ${mean.toFixed(2)}%, worst ${worst.toFixed(2)}%${Number.isFinite(MAX) ? `, limit ${MAX}%` : ""}, rain outside the band ${Math.round(rainOut)} px${MIN_RAIN ? `, floor ${MIN_RAIN} px${thin ? " (under the floor)" : ""}` : ""}`);
console.log(red ? "RED" : "GREEN");
process.exit(red ? 1 : 0);
