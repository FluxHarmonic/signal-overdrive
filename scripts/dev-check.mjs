// dev-check.mjs - the development tools stay behind ?dev in the web build.
//
//   PULSE_SINK=<a null sink> node scripts/dev-check.mjs BUILD [--port N]
//
// Serves BUILD (a web build, e.g. build/web) on 127.0.0.1 with
// scripts/serve.mjs, opens it in headless Chrome twice and checks:
//
//   ?fps          a player's page: the readout comes on ("fps readout on"),
//                 there is no EFFECTS button, no panel and no
//                 window.SignalOverdriveFx, and F3, F4, F6, F8, Tab and E
//                 do nothing (no "fps readout off", "hitch log", "fx solo",
//                 "fx fire", "overlay on", no panel).
//   ?dev&fps      "dev keys on", each of those keys answers, and E opens
//                 the panel.
//
// Keys reaching the game is proved on EACH page, not only on ?dev: Enter
// (the start gate's gesture, then a start) must move the game's probe line
// off "phase title" before the keys are pressed. Without that, silence on
// ?fps could be a page that never took a key.
//
// The game's console lines are the evidence (src/signal/shell/core.sgl), so
// this checks that each gated key's line is absent, not every side effect.
// F2, F5, F7, F9 and F10 are not pressed: F5 reloads a browser page, and F7
// prints nothing; they sit behind the same dev-keys? test as F6 and F8.
//
// Each page must print "signal-overdrive: ready" and be crossOriginIsolated,
// and the server must answer with BUILD's own build.txt, or the run is
// SETUP-FAILED. Audio: Chrome runs with --mute-audio and inherits
// PULSE_SINK, so point PULSE_SINK at a null sink.
//
// Exit 0 every check passed; 1 a check failed; 2 SETUP-FAILED; 3 timed out.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const build = args[0];
const portArg = args.indexOf("--port") >= 0 ? Number(args[args.indexOf("--port") + 1]) : 0;
if (!build || !fs.existsSync(path.join(build, "index.html"))) { console.log("usage: node scripts/dev-check.mjs BUILD [--port N]  (BUILD/index.html must exist)"); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname);
const port = portArg || 20000 + Math.floor(Math.random() * 9000);
const base = `http://127.0.0.1:${port}/`;
const stampFile = path.join(build, "build.txt");
const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : null;
console.log(`build ${path.resolve(build)} stamp ${stamp ?? "-"}`);
console.log(`PULSE_SINK ${process.env.PULSE_SINK || "(unset: set it to a null sink)"}`);

let server = null, chrome = null, finished = false;
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "dev-check-chrome-"));
// Every exit goes through here: the server and Chrome's whole group are
// stopped and the profile removed, whatever happened.
function done(code, why) {
  if (finished) return; finished = true;
  if (why) console.log(why);
  try { if (chrome) process.kill(-chrome.pid, "SIGTERM"); } catch {}
  try { if (server) server.kill("SIGTERM"); } catch {}
  console.log(`EXIT ${code}`);
  try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  process.exit(code);
}
process.on("uncaughtException", (e) => done(2, `SETUP-FAILED: ${e && e.stack || e}`));
process.on("unhandledRejection", (e) => done(2, `SETUP-FAILED: ${e && e.stack || e}`));
process.on("SIGINT", () => done(2, "SETUP-FAILED: interrupted"));
process.on("SIGTERM", () => done(2, "SETUP-FAILED: terminated"));
const timer = setTimeout(() => done(3, "TIMED-OUT after 180 s"), 180000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the server: ours, answering, and serving BUILD
server = spawn(process.execPath, [path.join(here, "serve.mjs"), build, String(port), "--loopback"], { stdio: ["ignore", "pipe", "pipe"] });
server.on("error", (e) => done(2, `SETUP-FAILED: serve.mjs did not start (${e.message})`));
let serverOut = "";
server.stdout.on("data", (d) => { serverOut += d; });
server.stderr.on("data", (d) => { serverOut += d; });
server.on("exit", (c) => { if (!finished) done(2, `SETUP-FAILED: serve.mjs exited (${c}): ${serverOut.trim().slice(-300)}`); });
let served = null;
for (let i = 0; i < 50 && served === null; i++) {
  try { const r = await fetch(base + "build.txt"); if (r.ok) served = (await r.text()).trim(); } catch {}
  if (served === null) await wait(200);
}
if (served === null) done(2, "SETUP-FAILED: the server never answered");
if (stamp !== null && served !== stamp) done(2, `SETUP-FAILED: the server serves ${served}, not BUILD's ${stamp}`);
console.log(`served stamp ${served}`);

// Chrome: its own DevTools port (0 = any free one, read back from the profile)
chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--remote-debugging-port=0", `--user-data-dir=${udd}`, "--window-size=1280,720", "about:blank",
], { stdio: "ignore", detached: true });
chrome.on("error", (e) => done(2, `SETUP-FAILED: google-chrome did not start (${e.message})`));
let cdp = null;
for (let i = 0; i < 100 && !cdp; i++) {
  try { cdp = Number(fs.readFileSync(path.join(udd, "DevToolsActivePort"), "utf8").split("\n")[0]) || null; } catch {}
  if (!cdp) await wait(100);
}
if (!cdp) done(2, "SETUP-FAILED: Chrome wrote no DevToolsActivePort");
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { const t = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find((x) => x.type === "page"); if (t) wsUrl = t.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await wait(200);
}
if (!wsUrl) done(2, "SETUP-FAILED: no Chrome page target");
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", () => j(new Error("DevTools socket error")), { once: true }); });
let id = 0; const pending = new Map(); const lines = [];
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled") lines.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable");

