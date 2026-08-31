import { CandidateSkillWorkspace } from "../../core/skill/candidate-skill-workspace.js";
import { SkillExtractor, type ExtractInput, type ExtractorOptions } from "../../core/skill/skill-extractor.js";
import { SKILL_REVIEW_PROMPT } from "../../core/skill/prompts/skill-review-prompt.js";
import { contentHash, EvolutionStore } from "./store.js";
import { EvolutionError, type CandidatePayload, type EvolutionRecord } from "./types.js";

/** Caller must reserve quota and validate source ACL before invoking a model. */
export async function generateSkillProposals(options: ExtractorOptions, input: ExtractInput, source: EvolutionRecord, store: EvolutionStore, allocationId: string): Promise<EvolutionRecord[]> {
  store.assertCandidateAllocation(allocationId, source.team_id, source.agent_id);
  if (!options.runner) throw new EvolutionError(503, "REVIEW_MODEL_UNAVAILABLE");
  if (source.origin !== "runtime" || source.kind !== "diagnosis" || source.payload.route !== "skill_defect") throw new EvolutionError(409, "SKILL_DIAGNOSIS_REQUIRED");
  if (source.team_id !== input.team_id || source.agent_id !== input.agent_id || source.owner_user_id !== input.user_id) throw new EvolutionError(403, "SOURCE_SCOPE_MISMATCH");
  const workspace = new CandidateSkillWorkspace({ official: options.core });
  await new SkillExtractor({ ...options, toolBackend: workspace, systemPrompt: options.systemPrompt ?? SKILL_REVIEW_PROMPT }).extract(input);
  const payloads: CandidatePayload[] = [];
  for (const skillId of workspace.listCandidateSkillIds()) {
    const artifact = workspace.exportCandidate(skillId);
    const before = artifact.operation === "CREATE" ? "" : (await workspace.get({ skill_id: skillId, version: artifact.base_version, team_id: input.team_id, user_id: input.user_id })).content;
    // Merely viewing an existing Skill must not manufacture a candidate.
    if (before === artifact.content) continue;
    payloads.push({
      asset_kind: "skill", target_id: artifact.skill_id, base_hash: contentHash(before), base_version: artifact.base_version,
      before, after: artifact.content, source_record_ids: [source.id], operation: artifact.operation === "CREATE" ? "create" : "update",
      skill_artifact: artifact,
    });
  }
  return freezeCandidates(store, source, payloads, allocationId);
}

export function freezeCandidate(store: EvolutionStore, source: EvolutionRecord, payload: CandidatePayload, allocationId: string): EvolutionRecord {
  return freezeCandidates(store, source, [payload], allocationId)[0];
}

export function freezeCandidates(store: EvolutionStore, source: EvolutionRecord, payloads: CandidatePayload[], allocationId: string): EvolutionRecord[] {
  if (source.origin !== "runtime") throw new EvolutionError(409, "HISTORICAL_SOURCE_NOT_EXECUTABLE");
  if (store.get(source.id)?.artifact_hash !== source.artifact_hash) throw new EvolutionError(409, "SOURCE_SNAPSHOT_CHANGED");
  const entries = payloads.map(payload => {
    if (!payload.source_record_ids.length || !payload.source_record_ids.includes(source.id)) throw new EvolutionError(400, "PROVENANCE_REQUIRED");
    if (payload.before === payload.after) throw new EvolutionError(409, "NO_CONTENT_CHANGE");
    if (contentHash(payload.before) !== payload.base_hash) throw new EvolutionError(409, "BASE_HASH_MISMATCH");
    return { input: {
      team_id: source.team_id, owner_user_id: source.owner_user_id, agent_id: source.agent_id,
      kind: "candidate" as const, title: `${payload.asset_kind} · ${payload.target_id}`, status: "FROZEN", origin: "runtime" as const,
      asset_ids: source.asset_ids, parent_id: source.id, payload,
    }, key: `${source.id}/${payload.asset_kind}/${payload.target_id}/${contentHash(payload)}` };
  });
  return store.commitCandidateBatch(allocationId, source, entries);
}

export interface ContentValidation {
  kind: "content_validation";
  result: "PASS" | "FAIL" | "NEEDS_EVIDENCE";
  reasons: string[];
  auto_eligible: boolean;
  demonstrates_improvement: false;
}

/** Only mechanical, independently checkable changes are automatically eligible. */
export function validateContent(payload: CandidatePayload, evidence: { knownSourceIds: ReadonlySet<string>; confirmedExactFacts?: ReadonlySet<string>; conflictCheckCompleted: boolean; hasConflict: boolean }): ContentValidation {
  const reasons: string[] = [];
  const answer = (result: ContentValidation["result"], auto_eligible = false): ContentValidation => ({ kind: "content_validation", result, reasons, auto_eligible, demonstrates_improvement: false });
  if (contentHash(payload.before) !== payload.base_hash) reasons.push("BASE_HASH_MISMATCH");
  if (!payload.after.trim() || payload.after.length > 512_000 || payload.after.includes("\0")) reasons.push("INVALID_CONTENT");
  if (!payload.source_record_ids.length || payload.source_record_ids.some(ref => !evidence.knownSourceIds.has(ref))) reasons.push("UNVERIFIED_SOURCE");
  if (reasons.length) return answer("FAIL");
  if (payload.asset_kind === "skill") { reasons.push("PAIRED_EFFECT_EVALUATION_REQUIRED"); return answer("NEEDS_EVIDENCE"); }
  if (!evidence.conflictCheckCompleted) { reasons.push("CONFLICT_CHECK_REQUIRED"); return answer("NEEDS_EVIDENCE"); }
  if (evidence.hasConflict) { reasons.push("CONFLICT_REQUIRES_REVIEW"); return answer("PASS"); }
  if (payload.asset_kind === "memory") {
    // Exact facts are supplied by a trusted source verifier, never by the proposing LLM.
    const exactFact = payload.operation === "create" && payload.layer === "L1" && evidence.confirmedExactFacts?.has(payload.after) === true;
    const instructions = /(?:必须|永远|始终|忽略.*指令|密码|密钥|token|password|always|must|ignore.*instructions)/i.test(payload.after);
    if (!exactFact || instructions) reasons.push("SEMANTIC_CHANGE_REQUIRES_REVIEW");
    return answer("PASS", exactFact && !instructions);
  }
  // Wiki body changes always require review. A normalized source union alone is mechanical.
  try {
    const before = JSON.parse(payload.before) as { body: string; sources: string[] };
    const after = JSON.parse(payload.after) as { body: string; sources: string[] };
    const sameKeys = Object.keys(before).sort().join() === "body,sources" && Object.keys(after).sort().join() === "body,sources";
    const mechanical = sameKeys && typeof before.body === "string" && before.body === after.body && Array.isArray(before.sources) && Array.isArray(after.sources)
      && before.sources.every(ref => after.sources.includes(ref)) && after.sources.every(ref => evidence.knownSourceIds.has(ref));
    if (mechanical) return answer("PASS", true);
  } catch { /* Markdown and other semantic content changes require review. */ }
  reasons.push("WIKI_BODY_REQUIRES_REVIEW");
  return answer("PASS");
}
