// touch-check.mjs - the touch schemes, driven in a headless phone viewport
// and judged by what the GAME did, not by what the page sent.
//
//   node scripts/touch-check.mjs [BUILD] [--scheme zones|drag|stick]
//                                [--sabotage swap] [--viewport 844x390]
//
// Serves BUILD (default build/web) on loopback, opens it in headless Chrome
// as a phone (mobile metrics, device scale 3, touch emulation with five
// points), starts a race (?start&boost-lap=1&rivals=0&trace-touch), and per
// scheme dispatches real touch events (CDP Input.dispatchTouchEvent) at the
// canvas. Each gesture is judged on the player's machine, read back from the
// game with a ("probe", "") dispatch: its heading must turn the right way,
// its speed must drop for a brake, its boost must start for a boost.
//
// Before each scheme it checks the machine holds its heading with no touch
// for the same time (the positive control: a turn has to come from the
// gesture). --sabotage swap rewrites the page as it is served so the zones
// scheme's left and right are exchanged; the check must then go RED. The
// plant is verified present in the served bytes (SETUP-FAILED otherwise).
//
// Prints one line per assertion, then GREEN, RED or SETUP-FAILED; exit 0,
// 1 or 2.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VALUED = ["--scheme", "--sabotage", "--viewport", "--port", "--cdp"];
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1])));
const ROOT = path.resolve(positional[0] || "build/web");
const SCHEMES = opt("--scheme") ? [opt("--scheme")] : ["zones", "drag", "stick"];
const SABOTAGE = opt("--sabotage");
const [VW, VH] = opt("--viewport", "844x390").split("x").map(Number);
const PORT = parseInt(opt("--port", "8493"), 10), CDP = parseInt(opt("--cdp", "9493"), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(ROOT, "index.html"))) { console.log(`SETUP-FAILED: ${ROOT}/index.html missing`); process.exit(2); }

// the sabotage: the zones scheme's steer signs exchanged, as served
const PLANT_FROM = "if (l && !r) steer = -1; else if (r && !l) steer = 1;";
const PLANT_TO = "if (l && !r) steer = 1; else if (r && !l) steer = -1;";
let planted = 0;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent((req.url || "/").split("?")[0]); } catch { res.writeHead(400).end(); return; }
  const fp = path.join(ROOT, p === "/" ? "/index.html" : p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end(); return; }
    if (SABOTAGE === "swap" && fp.endsWith("index.html")) {
      const s = buf.toString("utf8");
      if (s.includes(PLANT_FROM)) { buf = Buffer.from(s.replace(PLANT_FROM, PLANT_TO)); planted++; }
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

try {
  const sinks = execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" });
  if (!/\bworker-null\b/.test(sinks)) execFileSync("pactl", ["load-module", "module-null-sink", "sink_name=worker-null"]);
} catch { /* no pulse */ }
const udd = fs.mkdtempSync("/tmp/so-touch-chrome-");
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, "--window-size=900,500", "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, PULSE_SINK: "worker-null" } });
let verdictCode = 2;
function done(code) {
  try { server.close(); } catch { /* */ }
  try { process.kill(-chrome.pid, "SIGKILL"); } catch { /* gone */ }
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* */ }
  process.exit(code);
}
setTimeout(() => { console.log("TIMED-OUT after 240 s (checks after this point did not run)"); done(2); }, 240000).unref();

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
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const evalJS = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const waitLine = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { for (const l of lines) { const m = l.match(re); if (m) return m; } await sleep(50); } return null; };

// the player, from the game: "probe heading H speed V boost B integrity I"
async function probe() {
  const n = lines.length;
  await evalJS(`SigilWebApp.dispatch("probe", "")`);
  for (let i = 0; i < 40; i++) {
    for (const l of lines.slice(n)) {
      const m = l.match(/probe heading (\S+) speed (\S+) boost (\S+) integrity (\S+)/);
      if (m) return { heading: +m[1], speed: +m[2], boost: +m[3], integrity: +m[4] };
    }
    await sleep(25);
  }
  throw new Error("no probe answer");
}
const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y, k]) => ({ x, y, id: k, radiusX: 8, radiusY: 8, force: 1 })) });
const results = [];
function check(name, ok, detail) { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}  (${detail})`); }

async function newRace(scheme) {
  lines.length = 0;
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?touch=${scheme}&start&boost-lap=1&rivals=0&trace-touch&mute` });
  if (!(await waitLine(/signal-overdrive: ready/, 60000))) throw new Error("SETUP: no ready line");
  if (!(await waitLine(/signal-overdrive: phase race/, 15000))) throw new Error("SETUP: the race never started");
  const s = await evalJS(`window.SignalOverdriveTouch && SignalOverdriveTouch.scheme()`);
  if (s !== scheme) throw new Error(`SETUP: the page's scheme is ${s}, not ${scheme}`);
  await sleep(400);
}

// A boost needs lap 1 (boost-lap=1): a fresh grid, the machine driven
// straight on touch alone for 1.8 s, over the line. Zones: a 20 ms tap
// (fingers up keeps accelerating); drag and stick: one finger held still.
// Returns with that finger still down for drag and stick (id 1).
async function overTheLine(scheme, at) {
  await newRace(scheme);
  if (scheme === "zones") { await touch("touchStart", [[at[0], at[1], 9]]); await sleep(20); await touch("touchEnd", []); }
  else await touch("touchStart", [[at[0], at[1], 1]]);
  await sleep(1800);
}

