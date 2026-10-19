#!/usr/bin/env node
// Run after link-web-application AND after stage-web's wasm URL rewrite.
// No server or publish: this only prepares an existing build directory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Canvas, C } from "./art/lib.mjs";
import { readRGBA } from "./art/gen-logo.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] || "build/web");
const page = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stamp = page.match(/name="substratic-version" content="([A-Za-z0-9._-]+)"/)?.[1];
if (!stamp || stamp.includes("__")) throw new Error("PWA requires a stamped build page");
const dest = path.join(root, "assets/pwa");
fs.mkdirSync(dest, { recursive: true });
for (const name of ["manifest.webmanifest", "update.js"]) {
  fs.copyFileSync(path.join(source, "assets/pwa", name), path.join(dest, name));
}

// Existing Signal mark, nearest-neighbour in its original palette. Keep
// all artwork inside a central 54% square: even its corners fit within the
// maskable safe circle (diameter 80%).
const mark = readRGBA(path.join(source, "site/favicon.png"));
for (const size of [180, 192, 512]) {
  const canvas = new Canvas(size, size);
  canvas.rect(0, 0, size, size, C.BG);
  const scale = size * 0.54 / Math.max(mark.w, mark.h);
  const w = Math.floor(mark.w * scale), h = Math.floor(mark.h * scale);
  const left = Math.floor((size - w) / 2), top = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (Math.floor(y / scale) * mark.w + Math.floor(x / scale)) * 4;
    if (mark.px[i + 3] > 127) canvas.set(left + x, top + y, Array.from(mark.px.slice(i, i + 3)));
  }
  canvas.checkPalette(`PWA icon ${size}`);
  canvas.save(path.join(dest, `icon-${size}.png`));
  if (size !== 180) canvas.save(path.join(dest, `icon-maskable-${size}.png`));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`PWA inventory refuses symlink ${file}`);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = ["index.html", ...fs.readdirSync(root).filter(n => /^sigil-wasm-bridges\./.test(n)),
  ...walk(path.join(root, "assets")).map(f => path.relative(root, f))];
const wasm = page.match(/data-wasm="([^"]+)"/)?.[1];
if (!wasm) throw new Error("PWA inventory cannot find the wasm URL");
// A staged wasm is served at /w/HASH/NAME.wasm, outside /drive/. The
// controlling worker still sees that same-origin request from its page.
const wasmURL = `${wasm}.wasm`;
const wasmFile = wasm.startsWith("/")
  ? path.join(path.dirname(root), wasmURL.slice(1)) : path.join(root, wasmURL);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inventory = [...new Set(files)].sort().map(file => ({
  url: file, sha256: digest(fs.readFileSync(path.join(root, file)))
}));
inventory.push({ url: wasmURL, sha256: digest(fs.readFileSync(wasmFile)) });
// Worker-only fixes also need a distinct cache. Otherwise reinstalling a
// changed worker could overwrite/delete an already selected cache on failure.
const template = fs.readFileSync(path.join(source, "web/sw.js"), "utf8");
const version = `${stamp}-${digest(template + "\0" + JSON.stringify(inventory)).slice(0, 16)}`;
const worker = template
  .replace("__PWA_VERSION__", JSON.stringify(version))
  .replace("__PWA_INVENTORY__", JSON.stringify(inventory));
fs.writeFileSync(path.join(root, "sw.js"), worker);
fs.writeFileSync(path.join(root, "pwa-build.json"), JSON.stringify({ version, stamp, inventory }, null, 2) + "\n");
console.log(`PWA ${version}: ${inventory.length} verified resources, wasm ${wasmURL}`);
