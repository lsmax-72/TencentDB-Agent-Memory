import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitted, observation, containsText } from './acceptance-lib.mjs';

test('wire evidence detects multiline Skill in string and block content without JSON escape mismatch', () => {
  const skill='rule one\nrule two "quoted"';
  assert.equal(containsText([{role:'system',content:`<evaluation_skill>\n${skill}\n</evaluation_skill>`}],skill),true);
  assert.equal(containsText([{content:[{type:'text',text:skill}]}],skill),true);
  assert.equal(containsText([{role:'system',content:'ordinary'}],skill),false);
});

test('Hub evidence admits counters and hashes, never raw content or credentials', () => {
  const result = observation({mode: 'evaluation', output:'SECRET', secret:'SECRET',
    usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3,secret:'SECRET'}, model_calls:1,
    tool_events:[{name:'write_file',arguments:{content:'SECRET'},result:'SECRET'}]}, 'test-session');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.tool_calls, 1);
  assert.throws(() => observation({usage:{}}, 's'), /Missing usage/);
});

test('test gateway fails closed for namespace/session/identity mismatches', () => {
  const settings = {instance:'test-only',user_key:'key',runs:[{session_id:'s',team_id:'t',agent_id:'a',task_id:'k'}]};
  const h = new Headers({'x-session-id':'s','x-team-id':'t','x-agent-id':'a','x-task-id':'k','x-tdai-user-key':'key'});
  assert.equal(admitted('/proxy/test-only/v1/chat/completions',h,settings),true);
  for (const key of ['x-session-id','x-team-id','x-agent-id','x-task-id','x-tdai-user-key']) {
    const wrong = new Headers(h); wrong.set(key, 'other');
    assert.equal(admitted('/proxy/test-only/v1/chat/completions',wrong,settings),false);
  }
  assert.equal(admitted('/proxy/default/v1/chat/completions',h,settings),false);
  assert.equal(admitted('/skill-bridge/write',h,settings),false);
  h.set('x-conversation-id','other');
  assert.equal(admitted('/proxy/test-only/v1/chat/completions',h,settings),false);
});
