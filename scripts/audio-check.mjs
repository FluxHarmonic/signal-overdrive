// audio-check.mjs - the sound's hitching, reproduced headless: underruns
// and the frame-time distribution under a throttled CPU, with the old and
// the new audio set-up, from one build.
//
//   node scripts/audio-check.mjs [BUILD] [--throttle 4] [--seconds 20]
//                                [--only before|after|after-no-coi]
//
// Configurations (all with sound ON, into Chrome with --mute-audio and
// PULSE_SINK=worker-null, so nothing reaches a speaker):
//   before        pass 3 as shipped: a 60 ms engine queue, the one-shots in
//                 the stream (?cues=0), no cross-origin isolation
//   after-no-coi  the 250 ms queue and the cues, not isolated
//   after         the 250 ms queue, the cues, and COOP/COEP (isolated: the
//                 audio bridge can run its stream as worklet-sab)
// Each loads the page with the race on the autopilot (five rivals, so
// pads and walls fire cues), starts the sound with a pointer gesture,
// throttles the CPU (CDP Emulation.setCPUThrottlingRate), and for SECONDS
// records every requestAnimationFrame interval in the page. Then it asks
// the game (the "probe" dispatch) for its underrun counts, hitch count
// (frames over 33 ms), audio mode, cue mode and plays.
//
// Prints one line per configuration and exits 0; SETUP-FAILED and 2 when
// the sound never started (the comparison would be over silence).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VALUED = ["--throttle", "--seconds", "--only", "--port", "--cdp"];
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1])));
const ROOT = path.resolve(positional[0] || "build/web");
const THROTTLE = parseFloat(opt("--throttle", "4"));
const SECONDS = parseFloat(opt("--seconds", "20"));
const PORT = parseInt(opt("--port", "8494"), 10), CDP = parseInt(opt("--cdp", "9494"), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIGS = [
  { name: "before", coi: false, query: "audiodepth=60&cues=0" },
  { name: "after-no-coi", coi: false, query: "audiodepth=250" },
  { name: "after", coi: true, query: "audiodepth=250" },
].filter((c) => !opt("--only") || c.name === opt("--only"));

let coi = false;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400).end(); return; }
  const fp = path.join(ROOT, p === "/" ? "/index.html" : p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end(); return; }
    const h = { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (coi) Object.assign(h, { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" });
    res.writeHead(200, h); res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
try {
  const sinks = execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" });
  if (!/\bworker-null\b/.test(sinks)) execFileSync("pactl", ["load-module", "module-null-sink", "sink_name=worker-null"]);
} catch { /* no pulse */ }
const udd = fs.mkdtempSync("/tmp/so-audio-chrome-");
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, "--window-size=960,540", "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, PULSE_SINK: "worker-null" } });
function done(code) {
  try { server.close(); } catch { /* */ }
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* */ }
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* */ }
  process.exit(code);
}
setTimeout(() => { console.log("TIMED-OUT (configurations after this point did not run)"); done(2); }, (SECONDS + 60) * 1000 * CONFIGS.length + 30000).unref();

let pageWs = null;
for (let i = 0; i < 80 && !pageWs; i++) {
  try { const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); const p = ts.find((t) => t.type === "page"); if (p) pageWs = p.webSocketDebuggerUrl; } catch { /* */ }
  await sleep(250);
}
if (!pageWs) { console.log("SETUP-FAILED: no chrome page"); done(2); }
const ws = new WebSocket(pageWs);
let id = 0; const pend = new Map(); const lines = [];
const send = (method, params = {}) => new Promise((res, rej) => { const k = ++id; pend.set(k, { res, rej }); ws.send(JSON.stringify({ id: k, method, params })); });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === "Runtime.consoleAPICalled") lines.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
});
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const evalJS = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const waitLine = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { for (const l of lines) { const m = l.match(re); if (m) return m; } await sleep(50); } return null; };
async function probe() {
  const n = lines.length;
  await evalJS(`SigilWebApp.dispatch("probe", "")`);
  for (let i = 0; i < 80; i++) { for (const l of lines.slice(n)) if (/probe heading/.test(l)) return l; await sleep(25); }
  throw new Error("no probe answer");
}
const field = (l, k) => { const m = l.match(new RegExp(` ${k} (\\S+)`)); return m ? m[1] : "?"; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

let bad = false;
for (const c of CONFIGS) {
  coi = c.coi;
  lines.length = 0;
  await send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?start&autopilot&${c.query}` });
  if (!(await waitLine(/signal-overdrive: ready/, 90000))) { console.log(`${c.name}: SETUP-FAILED (no ready line)`); bad = true; continue; }
  // the sound starts on a gesture
  await evalJS(`SigilWebApp.dispatch("pointerdown", "0,0,0")`);
  await sleep(1500);
  const isolated = await evalJS(`self.crossOriginIsolated === true`);
  await send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const before = await probe();
  const frames = await evalJS(`new Promise((r) => { const out = []; let last = performance.now(); const t0 = last;
    function f(t) { out.push(t - last); last = t; if (t - t0 < ${SECONDS * 1000}) requestAnimationFrame(f); else r(out); }
    requestAnimationFrame(f); })`);
  const after = await probe();
  await send("Emulation.setCPUThrottlingRate", { rate: 1 });
  if (field(after, "audio") !== "on") { console.log(`${c.name}: SETUP-FAILED (the sound never started: ${after})`); bad = true; continue; }
  const u0 = +field(before, "underruns"), u1 = +field(after, "underruns");
  const ua0 = +field(before, "underruns-all"), ua1 = +field(after, "underruns-all");
  console.log(`${c.name.padEnd(13)} isolated ${isolated} mode ${field(after, "mode")} depth ${field(after, "depth")}ms cues ${field(after, "cues")} ` +
    `| ${SECONDS}s at ${THROTTLE}x: frames ${frames.length} p50 ${pct(frames, 0.5).toFixed(1)} p95 ${pct(frames, 0.95).toFixed(1)} max ${Math.max(...frames).toFixed(1)} ms, ` +
    `over 33 ms ${frames.filter((x) => x > 33).length} | underruns sounding +${u1 - u0} all +${ua1 - ua0} | audio-ms ${field(after, "audio-ms")} cue-plays ${field(after, "cue-plays")} cue-lag ${field(after, "cue-lag")}`);
}
done(bad ? 2 : 0);
