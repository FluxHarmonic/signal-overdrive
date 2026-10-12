#!/usr/bin/env node
// serve.mjs DIR PORT [--tls]  - serve DIR on the wg0 address only (read from
// the interface at run time; no address means no server). --tls serves
// HTTPS with tls/{key,cert}.pem, a self-signed certificate for the wg0
// address (scripts/host makes it). From the G0 demo glue, after Harkfell's
// scripts/serve-web-tls.mjs. Copied from Phantom Burn (07a765d), with md, gif and video types added.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const [dir, portArg, ...flags] = process.argv.slice(2);
if (!dir || !portArg) { console.error("usage: serve.mjs DIR PORT [--tls]"); process.exit(2); }
const port = Number(portArg);
const tls = flags.includes("--tls");
const root = path.resolve(dir);
if (!fs.existsSync(path.join(root, "index.html"))) { console.error(`serve: ${root}/index.html missing`); process.exit(1); }
let host = "";
try { host = execSync("ip -4 -o addr show dev wg0", { encoding: "utf8" }).match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1] || ""; } catch { host = ""; }
if (!host || host === "0.0.0.0") { console.error("serve: no wg0 address; refusing to bind elsewhere"); process.exit(1); }
const MIME = { html: "text/html; charset=utf-8", js: "text/javascript", wasm: "application/wasm", json: "application/json",
  css: "text/css", png: "image/png", md: "text/plain; charset=utf-8", gif: "image/gif", webm: "video/webm", mp4: "video/mp4", sgm: "application/octet-stream", b64: "text/plain", txt: "text/plain; charset=utf-8" };
function handler(req, res) {
  const u = new URL(req.url, "http://x");
  // a page's ?trace lines (phone numbers without transcribing), to this log
  if (u.pathname.endsWith("/report")) {
    let line; try { line = decodeURIComponent(u.search.slice(1)); } catch { line = u.search.slice(1); }
    console.log(`report ${new Date().toISOString()} ${req.socket.remoteAddress} ${line.slice(0, 600)}`);
    res.writeHead(204); res.end(); return;
  }
  let urlPath;
  try { urlPath = decodeURIComponent(u.pathname); } catch { res.writeHead(400); res.end(); return; }
  let fp = path.normalize(path.join(root, urlPath));
  if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { if (fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html"); } catch { /* the read reports it */ }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    // cross-origin isolation (COOP + COEP; CORP on everything, all same-origin):
    // a SharedArrayBuffer for the audio bridge, so its stream runs as worklet-sab
    // off the main thread, not worklet-msg or scriptprocessor
    res.writeHead(200, { "content-type": MIME[path.extname(fp).slice(1)] || "application/octet-stream", "cache-control": "no-cache",
      "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" });
    res.end(buf);
  });
}
const server = tls
  ? https.createServer({ key: fs.readFileSync("tls/key.pem"), cert: fs.readFileSync("tls/cert.pem") }, handler)
  : http.createServer(handler);
server.listen(port, host, () => console.log(`serve: ${tls ? "https" : "http"}://${host}:${port}/ serving ${root}`));
