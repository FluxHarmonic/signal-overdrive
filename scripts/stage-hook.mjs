#!/usr/bin/env node
// stage-hook.mjs - the one stage-hook: substratic.sgv names for stage-web,
// which runs a single command after it has copied site/ and the game into
// the tree and rewritten the wasm URL. Runs, in order, stopping at the first
// failure:
//   1. scripts/build-news.mjs news TREE        /news/, its feeds, the landing's latest post
//   2. scripts/prepare-pwa.mjs TREE/drive      the PWA shell and its precache inventory
// The news never touches /drive/, so the PWA inventory is the same either way;
// it runs last as before, on the finished game directory.
//
//   node scripts/stage-hook.mjs TREE
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [TREE] = process.argv.slice(2);
if (!TREE) { console.error("stage-hook: usage: stage-hook.mjs TREE"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
for (const [script, ...args] of [["build-news.mjs", "news", TREE], ["prepare-pwa.mjs", path.join(TREE, "drive")]]) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`stage-hook: ${script} failed (${r.status ?? r.signal})`); process.exit(1); }
}
