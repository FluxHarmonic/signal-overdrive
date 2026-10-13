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
//   tree       the site's own files are staged: the page, the art, the
//              Flux Harmonic mark, the fonts and their OFL.txt
//   headers    the tree's _headers, read with substratic's own parser (the one
//              serve-site applies), gives the game's path /<game>/ and its
//              files COOP same-origin, COEP require-corp and CORP same-origin,
//              and gives the landing, the 404 and the other site files none
//              of the three: only the game is isolated
//   em-dash    no em dash in the site's own text files
//   analytics  every HTML page in the tree, the game's page included, carries
//              David's Plausible snippet with signaloverdrive.net's script ID
//              exactly once, in <head>, and no other site's
//                (scripts/plausible-check.mjs, shared with the other game sites)
// In headless Chrome (muted, into the worker-null sink), with plausible.io
// stood in for so nothing reaches the internet:
//   landing    /: the title, the logo (291x27, alt "Signal Overdrive"), the
//              three JetBrains Mono faces loaded, every image decoded and the
//              pictures 480x270, the reactive-music section, the How it's
//              made disclosure, the font license link, no em dash in the
//              rendered text, every request 2xx
//   play       PLAY 0.1 is a disabled button that says so, a click on it goes
//              nowhere, the page says it is coming soon, and nothing on the
//              landing links the game's path yet
//   carousel   the pictures change by themselves, a click on a dot shows that
//              picture and its caption, one shows at a time, and under
//              prefers-reduced-motion nothing changes by itself
//   phone      at 390 CSS px (a phone, emulated), / and the 404 have no
//              horizontal scroll, and the logo and PLAY 0.1 fit on screen
//   404        a missing page shows the 404's number and a link home
//   analytics  / and the 404 each load the script and send a pageview for
//              signaloverdrive.net that the stub accepts (202, seen by the
//              page), and so does the game's page while it stays isolated
//   privacy    the landing's footer has the privacy line and its link
//   isolation  /<game>/ is crossOriginIsolated with a working SharedArrayBuffer,
//              its document answered with COOP, COEP and CORP, and the game
//              itself reports its audio ring as "worklet-sab" (the bridge's
//              SharedArrayBuffer path). The control: / is NOT isolated and
//              has no SharedArrayBuffer, so the probe can tell the two apart.
//   console    no console error, exception or failed request on /, the 404 or
//              the game
// Exit 0 green, 1 red, 2 setup failed (the line starts SETUP-FAILED).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { auditTree, plausibleStub, PRIVACY } from "./plausible-check.mjs";

const PLAUSIBLE_ID = "pa-GCzY0KZPnFuB1DEsbPead";
const PLAUSIBLE_DOMAIN = "signaloverdrive.net";
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

