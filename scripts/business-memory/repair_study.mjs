/** New attempt/Proxy for an implementation retry, sharing only the immutable test memory. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const [rootArg,parentArg]=process.argv.slice(2),root=resolve(rootArg),parent=resolve(parentArg),tag=basename(root);
for(const path of [root,parent])assert(path.includes('/outputs/business-xlsx-memory-')&&/^[a-z0-9-]+$/.test(basename(path)));
assert(!existsSync(root));
const read=p=>JSON.parse(readFileSync(resolve(parent,p),'utf8'));
const save=(p,v)=>writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(readFileSync(resolve(parent,'memory-snapshot.json'))),read('memory-freeze.json').sha256);
const settings=read('private/settings.json'),oldInfra={...settings.infrastructure};
settings.infrastructure.proxy=tag+'-proxy';settings.infrastructure.proxyPort=23696;
settings.proxy_url=`http://127.0.0.1:23696/proxy/${settings.instance}/v1`;
assert(!execFileSync('docker',['ps','-a','--filter',`name=^${settings.infrastructure.proxy}$`,'--format','{{.Names}}'],{encoding:'utf8'}).trim());
assert(!execFileSync('docker',['ps','--format','{{.Ports}}'],{encoding:'utf8'}).includes(':23696->'));
mkdirSync(root,{mode:0o700});for(const p of ['private','runtime','runs'])mkdirSync(resolve(root,p),{mode:0o700});
save('private/settings.json',settings);
for(const p of ['prepared','runtime/packages','runtime/formation-sources'])cpSync(resolve(parent,p),resolve(root,p),{recursive:true,errorOnExist:true,force:false});
cpSync(resolve(here,'../../MemoryProxy/src'),resolve(root,'runtime/src'),{recursive:true});
cpSync(here,resolve(root,'runtime/business'),{recursive:true,filter:p=>!p.split('/').includes('__pycache__')});
for(const p of ['memory-snapshot.json','memory-freeze.json','formation-source-cost.json','memory-source-audit.json'])cpSync(resolve(parent,p),resolve(root,p),{errorOnExist:true,force:false});
const specs=read('runspecs.json');for(const spec of Object.values(specs)){
  spec.prepared=resolve(root,'prepared',spec.task_id);spec.identity.session_id='business-'+randomBytes(12).toString('hex');
}
save('runspecs.json',specs);save('preflight.json',read('preflight.json'));
save('attempt-lineage.json',{kind:'IMPLEMENTATION_FIX_RETRY',parent,parent_status:'INVALID_FAIRNESS',
  fix:'opaque random workspace path and captured complete pre-Proxy context',
  memory_snapshot_unchanged:read('memory-freeze.json').sha256,formation_rerun:false,
  infrastructure:'new test Proxy only; existing isolated formation Core/Hub used under same test team, with fresh sessions and no Memory writes',
  parent_infrastructure:oldInfra});
const python='/Users/lsmax/Coder/nanobot/.venv/bin/python';
const files=JSON.parse(execFileSync(python,['-c',"import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from study_contract import frozen_files;print(json.dumps(frozen_files(Path(sys.argv[2]))))",here,root],{encoding:'utf8'}));
save('study-freeze.json',{kind:'IMPLEMENTATION_FIX_RETRY',at:new Date().toISOString(),files,files_hash:hash(JSON.stringify(files)),
  protocol_hash:hash(readFileSync(resolve(root,'runtime/business/protocol-transfer-v1.json'))),
  parent_freeze:read('study-freeze.json').files_hash,memory_hash:read('memory-freeze.json').sha256});
execFileSync('docker',['run','-d','--name',settings.infrastructure.proxy,'--network',settings.infrastructure.network,
  '-p','127.0.0.1:23696:8096','-v',`${root}/runtime/src:/app/src:ro`,'-v',`${root}/runtime/business:/app/business:ro`,
  '-v',`${root}:/acceptance`,'--entrypoint','node',read('preflight.json').images.proxy,'--import','tsx/esm','/app/business/proxy.ts']);
let ready=false;for(let n=0;n<30;n++){try{ready=(await fetch('http://127.0.0.1:23696/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,1000));}assert(ready);
const spec=Object.values(specs)[0],url=settings.proxy_url+'/chat/completions';
const headers={'content-type':'application/json','x-tdai-user-key':settings.user_key,...Object.fromEntries(Object.entries(spec.identity).map(([k,v])=>['x-'+k.replaceAll('_','-'),v]))};
for(const h of Object.keys(headers).filter(h=>h!=='content-type'))assert.equal((await fetch(url,{method:'POST',headers:{...headers,[h]:'wrong'},body:'{}'})).status,403);
for(const h of ['x-session-key','x-tdai-session-id','x-tdai-session-key'])assert.equal((await fetch(url,{method:'POST',headers:{...headers,[h]:'wrong'},body:'{}'})).status,403);
assert.equal((await fetch('http://127.0.0.1:23696/formation/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${settings.extraction_key}`},body:'{}'})).status,403);
assert(!existsSync(resolve(root,'proxy-events.jsonl')));save('admission.json',{status:'PASS',negative_cases:9,model_calls:0});
console.log('RETRY_FROZEN '+hash(JSON.stringify(files)));
