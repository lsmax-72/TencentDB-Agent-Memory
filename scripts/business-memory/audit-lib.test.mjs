import assert from 'node:assert/strict';
import test from 'node:test';
import {wireAccounting, normalizedInitialContext, toolBehavior} from './audit-lib.mjs';

const request = {call_id: 'a', model: 'test'};
const response = {...request, status: 200, usage: {prompt_tokens: 7, completion_tokens: 3, total_tokens: 10}};
test('late wire usage is supplementary and missing evidence is null, never zero', () => {
  assert.deepEqual(wireAccounting([request], []), {complete: false, model_calls: 1,
    usage: {prompt_tokens: null, completion_tokens: null, total_tokens: null}});
  assert.equal(wireAccounting([request], [response]).usage.total_tokens, 10);
  assert.equal(wireAccounting([], []).complete, false);
});
test('wire accounting rejects duplicates, wrong model, mismatched IDs and inconsistent totals', () => {
  for (const res of [[response, response], [{...response, model: 'other'}],
    [{...response, call_id: 'b'}], [{...response, usage: {...response.usage, total_tokens: 11}}]]) {
    assert.equal(wireAccounting([request], res).complete, false);
  }
  assert.equal(wireAccounting([request, request], [response, response]).complete, false);
});
test('fairness normalization only erases the random workspace path', () => {
  const agent = path => ({workspace_ref: path, provider_requests: [{messages: [{role: 'system', content: `workspace ${path}`}], temperature: 0}]});
  assert.equal(normalizedInitialContext(agent('/a')), normalizedInitialContext(agent('/b')));
  const changed = agent('/b'); changed.provider_requests[0].temperature = 1;
  assert.notEqual(normalizedInitialContext(agent('/a')), normalizedInitialContext(changed));
  assert.throws(() => normalizedInitialContext({}));
});
test('tool diagnostics keep false self-checks distinct from workbook correctness', () => {
  const event = (sequence, code, outcome, saved) => ({sequence, arguments: {code}, outcome,
    result: JSON.stringify({output: 'abc', output_hashes: saved ? {'result.xlsx': 'hash'} : {}})});
  const got = toolBehavior([event(1, 'inspect.getsource(x)', 'SUCCEEDED', false),
    event(2, 'save()', 'SUCCEEDED', true), event(3, 'assert False', 'FAILED', true)]);
  assert.equal(got.first_output_sequence, 2);
  assert.equal(got.post_output_calls, 1);
  assert.equal(got.failed_tools, 1);
  assert.equal(got.library_source_reads, 1);
  assert.equal(got.tool_output_chars, 9);
  assert.equal(toolBehavior([]).first_output_sequence, null);
});
