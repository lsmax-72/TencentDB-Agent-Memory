import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { SkillCore } from "../../core/skill/skill-core.js";
import type { CandidateArtifact } from "../../core/skill/candidate-types.js";
import { NanobotAgentAdapter } from "../evaluation/adapters/nanobot-agent-adapter.js";
import { candidateToEvaluationArtifact, emptyEvaluationArtifact, loadOfficialEvaluationArtifact } from "../evaluation/adapters/tencentdb-skill-artifacts.js";
import { hashCanonical } from "../evaluation/contracts/hash.js";
import type { EvaluationAttempt } from "../evaluation/contracts/types.js";
import { AcceptanceFixtureAdapter, PHASE5_REAL_LIMITS, acceptanceCaseSet, makeAcceptanceSuite, makeNanobotRunSpecFactory } from "../evaluation/fixtures/acceptance-cases.js";
import { BenchmarkFixtureAdapter, benchmarkCaseSet, makeBenchmarkSuite, type BenchmarkFixtureSpec } from "../evaluation/fixtures/benchmark-code-fixture.js";
import { MinimalEvaluationRunner } from "../evaluation/runner/minimal-runner.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionProfile, type EvolutionRecord } from "./types.js";

const configSchema = z.object({
  id: z.string().min(1).max(180), instance_id: z.string().min(1), team_id: z.string().min(1), agent_id: z.string().min(1),
  // Two suites share everything except where the cases come from. `AC_REGRESSION_V1`
  // is the in-product acceptance set; `BENCHMARK_CODE_V1` reads a frozen external
  // task pool through `BenchmarkFixtureAdapter`. Widening this enum is the whole
  // integration: the runner, the agent adapter and the persistence path are reused.
  suite_kind: z.enum(["AC_REGRESSION_V1", "BENCHMARK_CODE_V1"]),
  python_executable: z.string().min(1), nanobot_repo: z.string().min(1),
  nanobot_config: z.string().min(1), model_preset: z.string().min(1), provider: z.string().min(1), model_id: z.string().min(1),
  // Required only by BENCHMARK_CODE_V1; validated at resolve time below.
  benchmark_pool_path: z.string().min(1).optional(),
  benchmark_tasks_path: z.string().min(1).optional(),
  benchmark_lcb_repo: z.string().min(1).optional(),
  benchmark_solution_path: z.string().min(1).optional(),
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

/**
 * Reject a nanobot config whose model endpoint can silently skip injection.
 *
 * The dsh adapter classifies a request as `auxiliary` when it carries
 * `x-deepseek-harness-compact: 1`, and the Proxy skips
 * `session-init/mem/injection/L0/skill` for auxiliary requests by design
 * (`MemoryProxy/src/handler.ts:703-705`). An evaluation that runs on that route
 * measures an agent which received no memory at all, while looking exactly like
 * an evaluation that measured a null effect. The EvoAgentBench stack spent
 * weeks on precisely that confusion before it was retired, so the route is now
 * rejected at binding-resolution time rather than trusted.
 *
 * Only a local MemoryProxy can skip injection, so remote endpoints are left
 * alone: a direct upstream has no hooks to skip. The space segment is required
 * because it is what scopes recall and writes; a path without one shares the
 * instance-wide default space and lets treatment arms contaminate each other.
 */
function validateEvaluationEndpoint(configPath: string): void {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const providers = (raw.providers ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, provider] of Object.entries(providers)) {
    const endpoint = provider?.baseUrl ?? provider?.apiBase;
    if (typeof endpoint !== "string" || endpoint.length === 0) continue;
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error(`provider ${name} endpoint must be an absolute URL`); }
    if (!["127.0.0.1", "localhost", "::1", "tdai-proxy", "memory-proxy"].includes(url.hostname)) continue;
    if (/(^|\/)dsh(\/|$)/.test(url.pathname)) throw new Error(`EVALUATION_ENDPOINT_AUXILIARY_ROUTE: provider ${name} must not use /dsh/, which skips injection`);
    if (!/^\/[^/]+\/[^/]+\/v1(\/|$)/.test(url.pathname)) throw new Error(`EVALUATION_ENDPOINT_MISSING_SPACE: provider ${name} must route as /<agent>/<spaceId>/v1...`);
  }
}
function readEvaluationConfigs(path: string | undefined): EvaluationConfig[] {
  if (!path) throw new Error("evaluation config required");
  privateFile(path, 256_000);
  return z.array(configSchema).max(100).parse(JSON.parse(readFileSync(path, "utf8")));
}
export function listSkillEvaluationBindingIds(path: string | undefined, instanceId: string, teamId: string, agentId: string): string[] {
  if (!path) return [];
  try { return readEvaluationConfigs(path).filter(row => row.instance_id === instanceId && row.team_id === teamId && row.agent_id === agentId).map(row => row.id).sort(); }
  catch { throw new EvolutionError(503, "EVALUATION_BINDING_INVALID"); }
}

