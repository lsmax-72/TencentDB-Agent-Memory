import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRunSpecFingerprints,
  computeSuiteHash,
  hashCanonical,
  sha256,
} from "../../../src/evolution/evaluation/contracts/hash.js";
import type {
  EvaluationAttempt,
  EvaluationCase,
  EvaluationSkillArtifact,
  GateStatus,
  RunSpec,
} from "../../../src/evolution/evaluation/contracts/types.js";
import { NanobotAgentAdapter, invokeNanobotBridge } from "../../../src/evolution/evaluation/adapters/nanobot-agent-adapter.js";
import {
  ACCEPTANCE_GATE_POLICY,
  AcceptanceFixtureAdapter,
  BASELINE_SKILL,
  makeAcceptanceArtifact,
  makeAcceptanceSuite,
} from "../../../src/evolution/evaluation/fixtures/acceptance-cases.js";
import { heldoutCaseSet } from "../../../src/evolution/evaluation/fixtures/heldout-cases.js";
import type { RunSpecFactory } from "../../../src/evolution/evaluation/runner/minimal-runner.js";
import { MinimalEvaluationRunner } from "../../../src/evolution/evaluation/runner/minimal-runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const CONFIG = join(homedir(), ".nanobot/config.json");
export const HELDOUT_SUITE_ID = "nanobot-heldout-discriminative-suite";
export const HELDOUT_REVISION = "heldout-v2";
export const CANDIDATE_ID = "phase5b-candidate-v4";
export const OUTPUT_ROOT = "/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/heldout-protocol-v2";
export const EXPECTED_V4_ARTIFACT = "sha256:28537763d10ace8648ef8631801dac68962a68a11e56890c60869b709f62a075";

const ALLOWED_TOOLS = [
  "apply_patch", "edit_file", "exec", "find_files", "grep", "list_dir", "read_file", "write_file",
];
const SOURCE_PATHS = [
  "MemoryCore/scripts/evolution/heldout/experiment.ts",
  "MemoryCore/scripts/evolution/run-heldout-evaluation.ts",
  "MemoryCore/scripts/evolution/heldout/PROTOCOL.md",
  "MemoryCore/src/evolution/evaluation/fixtures/heldout-cases.ts",
  "MemoryCore/src/evolution/evaluation/fixtures/acceptance-cases.ts",
  "MemoryCore/src/evolution/evaluation/adapters/nanobot-agent-adapter.ts",
  "MemoryCore/src/evolution/evaluation/adapters/nanobot_runner.py",
  "MemoryCore/src/evolution/evaluation/oracle/deterministic-oracle.ts",
  "MemoryCore/src/evolution/evaluation/runner/minimal-runner.ts",
  "MemoryCore/src/evolution/evaluation/gate/pair-classifier.ts",
  "MemoryCore/src/evolution/evaluation/gate/cost.ts",
];

export interface HeldoutEnvironment {
  nanobot_repo: string;
  nanobot_revision: string;
  python: string;
  provider: string;
  model_id: string;
  model_preset: string;
  temperature: 0;
  fallback: "DISABLED";
}

export const PROMOTION_EVIDENCE_V2 = {
  policy_revision: "promotion-evidence-v2",
  heldout_main: {
    min_newly_fixed: 1,
    max_newly_broken: 0,
    require_all_critical_candidate_pass: true,
    max_total_token_increase_ratio: 0.25,
    max_total_tool_call_increase: 5,
    max_total_model_call_increase: 2,
  },
  regression_reference: {
    main_attempt: "f5855171-9e8b-4526-b1e1-0e1087420fb1",
    ac05_probes: 3,
    note: "Candidate v4 passed 3/4 AC-05 observations; one probe exhausted its budget.",
  },
} as const;

export const STABILITY_POLICY_V2 = {
  policy_revision: "heldout-stability-v2",
  repetitions_per_triggered_case: 3,
  trigger: "main newly_fixed OR newly_broken OR candidate uses >=90% of any frozen budget",
  stable_improvement: "candidate pass >=2/3 AND baseline pass <=1/3",
  regression_disqualifier: "candidate failure count > baseline failure count",
  main_attempt_is_immutable: true,
} as const;

function git(args: string[], cwd = REPO): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function caseRef(evaluationCase: EvaluationCase) {
  return { id: evaluationCase.case_id, revision: evaluationCase.revision, hash: evaluationCase.case_hash };
}

