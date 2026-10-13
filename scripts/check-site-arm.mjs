#!/usr/bin/env node
// check-site-arm.mjs - signaloverdrive.net's own legs of substratic's
// check-site (its "arm", named in substratic.sgv). check-site serves the
// staged tree on loopback with Pages' rules (the tree's own _headers and
// _redirects, real 404s), runs its shared legs (files, redirects, indexing,
// 404s, the wasm), then runs this while that server is up and relays these
// lines.
//
//   node scripts/check-site-arm.mjs BASE DIR     (BASE: http://127.0.0.1:PORT)
//
// Without a browser:
//   icons      apple-touch-icon.png is 180x180 and fully opaque (iOS paints
//              transparent pixels black), and the landing links it
//   tree       the site's own files are staged: the page, the art, the
//              Flux Harmonic mark, the fonts and their OFL.txt
//   headers    the tree's _headers, read with substratic's own parser (the one
//              serve-site applies), gives the game's path /<game>/ and its
//              files COOP same-origin, COEP require-corp and CORP same-origin,
//              and gives the landing, the 404 and the other site files none
//              of the three: only the game is isolated; and no path gets one
//              of them from two rules (Pages joins repeated values with a
//              comma, and Chrome reads "same-origin, same-origin" as no COOP)
//   em-dash    no em dash in the site's own text files
//   analytics  every HTML page in the tree, the game's page included, carries
//              the Plausible snippet in its gated form (the script tag is
//              added only on signaloverdrive.net) with the site's script ID,
//              exactly once, in <head>, and no other site's
//                (scripts/plausible-check.mjs, shared with the other game sites)
// In headless Chrome (muted, into the worker-null sink), with plausible.io
// stood in for so nothing reaches the internet:
//   landing    /: the title, the logo (291x27, alt "Signal Overdrive"), the
//              three JetBrains Mono faces loaded, every image decoded and the
//              pictures 480x270, the reactive-music section, the How it's
//              made disclosure, the font license link, no em dash in the
//              rendered text, every request 2xx
//   preview    og:image and twitter:image name https://signaloverdrive.net/
//              shots/og.png, a 1200x630 PNG in the tree; og:url and the
//              canonical link are https://signaloverdrive.net/
//   logo       the wordmark steps through its glitch frames by itself, and
//              under prefers-reduced-motion stays /logo.png for a whole
//              glitch cycle (the glitch is the positive control)
//   play       GET IN is a disabled button that says so, a click on it goes
//              nowhere, the page says it is coming soon, and nothing on the
//              landing links the game's path yet
//   carousel   the pictures change by themselves (the caption silent while they
//              do), a click on a dot shows that picture and its caption and
//              stops the rotation, keyboard focus on a dot pauses it, one
//              shows at a time, and under prefers-reduced-motion nothing
//              changes by itself
//   contrast   every text role on / and the 404 meets 4.5:1 (3:1 for large
//              text) against the background behind it
//   version    no version number in the title, meta or rendered copy
//   phone      at 390 CSS px (a phone, emulated), / and the 404 have no
//              horizontal scroll, and the logo and GET IN fit on screen
//   404        a missing page shows the 404's number and a link home, and the
//              same 404, styled, under the game's path
//   local      every leg above ran at the loopback host, as a private preview
//              does: nothing asked plausible.io for anything, no script ran
//   privacy    the landing's footer has the privacy line and its link
//   analytics  at https://signaloverdrive.net (the stub serves the tree there),
//              /, the 404 and the game's page each load the script and send a
//              pageview for signaloverdrive.net that comes back 202, and the
//              game's page stays cross-origin isolated with it
//   coep       the same game page, given a plausible.io script without CORP,
//              blocks it and stays isolated (COEP is really judging it)
//   analytics-down  plausible.io refused: / renders and the game starts,
//              isolated, with no error but the refused requests
//   isolation  /<game>/ is crossOriginIsolated with a working SharedArrayBuffer,
//              its document answered with COOP, COEP and CORP, and the game
//              itself reports its audio ring as "worklet-sab" (the bridge's
//              SharedArrayBuffer path). The control: / is NOT isolated and
//              has no SharedArrayBuffer, so the probe can tell the two apart.
//   console    no console error, exception or failed request on /, the 404 or
//              the game, at either host
// Exit 0 green, 1 red, 2 setup failed (the line starts SETUP-FAILED).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { auditTree, plausibleStub, isPlausibleFailure, PRIVACY } from "./plausible-check.mjs";

const PLAUSIBLE_ID = "pa-GCzY0KZPnFuB1DEsbPead";
const PLAUSIBLE_DOMAIN = "signaloverdrive.net";
// the site at its real hostname: the stub answers it from the local server
const REAL = `https://${PLAUSIBLE_DOMAIN}`;
const EM = /—|&mdash;|&#8212;|&#x2014;/i;
const ISOLATION = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [BASE0, DIR0] = process.argv.slice(2);
const setup = (why) => { console.log(`SETUP-FAILED: ${why}`); process.exit(2); };
if (!BASE0 || !DIR0) setup("usage: check-site-arm.mjs BASE DIR");
const BASE = BASE0.replace(/\/$/, ""), DIR = path.resolve(DIR0.replace(/\/$/, ""));
const MAN = DIR + ".manifest";
if (!fs.existsSync(MAN)) setup(`${MAN} missing (stage-web)`);
const manText = fs.readFileSync(MAN, "utf8");
const SLUG = (manText.match(/^# game (\S+)$/m) || [])[1];
const ROUTE = (manText.match(/^# route (\S+)$/m) || [])[1];
if (!SLUG || !ROUTE) setup("the manifest names no game path or wasm route (# game, # route)");
const files = manText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.slice(66)).filter((f) => !f.startsWith("@"));
const CHECKS = process.env.SUBSTRATIC_CHECKS;
if (!CHECKS || !fs.existsSync(path.join(CHECKS, "serve-site.mjs"))) setup("SUBSTRATIC_CHECKS does not name substratic's tasks/checks");
const { parseHeaders, headersFor } = await import(path.join(CHECKS, "serve-site.mjs"));

let fail = 0;
const ok = (leg, what) => console.log(`  ok   ${leg}: ${what}`);
const bad = (leg, what) => { fail++; console.log(`  FAIL ${leg}: ${what}`); };
const text = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
// A PNG's pixels: 8-bit RGB (2) or RGBA (6), not interlaced, no tRNS; anything
// else is reported as unreadable rather than guessed at.
function readPNG(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(1, 4).toString("latin1") !== "PNG") return { error: "not a PNG" };
  let o = 8, w = 0, h = 0, ch = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString("latin1", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || (d[9] !== 6 && d[9] !== 2) || d[12] !== 0) return { error: `depth ${d[8]}, colour type ${d[9]}, interlace ${d[12]}: not read here` };
      ch = d[9] === 6 ? 4 : 3;
    } else if (type === "tRNS") return { error: "a tRNS chunk: transparency not read here" };
    else if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y > 0 ? px[(y - 1) * stride + x] : 0, c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}

// ---- tree ------------------------------------------------------------------------------
{
  const want = ["index.html", "404.html", "style.css", "logo.png", "logo-glitch.js", ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `logo-glitch-${n}.png`),
                "favicon.png", "favicon.ico", "apple-touch-icon.png", "mark.png", "shots/og.png",
                "fonts/OFL.txt", "fonts/JetBrainsMono-Regular.woff2", "fonts/JetBrainsMono-Bold.woff2", "fonts/JetBrainsMono-Italic.woff2",
                `${SLUG}/index.html`];
  const missing = want.filter((f) => !files.includes(f));
  missing.length ? bad("tree", `missing: ${missing.join(", ")}`) : ok("tree", `the site's ${want.length} named files are staged`);
}

