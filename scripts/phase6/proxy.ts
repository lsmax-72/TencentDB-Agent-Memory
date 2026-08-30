/** Acceptance-only entrypoint. Never imported by the normal Proxy startup. */
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { serve } from '@hono/node-server';
import { DEFAULT_CONFIG } from '/app/src/config.ts';
import { createApp } from '/app/src/server.ts';
import { initAuth } from '/app/src/auth.ts';
import { initProxyStorage } from '/app/src/storage/factory.ts';
import { evaluationSkillSessions } from '/app/src/injection/injectors/evaluation-skill-override.ts';
import { admitted, containsText } from './acceptance-lib.mjs';

const settings = JSON.parse(readFileSync('/acceptance/private/settings.json', 'utf8'));
const config = structuredClone(DEFAULT_CONFIG);
config.upstream.url = settings.upstream + '/chat/completions';
config.upstream.apiKey = settings.upstream_key;
config.auth = {enabled:true,url:'http://phase6-core:8420',timeoutMs:10000};
config.tdai = {...config.tdai,enabled:true,endpoint:config.auth.url,apiKey:'',serviceId:settings.instance,
  memory:{...config.tdai.memory,enabled:true,writeL0:true,timeoutMs:10000}};
config.coreSkill = {...config.coreSkill,endpoint:config.auth.url,serviceToken:'',serviceId:settings.instance};
config.sessionInit.enabled = true;
config.injection = {...config.injection,enabled:true,injectors:['tdai-memory'],assetReflection:{markerOptIn:false}};
config.extraction = {enabled:true,extractors:['tdai-memory']};
config.creditReport.url = '';
config.storage = {...config.storage,enabled:true,backend:'memory'};
config.log = {...config.log,file:'',level:'info',verbose:false};
const evaluation = settings.runs.find((r: any) => r.mode === 'evaluation');
const content = settings.evaluation_skill;
const digest = `sha256:${createHash('sha256').update(content).digest('hex')}` as const;
evaluationSkillSessions.bind(evaluation.session_id, {
  skill_id:'phase6-isolation-canary',base_version:1,content,
  content_hash:digest,artifact_hash:digest,read_only:true,
});

// Observe the real outgoing request without retaining prompt, key or tool payload.
// All network destinations are fixed to this test Core and the approved provider.
const originalFetch = globalThis.fetch;
const sessions = new AsyncLocalStorage<string>();
let sequence = 0;
globalThis.fetch = async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
  if (![new URL(settings.upstream).origin, config.auth.url].includes(url.origin)) {
    throw new Error('Acceptance egress denied');
  }
  if (url.pathname.endsWith('/chat/completions')) {
    const body = JSON.parse(String(init?.body));
    const callId = ++sequence;
    const event = {
      kind:'request', call_id:callId, session_id:sessions.getStore(),
      model:body.model, temperature:body.temperature,
      evaluation_skill_present:containsText(body.messages, content),
      body_hash:createHash('sha256').update(String(init?.body)).digest('hex'),
    };
    appendFileSync('/acceptance/proxy-events.jsonl', JSON.stringify(event)+'\n');
    const response = await originalFetch(input, init);
    const result = await response.clone().json() as any;
    appendFileSync('/acceptance/proxy-events.jsonl', JSON.stringify({
      kind:'response',call_id:callId,session_id:event.session_id,status:response.status,
      usage:result.usage,output_hash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    })+'\n');
    return response;
  }
  return originalFetch(input, init);
};
initAuth(config.auth);
await initProxyStorage(config.storage);
const app = createApp(config);
serve({hostname:'0.0.0.0',port:8096,fetch:request => {
  const path = new URL(request.url).pathname;
  if (path === '/health' && request.method === 'GET') return app.fetch(request);
  if (request.method !== 'POST' || !admitted(path,request.headers,settings)) {
    return Response.json({error:'acceptance_scope_denied'},{status:403});
  }
  return sessions.run(request.headers.get('x-session-id')!, () => app.fetch(request));
}});
