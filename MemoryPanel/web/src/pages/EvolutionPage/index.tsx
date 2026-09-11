import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Input, Select, Table, Tag } from 'tea-component';
import { useTeams } from '@/services';
import { useCurrentRole } from '@/services/useCurrentRole';
import { useAuthStore } from '@/stores/auth';
import { evolutionPost, type EvolutionOverview, type EvolutionRecord } from '@/lib/api/evolution';
import './style.css';
import { EvaluationEvidence } from './EvaluationEvidence';
import { EvolutionSettings } from './EvolutionSettings';

export const EVOLUTION_SECTIONS = {
  overview: { title: '进化概览', description: '从真实证据了解变化；内容校验通过不等于能力提升。', kind: undefined },
  traces: { title: '运行轨迹', description: '查看任务、工具执行与资产使用记录，追溯每次诊断的来源。', kind: 'trace' },
  diagnoses: { title: '诊断与经验', description: '区分 Skill、记忆、知识与工程问题；Playbook 不进入业务记忆。', kind: 'diagnosis' },
  candidates: { title: '候选资产', description: 'Skill / Memory / Wiki 独立候选；冻结后不修改原内容。', kind: 'candidate' },
  evaluations: { title: '评测中心', description: '查看对照结果、回归、成本和基础设施失败；保留所有 Attempt。', kind: 'attempt' },
  reviews: { title: '人工审查', description: '审批与正式采用分开记录；历史导入与未通过评测的 Skill 不可采用。', kind: 'review' },
} as const;
type Section = keyof typeof EVOLUTION_SECTIONS;
const origins = { runtime: '运行记录', historical: '历史证据 · 只读', offline_test: '离线测试 · 非真实运行' };
const statusNames: Record<string, string> = { FROZEN: '已冻结', TRAIN_ONLY_FROZEN: '训练经验已冻结 · 只读', HISTORICAL_FROZEN: '历史版本已冻结 · 只读', REJECTED_BEFORE_DEVELOPMENT: '开发集评测前已拒绝', APPROVED_FOR_DEVELOPMENT: '允许进入开发集评测 · 只读', VALIDATED: '内容校验通过 · 待审查', VALIDATION_FAILED: '内容校验失败', STALE: '已过期 · 需新版本', DUPLICATE_NO_CHANGE: '重复新增已跳过', SNAPSHOT: '来源快照', QUEUED: '等待执行', RUNNING: '执行中', COMPLETED: '执行完成', RECONCILE_REQUIRED: '中断待核对', FAIL: '失败', PASS: '通过', INFRA_ERROR: '基础设施异常', RECORDED: '已记录', OBSERVED: 'Codex 回合已观测', INTERRUPTED: 'Codex 回合已中断', NEEDS_EVIDENCE: '待补证据', REVIEW_APPROVED: '审查通过 · 未采用', AUTO_AUTHORIZED: '已按限定授权通过 · 未采用', APPLYING: '采用中', REJECTED: '已拒绝', APPLIED: '已采用', BLOCKED_AUTOMATION_DISABLED: '自动化未启用', BLOCKED_EXECUTOR_UNAVAILABLE: '执行器不可用', BLOCKED_BUDGET: '预算不足', BLOCKED_GENERATION: '生成阻塞', BLOCKED_MODEL_CONFIGURATION: '复盘模型未配置', BLOCKED_SOURCE_PERMISSION: '来源权限不足' };
function statusText(status: string) { return statusNames[status] ?? status; }
function recordStatus(record: EvolutionRecord) { return record.payload.attempt_type === 'content_validation' && record.status === 'PASS' ? '内容合格 · 非效果证明' : statusText(record.status); }
function recordOrigin(record: EvolutionRecord) { return record.payload.evidence_mode === 'offline_test' ? origins.offline_test : origins[record.origin]; }
type RecordDetail = { record: EvolutionRecord; events: unknown[]; related?: EvolutionRecord[] };
function json(value: unknown) { return JSON.stringify(value, null, 2); }
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown) { return value === undefined || value === null || value === '' ? '未提供' : String(value); }

