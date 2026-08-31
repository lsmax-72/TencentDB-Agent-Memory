/** Local-only study orchestration. Each stage preserves evidence using exclusive writes. */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const [stage,rootArg]=process.argv.slice(2),root=resolve(rootArg??'.');
assert(root.includes('/phase6-artifacts/outputs/business-xlsx-memory-')&&/^[a-z0-9-]+$/.test(basename(root)));
const python='/Users/lsmax/Coder/nanobot/.venv/bin/python';
const archive='/Users/lsmax/Coder/phase6-artifacts/outputs/business-preflight-uo9rAx68/verified-proxy.tar.gz';
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const save=(p,v)=>writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const hash=v=>createHash('sha256').update(v).digest('hex');
const sha=p=>hash(readFileSync(p));
const protocol=JSON.parse(readFileSync(resolve(stage==='init'?here:resolve(root,'runtime/business'),'protocol-transfer-v1.json')));
let settings;
async function api(path,body={},hub=false){
  const r=await fetch(`http://127.0.0.1:${hub?settings.infrastructure.hubPort:settings.infrastructure.corePort}${hub?'/api/v1':''}${path}`,{
    method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${settings.gateway_key}`,
      'x-tdai-service-id':settings.instance,'x-tdai-user-key':settings.user_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const v=await r.json();assert(r.ok&&v.code===0,`${path}: HTTP ${r.status} code ${v.code}`);return v.data;
}
const scope=()=>({team_id:settings.identity.team_id,user_id:settings.user_id,agent_id:settings.identity.agent_id});
const events=()=>existsSync(resolve(root,'proxy-events.jsonl'))?readFileSync(resolve(root,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
async function command(binary,args,log){
  await new Promise((ok,bad)=>{let text='';const c=spawn(binary,args,{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'}});
    c.stdout.on('data',b=>text+=b);c.stderr.on('data',b=>text+=b);c.on('error',bad);c.on('exit',code=>{
      if(log)writeFileSync(resolve(root,log),text,{flag:'wx',mode:0o600});
      code===0?ok():bad(Error(`${basename(binary)} exit ${code}; see ${log}`));});});
}
function verify(){
  execFileSync(python,['-c',"import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from study_contract import verify_freeze;verify_freeze(Path(sys.argv[2]))",resolve(root,'runtime/business'),root],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
}
function stableRows(items){return JSON.stringify(items.map(r=>({id:r.id,content:r.content,type:r.type,version:r.version})).sort((a,b)=>a.id.localeCompare(b.id)));}
function classify(a,b){if([a,b].includes('INFRA_ERROR'))return'incomparable';return a==='TASK_PASS'?(b==='TASK_PASS'?'unchanged_success':'newly_broken'):(b==='TASK_PASS'?'newly_fixed':'unchanged_failure');}
function totals(rows){return Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','model_calls','tool_calls'].map(k=>[k,rows.every(r=>Number.isInteger(r.usage?.[k]))?rows.reduce((s,r)=>s+r.usage[k],0):null]));}

if(stage==='init'){
  assert(!existsSync(root)&&!existsSync(root+'-prepared'));
  mkdirSync(root+'-prepared',{mode:0o700});
  for(const id of [...protocol.formation_tasks,...protocol.transfer_tasks]){
    execFileSync(python,[resolve(here,'preflight.py'),archive,root+'-prepared/'+id,'--task-id',id]);
    const m=JSON.parse(readFileSync(root+'-prepared/'+id+'/manifest.json'));
    assert(m.files.every(f=>!f.inspection.requires_recalculation));
  }
  const opts=root+'-prepared/setup.json';
  const revision=Number(basename(root).match(/-r([1-9][0-9]*)$/)?.[1]);assert(revision>=1&&revision<10);
  const base=19000+revision*1000;
  writeFileSync(opts,JSON.stringify({ports:{corePort:base+920,proxyPort:base+696,hubPort:base+725,knowledgePort:base+924}}),{flag:'wx',mode:0o600});
  execFileSync('node',[resolve(here,'acceptance.mjs'),'setup',root,root+'-prepared/'+protocol.formation_tasks[0],opts],{stdio:'pipe'});
  settings=read('private/settings.json');
  if(process.argv[4]==='producer-v2'){
    settings.memory_producer='business-memory-producer-v2';
    writeFileSync(resolve(root,'private/settings.json'),JSON.stringify(settings,null,2),{mode:0o600});
  }
  cpSync(root+'-prepared',resolve(root,'prepared'),{recursive:true,errorOnExist:true,force:false});
  const specs={};
  for(const id of [...protocol.formation_tasks,...protocol.transfer_tasks]){
    const task=await api('/v3/meta/task/create',{team_id:settings.identity.team_id,creator_user_id:settings.user_id,
      title:`Memory research / ${protocol.formation_tasks.includes(id)?'formation':'transfer'} / ${id}`,
      auto_assign_floating_assets:false,linked_agents:[{agent_id:settings.identity.agent_id}]});
    const variants=protocol.formation_tasks.includes(id)?['formation']:
      ['none','memory','none-p1','memory-p1','none-p2','memory-p2'];
    const manifest=read(`prepared/${id}/manifest.json`);
    const common_hash=hash(JSON.stringify({task:manifest.task,inputs:manifest.files.filter(f=>f.role==='input'),protocol}));
    for(const variant of variants){
      const key=`${id}-${variant}`;
      specs[key]={task_id:id,arm:variant==='formation'?'FORMATION':variant.startsWith('memory')?'FROZEN_HISTORY_MEMORY':'NO_HISTORY_MEMORY',
        common_hash,prepared:resolve(root,'prepared',id),identity:{...settings.identity,task_id:task.task_id,session_id:'business-'+randomBytes(12).toString('hex')}};
    }
  }
  save('runspecs.json',specs);mkdirSync(resolve(root,'runs'),{mode:0o700});
  execFileSync('node',[resolve(here,'acceptance.mjs'),'services',root],{stdio:'pipe'});
  if(settings.memory_producer){
    const producer=JSON.parse(readFileSync(resolve(here,'memory-producer-v2.json'))),source=producer.source_root;
    assert(source.endsWith('/outputs/'+producer.parent_attempt));
    mkdirSync(resolve(root,'runtime/formation-sources'),{mode:0o700});
    for(const id of protocol.formation_tasks)cpSync(resolve(source,`runs/${id}-formation/l0-source.json`),resolve(root,`runtime/formation-sources/${id}.json`));
    const es=readFileSync(resolve(source,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    const req=es.filter(e=>e.kind==='request'),res=es.filter(e=>e.kind==='response');
    assert.equal(req.length,res.length);assert(req.every(r=>res.some(s=>s.call_id===r.call_id)));
    save('formation-source-cost.json',{source,original_status:'INFRA_ERROR (retained)',
      actual_wire_totals:totals(res.map(r=>({...r,usage:{...r.usage,model_calls:1,tool_calls:0}}))),
      tool_calls:protocol.formation_tasks.reduce((s,id)=>s+JSON.parse(readFileSync(resolve(source,`runs/${id}-formation/agent-run.json`))).usage.tool_calls,0),
      includes_late_responses:true,reran_agent:false});
    save('attempt-lineage.json',{kind:'MEMORY_PRODUCER_REVISION',parent:producer.parent_attempt,source,
      producer_revision:producer.revision,transfer_runs_before_freeze:0,historical_attempts_unchanged:true});
  }
  mkdirSync(resolve(root,'runtime/packages'),{mode:0o755});
  const packages='/Users/lsmax/Coder/nanobot/.venv/lib/python3.13/site-packages';
  for(const module of ['openpyxl','et_xmlfile'])cpSync(resolve(packages,module),resolve(root,'runtime/packages',module),{
    recursive:true,filter:p=>!p.split('/').includes('__pycache__')});
  const files=JSON.parse(execFileSync(python,['-c',"import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from study_contract import frozen_files;print(json.dumps(frozen_files(Path(sys.argv[2]))))",here,root],{encoding:'utf8'}));
  save('study-freeze.json',{kind:'BUSINESS_MEMORY_TRANSFER',at:new Date().toISOString(),files,files_hash:hash(JSON.stringify(files)),
    protocol_hash:sha(resolve(root,'runtime/business/protocol-transfer-v1.json')),selection_before_model_calls:true,
    nanobot_revision:execFileSync('git',['-C','/Users/lsmax/Coder/nanobot','rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    runtime_images:read('preflight.json').images,old_skill_protocols_unchanged:true});
  console.log('STUDY_FROZEN '+read('study-freeze.json').files_hash);
}else{
  settings=read('private/settings.json');verify();
}

async function runOne(key){
  verify();assert(!existsSync(resolve(root,'runs',key)),'existing run must not be overwritten: '+key);
  const spec=read('runspecs.json')[key];assert(spec);
  if(spec.arm==='FROZEN_HISTORY_MEMORY')assert(existsSync(resolve(root,'memory-snapshot.json')));
  console.log('RUN_START '+key);
  await command(python,[resolve(root,'runtime/business/nanobot_business.py'),root,key],`private/${key}.log`);
  const agent=read(`runs/${key}/agent-run.json`),manifest=read(`prepared/${spec.task_id}/manifest.json`),ref=manifest.files.find(f=>f.role==='reference');
  const oracle=JSON.parse(execFileSync(python,[resolve(root,'runtime/business/workbook_oracle.py'),resolve(spec.prepared,ref.path),resolve(root,'runs',key,'outputs/result.xlsx'),manifest.task.answer_position],{encoding:'utf8'}));
  save(`runs/${key}/oracle.json`,oracle);
  const req=events().filter(e=>e.kind==='request'&&e.session_id===spec.identity.session_id),res=events().filter(e=>e.kind==='response'&&e.session_id===spec.identity.session_id);
  let status=oracle.status,error=null;
  try{
    assert.equal(req.length,res.length);assert.equal(req.length,agent.usage.model_calls);
    assert(req.length>0&&req.every(e=>e.model===protocol.model&&e.temperature===0));
    assert(res.every(e=>e.status===200&&e.model===protocol.model));
    for(const k of ['prompt_tokens','completion_tokens','total_tokens'])assert(res.every(e=>Number.isInteger(e.usage?.[k]))&&res.reduce((s,e)=>s+e.usage[k],0)===agent.usage[k],k);
    assert.equal(agent.input_hash_before,agent.input_hash_after);assert(!agent.telemetry_error);
    if(agent.status!=='COMPLETED'||agent.stop_reason==='max_iterations'){
      if(/BUDGET_EXHAUSTED|max.iteration/i.test(JSON.stringify(agent.agent_error)+agent.stop_reason))status='TASK_FAIL';
      else {status='INFRA_ERROR';error=agent.agent_error??agent.stop_reason;}
    }
  }catch(e){status='INFRA_ERROR';error='EVIDENCE_AUDIT: '+e.message;}
  const recalled=events().filter(e=>e.kind==='recall'&&e.session_id===spec.identity.session_id);
  if(spec.arm!=='FROZEN_HISTORY_MEMORY')assert(req.every(e=>e.injected_memory_chars===0)&&!recalled.length);
  else if(recalled.length!==1){status='INFRA_ERROR';error='RECALL_EVIDENCE_INCOMPLETE';}
  const result={key,task_id:spec.task_id,arm:spec.arm,status,error,oracle:oracle.status,usage:agent.usage,
    common_hash:spec.common_hash,condition_hash:hash(JSON.stringify({common_hash:spec.common_hash,arm:spec.arm,
      memory_hash:spec.arm==='FROZEN_HISTORY_MEMORY'?read('memory-freeze.json').sha256:null})),
    elapsed_ms:agent.elapsed_ms,recall_count:recalled[0]?.items.length??0,agent_hash:sha(resolve(root,`runs/${key}/agent-run.json`)),
    output_hash:existsSync(resolve(root,`runs/${key}/outputs/result.xlsx`))?sha(resolve(root,`runs/${key}/outputs/result.xlsx`)):null,
    session_id:spec.identity.session_id};
  save(`runs/${key}/result.json`,result);
  await api('/v3/meta/participation-log/append',{...spec.identity,user_id:settings.user_id,source:'business-memory-research',metadata_json:JSON.stringify(result)});
  console.log('RUN_END '+JSON.stringify(result));return result;
}

if(stage==='formation'){
  assert(!events().length&&!existsSync(resolve(root,'admission.json')));
  const spec=Object.values(read('runspecs.json'))[0],url=`http://127.0.0.1:${settings.infrastructure.proxyPort}/proxy/${settings.instance}/v1/chat/completions`;
  const headers={'content-type':'application/json','x-tdai-user-key':settings.user_key,...Object.fromEntries(Object.entries(spec.identity).map(([k,v])=>['x-'+k.replaceAll('_','-'),v]))};
  for(const h of Object.keys(headers).filter(h=>h!=='content-type')){
    const r=await fetch(url,{method:'POST',headers:{...headers,[h]:'wrong'},body:'{}'});assert.equal(r.status,403);
  }
  for(const alias of ['x-session-key','x-tdai-session-id','x-tdai-session-key']){
    const r=await fetch(url,{method:'POST',headers:{...headers,[alias]:'ambiguous'},body:'{}'});assert.equal(r.status,403);
  }
  const denied=await fetch(`http://127.0.0.1:${settings.infrastructure.proxyPort}/formation/v1/chat/completions`,{method:'POST',body:'{}'});assert.equal(denied.status,403);
  assert(!events().length);save('admission.json',{status:'PASS',negative_cases:9,model_calls:0});
  if(!settings.memory_producer)for(const id of protocol.formation_tasks)await runOne(id+'-formation');
  // Only original training requests and actual tool/output evidence enter L0. Never oracle data.
  for(const id of protocol.formation_tasks){
    const spec=read('runspecs.json')[id+'-formation'];
    let messages;
    if(settings.memory_producer){
      mkdirSync(resolve(root,`runs/${id}-formation`),{mode:0o700});
      messages=read(`runtime/formation-sources/${id}.json`);
    }else{
    const r=read(`runs/${id}-formation/agent-run.json`),task=read(`prepared/${id}/manifest.json`).task;
    messages=[{role:'user',content:task.instruction},
      ...r.tool_events.map(e=>({role:'assistant',content:JSON.stringify({tool:e.name,arguments:e.arguments,result:e.result,outcome:e.outcome})})),
      {role:'assistant',content:r.final_output||'No final output was produced.'}].flatMap(m=>{
        const parts=[];for(let i=0;i<m.content.length;i+=7000)parts.push({...m,content:m.content.slice(i,i+7000)});return parts;});
    }
    assert(messages.length<=100);save(`runs/${id}-formation/l0-source.json`,messages);
    const stored=await api('/v3/conversation/add',{...scope(),session_id:spec.identity.session_id,task_id:spec.identity.task_id,messages});
    save(`runs/${id}-formation/l0-receipt.json`,stored);
  }
  console.log('FORMATION_L0_CAPTURED');
}

if(stage==='snapshot'){
  assert(!existsSync(resolve(root,'memory-snapshot.json')));
  // Bounded polling, not a silent model retry. The Proxy caps extraction at two calls.
  let rows,last='';
  for(let i=0;i<60;i++){
    rows=await api('/v3/atomic/query',{...scope(),limit:100});
    const responses=events().filter(e=>e.kind==='formation_response');
    const state=JSON.stringify(rows.items);
    if(responses.length===2&&state===last&&rows.total>0)break;
    last=state;await new Promise(r=>setTimeout(r,5000));
  }
  const responses=events().filter(e=>e.kind==='formation_response');
  save('extraction-status.json',{responses,rows:rows.total});
  assert(responses.length===2&&responses.every(e=>e.status===200&&e.model===protocol.model),'extraction incomplete');
  assert(rows.total>0&&rows.total===rows.items.length,'no complete memory snapshot; do not invent one');
  const trainingIds=protocol.formation_tasks.map(id=>read('runspecs.json')[id+'-formation'].identity.task_id);
  assert(rows.items.every(r=>r.team_id===scope().team_id&&r.agent_id===scope().agent_id&&trainingIds.includes(r.task_id)),'unexpected memory provenance');
  save('memory-snapshot.json',{at:new Date().toISOString(),items:rows.items,source_tasks:protocol.formation_tasks,
    source_hashes:Object.fromEntries(protocol.formation_tasks.map(id=>[id,sha(resolve(root,`runs/${id}-formation/l0-source.json`))])),
    origin:'MemoryCore automatic L1 code-mode extraction; no manual rewriting',extraction_usage:totals(responses.map(r=>({...r,usage:{...r.usage,model_calls:1,tool_calls:0}})))});
  save('memory-freeze.json',{sha256:sha(resolve(root,'memory-snapshot.json')),l1_count:rows.total,read_only_after:true});
  console.log('MEMORY_FROZEN '+rows.total);
}

if(stage==='transfer'||stage==='remaining'){
  assert.equal(sha(resolve(root,'memory-snapshot.json')),read('memory-freeze.json').sha256);
  for(const item of protocol.order){
    const [id,arm]=item.split(':'),key=id+'-'+arm;
    // Resume only missing runs. Partial directories still fail closed in runOne.
    if(stage==='remaining'&&existsSync(resolve(root,`runs/${key}/result.json`)))continue;
    await runOne(key);
  }
}

if(stage==='probes'){
  const selected=[];
  for(const id of protocol.transfer_tasks){
    const a=read(`runs/${id}-none/result.json`),b=read(`runs/${id}-memory/result.json`);
    if(a.status==='INFRA_ERROR'||b.status==='INFRA_ERROR')continue;
    if(a.status!==b.status||[a,b].some(r=>['model_calls','tool_calls'].some(k=>r.usage[k]>=.9*protocol.max_model_calls))){
      selected.push(id);
      for(let n=1;n<=2;n++)for(const arm of n===1?['memory','none']:['none','memory'])await runOne(`${id}-${arm}-p${n}`);
    }
  }
  save('probe-selection.json',{selected,rule:protocol.research_evidence.probes,main_attempt_unchanged:true});
}

if(stage==='audit'){
  const snapshot=read('memory-snapshot.json'),rows=await api('/v3/atomic/query',{...scope(),limit:100});
  assert.equal(stableRows(rows.items),stableRows(snapshot.items));
  const all=[];
  for(const name of readdirSync(resolve(root,'runs'))){
    const p=`runs/${name}/result.json`;if(!existsSync(resolve(root,p)))continue;
    const r=read(p);all.push(r);
    if(r.arm!=='FORMATION'){
      const spec=read('runspecs.json')[name],q=await api('/v3/conversation/query',{...scope(),task_id:spec.identity.task_id,session_id:spec.identity.session_id});assert.equal(q.total,0);
    }
  }
  const skills=await api('/v3/meta/asset/list',{team_id:scope().team_id,asset_type:'skill'});assert.equal(skills.total,0);
  const prod=JSON.parse(execFileSync('docker',['exec','tdai-memory-core','node','-e',`const f=require('fs'),p=require('path'),c=require('crypto'),o={};function w(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const x=p.join(d,e.name);if(e.isDirectory())w(x);else if(e.isFile())o[x]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex')}}w('/data/tdai-memory');console.log(JSON.stringify(o))`],{encoding:'utf8'}));
  const productionUnchanged=JSON.stringify(prod)===JSON.stringify(read('preflight.json').production_snapshot);
  const pairs=protocol.transfer_tasks.map(id=>{const a=read(`runs/${id}-none/result.json`),b=read(`runs/${id}-memory/result.json`);
    assert.equal(a.common_hash,b.common_hash);assert.notEqual(a.condition_hash,b.condition_hash);
    return{task_id:id,none:a,memory:b,classification:classify(a.status,b.status)};});
  const none=totals(pairs.map(p=>p.none)),memory=totals(pairs.map(p=>p.memory));
  const cost=Object.fromEntries(['total_tokens','tool_calls','model_calls'].map(k=>[k,memory[k]/none[k]]));
  const quality=pairs.some(p=>p.classification==='newly_fixed')&&!pairs.some(p=>p.classification==='newly_broken');
  const result={kind:'EXPLORATORY_MEMORY_TRANSFER_NOT_PROMOTION',status:pairs.some(p=>p.classification==='incomparable')?'INFRA_ERROR':quality&&Object.values(cost).every(v=>v<=1.2)?'POSITIVE_MAIN_SIGNAL':'NO_ACCEPTABLE_MAIN_BENEFIT',
    pairs,none_totals:none,memory_totals:memory,cost_ratios:cost,formation_task_cost:settings.memory_producer?read('formation-source-cost.json'):totals(all.filter(r=>r.arm==='FORMATION')),
    extraction_cost:snapshot.extraction_usage,probes:all.filter(r=>/-p[12]$/.test(r.key)),memory_unchanged:true,
    l1_count:rows.total,transfer_l0_count:0,skill_assets:0,production_storage_unchanged:productionUnchanged,
    limitation:'3 tasks; public benchmark potential pretraining exposure; value-only oracle; SQLite/FTS, not cloud TencentDB'};
  save('study-report.json',result);console.log(JSON.stringify(result,null,2));
}
