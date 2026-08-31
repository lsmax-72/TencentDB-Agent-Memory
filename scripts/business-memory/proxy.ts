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
let sequence=0;
globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input.url??input.toString());
  if(![new URL(settings.upstream).origin,config.auth.url].includes(url.origin))
    throw new Error('Business smoke egress denied');
  if(url.pathname.endsWith('/chat/completions')){
    const body=JSON.parse(String(init?.body)),call_id=++sequence;
    appendFileSync('/acceptance/proxy-events.jsonl',JSON.stringify({kind:'request',call_id,
      session_id:sessions.getStore(),model:body.model,temperature:body.temperature,
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
  const url=new URL(request.url),id=settings.identity;
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
serve({hostname:'0.0.0.0',port:8096,fetch:request=>{
  if(new URL(request.url).pathname==='/health' && request.method==='GET') return app.fetch(request);
  if(!admitted(request)) return Response.json({error:'business_scope_denied'},{status:403});
  return sessions.run(request.headers.get('x-session-id')!,()=>app.fetch(request));
}});
