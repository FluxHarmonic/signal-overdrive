// Harkfell's deterministic first-install controls, extended for Signal's
// menu consent and restart semantics. Run on Phantom: node --test test/test-pwa.mjs
// These controls do not replace real Chrome/render/offline acceptance.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, webcrypto } from "node:crypto";

const pageSource = fs.readFileSync(process.env.SIGNAL_PWA_SOURCE || "assets/pwa/update.js", "utf8");
const workerSource = fs.readFileSync(process.env.SIGNAL_SW_SOURCE || "web/sw.js", "utf8");
const flush = () => new Promise(setImmediate);
const event = (type, values) => Object.assign(new Event(type), values);
class Channel {
  constructor() {
    this.port1 = { close() {} };
    this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })) };
  }
}

async function page(controlled, available = null) {
  const window = new EventTarget(), document = new EventTarget(), sw = new EventTarget();
  const registration = new EventTarget(), worker = new EventTarget();
  const messages = [], calls = [], intervals = [], timers = [];
  let phase = 2, chosen = false, reloads = 0, announcements = 0;
  const current = { postMessage(message, ports) {
    if (message.type === "VERSION") ports[0].postMessage({ version: "A", available });
  } };
  sw.controller = controlled ? current : null;
  worker.state = "installing";
  worker.postMessage = message => messages.push(message);
  registration.installing = worker;
  registration.waiting = null;
  registration.update = async () => {};
  sw.register = async (url, options) => {
    assert.equal(url, "sw.js");
    assert.equal(options.updateViaCache, "none");
    return registration;
  };
  window.SigilWebApp = { started: true, dispatch(type, value) {
    calls.push([type, value]);
    if (type === "pwa-state") return phase;
    if (type === "pwa-lock") return phase === 1 ? 1 : 0;
    if (type === "update" && value === "chosen?") {
      const answer = chosen; chosen = false; return answer ? 1 : 0;
    }
    return 1;
  } };
  window.addEventListener("signal-update-waiting", () => announcements++);
  vm.runInNewContext(pageSource, {
    window, document, navigator: { serviceWorker: sw }, Event, MessageChannel: Channel,
    location: { reload() { reloads++; } }, console: { log() {} },
    setInterval(fn) { intervals.push(fn); },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}
  });
  await flush();
  return {
    sw, worker, current, calls, messages, window,
    menu() { phase = 1; }, race() { phase = 2; }, choose() { chosen = true; },
    poll() { intervals[0](); }, reloads: () => reloads, announcements: () => announcements,
    install() {
      registration.waiting = worker;
      worker.state = "installed";
      worker.dispatchEvent(new Event("statechange"));
    }
  };
}

test("first install stays quiet when claim wins the installed callback race", async () => {
  const p = await page(false);
  p.sw.controller = p.current;
  p.sw.dispatchEvent(new Event("controllerchange"));
  p.install();
  assert.equal(p.announcements(), 0);
  assert(!p.calls.some(([type]) => type === "update"));
  assert.equal(p.reloads(), 0);
});

test("no new version supplies no menu notification and no activation", async () => {
  const p = await page(true);
  p.menu(); p.poll(); p.choose(); p.poll();
  assert.equal(p.announcements(), 0);
  assert.equal(p.messages.length, 0);
});

test("waiting update announces once and waits for the menu's explicit choice", async () => {
  const p = await page(true);
  p.install(); p.install();
  assert.equal(p.announcements(), 1);
  p.menu(); p.poll();
  assert.equal(p.messages.length, 0, "arriving at the menu is not consent");
  p.choose(); p.poll(); p.poll();
  assert.deepEqual(p.messages.map(m => m.type), ["APPLY_UPDATE"]);
  assert.equal(p.reloads(), 0);
});

test("a racing page refuses coordinated activation, including a paused race", async () => {
  const p = await page(true);
  p.install();
  let answer;
  p.sw.dispatchEvent(event("message", {
    data: { type: "UPDATE_PREPARE", version: "B" },
    ports: [{ postMessage(value) { answer = value; } }]
  }));
  assert.equal(answer.safe, false);
  p.sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(p.reloads(), 0);
});

test("a frozen menu reloads once on commit; unsolicited controller changes stay quiet", async () => {
  const p = await page(true);
  p.sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(p.reloads(), 0);
  p.menu();
  p.sw.dispatchEvent(event("message", {
    data: { type: "UPDATE_PREPARE", version: "B" }, ports: [{ postMessage() {} }]
  }));
  p.sw.dispatchEvent(new Event("controllerchange"));
  p.sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(p.reloads(), 1);
});

