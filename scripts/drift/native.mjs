// Shared local test-process infrastructure. Each child is confined to
// at most two allowed CPUs at nice 15 in its own tracked process group.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function cachedTool(name, packagePrefix) {
  try { return execFileSync("sh", ["-c", 'command -v "$1"', "sh", name], { encoding: "utf8" }).trim(); }
  catch {
    const file = fs.readdirSync("/gnu/store").filter(entry => entry.includes(`-${packagePrefix}-`))
      .map(entry => `/gnu/store/${entry}/bin/${name}`).find(file => fs.existsSync(file));
    if (!file) throw new Error(`no cached ${name}; no package fetch is permitted`);
    return file;
  }
}

export function localProcesses(root) {
  const allowed = fs.readFileSync("/proc/self/status", "utf8")
    .match(/^Cpus_allowed_list:\s*([\d,-]+)/m)?.[1];
  if (!allowed) throw new Error("no allowed CPU");
  const ranges = allowed.split(",").map(part => part.split("-").map(Number));
  const cpu = process.env.CONDUCTOR_CPU_LIST || String(ranges[0][0]);
  const requested = cpu.split(",").map(Number);
  if (!/^\d+(,\d+)?$/.test(cpu) || requested.some(value =>
    !Number.isInteger(value) || !ranges.some(([lo, hi = lo]) => value >= lo && value <= hi)))
    throw new Error("test CPU list must contain at most two allowed CPUs");
  const children = new Set();
  function launch(command, args, options = {}) {
    const child = spawn("taskset", ["-c", cpu, "nice", "-n", "15", command, ...args],
      { cwd: root, detached: true, ...options });
    children.add(child);
    child.on("exit", () => children.delete(child));
    return child;
  }
  function stop(child, signal = "SIGTERM") {
    if (child && child.exitCode === null) {
      try { process.kill(-child.pid, signal); } catch { /* already exited */ }
    }
  }
  function cleanup() {
    for (const child of children) {
      stop(child, "SIGKILL");
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
    }
  }
  return { cpu, children, launch, stop, cleanup };
}

export async function privateDisplay(pool, run) {
  const xerr = fs.openSync(path.join(run, "xvfb.log"), "w");
  const child = pool.launch(cachedTool("Xvfb", "xorg-server"),
    ["-displayfd", "3", "-screen", "0", "1600x1000x24", "-nolisten", "tcp", "-noreset"],
    { stdio: ["ignore", "ignore", xerr, "pipe"] });
  fs.closeSync(xerr);
  let text = "";
  child.stdio[3].on("data", bytes => { text += bytes; });
  for (let i = 0; i < 100 && !/^\d+\s*$/.test(text); i++) {
    if (child.exitCode !== null) throw new Error("Xvfb exited");
    await sleep(50);
  }
  if (!/^\d+\s*$/.test(text)) throw new Error("Xvfb did not allocate a private display");
  return { display: `:${text.trim()}`, child };
}
