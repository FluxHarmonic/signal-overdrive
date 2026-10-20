// Harkfell's first-install snapshot; Crash's game-owned UPDATE menu choice.
// The page has no update card or automatic apply-on-menu behaviour.
(() => {
  "use strict";
  const controlledAtLoad = !!navigator.serviceWorker?.controller;
  const status = { state: "none", registration: null, controlledAtLoad };
  window.SignalOverdriveUpdate = status;
  let app = null, locked = false, changed = false, reloadSent = false;
  let lockedVersion = null, offered = null;
  const lifecycle = () => app ? app.dispatch("pwa-state", "") : 0;

  function offer(worker) {
    // clients.claim can win the installed callback on a first visit.
    if (!controlledAtLoad || !worker || worker === offered || locked) return;
    offered = worker;
    status.state = "waiting";
    app?.dispatch("update", "waiting");
    window.dispatchEvent(new Event("signal-update-waiting"));
  }
  function unlock() {
    if (locked) app.dispatch("pwa-unlock", "");
    locked = false;
    lockedVersion = null;
  }
  function poll() {
    const state = lifecycle();
    if (changed && state === 1 && !reloadSent) {
      reloadSent = true;
      location.reload();
      return;
    }
    // Consuming the game's choice is the only path to APPLY_UPDATE.
    if (status.state === "waiting" && state === 1 &&
        app.dispatch("update", "chosen?") === 1) {
      status.state = "preparing";
      // A newer waiting build supersedes an active worker's older pending
      // candidate without requiring the player to notice the distinction.
      offered = status.registration?.waiting || offered;
      offered.postMessage({ type: "APPLY_UPDATE" });
      setTimeout(() => {
        if (status.state === "preparing") {
          status.state = "waiting";
          app.dispatch("update", "blocked");
        }
      }, 5000);
    }
  }
  status.check = () => Promise.resolve();
  function query(worker, type) {
    return new Promise(resolve => {
      if (!worker) { resolve(null); return; }
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 3000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close(); resolve(event.data);
      };
      worker.postMessage({ type }, [channel.port2]);
    });
  }
  status.activeVersion = async () => (await query(navigator.serviceWorker?.controller, "VERSION"))?.version || null;
  if (!("serviceWorker" in navigator)) { status.state = "unsupported"; return; }
  navigator.serviceWorker.addEventListener("message", event => {
    const message = event.data || {};
    if (message.type === "UPDATE_PREPARE") {
      locked = lifecycle() === 1 && app.dispatch("pwa-lock", "") === 1;
      if (locked) {
        lockedVersion = message.version;
        status.state = "applying";
        // A vanished worker or suspended tab must not freeze a menu forever.
        setTimeout(async () => {
          if (!locked || lockedVersion !== message.version) return;
          if (await status.activeVersion() === lockedVersion) { changed = true; poll(); }
          else { unlock(); status.state = "waiting"; }
        }, 15000);
      }
      event.ports[0]?.postMessage({ safe: locked });
    } else if (message.type === "UPDATE_ABORT" && message.version === lockedVersion) {
      unlock();
      status.state = "waiting";
      app.dispatch("update", "blocked");
    } else if (message.type === "UPDATE_BLOCKED") {
      status.state = "waiting";
      app?.dispatch("update", "blocked");
    } else if (message.type === "UPDATE_COMMIT" && message.version === lockedVersion) {
      changed = true;
      poll();
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (locked) { changed = true; poll(); }
  });
  ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown", "keyup"].forEach(type => {
    window.addEventListener(type, event => {
      if (locked) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true, passive: false });
  });
  async function ready(a) {
    if (app) return;
    app = a;
    // Loader readiness precedes texture downloads. Wait for the shell's
    // own rendered-frames signal so no boot fetch straddles activation.
    while (!lifecycle()) await new Promise(resolve => setTimeout(resolve, 250));
    try {
      const registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
      status.registration = registration;
      status.state = "registered";
      let checking = null;
      const watch = worker => {
        if (!worker) return;
        let completed = ["installed", "activating", "activated"].includes(worker.state);
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") {
            completed = true;
            offer(registration.waiting);
          }
          // Recover failed registration installs too. A successfully installed
          // worker later replaced by the player's choice needs no recovery.
          if (worker.state === "redundant" && !completed && !checking) check();
        });
      };
      offer(registration.waiting);
      watch(registration.installing);
      registration.addEventListener("updatefound", () => watch(registration.installing));
      const inspect = async () => {
        offer(registration.waiting);
        // If the browser activated B when all tabs closed, B still serves
        // A until consent. Its durable pending state supplies the menu item.
        const current = navigator.serviceWorker.controller;
        const info = await query(current, "VERSION");
        // A waiting C takes precedence over active B still serving A.
        if (registration.waiting) offer(registration.waiting);
        else if (info?.available) offer(current);
      };
      const installed = worker => new Promise((resolve, reject) => {
        if (!worker) { resolve(); return; }
        const changed = () => {
          if (["installed", "activating", "activated", "redundant"].includes(worker.state)) {
            worker.removeEventListener("statechange", changed);
            if (worker.state === "redundant") reject(Object.assign(
              new Error("update installation interrupted"), { installationInterrupted: true }));
            else resolve();
          }
        };
        worker.addEventListener("statechange", changed);
        changed();
      });
      const check = () => {
        if (checking) return checking;
        checking = (async () => {
          try {
            // register() and browser checks can already be installing. Join
            // that install; update() itself resolves before installation ends.
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                if (!registration.installing || registration.installing.state === "redundant") {
                  await registration.update();
                }
                await installed(registration.installing);
                await inspect();
                return;
              } catch (error) {
                if (!error.installationInterrupted || attempt !== 0) throw error;
                // A native browser interruption need not mean a bad build.
                // Keep all callers joined through one bounded retry; the
                // worker still verifies every byte and never auto-applies.
                console.log("signal: update install interrupted; retrying once");
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } catch (error) {
            console.log("signal: update check unavailable " + error.message);
          } finally {
            checking = null;
          }
        })();
        return checking;
      };
      status.check = check;
      await inspect();
      setInterval(check, 15 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
      window.addEventListener("online", check);
      console.log("signal: sw registered");
    } catch (error) {
      status.state = "failed";
      status.reason = error.message;
      console.log("signal: sw refused " + error.message);
    }
  }
  setInterval(poll, 250);
  if (window.SigilWebApp?.started) ready(window.SigilWebApp);
  else document.addEventListener("sigil-web-app-ready", event => ready(event.detail), { once: true });
})();
