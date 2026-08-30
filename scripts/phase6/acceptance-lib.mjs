import { createHash } from 'node:crypto';

export const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function containsText(value, needle) {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some(v => containsText(v, needle));
  return value !== null && typeof value === 'object'
    && Object.values(value).some(v => containsText(v, needle));
}

// A positive allowlist, not redaction: arbitrary outputs/arguments never enter Hub metadata.
export function observation(run, sessionId) {
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const value = run.usage?.[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Missing usage: ${key}`);
    usage[key] = value;
  }
  if (!Number.isSafeInteger(run.model_calls) || run.model_calls < 1) throw new Error('Missing model calls');
  const allowed = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);
  if (!Array.isArray(run.tool_events) || run.tool_events.some(e => !allowed.has(e.name))) {
    throw new Error('Unexpected tool evidence');
  }
  return {
    phase: 'PHASE6_INTEGRATION', evaluation: run.mode === 'evaluation',
    session_id: sessionId, usage, model_calls: run.model_calls,
    tool_calls: run.tool_events.length, tool_names: run.tool_events.map(e => e.name),
    output_hash: hash(run.output ?? ''), evidence_hash: hash(JSON.stringify(run)),
    oracle_pass: run.oracle_pass === true,
  };
}

export function admitted(path, headers, settings) {
  if (path !== `/proxy/${settings.instance}/v1/chat/completions`) return false;
  // Proxy resolves x-conversation-id before x-session-id. Reject ambiguous
  // aliases so a caller cannot accidentally leave the trusted evaluation session.
  for (const alias of ['x-conversation-id','x-claude-code-session-id','x-deepseek-harness-session-id','x-chat-id','x-thread-id']) {
    if (headers.has(alias) && headers.get(alias) !== headers.get('x-session-id')) return false;
  }
  const identity = settings.runs.find(r => r.session_id === headers.get('x-session-id'));
  return !!identity && headers.get('x-tdai-user-key') === settings.user_key
    && headers.get('x-team-id') === identity.team_id
    && headers.get('x-agent-id') === identity.agent_id
    && headers.get('x-task-id') === identity.task_id;
}