test("a newer waiting worker supersedes an active worker's unselected candidate", async () => {
  const p = await page(true, "B");
  p.install(); // the waiting worker represents C, newer than active B
  p.window.dispatchEvent(new Event("online"));
  await flush();
  p.menu(); p.choose(); p.poll();
  assert.deepEqual(p.messages.map(message => message.type), ["APPLY_UPDATE"]);
});

function cacheStorage() {
  const stores = new Map();
  return {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(key) { return entries.get(typeof key === "string" ? key : key.url)?.clone(); },
        async put(key, response) { entries.set(typeof key === "string" ? key : key.url, response.clone()); }
      };
    }
  };
}

function worker(version, caches, clients = [], badHash = false) {
  const handlers = new Map(), messages = [];
  const content = "page-" + version;
  const inventory = [{ url: "index.html", sha256: createHash("sha256").update(content).digest("hex") }];
  const self = {
    registration: { scope: "https://signal.test/drive/", waiting: null },
    clients: { async matchAll() { return clients; }, async claim() {} },
    async skipWaiting() {},
    addEventListener(type, fn) { handlers.set(type, fn); }
  };
  vm.runInNewContext(workerSource.replace("__PWA_VERSION__", JSON.stringify(version))
    .replace("__PWA_INVENTORY__", JSON.stringify(inventory)), {
    self, caches, URL, Request, Response, Headers, Map, Uint8Array,
    crypto: webcrypto, MessageChannel: Channel, setTimeout, clearTimeout,
    fetch: async () => new Response(badHash ? "wrong-bytes" : content)
  });
  return {
    async run(type, extra = {}) {
      let promise;
      handlers.get(type)({ waitUntil(p) { promise = p; }, respondWith(p) { promise = p; }, ...extra });
      return promise;
    },
    async info() {
      await this.run("message", { data: { type: "VERSION" }, ports: [{ postMessage(data) { messages.push(data); } }] });
      return messages.at(-1);
    }
  };
}

test("browser restart keeps A selected until the menu explicitly applies B", async () => {
  const caches = cacheStorage();
  const a = worker("A", caches);
  await a.run("install"); await a.run("activate");
  assert.equal((await a.info()).available, null, "same version has no update item");
  const notices = [];
  const client = { id: "menu", url: "https://signal.test/drive/", postMessage(message, ports) {
    notices.push(message.type);
    ports?.[0].postMessage({ safe: true });
  } };
  const b = worker("B", caches, [client]);
  await b.run("install"); await b.run("activate");
  const info = await b.info();
  assert.equal(info.version, "A");
  assert.equal(info.available, "B");
  const response = await b.run("fetch", { request: {
    url: "https://signal.test/drive/?offline", method: "GET", mode: "navigate"
  } });
  assert.equal(await response.text(), "page-A");
  assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
  await b.run("message", { data: { type: "APPLY_UPDATE" }, source: client });
  assert.equal((await b.info()).version, "B");
  assert(notices.includes("UPDATE_COMMIT"));
  assert(!(await caches.keys()).some(name => name.endsWith("-A")));
});

test("a mixed deployment fails installation while A remains usable", async () => {
  const caches = cacheStorage();
  const a = worker("A", caches);
  await a.run("install"); await a.run("activate");
  const b = worker("B", caches, [], true);
  await assert.rejects(b.run("install"), /mixed deployment/);
  assert.equal((await a.info()).version, "A");
  assert(!(await caches.keys()).some(name => name.endsWith("-B")));
});

test("a second racing window vetoes the menu's update without changing the selected build", async () => {
  const caches = cacheStorage();
  const a = worker("A", caches);
  await a.run("install"); await a.run("activate");
  const messages = [];
  const client = (id, safe) => ({ id, url: "https://signal.test/drive/", postMessage(message, ports) {
    messages.push([id, message.type]);
    ports?.[0].postMessage({ safe });
  } });
  const menu = client("menu", true), race = client("race", false);
  const b = worker("B", caches, [menu, race]);
  await b.run("install");
  await b.run("message", { data: { type: "APPLY_UPDATE" }, source: menu });
  assert.equal((await a.info()).version, "A");
  assert(messages.some(([id, type]) => id === "menu" && type === "UPDATE_ABORT"));
  assert(messages.some(([id, type]) => id === "menu" && type === "UPDATE_BLOCKED"));
  assert(!messages.some(([, type]) => type === "UPDATE_COMMIT"));
});
