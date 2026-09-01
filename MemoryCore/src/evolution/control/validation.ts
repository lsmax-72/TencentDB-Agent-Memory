import { z } from "zod";
import type { IMetadataStore } from "../../metadata/store/interface.js";
import type { MetadataService } from "../../metadata/service/metadata-service.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { EvolutionError, type CandidatePayload, type EvolutionRecord } from "./types.js";
import { memorySnapshotHash, type MemoryTargetSnapshot, type SnapshotMemory } from "./memory-snapshot.js";

export interface ValidationReport extends Record<string, unknown> {
  attempt_type: "content_validation";
  result: "PASS" | "FAIL" | "NEEDS_EVIDENCE" | "STALE" | "DUPLICATE_NO_CHANGE";
  reasons: string[];
  auto_eligible: boolean;
  demonstrates_improvement: false;
  model_calls: 0;
}
export interface ValidationDependencies {
  store: EvolutionStore;
  metadata: IMetadataStore;
  permissions: Pick<MetadataService, "checkAssetPermission" | "resolveChatMemoryTargets">;
  snapshotMemory: SnapshotMemory;
  validateWiki?: (candidate: EvolutionRecord, payload: CandidatePayload) => Promise<Record<string, unknown>>;
  canRead: (record: EvolutionRecord) => Promise<boolean>;
}
const payloadSchema = z.object({
  asset_kind: z.enum(["skill", "memory", "wiki"]), target_id: z.string().min(1), base_hash: z.string(),
  base_version: z.number().int().nonnegative().nullable(), before: z.string(), after: z.string().min(1).max(512_000),
  operation: z.enum(["create", "update"]), source_record_ids: z.array(z.string()).min(1),
  layer: z.enum(["L1", "L2", "L3"]).optional(),
}).passthrough();
const memoryFiles = z.array(z.object({ key: z.string(), before: z.string(), after: z.string().min(1).max(512_000), base_hash: z.string() }).strict()).min(1).max(500);

