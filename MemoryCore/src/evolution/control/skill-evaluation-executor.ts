import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { SkillCore } from "../../core/skill/skill-core.js";
import type { CandidateArtifact } from "../../core/skill/candidate-types.js";
import { NanobotAgentAdapter } from "../evaluation/adapters/nanobot-agent-adapter.js";
import { candidateToEvaluationArtifact, loadOfficialEvaluationArtifact } from "../evaluation/adapters/tencentdb-skill-artifacts.js";
import { hashCanonical } from "../evaluation/contracts/hash.js";
import type { EvaluationAttempt } from "../evaluation/contracts/types.js";
import { AcceptanceFixtureAdapter, PHASE5_REAL_LIMITS, acceptanceCaseSet, makeAcceptanceSuite, makeNanobotRunSpecFactory } from "../evaluation/fixtures/acceptance-cases.js";
import { MinimalEvaluationRunner } from "../evaluation/runner/minimal-runner.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionProfile, type EvolutionRecord } from "./types.js";

const configSchema = z.object({
  id: z.string().min(1).max(180), instance_id: z.string().min(1), team_id: z.string().min(1), agent_id: z.string().min(1),
  suite_kind: z.literal("AC_REGRESSION_V1"), python_executable: z.string().min(1), nanobot_repo: z.string().min(1),
  nanobot_config: z.string().min(1), model_preset: z.string().min(1), provider: z.string().min(1), model_id: z.string().min(1),
}).strict();
type EvaluationConfig = z.infer<typeof configSchema>;
export interface SkillEvaluationBinding { id: string; fingerprint: string; execute(candidate: EvolutionRecord, job: EvolutionRecord, profile: EvolutionProfile): Promise<EvaluationAttempt> }
export type ResolveSkillEvaluation = (profile: EvolutionProfile) => SkillEvaluationBinding | null;

function privateFile(path: string, max: number): void {
  if (!isAbsolute(path)) throw new Error("absolute path required");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max || (stat.mode & 0o077) !== 0) throw new Error("private regular file required");
}
function executableFile(path: string): void {
  if (!isAbsolute(path)) throw new Error("absolute executable required");
  const stat = statSync(realpathSync(path));
  if (!stat.isFile() || (stat.mode & 0o111) === 0) throw new Error("executable required");
}