// ---- icons: the home-screen icon is opaque ------------------------------------------------
// iOS fills transparent pixels of an apple-touch-icon with black (a ring
// round the art); every pixel must have alpha 255
{
  const detail = [];
  const p = "apple-touch-icon.png";
  if (!files.includes(p)) detail.push(`${p} is not in the tree`);
  else {
    const img = readPNG(path.join(DIR, p));
    if (img.error) detail.push(`${p}: ${img.error}`);
    else {
      if (img.w !== 180 || img.h !== 180) detail.push(`${p} is ${img.w}x${img.h} (want 180x180)`);
      let clear = 0;
      if (img.ch === 4) for (let i = 3; i < img.px.length; i += 4) if (img.px[i] !== 255) clear++;
      if (clear) detail.push(`${p} has ${clear} pixels that are not fully opaque`);
    }
  }
  if (!/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/.test(text("index.html"))) detail.push("index.html does not link it");
  detail.length ? bad("icons", detail.join("; ")) : ok("icons", `${p} is 180x180 with all 32400 pixels opaque, and the landing links it`);
}

// ---- headers: only the game is isolated ------------------------------------------------
{
  const rules = fs.existsSync(path.join(DIR, "_headers")) ? parseHeaders(text("_headers")) : null;
  if (!rules) bad("headers", "no _headers in the tree");
  else {
    const detail = [];
    // the game's page, its directory, and a file of each kind it loads; plus
    // every staged file under it, so a narrower rule (one file) cannot pass
    const gamePaths = [`/${SLUG}/`, ...files.filter((f) => f.startsWith(SLUG + "/")).map((f) => "/" + f)];
    for (const p of gamePaths) {
      const h = headersFor(rules, p);
      for (const [k, v] of Object.entries(ISOLATION)) if (h[k] !== v) detail.push(`${p}: ${k} is ${h[k] ?? "absent"} (want ${v})`);
      // serve-site lets the last matching rule win; Pages joins every value
      // with a comma, and "same-origin, same-origin" is no COOP to Chrome
      // (measured: crossOriginIsolated false). So each header once, per path.
      for (const k of Object.keys(ISOLATION)) {
        const n = rules.filter((r) => r.re.test(p)).reduce((a, r) => a + r.headers.filter(([name]) => name === k).length, 0);
        if (n > 1) detail.push(`${p}: ${k} is set ${n} times (Pages joins them with a comma, which breaks isolation)`);
      }
    }
    // the rest of the site: none of the three
    const sitePaths = ["/", "/no-such-page", ...files.filter((f) => !f.startsWith(SLUG + "/") && !f.startsWith(ROUTE + "/") && f !== "_headers" && f !== "_redirects").map((f) => "/" + f)];
    for (const p of sitePaths) {
      const h = headersFor(rules, p);
      for (const k of Object.keys(ISOLATION)) if (k in h) detail.push(`${p} is given ${k}: ${h[k]} (the landing is not isolated)`);
    }
    detail.length ? bad("headers", `${detail.slice(0, 6).join("; ")}${detail.length > 6 ? `; and ${detail.length - 6} more` : ""}`)
      : ok("headers", `COOP same-origin, COEP require-corp, CORP same-origin on all ${gamePaths.length} game paths under /${SLUG}/; none of the three on the ${sitePaths.length} other site paths`);
  }
}

// ---- em-dash ---------------------------------------------------------------------------
{
  const mine = files.filter((f) => !f.startsWith(SLUG + "/") && !f.startsWith(ROUTE + "/") && /\.(html|xml|json|txt|css)$|^_headers$|^_redirects$/.test(f) && f !== "fonts/OFL.txt");
  const dashed = mine.filter((f) => EM.test(text(f)));
  dashed.length ? bad("em-dash", `an em dash in ${dashed.join(", ")}`) : ok("em-dash", `none in the site's ${mine.length} text files`);
}

// ---- analytics (no browser) ------------------------------------------------------------
{
  // every page carries the gated snippet: the script tag is added only on
  // signaloverdrive.net, so a private preview, a local run or any other copy
  // of the site sends nothing
  const all = auditTree(DIR, PLAUSIBLE_ID).pages;
  const { pages, problems } = auditTree(DIR, PLAUSIBLE_ID, { gated: all, host: PLAUSIBLE_DOMAIN });
  // a floor: the pages that must be there, so an empty walk is no pass
  const must = ["index.html", "404.html", `${SLUG}/index.html`];
  const absent = must.filter((p) => !pages.includes(p));
  if (absent.length) problems.push(`pages missing from the walk: ${absent.join(", ")}`);
  problems.length ? bad("analytics", problems.slice(0, 6).join("; "))
    : ok("analytics", `the Plausible snippet, gated to ${PLAUSIBLE_DOMAIN}, with ${PLAUSIBLE_ID} once, in <head>, on all ${pages.length} HTML pages: ${pages.join(", ")}`);
}