/** Format/provenance/CAS checks only. Arbitrary natural-language truth/conflicts remain human review. */
export async function validateFrozenContent(deps: ValidationDependencies, candidate: EvolutionRecord): Promise<ValidationReport> {
  const report = (result: ValidationReport["result"], reasons: string[], extra: Record<string, unknown> = {}): ValidationReport => ({
    attempt_type: "content_validation", result, reasons, auto_eligible: false, demonstrates_improvement: false, model_calls: 0, ...extra,
  });
  if (candidate.kind !== "candidate" || candidate.origin !== "runtime") throw new EvolutionError(409, "LIVE_CANDIDATE_REQUIRED");
  if (!await deps.canRead(candidate)) throw new EvolutionError(403, "VALIDATION_SOURCE_ACCESS_DENIED");
  const parsed = payloadSchema.safeParse(candidate.payload);
  if (!parsed.success) return report("FAIL", ["CANDIDATE_SCHEMA_INVALID"]);
  const p = parsed.data;
  let autoEligible = false;
  if (contentHash(p.before) !== p.base_hash || p.before === p.after || p.after.includes("\0")) return report("FAIL", ["CANDIDATE_CONTENT_INVALID"]);
  const sources: EvolutionRecord[] = [];
  for (const id of p.source_record_ids) {
    const source = deps.store.get(id);
    if (!source || source.origin !== "runtime" || source.team_id !== candidate.team_id || source.agent_id !== candidate.agent_id || !await deps.canRead(source)) return report("NEEDS_EVIDENCE", ["SOURCE_UNAVAILABLE"]);
    sources.push(source);
  }
  if (p.asset_kind === "skill") return report("NEEDS_EVIDENCE", ["PAIRED_EFFECT_EVALUATION_REQUIRED"]);
  if (p.asset_kind === "wiki") {
    if (!deps.validateWiki) return report("NEEDS_EVIDENCE", ["WIKI_FROZEN_VALIDATOR_BRIDGE_REQUIRED"]);
    const evidence = await deps.validateWiki(candidate, p as CandidatePayload);
    if (!await deps.canRead(candidate)) throw new EvolutionError(403, "VALIDATION_SOURCE_ACCESS_DENIED");
    const maintenanceOnly = evidence.maintenance_only === true;
    return report("PASS", ["WIKI_FROZEN_CONTENT_AND_INDEX_VALIDATED", maintenanceOnly ? "WIKI_MECHANICAL_MAINTENANCE_ONLY" : "WIKI_SEMANTIC_CHANGE_REQUIRES_HUMAN_REVIEW"], {
      auto_eligible: maintenanceOnly,
      checked: ["artifact_hash", "source_paths", "protected_pages", "base_snapshot", "index_rebuild"], ...evidence,
    });
  }
  const target = await deps.metadata.getAssetById(p.target_id);
  if (!target || target.asset_type !== "chat_memory" || target.team_id !== candidate.team_id || !candidate.asset_ids.includes(target.asset_id)) return report("FAIL", ["MEMORY_TARGET_INVALID"]);
  if (!(await deps.permissions.checkAssetPermission({ user_id: candidate.owner_user_id, asset_id: target.asset_id, action: "write" })).allowed) return report("NEEDS_EVIDENCE", ["MEMORY_TARGET_WRITE_DENIED"]);
  const [resolved] = await deps.permissions.resolveChatMemoryTargets([target.asset_id]);
  if (resolved.agent_id !== candidate.agent_id || resolved.team_id !== candidate.team_id) return report("FAIL", ["MEMORY_TARGET_SCOPE_MISMATCH"]);
  const frozen = sources.find(source => source.id === p.target_snapshot_id && source.payload.evidence_type === "memory_snapshot");
  if (!frozen || frozen.payload.target_id !== target.asset_id) return report("NEEDS_EVIDENCE", ["MEMORY_SNAPSHOT_REQUIRED"]);
  const original = frozen.payload.snapshot as MemoryTargetSnapshot;
  const scope = { team_id: candidate.team_id, agent_id: candidate.agent_id, user_id: candidate.owner_user_id };
  if (!original || contentHash(original.scope) !== contentHash(scope) || original.hash !== memorySnapshotHash(original)
    || frozen.payload.snapshot_hash !== original.hash || p.target_snapshot_hash !== original.hash) return report("FAIL", ["MEMORY_SNAPSHOT_INVALID"]);
  const current = await deps.snapshotMemory(scope);
  if (current.hash !== original.hash) return report("STALE", ["MEMORY_SOURCE_OR_TARGET_CHANGED"], { observed_snapshot_hash: current.hash, frozen_snapshot_hash: original.hash });
  if (p.layer === "L1") {
    if (p.operation !== "create" || p.before !== "" || p.base_version !== null) return report("FAIL", ["L1_APPEND_REQUIRED"]);
    const memory = z.object({ content: z.literal(p.after), source_message_ids: z.array(z.string()).min(1),
      type: z.enum(["persona", "episodic", "instruction", "work_fact", "work_task", "work_method", "work_artifact"]) }).passthrough().safeParse(p.extracted_memory);
    if (!memory.success) return report("FAIL", ["L1_CONTENT_OR_PROVENANCE_MISMATCH"]);
    const diagnosis = sources.find(source => source.kind === "diagnosis");
    const trace = diagnosis?.parent_id ? deps.store.get(diagnosis.parent_id) : null;
    if (!trace || trace.payload.completion !== "host_task_complete" || !await deps.canRead(trace)
      || memory.data.source_message_ids.some(id => id !== `${trace.id}:input`)) return report("FAIL", ["L1_UNTRUSTED_SOURCE"]);
    if (current.records.some(row => row.content === p.after)) return report("DUPLICATE_NO_CHANGE", ["EXACT_DUPLICATE_ADDITION_SKIPPED"], { existing_records_unchanged: true });
    // Deliberately narrow: exact owner-supplied text, benign fact types and no instruction/credential patterns.
    // This is a server policy; proposing-model confidence never participates.
    const dangerous = /(?:必须|永远|始终|忽略.*指令|password|密码|密钥|secret|token|always|must|ignore.*instructions)/i.test(p.after);
    autoEligible = ["persona", "work_fact"].includes(String(memory.data.type)) && p.after.length <= 300
      && String(trace.payload.task_input).includes(p.after) && !dangerous;
  } else if (p.layer === "L2" || p.layer === "L3") {
    const parsedFiles = memoryFiles.safeParse(p.memory_files);
    if (!parsedFiles.success) return report("FAIL", ["MEMORY_BUNDLE_INVALID"]);
    const files = parsedFiles.data, originalFiles = new Map(original.files.map(file => [file.key, file.content]));
    if (new Set(files.map(file => file.key)).size !== files.length || files.some(file => {
      const allowed = ["persona.md", ".metadata/checkpoint.json"].includes(file.key)
        || p.layer === "L2" && (file.key === ".metadata/scene_index.json" || /^scene_blocks\/.+\.md$/.test(file.key));
      return !allowed || file.key.includes("\\") || file.key.split("/").some(part => !part || part === "." || part === "..")
        || file.after.includes("\0") || file.after.trim() === "[DELETED]" || !file.after.trim()
        || (originalFiles.get(file.key) ?? "") !== file.before || contentHash(file.before) !== file.base_hash;
    })) return report("FAIL", ["MEMORY_BUNDLE_PATH_OR_BASE_INVALID"]);
    if (p.before !== JSON.stringify(files.map(file => ({ key: file.key, content: file.before })))
      || p.after !== JSON.stringify(files.map(file => ({ key: file.key, content: file.after })))) return report("FAIL", ["MEMORY_BUNDLE_BYTES_MISMATCH"]);
  } else return report("FAIL", ["MEMORY_LAYER_REQUIRED"]);
  if (!await deps.canRead(candidate)) throw new EvolutionError(403, "VALIDATION_SOURCE_ACCESS_DENIED");
  return report("PASS", ["CONTENT_CHECKS_PASSED", ...(autoEligible ? ["LOW_RISK_EXACT_SOURCE_FACT"] : ["SEMANTIC_TRUTH_AND_CONFLICTS_REQUIRE_HUMAN_REVIEW"])], {
    auto_eligible: autoEligible,
    checked: ["format", "source_references", "scope", "target_permissions", "frozen_snapshot", "base_content"],
    observed_snapshot_hash: current.hash, conflict_assessment: "HUMAN_REVIEW_REQUIRED",
  });
}
