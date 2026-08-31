import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, relative, isAbsolute } from "node:path";
import { EvolutionError } from "./types.js";
import { EvolutionStore } from "./store.js";
import { sha256 } from "../evaluation/contracts/hash.js";

type Scope = { team_id: string; agent_id: string; owner_user_id: string };
/** CLI-only ingestion. No HTTP action accepts filesystem paths or bypasses source ACLs. */
export function importHistoricalEvaluation(store: EvolutionStore, filename: string, approvedRoot: string, scope: Scope) {
  const root = realpathSync(approvedRoot);
  const file = realpathSync(filename);
  const child = relative(root, file);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new EvolutionError(403, "HISTORY_PATH_REJECTED");
  if (statSync(file).size > 16 * 1024 * 1024) throw new EvolutionError(413, "HISTORY_TOO_LARGE");
  const bytes = readFileSync(file);
  const source_hash = createHash("sha256").update(bytes).digest("hex");
  const data = JSON.parse(bytes.toString("utf8"));
  if (data.candidate_id && data.artifact?.content && data.controls?.baseline?.content) {
    const after = String(data.artifact.content), before = String(data.controls.baseline.content);
    if (sha256(after) !== data.artifact.content_hash) throw new EvolutionError(400, "HISTORY_CONTENT_HASH_MISMATCH");
    return store.append({ ...scope, kind: "candidate", title: `${data.candidate_id} · 历史冻结版本`, status: "HISTORICAL_FROZEN",
      origin: "historical", asset_ids: [], payload: {
        asset_kind: "skill", candidate_id: data.candidate_id, before, after,
        source_name: basename(file), source_hash, import_format: "phase5-freeze-v1",
        original_artifact_hash: data.artifact.artifact_hash, original_content_hash: data.artifact.content_hash,
        base_version: data.base_version, base_skill_id: data.base_skill_id, frozen_at: data.frozen_at,
        parent_candidate: data.parent_candidate, created_from_evaluation_attempt: data.created_from_evaluation_attempt,
        evidence_limitations: ["历史冻结快照，不是采用授权；原 Gate 结论见评测中心", "历史候选不能触发正式采用"],
      },
    }, `${data.candidate_id}/${source_hash}`, scope.owner_user_id);
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
  return store.append({ ...scope, kind: "attempt", title: `${attempt.candidate_id} · ${attempt.attempt_id}`, status,
    origin: "historical", asset_ids: [], payload: {
      asset_kind: "skill", source_name: basename(file), source_hash, import_format: "phase5-evaluation-v1",
      attempt_id: attempt.attempt_id, candidate_id: attempt.candidate_id, candidate_artifact_hash: attempt.candidate_artifact_hash,
      baseline_artifact_hash: attempt.baseline_artifact_hash, suite_ref: attempt.suite_ref,
      gate: attempt.result.gate, comparison_summary: attempt.result.comparison_summary,
      cost_summary: attempt.result.cost_summary, pairs,
      evidence_limitations: ["仅导入结果字段；原始 trace 未导入", "历史导入只读，不能据此采用候选"],
    },
  }, `${attempt.attempt_id}/${source_hash}`, scope.owner_user_id);
}
