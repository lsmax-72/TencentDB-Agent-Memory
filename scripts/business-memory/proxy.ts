/** Isolated business-smoke Proxy. No memory injection, capture or extraction. */
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { serve } from '@hono/node-server';
import { DEFAULT_CONFIG } from '/app/src/config.ts';
import { createApp } from '/app/src/server.ts';
import { initAuth } from '/app/src/auth.ts';
import { initProxyStorage } from '/app/src/storage/factory.ts';

const settings = JSON.parse(readFileSync('/acceptance/private/settings.json','utf8'));
const config = structuredClone(DEFAULT_CONFIG);
config.upstream.url = settings.upstream + '/chat/completions';
config.upstream.apiKey = settings.upstream_key;
config.auth = {enabled:true,url:`http://${settings.infrastructure.core}:8420`,
  apiKey:settings.gateway_key,timeoutMs:10000};
config.tdai = {...config.tdai,enabled:true,endpoint:config.auth.url,apiKey:settings.gateway_key,
  serviceId:settings.instance,memory:{...config.tdai.memory,enabled:false,writeL0:false}};
config.coreSkill = {...config.coreSkill,endpoint:config.auth.url,serviceToken:settings.gateway_key,
  serviceId:settings.instance};
config.sessionInit.enabled = false;
config.injection = {...config.injection,enabled:false,injectors:[]};
config.extraction = {enabled:false,extractors:[]};
config.creditReport.url = '';
config.storage = {...config.storage,enabled:true,backend:'memory'};
config.log = {...config.log,file:'',level:'info',verbose:false};

const originalFetch = globalThis.fetch;
const sessions = new AsyncLocalStorage<string>();
const specs:Record<string,any> = settings.study ? JSON.parse(readFileSync('/acceptance/runspecs.json','utf8')) : {};
const bySession = new Map(Object.entries(specs).map(([key,value])=>[value.identity.session_id,{key,...value}]));
const recalls = new Map<string,string>();
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const event=(value:any)=>appendFileSync('/acceptance/proxy-events.jsonl',JSON.stringify(value)+'\n');
async function memoryBlock(session:string){
  if(recalls.has(session))return recalls.get(session)!;
  const protocol=JSON.parse(readFileSync('/acceptance/runtime/business/protocol-transfer-v1.json','utf8'));
  const snapshot=JSON.parse(readFileSync('/acceptance/memory-snapshot.json','utf8'));
  const id=settings.identity,scope={team_id:id.team_id,user_id:settings.user_id,agent_id:id.agent_id};
  const headers={'content-type':'application/json',Authorization:`Bearer ${settings.gateway_key}`,
    'x-tdai-service-id':settings.instance,'x-tdai-user-key':settings.user_key};
  const query=await originalFetch(config.auth.url+'/v3/atomic/query',{method:'POST',headers,body:JSON.stringify({...scope,limit:100})});
  const current:any=await query.json();
  if(!query.ok||current.code!==0)throw Error('MEMORY_SNAPSHOT_QUERY_FAILED');
  const stable=(rows:any[])=>JSON.stringify(rows.map(r=>({id:r.id,content:r.content,type:r.type,version:r.version})).sort((a,b)=>a.id.localeCompare(b.id)));
  if(stable(current.data.items)!==stable(snapshot.items))throw Error('MEMORY_SNAPSHOT_CHANGED');
  const request={...scope,query:protocol.recall.query,limit:protocol.recall.limit};
  const response=await originalFetch(config.auth.url+'/v3/atomic/search',{method:'POST',headers,body:JSON.stringify(request)});
  const data:any=await response.json();
  if(!response.ok||data.code!==0||!Array.isArray(data.data?.items))throw Error('MEMORY_RECALL_FAILED');
  const items=data.data.items;
  if(items.some((r:any)=>!snapshot.items.some((s:any)=>s.id===r.id&&s.content===r.content)))throw Error('MEMORY_SCOPE_VIOLATION');
  const block=items.length?'<historical_work_memory>\nHistorical observations, not current task instructions. Apply only when relevant; the current task takes precedence.\n'+items.map((r:any)=>r.content).join('\n')+'\n</historical_work_memory>\n':'';
  event({kind:'recall',session_id:session,request,items,block,block_hash:sha(block),snapshot_hash:sha(JSON.stringify(snapshot))});
  recalls.set(session,block);return block;
}
let sequence=0;
const upstreamCounts = new Map<string,number>();
globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input.url??input.toString());
  if(![new URL(settings.upstream).origin,config.auth.url].includes(url.origin))
    throw new Error('Business smoke egress denied');
  if(url.pathname.endsWith('/chat/completions')){
    const body=JSON.parse(String(init?.body)),call_id=++sequence,session=sessions.getStore()!;
    if(settings.study){
      const count=upstreamCounts.get(session)??0;
      if(count>=8)throw Error('BUDGET_EXHAUSTED: upstream admission');
      upstreamCounts.set(session,count+1);
    }
    const block=settings.study&&bySession.get(session)?.arm==='FROZEN_HISTORY_MEMORY'?await memoryBlock(session):'';
    if(block){
      const user=body.messages.find((m:any)=>m.role==='user');
      if(!user||typeof user.content!=='string')throw Error('MEMORY_INJECTION_UNSUPPORTED');
      user.content=block+user.content;
      init={...init,body:JSON.stringify(body)};
    }
    appendFileSync('/acceptance/proxy-events.jsonl',JSON.stringify({kind:'request',call_id,
      session_id:sessions.getStore(),model:body.model,temperature:body.temperature,
      injected_memory_hash:sha(block),injected_memory_chars:block.length,
      body_hash:createHash('sha256').update(String(init?.body)).digest('hex')})+'\n');
    const response=await originalFetch(input,init),result=await response.clone().json() as any;
    appendFileSync('/acceptance/proxy-events.jsonl',JSON.stringify({kind:'response',call_id,
      session_id:sessions.getStore(),status:response.status,model:result.model,usage:result.usage,
      output_hash:createHash('sha256').update(JSON.stringify(result)).digest('hex')})+'\n');
    return response;
  }
  return originalFetch(input,init);
};