const W = VW, H = VH, L = [W * 0.2, H * 0.7], Rt = [W * 0.8, H * 0.7], C = [W * 0.5, H * 0.6];
const turned = (a, b) => b.heading - a.heading;

try {
  for (const scheme of SCHEMES) {
    console.log(`-- ${scheme}${SABOTAGE ? " (sabotage " + SABOTAGE + ")" : ""}`);
    await newRace(scheme);
    // positive control: no touch, the machine holds its line
    { const a = await probe(); await sleep(700); const b = await probe();
      check(`${scheme}: no touch holds the heading`, Math.abs(turned(a, b)) < 0.05, `turned ${turned(a, b).toFixed(3)} rad`); }
    if (scheme === "zones") {
      let a = await probe(); await touch("touchStart", [[...L, 1]]); await sleep(700); let b = await probe(); await touch("touchEnd", []);
      check("zones: the left thumb turns left", turned(a, b) < -0.15, `turned ${turned(a, b).toFixed(3)}`);
      await sleep(300);
      a = await probe(); await touch("touchStart", [[...Rt, 2]]); await sleep(700); b = await probe(); await touch("touchEnd", []);
      check("zones: the right thumb turns right", turned(a, b) > 0.15, `turned ${turned(a, b).toFixed(3)}`);
      await sleep(300);
      a = await probe(); await touch("touchStart", [[...L, 3], [...Rt, 4]]); await sleep(700); b = await probe(); await touch("touchEnd", []);
      check("zones: both thumbs brake", b.speed < a.speed - 40, `speed ${a.speed} -> ${b.speed}`);
      await overTheLine(scheme, C);
      // the BOOST button (a DOM button: a pointer press at its centre)
      a = await probe();
      const r = await evalJS(`(() => { const b = document.getElementById("so-boost").getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      await touch("touchStart", [[r[0], r[1], 5]]); await sleep(120); await touch("touchEnd", []);
      await sleep(150); b = await probe();
      check("zones: BOOST boosts", b.boost > 0 && b.integrity < a.integrity, `boost ${b.boost} integrity ${a.integrity} -> ${b.integrity}`);
    } else if (scheme === "drag") {
      let a = await probe(); await touch("touchStart", [[...C, 1]]); await touch("touchMove", [[C[0] + 70, C[1], 1]]); await sleep(700); let b = await probe();
      check("drag: sliding right turns right", turned(a, b) > 0.15, `turned ${turned(a, b).toFixed(3)}`);
      await touch("touchMove", [[C[0] - 70, C[1], 1]]); a = await probe(); await sleep(700); b = await probe();
      check("drag: sliding left turns left", turned(a, b) < -0.15, `turned ${turned(a, b).toFixed(3)}`);
      await touch("touchEnd", []);
      await overTheLine(scheme, C);
      a = await probe(); await touch("touchStart", [[C[0], C[1], 1], [W * 0.85, H * 0.3, 2]]); await sleep(150); b = await probe();
      await touch("touchEnd", [[C[0], C[1], 1]]); await touch("touchEnd", []);
      check("drag: a second finger boosts", b.boost > 0 && b.integrity < a.integrity, `boost ${b.boost} integrity ${a.integrity} -> ${b.integrity}`);
    } else {
      let a = await probe(); await touch("touchStart", [[...L, 1]]); await touch("touchMove", [[L[0] - 60, L[1], 1]]); await sleep(700); let b = await probe();
      check("stick: left turns left", turned(a, b) < -0.15, `turned ${turned(a, b).toFixed(3)}`);
      await touch("touchMove", [[L[0] + 60, L[1], 1]]); a = await probe(); await sleep(700); b = await probe();
      check("stick: right turns right", turned(a, b) > 0.15, `turned ${turned(a, b).toFixed(3)}`);
      await touch("touchEnd", []);
      // the brake needs speed: a fresh grid, the stick held centred for 1.5 s, then pulled down
      await newRace(scheme);
      await touch("touchStart", [[...L, 1]]); await sleep(1500);
      a = await probe(); await touch("touchMove", [[L[0], L[1] + 60, 1]]); await sleep(700); b = await probe();
      check("stick: pulling down brakes", a.speed > 100 && b.speed < a.speed - 40, `speed ${a.speed} -> ${b.speed}`);
      await touch("touchEnd", []);
      await overTheLine(scheme, L);
      a = await probe(); await touch("touchStart", [[...L, 1], [...Rt, 2]]); await sleep(150); b = await probe(); await touch("touchEnd", []);
      check("stick: the right thumb boosts", b.boost > 0 && b.integrity < a.integrity, `boost ${b.boost} integrity ${a.integrity} -> ${b.integrity}`);
    }
  }
  if (SABOTAGE === "swap" && planted === 0) { console.log("SETUP-FAILED: the sabotage plant never landed in a served page"); done(2); }
  const red = results.some((r) => !r);
  console.log(red ? "RED" : "GREEN", `${results.filter((r) => r).length}/${results.length} assertions${SABOTAGE ? `, sabotage planted in ${planted} page loads` : ""}`);
  done(red ? 1 : 0);
} catch (e) {
  console.log("SETUP-FAILED: " + e.message + "; console: " + JSON.stringify(lines.slice(-12)));
  done(2);
}
