#!/usr/bin/env node
// Phantom only. Harkfell's same-profile install/render/offline/update shape.
// node scripts/verify-pwa.mjs STAGED-SITE [--restart] [--diagnostics]
//   [--sabotage no-worker|frozen-worker|mixed-deployment]
// Sabotaged runs MUST exit nonzero. No screenshots, video or production host.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const input = path.resolve(args[0] || "build/site");
const sabotage = args.includes("--sabotage") ? args[args.indexOf("--sabotage") + 1] : null;
if (sabotage && !["no-worker", "frozen-worker", "mixed-deployment"].includes(sabotage)) throw new Error("Unknown sabotage arm");
const restart = args.includes("--restart");
const diagnostics = args.includes("--diagnostics");
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-pwa-acceptance-"));
const profile = path.join(scratch, "profile");
const roots = [path.join(scratch, "A"), path.join(scratch, "B")];
const deadline = Date.now() + 8 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let revision = 0, offline = false, chrome, identity, ws;
const requests = [], lines = [], errors = [], pending = new Map();
const workerRequests = [];
const serverFailures = [];
const workerErrors = [];
const workerRegistrations = new Set();
let sequence = 0;
function admitted(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return { pid, uid: fs.statSync(`/proc/${pid}`).uid, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
  } catch { return null; }
}
function sameProcess() {
  const current = identity && admitted(identity.pid);
  return current && current.uid === identity.uid && current.start === identity.start;
}
async function until(fn, label, milliseconds = 60000) {
  const end = Math.min(deadline, Date.now() + milliseconds);
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}`);
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };
// Apply the staged _headers rules; avoid a blanket no-store test origin.
function headers(pathname) {
  const out = {};
  let matches = false;
  for (const line of fs.readFileSync(path.join(roots[revision], "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = "^" + line.trim().split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
      matches = new RegExp(pattern).test(pathname);
    } else if (matches) {
      const colon = line.indexOf(":");
      if (colon > 0) out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return out;
}
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    requests.push(pathname);
    if (pathname === "/drive/sw.js") {
      const request = { at: Date.now(), revision, sabotage };
      workerRequests.push(request);
      if (diagnostics) console.log(`SW REQUEST ${JSON.stringify(request)}`);
    }
    // Browser-level SW checks can bypass page offline emulation. Deny the
    // server too, proving the offline page cannot borrow any network bytes.
    if (offline) { res.writeHead(503).end(); return; }
    // Pages and the real review host canonicalize index.html this way.
    if (pathname === "/drive/index.html") {
      res.writeHead(308, { location: "/drive/" }).end(); return;
    }
    if (sabotage === "no-worker" && pathname === "/drive/sw.js") { res.writeHead(404).end(); return; }
    const served = sabotage === "frozen-worker" && pathname === "/drive/sw.js" ? roots[0] : roots[revision];
    const file = path.resolve(served, "." + pathname, pathname.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(served + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) {
        serverFailures.push({ pathname, revision, error: error.code });
        res.writeHead(404).end(); return;
      }
      if (sabotage === "mixed-deployment" && revision === 1 && pathname.endsWith(".wasm")) {
        bytes[bytes.length - 1] ^= 1; // B alone has a bad large-resource digest.
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", ...headers(pathname) });
      res.end(bytes);
    });
  } catch (error) { res.writeHead(500).end(String(error)); }
});
let origin;
async function press(key) {
  const code = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 }[key];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code });
  await sleep(120);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
  await sleep(250);
}
async function probe() {
  const start = lines.length;
  await evaluate("SigilWebApp.dispatch('probe', '')");
  return until(() => lines.slice(start).find(line => line.startsWith("signal-overdrive: probe ")), "game probe", 5000);
}
const field = (line, key) => line.match(new RegExp("(?:^| )" + key + " (\\S+)"))?.[1] ?? null;
async function screen(name) {
  return until(async () => field(await probe(), "flow") === name, `flow ${name}`);
}
async function rendered() {
  await until(() => evaluate(`new Promise(resolve => requestAnimationFrame(() => {
    const canvas = document.getElementById('stage'), gl = canvas?.getContext('webgl2');
    if (!gl || canvas.width < 1 || canvas.height < 1) { resolve(false); return; }
    const pixels = new Uint8Array(16 * 16 * 4);
    gl.readPixels(Math.max(0, canvas.width / 2 - 8), Math.max(0, canvas.height / 2 - 8), 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    resolve(pixels.some((value, index) => index % 4 !== 3 && value > 0));
  }))`), "nonblack WebGL frame", 20000);
}
async function boot() {
  const start = lines.length;
  await send("Page.navigate", { url: `${origin}/drive/?card=0&title=1` });
  await until(() => lines.slice(start).includes("signal-overdrive: ready"), "rendered game ready");
  await until(() => evaluate("!!navigator.serviceWorker.controller"), "real worker controller");
  await rendered();
}
async function menu() {
  await screen("title");
  await press("Enter");
  await screen("mode");
  await until(() => evaluate("SigilWebApp.dispatch('pwa-state', '') === 1"), "main-menu permission");
}
async function selectFirst() {
  for (let count = 0; count < 6; count++) {
    if (field(await probe(), "sel") === "0") return;
    await press("ArrowUp");
  }
  throw new Error("Main-menu selection did not reach row 0");
}
const progress = "((version . 1) (cleared (docklands learner)) (cups ((docklands . learner) 2 29)) (best ((run learner breakwater) 7452 2301)))";
const storageSnapshot = "Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))";
try {
  assert(fs.existsSync(path.join(input, "drive/pwa-build.json")), "SETUP: provide a staged PWA site, including /drive/ and /w/");
  for (let index = 0; index < roots.length; index++) {
    fs.cpSync(input, roots[index], { recursive: true });
    const pagePath = path.join(roots[index], "drive/index.html");
    const original = fs.readFileSync(pagePath, "utf8");
    const page = original.replace(/name="substratic-version" content="([^"]+)"/,
      (_, stamp) => `name="substratic-version" content="${stamp}-acceptance-${index}"`);
    assert.notEqual(page, original);
    fs.writeFileSync(pagePath, page);
    const prepare = spawnSync(process.execPath, [path.join(source, "scripts/prepare-pwa.mjs"), path.dirname(pagePath)], { stdio: "inherit", timeout: 30000 });
    assert.equal(prepare.status, 0, "SETUP: coherent A/B PWA generation");
  }
  const versions = roots.map(root => JSON.parse(fs.readFileSync(path.join(root, "drive/pwa-build.json"), "utf8")).version);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
  let spawnError;
  chrome.once("error", error => { spawnError = error; });
  await until(() => { if (spawnError) throw spawnError; identity = admitted(chrome.pid); return identity; }, "Chrome admitted PID", 10000);
  assert.equal(identity.uid, process.getuid(), "browser owned by this worker");
  console.log(`BROWSER pid=${identity.pid} uid=${identity.uid} start=${identity.start}`);
  await until(() => fs.existsSync(path.join(profile, "DevToolsActivePort")), "Chrome debugger", 20000);
  const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      if (!call) return;
      clearTimeout(call.timer); pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error))); else call.resolve(message.result);
    } else if (message.method === "Runtime.consoleAPICalled") {
      const line = message.params.args.map(value => value.value ?? value.description ?? "").join(" ");
      if (message.sessionId) console.log(`SW CONSOLE ${message.params.type}: ${line}`);
      else {
        lines.push(line);
        if (message.params.type === "error") errors.push(line);
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      const error = message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text;
      if (message.sessionId) console.error(`SW EXCEPTION: ${error}`);
      else errors.push(error);
    } else if (message.method === "ServiceWorker.workerRegistrationUpdated") {
      for (const registration of message.params.registrations) {
        if (registration.scopeURL === origin + "/drive/") workerRegistrations.add(registration.registrationId);
      }
    } else if (message.method === "ServiceWorker.workerErrorReported") {
      const error = message.params.errorMessage;
      if (error.sourceURL.startsWith(origin + "/drive/") || workerRegistrations.has(error.registrationId)) {
        workerErrors.push(error);
        console.error(`SW ERROR ${JSON.stringify(error)}`);
      }
    } else if (diagnostics && message.method === "ServiceWorker.workerVersionUpdated") {
      console.log(`SW VERSIONS ${JSON.stringify(message.params.versions)}`);
    } else if (diagnostics && message.method === "Target.targetCreated") {
      const target = message.params.targetInfo;
      if (target.type === "service_worker" && target.url.startsWith(origin + "/drive/")) {
        console.log(`SW TARGET ${JSON.stringify(target)}`);
        send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
          .then(({ sessionId }) => send("Runtime.enable", {}, sessionId))
          .catch(error => console.error(`SW ATTACH: ${error.message}`));
      }
    } else if (diagnostics && message.method === "Target.targetDestroyed") {
      console.log(`TARGET DESTROYED ${message.params.targetId}`);
    }
  });
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  await send("Page.enable"); await send("Runtime.enable");
  if (diagnostics) {
    // Attaching a debugger can alter worker lifetime/timing. Keep this opt-in;
    // acceptance must also pass without observing worker targets or Network.
    await send("ServiceWorker.enable");
    await send("Target.setDiscoverTargets", { discover: true });
  }
  // First boot deliberately has no Network.enable: observing network can
  // mask Chrome's fetch-across-SW-activation failure (estate incident note).
  await boot();
  assert.equal(await evaluate("SignalOverdriveUpdate.controlledAtLoad"), false);
  assert.notEqual(await evaluate("SignalOverdriveUpdate.state"), "waiting");
  await menu(); await selectFirst(); await press("ArrowDown"); await press("ArrowDown");
  assert.equal(field(await probe(), "sel"), "0", "no-new-version sabotage control: only RUN and TIME TRIAL, no hidden update row");
  await evaluate("SignalOverdriveUpdate.check()");
  assert.notEqual(await evaluate("SignalOverdriveUpdate.state"), "waiting");
  console.log("PASS first install and no-new-version: controller, render, no update row");
  const installability = await send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);
  const manifest = await evaluate("(await fetch('assets/pwa/manifest.webmanifest')).json()");
  assert.equal(manifest.name, "Signal Overdrive");
  assert.equal(manifest.display, "standalone");
  assert.equal(new URL(manifest.scope, origin + "/drive/assets/pwa/manifest.webmanifest").pathname, "/drive/");
  for (const purpose of ["any", "maskable"]) assert.deepEqual(manifest.icons.filter(icon => icon.purpose === purpose).map(icon => icon.sizes).sort(), ["192x192", "512x512"]);
  await evaluate(`localStorage.setItem('signal-overdrive:progress', ${JSON.stringify(progress)})`);
  // B lands while this document is still the first visit. Claim must not
  // turn its installed callback into a spurious first-visit update prompt.
  revision = 1;
  await evaluate(`(() => {
    const registration = SignalOverdriveUpdate.registration;
    window.__pwaInstallStates = [];
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      const record = () => __pwaInstallStates.push({ at: Date.now(), state: worker.state });
      record(); worker.addEventListener('statechange', record);
    });
  })()`);
  const completedWithWaiting = await evaluate(`(() => {
    const first = SignalOverdriveUpdate.check();
    const adjacent = SignalOverdriveUpdate.check();
    if (first !== adjacent) throw new Error('adjacent update checks did not share completion');
    return Promise.all([first, adjacent]).then(() => !!SignalOverdriveUpdate.registration.waiting);
  })()`);
  if (!sabotage) assert.equal(completedWithWaiting, true, "shared checks complete only after B is installed");
  await until(async () => {
    const state = await evaluate(`({
      waiting: !!SignalOverdriveUpdate.registration?.waiting,
      rejected: window.__pwaInstallStates?.some(item => item.state === 'redundant')
    })`);
    if (state.waiting) return true;
    if (workerErrors.length) throw new Error(`B worker error: ${JSON.stringify(workerErrors)}`);
    if (state.rejected) throw new Error("B install became redundant; inspect SW and server diagnostics");
    return false;
  }, "B installed in A's existing browser profile");
  console.log("PASS adjacent update checks: one shared check includes B installation");
  assert.notEqual(await evaluate("SignalOverdriveUpdate.state"), "waiting");
  if (restart) {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(1500); // close the only game client, allowing natural activation
  }
  await boot(); await menu();
  assert.equal(await evaluate("SignalOverdriveUpdate.activeVersion()"), versions[0], "B is not selected silently on reload/restart");
  assert.equal(field(await probe(), "open"), "learner,courier", "real progression fixture is loaded by the game");
  const stored = await evaluate(storageSnapshot);
  assert.equal(stored["signal-overdrive:progress"], progress);
  await until(() => evaluate("SignalOverdriveUpdate.state === 'waiting'"), "ready update reaches game menu");
  // Only now turn on Network, for cache-disabled offline emulation.
  await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
  offline = true;
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const firstOfflineRequest = requests.length;
  await boot(); await menu();
  assert.equal(await evaluate("crossOriginIsolated"), true);
  const inventory = JSON.parse(fs.readFileSync(path.join(roots[0], "drive/pwa-build.json"), "utf8")).inventory;
  const misses = await evaluate(`(async () => {
    const misses = [];
    for (const item of ${JSON.stringify(inventory)}) {
      try { const response = await fetch(new URL(item.url, location.href)); await response.arrayBuffer(); if (!response.ok) misses.push(item.url); }
      catch { misses.push(item.url); }
    }
    return misses;
  })()`);
  assert.deepEqual(misses, [], "every wasm, JS, image and audio inventory resource works offline");
  assert.deepEqual(requests.slice(firstOfflineRequest).filter(url => url !== "/drive/sw.js"), []);
  console.log(`PASS offline: ${inventory.length} resources including hashed wasm; isolated rendered reload`);
  offline = false;
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await until(() => evaluate("SignalOverdriveUpdate.state === 'waiting'"), "B still ready after offline play");
  // Real menu navigation into RUN and then a race. A pause never permits B.
  await selectFirst(); await press("Enter"); await screen("tier");
  await press("Enter"); await screen("cup"); await press("Enter"); await screen("racing");
  await until(async () => field(await probe(), "phase") === "race", "countdown completes");
  assert.equal(await evaluate("SigilWebApp.dispatch('pwa-state', '')"), 2);
  const tick = Number(field(await probe(), "race-tick"));
  await until(async () => Number(field(await probe(), "race-tick")) > tick + 10, "race advances offline-capable build");
  assert.equal(await evaluate("SignalOverdriveUpdate.activeVersion()"), versions[0]);
  await press("Escape"); await screen("paused");
  assert.equal(await evaluate("SigilWebApp.dispatch('pwa-state', '')"), 2, "paused race is not an update menu");
  assert.equal(await evaluate("SignalOverdriveUpdate.activeVersion()"), versions[0]);
  await press("ArrowDown"); await press("ArrowDown"); await press("Enter"); await screen("mode");
  await selectFirst(); await press("ArrowDown"); await press("ArrowDown");
  assert.equal(field(await probe(), "sel"), "2", "ready build appends the actual INSTALL UPDATE menu row");
  const beforeApply = lines.length;
  await press("Enter");
  await until(() => lines.slice(beforeApply).includes("signal-overdrive: ready"), "player's menu selection reloads B");
  await until(() => evaluate(`SignalOverdriveUpdate.activeVersion().then(version => version === ${JSON.stringify(versions[1])})`), "B controller-reported selected version");
  assert.match(await evaluate("document.querySelector('meta[name=substratic-version]').content"), /acceptance-1$/);
  await rendered();
  assert.deepEqual(await evaluate(storageSnapshot), stored, "all saved progress survives byte-for-byte");
  assert.equal(field(await probe(), "open"), "learner,courier");
  const cacheNames = await evaluate("(await caches.keys()).filter(name => name.startsWith('signal-overdrive-play-'))");
  assert.equal(cacheNames.length, 1);
  assert(cacheNames[0].endsWith(versions[1]));
  assert.deepEqual(errors, []);
  console.log(`PASS update${restart ? ' after browser restart' : ''}: same origin/profile, real menu choice, B rendered, progress and unlocks intact, A cache removed`);
  console.log("VERDICT GREEN");
} catch (error) {
  process.exitCode = 1;
  console.error(error.stack);
  console.error(`SW REQUESTS ${JSON.stringify(workerRequests)}`);
  console.error(`SERVER FAILURES ${JSON.stringify(serverFailures)}`);
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      console.error(`SW STATE ${JSON.stringify(await evaluate(`({
        bridge: SignalOverdriveUpdate?.state,
        active: SignalOverdriveUpdate?.registration?.active?.state,
        installing: SignalOverdriveUpdate?.registration?.installing?.state,
        waiting: SignalOverdriveUpdate?.registration?.waiting?.state,
        transitions: window.__pwaInstallStates,
        caches: await caches.keys()
      })`))}`);
    } catch (diagnosticError) { console.error(`SW STATE unavailable: ${diagnosticError.message}`); }
  }
  console.error(lines.slice(-15).join("\n"));
  console.error("VERDICT RED" + (sabotage ? ` (sabotage ${sabotage})` : ""));
} finally {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("Browser check ended")); }
  pending.clear(); ws?.close();
  server.closeAllConnections(); server.close();
  // Admit exact owner/start time before stopping our child; never a pattern
  // or process group. Leave any unknown process and its profile untouched.
  if (sameProcess()) chrome.kill("SIGTERM");
  for (let attempts = 0; attempts < 20 && sameProcess(); attempts++) await sleep(100);
  if (sameProcess()) chrome.kill("SIGKILL");
  await sleep(100);
  if (!sameProcess()) fs.rmSync(scratch, { recursive: true, force: true });
  else console.error(`Cleanup deferred for admitted browser ${identity.pid}; scratch ${scratch}`);
}