// ---- the browser -------------------------------------------------------------------------
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "signal-site-arm-chrome-"));
spawnSync("sh", ["-c", "pactl list short sinks 2>/dev/null | grep -q worker-null || pactl load-module module-null-sink sink_name=worker-null >/dev/null 2>&1 || true"]);
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
  "--remote-debugging-port=0", `--user-data-dir=${udd}`, "--window-size=1100,900", "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, PULSE_SINK: "worker-null" } });
const killChrome = () => { try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* gone */ } try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* scratch */ } };
process.on("exit", killChrome);

let port = null;
for (let i = 0; i < 100 && !port; i++) {
  try { port = fs.readFileSync(path.join(udd, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await sleep(100); }
}
if (!port) setup("Chrome wrote no DevToolsActivePort in 10 s (google-chrome on PATH?)");
let pageWs = null;
for (let i = 0; i < 50 && !pageWs; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = list.find((t) => t.type === "page"); if (p) pageWs = p.webSocketDebuggerUrl; } catch { /* not up */ }
  if (!pageWs) await sleep(200);
}
if (!pageWs) setup("no DevTools page target in 10 s");
const ws = new WebSocket(pageWs);
let msgId = 0; const pending = new Map();
const consoleLines = [], consoleErrors = [];
const net = new Map();
let stub = null;
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); return; }
  if (stub) stub.onMessage(msg);
  const p = msg.params || {};
  if (msg.method === "Runtime.consoleAPICalled") {
    const t = (p.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleLines.push(t);
    if (p.type === "error") consoleErrors.push(`console.error: ${t}`);
  }
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  if (msg.method === "Log.entryAdded" && p.entry.level === "error") consoleErrors.push(`log: ${p.entry.text} ${p.entry.url || ""}`);
  if (msg.method === "Network.requestWillBeSent") net.set(p.requestId, { url: p.request.url, type: p.type, status: null, headers: null, failed: null });
  if (msg.method === "Network.responseReceived") {
    const r = net.get(p.requestId) || { url: p.response.url };
    r.status = p.response.status; r.type = p.type;
    r.headers = Object.fromEntries(Object.entries(p.response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    net.set(p.requestId, r);
  }
  if (msg.method === "Network.loadingFailed") { const r = net.get(p.requestId) || {}; r.failed = p.errorText + (p.blockedReason ? ` (${p.blockedReason})` : "") + (p.corsErrorStatus ? ` (${p.corsErrorStatus.corsError})` : ""); net.set(p.requestId, r); }
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
// plausible.io, stood in for: no leg reaches the internet
stub = await plausibleStub(send, { mode: "stub", sites: { [REAL]: BASE } });
const evalJS = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(150); } return null; };
const netSince = (from) => [...net.values()].slice(from);
const good = (r) => !r.failed && r.status !== null && r.status >= 200 && r.status < 400;
// a URL is bad when no request for it succeeded (a request the page
// abandoned and made again is not a missing file)
const badRequests = (list) => { const g = new Set(list.filter(good).map((r) => r.url)); return list.filter((r) => !good(r) && !g.has(r.url) && !/^data:/.test(r.url || "")); };
// the 404 leg's page answers 404 on purpose: its document request, and
// Chrome's log line about it, are not errors (its subresources still are)
const MISSING = "/no-such-page";
const expected404 = (line) => line.endsWith(` ${BASE}${MISSING}`) && /status of 404/.test(line);
const fmtReq = (r) => `${(r.url || "(no url)").replace(BASE, "")} ${r.status ?? ""}${r.failed ?? ""}`;
const visit = async (p, { fonts = true } = {}) => {
  await send("Page.navigate", { url: BASE + p });
  const r = await waitFor(() => evalJS(fonts ? "document.readyState === 'complete' && document.fonts.status === 'loaded'" : "document.readyState === 'complete'"), 15000);
  return r;
};
const errorsAt = {};
const READY = /signal-overdrive: ready/;
const errorsSince = (e0, n0) => [...consoleErrors.slice(e0).filter((l) => !expected404(l)),
  ...badRequests(netSince(n0).filter((r) => !(r.status === 404 && r.url === BASE + MISSING))).map((r) => `request ${fmtReq(r)}`)];
const note = (p, e0, n0) => { errorsAt[p] = errorsSince(e0, n0); };

try {
  // ---- landing ---------------------------------------------------------------------------
  const L0 = [consoleErrors.length, net.size];
  {
    const n0 = net.size;
    const ready = await visit("/");
    await sleep(400);
    const detail = [];
    if (!ready) detail.push("the page or its fonts did not finish loading in 15 s");
    const f = await evalJS(`(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].map((x) => x.family.replace(/"/g, "") + "/" + x.style + "/" + x.weight + "/" + x.status);
      const imgs = [...document.images].map((i) => [i.getAttribute("src"), i.complete && i.naturalWidth > 0, i.naturalWidth + "x" + i.naturalHeight]);
      const logo = document.querySelector("h1 img");
      const h2s = [...document.querySelectorAll("h2")].map((h) => h.textContent.trim());
      return { title: document.title, faces, imgs, h2s,
               links: [...document.querySelectorAll("a")].map((a) => a.href),
               logo: logo && [logo.getAttribute("src"), logo.alt, logo.complete && logo.naturalWidth > 0, logo.naturalWidth + "x" + logo.naturalHeight],
               text: document.body.innerText };
    })()`);
    if (f.title !== "Signal Overdrive") detail.push(`title "${f.title}"`);
    if (!f.logo) detail.push("the h1 holds no logo image");
    else if (f.logo[0] !== "/logo.png" || f.logo[1] !== "Signal Overdrive" || !f.logo[2] || f.logo[3] !== "696x96") detail.push(`the h1's logo is ${f.logo.join(" ")} (want /logo.png "Signal Overdrive", decoded, 696x96)`);
    for (const want of ["JetBrains Mono/normal/400/loaded", "JetBrains Mono/normal/700/loaded", "JetBrains Mono/italic/400/loaded"]) {
      if (!f.faces.includes(want)) detail.push(`font ${want.split("/").slice(0, 3).join(" ")} not loaded (${f.faces.join(", ")})`);
    }
    const shots = f.imgs.filter((i) => /^\/shots\//.test(i[0] || ""));
    if (shots.length < 3) detail.push(`${shots.length} pictures (want at least 3)`);
    for (const i of shots) if (i[2] !== "480x270") detail.push(`${i[0]} is ${i[2]}, not a 480x270 frame`);
    const undecoded = f.imgs.filter((i) => !i[1]);
    if (undecoded.length) detail.push(`images not decoded: ${undecoded.map((i) => i[0]).join(", ")}`);
    if (!f.h2s.some((h) => /song/i.test(h))) detail.push(`no reactive-music section (h2s: ${f.h2s.join(", ")})`);
    if (!/How it's made/i.test(f.text) || !/No image generator was used/.test(f.text)) detail.push("the How it's made disclosure is missing");
    if (!f.links.includes(`${BASE}/fonts/OFL.txt`)) detail.push("no link to the font license");
    if (EM.test(f.text)) detail.push("an em dash in the rendered text");
    const reqs = badRequests(netSince(n0));
    if (reqs.length) detail.push(`requests not 2xx: ${reqs.map(fmtReq).join(", ")}`);
    detail.length ? bad("landing", detail.join("; "))
      : ok("landing", `title and h1 logo; ${f.faces.filter((x) => x.endsWith("/loaded")).length} JetBrains Mono faces loaded; ${f.imgs.length} images decoded (${shots.length} 480x270 pictures); the music and How it's made sections; ${netSince(n0).length} requests, all 2xx`);
  }

  // ---- preview: the link card and the canonical URL ------------------------------------------
  {
    const detail = [];
    const m = await evalJS(`(() => { const q = (s) => { const e = document.querySelector(s); return e ? e.getAttribute("content") ?? e.getAttribute("href") : null; };
      return { og: q('meta[property="og:image"]'), tw: q('meta[name="twitter:image"]'), url: q('meta[property="og:url"]'),
               card: q('meta[name="twitter:card"]'), canon: q('link[rel="canonical"]'),
               w: q('meta[property="og:image:width"]'), h: q('meta[property="og:image:height"]'), alt: q('meta[property="og:image:alt"]') }; })()`);
    const want = `${REAL}/shots/og.png`;
    if (m.og !== want || m.tw !== want) detail.push(`og:image ${m.og}, twitter:image ${m.tw} (want ${want})`);
    if (m.url !== `${REAL}/` || m.canon !== `${REAL}/`) detail.push(`og:url ${m.url}, canonical ${m.canon} (want ${REAL}/)`);
    if (m.card !== "summary_large_image") detail.push(`twitter:card ${m.card}`);
    if (!m.alt || m.alt.length < 20) detail.push("og:image has no real alt text");
    // the file the card names, in the tree: a PNG of the size the page says
    const f = files.includes("shots/og.png") ? fs.readFileSync(path.join(DIR, "shots/og.png")) : null;
    const dims = f && f.subarray(1, 4).toString("latin1") === "PNG" ? [f.readUInt32BE(16), f.readUInt32BE(20)] : null;
    if (!dims) detail.push("shots/og.png is not a PNG in the tree");
    else if (dims.join("x") !== "1200x630" || m.w !== "1200" || m.h !== "630") detail.push(`shots/og.png is ${dims.join("x")}, the page says ${m.w}x${m.h} (want 1200x630)`);
    detail.length ? bad("preview", detail.join("; "))
      : ok("preview", `og:image and twitter:image are ${want}, a 1200x630 PNG in the tree; og:url and the canonical link are ${REAL}/`);
  }

  // ---- logo: the glitch, and the still logo under reduced motion ------------------------------
  // a MutationObserver on the logo's src for 9.5 s (one glitch cycle is 8.8 s)
  {
    const detail = [];
    const watch = `new Promise((r) => { const img = document.querySelector("h1.logo img"); if (!img) return r(null);
      const seen = [img.getAttribute("src")]; const mo = new MutationObserver(() => seen.push(new URL(img.src).pathname));
      mo.observe(img, { attributes: true, attributeFilter: ["src"] });
      setTimeout(() => { mo.disconnect(); r({ seen, glitch: img.dataset.glitch || null, now: new URL(img.src).pathname }); }, 9500); })`;
    // the positive control: without the preference the observer sees a glitch frame
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await visit("/");
    const moving = await evalJS(watch);
    if (!moving) detail.push("no h1.logo img on the landing");
    else {
      if (moving.seen[0] !== "/logo.png") detail.push(`the page's own src is ${moving.seen[0]} (want /logo.png, what shows with JS off)`);
      if (moving.glitch !== "/logo-glitch-{n}.png") detail.push(`data-glitch is ${moving.glitch}`);
      const frames = moving.seen.filter((u) => /^\/logo-glitch-[1-8]\.png$/.test(u));
      if (!frames.length) detail.push(`no glitch frame in 9.5 s (src went ${moving.seen.join(" ")}): the observer saw nothing to tell the two cases apart`);
      // under prefers-reduced-motion: the still logo, and nothing else, for the whole window
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await visit("/");
      const still = await evalJS(watch);
      await send("Emulation.setEmulatedMedia", { features: [] });
      const other = still.seen.filter((u) => u !== "/logo.png");
      if (other.length || still.now !== "/logo.png") detail.push(`under prefers-reduced-motion the logo showed ${[...new Set(other)].join(" ") || still.now}`);
      if (!detail.length) ok("logo", `the logo glitched by itself (${frames.length} frame changes in 9.5 s: ${[...new Set(frames)].join(" ")}); under prefers-reduced-motion it stayed /logo.png for 9.5 s; the page's own src is /logo.png`);
    }
    if (detail.length) bad("logo", detail.join("; "));
  }

  // ---- play: disabled until 0.1 ------------------------------------------------------------
  {
    const detail = [];
    const p = await evalJS(`(() => {
      const b = document.querySelector(".play button");
      const links = [...document.querySelectorAll("a")].map((a) => new URL(a.href, location.href)).filter((u) => u.origin === location.origin && (u.pathname === "/${SLUG}" || u.pathname.startsWith("/${SLUG}/")));
      return { button: !!b, disabled: b && b.disabled, text: b && b.textContent.trim(), how: (document.querySelector(".play .how") || {}).textContent || "",
               anchor: !!document.querySelector(".play a"), gameLinks: links.map((u) => u.pathname) };
    })()`);
    if (!p.button) detail.push("no PLAY button in .play");
    else {
      if (!p.disabled) detail.push("PLAY is not disabled");
      if (p.text !== "GET IN") detail.push(`the button says "${p.text}"`);
    }
    if (p.anchor) detail.push(".play holds a link");
    if (!/coming soon/i.test(p.how)) detail.push(`the line under it says "${p.how}"`);
    if (p.gameLinks.length) detail.push(`the landing links the game: ${p.gameLinks.join(", ")}`);
    // a real click on it: the page must not go anywhere
    if (p.button) {
      const before = await evalJS("location.href");
      const xy = await evalJS(`(() => { const b = document.querySelector(".play button"); b.scrollIntoView({block: "center"}); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 });
      await sleep(800);
      const after = await evalJS("location.href");
      if (after !== before) detail.push(`a click on PLAY went to ${after}`);
    }
    detail.length ? bad("play", detail.join("; ")) : ok("play", `GET IN is a disabled button, a click stays on /, "${p.how.trim()}", and nothing links /${SLUG}/ yet`);
  }

  // ---- carousel ----------------------------------------------------------------------------
  {
    const detail = [];
    const state = () => evalJS(`(() => { const c = document.querySelector(".carousel"); if (!c) return null;
      const imgs = [...c.querySelectorAll(".frames img")];
      const dots = [...c.querySelectorAll(".dots button")];
      const cap = c.querySelector(".caption");
      return { live: c.classList.contains("live"), n: imgs.length, ndots: dots.length,
               shown: imgs.map((i, k) => i.classList.contains("shown") ? k : -1).filter((k) => k >= 0),
               visible: imgs.map((i, k) => getComputedStyle(i).opacity === "1" ? k : -1).filter((k) => k >= 0),
               current: dots.map((b, k) => b.getAttribute("aria-current") === "true" ? k : -1).filter((k) => k >= 0),
               caption: cap ? cap.textContent : null, ariaLive: cap ? cap.getAttribute("aria-live") : null, labels: dots.map((b) => b.getAttribute("aria-label")),
               alts: imgs.every((i) => (i.getAttribute("alt") || "").length > 10),
               every: Number(c.getAttribute("data-interval")) }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await visit("/");
    const s0 = await state();
    if (!s0) detail.push("no .carousel on the landing");
    else {
      if (!s0.live) detail.push("the carousel's script did not run (no .live)");
      if (s0.n < 3 || s0.n !== s0.ndots) detail.push(`${s0.n} pictures and ${s0.ndots} dots`);
      if (s0.shown.join() !== "0" || s0.current.join() !== "0") detail.push(`at load: shown ${s0.shown}, dot ${s0.current} (want 0, 0)`);
      if (s0.caption !== s0.labels[0]) detail.push(`at load the caption is "${s0.caption}", not "${s0.labels[0]}"`);
      if (!s0.alts) detail.push("a picture without a real alt text");
      // rotating by itself, the caption is not announced (every 6 s would be noise)
      if (s0.ariaLive !== "off") detail.push(`while rotating the caption is aria-live="${s0.ariaLive}" (want off)`);
      const moved = await waitFor(async () => { const s = await state(); return s.shown.length === 1 && s.shown[0] !== 0 ? s : null; }, s0.every + 3000);
      if (!moved) detail.push(`no automatic change within ${s0.every + 3000} ms`);
      const last = s0.ndots - 1;
      const xy = await evalJS(`(() => { const b = document.querySelectorAll(".carousel .dots button")[${last}]; b.scrollIntoView({block: "center"}); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 });
      await sleep(1700);   // past the 1.2 s fade
      const s1 = await state();
      if (s1.shown.join() !== `${last}` || s1.current.join() !== `${last}` || s1.visible.join() !== `${last}`) detail.push(`after a click on the last dot: shown ${s1.shown}, dot ${s1.current}, opaque ${s1.visible} (want ${last})`);
      if (s1.caption !== s1.labels[last]) detail.push(`after the click the caption is "${s1.caption}", not "${s1.labels[last]}"`);
      // a choice stops the rotation for good (WCAG 2.2.2), and from then on the caption is announced
      if (s1.ariaLive !== "polite") detail.push(`after a click the caption is aria-live="${s1.ariaLive}" (want polite)`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
      await sleep(s0.every + 1500);
      const s1b = await state();
      if (s1b.shown.join() !== `${last}`) detail.push(`${s0.every + 1500} ms after a click the picture moved on to ${s1b.shown} (a click must stop the rotation)`);
      // keyboard focus inside the carousel pauses it
      await visit("/");
      await evalJS(`document.querySelector(".carousel .dots button").focus()`);
      await sleep(s0.every + 2000);
      const sf = await state();
      if (sf.shown.join() !== "0") detail.push(`with a dot focused the picture changed to ${sf.shown}`);
      await evalJS("document.activeElement && document.activeElement.blur()");
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await visit("/");
      await sleep(s0.every + 2000);
      const s2 = await state();
      if (s2.shown.join() !== "0") detail.push(`under prefers-reduced-motion the picture changed to ${s2.shown}`);
      await send("Emulation.setEmulatedMedia", { features: [] });
      if (!detail.length) ok("carousel", `${s0.n} pictures, one shown; moved to ${moved.shown[0]} by itself within ${s0.every + 3000} ms; the last dot shows the last picture and its caption and stops the rotation; paused while a dot has focus; silent while rotating; still under reduced motion for ${s0.every + 2000} ms`);
    }
    if (detail.length) bad("carousel", detail.join("; "));
  }

  // ---- phone -------------------------------------------------------------------------------
  {
    const detail = [], got = [];
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const p of ["/", MISSING]) {
      await visit(p);
      await sleep(300);
      const m = await evalJS(`(() => { const d = document.documentElement;
        const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; };
        return { vw: window.innerWidth, screen: screen.width, sw: Math.max(d.scrollWidth, document.body.scrollWidth),
                 play: box(".play button"), logo: box("h1.logo img") }; })()`);
      got.push(`${p} ${m.sw}/${m.vw}`);
      // a mobile browser widens the layout to fit content wider than the
      // screen (and zooms out), so a wide page shows as innerWidth > 390
      if (m.screen !== 390) detail.push(`${p}: the screen is ${m.screen} px, not the emulated 390 (the leg measured nothing)`);
      else if (m.vw > 390) detail.push(`${p} forced a ${m.vw} px layout on a 390 px phone (something is wider than the screen)`);
      if (m.sw > m.vw) detail.push(`${p} is ${m.sw} px wide on a ${m.vw} px screen`);
      for (const [k, b] of [["GET IN", m.play], ["the logo", m.logo]]) if (b && (b[0] < 0 || b[1] > m.vw)) detail.push(`${p}: ${k} spans ${b[0]}..${b[1]} px on a ${m.vw} px screen`);
      if (p === "/" && (!m.play || !m.logo)) detail.push("/: no PLAY button or logo to measure");
    }
    await send("Emulation.clearDeviceMetricsOverride");
    detail.length ? bad("phone", detail.join("; ")) : ok("phone", `no horizontal scroll at 390 px: ${got.join(", ")} (content/viewport px); the logo and GET IN on screen`);
  }
  note("/ (landing, play, carousel, phone)", L0[0], L0[1]);

  // ---- contrast: every text role readable ------------------------------------------------
  // each role against the background actually behind it: 4.5:1, or 3:1 for
  // large text (24 px, or 18.66 px bold); a floor on the roles measured, so a
  // page whose selectors all missed is no pass
  {
    const detail = [], got = [];
    const measure = `(() => {
      const rgb = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const b = rgb(getComputedStyle(x).backgroundColor); if (b.a > 0) return b.c; } return rgb(getComputedStyle(document.documentElement).backgroundColor).c; };
      const out = [];
      for (const sel of [".tagline", ".pitch p", ".pitch a", ".carousel .caption", ".play button", ".play .badge", ".play .how", "h2", ".music p", ".early", ".made p", "footer p", "footer a", "h1.name", ".lost p", ".lost a"]) {
        const e = document.querySelector(sel); if (!e) continue;
        const cs = getComputedStyle(e), px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
        const fg = rgb(cs.color).c, bg = bgOf(e), L1 = lum(fg), L2 = lum(bg);
        out.push({ sel, ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), need: px >= 24 || (bold && px >= 18.66) ? 3 : 4.5, color: cs.color });
      }
      return { out };
    })()`;
    for (const [p, floor] of [["/", 12], [MISSING, 3]]) {
      await visit(p);
      const m = await evalJS(measure);
      if (m.out.length < floor) detail.push(`${p}: ${m.out.length} text roles measured (want at least ${floor})`);
      for (const r of m.out) if (!(r.ratio >= r.need)) detail.push(`${p} ${r.sel}: ${r.ratio.toFixed(2)}:1 (want ${r.need})`);
      got.push(`${p} ${m.out.length} roles, lowest ${Math.min(...m.out.map((r) => r.ratio)).toFixed(1)}:1`);
    }
    detail.length ? bad("contrast", detail.slice(0, 6).join("; ")) : ok("contrast", `every text role readable: ${got.join("; ")}`);
  }

  // ---- version: no release number in the copy ---------------------------------------------
  // the page names no version (GET IN, not PLAY 0.1), so nothing in the copy
  // needs changing per release; a license id like GPL-3.0-or-later is not one
  {
    const detail = [];
    const VER = /(?<![\w.:-])v?\d+\.\d+(?:\.\d+)?(?![\w-]|\.\d)/g;
    for (const p of ["/", MISSING]) {
      await visit(p);
      const t = await evalJS(`[document.title, (document.querySelector('meta[name="description"]') || {}).content || "", ...[...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')].map((m) => m.content), document.body.innerText].join("\\n")`);
      const hits = [...new Set(t.match(VER) || [])];
      if (hits.length) detail.push(`${p} names ${hits.join(", ")}`);
      if (!t.length) detail.push(`${p}: no text read`);
    }
    detail.length ? bad("version", detail.join("; ")) : ok("version", "no version number in the title, the meta and link-card text, or the rendered copy of / and the 404");
  }

  // ---- 404 ---------------------------------------------------------------------------------
  {
    const e0 = consoleErrors.length, n0 = net.size;
    await visit(MISSING);
    const f = await evalJS(`({ h1: (document.querySelector("h1") || {}).textContent, home: [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/"), title: document.title })`);
    f.h1 === "404" && f.home && /Signal Overdrive/.test(f.title) ? ok("404", `a missing page shows "${f.title}", its 404 and a link home`)
      : bad("404", `h1 "${f.h1}", link home ${f.home}, title "${f.title}"`);
    note(`${MISSING} (the 404)`, e0, n0);
    // a missing page under the game's path: the 404 is served from there,
    // so a relative link in it would resolve under /${SLUG}/ and break
    const e1 = consoleErrors.length, n1 = net.size, sub = `/${SLUG}${MISSING}`;
    await send("Page.navigate", { url: BASE + sub });
    await waitFor(() => evalJS("document.readyState === 'complete' && document.fonts.status === 'loaded'"), 15000);
    const g = await evalJS(`({ h1: (document.querySelector("h1") || {}).textContent, css: [...document.styleSheets].some((x) => { try { return !!x.href && x.cssRules.length > 0; } catch { return false; } }) })`);
    if (g.h1 !== "404" || !g.css) bad("404", `${sub}: h1 "${g.h1}", stylesheet loaded ${g.css}`);
    else ok("404", `${sub} shows the same 404, styled`);
    errorsAt[`${sub} (the 404 under the game)`] = [...consoleErrors.slice(e1).filter((l) => !(l.endsWith(` ${BASE}${sub}`) && /status of 404/.test(l))),
      ...badRequests(netSince(n1).filter((r) => !(r.status === 404 && r.url === BASE + sub))).map((r) => `request ${fmtReq(r)}`)];
  }

  // ---- isolation: the game's path, and the landing as the control --------------------------
  {
    const detail = [];
    const e0 = consoleErrors.length, n0 = net.size, l0 = consoleLines.length;
    await visit(`/${SLUG}/`, { fonts: false });
    const ready = await waitFor(async () => consoleLines.slice(l0).some((l) => /signal-overdrive: ready/.test(l)), 60000);
    const g = await evalJS(`(() => { let sab = false; try { sab = new SharedArrayBuffer(8).byteLength === 8; } catch (e) { sab = false; } return { iso: self.crossOriginIsolated, sab, href: location.href }; })()`);
    const doc = netSince(n0).find((r) => r.type === "Document" && new URL(r.url).pathname === `/${SLUG}/`);
    if (!doc || !doc.headers) detail.push(`no document response for /${SLUG}/ was seen`);
    else for (const [k, v] of Object.entries(ISOLATION)) if (doc.headers[k] !== v) detail.push(`the document's ${k} is ${doc.headers[k] ?? "absent"} (want ${v})`);
    if (g.iso !== true) detail.push(`crossOriginIsolated is ${g.iso}`);
    if (!g.sab) detail.push("no working SharedArrayBuffer");
    if (!ready) detail.push("the game never said ready in 60 s");
    // the game's own word on its audio ring: worklet-sab is the bridge's
    // SharedArrayBuffer path (anything else is a fallback)
    let mode = null;
    if (ready) {
      const l1 = consoleLines.length;
      await evalJS(`(globalThis.SigilWebApp).dispatch("probe", "")`);
      const probe = await waitFor(async () => consoleLines.slice(l1).find((l) => /signal-overdrive: probe /.test(l)), 10000);
      mode = probe ? (probe.match(/ mode (\S+)/) || [])[1] : null;
      if (mode !== "worklet-sab") detail.push(`the game's audio ring is ${mode ?? "unreported"} (want worklet-sab)${probe ? "" : ": no probe line"}`);
    }
    const wasm = netSince(n0).filter((r) => /\.wasm$/.test(new URL(r.url).pathname));
    if (!wasm.some(good)) detail.push(`the wasm did not load: ${wasm.map(fmtReq).join(", ") || "never asked for"}`);
    // watch the running game a while for late errors (the race runs on the title's autostart)
    await sleep(8000);
    note(`/${SLUG}/ (the game, 8 s after its probe)`, e0, n0);
    // the control: the landing, which must NOT be isolated, so the probe above
    // is seen to tell the two apart
    await visit("/");
    const c = await evalJS(`({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer })`);
    if (c.iso !== false || c.sab !== "undefined") detail.push(`the control: / has crossOriginIsolated ${c.iso} and SharedArrayBuffer ${c.sab} (want false, undefined)`);
    detail.length ? bad("isolation", detail.join("; "))
      : ok("isolation", `/${SLUG}/ is crossOriginIsolated with a working SharedArrayBuffer (document: COOP ${doc.headers["cross-origin-opener-policy"]}, COEP ${doc.headers["cross-origin-embedder-policy"]}, CORP ${doc.headers["cross-origin-resource-policy"]}); the game's audio ring is ${mode}; the control / is not isolated and has no SharedArrayBuffer`);
  }

  // ---- local: the loopback host asks plausible.io for nothing ------------------------------
  // every leg above ran at BASE (127.0.0.1), not signaloverdrive.net, as the
  // review host does; the gated snippet must not have loaded the script there
  {
    const pl = [...net.values()].filter((r) => /^https:\/\/plausible\.io\//.test(r.url || ""));
    const loaded = await evalJS("!!(window.plausible && window.plausible.l)").catch(() => null);
    pl.length || stub.scripts.length || stub.events.length || loaded !== false
      ? bad("local", `at ${BASE}: ${pl.length} requests to plausible.io (${pl.slice(0, 3).map((r) => r.url).join(", ")}), ${stub.scripts.length} script and ${stub.events.length} event requests at the stub; the script ${loaded === false ? "did not run" : "ran or could not be asked"}`)
      : ok("local", `/, ${MISSING}, /${SLUG}/ at ${BASE} (not ${PLAUSIBLE_DOMAIN}, as on a private preview): no request to plausible.io, no script`);
  }

  // ---- privacy ----------------------------------------------------------------------------
  {
    await visit("/");
    const f = await evalJS(`(() => { const p = [...document.querySelectorAll("footer p")].find((x) => x.textContent.includes("Plausible")); return p ? { text: p.textContent.trim(), href: (p.querySelector("a") || {}).href } : null; })()`);
    f && f.text === PRIVACY && f.href === "https://plausible.io/data-policy" ? ok("privacy", `the footer says "${PRIVACY}" and links the data policy`)
      : bad("privacy", f ? `the footer line is "${f.text}" linking ${f.href}` : "no privacy line in the footer");
  }

  // ---- analytics: at https://signaloverdrive.net, through the stub ---------------------------
  {
    const detail = [], got = [];
    for (const p of ["/", MISSING, `/${SLUG}/`]) {
      const e0 = consoleErrors.length, l0 = consoleLines.length, ev0 = stub.events.length;
      await send("Page.navigate", { url: REAL + p });
      await waitFor(() => evalJS("document.readyState === 'complete'"), 15000);
      if (p === `/${SLUG}/` && !(await waitFor(async () => consoleLines.slice(l0).some((l) => READY.test(l)), 60000))) detail.push(`${p}: the game never said ready at ${REAL}`);
      const st = await waitFor(() => evalJS("window.__plausibleStub && window.__plausibleStub.length ? JSON.stringify({ href: location.href, st: window.__plausibleStub, coi: self.crossOriginIsolated }) : null"), 8000)
        .then((v) => v && JSON.parse(v));
      const evs = stub.events.slice(ev0).filter((e) => e.body && e.body.n === "pageview" && e.body.u === REAL + p && e.body.d === PLAUSIBLE_DOMAIN);
      if (!st) detail.push(`${p}: no event status came back to the page (the script did not run, or its POST failed)`);
      else if (!st.st.includes(202)) detail.push(`${p}: the page got ${JSON.stringify(st.st)}, not 202`);
      else if (st.href !== REAL + p) detail.push(`${p}: the status came from ${st.href}, not ${REAL + p}`);
      if (!evs.length) detail.push(`${p}: the stub received no pageview for ${REAL + p}`);
      if (p === `/${SLUG}/` && (!st || st.coi !== true)) detail.push(`${p} is not cross-origin isolated with the analytics loaded (${st && st.coi})`);
      // the missing page's own 404 is the point, not an error
      if (p === MISSING) for (let i = consoleErrors.length - 1; i >= e0; i--) if (/status of 404/.test(consoleErrors[i]) && consoleErrors[i].endsWith(REAL + MISSING)) consoleErrors.splice(i, 1);
      errorsAt[`${p} at ${PLAUSIBLE_DOMAIN}`] = consoleErrors.slice(e0);
      if (st) got.push(p);
    }
    const wrongScript = stub.scripts.filter((sc) => sc.id !== PLAUSIBLE_ID);
    if (wrongScript.length) detail.push(`scripts requested for other IDs: ${[...new Set(wrongScript.map((sc) => sc.id))].join(", ")}`);
    const wrongDomain = stub.events.filter((e) => !e.body || e.body.d !== PLAUSIBLE_DOMAIN);
    if (wrongDomain.length) detail.push(`${wrongDomain.length} event(s) not for ${PLAUSIBLE_DOMAIN}: ${JSON.stringify(wrongDomain[0].body).slice(0, 120)}`);
    detail.length ? bad("analytics", detail.slice(0, 6).join("; "))
      : ok("analytics", `at ${REAL}: ${got.join(", ")} each loaded the script and sent a pageview for ${PLAUSIBLE_DOMAIN} that came back 202; /${SLUG}/ cross-origin isolated with it (${stub.scripts.length} script requests, ${stub.events.length} events)`);
  }

  // ---- coep: the game's page really judges plausible.io's CORP --------------------------------
  // (Harkfell's leg: without it, "isolated with the script loaded" cannot tell
  // "COEP passed the script" from "COEP never looked")
  {
    const detail = [];
    stub.setMode("nocorp");
    const s0 = stub.scripts.length, ev0 = stub.events.length, c0 = consoleErrors.length, l0 = consoleLines.length;
    await send("Page.navigate", { url: `${REAL}/${SLUG}/` });
    if (!(await waitFor(async () => consoleLines.slice(l0).some((l) => READY.test(l)), 60000))) detail.push(`/${SLUG}/: the game never said ready`);
    await sleep(3000);
    const st = await evalJS("JSON.stringify({ st: window.__plausibleStub || null, coi: self.crossOriginIsolated, l: !!(window.plausible && window.plausible.l) })").then(JSON.parse).catch(() => null);
    if (stub.scripts.length === s0) detail.push("the script was never requested (the leg judged nothing)");
    if (!st || st.coi !== true) detail.push(`/${SLUG}/ is not cross-origin isolated (${st && st.coi})`);
    else if (st.l || st.st || stub.events.length !== ev0) detail.push(`a plausible.io script without CORP ran on the isolated page (events ${stub.events.length - ev0}, status ${JSON.stringify(st.st)})`);
    // the block is this leg's doing: its console line is not an error of the site's
    for (let i = consoleErrors.length - 1; i >= c0; i--) if (/ERR_BLOCKED_BY_RESPONSE\.NotSameOriginAfterDefaultedToSameOriginByCoep https:\/\/plausible\.io\/\S+$/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
    errorsAt[`/${SLUG}/ at ${PLAUSIBLE_DOMAIN}, plausible.io without CORP`] = consoleErrors.slice(c0);
    stub.setMode("stub");
    detail.length ? bad("coep", detail.join("; "))
      : ok("coep", `/${SLUG}/ at ${PLAUSIBLE_DOMAIN} asked for a plausible.io script sent without CORP, COEP blocked it, and the page stayed isolated`);
  }

  // ---- analytics-down: plausible.io unreachable ------------------------------------------------
  {
    stub.setMode("down");
    const detail = [];
    const f0 = stub.failed.length;
    for (const p of ["/", `/${SLUG}/`]) {
      const e0 = consoleErrors.length, l0 = consoleLines.length;
      await send("Page.navigate", { url: REAL + p });
      await waitFor(() => evalJS("document.readyState === 'complete'"), 15000);
      if (p === "/") {
        const alt = await evalJS("(document.querySelector('h1 img') || {}).alt || null").catch(() => null);
        if (alt !== "Signal Overdrive") detail.push(`/: the landing did not render (h1 ${JSON.stringify(alt)})`);
      } else {
        if (!(await waitFor(async () => consoleLines.slice(l0).some((l) => READY.test(l)), 60000))) detail.push(`${p}: the game never said ready with plausible.io unreachable`);
        const iso = await evalJS("self.crossOriginIsolated").catch(() => null);
        if (iso !== true) detail.push(`${p} is not cross-origin isolated (${iso})`);
      }
      await sleep(1000);
      const errs = consoleErrors.slice(e0).filter((l) => !isPlausibleFailure(l));
      if (errs.length) detail.push(`${p}: errors besides the refused plausible.io requests: ${errs.slice(0, 2).join(" | ").slice(0, 200)}`);
    }
    // the positive control: the refusal happened, so the leg tested something
    if (stub.failed.length === f0) detail.push("no plausible.io request was refused (the leg tested nothing)");
    stub.setMode("stub");
    detail.length ? bad("analytics-down", detail.join("; "))
      : ok("analytics-down", `with plausible.io refused (${stub.failed.length - f0} requests), / renders and /${SLUG}/ starts, isolated, with no other error`);
  }

  // ---- console -----------------------------------------------------------------------------
  {
    const dirty = Object.entries(errorsAt).filter(([, e]) => e.length);
    dirty.length ? bad("console", dirty.map(([p, e]) => `${p}: ${e.slice(0, 3).join(" | ").slice(0, 300)}`).join("; "))
      : ok("console", `no console error, exception or failed request on ${Object.keys(errorsAt).join(", ")}`);
  }
} catch (e) {
  console.log(/SETUP-FAILED/.test(String(e)) ? String(e).replace(/^Error: /, "") : `SETUP-FAILED: the browser legs threw: ${e && e.stack || e}`);
  stub && stub.close();
  process.exit(2);
}
stub.close();
process.exit(fail ? 1 : 0);