function TraceEvidence({ payload }: { payload: Record<string, unknown> }) {
  const usage = object(payload.usage);
  const total = typeof usage.total_tokens === 'number' ? usage.total_tokens
    : typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number' ? usage.input_tokens + usage.output_tokens : undefined;
  const toolEvents = Array.isArray(payload.tool_events) ? payload.tool_events.map(object) : [];
  const usedAssets = object(payload.used_asset_versions);
  const metrics: Array<[string, unknown]> = [['任务结果', payload.outcome], ['实际模型', payload.actual_model], ['输入 tokens', usage.input_tokens], ['输出 tokens', usage.output_tokens], ['总 tokens', total], ['模型调用', usage.model_calls ?? usage.model_call_count], ['工具调用', usage.tool_calls ?? usage.tool_call_count]];
  return <div className="evolution-evidence">
    <div className="evolution-evidence-metrics">
      {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}
    </div>
    <div className="evolution-facts"><span>session：{display(payload.session_id)}</span><span>run：{display(payload.run_id)}</span><span>task：{display(payload.task_id)}</span></div>
    <h4>任务输入</h4><pre>{display(payload.task_input)}</pre>
    <h4>最终输出</h4><pre>{display(payload.final_output)}</pre>
    <h4>工具执行（{toolEvents.length}）</h4>
    {toolEvents.length ? <div className="evolution-tool-list">{toolEvents.map((event, index) => { const result = display(event.result); const resultLooksLikeError = /^\s*(error\b|traceback\b|command blocked\b)/i.test(result); return <div key={`${display(event.sequence)}-${index}`}>
      <div><strong>#{display(event.sequence ?? index + 1)} {display(event.name)}</strong><Tag>{resultLooksLikeError ? '结果含错误' : event.success === true ? '成功' : event.success === false ? '失败' : '未知'}</Tag></div>
      <p>参数</p><pre>{typeof event.arguments === 'string' ? event.arguments : json(event.arguments)}</pre>
      <p>结果</p><pre>{result}</pre>
    </div>; })}</div> : <p className="evolution-muted">本次没有工具调用。</p>}
    <h4>本次实际使用的进化资产</h4>
    <pre>{Object.keys(usedAssets).length ? json(usedAssets) : '无（Vanilla 或未注入候选资产）'}</pre>
  </div>;
}

function CandidateEvidence({ payload }: { payload: Record<string, unknown> }) {
  const usage = object(payload.generation_usage);
  const sourceIds = Array.isArray(payload.source_task_ids) ? payload.source_task_ids : [];
  const findings = Array.isArray(payload.review_findings) ? payload.review_findings : [];
  const metrics: Array<[string, unknown]> = [['资产类型', payload.asset_kind], ['候选 revision', payload.candidate_revision], ['来源任务数', sourceIds.length], ['来源生成 tokens', usage.total_tokens], ['来源生成模型调用', usage.model_calls], ['本次修复模型调用', payload.repair_model_calls]];
  return <div className="evolution-evidence">
    <Alert type="info">这是 train-only 研究候选的只读快照，不是正式 Memory / Skill，也不能从这里采用。</Alert>
    <div className="evolution-evidence-metrics">
      {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}
    </div>
    <div className="evolution-facts"><span>候选 ID：{display(payload.candidate_id)}</span><span>内容 hash：{display(payload.original_content_hash)}</span><span>原 artifact hash：{display(payload.original_artifact_hash)}</span></div>
    <h4>冻结内容</h4><pre>{display(payload.after)}</pre>
    <h4>训练证据来源</h4><p>{sourceIds.length ? sourceIds.join('、') : '未提供'}</p>
    {payload.review_reason !== undefined && <><h4>审查结论</h4><p>{display(payload.review_reason)}</p></>}
    {findings.length > 0 && <><h4>审查发现</h4><pre>{json(findings)}</pre></>}
    {payload.review_action !== undefined && <><h4>原处理决定</h4><p>{display(payload.review_action)}</p></>}
  </div>;
}