export function makeHeldoutRunSpecFactory(input: {
  environment: HeldoutEnvironment;
  tool_schema_hash: RunSpec["tools"]["schema_hash"];
}): RunSpecFactory {
  const shared = hashCanonical({
    nanobot_revision: input.environment.nanobot_revision,
    provider: input.environment.provider,
    model_id: input.environment.model_id,
  });
  return {
    create({ evaluation_case, arm, artifact }): RunSpec {
      return {
        contract_revision: "run-spec-v1",
        arm,
        case_ref: caseRef(evaluation_case),
        agent: {
          adapter_id: "nanobot-python-sdk",
          code_revision: input.environment.nanobot_revision,
          system_prompt_hash: hashCanonical({ nanobot_revision: input.environment.nanobot_revision, prompt: "nanobot-default" }),
          harness_config_hash: shared,
        },
        model: {
          provider: input.environment.provider,
          model_id: input.environment.model_id,
          temperature: 0,
          top_p: 1,
          seed: "UNSUPPORTED",
          fallback: "DISABLED",
        },
        tools: {
          toolset_id: evaluation_case.case_id === "HO-07" ? "nanobot-workspace-plus-state-v1" : "nanobot-workspace-v1",
          schema_hash: input.tool_schema_hash,
          implementation_revision: input.environment.nanobot_revision,
          permission_policy_hash: hashCanonical({ restrict_to_workspace: true }),
        },
        environment: {
          fixture_ref: evaluation_case.fixture,
          workspace_image_hash: evaluation_case.fixture.hash,
          isolation: "FRESH_COPY_PER_ARM",
          reset_revision: "nanobot-fixture-v1",
          sandbox_policy_hash: hashCanonical({ restrict_to_workspace: true }),
          network_policy_hash: hashCanonical({ provider_only: true }),
        },
        context: {
          policy_revision: "nanobot-runtime-context-v1",
          non_target_context_hash: shared,
          memory_mode: "DISABLED",
          normal_skill_injection: "DISABLED",
          automatic_skill_extraction: "DISABLED",
        },
        budget: evaluation_case.limits,
        retry_policy: { mode: "NONE" },
        skill_artifact: artifact,
      };
    },
  };
}

export function buildHeldoutExperiment(
  environment: HeldoutEnvironment,
  candidate: EvaluationSkillArtifact,
  revision = HELDOUT_REVISION,
) {
  const caseSet = heldoutCaseSet(revision);
  const suite = makeAcceptanceSuite(HELDOUT_SUITE_ID, caseSet.cases, ACCEPTANCE_GATE_POLICY);
  const baseline = makeAcceptanceArtifact("OFFICIAL", "phase4-baseline", BASELINE_SKILL);
  const toolSchemaHash = hashCanonical({
    allowed_tools: ALLOWED_TOOLS,
    state_tools: ["state_read", "state_apply", "state_verify"],
    nanobot_revision: environment.nanobot_revision,
  });
  const factory = makeHeldoutRunSpecFactory({ environment, tool_schema_hash: toolSchemaHash });
  const runSpecs = caseSet.cases.map((evaluation_case) => ({
    baseline: factory.create({ evaluation_case, arm: "BASELINE", artifact: baseline }),
    candidate: factory.create({ evaluation_case, arm: "CANDIDATE", artifact: candidate }),
  }));
  return { caseSet, suite, baseline, candidate, factory, runSpecs, toolSchemaHash };
}

async function sourceHashes(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of SOURCE_PATHS) result[path] = sha256(await readFile(join(REPO, path)));
  return result;
}

async function configEnvironment(): Promise<HeldoutEnvironment> {
  const previous = JSON.parse(await readFile(
    "/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/phase-5b-candidate-v4/freeze.json", "utf8",
  )).environment as HeldoutEnvironment;
  assert.equal(git(["rev-parse", "HEAD"], previous.nanobot_repo), previous.nanobot_revision, "nanobot revision drift");
  // User-owned untracked notes in the host checkout cannot affect a pinned
  // revision. Refuse only staged or tracked-source changes.
  assert.equal(git(["diff", "--", "."], previous.nanobot_repo), "", "nanobot tracked source changed");
  assert.equal(git(["diff", "--cached", "--", "."], previous.nanobot_repo), "", "nanobot staged source changed");
  assert.equal(previous.provider, "vllm");
  assert.equal(previous.model_id, "qwen3.8-27b");
  assert.equal(previous.temperature, 0);
  assert.equal(previous.fallback, "DISABLED");
  return previous;
}

