// The standard test runtime resolves ../lib beside its own executable.
// Stage built dependency bootstrap artifacts and exact installed sources
// there; no compiler/dependency rebuild. Core requires its compiled stage2.
import fs from "node:fs";
import path from "node:path";

const run=path.resolve(process.argv[2]);
const destination=path.join(run,"harness");
fs.mkdirSync(path.join(destination,"bin"),{recursive:true});
fs.copyFileSync("build/release/bin/signal-live-ice-test",path.join(destination,"bin/signal-live-ice-test"));
fs.chmodSync(path.join(destination,"bin/signal-live-ice-test"),0o755);
let modules=0;
function stage(directory,relative="",compiled=false,project=false) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const source=path.join(directory,entry.name),name=path.join(relative,entry.name);
    if (entry.isDirectory()) stage(source,name,compiled,project);
    else if (compiled || entry.name.endsWith(".sgl")) {
      const target=path.join(destination,"lib",name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      if (project) {
        // Test current application code, retaining dependency stage2 caches.
        const base=target.slice(0,-4);
        for (const suffix of [".sgb",".sgs",".sgb.sgci",".json"])
          fs.rmSync(base+suffix,{force:true});
      }
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.symlinkSync(fs.realpathSync(source),target);
      modules++;
    }
  }
}
stage("build/release/lib","",true);
for (const name of fs.readdirSync(".sigil/deps").sort()) {
  const source=path.join(".sigil/deps",name,"src");
  if (fs.existsSync(source)) stage(source);
}
stage("src","",false,true);
console.log(JSON.stringify({harness:destination,modules,policy:"standard native runner, exact installed sources"}));
