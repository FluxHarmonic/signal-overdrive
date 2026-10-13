// logo-sheet.mjs - the review sheet for the logo candidates.
//
//   node scripts/art/logo-sheet.mjs [DIR]
//
// Reads what gen-logo.mjs wrote under DIR (default docs/logo) and writes
// DIR/index.html: the logo, the wordmark at 1x, 2x and
// 4x, the mark at 16, 32 and 180 px and in a browser tab, on dark and light
// grounds, and the title animation playing in a 480x270 game frame (the
// frames under DIR/frames/ are captures of the game's title with the old
// title text taken out, with and without the HUD). Every image is drawn at
// a whole multiple of its size with image-rendering: pixelated, so no
// pixel is smoothed.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DIR = path.resolve(process.argv[2] || path.join(ROOT, "docs/logo"));

// name, title, one line on what it is
const DIRECTIONS = [
  ["corrupt", "CORRUPT", "The cargo's integrity failing: tall condensed letters, their channels split cyan and magenta, one slice torn sideways, ICE amber and dropouts where the data broke. On the title the signal holds for a bar, then glitches hard on the downbeat and snaps back."],
];

function pngSize(file) {
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const img = (src, scale, alt) => {
  const [w, h] = pngSize(path.join(DIR, src));
  return `<img src="${src}" width="${w * scale}" height="${h * scale}" alt="${esc(alt)}">`;
};

// The stamp: the last commit that changed anything that makes the pixels
// (the sheet itself and the rendered files don't count), and whether the
// tree has changed those since.
const SOURCES = ["assets/src/logo", "scripts/art/gen-logo.mjs", "scripts/art/logo-text.mjs", "scripts/art/lib.mjs"];
let stamp = "unversioned";
try {
  const sha = execFileSync("git", ["-C", ROOT, "log", "-1", "--format=%h", "--abbrev=12", "--", ...SOURCES], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", ...SOURCES], { encoding: "utf8" }).trim();
  stamp = dirty ? `${sha} with uncommitted changes` : sha;
} catch { /* not a checkout */ }

// captures of the title screen running in the game, when there are some
const GAME = [
  ["game-attract.png", "attract: the camera flies the track"],
  ["game-fade-out.png", "a start: fading out"],
  ["game-fade-in.png", "fading in on the countdown"],
  ["game-countdown.png", "the countdown, HUD back"],
].filter(([f]) => fs.existsSync(path.join(DIR, "frames", f)));

const titles = Object.fromEntries(DIRECTIONS.map(([n]) => [n, JSON.parse(fs.readFileSync(path.join(DIR, n, "title.json"), "utf8"))]));

const col = (f) => `<div class="cols">${DIRECTIONS.map((d) => `<div class="col"><h3>${d[1]}</h3>${f(d)}</div>`).join("")}</div>`;
const grounds = (inner) => `<div class="ground dark">${inner}</div><div class="ground light">${inner}</div>`;

const tab = (n, theme) => `<div class="tabbar ${theme}"><div class="tab"><img src="${n}/mark-16.png" srcset="${n}/mark-32.png 2x" width="16" height="16" alt=""><span>Signal Overdrive</span><b>×</b></div><div class="tab dim"><span>New Tab</span></div></div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal Overdrive: the logo</title>
<link rel="icon" href="corrupt/favicon.ico">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #17122E; color: #CCE6FF; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1500px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 40px 0 8px; border-bottom: 1px solid #2E1C4D; padding-bottom: 4px; }
  h3 { font-size: 15px; margin: 0 0 6px; color: #4DF2D9; }
  p { max-width: 900px; color: #93A4BA; margin: 6px 0; }
  .note { font-size: 13px; }
  img, canvas { image-rendering: pixelated; image-rendering: crisp-edges; display: block; }
  .cols { display: grid; grid-template-columns: repeat(${DIRECTIONS.length}, minmax(0, 1fr)); gap: 20px; align-items: start; }
  .col { min-width: 0; }
  .ground { padding: 16px; overflow-x: auto; display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
  .dark { background: #0D0A1A; }
  .light { background: #F0F0F0; }
  .row4 { margin: 12px 0; }
  .label { font-size: 12px; color: #7380A6; margin-top: 4px; }
  .light .label { color: #636D81; }
  figure { margin: 0; }
  .tabbar { display: flex; gap: 2px; padding: 8px 8px 0; font: 13px system-ui, sans-serif; }
  .tabbar .tab { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 8px 8px 0 0; width: 190px; }
  .tabbar .tab span { flex: 1; white-space: nowrap; overflow: hidden; }
  .tabbar .tab b { font-weight: normal; opacity: .6; }
  .tabbar.dark { background: #1F1F23; } .tabbar.dark .tab { background: #35363A; color: #E8EAED; } .tabbar.dark .dim { background: none; color: #9AA0A6; }
  .tabbar.light { background: #DEE1E6; } .tabbar.light .tab { background: #FFFFFF; color: #202124; } .tabbar.light .dim { background: none; color: #5F6368; }
  .frame { margin: 8px 0 24px; }
  .frame canvas { width: 960px; max-width: 100%; height: auto; }
  label { font-size: 13px; color: #93A4BA; margin-right: 16px; }
  .desc { min-height: 7.5em; }
  code { color: #CCE6FF; }
</style>
</head>
<body>
<main>
<h1>Signal Overdrive: the logo (CORRUPT)</h1>
<p class="note">Sources at ${esc(stamp)}. Every letter and every mark is drawn by hand as text, one character a pixel (the <a href="src/">sources</a>); <code>scripts/art/gen-logo.mjs</code> lays them out and shades them in the game's palette through the same 4x4 Bayer matrix as its post pass. No image generation and no fonts. Each image is shown at whole multiples of its size, nearest neighbour.</p>

${col((d) => `<p class="desc">${esc(d[2])}</p>`)}
${fs.existsSync(path.join(DIR, "site", "logo-glitch.js")) ? `
<h2>The site's wordmark, glitching as it will on signaloverdrive.net</h2>
<p class="note">These run the exported files in <code>site/</code> exactly as the site will embed them (<a href="site/EMBED.txt">EMBED.txt</a>): the still <code>logo.png</code> in an img, and <code>logo-glitch.js</code> stepping it through eight glitch frames on a timeline (about two seconds still, a tenth of a second glitching). With JS off or prefers-reduced-motion the still stays. Also there: <a href="site/og.png">og.png</a>, the 1200x630 social preview.</p>
${grounds(`<img src="site/logo.png" width="${pngSize(path.join(DIR, "site/logo.png"))[0]}" height="${pngSize(path.join(DIR, "site/logo.png"))[1]}" alt="Signal Overdrive" data-glitch="site/logo-glitch-{n}.png">`)}
<script src="site/logo-glitch.js" defer></script>
` : ""}

<h2>Wordmark at 1x</h2>
<p class="note">1x is the size in the game's 480x270 frame; the site would use 2x or more. Dark ground is the game's own #0D0A1A.</p>
${col(([n]) => grounds(`<figure>${img(`${n}/wordmark.png`, 1, "1x")}</figure>`))}

<h2>Wordmark at 2x</h2>
${DIRECTIONS.map(([n, t]) => `<div class="row4"><h3>${t}</h3>${grounds(`<figure>${img(`${n}/wordmark.png`, 2, "2x")}</figure>`)}</div>`).join("\n")}

<h2>Wordmark at 4x</h2>
${DIRECTIONS.map(([n, t]) => `<div class="row4"><h3>${t}</h3>${grounds(`<figure>${img(`${n}/wordmark.png`, 4, "4x")}</figure>`)}</div>`).join("\n")}

<h2>Mark at 16, 32 and 180 px</h2>
<p class="note">16 and 32 are separate drawings; 180 (the phone's home screen icon) is the 32 drawing on a 36 px tile at 5x. These are CSS pixels, so on a 2x display each is drawn twice as large again; the tab below picks the 16 or the 32 drawing the way a browser does.</p>
${col(([n]) => grounds(`<figure>${img(`${n}/mark-16.png`, 1, "16")}<div class="label">16</div></figure><figure>${img(`${n}/mark-32.png`, 1, "32")}<div class="label">32</div></figure><figure>${img(`${n}/mark-180.png`, 1, "180")}<div class="label">180</div></figure><figure>${img(`${n}/mark-16.png`, 6, "16 at 6x")}<div class="label">16 drawing at 6x</div></figure>`))}

<h2>In a browser tab</h2>
${col(([n]) => tab(n, "dark") + tab(n, "light"))}

${GAME.length ? `
<h2>The title screen, in the game</h2>
<p class="note"><a href="game/">Play it</a> (the web build hosted beside this sheet). The camera wanders the track by itself while the logo glitches on the beat and the prompt asks for a start; a start (Enter, Space, a pad's Start or A, a tap) fades out, begins the race's countdown and fades back in. These are captures of that build in headless Chrome, at 2x; the logo in the first is the atlas's frame pixel for pixel.</p>
<div class="ground dark">${GAME.map(([f, cap]) => `<figure>${img(`frames/${f}`, 2, cap)}<div class="label">${esc(cap)}</div></figure>`).join("")}</div>
` : ""}
<h2>The title animation, as the script renders it</h2>
<p class="note">gen-logo.mjs's own render of the loop, two bars at 140 BPM (the tempo of <i>Carrier</i>), over a frame captured before the effects pass. The game picks its frames from the same timing.</p>
${DIRECTIONS.map(([n, t]) => `<div class="frame"><h3>${t}</h3><label><input type="checkbox" data-hud="${n}"> today's HUD</label><label><input type="checkbox" data-pause="${n}"> pause</label><canvas id="t-${n}" width="480" height="270"></canvas></div>`).join("\n")}
</main>
<script>
const TITLES = ${JSON.stringify(titles)};
const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
(async () => {
  const [bare, hud] = await Promise.all([load("frames/title-bare.png"), load("frames/title-hud.png")]);
  const runs = await Promise.all(Object.entries(TITLES).map(async ([n, t]) => {
    const sheet = await load(n + "/title.png");
    const cv = document.getElementById("t-" + n), cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = false;
    const st = { n, t, sheet, cx, hud: false, pause: false, f: 0 };
    document.querySelector('[data-hud="' + n + '"]').onchange = (e) => { st.hud = e.target.checked; };
    document.querySelector('[data-pause="' + n + '"]').onchange = (e) => { st.pause = e.target.checked; };
    return st;
  }));
  const t0 = performance.now();
  const tick = (now) => {
    const f = Math.floor((now - t0) / (1000 / 60));
    for (const s of runs) {
      if (!s.pause) s.f = f % s.t.frames;
      const { t, cx } = s;
      cx.drawImage(s.hud ? hud : bare, 0, 0);
      const sx = (s.f % t.cols) * t.w, sy = Math.floor(s.f / t.cols) * t.h;
      cx.drawImage(s.sheet, sx, sy, t.w, t.h, t.x, t.y, t.w, t.h);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(DIR, "index.html"), html);
console.log(`sheet -> ${path.join(DIR, "index.html")} (${stamp})`);
