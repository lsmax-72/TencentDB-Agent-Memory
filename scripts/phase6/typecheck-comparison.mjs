/** Compare current diagnostics with pre-change HEAD using the same pinned runtime. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root=resolve(process.argv[2]);
const repo=resolve(import.meta.dirname,'../..');
const dir=resolve(root,'typecheck');
mkdirSync(dir);
const image=JSON.parse(readFileSync(resolve(root,'preflight.json'))).images.proxy;
const changed=['handler.ts','injection/pipeline.ts'];
const mounts=[];
for(const [i,path] of changed.entries()) {
  // Mechanical baseline materialization: current working tree is never changed.
  const baseline=execFileSync('git',['show',`HEAD:MemoryProxy/src/${path}`],{cwd:repo});
  const file=resolve(dir,`baseline-${i}.ts`);writeFileSync(file,baseline,{flag:'wx'});
  mounts.push('-v',`${file}:/app/src/${path}:ro`);
}
const normalized=text=>text.split('\n').filter(l=>/error TS\d+/.test(l))
  .map(l=>l.replace(/\(\d+,\d+\)/g,'(LINE)')).sort();
const outputs={};
for(const label of ['baseline','current']) {
  const command=['run','--name',`phase6-typecheck-${label}-${Date.now()}`,'--network','none',
    '-v',`${repo}/MemoryProxy/src:/app/src:ro`,...(label==='baseline'?mounts:[]),
    '--entrypoint','node',image,'node_modules/typescript/bin/tsc','--noEmit'];
  const result=spawnSync('docker',command,{encoding:'utf8',maxBuffer:4*1024*1024});
  const output=result.stdout+result.stderr;
  writeFileSync(resolve(dir,label+'.txt'),output,{flag:'wx'});
  outputs[label]={exit:result.status,diagnostics:normalized(output)};
}
assert.deepEqual(outputs.current,outputs.baseline,'New typecheck diagnostics introduced');
writeFileSync(resolve(dir,'comparison.json'),JSON.stringify({
  status:'NO_NEW_DIAGNOSTICS',baseline_errors:outputs.baseline.diagnostics.length,
  current_errors:outputs.current.diagnostics.length,full_typecheck_pass:outputs.current.exit===0,
},null,2),{flag:'wx'});
console.log(`NO_NEW_DIAGNOSTICS (${outputs.current.diagnostics.length} pre-existing errors)`);
