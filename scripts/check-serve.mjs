#!/usr/bin/env node
// check-serve.mjs - scripts/serve.mjs must answer every request and never
// die. Starts it with --loopback on a free port over a scratch tree, sends
// each request below as a raw HTTP request line (so nothing in between
// normalizes the path), and requires its status; after every one, / must
// still answer 200 and the process must still be running.
//
//   node scripts/check-serve.mjs [--serve PATH]     (default scripts/serve.mjs)
//
//   //            200, the index: the path / (new URL("//", base) throws,
//                 which took the server down)
//   //x           404: the path /x, which is not there (new URL("//x", base)
//                 reads x as a HOST and served / instead)
//   //sub/f.txt   200 with sub/f.txt's bytes: a doubled slash is still a path
//   /../site2/s   404: the URL parser removes the .. (nothing outside served)
//   /%2e%2e%2fsite2%2fs
//                 403: the .. appears only after decoding, and lands in a
//                 sibling directory whose name starts with the root's, which a
//                 bare startsWith(root) lets through
//   /%zz          400: a broken escape
//   /             200, the index
// Exit 0 green, 1 red, 2 setup failed.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const si = args.indexOf("--serve");
const SERVE = path.resolve(si >= 0 ? args[si + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "serve.mjs"));
const setup = (why) => { console.log(`SETUP-FAILED: ${why}`); process.exit(2); };
if (!fs.existsSync(SERVE)) setup(`${SERVE} missing`);

// the scratch tree: a root, a file under it, and a sibling whose name
// extends the root's (the case a bare startsWith(root) lets through)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-serve-"));
const root = path.join(tmp, "site");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>index</title>INDEX-MARKER\n");
fs.writeFileSync(path.join(root, "sub", "f.txt"), "SUB-FILE-MARKER\n");
fs.mkdirSync(path.join(tmp, "site2"));
fs.writeFileSync(path.join(tmp, "site2", "s"), "SIBLING-SECRET\n");

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const port = await freePort();
const child = spawn(process.execPath, [SERVE, root, String(port), "--loopback"], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const cleanup = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } fs.rmSync(tmp, { recursive: true, force: true }); };
process.on("exit", cleanup);

// one raw request; resolves { status, body } or { error }
const raw = (target) => new Promise((resolve) => {
  const sock = net.connect(port, "127.0.0.1");
  let buf = Buffer.alloc(0);
  const t = setTimeout(() => { sock.destroy(); resolve({ error: "no answer in 5 s" }); }, 5000);
  sock.on("connect", () => sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
  sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
  sock.on("error", (e) => { clearTimeout(t); resolve({ error: e.code || e.message }); });
  sock.on("close", () => {
    clearTimeout(t);
    const text = buf.toString("latin1");
    const m = text.match(/^HTTP\/1\.1 (\d{3})/);
    resolve(m ? { status: Number(m[1]), body: text.slice(text.indexOf("\r\n\r\n") + 4) } : { error: `no status line (${JSON.stringify(text.slice(0, 40))})` });
  });
});

// up?
let up = null;
for (let i = 0; i < 50 && !up; i++) { const r = await raw("/"); if (r.status === 200) up = r; else await new Promise((r2) => setTimeout(r2, 100)); }
if (!up) setup(`serve.mjs never answered / on 127.0.0.1:${port}: ${log.slice(0, 300)}`);

let fail = 0;
const ok = (what) => console.log(`  ok   ${what}`);
const bad = (what) => { fail++; console.log(`  FAIL ${what}`); };
const cases = [
  ["//", 200, "INDEX-MARKER"],
  ["//x", 404, null],
  ["//sub/f.txt", 200, "SUB-FILE-MARKER"],
  ["/../site2/s", 404, null],
  ["/%2e%2e%2fsite2%2fs", 403, null],
  ["/%zz", 400, null],
  ["/", 200, "INDEX-MARKER"],
];
for (const [target, want, marker] of cases) {
  const r = await raw(target);
  if (r.error) bad(`${target}: ${r.error}`);
  else if (r.status !== want) bad(`${target}: ${r.status} (want ${want})${/INDEX-MARKER/.test(r.body) ? ", with the index's body" : ""}${/SIBLING-SECRET/.test(r.body) ? ", with the sibling's file" : ""}`);
  else if (marker && !r.body.includes(marker)) bad(`${target}: ${r.status} without ${marker}`);
  else ok(`${target}: ${r.status}`);
  // and the server is still there
  const after = await raw("/");
  if (child.exitCode !== null || child.signalCode) { bad(`after ${target} the server exited (${child.exitCode ?? child.signalCode}): ${log.slice(-300)}`); break; }
  if (after.status !== 200) bad(`after ${target}, / answered ${after.status ?? after.error}`);
}
if (fail === 0) { console.log(`GREEN: ${cases.length} requests answered as wanted; the server answered / after each and is still running`); process.exit(0); }
console.log(`RED: ${fail} fail`);
process.exit(1);
