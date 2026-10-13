// fx-check.mjs - drive the web build in headless Chrome through a list of
// steps (dispatch a param or a fire, wait, take a shot, measure frames),
// for the effects' screenshots, their per-frame costs and the 60 fps check.
//
//   node scripts/fx-check.mjs BUILD STEPS.json [--query Q] [--gpu] [--out DIR]
//                             [--port N] [--cdp N] [--scale N]
//
// --gpu renders on the machine's GPU through ANGLE over Vulkan (on this
// laptop an AMD Radeon 780M, RADV); without it, SwiftShader (the CPU).
// The renderer string is printed first, read from the page's own WebGL2
// context, so a run on the wrong renderer cannot pass for the other.
//
// Steps, in order; each prints one line:
//   {"param": "fx-fire=ice"}             ("param", ...) to the game
//   {"wait": 1500}                       ms
//   {"waitLine": "phase race", "ms": 30000}   a console line from the game
//   {"shot": "warp.png"}                 the canvas, into --out
//   {"measure": 10, "label": "all on"}   rAF intervals for N seconds:
//       frames, fps, mean, p50, p99, max ms, and how many intervals were
//       over 20 ms (a missed refresh at 60 Hz) and over 33 ms (a hitch)
//   {"eval": "js expression"}            printed
//   {"describe": true}                   the game's probe line
//   {"lines": "regex", "last": 3}        the last console lines matching
//
// Exit 0 when every step ran and the console showed no error; 1 on a
// console error; 2 (SETUP-FAILED) when the page never said ready.
// Audio: --mute-audio and PULSE_SINK=worker-null (worker-instructions).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const VALUED = ["--query", "--out", "--port", "--cdp", "--scale"];
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1])));
const ROOT = path.resolve(positional[0] || "build/web");
const STEPS = JSON.parse(fs.readFileSync(positional[1], "utf8"));
const QUERY = opt("--query", "");
const OUT = path.resolve(opt("--out", "/tmp"));
const PORT = parseInt(opt("--port", "8493"), 10);
const CDP = parseInt(opt("--cdp", "9493"), 10);
const SCALE = parseInt(opt("--scale", "2"), 10);
const GPU = args.includes("--gpu");
const W = 480, H = 270;
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(ROOT, "index.html"))) { console.log(`SETUP-FAILED: ${ROOT}/index.html missing`); process.exit(2); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm",
  ".json": "application/json", ".png": "image/png", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400).end(); return; }
  const fp = path.join(ROOT, p === "/" ? "/index.html" : p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end(); return; }
    // cross-origin isolated, as the hosted page is
    res.writeHead(200, { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

try {
  const sinks = execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" });
  if (!/\bworker-null\b/.test(sinks)) execFileSync("pactl", ["load-module", "module-null-sink", "sink_name=worker-null"]);
} catch { /* no pulse */ }
const udd = fs.mkdtempSync("/tmp/so-fx-chrome-");
const gl = GPU
  ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", ...gl,
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, "--window-size=1000,600", "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, PULSE_SINK: "worker-null" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
let done = false;
function shutdown(code) {
  if (done) return; done = true;
  try { server.close(); } catch { /* */ }
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* */ }
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* */ }
  process.exit(code);
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => shutdown(130));
const budget = 60000 + STEPS.reduce((a, s) => a + (s.wait || 0) + (s.ms || 0) + 1000 * (s.measure || 0) + 3000, 0);
setTimeout(() => { console.log(`TIMED-OUT after ${budget} ms; last console: ${JSON.stringify(lines.slice(-10))}`); shutdown(2); }, budget).unref();

let pageWs = null;
for (let i = 0; i < 80 && !pageWs; i++) {
  try { const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); const p = ts.find((t) => t.type === "page"); if (p) pageWs = p.webSocketDebuggerUrl; } catch { /* */ }
  await sleep(250);
}
if (!pageWs) { console.log("SETUP-FAILED: no chrome page"); shutdown(2); }
const ws = new WebSocket(pageWs);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const k = ++id; pending.set(k, { res, rej }); ws.send(JSON.stringify({ id: k, method, params })); });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === "Runtime.consoleAPICalled") lines.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Runtime.exceptionThrown") lines.push("exception: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W * SCALE, height: H * SCALE, deviceScaleFactor: 1, mobile: false });
const evalJS = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const waitLine = async (re, ms, from = 0) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return lines[i]; await sleep(50); }
  return null;
};

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?${QUERY}` });
if (!(await waitLine(/signal-overdrive: ready/, 60000))) { console.log("SETUP-FAILED: no ready line; console: " + JSON.stringify(lines.slice(0, 20))); shutdown(2); }
const renderer = await evalJS(`(() => { const g = document.createElement("canvas").getContext("webgl2"); const e = g && g.getExtension("WEBGL_debug_renderer_info"); return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : "none"; })()`);
const ua = await evalJS("navigator.userAgent");
console.log(`renderer: ${renderer}`);
console.log(`browser: ${ua.match(/(HeadlessChrome|Chrome)\/[\d.]+/)?.[0] || ua}`);
console.log(`isolated: ${await evalJS("self.crossOriginIsolated")}`);

const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))];
for (const step of STEPS) {
  if (step.param) {
    await evalJS(`(globalThis.SigilWebApp).dispatch("param", ${JSON.stringify(step.param)})`);
    console.log(`param ${step.param}`);
  } else if (step.wait) {
    await sleep(step.wait);
  } else if (step.waitLine) {
    const from = lines.length;
    const l = await waitLine(new RegExp(step.waitLine), step.ms || 30000, from);
    console.log(l ? `line: ${l}` : `NO LINE /${step.waitLine}/ in ${step.ms || 30000} ms`);
  } else if (step.shot) {
    const d = await evalJS(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const c = document.getElementById("stage"); r([c.width, c.height, c.toDataURL("image/png")]); })))`);
    fs.writeFileSync(path.join(OUT, step.shot), Buffer.from(d[2].split(",")[1], "base64"));
    console.log(`shot ${step.shot} (${d[0]}x${d[1]})`);
  } else if (step.measure) {
    const iv = await evalJS(`new Promise((res) => { const iv = []; let last = null; const end = performance.now() + ${step.measure * 1000};
      function f(t) { if (last !== null) iv.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(iv); } requestAnimationFrame(f); })`);
    const s = [...iv].sort((a, b) => a - b);
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    const r = (v) => Math.round(v * 100) / 100;
    console.log(`measure ${step.label || ""}: frames ${iv.length} fps ${r(1000 / mean)} mean ${r(mean)} p50 ${r(pct(s, 0.5))} p99 ${r(pct(s, 0.99))} max ${r(s[s.length - 1])} over20 ${iv.filter((v) => v > 20).length} over33 ${iv.filter((v) => v > 33).length}`);
  } else if (step.eval) {
    console.log(`eval: ${JSON.stringify(await evalJS(step.eval))}`);
  } else if (step.lines) {
    const re = new RegExp(step.lines);
    lines.filter((l) => re.test(l)).slice(-(step.last || 3)).forEach((l) => console.log(`line: ${l}`));
  } else if (step.describe) {
    await evalJS(`(globalThis.SigilWebApp).dispatch("probe", "")`);
    await sleep(100);
    console.log(`describe: ${lines.filter((l) => /probe heading/.test(l)).slice(-1)[0] || "(none)"}`);
  }
}
const err = lines.find((l) => /error|unbound|exception|trap|FATAL/i.test(l));
if (err) console.log("console error: " + err);
shutdown(err ? 1 : 0);
