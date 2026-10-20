// Small preparation fixtures, not a Sigil build. Run on Phantom only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(staged = false) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-pwa-build-"));
  const root = path.join(scratch, staged ? "drive" : "web");
  fs.mkdirSync(path.join(root, "assets/audio"), { recursive: true });
  const wasm = staged ? "/w/0123456789abcdef/signal-overdrive" : "signal-overdrive";
  const wasmPath = staged ? path.join(scratch, wasm.slice(1) + ".wasm") : path.join(root, wasm + ".wasm");
  fs.mkdirSync(path.dirname(wasmPath), { recursive: true });
  fs.writeFileSync(wasmPath, "wasm-fixture");
  fs.writeFileSync(path.join(root, "index.html"), `<meta name="substratic-version" content="fixture-A"><script data-wasm="${wasm}"></script>`);
  fs.writeFileSync(path.join(root, "assets/audio/later-track.sgm"), "offline audio fixture");
  fs.writeFileSync(path.join(root, "sigil-wasm-bridges.js"), "// bridge fixture");
  return {
    root, wasm, wasmPath,
    run() { return spawnSync(process.execPath, ["scripts/prepare-pwa.mjs", root], { encoding: "utf8" }); },
    info() { return JSON.parse(fs.readFileSync(path.join(root, "pwa-build.json"), "utf8")); },
    dispose() { fs.rmSync(scratch, { recursive: true, force: true }); }
  };
}
for (const staged of [false, true]) test(`${staged ? 'staged R2' : 'direct web'} inventory contains actual wasm and every runtime asset`, () => {
  const f = fixture(staged);
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const info = f.info();
    assert.equal(info.inventory.filter(item => item.url.endsWith(".wasm")).length, 1);
    assert(info.inventory.some(item => item.url === f.wasm + ".wasm"));
    assert(info.inventory.some(item => item.url === "assets/audio/later-track.sgm"));
    for (const item of info.inventory) {
      const file = item.url.startsWith("/") ? f.wasmPath : path.join(f.root, item.url);
      assert.equal(item.sha256, hash(fs.readFileSync(file)), `deployed bytes of ${item.url}`);
    }
    for (const size of [180, 192, 512]) {
      const png = fs.readFileSync(path.join(f.root, `assets/pwa/icon-${size}.png`));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
    const worker = fs.readFileSync(path.join(f.root, "sw.js"), "utf8");
    assert(!worker.includes("__PWA_"));
    assert(worker.includes(info.version));
    assert.equal(f.run().status, 0);
    assert.equal(f.info().version, info.version, "identical preparation produces no new version");
  } finally { f.dispose(); }
});

test("an asset change at a stable URL changes cache identity even without a new git stamp", () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    const before = f.info();
    fs.writeFileSync(path.join(f.root, "assets/audio/later-track.sgm"), "a different song");
    assert.equal(f.run().status, 0);
    const after = f.info();
    assert.equal(before.stamp, after.stamp);
    assert.notEqual(before.version, after.version);
  } finally { f.dispose(); }
});

test("missing staged wasm refuses preparation instead of shipping a broken offline inventory", () => {
  const f = fixture(true);
  try {
    fs.unlinkSync(f.wasmPath);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes(f.wasmPath), "the missing wasm caused the refusal");
    assert(!fs.existsSync(path.join(f.root, "sw.js")));
  } finally { f.dispose(); }
});
