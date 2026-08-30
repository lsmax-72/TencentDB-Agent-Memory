import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hash, observation } from './acceptance-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here,'../..');
const [stage, rootArg] = process.argv.slice(2);
if (!['setup','storage','services','security','restart','normal','evaluation','audit','hub-check'].includes(stage) || !rootArg) {
  throw new Error('Usage: node scripts/phase6/acceptance.mjs <stage> <NEW absolute output dir>');
}
const root = resolve(rootArg);
if (!root.includes('/outputs/phase6-') || root === repo) throw new Error('Dedicated output path required');
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const read = p => JSON.parse(readFileSync(resolve(root,p),'utf8'));
const save = (p,v) => writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const settings = stage === 'setup' ? {} : read('private/settings.json');
const secure = stage === 'setup' ? process.argv[4] === '--secure' : !!settings.gateway_key;
const tag = basename(root);
assert(/^[a-z0-9-]+$/.test(tag),'Output basename must be a safe test identifier');
const infra = settings.infrastructure ?? (secure ? {
  core:tag+'-core',proxy:tag+'-proxy',hub:tag+'-hub',network:tag,
  corePort:19420,proxyPort:19096,hubPort:19125,knowledgePort:19424,
} : {core:'phase6-core',proxy:'phase6-proxy',hub:'phase6-hub',network:'phase6-acceptance',
  corePort:18420,proxyPort:18096,hubPort:18125,knowledgePort:18424});
