// flow-check.mjs - the whole game flow in one page, with no navigation.
//
//   PULSE_SINK=<a null sink> node scripts/flow-check.mjs BUILD [--port N] [--shots DIR] [--laps N] [--slow N]
//
// Serves BUILD (a web build) on 127.0.0.1 with scripts/serve.mjs and plays
// it in headless Chrome (1280 x 800, so the 16:9 view is letterboxed) with
// real key, mouse and touch events, reading the
// game's own probe line ("flow SCREEN ...") at each step:
//
//   1. the gate opened by a mouse click, the card played out, and the title
//      still waiting for its prompt (the click is spent); then Enter;
//   2. the mode menu: a mouse click on TIME TRIAL's row opens it, a click on
//      BACK returns, ArrowDown and Escape move and go back;
//   3. RUN, LEARNER, the Docklands cup; the pause menu by key and click; every delivery driven to its end by
//      the autopilot (laps=N, 1 by default, to keep it short), its results,
//      its standings, the next; then the uplink and the menus again;
//   4. TIME TRIAL on the first track to its results, and back to the menus;
//   5. the page's own URL is unchanged and NO navigation happened through
//      all of it (Page.frameNavigated, navigatedWithinDocument, and
//      performance navigation entries);
//   6. a reload (the one navigation, on purpose): the save came back. The
//      cup's place overall comes from the probe at its end; COURIER must be
//      open before and after the reload exactly when that place cleared the
//      cup, and COURIER's row must behave to match.
//
// Each page must print "signal-overdrive: ready" and be crossOriginIsolated
// or the run is SETUP-FAILED. Audio: --mute-audio, and PULSE_SINK at a null
// sink. --shots DIR saves a PNG of each screen.
//
// Exit 0 every check passed; 1 a check failed; 2 SETUP-FAILED; 3 timed out.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const build = args[0];
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const portArg = Number(opt("--port", 0));
const shots = opt("--shots", null);
const laps = Number(opt("--laps", 1));
// --slow N scales every wait and the overall limit, for a shared, loaded
// host where the page runs at a few frames a second (the checks are the same)
const slow = Math.max(1, Number(opt("--slow", 1)) || 1);
if (!build || !fs.existsSync(path.join(build, "index.html"))) { console.log("usage: node scripts/flow-check.mjs BUILD [--port N] [--shots DIR] [--laps N] [--slow N]"); process.exit(2); }
if (shots) fs.mkdirSync(shots, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const port = portArg || 20000 + Math.floor(Math.random() * 9000);
const base = `http://127.0.0.1:${port}/`;
const stampFile = path.join(build, "build.txt");
const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : null;
console.log(`build ${path.resolve(build)} stamp ${stamp ?? "-"} laps ${laps}`);
console.log(`PULSE_SINK ${process.env.PULSE_SINK || "(unset: set it to a null sink)"}`);

let server = null, chrome = null, finished = false;
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "flow-check-chrome-"));
const results = [];
function check(name, ok, detail) { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  (" + detail + ")" : ""}`); }
function done(code, why) {
  if (finished) return; finished = true;
  if (why) console.log(why);
  console.log(`EXIT ${code}`);
  try { if (chrome) process.kill(-chrome.pid, "SIGTERM"); } catch {}
  try { if (server) server.kill("SIGTERM"); } catch {}
  try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  process.exit(code);
}
process.on("uncaughtException", (e) => done(2, `SETUP-FAILED: ${e && e.stack || e}`));
process.on("unhandledRejection", (e) => done(2, `SETUP-FAILED: ${e && e.stack || e}`));
process.on("SIGINT", () => done(2, "SETUP-FAILED: interrupted"));
process.on("SIGTERM", () => done(2, "SETUP-FAILED: terminated"));
const LIMIT = (240 + 180 * laps) * 1000 * slow;
const timer = setTimeout(() => {
  console.log(`TIMED-OUT after ${LIMIT / 1000} s; checks so far:`);
  for (const [n, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"} ${n}`);
  console.log(`last lines: ${JSON.stringify(lines.slice(-12))}`);
  done(3);
}, LIMIT);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  "--remote-debugging-port=0", `--user-data-dir=${udd}`, "--window-size=1280,800", "about:blank",
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
let navigations = [];
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled") lines.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Page.frameNavigated" || d.method === "Page.navigatedWithinDocument")
    navigations.push(`${d.method} ${d.params.frame ? d.params.frame.url : d.params.url}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable");

const KEYS = { Enter: ["Enter", "Enter", 13], ArrowDown: ["ArrowDown", "ArrowDown", 40], Escape: ["Escape", "Escape", 27] };
async function press(k) {
  const [key, code, vk] = KEYS[k];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
  await wait(80);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  await wait(300);
}
// view pixel (vx, vy) of the 480 x 270 view to a page point, by the game's
// own fit: (substratic view fit)'s view-fit with integer-only #f, on the
// canvas's backing pixels. A whole-number scale k when k is at least
// SHARP-BELOW (0.8) of the limiting side's scale, else that scale; centred.
// (1280 x 661, a 1280 x 800 window's viewport, fits at 2, not 2.448.)
async function viewToPage(vx, vy) {
  const [l, t, cw, ch, bw, bh] = await evalJs(`(() => { const c = document.getElementById("stage"), r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, c.width || r.width, c.height || r.height]; })()`);
  const s = Math.min(bw / 480, bh / 270), k = Math.floor(s);
  const sc = k >= 1 && k / s >= 0.8 ? k : s;
  const fx = Math.floor((bw - Math.floor(sc * 480)) / 2), fy = Math.floor((bh - Math.floor(sc * 270)) / 2);
  return [l + ((fx + (vx + 0.5) * sc) * cw) / bw, t + ((fy + (vy + 0.5) * sc) * ch) / bh];
}
// a left click at view pixel (vx, vy)
async function click(vx, vy) {
  const [x, y] = await viewToPage(vx, vy);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await wait(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await wait(300);
}
// a one-finger touch at view pixel (vx, vy), mapped as click's
async function touch(vx, vy) {
  const [x, y] = await viewToPage(vx, vy);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await wait(60);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(300);
}
async function probe() {
  const n = lines.length;
  await evalJs(`globalThis.SigilWebApp && globalThis.SigilWebApp.dispatch("probe", "")`);
  for (let i = 0; i < 20; i++) {
    const l = lines.slice(n).find((s) => s.includes("signal-overdrive: probe "));
    if (l) return l;
    await wait(100);
  }
  return null;
}
const field = (l, k) => { const m = l && l.match(new RegExp(` ${k} (\\S+)`)); return m ? m[1] : null; };
async function screen() { return field(await probe(), "flow"); }
// wait for the flow to reach want (a screen name), up to ms
async function until(want, ms) {
  ms *= slow; const t0 = Date.now(); let s = null;
  while (Date.now() - t0 < ms) { s = await screen(); if (s === want) return true; await wait(400); }
  console.log(`  (waited ${ms} ms for ${want}, flow is ${s})`);
  return false;
}
let shotN = 0;
async function shot(name) {
  if (!shots) return;
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(shots, `${String(++shotN).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64"));
}

// --- the page ----------------------------------------------------------------------
const url = base + `?laps=${laps}`;
await send("Page.navigate", { url });
let ready = false;
for (let i = 0; i < 300 && !ready; i++) { ready = lines.some((l) => l.includes("signal-overdrive: ready")); if (!ready) await wait(200); }
if (!ready) done(2, `SETUP-FAILED: no "signal-overdrive: ready" in 60 s; last lines ${JSON.stringify(lines.slice(-5))}`);
const isolated = await evalJs("self.crossOriginIsolated");
if (isolated !== true) done(2, "SETUP-FAILED: not crossOriginIsolated");
// from here, nothing may navigate
navigations = [];
const navEntries0 = await evalJs("performance.getEntriesByType('navigation').length");

// 1. gate, card, prompt. The gate opens with a mouse click (as a player's
// would, and a phone's tap), and the card plays out: that click must not
// reach the title's menu after the card. 16:10, so the 16:9 view is
// letterboxed and the clicks below go through the fit.
await click(240, 135);
let introDone = false;
for (let i = 0; i < 60 * slow && !introDone; i++) { introDone = field(await probe(), "intro") === "done"; if (!introDone) await wait(250); }
check("the click opens the gate and the card plays out", introDone);
await wait(2000 * slow);
check("the title's prompt waits after the card, the gate's click spent", (await screen()) === "title", await screen());
await shot("title");
await press("Enter");
check("Enter on the prompt opens the mode menu", await until("mode", 4000));
await shot("mode");

// 2. clicks and keys on the menu
await click(240, 122 + 18 + 6);
check("a click on TIME TRIAL's row opens it", await until("trial", 3000));
await shot("trial");
await click(20, 255);
check("a click on BACK returns to the mode menu", await until("mode", 3000));
await press("ArrowDown");
// BACK from TIME TRIAL leaves it selected (1); ArrowDown wraps to RUN
check("ArrowDown moves the selection", field(await probe(), "sel") === "0");
await press("Escape");
check("Escape goes back to the prompt", await until("title", 3000));
await press("Enter");
await until("mode", 3000);
// the menu opens on the last mode chosen (TIME TRIAL, by the click)
check("the mode menu remembers TIME TRIAL", field(await probe(), "sel") === "1");
await press("ArrowDown");
check("the selection wraps to RUN", field(await probe(), "sel") === "0");

// 3. the cup
await press("Enter");
check("RUN opens the tier menu", await until("tier", 3000));
await shot("tier");
await press("Enter");
check("LEARNER opens the cup", await until("cup", 3000));
await shot("cup");
await press("Enter");
check("the cup launches", await until("racing", 8000));
// the pause menu: Escape opens it and the race holds; a click on RESUME,
// a click on the race's PAUSE button, Escape again
await wait(1500 * slow);
await press("Escape");
check("Escape pauses the race", await until("paused", 3000));
const held0 = field(await probe(), "race-tick");
await wait(1500 * slow);
await shot("paused");
const held1 = field(await probe(), "race-tick");
check("the race holds while paused", held0 !== null && held0 === held1, `tick ${held0} -> ${held1}`);
// QUIT CUP's row at the screen's edge, off the panel: a resting thumb does nothing
await click(30, 174 + 6);
await wait(400 * slow);
check("a click off the pause panel does nothing", (await screen()) === "paused", await screen());
await click(240, 138 + 6);
check("a click on RESUME goes back to the race", await until("racing", 3000));
// the control for the hold above: racing, the tick moves
const run0 = field(await probe(), "race-tick");
await wait(500 * slow);
const run1 = field(await probe(), "race-tick");
check("the race runs again after RESUME", run0 !== null && run1 !== null && Number(run1) > Number(run0), `tick ${run0} -> ${run1}`);
await click(20, 64);
check("a click on PAUSE pauses it", await until("paused", 3000));
await press("Escape");
check("Escape resumes it", await until("racing", 3000));
await evalJs(`globalThis.SigilWebApp.dispatch("param", "autopilot")`);
const RACE_MS = (60 + 45 * laps) * 1000;
const tracks = [];
// marked before the Enter that leaves the last standings: that Enter is the
// uplink, and the cup stores on it (a delivery's best times store earlier)
let beforeEnd = 0;
for (let k = 0; k < 3; k++) {
  // the race's own track (the flow names the next before the race is rebuilt)
  await wait(1500 * slow);
  const p = await probe();
  tracks.push(field(p, "race-track"));
  if (k === 0) await shot("countdown");
  check(`delivery ${k + 1} reaches its results`, await until("results", RACE_MS));
  // results drop a press for their first 150 ticks (RESULTS-DELAY)
  await wait(3500 * slow);
  await shot(`results-${k + 1}`);
  await press("Enter");
  check(`delivery ${k + 1}'s standings`, await until("standings", 3000));
  await shot(`standings-${k + 1}`);
  if (k === 2) beforeEnd = lines.length;
  await press("Enter");
  if (k < 2) check(`delivery ${k + 2} starts`, await until("racing", 5000));
}
check("the deliveries are the cup's three tracks in order", tracks.join(",") === "breakwater,quayside,basin", tracks.join(","));
check("the uplink: the cup's end", await until("cup-end", 3000));
await wait(4000 * slow);
await shot("cup-end");
// the cup's own store, not a best time's from a delivery
check("the cup's end saved progress", lines.slice(beforeEnd).some((l) => l.includes("progress saved")));
const cupPlace = field(await probe(), "cup-place");
const cupCleared = cupPlace !== null && cupPlace !== "-" && Number(cupPlace) <= 3;
console.log(`the cup ended ${cupPlace} overall: ${cupCleared ? "cleared" : "not cleared"}`);
check("the cup's end has a place", cupPlace !== null && cupPlace !== "-", cupPlace);
await press("Enter");
check("back to the menus after the cup", await until("mode", 4000));

// 4. TIME TRIAL
await press("ArrowDown");
await press("Enter");
check("TIME TRIAL's track menu", await until("trial", 3000));
await press("Enter");
check("TIME TRIAL launches", await until("racing", 8000));
const tp = await probe();
check("TIME TRIAL runs without rivals", field(tp, "rivals") === "0" && field(tp, "mode") === "trial", `rivals ${field(tp, "rivals")} mode ${field(tp, "mode")}`);
check("TIME TRIAL reaches its results", await until("trial-results", RACE_MS));
await wait(1500 * slow);
await shot("trial-results");
await press("ArrowDown"); await press("ArrowDown");
await press("Enter");
check("MENU returns to the mode menu", await until("mode", 4000));
// touch: a finger on TIME TRIAL's row, then on BACK
await touch(240, 122 + 18 + 6);
check("a touch on TIME TRIAL's row opens it", await until("trial", 3000));
await touch(20, 255);
check("a touch on BACK returns to the mode menu", await until("mode", 3000));

// 5. no navigation through all of it
const href = await evalJs("location.href");
const navEntries1 = await evalJs("performance.getEntriesByType('navigation').length");
check("the URL never changed", href === url, href);
check("no navigation happened", navigations.length === 0 && navEntries1 === navEntries0, JSON.stringify(navigations));

// 6. a reload: the save came back
const openBefore = field(await probe(), "open");
navigations = [];
lines.length = 0;
await send("Page.reload", {});
ready = false;
for (let i = 0; i < 300 && !ready; i++) { ready = lines.some((l) => l.includes("signal-overdrive: ready")); if (!ready) await wait(200); }
if (!ready) done(2, "SETUP-FAILED: no ready line after the reload");
await press("Enter"); await wait(800 * slow);
await press("Enter"); await wait(1500 * slow);
await until("title", 8000);
const openAfter = field(await probe(), "open");
const wantOpen = cupCleared ? "learner,courier" : "learner";
check("before the reload, the cup's result opened the tiers it should", openBefore === wantOpen, `${openBefore}, want ${wantOpen}`);
check("after a reload, the save opens the same tiers", openAfter !== null && openAfter === openBefore, `${openBefore} -> ${openAfter}`);
await press("Enter"); await until("mode", 3000);
await press("Enter"); await until("tier", 3000);
await press("ArrowDown");
await press("Enter");
const after = await screen();
const courierOpen = (openAfter || "").split(",").includes("courier");
console.log(`after the reload, open tiers ${openAfter}; COURIER's row leads to: ${after}`);
check("COURIER's row opens the cup exactly when the save opens it", after === (courierOpen ? "cup" : "tier"), `flow ${after}`);
await shot("after-reload");
const st = await evalJs(`Object.keys(localStorage).filter(k => k.includes("progress")).map(k => k + "=" + localStorage.getItem(k).slice(0, 160))`);
console.log(`localStorage: ${JSON.stringify(st)}`);
check("the save is in localStorage, with the cup's result", Array.isArray(st) && st.length === 1 && st[0].includes("docklands"), JSON.stringify(st));

clearTimeout(timer);
const ok = results.every((r) => r[1]);
console.log(ok ? "VERDICT GREEN" : "VERDICT RED");
done(ok ? 0 : 1);
