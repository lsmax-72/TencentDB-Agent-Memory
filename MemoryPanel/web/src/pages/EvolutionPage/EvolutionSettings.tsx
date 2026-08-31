import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select } from 'tea-component';
import { useAgents } from '@/services';
import { evolutionPost } from '@/lib/api/evolution';

interface Profile {
  team_id: string; agent_id: string; enabled: boolean; revision: number;
  asset_kinds: string[]; asset_ids: string[]; daily_tokens: number | null;
  daily_model_calls: number | null; daily_candidates: number | null;
  evaluation_profile_id: string | null; auto_memory: boolean; auto_wiki_maintenance: boolean;
  review_model_id?: string | null;
}
export function EvolutionSettings({ teamId, ready }: { teamId: string; ready: boolean }) {
  const { agents } = useAgents(teamId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [agent, setAgent] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [tokens, setTokens] = useState('');
  const [calls, setCalls] = useState('');
  const [candidates, setCandidates] = useState('');
  useEffect(() => {
    let cancelled = false;
    void evolutionPost<{ items: Profile[] }>('profiles/list', { team_id: teamId }).then(result => { if (!cancelled) setProfiles(result.items); }).catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [teamId]);
  function select(id: string) {
    setAgent(id); setMessage('');
    const profile = profiles.find(item => item.agent_id === id);
    setTokens(profile?.daily_tokens == null ? '' : String(profile.daily_tokens));
    setCalls(profile?.daily_model_calls == null ? '' : String(profile.daily_model_calls));
    setCandidates(profile?.daily_candidates == null ? '' : String(profile.daily_candidates));
  }
  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const previous = profiles.find(item => item.agent_id === agent);
      const result = await evolutionPost<Profile>('profiles/save', {
        team_id: teamId, agent_id: agent, enabled: false, revision: previous?.revision ?? 0,
        asset_kinds: previous?.asset_kinds ?? ['skill', 'memory', 'wiki'], asset_ids: previous?.asset_ids ?? [],
        daily_tokens: tokens ? Number(tokens) : null, daily_model_calls: calls ? Number(calls) : null,
        daily_candidates: candidates ? Number(candidates) : null, evaluation_profile_id: previous?.evaluation_profile_id ?? null,
        review_model_id: previous?.review_model_id ?? null,
        auto_memory: previous?.auto_memory ?? false, auto_wiki_maintenance: previous?.auto_wiki_maintenance ?? false,
      });
      setProfiles(current => [...current.filter(item => item.agent_id !== agent), result]);
      setMessage('已保存关闭状态的预算配置，未授权模型调用或正式资产写入。');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <section className="evolution-policy"><h3>Agent 自动化配置</h3>
    <p>{ready ? '请配置允许范围与预算后启用。' : '运行准入尚未完成：可以保存预算草案，暂不能启用自动化。'}</p>
    {error && <Alert type="error">{error}</Alert>}{message && <Alert type="success">{message}</Alert>}
    <div className="evolution-settings"><label>Agent<Select value={agent} onChange={select} placeholder="请选择 Agent" options={agents.map(item => ({ value: item.agent_id, text: item.name }))} /></label>
      <label>每日 token 上限<Input inputMode="numeric" value={tokens} onChange={setTokens} /></label>
      <label>每日模型调用上限<Input inputMode="numeric" value={calls} onChange={setCalls} /></label>
      <label>每日候选上限<Input inputMode="numeric" value={candidates} onChange={setCandidates} /></label>
    </div><Button disabled={!agent} loading={saving} onClick={() => void save()}>保存配置（保持关闭）</Button>
  </section>;
}