const coreUrl = `http://127.0.0.1:${infra.corePort}`;
const proxyUrl = `http://127.0.0.1:${infra.proxyPort}`;
const hubUrl = `http://127.0.0.1:${infra.hubPort}`;
const persistSettings = () => writeFileSync(resolve(root,'private/settings.json'),JSON.stringify(settings,null,2),{mode:0o600});
async function api(path, body={}, hub=false) {
  const response = await fetch((hub?hubUrl+'/api/v1':coreUrl)+path,{
    method:'POST',headers:{'content-type':'application/json','Authorization':`Bearer ${settings.gateway_key || 'isolated-local-only'}`,'x-tdai-service-id':settings.instance,
      'x-tdai-user-key':settings.user_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const value = await response.json();
  if (!response.ok || value.code !== 0) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(value)}`);
  return value.data;
}
async function ready(url) {
  for (let i=0;i<45;i++) {
    try {if ((await fetch(url,{signal:AbortSignal.timeout(2000)})).ok) return;} catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error(`Unhealthy: ${url}`);
}
function snapshot(container) {
  // Read-only content digests, including WAL: never export formal data or credentials.
  return JSON.parse(docker('exec',container,'node','-e',`
    const fs=require('fs'),p=require('path'),c=require('crypto');const out={};
    function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
      const path=p.join(dir,f.name);if(f.isDirectory())walk(path);else if(f.isFile())
      out[path]=c.createHash('sha256').update(fs.readFileSync(path)).digest('hex');}}
    walk('/data/tdai-memory');process.stdout.write(JSON.stringify(out));`));
}
function identity(run) {return {team_id:run.team_id,agent_id:run.agent_id,user_id:settings.user_id,task_id:run.task_id,session_id:run.session_id};}
function runtimeHashes(base) {
  const out={};
  function walk(dir) { for(const entry of readdirSync(resolve(base,dir),{withFileTypes:true})) {
    const p=dir+'/'+entry.name;
    if(entry.isDirectory()) walk(p); else if(entry.isFile()) out[p]=hash(readFileSync(resolve(base,p)));
  }}
  walk('src');walk('phase6');return out;
}

if (stage === 'setup') {
  assert(!existsSync(root),'Never overwrite an attempt');
  const models = await (await fetch('http://10.195.214.152:8100/v1/models',{signal:AbortSignal.timeout(8000)})).json();
  assert(models.data.some(m=>m.id==='qwen3.8-27b'));
  for (const name of [infra.core,infra.proxy,infra.hub]) {
    assert(!docker('ps','-a','--filter',`name=^${name}$`,'--format','{{.Names}}'),`${name} exists: retain it, choose consciously`);
  }
  mkdirSync(root,{mode:0o700});
  for (const sub of ['private','core-data','knowledge-data']) mkdirSync(resolve(root,sub),{mode:0o700});
  const images = Object.fromEntries(['core','proxy','hub'].map((n,i)=>[n,docker('inspect',
    ['tdai-memory-core','tdai-proxy','tdai-memory-hub'][i],'--format','{{.Image}}')]));
  save('preflight.json',{at:new Date().toISOString(),images,backend:'standalone/local/sqlite',
    provider:'vllm',model:'qwen3.8-27b',temperature:0,fallback:false,
    git:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
    production_core_snapshot:snapshot('tdai-memory-core')});
  const localConfig = JSON.parse(readFileSync('/Users/lsmax/.nanobot/config.json','utf8'));
  Object.assign(settings,{instance:secure?tag:'phase6-acceptance',infrastructure:infra,security_profile:secure?'gateway-bearer-v1':'legacy-local',
    gateway_key:secure?randomBytes(32).toString('hex'):'',user_key:'sk-mem-'+randomBytes(24).toString('hex'),
    upstream:'http://10.195.214.152:8100/v1',upstream_key:localConfig.providers?.vllm?.apiKey || '',
    evaluation_skill:'Use the provided local tools, preserve the input and stop after completing the requested copy.\nISOLATION_SKILL_'+randomBytes(16).toString('hex'),runs:[]});
  persistSettings();
  const coreConfig = {deployMode:'standalone',stateBackend:'local',server:{port:8420,host:'0.0.0.0',apiKey:settings.gateway_key},
    data:{baseDir:'/data/tdai-memory'},llm:{baseUrl:'',apiKey:'',model:''},
    memory:{storeBackend:'sqlite',embedding:{provider:'none'},capture:{enabled:true},extraction:{enabled:false},
      pipeline:{enableWarmup:false,everyNConversations:1000000,l1IdleTimeoutSeconds:86400}},
    skill:{enabled:false,extraction:{enabled:false}}};
  save('private/core.yaml',coreConfig); // JSON is valid YAML.
  if (!docker('network','ls','--filter',`name=^${infra.network}$`,'--format','{{.Name}}')) {
    docker('network','create',infra.network);
  }
  docker('run','-d','--name',infra.core,'--network',infra.network,
    '-p',`127.0.0.1:${infra.corePort}:8420`,'-v',`${root}/core-data:/data/tdai-memory`,
    '-v',`${root}/private/core.yaml:/data/config/tdai-gateway.yaml:ro`,
    '-e','TDAI_GATEWAY_API_KEY=','-e','TDAI_DATA_DIR=/data/tdai-memory',images.core);
  await ready(coreUrl+'/health');
  const admin = await api('/v3/internal/meta/user/init-admin',{username:'phase6-test-admin',user_key:settings.user_key});
  settings.user_id = admin.user_id ?? admin.user?.user_id;
  assert(settings.user_id,'Missing admin identity');persistSettings();
  for (const mode of ['normal','evaluation']) {
    const team = await api('/v3/meta/team/create',{name:`PHASE6 TEST ONLY / ${mode}`,owner_user_id:settings.user_id,
      metadata_json:JSON.stringify({phase:6,namespace:mode,production:false})});
    const agent = await api('/v3/meta/agent/create',{team_id:team.team_id,owner_user_id:settings.user_id,name:`nanobot-${mode}`});
    const task = await api('/v3/meta/task/create',{team_id:team.team_id,creator_user_id:settings.user_id,
      title:`PHASE6 ${mode} integration acceptance`,auto_assign_floating_assets:false,linked_agents:[{agent_id:agent.agent_id}]});
    settings.runs.push({mode,team_id:team.team_id,agent_id:agent.agent_id,task_id:task.task_id,
      session_id:`phase6-${mode}-${randomBytes(8).toString('hex')}`,
      fixture:(mode==='evaluation'?'ISOLATION_FIXTURE_':'NORMAL_SMOKE_')+randomBytes(16).toString('hex')+'\n'});
    persistSettings();
  }
  save('identities.json',{instance:settings.instance,user_id:settings.user_id,
    runs:settings.runs.map(({fixture,...rest})=>rest)});
  console.log('SETUP_OK; isolated Core ready; production mounts untouched');
}

if (stage === 'storage') {
  const run = settings.runs[0];
  const id = {...identity(run),session_id:'phase6-disposable-crud'};
  const marker = 'storageproof'+randomBytes(8).toString('hex');
  const events=[];
  let disposableTask;
  try {
    events.push(await api('/v3/conversation/add',{...id,messages:[{role:'user',content:marker}]}));
    const queried = await api('/v3/conversation/query',id);
    assert(queried.messages.some(m=>m.content===marker));
    const searched = await api('/v3/conversation/search',{...id,query:marker});
    assert(searched.messages.some(m=>m.content===marker));
    events.push({read:true,search:true});
    // L0 is an immutable conversation log. Exercise updates through mutable
    // metadata, not /scenario/write (which only updates already extracted L2).
    disposableTask=await api('/v3/meta/task/create',{team_id:run.team_id,creator_user_id:settings.user_id,
      title:marker,auto_assign_floating_assets:false});
    await api('/v3/meta/task/update',{task_id:disposableTask.task_id,title:'updated '+marker});
    const updated=await api('/v3/meta/task/get',{task_id:disposableTask.task_id});
    assert.equal(updated.title,'updated '+marker);
    events.push({metadata_task_created:true,metadata_updated_read:true});
  } catch(error) {
    events.push({error:String(error)});throw error;
  } finally {
    await api('/v3/conversation/delete',{...id,session_ids:[id.session_id]});
    if(disposableTask) await api('/v3/meta/task/delete',{task_ids:[disposableTask.task_id]});
    const after=await api('/v3/conversation/query',id);
    assert.equal(after.total,0);
    const tasks=await api('/v3/meta/task/list',{team_id:run.team_id,limit:100});
    assert(!tasks.items.some(t=>t.task_id===disposableTask?.task_id));
    events.push({deleted:true,cleanup_verified:true});
    save(`storage-${Date.now()}.json`,events);
  }
  console.log('STORAGE_CRUD_SEARCH_CLEANUP_PASS');
}

if (stage === 'services') {
  const {images} = read('preflight.json');
  // Materialize immutable runtime evidence; later working-tree changes cannot
  // silently alter a running attempt or its restart behavior.
  mkdirSync(resolve(root,'runtime'),{mode:0o700});
  cpSync(resolve(repo,'MemoryProxy/src'),resolve(root,'runtime/src'),{recursive:true,errorOnExist:true,force:false});
  cpSync(here,resolve(root,'runtime/phase6'),{recursive:true,errorOnExist:true,force:false});
  save('runtime-freeze.json',{files:runtimeHashes(resolve(root,'runtime'))});
  docker('run','-d','--name',infra.proxy,'--network',infra.network,
    '-p',`127.0.0.1:${infra.proxyPort}:8096`,'-v',`${root}/runtime/src:/app/src:ro`,
    '-v',`${root}/runtime/phase6:/app/phase6:ro`,'-v',`${root}:/acceptance`,
    '--entrypoint','node',images.proxy,'--import','tsx/esm','/app/phase6/proxy.ts');
  await ready(proxyUrl+'/health');
  save('private/metadata-instances.json',{instances:[{id:settings.instance,name:'Phase 6 / TEST ONLY',
    gateway_endpoint:`http://${infra.core}:8420`,proxy_endpoint:proxyUrl,api_key:settings.gateway_key || 'isolated-local-only'}]});
  docker('run','-d','--name',infra.hub,'--network',infra.network,
    '-p',`127.0.0.1:${infra.hubPort}:8125`,'-p',`127.0.0.1:${infra.knowledgePort}:8424`,
    '-v',`${root}/knowledge-data:/data/knowledge`,
    '-v',`${root}/private/metadata-instances.json:/app/panel/config/metadata-instances.json:ro`,
    '-e','KNOWLEDGE_LLM_BINDING_SYNC=0','-e','LLM_MODE=custom',images.hub);
  await ready(hubUrl+'/api/v1/meta/instances');
  const instances=await (await fetch(hubUrl+'/api/v1/meta/instances')).json();
  save('hub-instances.json',instances);
  console.log(`SERVICES_OK ${hubUrl} (independent Hub)`);
}

