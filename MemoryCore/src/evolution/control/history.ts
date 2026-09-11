import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, relative, isAbsolute } from "node:path";
import { EvolutionError } from "./types.js";
import { contentHash, EvolutionStore } from "./store.js";
import { sha256 } from "../evaluation/contracts/hash.js";

type Scope = { team_id: string; agent_id: string; owner_user_id: string };
type HistoricalCandidate = {
  asset_kind: "skill" | "memory";
  candidate_id: string;
  candidate_revision: number;
  status: string;
  content: Record<string, unknown>;
  content_hash: string;
  artifact_hash: string;
  source_task_ids: string[];
  source_evidence_hashes?: string[];
  source_status?: string;
  derived_from_candidate_id?: string;
  support_evidence?: unknown[];
  generation_usage?: Record<string, unknown>;
  active_model_calls?: number;
  repair_model_calls?: number;
  review_reason?: string;
  review_findings?: unknown[];
  review_action?: string;
  train_only: true;
  research_only: true;
  promotion_allowed: false;
};
const hashPattern = /^[a-f0-9]{64}$/;

function importRefinementBundle(store: EvolutionStore, data: Record<string, any>, sourceName: string, sourceHash: string, scope: Scope) {
  const expectedBundle = { ...data };
  delete expectedBundle.bundle_hash;
  if (!hashPattern.test(data.bundle_hash) || contentHash(expectedBundle) !== data.bundle_hash) throw new EvolutionError(400, "HISTORY_BUNDLE_HASH_MISMATCH");
  if (data.protocol_id !== "tdai-evoagentbench-code-v1" || !hashPattern.test(data.protocol_hash)) throw new EvolutionError(400, "HISTORY_PROTOCOL_INVALID");
  if (!Array.isArray(data.candidates) || data.candidates.length < 1 || data.candidates.length > 100 || data.candidate_count !== data.candidates.length) throw new EvolutionError(400, "HISTORY_CANDIDATE_COUNT_INVALID");
  const artifactHashes = new Set((Array.isArray(data.source_revisions) ? data.source_revisions : []).map((row: Record<string, unknown>) => row.artifact_hash));
  if (!artifactHashes.size || [...artifactHashes].some(value => typeof value !== "string" || !hashPattern.test(value))) throw new EvolutionError(400, "HISTORY_REVISION_HASH_INVALID");

  return (data.candidates as HistoricalCandidate[]).map(candidate => {
    if (!candidate || !["memory", "skill"].includes(candidate.asset_kind) || typeof candidate.candidate_id !== "string" || candidate.candidate_id.length > 160
      || !Number.isSafeInteger(candidate.candidate_revision) || candidate.candidate_revision < 1
      || !["TRAIN_ONLY_FROZEN", "REJECTED_BEFORE_DEVELOPMENT", "APPROVED_FOR_DEVELOPMENT"].includes(candidate.status)
      || !candidate.content || typeof candidate.content !== "object" || Array.isArray(candidate.content)
      || !hashPattern.test(candidate.content_hash) || contentHash(candidate.content) !== candidate.content_hash
      || !hashPattern.test(candidate.artifact_hash) || !artifactHashes.has(candidate.artifact_hash)
      || !Array.isArray(candidate.source_task_ids) || candidate.source_task_ids.length < 1 || candidate.source_task_ids.length > 100
      || candidate.source_task_ids.some(value => typeof value !== "string" || value.length > 160)
      || candidate.train_only !== true || candidate.research_only !== true || candidate.promotion_allowed !== false) {
      throw new EvolutionError(400, "HISTORY_CANDIDATE_INVALID");
    }
    const expectedKeys = candidate.asset_kind === "memory"
      ? ["task_intent", "approach", "key_insight", "applicability"]
      : ["name", "description", "content"];
    if (Object.keys(candidate.content).sort().join("/") !== [...expectedKeys].sort().join("/")
      || expectedKeys.some(key => typeof candidate.content[key] !== "string" || !candidate.content[key] || String(candidate.content[key]).length > 12_000)) {
      throw new EvolutionError(400, "HISTORY_CANDIDATE_CONTENT_INVALID");
    }
    const after = candidate.asset_kind === "memory"
      ? `任务意图：${candidate.content.task_intent}\n\n方法：${candidate.content.approach}\n\n关键经验：${candidate.content.key_insight}\n\n适用范围：${candidate.content.applicability}`
      : `# ${candidate.content.name}\n\n${candidate.content.description}\n\n${candidate.content.content}`;
    return store.append({ ...scope, kind: "candidate", title: `${candidate.candidate_id} · ${candidate.asset_kind === "memory" ? "训练经验" : "Skill 候选"}`, status: candidate.status,
      origin: "historical", asset_ids: [], payload: {
        asset_kind: candidate.asset_kind, candidate_id: candidate.candidate_id, candidate_revision: candidate.candidate_revision,
        after, frozen_content: candidate.content, source_task_ids: candidate.source_task_ids,
        source_evidence_hashes: candidate.source_evidence_hashes, source_status: candidate.source_status,
        derived_from_candidate_id: candidate.derived_from_candidate_id, support_evidence: candidate.support_evidence,
        generation_usage: candidate.generation_usage, active_model_calls: candidate.active_model_calls, repair_model_calls: candidate.repair_model_calls,
        review_reason: candidate.review_reason,
        review_findings: candidate.review_findings, review_action: candidate.review_action,
        protocol_id: data.protocol_id, protocol_hash: data.protocol_hash,
        source_name: sourceName, source_hash: sourceHash, import_format: data.schema,
        original_artifact_hash: candidate.artifact_hash, original_content_hash: candidate.content_hash,
        train_only: true, research_only: true, promotion_allowed: false,
        evidence_limitations: data.evidence_limitations,
      },
    }, `${data.bundle_hash}/${candidate.asset_kind}/${candidate.candidate_id}/${candidate.content_hash}`, scope.owner_user_id);
  });
}