/** Operator-owned fixed runner configuration; no command, path, model or suite is accepted from HTTP. */
export function fileSkillEvaluationBindings(path: string | undefined, instanceId: string, store: EvolutionStore, core: SkillCore): ResolveSkillEvaluation {
  return profile => {
    if (!path || !profile.evaluation_profile_id) return null;
    try {
      privateFile(path, 256_000);
      const entries = z.array(configSchema).max(100).parse(JSON.parse(readFileSync(path, "utf8")));
      const matches = entries.filter(row => row.id === profile.evaluation_profile_id && row.instance_id === instanceId && row.team_id === profile.team_id && row.agent_id === profile.agent_id);
      if (!matches.length) return null;
      if (matches.length !== 1) throw new Error("ambiguous binding");
      const config = matches[0];
      executableFile(config.python_executable); privateFile(config.nanobot_config, 4 * 1024 * 1024);
      const revision = execFileSync("git", ["-C", config.nanobot_repo, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
      if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("invalid nanobot revision");
      const publicConfig = { ...config, python_executable: "operator-private", nanobot_config: "operator-private", nanobot_repo: "operator-private", nanobot_revision: revision };
      return { id: config.id, fingerprint: contentHash(publicConfig), execute: (candidate, job, grant) => executeSkillEvaluation(store, core, config, revision, candidate, job, grant) };
    } catch { throw new EvolutionError(503, "EVALUATION_BINDING_INVALID"); }
  };
}

async function executeSkillEvaluation(store: EvolutionStore, core: SkillCore, config: EvaluationConfig, revision: string,
  candidate: EvolutionRecord, job: EvolutionRecord, profile: EvolutionProfile): Promise<EvaluationAttempt> {
  if (candidate.kind !== "candidate" || candidate.origin !== "runtime" || candidate.payload.asset_kind !== "skill"
    || job.payload.job_type !== "evaluation" || job.payload.source_id !== candidate.id || job.payload.source_hash !== candidate.artifact_hash) throw new EvolutionError(409, "LIVE_SKILL_EVALUATION_REQUIRED");
  if (candidate.payload.target_id !== "skl-workspace") throw new EvolutionError(409, "NO_FROZEN_SUITE_FOR_SKILL");
  const artifact = candidate.payload.skill_artifact as CandidateArtifact;
  const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const expectedCandidateArtifact = sha(JSON.stringify({ skill_id: artifact?.skill_id, base_version: artifact?.base_version,
    content_hash: artifact?.content_hash, format: "SKILL_MD_V1" }));
  if (!artifact || artifact.operation !== "UPDATE" || artifact.skill_id !== candidate.payload.target_id
    || artifact.content !== candidate.payload.after || artifact.content_hash !== sha(candidate.payload.after)
    || artifact.artifact_hash !== expectedCandidateArtifact) throw new EvolutionError(409, "SKILL_ARTIFACT_MISMATCH");
  const candidateArtifact = candidateToEvaluationArtifact(artifact);
  const baseline = await loadOfficialEvaluationArtifact(core, { team_id: candidate.team_id, agent_id: candidate.agent_id,
    user_id: candidate.owner_user_id, skill_id: artifact.skill_id, version: artifact.base_version });
  if (baseline.content !== candidate.payload.before || candidateArtifact.content !== candidate.payload.after
    || contentHash(baseline.content) !== candidate.payload.base_hash) throw new EvolutionError(409, "EVALUATION_ARTIFACT_BYTES_MISMATCH");
  const caseSet = acceptanceCaseSet("phase5-real-1", PHASE5_REAL_LIMITS), suite = makeAcceptanceSuite("evolution-runtime-ac-regression-v1", caseSet.cases);
  const maxTokens = caseSet.cases.reduce((sum, item) => sum + item.limits.max_total_tokens * 2, 0);
  const maxCalls = caseSet.cases.reduce((sum, item) => sum + item.limits.max_model_calls * 2, 0);
  const reservation = `${job.id}/evaluation-budget`;
  store.reserve(reservation, candidate.team_id, candidate.agent_id, maxTokens, maxCalls, 0);
  const allowedTools = ["apply_patch", "edit_file", "exec", "find_files", "grep", "list_dir", "read_file", "write_file"];
  const runner = new MinimalEvaluationRunner({ fixture: new AcceptanceFixtureAdapter(caseSet.fixtures),
    agent: new NanobotAgentAdapter({ python_executable: config.python_executable, config_path: config.nanobot_config, model_preset: config.model_preset, allowed_tools: allowedTools }),
    runSpecFactory: makeNanobotRunSpecFactory({ nanobot_revision: revision, provider: config.provider, model_id: config.model_id,
      tool_schema_hash: hashCanonical({ allowed_tools: allowedTools, state_tools: ["state_read", "state_apply", "state_verify"], nanobot_revision: revision }) }),
  });
  const attempt = await runner.run({ candidate_id: candidate.id, suite, cases: caseSet.cases, baseline_artifact: baseline, candidate_artifact: candidateArtifact });
  // Infrastructure failures can have charged calls with missing telemetry; retain the full reservation.
  if (attempt.outcome !== "INFRA_ERROR" && attempt.result) store.settle(reservation,
    attempt.result.cost_summary.baseline.total_tokens + attempt.result.cost_summary.candidate.total_tokens,
    attempt.result.cost_summary.baseline.model_call_count + attempt.result.cost_summary.candidate.model_call_count);
  return attempt;
}

export function persistSkillEvaluation(store: EvolutionStore, candidate: EvolutionRecord, job: EvolutionRecord, attempt: EvaluationAttempt): EvolutionRecord {
  const summary = attempt.result?.comparison_summary;
  const newlyFixed = summary?.newly_fixed?.length ?? 0, newlyBroken = summary?.newly_broken?.length ?? 0;
  return store.append({ team_id: candidate.team_id, owner_user_id: candidate.owner_user_id, agent_id: candidate.agent_id,
    kind: "attempt", origin: "runtime", status: attempt.outcome, title: `Skill 对照评测：${candidate.title}`, asset_ids: candidate.asset_ids, parent_id: candidate.id,
    payload: { attempt_type: "skill_effect_evaluation", candidate_hash: candidate.artifact_hash, job_id: job.id,
      gate_result: attempt.result?.gate.status ?? attempt.outcome, newly_fixed: newlyFixed, newly_broken: newlyBroken,
      suite_ref: attempt.suite_ref, baseline_artifact_hash: attempt.baseline_artifact_hash, candidate_artifact_hash: attempt.candidate_artifact_hash,
      cost_summary: attempt.result?.cost_summary ?? null, comparison_summary: summary ?? null, evaluation_attempt: attempt,
      demonstrates_improvement: attempt.outcome === "PASS" && newlyFixed >= 1 && newlyBroken === 0,
    },
  }, job.id, "evolution-evaluator");
}