/** Operator-owned fixed runner configuration; no command, path, model or suite is accepted from HTTP. */
export function fileSkillEvaluationBindings(path: string | undefined, instanceId: string, store: EvolutionStore, core: SkillCore): ResolveSkillEvaluation {
  return profile => {
    if (!path || !profile.evaluation_profile_id) return null;
    try {
      const entries = readEvaluationConfigs(path);
      const matches = entries.filter(row => row.id === profile.evaluation_profile_id && row.instance_id === instanceId && row.team_id === profile.team_id && row.agent_id === profile.agent_id);
      if (!matches.length) return null;
      if (matches.length !== 1) throw new Error("ambiguous binding");
      const config = matches[0];
      executableFile(config.python_executable); privateFile(config.nanobot_config, 4 * 1024 * 1024);
      validateEvaluationEndpoint(config.nanobot_config);
      const revision = execFileSync("git", ["-C", config.nanobot_repo, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
      if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("invalid nanobot revision");
      const publicConfig = { ...config, python_executable: "operator-private", nanobot_config: "operator-private", nanobot_repo: "operator-private", nanobot_revision: revision };
      if (config.suite_kind === "BENCHMARK_CODE_V1") {
        const spec = benchmarkSpec(config);
        return { id: config.id, fingerprint: contentHash(publicConfig), execute: (candidate, job, grant) => executeBenchmarkEvaluation(store, core, config, revision, spec, candidate, job, grant) };
      }
      return { id: config.id, fingerprint: contentHash(publicConfig), execute: (candidate, job, grant) => executeSkillEvaluation(store, core, config, revision, candidate, job, grant) };
    } catch (error) {
      // Keep the stable code first (callers and tests match on it) but append
      // the reason. Swallowing it would reproduce the exact failure this guard
      // exists to prevent: an operator with an injection-skipping endpoint
      // would see only "INVALID" and have no way to tell why.
      const detail = error instanceof Error ? error.message : "unrecognised binding failure";
      throw new EvolutionError(503, `EVALUATION_BINDING_INVALID: ${detail}`);
    }
  };
}

const benchmarkTasksSchema = z.object({
  revision: z.string().min(1),
  tasks: z.array(z.object({
    task_id: z.string().min(1), title: z.string().min(1), goal: z.string().min(1),
    task_input: z.string().min(1), critical: z.boolean().optional(),
  }).strict()).min(1).max(500),
}).strict();

//: Budgets generous enough for a competitive-programming task driven by the
//: nanobot tool loop; per-task overrides may narrow them.
//:
//: These are CUMULATIVE for the whole arm, not per model call --
//: `exceedsBudget` compares the run totals against them. The first sizes tried
//: (48k total, 32k input, 24 calls) looked generous and were not: a nine-call
//: run that *solved* its task spent ~108k input tokens, and the hardest case
//: needed 24 calls and ~375k input before it passed 42/42 oracle tests. Both
//: were scored BUDGET_EXHAUSTED after their solutions were already correct, so a
//: right answer was recorded as a failure. Sized now at roughly 1.5x the largest
//: arm observed.
//:
//: `max_output_tokens` is also a run total. The per-call ceiling stays at the
//: model configuration's 4k: the served qwen3.8-27b decodes at ~36 tok/s and
//: reasons before answering, so an 8k single completion needs ~226s on its own,
//: longer than the 300s wall several proxies in front of it enforce.
//: A fixed, contest-style envelope: 10 model calls. It is deliberately tight,
//: because the previous sizes were unusable -- arms on a failing task burned
//: 18-40 calls and 8-30 minutes, so three repeats took hours and two of three
//: pairs had an arm hit a limit. Ten calls makes BOTH outcomes terminate judged
//: in a few minutes: an arm that has not solved the task by then submits what it
//: has, the oracle grades it, and the pair is comparable. The wall only exists
//: to stop a pathological stall, so the call cap always binds first.
const BENCHMARK_DEFAULT_LIMITS = {
  max_model_calls: 10, max_tool_calls: 20, max_input_tokens: 400_000,
  max_output_tokens: 24_000, max_total_tokens: 500_000, timeout_ms: 900_000,
};

/** Resolve the frozen task pool into a fixture spec, refusing partial config. */
function benchmarkSpec(config: EvaluationConfig): BenchmarkFixtureSpec {
  const { benchmark_pool_path: pool, benchmark_tasks_path: tasksPath, benchmark_lcb_repo: lcbRepo } = config;
  const solutionPath = config.benchmark_solution_path ?? "solution.py";
  if (!pool || !tasksPath || !lcbRepo) throw new Error("BENCHMARK_CONFIG_INCOMPLETE");
  for (const path of [pool, tasksPath, lcbRepo]) if (!isAbsolute(path)) throw new Error("BENCHMARK_PATH_NOT_ABSOLUTE");
  // The pool is large, so no mode/size gate here; only its existence is required.
  if (!statSync(pool).isFile()) throw new Error("BENCHMARK_POOL_NOT_FILE");
  if (!statSync(tasksPath).isFile()) throw new Error("BENCHMARK_TASKS_NOT_FILE");
  if (!statSync(lcbRepo).isDirectory()) throw new Error("BENCHMARK_LCB_REPO_NOT_DIR");
  const parsed = benchmarkTasksSchema.parse(JSON.parse(readFileSync(tasksPath, "utf8")));
  return { revision: parsed.revision, pool_path: pool, python_executable: config.python_executable,
    solution_path: solutionPath, lcb_repo: lcbRepo, default_limits: BENCHMARK_DEFAULT_LIMITS, tasks: parsed.tasks };
}

/** Shared candidate checks: the job must name this candidate and the bytes must match. */
async function loadEvaluationArtifacts(core: SkillCore, candidate: EvolutionRecord, job: EvolutionRecord) {
  if (candidate.kind !== "candidate" || candidate.origin !== "runtime" || candidate.payload.asset_kind !== "skill"
    || job.payload.job_type !== "evaluation" || job.payload.source_id !== candidate.id || job.payload.source_hash !== candidate.artifact_hash) throw new EvolutionError(409, "LIVE_SKILL_EVALUATION_REQUIRED");
  // This used to require `target_id === "skl-workspace"`, a placeholder left over
  // from the retired in-house skill line. It rejected every real asset, because
  // no live skill is called that. The binding that actually matters is below:
  // the artifact must carry the candidate's own skill id, and its bytes must
  // match both the candidate and the official baseline.
  const artifact = candidate.payload.skill_artifact as CandidateArtifact;
  const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const expectedCandidateArtifact = sha(JSON.stringify({ skill_id: artifact?.skill_id, base_version: artifact?.base_version,
    content_hash: artifact?.content_hash, format: "SKILL_MD_V1" }));
  if (!artifact || !["CREATE", "UPDATE"].includes(artifact.operation) || artifact.skill_id !== candidate.payload.target_id
    || artifact.content !== candidate.payload.after || artifact.content_hash !== sha(candidate.payload.after)
    || artifact.artifact_hash !== expectedCandidateArtifact) throw new EvolutionError(409, "SKILL_ARTIFACT_MISMATCH");
  const candidateArtifact = candidateToEvaluationArtifact(artifact);
  // A CREATE candidate is measured against no skill at all; an UPDATE candidate
  // against the official version it was derived from. Both end up as a frozen
  // artifact with a real hash, so the rest of the runner is unchanged.
  const baseline = artifact.operation === "CREATE"
    ? emptyEvaluationArtifact(artifact.skill_id)
    : await loadOfficialEvaluationArtifact(core, { team_id: candidate.team_id, agent_id: candidate.agent_id,
        user_id: candidate.owner_user_id, skill_id: artifact.skill_id, version: artifact.base_version });
  if (baseline.content !== candidate.payload.before || candidateArtifact.content !== candidate.payload.after
    || contentHash(baseline.content) !== candidate.payload.base_hash) throw new EvolutionError(409, "EVALUATION_ARTIFACT_BYTES_MISMATCH");
  return { candidateArtifact, baseline };
}

/** Reserve, run both arms, settle. Every suite differs only in its cases and fixture. */
async function runPairedEvaluation(
  core: SkillCore, store: EvolutionStore, config: EvaluationConfig, revision: string,
  candidate: EvolutionRecord, job: EvolutionRecord,
  suiteInput: { cases: EvaluationCase[]; suite: EvaluationSuite; fixture: FixtureAdapter },
): Promise<EvaluationAttempt> {
  const { candidateArtifact, baseline } = await loadEvaluationArtifacts(core, candidate, job);
  const maxTokens = suiteInput.cases.reduce((sum, item) => sum + item.limits.max_total_tokens * 2, 0);
  const maxCalls = suiteInput.cases.reduce((sum, item) => sum + item.limits.max_model_calls * 2, 0);
  const reservation = `${job.id}/evaluation-budget`;
  store.reserve(reservation, candidate.team_id, candidate.agent_id, maxTokens, maxCalls, 0);
  const allowedTools = ["apply_patch", "edit_file", "exec", "find_files", "grep", "list_dir", "read_file", "write_file"];
  const runner = new MinimalEvaluationRunner({ fixture: suiteInput.fixture,
    agent: new NanobotAgentAdapter({ python_executable: config.python_executable, config_path: config.nanobot_config, model_preset: config.model_preset, allowed_tools: allowedTools }),
    runSpecFactory: makeNanobotRunSpecFactory({ nanobot_revision: revision, provider: config.provider, model_id: config.model_id,
      tool_schema_hash: hashCanonical({ allowed_tools: allowedTools, state_tools: ["state_read", "state_apply", "state_verify"], nanobot_revision: revision }) }),
  });
  const attempt = await runner.run({ candidate_id: candidate.id, suite: suiteInput.suite, cases: suiteInput.cases, baseline_artifact: baseline, candidate_artifact: candidateArtifact });
  // Infrastructure failures can have charged calls with missing telemetry; retain the full reservation.
  if (attempt.outcome !== "INFRA_ERROR" && attempt.result) store.settle(reservation,
    attempt.result.cost_summary.baseline.total_tokens + attempt.result.cost_summary.candidate.total_tokens,
    attempt.result.cost_summary.baseline.model_call_count + attempt.result.cost_summary.candidate.model_call_count);
  return attempt;
}

async function executeSkillEvaluation(store: EvolutionStore, core: SkillCore, config: EvaluationConfig, revision: string,
  candidate: EvolutionRecord, job: EvolutionRecord, _profile: EvolutionProfile): Promise<EvaluationAttempt> {
  const caseSet = acceptanceCaseSet("phase5-real-1", PHASE5_REAL_LIMITS);
  return runPairedEvaluation(core, store, config, revision, candidate, job, {
    cases: caseSet.cases,
    suite: makeAcceptanceSuite("evolution-runtime-ac-regression-v1", caseSet.cases, String(candidate.payload.target_id)),
    fixture: new AcceptanceFixtureAdapter(caseSet.fixtures),
  });
}

async function executeBenchmarkEvaluation(store: EvolutionStore, core: SkillCore, config: EvaluationConfig, revision: string,
  spec: BenchmarkFixtureSpec, candidate: EvolutionRecord, job: EvolutionRecord, _profile: EvolutionProfile): Promise<EvaluationAttempt> {
  const caseSet = benchmarkCaseSet(spec);
  return runPairedEvaluation(core, store, config, revision, candidate, job, {
    cases: caseSet.cases,
    suite: makeBenchmarkSuite(`${config.id}-benchmark-code`, caseSet.cases, String(candidate.payload.target_id)),
    fixture: new BenchmarkFixtureAdapter(spec),
  });
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