/** CLI-only ingestion. No HTTP action accepts filesystem paths or bypasses source ACLs. */
export function importHistoricalEvolutionRecords(store: EvolutionStore, filename: string, approvedRoot: string, scope: Scope) {
  const root = realpathSync(approvedRoot);
  const file = realpathSync(filename);
  const child = relative(root, file);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new EvolutionError(403, "HISTORY_PATH_REJECTED");
  if (statSync(file).size > 16 * 1024 * 1024) throw new EvolutionError(413, "HISTORY_TOO_LARGE");
  const bytes = readFileSync(file);
  const source_hash = createHash("sha256").update(bytes).digest("hex");
  const data = JSON.parse(bytes.toString("utf8"));
  if (data.schema === "tdai-evoagentbench-refinement-export-v1") return importRefinementBundle(store, data, basename(file), source_hash, scope);
  if (data.candidate_id && data.artifact?.content && data.controls?.baseline?.content) {
    const after = String(data.artifact.content), before = String(data.controls.baseline.content);
    if (sha256(after) !== data.artifact.content_hash) throw new EvolutionError(400, "HISTORY_CONTENT_HASH_MISMATCH");
    return [store.append({ ...scope, kind: "candidate", title: `${data.candidate_id} · 历史冻结版本`, status: "HISTORICAL_FROZEN",
      origin: "historical", asset_ids: [], payload: {
        asset_kind: "skill", candidate_id: data.candidate_id, before, after,
        source_name: basename(file), source_hash, import_format: "phase5-freeze-v1",
        original_artifact_hash: data.artifact.artifact_hash, original_content_hash: data.artifact.content_hash,
        base_version: data.base_version, base_skill_id: data.base_skill_id, frozen_at: data.frozen_at,
        parent_candidate: data.parent_candidate, created_from_evaluation_attempt: data.created_from_evaluation_attempt,
        evidence_limitations: ["历史冻结快照，不是采用授权；原 Gate 结论见评测中心", "历史候选不能触发正式采用"],
      },
    }, `${data.candidate_id}/${source_hash}`, scope.owner_user_id)];
  }
  const attempt = data.attempt;
  if (!attempt?.attempt_id || !attempt.result?.gate || !Array.isArray(attempt.paired_results)) throw new EvolutionError(400, "UNSUPPORTED_HISTORY_FORMAT");
  const status = attempt.result.gate.status;
  if (!["PASS", "FAIL", "INFRA_ERROR"].includes(status)) throw new EvolutionError(400, "INVALID_HISTORICAL_GATE");
  // Project explicit result fields. Raw prompts, workspace paths and credentials never get imported.
  const arm = (run: Record<string, unknown>) => ({ run_id: run.run_id, status: run.status,
    usage: run.usage, run_spec_fingerprints: run.run_spec_fingerprints });
  const pairs = attempt.paired_results.map((pair: Record<string, any>) => ({
    case_ref: pair.case_ref, critical: pair.critical, classification: pair.classification,
    baseline: arm(pair.baseline ?? {}), candidate: arm(pair.candidate ?? {}), fairness: pair.fairness, cost_delta: pair.cost_delta,
  }));
  return [store.append({ ...scope, kind: "attempt", title: `${attempt.candidate_id} · ${attempt.attempt_id}`, status,
    origin: "historical", asset_ids: [], payload: {
      asset_kind: "skill", source_name: basename(file), source_hash, import_format: "phase5-evaluation-v1",
      attempt_id: attempt.attempt_id, candidate_id: attempt.candidate_id, candidate_artifact_hash: attempt.candidate_artifact_hash,
      baseline_artifact_hash: attempt.baseline_artifact_hash, suite_ref: attempt.suite_ref,
      gate: attempt.result.gate, comparison_summary: attempt.result.comparison_summary,
      cost_summary: attempt.result.cost_summary, pairs,
      evidence_limitations: ["仅导入结果字段；原始 trace 未导入", "历史导入只读，不能据此采用候选"],
    },
  }, `${attempt.attempt_id}/${source_hash}`, scope.owner_user_id)];
}

/** Backward-compatible singular helper for the original one-record formats. */
export function importHistoricalEvaluation(store: EvolutionStore, filename: string, approvedRoot: string, scope: Scope) {
  const records = importHistoricalEvolutionRecords(store, filename, approvedRoot, scope);
  if (records.length !== 1) throw new EvolutionError(400, "HISTORY_MULTIPLE_RECORDS_REQUIRE_BATCH_IMPORT");
  return records[0];
}
