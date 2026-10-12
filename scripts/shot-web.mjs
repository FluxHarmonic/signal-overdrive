// shot-web.mjs - copied from Phantom Burn's scripts/shot-web.mjs (07a765d):
// the ready line is the racer's and there is no analytics stub.
//
// One PNG of the web build's canvas, the 480x270 frame at
// exactly --scale device pixels per frame pixel.
//
//   node scripts/shot-web.mjs BUILD OUT.png --query "shot=0&hud=0"
//                             [--scale N] [--port N] [--cdp N] [--wait MS]
//                             [--console FILE] [--requests FILE] [--eval JS]
//
// --url BASE uses a server that is already running (BASE ends in /, e.g.
// substratic check-site's serve-site on a staged tree) instead of serving
// BUILD itself; the page opened is BASE?QUERY.
//
// --eval JS runs in the page once the game is ready, before the wait (e.g.
// clicking the lab panel's buttons: a behavioural check of the page).
//
// Serves BUILD on loopback, boots headless Chrome (SwiftShader), opens
// index.html?QUERY, waits for "phantom-burn: ready", sets the viewport to
// 480*scale x 270*scale CSS pixels at a device pixel ratio of 1 (so the
// game's whole-scale fit fills the canvas exactly), waits --wait ms and
// reads the canvas inside a frame. After Harkfell's scripts/shot.mjs, itself
// reduced from Crash The Stack's shot-web.mjs.
//
// Prints "shot -> OUT (W x H)"; exit 1 when the console showed an error;
// SETUP-FAILED and exit 2 when the game never said it was ready or the
// canvas is the wrong size; TIMED-OUT and exit 2 after 120 s.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const VALUED = ["--query", "--scale", "--port", "--cdp", "--wait", "--console", "--requests", "--eval", "--url"];
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1])));
const ROOT = path.resolve(positional[0] || "build/web");
const OUT = positional[1] || "/tmp/signal-overdrive-shot.png";
const QUERY = opt("--query", "");
const SCALE = parseInt(opt("--scale", "1"), 10);
const PORT = parseInt(opt("--port", "8491"), 10);
const CDP = parseInt(opt("--cdp", "9491"), 10);
const W = 480, H = 270;

const URL_BASE = opt("--url");
if (!URL_BASE && !fs.existsSync(path.join(ROOT, "index.html"))) { console.log(`SETUP-FAILED: ${ROOT}/index.html missing; build --config web first`); process.exit(2); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".b64": "text/plain", ".sgm": "application/octet-stream" };
const requests = [];
const server = http.createServer((req, res) => {
  res.on("finish", () => requests.push(`${res.statusCode} ${req.url}`));
  res.on("close", () => { if (!res.writableFinished) requests.push(`CLOSED ${req.url}`); });
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400).end(); return; }
  const fp = path.join(ROOT, urlPath === "/" ? "/index.html" : urlPath);
  if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
});
if (!URL_BASE) await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const udd = fs.mkdtempSync("/tmp/so-shot-chrome-");
// The audio rule (worker-instructions): --mute-audio AND PULSE_SINK=worker-null,
// because --mute-audio alone still opens a stream on David's audio device.
// The null sink is made if missing (best effort: no pactl, no sink to make).
try {
  const sinks = execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" });
  if (!/\bworker-null\b/.test(sinks)) execFileSync("pactl", ["load-module", "module-null-sink", "sink_name=worker-null"]);
} catch { /* no pulse here */ }
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--ignore-gpu-blocklist",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, "--window-size=800,450", "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, PULSE_SINK: "worker-null" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killChromeGroup(sig) { try { process.kill(-chrome.pid, sig); } catch { /* gone */ } }
let exiting = false;
const lines = [];
function shutdown(code) {
  if (exiting) return; exiting = true;
  if (opt("--console")) fs.writeFileSync(opt("--console"), lines.join("\n") + "\n");
  if (opt("--requests")) fs.writeFileSync(opt("--requests"), requests.join("\n") + "\n");
  try { server.close(); } catch { /* not listening */ }
  killChromeGroup("SIGTERM");
  setTimeout(() => { killChromeGroup("SIGKILL"); try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* scratch */ } process.exit(code); }, 800);
}
process.on("exit", () => { killChromeGroup("SIGKILL"); try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* scratch */ } });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => shutdown(130));
setTimeout(() => { console.log("TIMED-OUT after 120 s; console: " + JSON.stringify(lines.slice(0, 20))); shutdown(2); }, 120000).unref();

let pageWs = null;
for (let i = 0; i < 80 && !pageWs; i++) {
  try { const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); const p = ts.find((t) => t.type === "page"); if (p && p.webSocketDebuggerUrl) pageWs = p.webSocketDebuggerUrl; } catch { /* not up yet */ }
  await sleep(250);
}
if (!pageWs) { console.log("SETUP-FAILED: no chrome page target"); shutdown(2); await new Promise(() => {}); }
const ws = new WebSocket(pageWs);
let msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); return; }
  if (msg.method === "Runtime.consoleAPICalled") lines.push((msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  if (msg.method === "Runtime.exceptionThrown") lines.push("exception: " + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W * SCALE, height: H * SCALE, deviceScaleFactor: 1, mobile: false });

async function evalJS(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitLine(re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const l of lines) { const m = l.match(re); if (m) return m; }
    await sleep(50);
  }
  return null;
}

// Under heavy load (load 40-50 on this box, 2026-09-25) headless Chrome
// sometimes fails every fetch after the wasm with "Failed to fetch" and none
// of them reaches this server. That is the harness, not the game, and only
// in that exact case is the page reloaded, at most twice, each time said.
let ready = null;
for (let attempt = 0; attempt < 3 && !ready; attempt++) {
  lines.length = 0;
  const before = requests.length;
  await send("Page.navigate", { url: URL_BASE ? `${URL_BASE}?${QUERY}` : `http://127.0.0.1:${PORT}/index.html?${QUERY}` });
  ready = await waitLine(/signal-overdrive: ready/, 60000);
  const assetsServed = requests.slice(before).some((r) => r.includes("/assets/racer/"));
  if (!ready && !assetsServed && lines.some((l) => l.includes("Failed to fetch"))) {
    console.log(`retry: attempt ${attempt + 1}: every asset fetch failed before reaching the server`);
  } else break;
}
if (!ready) { console.log("SETUP-FAILED: no ready line in 60 s; console: " + JSON.stringify(lines.slice(0, 20))); shutdown(2); await new Promise(() => {}); }
if (opt("--eval")) console.log("eval: " + JSON.stringify(await evalJS(opt("--eval"))));
await sleep(parseInt(opt("--wait", "1500"), 10));
const data = await evalJS(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const c = document.getElementById("stage"); resolve([c.width, c.height, c.toDataURL("image/png")]);
})))`);
if (data[0] !== W * SCALE || data[1] !== H * SCALE) {
  console.log(`SETUP-FAILED: the canvas is ${data[0]}x${data[1]}, not ${W * SCALE}x${H * SCALE}`);
  shutdown(2); await new Promise(() => {});
}
fs.writeFileSync(OUT, Buffer.from(data[2].split(",")[1], "base64"));
const firstError = lines.findIndex((l) => /error|unbound|exception|trap|FATAL/i.test(l));
if (firstError >= 0) console.log("console error: " + lines.slice(Math.max(0, firstError - 2), firstError + 3).join(" | "));
console.log(`shot -> ${OUT} (${W * SCALE} x ${H * SCALE})`);
shutdown(firstError >= 0 ? 1 : 0);
