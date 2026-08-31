import { request } from './base';
import { getPanelSession } from '../panelSession';

export interface EvolutionRecord {
  id: string; team_id: string; owner_user_id: string; agent_id: string;
  kind: string; title: string; status: string; origin: 'runtime' | 'historical' | 'offline_test';
  asset_ids: string[]; parent_id?: string; payload: Record<string, unknown>;
  artifact_hash: string; revision: number; created_at: string; updated_at: string;
}
export interface EvolutionOverview {
  records: number; counts: Record<string, number>; statuses: Record<string, number>;
  automation_ready: boolean; runtime_status: string; notices: string[];
}
export async function evolutionPost<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const session = getPanelSession();
  if (!session) throw new Error('请先登录 MemoryHub');
  const envelope = await request<{ code: number; message: string; data: T }>('POST', `/api/v1/evolution/${action}`, body, {
    'X-Tdai-Service-Id': session.instanceId, 'X-Tdai-User-Key': session.userKey,
  });
  if (envelope.code !== 0) throw new Error(envelope.message);
  return envelope.data;
}
