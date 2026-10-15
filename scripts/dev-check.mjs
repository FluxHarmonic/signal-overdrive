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
//   ?dev&fps      the positive control: "dev keys on", and each of those
//                 keys answers, and E opens the panel. It proves the keys
//                 reach the game, so their silence on ?fps means the gate,
//                 not a dead page.
//
// The game's console lines are the evidence (src/signal/shell/core.sgl).
// Each page must print "signal-overdrive: ready" (the game ran two frames)
// and be crossOriginIsolated, or the run is SETUP-FAILED. F5 is not pressed:
// in a browser it reloads the page.
//
// Audio: Chrome runs with --mute-audio and inherits PULSE_SINK, so point
// PULSE_SINK at a null sink to keep it off the speakers.
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
const cdp = 9400 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}/`;
console.log(`build ${path.resolve(build)} stamp ${fs.existsSync(path.join(build, "build.txt")) ? fs.readFileSync(path.join(build, "build.txt"), "utf8").trim() : "-"}`);
console.log(`PULSE_SINK ${process.env.PULSE_SINK || "(unset: set it to a null sink)"}`);

const server = spawn(process.execPath, [path.join(here, "serve.mjs"), build, String(port), "--loopback"], { stdio: ["ignore", "pipe", "pipe"] });
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "dev-check-chrome-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  `--remote-debugging-port=${cdp}`, `--user-data-dir=${udd}`, "--window-size=1280,720", "about:blank",
], { stdio: "ignore", detached: true });
function done(code) {
  try { process.kill(-chrome.pid, "SIGTERM"); } catch {}
  try { server.kill("SIGTERM"); } catch {}
  console.log(`EXIT ${code}`);
  try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  process.exit(code);
}
const timer = setTimeout(() => { console.log("TIMED-OUT after 180 s"); done(3); }, 180000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try { const t = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find((x) => x.type === "page"); if (t) return t.webSocketDebuggerUrl; } catch {}
    await wait(200);
  }
  return null;
}
const wsUrl = await pageTarget();
if (!wsUrl) { console.log("SETUP-FAILED: no Chrome page target"); done(2); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
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
const PAGE = `(() => { const b = document.getElementById("fx-open"), p = document.getElementById("fx-panel");
  return { button: !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0, panel: !!p,
           open: !!p && p.classList.contains("open"), api: typeof window.SignalOverdriveFx, isolated: self.crossOriginIsolated, url: location.href }; })()`;

async function visit(query) {
  const url = base + query;
  lines.length = 0;
  await send("Page.navigate", { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) { ready = lines.some((l) => l.includes("signal-overdrive: ready")); if (!ready) await wait(200); }
  if (!ready) { console.log(`SETUP-FAILED: ${query}: no "signal-overdrive: ready" in 60 s; last lines ${JSON.stringify(lines.slice(-5))}`); done(2); }
  const before = await evalJs(PAGE);
  if (before.url !== url) { console.log(`SETUP-FAILED: ${query}: the page is ${before.url}`); done(2); }
  if (before.isolated !== true) { console.log(`SETUP-FAILED: ${query}: not crossOriginIsolated`); done(2); }
  await press("Enter");          // the start gate's gesture
  await wait(1500);
  const mark = lines.length;     // only lines after the keys count as the keys' answers
  for (const k of ["F3", "F4", "F6", "F8", "Tab"]) await press(k);
  await wait(500);
  const keyLines = lines.slice(mark);
  await press("e");
  await wait(400);
  const after = await evalJs(PAGE);
  const all = lines.slice();     // this page's lines; the next visit clears `lines`
  const has = (s, from = all) => from.some((l) => l.includes(s));
  return { before, after, has, keyLines, all };
}

const pl = await visit("?fps");
const dv = await visit("?dev&fps");
clearTimeout(timer);
const k = (v, s) => v.has(s, v.keyLines);
const checks = [
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
if (!checks.every((c) => c[1])) {
  console.log(`?fps key lines: ${JSON.stringify(pl.keyLines)}`);
  console.log(`?dev key lines: ${JSON.stringify(dv.keyLines)}`);
}
const ok = checks.every((c) => c[1]);
console.log(ok ? "VERDICT GREEN" : "VERDICT RED");
done(ok ? 0 : 1);
