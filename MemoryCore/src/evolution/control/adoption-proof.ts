import type { EvolutionStore } from "./store.js";
import type { AssetKind, EvolutionRecord } from "./types.js";

function children(store: EvolutionStore, candidate: EvolutionRecord): EvolutionRecord[] {
  return store.list(candidate.team_id, "attempt").filter(record => record.origin === "runtime"
    && record.parent_id === candidate.id && record.payload.candidate_hash === candidate.artifact_hash);
}

/** Status labels are not evidence. Adoption resolves an immutable runtime receipt tied to the exact candidate hash. */
export function adoptionProof(store: EvolutionStore, candidate: EvolutionRecord): EvolutionRecord | null {
  const attempts = children(store, candidate);
  if (candidate.payload.asset_kind === "skill") {
    return attempts.find(record => {
      const type = record.payload.attempt_type;
      const gate = record.payload.gate_result ?? (record.payload.gate as Record<string, unknown> | undefined)?.result;
      return ["paired_evaluation", "skill_effect_evaluation"].includes(String(type)) && record.status === "PASS" && gate === "PASS"
        && Number(record.payload.newly_fixed) >= 1 && Number(record.payload.newly_broken) === 0;
    }) ?? null;
  }
  return attempts.find(record => record.payload.attempt_type === "content_validation" && record.status === "PASS"
    && record.payload.result === "PASS" && record.payload.demonstrates_improvement === false) ?? null;
}

export function expectedMetadataAssetType(kind: AssetKind): "skill" | "chat_memory" | "llm_wiki" {
  return kind === "skill" ? "skill" : kind === "memory" ? "chat_memory" : "llm_wiki";
}