// ---- tree ------------------------------------------------------------------------------
{
  const want = ["index.html", "404.html", "style.css", "logo.png", "favicon.png", "favicon.ico", "mark.png", "shots/og.png",
                "fonts/OFL.txt", "fonts/JetBrainsMono-Regular.woff2", "fonts/JetBrainsMono-Bold.woff2", "fonts/JetBrainsMono-Italic.woff2",
                `${SLUG}/index.html`];
  const missing = want.filter((f) => !files.includes(f));
  missing.length ? bad("tree", `missing: ${missing.join(", ")}`) : ok("tree", `the site's ${want.length} named files are staged`);
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
let gameTagged = false;
{
  const { pages, problems } = auditTree(DIR, PLAUSIBLE_ID);
  // a floor: the pages that must be there, so an empty walk is no pass
  const must = ["index.html", "404.html", `${SLUG}/index.html`];
  const absent = must.filter((p) => !pages.includes(p));
  if (absent.length) problems.push(`pages missing from the walk: ${absent.join(", ")}`);
  gameTagged = !problems.some((p) => p.startsWith(`${SLUG}/index.html`));
  problems.length ? bad("analytics", problems.slice(0, 6).join("; "))
    : ok("analytics", `David's snippet with ${PLAUSIBLE_ID} (${PLAUSIBLE_DOMAIN}) once, in <head>, on all ${pages.length} HTML pages: ${pages.join(", ")}`);
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
stub = await plausibleStub(send, { mode: "stub" });
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
const fmtReq = (r) => `${(r.url || "(no url)").replace(BASE, "")} ${r.status ?? ""}${r.failed ?? ""}`;
// what each page's analytics saw: its URL -> the event statuses it got back
const seen = new Map();
const notePlausible = async () => {
  const got = await waitFor(() => evalJS("window.__plausibleStub && window.__plausibleStub.length ? JSON.stringify([location.href, window.__plausibleStub]) : null"), 5000);
  if (got) { const [u, st] = JSON.parse(got); seen.set(u, st); }
};
const visit = async (p, { fonts = true } = {}) => {
  await send("Page.navigate", { url: BASE + p });
  const r = await waitFor(() => evalJS(fonts ? "document.readyState === 'complete' && document.fonts.status === 'loaded'" : "document.readyState === 'complete'"), 15000);
  await notePlausible();
  return r;
};
const errorsAt = {};
const note = (p, e0, n0) => { errorsAt[p] = [...consoleErrors.slice(e0), ...badRequests(netSince(n0)).map((r) => `request ${fmtReq(r)}`)]; };

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
    else if (f.logo[0] !== "/logo.png" || f.logo[1] !== "Signal Overdrive" || !f.logo[2] || f.logo[3] !== "291x27") detail.push(`the h1's logo is ${f.logo.join(" ")} (want /logo.png "Signal Overdrive", decoded, 291x27)`);
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
      if (p.text !== "PLAY 0.1") detail.push(`the button says "${p.text}"`);
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
    detail.length ? bad("play", detail.join("; ")) : ok("play", `PLAY 0.1 is a disabled button, a click stays on /, "${p.how.trim()}", and nothing links /${SLUG}/ yet`);
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
               caption: cap ? cap.textContent : null, labels: dots.map((b) => b.getAttribute("aria-label")),
               alts: imgs.every((i) => (i.getAttribute("alt") || "").length > 10),
               every: Number(c.getAttribute("data-interval")) }; })()`);
    await visit("/");
    const s0 = await state();
    if (!s0) detail.push("no .carousel on the landing");
    else {
      if (!s0.live) detail.push("the carousel's script did not run (no .live)");
      if (s0.n < 3 || s0.n !== s0.ndots) detail.push(`${s0.n} pictures and ${s0.ndots} dots`);
      if (s0.shown.join() !== "0" || s0.current.join() !== "0") detail.push(`at load: shown ${s0.shown}, dot ${s0.current} (want 0, 0)`);
      if (s0.caption !== s0.labels[0]) detail.push(`at load the caption is "${s0.caption}", not "${s0.labels[0]}"`);
      if (!s0.alts) detail.push("a picture without a real alt text");
      const moved = await waitFor(async () => { const s = await state(); return s.shown.length === 1 && s.shown[0] !== 0 ? s : null; }, s0.every + 3000);
      if (!moved) detail.push(`no automatic change within ${s0.every + 3000} ms`);
      const last = s0.ndots - 1;
      const xy = await evalJS(`(() => { const b = document.querySelectorAll(".carousel .dots button")[${last}]; b.scrollIntoView({block: "center"}); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: xy[0], y: xy[1], button: "left", clickCount: 1 });
      await sleep(1700);   // past the 1.2 s fade
      const s1 = await state();
      if (s1.shown.join() !== `${last}` || s1.current.join() !== `${last}` || s1.visible.join() !== `${last}`) detail.push(`after a click on the last dot: shown ${s1.shown}, dot ${s1.current}, opaque ${s1.visible} (want ${last})`);
      if (s1.caption !== s1.labels[last]) detail.push(`after the click the caption is "${s1.caption}", not "${s1.labels[last]}"`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await visit("/");
      await sleep(s0.every + 2000);
      const s2 = await state();
      if (s2.shown.join() !== "0") detail.push(`under prefers-reduced-motion the picture changed to ${s2.shown}`);
      await send("Emulation.setEmulatedMedia", { features: [] });
      if (!detail.length) ok("carousel", `${s0.n} pictures, one shown; moved to ${moved.shown[0]} by itself within ${s0.every + 3000} ms; the last dot shows the last picture and its caption; still under reduced motion for ${s0.every + 2000} ms`);
    }
    if (detail.length) bad("carousel", detail.join("; "));
  }

  // ---- phone -------------------------------------------------------------------------------
  {
    const detail = [], got = [];
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const p of ["/", "/no-such-page"]) {
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
      for (const [k, b] of [["PLAY 0.1", m.play], ["the logo", m.logo]]) if (b && (b[0] < 0 || b[1] > m.vw)) detail.push(`${p}: ${k} spans ${b[0]}..${b[1]} px on a ${m.vw} px screen`);
      if (p === "/" && (!m.play || !m.logo)) detail.push("/: no PLAY button or logo to measure");
    }
    await send("Emulation.clearDeviceMetricsOverride");
    detail.length ? bad("phone", detail.join("; ")) : ok("phone", `no horizontal scroll at 390 px: ${got.join(", ")} (content/viewport px); the logo and PLAY 0.1 on screen`);
  }
  note("/ (landing, play, carousel, phone)", L0[0], L0[1]);

  // ---- 404 ---------------------------------------------------------------------------------
  {
    const e0 = consoleErrors.length, n0 = net.size;
    await visit("/no-such-page");
    const f = await evalJS(`({ h1: (document.querySelector("h1") || {}).textContent, home: [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/"), title: document.title })`);
    f.h1 === "404" && f.home && /Signal Overdrive/.test(f.title) ? ok("404", `a missing page shows "${f.title}", its 404 and a link home`)
      : bad("404", `h1 "${f.h1}", link home ${f.home}, title "${f.title}"`);
    // the 404's own request is a 404 by design: only its subresources count
    const sub = netSince(n0).filter((r) => !/\/no-such-page$/.test(r.url || ""));
    errorsAt["/no-such-page (the 404)"] = [...consoleErrors.slice(e0), ...badRequests(sub).map((r) => `request ${fmtReq(r)}`)];
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
    await sleep(500);
    errorsAt[`/${SLUG}/ (the game)`] = [...consoleErrors.slice(e0), ...badRequests(netSince(n0)).map((r) => `request ${fmtReq(r)}`)];
    // the control: the landing, which must NOT be isolated, so the probe above
    // is seen to tell the two apart
    await visit("/");
    const c = await evalJS(`({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer })`);
    if (c.iso !== false || c.sab !== "undefined") detail.push(`the control: / has crossOriginIsolated ${c.iso} and SharedArrayBuffer ${c.sab} (want false, undefined)`);
    detail.length ? bad("isolation", detail.join("; "))
      : ok("isolation", `/${SLUG}/ is crossOriginIsolated with a working SharedArrayBuffer (document: COOP ${doc.headers["cross-origin-opener-policy"]}, COEP ${doc.headers["cross-origin-embedder-policy"]}, CORP ${doc.headers["cross-origin-resource-policy"]}); the game's audio ring is ${mode}; the control / is not isolated and has no SharedArrayBuffer`);
  }

  // ---- analytics in the browser ------------------------------------------------------------
  {
    const detail = [];
    const want = [`${BASE}/`, `${BASE}/no-such-page`, ...(gameTagged ? [`${BASE}/${SLUG}/`] : [])];
    for (const u of want) {
      const st = seen.get(u);
      if (!st) detail.push(`${u.replace(BASE, "") || "/"}: no pageview reached the stub`);
      else if (!st.includes(202)) detail.push(`${u.replace(BASE, "")}: the stub answered ${st.join(", ")}`);
    }
    const events = stub.events.filter((e) => { try { return JSON.parse(e.body).d === PLAUSIBLE_DOMAIN; } catch { return false; } });
    if (!events.length) detail.push(`no event for ${PLAUSIBLE_DOMAIN} reached the stub`);
    const others = stub.events.filter((e) => { try { return JSON.parse(e.body).d !== PLAUSIBLE_DOMAIN; } catch { return true; } });
    if (others.length) detail.push(`${others.length} events for another domain`);
    detail.length ? bad("analytics", detail.join("; "))
      : ok("analytics", `${want.map((u) => u.replace(BASE, "") || "/").join(", ")} each sent a pageview for ${PLAUSIBLE_DOMAIN} the stub accepted (202)${gameTagged ? `, the game's page while isolated` : ""}; ${events.length} events in all`);
    if (!gameTagged) bad("analytics", `/${SLUG}/ was not checked in the browser: its page has no snippet (the analytics leg above names it)`);
  }

  // ---- privacy ----------------------------------------------------------------------------
  {
    await visit("/");
    const f = await evalJS(`(() => { const p = [...document.querySelectorAll("footer p")].find((x) => x.textContent.includes("Plausible")); return p ? { text: p.textContent.trim(), href: (p.querySelector("a") || {}).href } : null; })()`);
    f && f.text === PRIVACY && f.href === "https://plausible.io/data-policy" ? ok("privacy", `the footer says "${PRIVACY}" and links the data policy`)
      : bad("privacy", f ? `the footer line is "${f.text}" linking ${f.href}` : "no privacy line in the footer");
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