if (stage === 'security') {
  assert(secure,'Security acceptance requires --secure setup');
  assert(!existsSync(resolve(root,'security.json')),'Preserve security evidence');
  const cases=[];
  for(const [label,key,userKey,expected] of [
    ['missing-gateway',null,settings.user_key,401],
    ['empty-gateway','',settings.user_key,401],
    ['wrong-gateway','incorrect',settings.user_key,401],
    ['valid-gateway',settings.gateway_key,settings.user_key,200],
    ['wrong-user',settings.gateway_key,'incorrect',200],
  ]) {
    const headers={'content-type':'application/json','x-tdai-service-id':settings.instance};
    if(key!==null) headers.Authorization=`Bearer ${key}`;
    const resp=await fetch(coreUrl+'/v3/meta/auth/verify',{method:'POST',headers,
      body:JSON.stringify({user_key:userKey}),signal:AbortSignal.timeout(10000)});
    const body=await resp.json();
    assert.equal(resp.status,expected,label);
    if(label==='valid-gateway') assert(body.code===0 && body.data?.valid===true);
    if(label==='wrong-user') assert(body.data?.valid===false);
    cases.push({label,http:resp.status,valid:body.data?.valid??false});
  }
  const run=settings.runs[1];
  const good={'content-type':'application/json','x-tdai-user-key':settings.user_key,
    'x-session-id':run.session_id,'x-team-id':run.team_id,'x-agent-id':run.agent_id,'x-task-id':run.task_id};
  for(const key of ['x-tdai-user-key','x-session-id','x-team-id','x-agent-id','x-task-id','x-conversation-id']) {
    const resp=await fetch(proxyUrl+`/proxy/${settings.instance}/v1/chat/completions`,{
      method:'POST',headers:{...good,[key]:'incorrect'},body:'{}',signal:AbortSignal.timeout(10000)});
    assert.equal(resp.status,403,key);cases.push({label:`proxy-${key}`,http:resp.status});
  }
  // Admission rejections must not reach the real model at all.
  assert(!existsSync(resolve(root,'proxy-events.jsonl')));
  save('security.json',{status:'PASS',cases,upstream_calls:0,
    scope:'Gateway service credential plus test-proxy identity allowlist; not universal Core row-level ACL'});
  console.log('SECURITY_GATE_AND_IDENTITY_PASS');
}

