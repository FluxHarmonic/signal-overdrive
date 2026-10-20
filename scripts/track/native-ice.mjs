// Phantom-only active geometry proof on an isolated software-GL display.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {localProcesses,privateDisplay} from "../drift/native.mjs";

const run=path.resolve(process.argv[2]);
fs.mkdirSync(run,{recursive:true});
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;
const pool=localProcesses(process.cwd());
let log="";
const names=["empty","warning","firewall","drone","tracer","wake","cleared"];
for (const name of names) fs.rmSync(`build/ice-mesh-${name}.png`,{force:true});
const deadline=setTimeout(()=>pool.cleanup(),600000);
try {
  const {display}=await privateDisplay(pool,run);
  const harness=process.env.SIGIL_TEST_HARNESS;
  assert.ok(harness,"standard native runner must be staged first");
  const child=pool.launch(path.resolve("scripts/dev"),[path.resolve(harness),
    "--sgl","--no-strict","test/test-ice-draw.sgl"],
    {env:{...process.env,DISPLAY:display,SIGNAL_ICE_PRIVATE_DISPLAY:display,
      SIGIL_APP_PLATFORM:"x11",SIGIL_AUDIO_BACKEND:"null",
      XDG_SESSION_TYPE:"x11",LIBGL_ALWAYS_SOFTWARE:"1",LP_NUM_THREADS:"1",GALLIUM_DRIVER:"llvmpipe"},
      stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",data=>{log+=data;});
  child.stderr.on("data",data=>{log+=data;});
  const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});
  assert.equal(code,0,log.slice(-4000));
  assert.doesNotMatch(log,/Scheme error in frame|Error loading|FAIL:|shader.*error/i);
  assert.match(log,/NATIVE ICE TEST RUN: test-ice-draw:/);
  assert.doesNotMatch(log,/SKIP: requires staged SIGIL_TEST_HARNESS/);
  const captures=new Map();
  for (const name of names) {
    const bytes=fs.readFileSync(`build/ice-mesh-${name}.png`);
    assert.equal(bytes.subarray(1,4).toString(),"PNG");
    assert.equal(bytes.readUInt32BE(16),480);
    assert.equal(bytes.readUInt32BE(20),270);
    captures.set(name,bytes);
    fs.writeFileSync(path.join(run,`${name}.png`),bytes);
  }
  for (const name of ["warning","firewall","drone","tracer","wake"])
    assert.notDeepEqual(captures.get(name),captures.get("empty"),`${name} must draw visible geometry`);
  assert.notDeepEqual(captures.get("warning"),captures.get("firewall"),"telegraph and live state differ");
  assert.notDeepEqual(captures.get("drone"),captures.get("firewall"),"swarm bodies and standing wall differ");
  assert.deepEqual(captures.get("empty"),captures.get("cleared"),"clearing must remove the cached mesh");
  fs.writeFileSync(path.join(run,"RESULT"),"RESULT: active ICE graphical capture PASS; all kinds, warnings, cache replacement and clear\n");
} finally {
  clearTimeout(deadline);
  pool.cleanup();
  fs.writeFileSync(path.join(run,"game.log"),log);
}