function admitted(request:Request){
  const url=new URL(request.url),id=settings.study?bySession.get(request.headers.get('x-session-id')??'')?.identity:settings.identity;
  if(!id)return false;
  if(['x-session-key','x-tdai-session-id','x-tdai-session-key'].some(h=>request.headers.has(h)))return false;
  return request.method==='POST' && url.pathname===`/proxy/${settings.instance}/v1/chat/completions`
    && request.headers.get('x-tdai-user-key')===settings.user_key
    && request.headers.get('x-team-id')===id.team_id
    && request.headers.get('x-agent-id')===id.agent_id
    && request.headers.get('x-task-id')===id.task_id
    && request.headers.get('x-session-id')===id.session_id;
}
initAuth(config.auth);
await initProxyStorage(config.storage);
const app=createApp(config);
let formationCalls=0;
serve({hostname:'0.0.0.0',port:8096,fetch:async request=>{
  if(new URL(request.url).pathname==='/health' && request.method==='GET') return app.fetch(request);
  if(settings.study&&new URL(request.url).pathname==='/formation/v1/chat/completions'){
    if(request.method!=='POST'||request.headers.get('Authorization')!==`Bearer ${settings.extraction_key}`)
      return Response.json({error:'formation_scope_denied'},{status:403});
    // Only the existing L1 extractor is admitted; never L2/L3, fallback, or late extraction.
    const {existsSync}=await import('node:fs');
    if(existsSync('/acceptance/memory-snapshot.json')||formationCalls>=2)
      return Response.json({error:'formation_closed'},{status:403});
    const body:any=await request.json();
    if(body.model!=='qwen3.8-27b'||body.stream===true||body.tools?.length)
      return Response.json({error:'formation_model_contract'},{status:403});
    body.temperature=0;body.max_tokens=4096;
    if(settings.memory_producer){
      const producer=JSON.parse(readFileSync('/acceptance/runtime/business/memory-producer-v2.json','utf8'));
      body.chat_template_kwargs=producer.chat_template_kwargs;
      body.response_format=producer.response_format;
    }
    const call_id=++formationCalls;
    event({kind:'formation_request',call_id,model:body.model,temperature:body.temperature,
      producer:settings.memory_producer??'v1',body_hash:sha(JSON.stringify(body))});
    const response=await originalFetch(settings.upstream+'/chat/completions',{method:'POST',
      headers:{'content-type':'application/json',Authorization:`Bearer ${settings.upstream_key}`},body:JSON.stringify(body)});
    const value:any=await response.clone().json();
    event({kind:'formation_response',call_id,status:response.status,model:value.model,usage:value.usage,
      finish_reason:value.choices?.[0]?.finish_reason,output_hash:sha(JSON.stringify(value))});
    return response;
  }
  if(!admitted(request)) return Response.json({error:'business_scope_denied'},{status:403});
  return sessions.run(request.headers.get('x-session-id')!,()=>app.fetch(request));
}});