if (stage === 'restart') {
  assert(secure && [infra.core,infra.proxy,infra.hub].every(n=>n.startsWith(tag+'-')),'Only this new secure test stack may restart');
  assert(!existsSync(resolve(root,'restart.json')),'Preserve restart evidence');
  const normal=settings.runs[0], evaluation=settings.runs[1];
  const marker='restartproof'+randomBytes(12).toString('hex');
  const id={...identity(normal),session_id:'phase6-restart-proof'};
  await api('/v3/conversation/add',{...id,messages:[{role:'user',content:marker}]});
  const evalAssets=await api('/v3/meta/asset/list',{team_id:evaluation.team_id,limit:100});
  docker('restart',infra.core,infra.proxy,infra.hub);
  await ready(coreUrl+'/health');await ready(proxyUrl+'/health');await ready(hubUrl+'/api/v1/meta/instances');
  const persisted=await api('/v3/conversation/query',id);
  assert(persisted.messages.some(m=>m.content===marker),'L0 lost across restart');
  const unboundName=tag+'-unbound';
  const {images}=read('preflight.json');
  // Independent fault process using the same frozen sources: no runtime admin
  // endpoint to mutate session bindings is introduced.
  docker('run','-d','--name',unboundName,'--network',infra.network,
    '-p',`127.0.0.1:${infra.proxyPort+1}:8096`,
    '-v',`${root}/runtime/src:/app/src:ro`,'-v',`${root}/runtime/phase6:/app/phase6:ro`,
    '-v',`${root}:/acceptance`,'-e','PHASE6_SKIP_EVALUATION_BINDING=1',
    '--entrypoint','node',images.proxy,'--import','tsx/esm','/app/phase6/proxy.ts');
  const unboundUrl=`http://127.0.0.1:${infra.proxyPort+1}`;
  const statuses=[];
  try {
    for(let i=0;i<2;i++) {
      if(i) docker('restart',unboundName);
      await ready(unboundUrl+'/health');
      const resp=await fetch(unboundUrl+`/proxy/${settings.instance}/v1/chat/completions`,{
        method:'POST',headers:{'content-type':'application/json','x-tdai-user-key':settings.user_key,
          'x-session-id':evaluation.session_id,'x-team-id':evaluation.team_id,
          'x-agent-id':evaluation.agent_id,'x-task-id':evaluation.task_id},
        body:JSON.stringify({model:'qwen3.8-27b',messages:[{role:'user',content:settings.evaluation_skill+'\n'+evaluation.fixture}]}),
        signal:AbortSignal.timeout(10000)});
      statuses.push(resp.status);assert.equal(resp.status,403,'Lost binding must not downgrade to normal');
    }
    assert(!existsSync(resolve(root,'proxy-events.jsonl')),'Unbound request reached provider');
    assert.equal((await api('/v3/conversation/query',identity(evaluation))).total,0);
    assert.deepEqual(await api('/v3/meta/asset/list',{team_id:evaluation.team_id,limit:100}),evalAssets);
  } finally {
    docker('stop',unboundName); // Exact newly-created fault container; retained, not deleted.
    await api('/v3/conversation/delete',{...id,session_ids:[id.session_id]});
  }
  assert.equal((await api('/v3/conversation/query',id)).total,0);
  save('restart.json',{status:'PASS',normal_l0_persisted:true,temporary_record_cleaned:true,
    evaluation_unbound_http:statuses,evaluation_l0:0,evaluation_assets_unchanged:true,
    unbound_container:unboundName,upstream_calls:0,
    rebinding:'Trusted settings rebound by the main proxy on restart; verified by subsequent real evaluation smoke'});
  console.log('RESTART_PERSISTENCE_AND_UNBOUND_FAIL_CLOSED_PASS');
}

