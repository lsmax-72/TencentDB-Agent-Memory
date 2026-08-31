/** Independent post-run collector; it never reruns an Agent or rewrites a result. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [mode,rootArg]=process.argv.slice(2),root=resolve(rootArg);
assert(root.includes('/outputs/business-xlsx-memory-')&&/^[a-z0-9-]+$/.test(basename(root)));
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex');
const save=(p,data)=>writeFileSync(resolve(root,p),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
const s=read('private/settings.json'),scope={team_id:s.identity.team_id,agent_id:s.identity.agent_id,user_id:s.user_id};
async function api(path,body,hub=false){
  const r=await fetch(`http://127.0.0.1:${hub?s.infrastructure.hubPort:s.infrastructure.corePort}${hub?'/api/v1':''}${path}`,{
    method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${s.gateway_key}`,
      'x-tdai-service-id':s.instance,'x-tdai-user-key':s.user_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const v=await r.json();assert(r.ok&&v.code===0,`${path} HTTP ${r.status}`);return v.data;
}
if(mode==='hub'){
  const assets=await api('/meta/asset/list',{team_id:scope.team_id,asset_type:'chat_memory',limit:100},true);
  const asset=assets.items.find(a=>a.asset_id===`chat_memory-${scope.team_id}-${scope.agent_id}`);assert(asset);
  const counts={};for(const layer of ['L0','L1','L2','L3']){
    const data=await api('/chat-memory/layer',{block_id:asset.asset_id,layer,limit:100},true);counts[layer]=data.total??data.items?.length??null;
  }
  assert.equal(counts.L1,read('memory-freeze.json').l1_count);
  const data={status:'PASS',verification:'authenticated Hub API, not browser visual verification',url:`http://127.0.0.1:${s.infrastructure.hubPort}/#/memory`,
    team_id:scope.team_id,agent_id:scope.agent_id,asset_id:asset.asset_id,counts,expected:'formation L0/L1 only; transfer traces stay in Task evidence'};
  save('hub-memory-visibility.json',data);console.log(JSON.stringify(data));
}
if(mode==='post'){
  const specs=read('runspecs.json'),events=readFileSync(resolve(root,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),details=[];
  for(const name of readdirSync(resolve(root,'runs'))){
    if(!existsSync(resolve(root,`runs/${name}/result.json`)))continue;
    const result=read(`runs/${name}/result.json`),agent=read(`runs/${name}/agent-run.json`),oracle=read(`runs/${name}/oracle.json`),spec=specs[name];
    const context=JSON.stringify(agent.provider_requests??[]);
    const blinded=Array.isArray(agent.provider_requests)&&agent.provider_requests.length>0&&
      /^[a-f0-9]{32}$/.test(basename(agent.workspace_ref))&&
      ![name,'NO_HISTORY_MEMORY','FROZEN_HISTORY_MEMORY'].some(label=>context.includes(label));
    assert(blinded,'arm labels or missing raw context');
    const req=events.filter(e=>e.kind==='request'&&e.session_id===spec.identity.session_id);
    const responses=events.filter(e=>e.kind==='response'&&e.session_id===spec.identity.session_id);
    const recall=events.filter(e=>e.kind==='recall'&&e.session_id===spec.identity.session_id);
    assert(req.every(e=>e.model==='qwen3.8-27b'&&e.temperature===0));
    assert(req.length<=8,'actual upstream budget');
    const complete=req.length===responses.length&&req.every(q=>responses.some(r=>r.call_id===q.call_id&&r.status===200));
    const wireUsage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].map(k=>[k,
      complete&&responses.every(r=>Number.isInteger(r.usage?.[k]))?responses.reduce((n,r)=>n+r.usage[k],0):null]));
    const injection=result.arm==='FROZEN_HISTORY_MEMORY'?recall.length===1&&req.every(r=>r.injected_memory_hash===recall[0].block_hash):!recall.length&&req.every(r=>r.injected_memory_chars===0);
    const l0=await api('/v3/conversation/query',{...scope,task_id:spec.identity.task_id,session_id:spec.identity.session_id});assert.equal(l0.total,0);
    await api('/meta/task/get',{task_id:spec.identity.task_id},true);
    details.push({key:name,original_status:result.status,original_status_unchanged:true,oracle:oracle.status,
      workspace_audit:oracle.separate_audit,wire_usage:wireUsage,wire_model_calls:req.length,
      sdk_usage:agent.sdk_usage??agent.usage,late_response_gap:(wireUsage.total_tokens??0)-(agent.usage?.total_tokens??0),
      evidence_complete_after_drain:complete,injection_verified:injection,context_blinding_verified:blinded,recall_hits:recall[0]?.items.length??0,
      output_hash:result.output_hash,tool_outcomes:agent.tool_events.map(e=>e.outcome),
      tool_code_chars:agent.tool_events.map(e=>e.arguments.code.length),elapsed_ms:agent.elapsed_ms});
  }
  const rows=await api('/v3/atomic/query',{...scope,limit:100}),snapshot=read('memory-snapshot.json');
  const canonical=items=>JSON.stringify(items.map(r=>({id:r.id,type:r.type,content:r.content,version:r.version})).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(canonical(rows.items),canonical(snapshot.items));assert.equal(sha('memory-snapshot.json'),read('memory-freeze.json').sha256);
  const skills=await api('/v3/meta/asset/list',{team_id:scope.team_id,asset_type:'skill'});assert.equal(skills.total,0);
  const leaks=[];
  for(const container of [s.infrastructure.core,s.infrastructure.proxy,s.infrastructure.hub]){
    const run=spawnSync('docker',['logs',container],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(run.status,0);
    const text=run.stdout+run.stderr;
    for(const key of ['gateway_key','user_key','upstream_key','extraction_key'])if(s[key]?.length>=12&&text.includes(s[key]))leaks.push({container,key_name:key});
  }
  const record={status:leaks.length?'FAIL':'PASS',details,secret_scan:leaks,skill_assets:0,l1_unchanged:true,
    l0_transfer_records:0,hub_tasks_visible:true,collector_hash:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
    warning:'Late response costs supplement accounting; never reinterpret an original INFRA_ERROR as TASK_PASS.'};
  save('supplementary-audit.json',record);console.log(JSON.stringify(record,null,2));
}
