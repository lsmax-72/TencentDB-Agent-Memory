/** Control-plane records are deliberately separate from injectable assets. */
export type AssetKind = "skill" | "memory" | "wiki";
export type RecordKind = "trace" | "diagnosis" | "candidate" | "attempt" | "review" | "adoption" | "playbook" | "job";
export type EvidenceOrigin = "runtime" | "historical" | "offline_test";
export interface EvolutionRecord {
  id: string;
  team_id: string;
  owner_user_id: string;
  agent_id: string;
  kind: RecordKind;
  title: string;
  status: string;
  origin: EvidenceOrigin;
  asset_ids: string[];
  parent_id?: string;
  payload: Record<string, unknown>;
  artifact_hash: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface EvolutionProfile {
  team_id: string;
  agent_id: string;
  enabled: boolean;
  asset_kinds: AssetKind[];
  asset_ids: string[];
  daily_tokens: number | null;
  daily_model_calls: number | null;
  daily_candidates: number | null;
  evaluation_profile_id: string | null;
  auto_memory: boolean;
  auto_wiki_maintenance: boolean;
  authorized_by: string;
  revision: number;
  updated_at: string;
}
export interface CandidatePayload extends Record<string, unknown> {
  asset_kind: AssetKind;
  target_id: string;
  base_hash: string;
  base_version: number | null;
  before: string;
  after: string;
  source_record_ids: string[];
  operation: "create" | "update";
  layer?: "L1" | "L2" | "L3";
}
export class EvolutionError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}
