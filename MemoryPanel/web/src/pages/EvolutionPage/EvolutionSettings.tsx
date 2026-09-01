import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select } from 'tea-component';
import { useAgents } from '@/services';
import { evolutionPost } from '@/lib/api/evolution';

type AssetKind = 'skill' | 'memory' | 'wiki';
interface Profile {
  team_id: string; agent_id: string; enabled: boolean; revision: number;
  asset_kinds: AssetKind[]; asset_ids: string[]; daily_tokens: number | null;
  daily_model_calls: number | null; daily_candidates: number | null;
  evaluation_profile_id: string | null; auto_memory: boolean; auto_wiki_maintenance: boolean;
  review_model_id?: string | null;
}
interface Options {
  assets: Array<{ id: string; name: string; asset_kind: AssetKind }>;
  review_model_ids: string[]; evaluation_profile_ids: string[]; adoption_kinds: AssetKind[]; automation_ready: boolean;
}
const kindNames: Record<AssetKind, string> = { skill: 'Skill', memory: 'Memory', wiki: 'Wiki' };

export function EvolutionSettings({ teamId, ready }: { teamId: string; ready: boolean }) {
  const { agents } = useAgents(teamId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [agent, setAgent] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false); const [loadingOptions, setLoadingOptions] = useState(false);
  const [tokens, setTokens] = useState(''); const [calls, setCalls] = useState(''); const [candidates, setCandidates] = useState('');
  const [enabled, setEnabled] = useState(false); const [kinds, setKinds] = useState<AssetKind[]>([]); const [assetIds, setAssetIds] = useState<string[]>([]);
  const [reviewModel, setReviewModel] = useState(''); const [evaluationProfile, setEvaluationProfile] = useState('');
  const [autoMemory, setAutoMemory] = useState(false); const [autoWiki, setAutoWiki] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void evolutionPost<{ items: Profile[] }>('profiles/list', { team_id: teamId }).then(result => { if (!cancelled) setProfiles(result.items); }).catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [teamId]);

  async function select(id: string) {
    setAgent(id); setMessage(''); setError(''); setOptions(null); setLoadingOptions(true);
    const profile = profiles.find(item => item.agent_id === id);
    setTokens(profile?.daily_tokens == null ? '' : String(profile.daily_tokens)); setCalls(profile?.daily_model_calls == null ? '' : String(profile.daily_model_calls));
    setCandidates(profile?.daily_candidates == null ? '' : String(profile.daily_candidates)); setEnabled(profile?.enabled ?? false);
    setKinds(profile?.asset_kinds ?? []); setAssetIds(profile?.asset_ids ?? []); setReviewModel(profile?.review_model_id ?? '');
    setEvaluationProfile(profile?.evaluation_profile_id ?? ''); setAutoMemory(profile?.auto_memory ?? false); setAutoWiki(profile?.auto_wiki_maintenance ?? false);
    try { setOptions(await evolutionPost<Options>('profiles/options', { team_id: teamId, agent_id: id })); }
    catch (err) { setError(err instanceof Error ? err.message : '加载可用范围失败'); }
    finally { setLoadingOptions(false); }
  }
  function toggle<T extends string>(items: T[], item: T): T[] { return items.includes(item) ? items.filter(value => value !== item) : [...items, item]; }
  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const previous = profiles.find(item => item.agent_id === agent);
      const result = await evolutionPost<Profile>('profiles/save', {
        team_id: teamId, agent_id: agent, enabled, revision: previous?.revision ?? 0,
        asset_kinds: kinds, asset_ids: assetIds, daily_tokens: tokens ? Number(tokens) : null,
        daily_model_calls: calls ? Number(calls) : null, daily_candidates: candidates ? Number(candidates) : null,
        evaluation_profile_id: evaluationProfile || null, review_model_id: reviewModel || null,
        auto_memory: autoMemory, auto_wiki_maintenance: autoWiki,
      });
      setProfiles(current => [...current.filter(item => item.agent_id !== agent), result]);
      setMessage(result.enabled ? '治理已启用：任务完成后会按授权范围与预算运行；正式采用仍遵循风险规则。' : '配置已保存且保持关闭，不会调用模型或修改正式资产。');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  }

  const effectiveReady = ready && options?.automation_ready;
  return <section className="evolution-policy"><h3>Agent 自进化配置</h3>
    <p>{effectiveReady ? '管理员可限定资产、模型绑定、评测配置与每日预算；后台每次执行仍会重新核验。' : '运行准入尚未完成：只能保存关闭状态，不能启动模型或正式资产写入。'}</p>
    {error && <Alert type="error">{error}</Alert>}{message && <Alert type="success">{message}</Alert>}
    <div className="evolution-settings"><label>Agent<Select value={agent} onChange={value => void select(value)} placeholder="请选择 Agent" options={agents.map(item => ({ value: item.agent_id, text: item.name }))} /></label>
      <label>每日 token 上限<Input inputMode="numeric" value={tokens} onChange={setTokens} /></label>
      <label>每日模型调用上限<Input inputMode="numeric" value={calls} onChange={setCalls} /></label>
      <label>每日候选上限<Input inputMode="numeric" value={candidates} onChange={setCandidates} /></label>
      <label>复盘模型绑定<Select value={reviewModel} onChange={setReviewModel} placeholder="请选择服务端绑定" options={(options?.review_model_ids ?? []).map(value => ({ value, text: value }))} /></label>
      <label>Skill 评测配置<Select value={evaluationProfile} onChange={setEvaluationProfile} placeholder="Skill 治理时必选" options={(options?.evaluation_profile_ids ?? []).map(value => ({ value, text: value }))} /></label>
    </div>
    {options && <><h4>治理资产类型</h4><div className="evolution-checks">{(['skill', 'memory', 'wiki'] as AssetKind[]).map(kind => <Checkbox key={kind} value={kinds.includes(kind)} disabled={!options.adoption_kinds.includes(kind)} onChange={() => setKinds(toggle(kinds, kind))}>{kindNames[kind]}</Checkbox>)}</div>
      <h4>仅限该 Agent 已绑定且当前管理员可写的资产</h4><div className="evolution-asset-list">{options.assets.map(asset => <Checkbox key={asset.id} value={assetIds.includes(asset.id)} onChange={() => setAssetIds(toggle(assetIds, asset.id))}>{kindNames[asset.asset_kind]} · {asset.name} <span>{asset.id}</span></Checkbox>)}{!options.assets.length && <p>没有可治理的已绑定资产。</p>}</div>
      <h4>有限自动采用</h4><div className="evolution-checks"><Checkbox value={autoMemory} onChange={setAutoMemory}>Memory：仅逐字可核验的低风险 L1 事实</Checkbox><Checkbox value={autoWiki} onChange={setAutoWiki}>Wiki：仅正文不变的引用维护</Checkbox></div>
      <div className="evolution-checks"><Checkbox value={enabled} disabled={!effectiveReady} onChange={setEnabled}>启用该 Agent 的自进化治理</Checkbox></div></>}
    <Button disabled={!agent || loadingOptions || (enabled && !effectiveReady)} loading={saving || loadingOptions} onClick={() => void save()}>{enabled ? '保存并启用治理' : '保存配置（保持关闭）'}</Button>
  </section>;
}
