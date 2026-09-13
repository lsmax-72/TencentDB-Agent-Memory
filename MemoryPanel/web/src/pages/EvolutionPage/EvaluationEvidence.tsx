import { Alert, Table } from 'tea-component';

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown): string { return typeof value === 'number' || typeof value === 'string' ? String(value) : '未提供'; }
export function EvaluationEvidence({ payload }: { payload: Record<string, unknown> }) {
  if (payload.attempt_type === 'content_validation') return <div>
    <Alert type="info">这是内容校验，不是 Baseline / Candidate 效果实验，也不证明 Agent 能力提升。</Alert>
    <p><strong>内容校验：{display(payload.result)}</strong></p>
    <p>检查项目：{Array.isArray(payload.checked) ? payload.checked.join(' / ') : '详见下方证据'}</p>
    <p>原因：{Array.isArray(payload.reasons) ? payload.reasons.join(' / ') : '未提供'}</p>
    {payload.conflict_assessment === 'HUMAN_REVIEW_REQUIRED' && <p>自然语言事实是否准确、是否冲突仍需人工审查。来源引用正确不等于事实已经证实。</p>}
    <p>自动采用资格：{payload.auto_eligible === true ? '须再次核验授权' : '无'}；本次模型调用：{display(payload.model_calls)}</p>
  </div>;
  const cost = object(payload.cost_summary);
  const gate = object(payload.gate);
  const pairs = Array.isArray(payload.pairs) ? payload.pairs.map(object) : [];
  const benchmark = payload.attempt_type === 'benchmark_transfer_evaluation';
  const comparisons = object(payload.comparisons);
  const comparisonArms = ['memory', 'skill', 'memory_skill'].filter(arm => comparisons[arm] !== undefined);
  const costArms = benchmark ? ['vanilla', ...comparisonArms] : ['baseline', 'candidate'];
  return <div>
    {benchmark && <>
      <Alert type="info">这是 EvoAgentBench-compatible 研究评测，不是官方排行榜成绩，也不能直接授权正式 Skill Promotion。</Alert>
      <Table records={comparisonArms.map(arm => { const row = object(comparisons[arm]); return { arm, ...row, counts: object(row.counts) }; })} recordKey="arm" columns={[
        { key: 'arm', header: '进化条件', render: (row: Record<string, unknown>) => row.arm === 'memory_skill' ? 'Memory + Skill' : display(row.arm) },
        { key: 'gain', header: 'Transfer gain', render: (row: Record<string, unknown>) => display(row.transfer_gain) },
        { key: 'fixed', header: 'Newly fixed', render: (row: Record<string, unknown>) => display(object(row.counts).newly_fixed) },
        { key: 'broken', header: 'Newly broken', render: (row: Record<string, unknown>) => display(object(row.counts).newly_broken) },
        { key: 'ci', header: '95% CI', render: (row: Record<string, unknown>) => JSON.stringify(row.paired_bootstrap_95_ci ?? null) },
        { key: 'cost', header: 'Token 成本变化', render: (row: Record<string, unknown>) => display(row.token_cost_change) },
      ]} />
      {payload.factorial !== undefined && <p>组合增益：{JSON.stringify(payload.factorial)}</p>}
      <p>检索覆盖率：{JSON.stringify(payload.retrieval_coverage ?? {})}；污染检查：{JSON.stringify(payload.contamination_findings ?? [])}</p>
    </>}
    {gate.status !== undefined && <p><strong>Gate：{display(gate.status)}</strong>；{JSON.stringify(gate.reasons ?? [])}</p>}
    {Object.keys(cost).length > 0 && <Table records={costArms.map(arm => ({ arm, ...object(cost[arm]) }))} recordKey="arm" columns={[
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