if (stage === 'normal' || stage === 'evaluation') {
  const sourceFiles=['scripts/phase6/nanobot_smoke.py','scripts/phase6/proxy.ts','scripts/phase6/acceptance-lib.mjs',
    'scripts/phase6/acceptance.mjs','MemoryProxy/src/auth.ts','MemoryProxy/src/config.ts','MemoryProxy/src/types.ts',
    'MemoryProxy/src/handler.ts','MemoryProxy/src/injection/pipeline.ts',
    'MemoryProxy/src/injection/injectors/evaluation-skill-override.ts'];
  assert.deepEqual(runtimeHashes(resolve(root,'runtime')),read('runtime-freeze.json').files,'Runtime changed');
  for(const [p,digest] of Object.entries(read('runtime-freeze.json').files)) {
    const local=p.startsWith('src/')?resolve(repo,'MemoryProxy',p):resolve(here,p.slice('phase6/'.length));
    assert.equal(hash(readFileSync(local)),digest,`Working source differs from frozen runtime: ${p}`);
  }
  const sourceHashes=Object.fromEntries(sourceFiles.map(p=>[p,hash(readFileSync(resolve(repo,p)))]));
  if(!existsSync(resolve(root,'source-freeze.json'))) {
    save('source-freeze.json',{at:new Date().toISOString(),files:sourceHashes,
      nanobot_revision:execFileSync('git',['rev-parse','HEAD'],{cwd:'/Users/lsmax/Coder/nanobot',encoding:'utf8'}).trim()});
  } else assert.deepEqual(sourceHashes,read('source-freeze.json').files,'Run sources changed after normal smoke');
  const run = settings.runs.find(r=>r.mode===stage);
  assert(!existsSync(resolve(root,stage)),'Preserve old run; no overwrite');
  const before=await api('/v3/meta/asset/list',{team_id:run.team_id,limit:100});
  save(stage+'-assets-before.json',before);
  await new Promise((res,rej)=>{
    const child=spawn('/Users/lsmax/Coder/nanobot/.venv/bin/python',[resolve(here,'nanobot_smoke.py'),root,stage],
      {stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
    let logs='';child.stdout.on('data',b=>{process.stdout.write(b);});
    child.stderr.on('data',b=>{logs+=b;});
    child.on('error',rej);child.on('exit',code=>{
      writeFileSync(resolve(root,stage+'-nanobot.log'),logs,{flag:'wx',mode:0o600});
      code===0?res():rej(new Error(`nanobot exit ${code}; inspect private local log`));
    });
  });
  const result = read(stage+'/run.json');
  const safe = observation(result,run.session_id);
  assert(result.oracle_pass,'Real filesystem oracle failed; preserve run');
  await api('/v3/meta/participation-log/append',{...identity(run),source:'phase6-sanitized-observability',metadata_json:JSON.stringify(safe)});
  await api('/v3/meta/task/update',{task_id:run.task_id,status:'completed',metadata_json:JSON.stringify(safe)});
  const query=await api('/v3/conversation/query',identity(run));
  if(stage==='normal') assert(query.total>0,'No real L0 captured');
  else assert.equal(query.total,0,'Evaluation must not write L0');
  const hubTask=await api('/meta/task/get',{task_id:run.task_id},true);
  const hubLogs=await api('/meta/participation-log/list',{team_id:run.team_id,task_id:run.task_id},true);
  const after=await api('/v3/meta/asset/list',{team_id:run.team_id,limit:100});
  if(stage==='evaluation') assert.deepEqual(after,before,'Evaluation created/modified asset');
  save(stage+'-visibility.json',{safe,l0:query,hubTask,hubLogs,assets_after:after});
  console.log(`${stage.toUpperCase()}_ORACLE_AND_HUB_PASS`);
}

if (stage === 'audit') {
  const events=readFileSync(resolve(root,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const requests=events.filter(e=>e.kind==='request'),responses=events.filter(e=>e.kind==='response');
  const normal=read('normal/run.json'),evaluation=read('evaluation/run.json');
  assert.equal(requests.length,responses.length,'Incomplete upstream response evidence');
  assert(requests.every(e=>e.model==='qwen3.8-27b' && e.temperature===0));
  assert(responses.every(e=>e.status===200 && e.model==='qwen3.8-27b'),'Actual provider response/model differs');
  assert(new Set(requests.map(e=>e.call_id)).size===requests.length,'Duplicate request IDs');
  for(const request of requests) {
    assert.equal(responses.filter(e=>e.call_id===request.call_id && e.session_id===request.session_id).length,1,'Unmatched response');
  }
  for(const run of [normal,evaluation]) {
    const calls=requests.filter(e=>e.session_id===run.session_id);
    assert.equal(calls.length,run.model_calls,'Host iterations differ from real requests; preserve evidence');
    const completed=responses.filter(e=>e.session_id===run.session_id);
    for(const key of ['prompt_tokens','completion_tokens','total_tokens']) {
      assert.equal(completed.reduce((n,e)=>n+e.usage[key],0),run.usage[key],'Usage mismatch');
    }
  }
  assert.equal(requests.filter(e=>e.evaluation_skill_present).length,evaluation.model_calls);
  const denied=[];
  const run=settings.runs[1];
  for(const path of ['/proxy/default/v1/chat/completions','/skill-bridge/write',`/proxy/${settings.instance}/v1/chat/completions`]) {
    const response=await fetch(proxyUrl+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,403);denied.push({path,status:response.status});
  }
  for(const r of settings.runs){
    const skills=await api('/v3/meta/asset/list',{team_id:r.team_id,asset_type:'skill'});
    assert.equal(skills.total,0);
  }
  const evaluationL0=await api('/v3/conversation/query',identity(run));assert.equal(evaluationL0.total,0);
  // Include on-disk pages/WAL, not just search results, in the canary audit.
  const needles=[settings.evaluation_skill.split('\n').at(-1),run.fixture.trim()];
  const scan = JSON.parse(execFileSync('docker',['exec','-i',infra.core,'node','-e',`
    const fs=require('fs'),p=require('path'),needles=JSON.parse(fs.readFileSync(0,'utf8')),hits=[];
    function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
      const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile()){
      const b=fs.readFileSync(f);if(needles.some(n=>b.includes(Buffer.from(n))))hits.push(f);}}}
    walk('/data/tdai-memory');console.log(JSON.stringify(hits));`],{input:JSON.stringify(needles),encoding:'utf8'}));
  assert.deepEqual(scan,[],'Evaluation canary leaked into Core');
  const logContainers=[infra.core,infra.proxy,infra.hub];
  if(existsSync(resolve(root,'restart.json'))) logContainers.push(read('restart.json').unbound_container);
  const logNeedles=[...needles,settings.gateway_key,settings.user_key,settings.upstream_key].filter(n=>n && n.length>=12);
  for(const name of logContainers){
    const logged=spawnSync('docker',['logs',name],{encoding:'utf8',maxBuffer:16*1024*1024});
    assert.equal(logged.status,0);
    const logs=logged.stdout+logged.stderr;
    assert(!logNeedles.some(n=>logs.includes(n)),`${name} logged raw canary or credential`);
  }
  const formalAfter=snapshot('tdai-memory-core');
  assert.deepEqual(formalAfter,read('preflight.json').production_core_snapshot,'Formal storage changed; do not claim unchanged');
  save('audit.json',{at:new Date().toISOString(),status:'PASS',denied,upstream_events:events,
    production_files_unchanged:true,production_file_count:Object.keys(formalAfter).length,
    evaluation_l0_count:0,skill_assets:0,canary_disk_hits:scan,
    raw_evidence_location:'Local private attempt only; no raw evidence imported into Hub',
    limitation:'Standalone SQLite, not cloud TencentDB; no embedding/vector or L1 extraction acceptance'});
  console.log('ISOLATION_AUDIT_PASS');
}

if (stage === 'hub-check') {
  const evidence=[];
  for(const run of settings.runs) {
    const assets=await api('/meta/asset/list',{team_id:run.team_id,asset_type:'chat_memory',limit:100},true);
    const asset=assets.items.find(a=>a.asset_id===`chat_memory-${run.team_id}-${run.agent_id}`);
    assert(asset,'Hub cannot find test Agent memory asset');
    const layer=await api('/chat-memory/layer',{block_id:asset.asset_id,layer:'L0',limit:100},true);
    const core=await api('/v3/conversation/query',identity(run));
    assert.equal(layer.total,core.total,'Hub L0 differs from Core');
    if(run.mode==='evaluation') assert.equal(layer.total,0);
    else assert(layer.total>0);
    evidence.push({mode:run.mode,asset_id:asset.asset_id,hub_l0:layer,core_count:core.total});
  }
  save('hub-layers.json',evidence);
  // A separate test-only login credential file avoids opening upstream configuration in the UI.
  writeFileSync(resolve(root,'private/hub-user-key.txt'),settings.user_key+'\n',{flag:'wx',mode:0o600});
  console.log('HUB_MEMORY_LAYERS_PASS');
}