const KEYS = { Enter: ["Enter", "Enter", 13], F3: ["F3", "F3", 114], F4: ["F4", "F4", 115], F6: ["F6", "F6", 117], F8: ["F8", "F8", 119], Tab: ["Tab", "Tab", 9], e: ["e", "KeyE", 69] };
async function press(k) {
  const [key, code, vk] = KEYS[k];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(key.length === 1 ? { text: key } : {}) });
  await wait(80);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  await wait(250);
}
// the game's phase, from its own probe line
async function phase() {
  const n = lines.length;
  await evalJs(`globalThis.SigilWebApp && globalThis.SigilWebApp.dispatch("probe", "")`);
  for (let i = 0; i < 20; i++) {
    const l = lines.slice(n).find((s) => s.includes("signal-overdrive: probe "));
    if (l) { const m = l.match(/ phase (\S+)/); return m ? m[1] : "?"; }
    await wait(100);
  }
  return null;
}
const PAGE = `(() => { const b = document.getElementById("fx-open"), p = document.getElementById("fx-panel");
  return { button: !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0, panel: !!p,
           open: !!p && p.classList.contains("open"), api: typeof window.SignalOverdriveFx, isolated: self.crossOriginIsolated, url: location.href }; })()`;

async function visit(query) {
  const url = base + query;
  lines.length = 0;
  await send("Page.navigate", { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) { ready = lines.some((l) => l.includes("signal-overdrive: ready")); if (!ready) await wait(200); }
  if (!ready) done(2, `SETUP-FAILED: ${query}: no "signal-overdrive: ready" in 60 s; last lines ${JSON.stringify(lines.slice(-5))}`);
  const before = await evalJs(PAGE);
  if (!before || before.url !== url) done(2, `SETUP-FAILED: ${query}: the page is ${before && before.url}`);
  if (before.isolated !== true) done(2, `SETUP-FAILED: ${query}: not crossOriginIsolated`);
  // the same-page proof that keys reach the game: Enter moves it off the title
  const p0 = await phase();
  let p1 = p0;
  for (let i = 0; i < 3 && p1 === p0; i++) { await press("Enter"); await wait(1200); p1 = await phase(); }
  console.log(`${query}: phase ${p0} -> ${p1} after Enter`);
  const mark = lines.length;     // only lines after this count as the keys' answers
  for (const k of ["F3", "F4", "F6", "F8", "Tab"]) await press(k);
  await wait(500);
  const keyLines = lines.slice(mark);
  await press("e");
  await wait(400);
  const after = await evalJs(PAGE);
  const all = lines.slice();     // this page's lines; the next visit clears `lines`
  const has = (s, from = all) => from.some((l) => l.includes(s));
  return { before, after, has, keyLines, all, keysReach: p0 !== null && p1 !== null && p0 !== p1 };
}

const pl = await visit("?fps");
const dv = await visit("?dev&fps");
clearTimeout(timer);
const k = (v, s) => v.has(s, v.keyLines);
const checks = [
  ["?fps: keys reach the game (Enter left the title)", pl.keysReach],
  ["?fps: the readout comes on without ?dev", pl.has("fps readout on")],
  ["?fps: no dev keys", !pl.has("dev keys on")],
  ["?fps: no EFFECTS button", !pl.before.button],
  ["?fps: no panel, no SignalOverdriveFx", !pl.before.panel && pl.before.api === "undefined"],
  ["?fps: F3 leaves the readout alone", !k(pl, "fps readout")],
  ["?fps: F4 prints no hitch log", !k(pl, "hitch log")],
  ["?fps: F6 solos nothing", !k(pl, "fx solo")],
  ["?fps: F8 fires nothing", !k(pl, "fx fire")],
  ["?fps: Tab opens no overlay", !k(pl, "overlay on")],
  ["?fps: E opens no panel", !pl.after.panel && !pl.after.open],
  ["?dev: keys reach the game (Enter left the title)", dv.keysReach],
  ["?dev: dev keys on", dv.has("dev keys on")],
  ["?dev: the readout comes on", dv.has("fps readout on")],
  ["?dev: EFFECTS button visible", dv.before.button && dv.before.api === "object"],
  ["?dev: F3 toggles the readout off", k(dv, "fps readout off")],
  ["?dev: F4 prints the hitch log", k(dv, "hitch log")],
  ["?dev: F6 solos an effect", k(dv, "fx solo 1")],
  ["?dev: F8 fires a wall hit", k(dv, "fx fire wall")],
  ["?dev: Tab opens the overlay", k(dv, "overlay on")],
  ["?dev: E opens the panel", dv.after.open],
];
for (const [n, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${n}`);
const ok = checks.every((c) => c[1]);
if (!ok) {
  console.log(`?fps key lines: ${JSON.stringify(pl.keyLines.filter((l) => !/^signal-overdrive:\s{3}/.test(l)))}`);
  console.log(`?dev key lines: ${JSON.stringify(dv.keyLines.filter((l) => !/^signal-overdrive:\s{3}/.test(l)))}`);
}
console.log(ok ? "VERDICT GREEN" : "VERDICT RED");
done(ok ? 0 : 1);
