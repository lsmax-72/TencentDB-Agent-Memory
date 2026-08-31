/** Read-only diagnostics. These never change the frozen run's status or score. */
export function wireAccounting(requests, responses) {
  const requestIds = requests.map(r => r.call_id);
  const responseIds = responses.map(r => r.call_id);
  const complete = requests.length > 0 && new Set(requestIds).size === requests.length &&
    new Set(responseIds).size === responses.length && requests.length === responses.length &&
    requests.every(q => responses.some(r => r.call_id === q.call_id && r.status === 200 && r.model === q.model));
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const validUsage = complete && responses.every(r => fields.every(k => Number.isInteger(r.usage?.[k]) && r.usage[k] >= 0) &&
    r.usage.prompt_tokens + r.usage.completion_tokens === r.usage.total_tokens);
  return {complete: validUsage, model_calls: requests.length,
    usage: Object.fromEntries(fields.map(k => [k, validUsage ? responses.reduce((n, r) => n + r.usage[k], 0) : null]))};
}

export function normalizedInitialContext(agent) {
  if (!agent.provider_requests?.length || !agent.workspace_ref) throw Error('Missing initial context evidence');
  // Random workspace identity is the only permitted normalization, not prompt text.
  return JSON.stringify(agent.provider_requests[0]).replaceAll(agent.workspace_ref, '<ISOLATED_WORKSPACE>');
}

export function toolBehavior(events) {
  const steps = events.map(e => {
    const result = JSON.parse(e.result);
    return {sequence: e.sequence, outcome: e.outcome, code_chars: e.arguments.code.length,
      output_chars: result.output.length, output_hash: result.output_hashes?.['result.xlsx'] ?? null,
      reads_library_source: /inspect\.getsource\s*\(/.test(e.arguments.code)};
  });
  const first = steps.find(s => s.output_hash);
  return {steps, first_output_sequence: first?.sequence ?? null,
    post_output_calls: first ? steps.filter(s => s.sequence > first.sequence).length : null,
    library_source_reads: steps.filter(s => s.reads_library_source).length,
    failed_tools: steps.filter(s => s.outcome === 'FAILED').length,
    tool_output_chars: steps.reduce((n, s) => n + s.output_chars, 0),
    interpretation: 'Post-output calls are not necessarily verification or redundant; inspect code before attribution.'};
}
