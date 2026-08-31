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
const statusNames: Record<string, string> = { FROZEN: '已冻结', VALIDATED: '校验通过', FAIL: '失败', PASS: '通过', INFRA_ERROR: '基础设施异常', RECORDED: '已记录', NEEDS_EVIDENCE: '待补证据', REVIEW_APPROVED: '审查通过 · 未采用', REJECTED: '已拒绝', APPLIED: '已采用', BLOCKED_AUTOMATION_DISABLED: '自动化未启用', BLOCKED_EXECUTOR_UNAVAILABLE: '执行器不可用' };
function statusText(status: string) { return statusNames[status] ?? status; }
function json(value: unknown) { return JSON.stringify(value, null, 2); }

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
  const [detail, setDetail] = useState<{ record: EvolutionRecord; events: unknown[] } | null>(null);
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
        evolutionPost<{ items: EvolutionRecord[]; total: number }>('records/list', { team_id: activeTeamId, kind: listKind, ...(filter ? { asset_kind: filter } : {}), ...(section === 'reviews' && subview !== 'history' ? { statuses: ['FROZEN', 'VALIDATED', 'NEEDS_EVIDENCE'], origin: 'runtime' } : {}), offset: page * 30, limit: 30 }),
      ]);
      if (generation.current !== current) return;
      setOverview(summary); setRecords(list.items); setTotal(list.total);
      if (selectedId) {
        const result = await evolutionPost<{ record: EvolutionRecord; events: unknown[] }>('records/get', { team_id: activeTeamId, id: selectedId });
        if (generation.current === current) setDetail(result);
      }
    } catch (err) { if (generation.current === current) setError(err instanceof Error ? err.message : '加载失败'); }
    finally { if (generation.current === current) setLoading(false); }
  }, [activeTeamId, listKind, section, subview, page, filter, selectedId]);

  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);
  useEffect(() => { setPage(0); setFilter(''); setReason(''); setSubview(''); }, [activeTeamId, section]);

  async function act(action: string, body: Record<string, unknown>) {
    if (!activeTeamId || !detail) return;
    setActing(true); setError('');
    try { await evolutionPost(action, { team_id: activeTeamId, id: detail.record.id, ...body }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setActing(false); }
  }

  const visible = records;
  const candidate = detail?.record;
  const reviewable = candidate?.kind === 'candidate' && candidate.origin === 'runtime' && ['admin', 'reviewer'].includes(role ?? '') && ['FROZEN', 'VALIDATED', 'NEEDS_EVIDENCE'].includes(candidate.status);

  return <div className="evolution-page">
    <header className="evolution-header"><div><h2>{info.title}</h2><p>{info.description}</p></div><Button onClick={() => void load()} loading={loading}>刷新</Button></header>
    {!activeTeamId ? <Alert type="info">请先选择团队；自进化记录按团队与源资产权限隔离。</Alert> : <>
      {error && <Alert type="error">{error}</Alert>}
      {overview && !overview.automation_ready && <Alert type="warning">自动闭环尚未通过运行准入，当前仅开放证据与控制记录。未调用真实模型；没有自动修改正式资产。</Alert>}
      {section === 'overview' && overview && <>
        <div className="evolution-metrics">{[['trace', '运行轨迹'], ['candidate', '候选资产'], ['attempt', '评测记录'], ['adoption', '采用记录']].map(([key, label]) => <div key={key}><span>{label}</span><strong>{overview.counts[key] ?? 0}</strong></div>)}</div>
        <div className="evolution-policy"><h3>当前采用规则</h3><p>Skill：人工采用　|　Memory：低风险自动，其余审查　|　Wiki：维护自动，正文审查</p><p>规则需管理员按 Agent 授权并设置预算后才能启用。Code Graph 沿用原有能力。</p></div>
        {role === 'admin' && <EvolutionSettings key={activeTeamId} teamId={activeTeamId} ready={overview.automation_ready} />}
      </>}
      {section === 'diagnoses' && <div className="evolution-toolbar"><Button onClick={() => { setSubview(''); setPage(0); }}>诊断</Button><Button onClick={() => { setSubview('playbook'); setPage(0); }}>进化经验 Playbook</Button></div>}
      {section === 'reviews' && <div className="evolution-toolbar"><Button onClick={() => { setSubview(''); setPage(0); }}>待审候选</Button><Button onClick={() => { setSubview('history'); setPage(0); }}>审查记录</Button></div>}
      <div className="evolution-toolbar"><span>共 {total} 条记录</span>{section === 'candidates' && <label>资产类型 <Select value={filter} onChange={value => { setFilter(value); setPage(0); }} options={[{ value: '', text: '全部' }, { value: 'skill', text: 'Skill' }, { value: 'memory', text: 'Memory' }, { value: 'wiki', text: 'Wiki' }]} /></label>}</div>
      <Table records={visible} recordKey="id" columns={[
        { key: 'title', header: '记录', render: record => <Button className="evolution-record-link" type="link" onClick={() => setParams({ record: record.id })}>{record.title}</Button> },
        { key: 'kind', header: '类型', render: record => String(record.payload.asset_kind ?? record.kind) },
        { key: 'status', header: '状态', render: record => <Tag>{statusText(record.status)}</Tag> },
        { key: 'origin', header: '证据性质', render: record => origins[record.origin] },
        { key: 'created_at', header: '记录时间', render: record => new Date(record.created_at).toLocaleString() },
      ]} />
      {!loading && !records.length && <div className="evolution-empty"><h3>当前团队暂无可见{info.title}记录</h3><p>这不代表任务全部通过。其他团队或没有读取权限的证据不会在这里显示。</p><p>历史资料需要通过受控导入接入；新记录需要真实任务完成信号。</p></div>}
      <div className="evolution-pagination"><Button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page + 1} 页</span><Button disabled={(page + 1) * 30 >= total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
      {detail && <section className="evolution-detail"><div className="evolution-header"><h3>{detail.record.title}</h3><Button onClick={() => setParams({})}>关闭详情</Button></div>
        <p>{origins[detail.record.origin]} · {statusText(detail.record.status)} · revision {detail.record.revision}</p>
        <p className="evolution-hash">artifact hash：{detail.record.artifact_hash}</p>
        {detail.record.kind === 'attempt' && <EvaluationEvidence payload={detail.record.payload} />}
        {detail.record.parent_id && <Button type="link" onClick={() => setParams({ record: detail.record.parent_id! })}>查看来源记录</Button>}
        {typeof detail.record.payload.before === 'string' && typeof detail.record.payload.after === 'string' && <div className="evolution-diff"><div><h4>基础版本</h4><pre>{detail.record.payload.before}</pre></div><div><h4>冻结候选</h4><pre>{detail.record.payload.after}</pre></div></div>}
        <h4>证据与结果</h4><pre>{json(detail.record.payload)}</pre>
        <h4>操作审计</h4><pre>{json(detail.events)}</pre>
        {candidate?.kind === 'trace' && candidate.origin === 'runtime' && <Button disabled={acting} onClick={() => void act('diagnosis/request', {})}>请求诊断</Button>}
        {reviewable && <div className="evolution-review"><label>审查说明<Input multiline value={reason} onChange={setReason} maxLength={4000} /></label>{[['NEEDS_EVIDENCE', '要求补充证据'], ['REJECTED', '拒绝'], ['REVIEW_APPROVED', '审查通过（不采用）']].map(([decision, label]) => <Button key={decision} disabled={acting || !reason.trim() || (decision === 'REVIEW_APPROVED' && candidate.status !== 'VALIDATED')} onClick={() => void act('review/decide', { decision, reason, revision: candidate.revision })}>{label}</Button>)}</div>}
      </section>}
    </>}
  </div>;
}