async function snapshotWorkspace(root: string) {
  const files: Record<string, { sha256: string; content_base64: string }> = {};
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (!relative && [".nanobot", "memory"].includes(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(join(root, path));
        files[path] = { sha256: sha256(bytes), content_base64: bytes.toString("base64") };
      }
    }
  }
  await walk("");
  return files;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function controls(experiment: ReturnType<typeof buildHeldoutExperiment>) {
  return {
    suite: experiment.suite,
    cases: experiment.caseSet.cases,
    fixtures: Object.fromEntries(Object.entries(experiment.caseSet.fixtures).map(([id, fixture]) => [id, {
      files: fixture.files,
      command_refs: Object.keys(fixture.commands ?? {}).sort(),
      schema_refs: Object.keys(fixture.schemas ?? {}).sort(),
    }])),
    run_specs: experiment.runSpecs,
    tool_policy: { allowed_tools: ALLOWED_TOOLS, state_case_ids: ["HO-07"] },
    run_order: "serial per case: BASELINE then CANDIDATE; HO-01 through HO-08",
    isolation: "fresh fixture copy and fresh session per arm; Memory disabled",
  };
}

export async function preflightContamination(): Promise<{ clean: boolean; matches: string[] }> {
  let output = "";
  try {
    output = git(["grep", "-n", "-I", "-e", "HO-0[1-8]", "--", ":(exclude)MemoryCore/src/evolution/evaluation/fixtures/heldout-cases.ts", ":(exclude)MemoryCore/src/evolution/evaluation/fixtures/heldout-cases.test.ts", ":(exclude)MemoryCore/src/evolution/evaluation/adapters/nanobot-agent-adapter.test.ts", ":(exclude)MemoryCore/scripts/evolution/heldout/PROTOCOL.md", ":(exclude)MemoryCore/scripts/evolution/heldout/experiment.ts", ":(exclude)MemoryCore/__tests__/evolution/heldout-protocol.test.ts"], REPO);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
  }
  const matches = output ? output.split("\n").filter(Boolean) : [];
  return { clean: matches.length === 0, matches };
}

export async function freezeHeldoutExperiment(outputDir = OUTPUT_ROOT, revision = HELDOUT_REVISION): Promise<void> {
  const contamination = await preflightContamination();
  assert(contamination.clean, `held-out contamination detected: ${contamination.matches.join(", ")}`);
  const environment = await configEnvironment();
  const candidateContent = await readFile(join(REPO, "MemoryCore/scripts/evolution/refinement/candidate-v4/SKILL.md"), "utf8");
  const candidate = makeAcceptanceArtifact("CANDIDATE", CANDIDATE_ID, candidateContent);
  assert.equal(candidate.artifact_hash, EXPECTED_V4_ARTIFACT, "Candidate v4 artifact drift");
  const experiment = buildHeldoutExperiment(environment, candidate, revision);
  assert.equal(computeSuiteHash(experiment.suite), experiment.suite.suite_hash);
  for (const pair of experiment.runSpecs) {
    assert.equal(computeRunSpecFingerprints(pair.baseline).execution_fingerprint,
      computeRunSpecFingerprints(pair.candidate).execution_fingerprint, "fairness fingerprint mismatch");
  }
  await mkdir(outputDir);
  await mkdir(join(outputDir, "evidence"));
  await writeFile(join(outputDir, "SKILL.md"), candidateContent, { flag: "wx" });
  const freeze = {
    protocol: { suite_id: HELDOUT_SUITE_ID, revision, task_instance_heldout: true, researcher_blind: false },
    ...(revision === "heldout-v3" ? {
      implementation_fix_of: {
        previous_revision: "heldout-v2",
        preserved_attempt: "3b35b5f0-0418-4e20-8cef-cbe816fea819",
        issue: "HO-07 requested unsupported maintenance mode; state tool schema accepts only safe.",
        minimal_change: "HO-07 task input now requests supported safe mode; all other controls are re-frozen.",
      },
    } : {}),
    frozen_at: new Date().toISOString(),
    frozen_from_head: git(["rev-parse", "HEAD"]),
    contamination_audit: contamination,
    ...(revision === "heldout-v3" ? {
      prior_invalid_revision_audit: {
        candidate_v4_executed_heldout_v2: true,
        heldout_v2_attempt: "3b35b5f0-0418-4e20-8cef-cbe816fea819",
        heldout_v3_case_hashes_precede_all_v3_model_runs: true,
        rationale: "v4 is an immutable artifact and each run uses a fresh session; v2's unsupported tool enum is preserved rather than reused.",
      },
    } : {}),
    environment,
    config_hash: sha256(await readFile(CONFIG)),
    source_hashes: await sourceHashes(),
    baseline_artifact: experiment.baseline,
    candidate_artifact: candidate,
    promotion_evidence_v2: { definition: PROMOTION_EVIDENCE_V2, hash: hashCanonical(PROMOTION_EVIDENCE_V2) },
    stability_policy_v2: { definition: STABILITY_POLICY_V2, hash: hashCanonical(STABILITY_POLICY_V2) },
    controls: controls(experiment),
    controls_hash: hashCanonical(controls(experiment)),
    regression_reference: PROMOTION_EVIDENCE_V2.regression_reference,
  };
  await writeJson(join(outputDir, "freeze.json"), freeze);
  await writeFile(join(outputDir, "freeze.sha256"), sha256(await readFile(join(outputDir, "freeze.json"))), { flag: "wx" });
  console.log(JSON.stringify({ outputDir, suite_hash: experiment.suite.suite_hash, candidate: candidate.artifact_hash, frozen_at: freeze.frozen_at }, null, 2));
}

