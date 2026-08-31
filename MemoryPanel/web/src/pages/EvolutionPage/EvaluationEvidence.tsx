import { Table } from 'tea-component';

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown): string { return typeof value === 'number' || typeof value === 'string' ? String(value) : '未提供'; }
export function EvaluationEvidence({ payload }: { payload: Record<string, unknown> }) {
  const cost = object(payload.cost_summary);
  const gate = object(payload.gate);
  const pairs = Array.isArray(payload.pairs) ? payload.pairs.map(object) : [];
  return <div>
    {gate.status !== undefined && <p><strong>Gate：{display(gate.status)}</strong>　{JSON.stringify(gate.reasons ?? [])}</p>}
    {Object.keys(cost).length > 0 && <Table records={['baseline', 'candidate'].map(arm => ({ arm, ...object(cost[arm]) }))} recordKey="arm" columns={[
      { key: 'arm', header: '对照条件' },
      ...[['total_tokens', 'Tokens'], ['tool_call_count', '工具调用'], ['model_call_count', '模型调用'], ['elapsed_ms', '耗时 ms']].map(([key, header]) => ({ key, header, render: (row: Record<string, unknown>) => display(row[key]) })),
    ]} />}
    {pairs.length > 0 && <Table records={pairs.map((pair, index) => ({ ...pair, id: String(index) }))} recordKey="id" columns={[
      { key: 'case', header: 'Case', render: (row: Record<string, unknown>) => display(object(row.case_ref).id) },
      { key: 'baseline', header: 'Baseline', render: (row: Record<string, unknown>) => display(object(row.baseline).status) },
      { key: 'candidate', header: 'Candidate', render: (row: Record<string, unknown>) => display(object(row.candidate).status) },
      { key: 'classification', header: '分类', render: (row: Record<string, unknown>) => display(row.classification) },
    ]} />}
    {payload.evidence_limitations !== undefined && <p>{JSON.stringify(payload.evidence_limitations)}</p>}
  </div>;
}
