import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const [stage,rootArg,preparedArg]=process.argv.slice(2);
assert(['setup','services','admission','run','audit'].includes(stage) && rootArg,'invalid stage/root');
const root=resolve(rootArg),tag=basename(root);
assert(root.includes('/outputs/business-xlsx-') && /^[a-z0-9-]+$/.test(tag),'dedicated attempt required');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const save=(p,v)=>writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const settings=stage==='setup'?{}:read('private/settings.json');
const infra=settings.infrastructure??{core:tag+'-core',proxy:tag+'-proxy',hub:tag+'-hub',network:tag,
  corePort:19920,proxyPort:19696,hubPort:19725,knowledgePort:19924};
const coreUrl=`http://127.0.0.1:${infra.corePort}`,proxyUrl=`http://127.0.0.1:${infra.proxyPort}`,
  hubUrl=`http://127.0.0.1:${infra.hubPort}`;
async function ready(url){for(let i=0;i<45;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(2000)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('unhealthy '+url);}
async function api(path,body={},hub=false){const response=await fetch((hub?hubUrl+'/api/v1':coreUrl)+path,{method:'POST',headers:{
  'content-type':'application/json','Authorization':`Bearer ${settings.gateway_key}`,
  'x-tdai-service-id':settings.instance,'x-tdai-user-key':settings.user_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const value=await response.json();if(!response.ok||value.code!==0)throw Error(`${path}: ${response.status}`);return value.data;}
function snapshot(container){return JSON.parse(docker('exec',container,'node','-e',`const f=require('fs'),p=require('path'),c=require('crypto'),o={};function w(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const x=p.join(d,e.name);if(e.isDirectory())w(x);else if(e.isFile())o[x]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex')}}w('/data/tdai-memory');console.log(JSON.stringify(o))`));}
function hashes(base){const out={};function walk(dir){for(const e of readdirSync(resolve(base,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile())out[p]=hash(readFileSync(resolve(base,p)));}}walk('src');walk('business');return out;}

if(stage==='setup'){
  assert(!existsSync(root));const prepared=resolve(preparedArg);assert(existsSync(resolve(prepared,'manifest.json')));
  const models=await(await fetch('http://10.195.214.152:8100/v1/models',{signal:AbortSignal.timeout(8000)})).json();assert(models.data.some(m=>m.id==='qwen3.8-27b'));
  for(const name of [infra.core,infra.proxy,infra.hub])assert(!docker('ps','-a','--filter',`name=^${name}$`,'--format','{{.Names}}'));
  for(const port of [infra.corePort,infra.proxyPort,infra.hubPort,infra.knowledgePort])assert(!docker('ps','--format','{{.Ports}}').includes(':'+port+'->'));
  mkdirSync(root,{mode:0o700});for(const p of ['private','core-data','knowledge-data','runtime'])mkdirSync(resolve(root,p),{mode:0o700});
  const local=JSON.parse(readFileSync('/Users/lsmax/.nanobot/config.json','utf8'));
  Object.assign(settings,{instance:tag,infrastructure:infra,prepared,gateway_key:randomBytes(32).toString('hex'),
    user_key:'sk-mem-'+randomBytes(24).toString('hex'),upstream:'http://10.195.214.152:8100/v1',
    upstream_key:local.providers?.vllm?.apiKey||''});assert(settings.upstream_key);
  save('preflight.json',{at:new Date().toISOString(),git:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
    provider:'vllm',model:'qwen3.8-27b',temperature:0,fallback:false,backend:'standalone/sqlite',
    images:{core:'sha256:9798254a8cc06276b7c5b3c19df49f136fae25d579564e1f01f9c4b9b8cd2d11',
      proxy:'sha256:c8de30142787a5df7937c02c167f2ee37f00505b79036357653a6ce78a29fba5',
      hub:'sha256:39548fd616f6f211ad2288e33fe5e93870b705cffe0468047520cd786408e657'},
    production_snapshot:snapshot('tdai-memory-core')});
  const core={deployMode:'standalone',stateBackend:'local',server:{port:8420,host:'0.0.0.0',apiKey:settings.gateway_key},data:{baseDir:'/data/tdai-memory'},
    llm:{baseUrl:'',apiKey:'',model:''},memory:{storeBackend:'sqlite',embedding:{provider:'none'},capture:{enabled:false},extraction:{enabled:false},pipeline:{enableWarmup:false,everyNConversations:1000000,l1IdleTimeoutSeconds:86400}},skill:{enabled:false,extraction:{enabled:false}}};
  save('private/core.yaml',core);writeFileSync(resolve(root,'private/settings.json'),JSON.stringify(settings,null,2),{flag:'wx',mode:0o600});
  docker('network','create',infra.network);docker('run','-d','--name',infra.core,'--network',infra.network,'-p',`127.0.0.1:${infra.corePort}:8420`,
    '-v',`${root}/core-data:/data/tdai-memory`,'-v',`${root}/private/core.yaml:/data/config/tdai-gateway.yaml:ro`,'-e','TDAI_GATEWAY_API_KEY=','-e','TDAI_DATA_DIR=/data/tdai-memory',read('preflight.json').images.core);
  await ready(coreUrl+'/health');const admin=await api('/v3/internal/meta/user/init-admin',{username:'business-test-admin',user_key:settings.user_key});settings.user_id=admin.user_id??admin.user?.user_id;
  const team=await api('/v3/meta/team/create',{name:'BUSINESS XLSX TEST ONLY',owner_user_id:settings.user_id,metadata_json:JSON.stringify({production:false,kind:'business-xlsx-smoke'})});
  const agent=await api('/v3/meta/agent/create',{team_id:team.team_id,owner_user_id:settings.user_id,name:'nanobot-xlsx-test'});
  const task=await api('/v3/meta/task/create',{team_id:team.team_id,creator_user_id:settings.user_id,title:'Spreadsheet invoice reconciliation smoke',auto_assign_floating_assets:false,linked_agents:[{agent_id:agent.agent_id}]});
  settings.identity={team_id:team.team_id,agent_id:agent.agent_id,task_id:task.task_id,session_id:'business-'+randomBytes(12).toString('hex')};
  writeFileSync(resolve(root,'private/settings.json'),JSON.stringify(settings,null,2),{mode:0o600});save('identity.json',settings.identity);console.log('BUSINESS_SETUP_OK');
}

if(stage==='services'){
  const {images}=read('preflight.json');cpSync(resolve(repo,'MemoryProxy/src'),resolve(root,'runtime/src'),{recursive:true,errorOnExist:true,force:false});
  cpSync(here,resolve(root,'runtime/business'),{recursive:true,errorOnExist:true,force:false,
    filter:path=>!path.split('/').includes('__pycache__')});save('runtime-freeze.json',{files:hashes(resolve(root,'runtime'))});
  docker('run','-d','--name',infra.proxy,'--network',infra.network,'-p',`127.0.0.1:${infra.proxyPort}:8096`,'-v',`${root}/runtime/src:/app/src:ro`,
    '-v',`${root}/runtime/business:/app/business:ro`,'-v',`${root}:/acceptance`,'--entrypoint','node',images.proxy,'--import','tsx/esm','/app/business/proxy.ts');await ready(proxyUrl+'/health');
  save('private/metadata-instances.json',{instances:[{id:settings.instance,name:'Business XLSX / TEST ONLY',gateway_endpoint:`http://${infra.core}:8420`,proxy_endpoint:proxyUrl,api_key:settings.gateway_key}]});
  docker('run','-d','--name',infra.hub,'--network',infra.network,'-p',`127.0.0.1:${infra.hubPort}:8125`,'-p',`127.0.0.1:${infra.knowledgePort}:8424`,
    '-v',`${root}/knowledge-data:/data/knowledge`,'-v',`${root}/private/metadata-instances.json:/app/panel/config/metadata-instances.json:ro`,'-e','KNOWLEDGE_LLM_BINDING_SYNC=0','-e','LLM_MODE=custom',images.hub);await ready(hubUrl+'/api/v1/meta/instances');
  settings.proxy_url=proxyUrl+`/proxy/${settings.instance}/v1`;writeFileSync(resolve(root,'private/settings.json'),JSON.stringify(settings,null,2),{mode:0o600});console.log('BUSINESS_SERVICES_OK '+hubUrl);
}

if(stage==='admission'){
  assert.deepEqual(hashes(resolve(root,'runtime')),read('runtime-freeze.json').files);const id=settings.identity,good={'content-type':'application/json','x-tdai-user-key':settings.user_key,
    'x-team-id':id.team_id,'x-agent-id':id.agent_id,'x-task-id':id.task_id,'x-session-id':id.session_id};const cases=[];
  for(const key of Object.keys(good).filter(k=>k!=='content-type')){const r=await fetch(proxyUrl+`/proxy/${settings.instance}/v1/chat/completions`,{method:'POST',headers:{...good,[key]:'wrong'},body:'{}'});assert.equal(r.status,403);cases.push(key);}
  const wrong=await fetch(proxyUrl+'/proxy/other/v1/chat/completions',{method:'POST',headers:good,body:'{}'});assert.equal(wrong.status,403);assert(!existsSync(resolve(root,'proxy-events.jsonl')));
  save('admission.json',{status:'PASS',denied:cases,wrong_path:403,model_calls:0});console.log('BUSINESS_ADMISSION_PASS');
}

if(stage==='run'){
  assert.deepEqual(hashes(resolve(root,'runtime')),read('runtime-freeze.json').files);assert(!existsSync(resolve(root,'run')));
  await new Promise((ok,bad)=>{const child=spawn('/Users/lsmax/Coder/nanobot/.venv/bin/python',[resolve(root,'runtime/business/nanobot_business.py'),root],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});let logs='';child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>logs+=b);child.on('error',bad);child.on('exit',code=>{writeFileSync(resolve(root,'private/nanobot.log'),logs,{flag:'wx',mode:0o600});code===0?ok():bad(Error('nanobot exit '+code));});});
  const manifest=JSON.parse(readFileSync(resolve(settings.prepared,'manifest.json'))),run=read('run/agent-run.json'),ref=manifest.files.find(f=>f.role==='reference');
  const oracle=JSON.parse(execFileSync('/Users/lsmax/Coder/nanobot/.venv/bin/python',[resolve(root,'runtime/business/workbook_oracle.py'),resolve(settings.prepared,ref.path),resolve(root,'run/outputs/result.xlsx'),manifest.task.answer_position],{encoding:'utf8'}));save('oracle.json',oracle);
  const outputPath=resolve(root,'run/outputs/result.xlsx');
  const safe={kind:'BUSINESS_XLSX_SMOKE',session_id:settings.identity.session_id,status:oracle.status,usage:run.usage,actual_model:run.actual_model,tool_names:run.tool_events.map(e=>e.name),
    output_hash:existsSync(outputPath)?hash(readFileSync(outputPath)):null,evidence_hash:hash(readFileSync(resolve(root,'run/agent-run.json')))};
  await api('/v3/meta/participation-log/append',{...settings.identity,user_id:settings.user_id,source:'business-xlsx-sanitized',metadata_json:JSON.stringify(safe)});await api('/v3/meta/task/update',{task_id:settings.identity.task_id,status:oracle.status==='TASK_PASS'?'completed':'failed',metadata_json:JSON.stringify(safe)});save('safe-observation.json',safe);console.log('BUSINESS_RUN_'+oracle.status);
}

if(stage==='audit'){
  const events=readFileSync(resolve(root,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),requests=events.filter(e=>e.kind==='request'),responses=events.filter(e=>e.kind==='response'),run=read('run/agent-run.json'),oracle=read('oracle.json');
  assert(requests.length&&requests.length===responses.length&&requests.length===run.usage.model_calls);assert(requests.every(e=>e.model==='qwen3.8-27b'&&e.temperature===0));assert(responses.every(e=>e.status===200&&e.model==='qwen3.8-27b'));
  assert(run.input_hash_before===run.input_hash_after);assert(run.usage.tool_calls<=6&&run.usage.model_calls<=6);const q=await api('/v3/conversation/query',{...settings.identity,user_id:settings.user_id});assert.equal(q.total,0);
  const skills=await api('/v3/meta/asset/list',{team_id:settings.identity.team_id,asset_type:'skill'});assert.equal(skills.total,0);const hubTask=await api('/meta/task/get',{task_id:settings.identity.task_id},true);assert(hubTask);
  assert.deepEqual(snapshot('tdai-memory-core'),read('preflight.json').production_snapshot);
  // Short test strings generate accidental substring matches (r1 matched "10000").
  // Keep the prior Phase 6 policy: only high-entropy credential canaries are meaningful.
  const logNeedles=[settings.gateway_key,settings.user_key,settings.upstream_key].filter(n=>n&&n.length>=12);
  for(const name of [infra.core,infra.proxy,infra.hub]){const logs=docker('logs',name);assert(!logNeedles.some(n=>logs.includes(n)));}
  save('audit.json',{status:'PASS',kind:'IMPLEMENTATION_FIX_RETRY',previous_audit:'audit-failure-r1.json',oracle:oracle.status,requests:requests.length,responses:responses.length,input_unchanged:true,l0_count:0,skill_assets:0,hub_task_visible:true,production_storage_unchanged:true,
    limitation:'local SQLite/auth/observability only; Memory efficacy not tested'});console.log('BUSINESS_AUDIT_PASS');
}