async function loadFrozen(outputDir: string) {
  const bytes = await readFile(join(outputDir, "freeze.json"));
  assert.equal(sha256(bytes), await readFile(join(outputDir, "freeze.sha256"), "utf8"), "freeze tampered");
  const frozen = JSON.parse(bytes.toString());
  assert.equal(sha256(await readFile(CONFIG)), frozen.config_hash, "model config drift");
  assert.deepEqual(await sourceHashes(), frozen.source_hashes, "adapter/runner/oracle source drift");
  assert.equal(await readFile(join(outputDir, "SKILL.md"), "utf8"), frozen.candidate_artifact.content, "frozen candidate content drift");
  const experiment = buildHeldoutExperiment(frozen.environment, frozen.candidate_artifact, frozen.protocol.revision);
  assert.equal(hashCanonical(controls(experiment)), frozen.controls_hash, "held-out controls drift");
  return { frozen, experiment };
}

export function selectProbeCaseIds(attempt: EvaluationAttempt): string[] {
  const triggers = new Set<string>();
  for (const pair of attempt.paired_results) {
    const limit = pair.candidate.run_spec_fingerprints ? undefined : undefined; // limits are available from frozen Case controls at runtime.
    void limit;
    if (pair.classification === "newly_fixed" || pair.classification === "newly_broken") triggers.add(pair.case_ref.id);
  }
  return [...triggers].sort();
}

function budgetTriggered(caseItem: EvaluationCase, pair: EvaluationAttempt["paired_results"][number]): boolean {
  const usage = pair.candidate.usage;
  const budget = caseItem.limits;
  return Math.max(
    usage.input_tokens / budget.max_input_tokens,
    usage.output_tokens / budget.max_output_tokens,
    usage.total_tokens / budget.max_total_tokens,
    usage.model_call_count / budget.max_model_calls,
    usage.tool_call_count / budget.max_tool_calls,
  ) >= 0.9;
}

export function requiredProbeCaseIds(attempt: EvaluationAttempt, cases: EvaluationCase[]): string[] {
  const triggered = new Set(selectProbeCaseIds(attempt));
  for (const pair of attempt.paired_results) {
    const caseItem = cases.find((item) => item.case_id === pair.case_ref.id);
    assert(caseItem, `unknown frozen case ${pair.case_ref.id}`);
    if (budgetTriggered(caseItem, pair)) triggered.add(caseItem.case_id);
  }
  return [...triggered].sort();
}