export function EvolutionPage({ section }: { section: Section }) {
  const { activeTeamId } = useTeams();
  const { auth } = useAuthStore();
  // Remount before paint when identity/scope changes; never flash the previous team's evidence.
  return <EvolutionPageBody key={`${auth?.user_id}:${activeTeamId}:${section}`} section={section} />;
}

function EvolutionPageBody({ section }: { section: Section }) {
  const { activeTeamId } = useTeams();
  const role = useCurrentRole();
  const [params, setParams] = useSearchParams();
  const [overview, setOverview] = useState<EvolutionOverview | null>(null);
  const [records, setRecords] = useState<EvolutionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const [subview, setSubview] = useState('');
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState('');
  const generation = useRef(0);
  const info = EVOLUTION_SECTIONS[section];
  const selectedId = params.get('record');
  const listKind = section === 'diagnoses' && subview === 'playbook' ? 'playbook' : section === 'reviews' && subview !== 'history' ? 'candidate' : info.kind;

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(''); setLoading(true); setDetail(null); setRecords([]); setOverview(null);
    if (!activeTeamId) { setLoading(false); return; }
    try {
      const [summary, list] = await Promise.all([
        evolutionPost<EvolutionOverview>('overview', { team_id: activeTeamId }),
        evolutionPost<{ items: EvolutionRecord[]; total: number }>('records/list', { team_id: activeTeamId, kind: listKind, ...(filter ? { asset_kind: filter } : {}), ...(section === 'reviews' && subview !== 'history' ? { statuses: ['FROZEN', 'VALIDATED', 'NEEDS_EVIDENCE', 'REVIEW_APPROVED', 'AUTO_AUTHORIZED', 'APPLYING'], origin: 'runtime' } : {}), offset: page * 30, limit: 30 }),
      ]);
      if (generation.current !== current) return;
      setOverview(summary); setRecords(list.items); setTotal(list.total);
      if (selectedId) {
        const result = await evolutionPost<RecordDetail>('records/get', { team_id: activeTeamId, id: selectedId });
        if (generation.current === current) setDetail(result);
      }
    } catch (err) { if (generation.current === current) setError(err instanceof Error ? err.message : '加载失败'); }
    finally { if (generation.current === current) setLoading(false); }
  }, [activeTeamId, listKind, section, subview, page, filter, selectedId]);

  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);
  useEffect(() => { setPage(0); setFilter(''); setReason(''); setSubview(''); }, [activeTeamId, section]);
  useEffect(() => {
    if (!overview || !(overview.statuses.QUEUED || overview.statuses.RUNNING) || acting) return;
    const timer = window.setTimeout(() => void load(), 5000); return () => window.clearTimeout(timer);
  }, [overview, acting, load]);

  async function act(action: string, body: Record<string, unknown>) {
    if (!activeTeamId || !detail) return;
    setActing(true); setError('');
    try { await evolutionPost(action, { team_id: activeTeamId, id: detail.record.id, ...body }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setActing(false); }
  }

  const visible = records;
  const candidate = detail?.record;
  const retryAction = candidate?.kind === 'job' && candidate.origin === 'runtime'
    && (['INFRA_ERROR', 'RECONCILE_REQUIRED', 'NEEDS_EVIDENCE'].includes(candidate.status) || candidate.status.startsWith('BLOCKED_'))
    ? ({ diagnosis: 'diagnosis/retry', proposal: 'generation/retry', validation: 'validation/retry', evaluation: 'evaluation/retry' } as Record<string, string>)[String(candidate.payload.job_type)] : undefined;
  const reviewable = candidate?.kind === 'candidate' && candidate.origin === 'runtime' && ['admin', 'reviewer'].includes(role ?? '') && ['FROZEN', 'VALIDATED', 'NEEDS_EVIDENCE'].includes(candidate.status);
  const effectProof = candidate?.payload.asset_kind === 'skill' && detail?.related?.some(record => record.kind === 'attempt' && record.origin === 'runtime'
    && record.payload.candidate_hash === candidate.artifact_hash && ['paired_evaluation', 'skill_effect_evaluation'].includes(String(record.payload.attempt_type))
    && record.status === 'PASS' && (record.payload.gate_result === 'PASS' || (record.payload.gate as Record<string, unknown> | undefined)?.result === 'PASS')
    && Number(record.payload.newly_fixed) >= 1 && Number(record.payload.newly_broken) === 0);
  const canApprove = candidate?.status === 'VALIDATED' || (candidate?.status === 'NEEDS_EVIDENCE' && effectProof);
  const adoptable = candidate?.kind === 'candidate' && candidate.origin === 'runtime' && role === 'admin' && ['REVIEW_APPROVED', 'AUTO_AUTHORIZED'].includes(candidate.status);
  const reconcilable = candidate?.kind === 'adoption' && candidate.origin === 'runtime' && role === 'admin' && candidate.status === 'RECONCILE_REQUIRED';

  return <div className="evolution-page">
    <header className="evolution-header"><div><h2>{info.title}</h2><p>{info.description}</p></div><Button onClick={() => void load()} loading={loading}>刷新</Button></header>
    {!activeTeamId ? <Alert type="info">请先选择团队；自进化记录按团队与源资产权限隔离。</Alert> : <>
      {error && <Alert type="error">{error}</Alert>}
      {overview && !overview.automation_ready && <Alert type="warning">正式资产自动闭环尚未启用；研究评测可以调用真实模型，具体以运行轨迹为准。当前没有自动修改正式资产。</Alert>}
      {section === 'overview' && overview && <>
        <div className="evolution-metrics">{[['trace', '运行轨迹'], ['candidate', '候选资产'], ['attempt', '评测记录'], ['adoption', '采用记录']].map(([key, label]) => <div key={key}><span>{label}</span><strong>{overview.counts[key] ?? 0}</strong></div>)}</div>
        <div className="evolution-policy"><h3>当前采用规则</h3><p>Skill：人工采用 | Memory：低风险自动，其余审查 | Wiki：维护自动，正文审查</p><p>规则需管理员按 Agent 授权并设置预算后才能启用。Code Graph 沿用原有能力。</p></div>
        {role === 'admin' && <EvolutionSettings key={activeTeamId} teamId={activeTeamId} ready={overview.automation_ready} />}
      </>}
      {section === 'diagnoses' && <div className="evolution-toolbar"><Button onClick={() => { setSubview(''); setPage(0); }}>诊断</Button><Button onClick={() => { setSubview('playbook'); setPage(0); }}>进化经验 Playbook</Button></div>}
      {section === 'reviews' && <div className="evolution-toolbar"><Button onClick={() => { setSubview(''); setPage(0); }}>待审候选</Button><Button onClick={() => { setSubview('history'); setPage(0); }}>审查记录</Button></div>}
      <div className="evolution-toolbar"><span>共 {total} 条记录</span>{section === 'candidates' && <label>资产类型 <Select value={filter} onChange={value => { setFilter(value); setPage(0); }} options={[{ value: '', text: '全部' }, { value: 'skill', text: 'Skill' }, { value: 'memory', text: 'Memory' }, { value: 'wiki', text: 'Wiki' }]} /></label>}</div>
      <Table records={visible} recordKey="id" columns={[
        { key: 'title', header: '记录', render: record => <Button className="evolution-record-link" type="link" onClick={() => setParams({ record: record.id })}>{record.title}</Button> },
        { key: 'kind', header: '类型', render: record => String(record.payload.asset_kind ?? record.kind) },
        { key: 'status', header: '状态', render: record => <Tag>{recordStatus(record)}</Tag> },
        { key: 'origin', header: '证据性质', render: record => recordOrigin(record) },
        { key: 'created_at', header: '记录时间', render: record => new Date(record.created_at).toLocaleString() },
      ]} />
      {!loading && !records.length && <div className="evolution-empty"><h3>当前团队暂无可见{info.title}记录</h3><p>这不代表任务全部通过。其他团队或没有读取权限的证据不会在这里显示。</p><p>历史资料需要通过受控导入接入；新记录需要真实任务完成信号。</p></div>}
      <div className="evolution-pagination"><Button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page + 1} 页</span><Button disabled={(page + 1) * 30 >= total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
      {detail && <section className="evolution-detail"><div className="evolution-header"><h3>{detail.record.title}</h3><Button onClick={() => setParams({})}>关闭详情</Button></div>
        <p>{recordOrigin(detail.record)} · {recordStatus(detail.record)} · revision {detail.record.revision}</p>
        <p className="evolution-hash">artifact hash：{detail.record.artifact_hash}</p>
        {detail.record.payload.evidence_mode === 'observation' && <Alert type="info">这是 Codex 回合观测，不代表业务任务已经完成，也不会自动触发诊断或候选生成。</Alert>}
        {detail.record.kind === 'attempt' && <EvaluationEvidence payload={detail.record.payload} />}
        {detail.record.kind === 'trace' && <TraceEvidence payload={detail.record.payload} />}
        {detail.record.kind === 'candidate' && <CandidateEvidence payload={detail.record.payload} />}
        {detail.record.parent_id && <Button type="link" onClick={() => setParams({ record: detail.record.parent_id! })}>查看来源记录</Button>}
        {!!detail.related?.length && <div className="evolution-toolbar"><span>后续记录：</span>{detail.related.map(record => <Button className="evolution-record-link" key={record.id} type="link" onClick={() => setParams({ record: record.id })}>{record.title} · {recordStatus(record)}</Button>)}</div>}
        {typeof detail.record.payload.before === 'string' && typeof detail.record.payload.after === 'string' && <div className="evolution-diff"><div><h4>基础版本</h4><pre>{detail.record.payload.before}</pre></div><div><h4>冻结候选</h4><pre>{detail.record.payload.after}</pre></div></div>}
        <details className="evolution-raw"><summary>查看原始证据 JSON</summary><pre>{json(detail.record.payload)}</pre></details>
        <details className="evolution-raw"><summary>查看操作审计 JSON</summary><pre>{json(detail.events)}</pre></details>
        {candidate?.kind === 'trace' && candidate.origin === 'runtime' && candidate.payload.completion === 'host_task_complete' && <Button disabled={acting} onClick={() => void act('diagnosis/request', {})}>请求诊断</Button>}
        {candidate?.kind === 'candidate' && candidate.origin === 'runtime' && ['FROZEN', 'NEEDS_EVIDENCE', 'VALIDATION_FAILED'].includes(candidate.status) && <Button disabled={acting} onClick={() => void act('validation/request', {})}>检查内容与来源</Button>}
        {candidate?.kind === 'candidate' && candidate.origin === 'runtime' && candidate.payload.asset_kind === 'skill' && ['FROZEN', 'NEEDS_EVIDENCE'].includes(candidate.status) && <Button disabled={acting} onClick={() => void act('evaluation/request', {})}>运行 Baseline / Candidate 对照评测</Button>}
        {retryAction && <div className="evolution-review"><p>重试会保留原失败，创建独立任务；模型重试可能再次消耗预算。</p><Button disabled={acting} onClick={() => void act(retryAction, { request_id: crypto.randomUUID() })}>创建独立重试</Button></div>}
        {reviewable && <div className="evolution-review"><label>审查说明<Input multiline value={reason} onChange={setReason} maxLength={4000} /></label>{[['NEEDS_EVIDENCE', '要求补充证据'], ['REJECTED', '拒绝'], ['REVIEW_APPROVED', '审查通过（不采用）']].map(([decision, label]) => <Button key={decision} disabled={acting || !reason.trim() || (decision === 'REVIEW_APPROVED' && !canApprove)} onClick={() => void act('review/decide', { decision, reason, revision: candidate.revision })}>{label}</Button>)}</div>}
        {adoptable && <div className="evolution-review"><Alert type="warning">采用会修改正式资产。服务端会再次核验权限、冻结 hash、基础版本和校验/评测回执；内容变化后会拒绝。</Alert><Button disabled={acting} onClick={() => void act('adoption/apply', { revision: candidate.revision })}>采用冻结版本</Button></div>}
        {reconcilable && <div className="evolution-review"><p>上次写入结果未知。这里只做只读核对，不会再次写入或创建重复版本。</p><Button disabled={acting} onClick={() => void act('adoption/reconcile', {})}>核对采用结果</Button></div>}
      </section>}
    </>}
  </div>;
}
