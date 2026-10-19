#!/usr/bin/env node
// Phantom only: prove each deterministic gate rejects its target defect.
// Source overrides are isolated copies; no planted bytes touch the checkout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const files = { page: "assets/pwa/update.js", worker: "web/sw.js" };
const sources = Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, fs.readFileSync(file, "utf8")]));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-pwa-sabotage-"));
function run(overrides = {}) {
  const result = spawnSync(process.execPath, ["--test", "test/test-pwa.mjs"], {
    encoding: "utf8", env: { ...process.env, ...overrides }
  });
  const report = result.stdout + result.stderr;
  assert.equal(result.signal, null, "control process completed normally");
  assert.match(report, /# tests 9\b/, "all nine controls ran: syntax/setup failures are not a red arm");
  return { code: result.status, report };
}
try {
  const baseline = run();
  assert.equal(baseline.code, 0, baseline.report);
  console.log("PASS baseline 9/9");
  const plants = [
    ["first-install-claim-race", "page", "const controlledAtLoad = !!navigator.serviceWorker?.controller;", "const controlledAtLoad = true;"],
    ["menu-auto-applies", "page", 'app.dispatch("update", "chosen?") === 1', "true"],
    ["racing-page-accepts", "page", 'locked = lifecycle() === 1 && app.dispatch("pwa-lock", "") === 1;', "locked = true;"],
    ["restart-silently-selects-B", "worker", "if (!active) { active = VERSION; await select(active); }", "active = VERSION; await select(active);"],
    ["mixed-deploy-accepted", "worker", "if (hex !== item.sha256)", "if (false)"],
    ["second-race-ignored", "worker", "replies.some(safe => !safe)", "false"]
  ];
  for (const [name, kind, old, replacement] of plants) {
    assert.equal(sources[kind].split(old).length, 2, `${name}: unique plant anchor`);
    const file = path.join(scratch, name + ".js");
    fs.writeFileSync(file, sources[kind].replace(old, replacement));
    const result = run({ [kind === "page" ? "SIGNAL_PWA_SOURCE" : "SIGNAL_SW_SOURCE"]: file });
    assert.notEqual(result.code, 0, `${name}: gate stayed green\n${result.report}`);
    console.log(`PASS sabotage ${name}: RED (${result.report.match(/# fail (\d+)/)?.[1]} failed checks)`);
  }
  for (const [kind, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, "utf8"), sources[kind], `${file} unchanged`);
  console.log("VERDICT GREEN: six defects rejected; checkout bytes unchanged");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