async function execute(outputDir: string, label: string, cases: EvaluationCase[]): Promise<EvaluationAttempt> {
  const { frozen, experiment } = await loadFrozen(outputDir);
  const evidenceDir = join(outputDir, "evidence", label);
  await mkdir(evidenceDir);
  const raw = new Map<string, { observed_conditions_hash?: string }>();
  const agent = new NanobotAgentAdapter({
    python_executable: frozen.environment.python,
    config_path: CONFIG,
    model_preset: frozen.environment.model_preset,
    allowed_tools: ALLOWED_TOOLS,
    invoke: async (request, options) => {
      const before = await snapshotWorkspace(request.workspace);
      console.log(`Starting real held-out run ${request.session_id}`);
      const response = await invokeNanobotBridge(request, options);
      const after = await snapshotWorkspace(request.workspace);
      await writeJson(join(evidenceDir, `${request.session_id}.json`), { request, response, workspace_before: before, workspace_after: after });
      raw.set(request.session_id, response.ok ? response : {});
      console.log(`Finished real held-out run ${request.session_id}: ${response.ok ? response.usage.total_tokens : response.error.code}`);
      return response;
    },
  });
  const suite = cases.length === experiment.caseSet.cases.length
    ? experiment.suite
    : makeAcceptanceSuite(`${HELDOUT_SUITE_ID}-${label}`, cases, ACCEPTANCE_GATE_POLICY);
  const attempt = await new MinimalEvaluationRunner({
    fixture: new AcceptanceFixtureAdapter(experiment.caseSet.fixtures), agent, runSpecFactory: experiment.factory,
  }).run({
    candidate_id: CANDIDATE_ID, suite, cases,
    baseline_artifact: experiment.baseline, candidate_artifact: frozen.candidate_artifact,
  });
  const observed_conditions = attempt.paired_results.map((pair) => {
    const baseline = raw.get(pair.baseline.session_id)?.observed_conditions_hash;
    const candidate = raw.get(pair.candidate.session_id)?.observed_conditions_hash;
    return { case_id: pair.case_ref.id, baseline, candidate, match: Boolean(baseline && baseline === candidate) };
  });
  const audit = {
    observed_conditions,
    valid: observed_conditions.every((item) => item.match) && attempt.paired_results.every((pair) => pair.fairness.status === "MATCH"),
    config_unchanged: sha256(await readFile(CONFIG)) === frozen.config_hash,
    source_unchanged: hashCanonical(await sourceHashes()) === hashCanonical(frozen.source_hashes),
  };
  await writeJson(join(outputDir, `${label}.json`), {
    phase: "Held-out Protocol v2", mode: label, frozen_candidate: frozen.candidate_artifact.artifact_hash,
    attempt, audit,
  });
  if (!audit.valid || !audit.config_unchanged || !audit.source_unchanged || attempt.outcome === "INFRA_ERROR") {
    process.exitCode = 2;
  }
  return attempt;
}

export async function runHeldoutMain(outputDir = OUTPUT_ROOT): Promise<void> {
  const { experiment } = await loadFrozen(outputDir);
  const attempt = await execute(outputDir, "main", experiment.caseSet.cases);
  const required = requiredProbeCaseIds(attempt, experiment.caseSet.cases);
  await writeJson(join(outputDir, "required-probes.json"), { case_ids: required, repetitions: 3, policy_hash: hashCanonical(STABILITY_POLICY_V2) });
  console.log(JSON.stringify({ attempt_id: attempt.attempt_id, outcome: attempt.outcome, comparison: attempt.result?.comparison_summary, required_probes: required }, null, 2));
}

export async function runHeldoutProbe(caseId: string, repetition: number, outputDir = OUTPUT_ROOT): Promise<void> {
  assert(Number.isInteger(repetition) && repetition >= 1 && repetition <= 3, "probe repetition must be 1..3");
  const main = JSON.parse(await readFile(join(outputDir, "main.json"), "utf8")).attempt as EvaluationAttempt;
  const { experiment } = await loadFrozen(outputDir);
  assert(requiredProbeCaseIds(main, experiment.caseSet.cases).includes(caseId), `probe not triggered for ${caseId}`);
  const caseItem = experiment.caseSet.cases.find((item) => item.case_id === caseId);
  assert(caseItem, `unknown held-out case ${caseId}`);
  const label = `probe-${caseId.toLowerCase()}-${repetition}`;
  await execute(outputDir, label, [caseItem]);
}

export interface PromotionEvidenceV2 {
  status: GateStatus;
  checks: Record<string, { pass: boolean; observed: unknown; limit?: unknown }>;
  reasons: string[];
}

export function evaluatePromotionEvidenceV2(attempt: EvaluationAttempt): PromotionEvidenceV2 {
  if (attempt.outcome === "INFRA_ERROR" || !attempt.result) {
    return { status: "INFRA_ERROR", checks: {}, reasons: ["main attempt has infrastructure error or missing result"] };
  }
  const result = attempt.result;
  const comparison = result.comparison_summary;
  const cost = result.cost_summary;
  const checks = {
    newly_fixed: { pass: comparison.newly_fixed.length >= 1, observed: comparison.newly_fixed.length, limit: ">=1" },
    newly_broken: { pass: comparison.newly_broken.length === 0, observed: comparison.newly_broken.length, limit: 0 },
    critical_candidate: { pass: result.critical_candidate_failures.length === 0, observed: result.critical_candidate_failures, limit: [] },
    tokens: { pass: cost.token_increase_ratio !== null && cost.token_increase_ratio <= 0.25, observed: cost.token_increase_ratio, limit: 0.25 },
    tools: { pass: cost.tool_call_increase <= 5, observed: cost.tool_call_increase, limit: 5 },
    model_calls: { pass: cost.model_call_increase <= 2, observed: cost.model_call_increase, limit: 2 },
  };
  const reasons = Object.entries(checks).filter(([, check]) => !check.pass).map(([name]) => name);
  return { status: reasons.length === 0 ? "PASS" : "FAIL", checks, reasons };
}
