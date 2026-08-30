import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeArtifactHashes, computeCaseHash, computeGatePolicyHash, computeRunSpecFingerprints, computeSuiteHash, hashCanonical, sha256 } from "../../../src/evolution/evaluation/contracts/hash.js";
import type { EvaluationAttempt, EvaluationSkillArtifact } from "../../../src/evolution/evaluation/contracts/types.js";
import { NanobotAgentAdapter, invokeNanobotBridge } from "../../../src/evolution/evaluation/adapters/nanobot-agent-adapter.js";
import { AcceptanceFixtureAdapter, BASELINE_SKILL, GOOD_CANDIDATE_SKILL, PHASE5_REAL_LIMITS, acceptanceCaseSet, makeAcceptanceArtifact, makeAcceptanceSuite, makeNanobotRunSpecFactory } from "../../../src/evolution/evaluation/fixtures/acceptance-cases.js";
import { MinimalEvaluationRunner } from "../../../src/evolution/evaluation/runner/minimal-runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
export const PHASE5A_COMMIT = "29a347dd535f516b5f9c0510edd923462d81a0e4";
export const CANDIDATE_ID = "phase5b-candidate-v2";
export const SOURCE_DIR = "/Users/lsmax/Documents/Codex/2026-08-29/n/outputs";
const CONFIG = join(homedir(), ".nanobot/config.json");
const EVIDENCE_FILES = [
  "phase-5-real-full.json", "phase-5-real-smoke.json", "phase-5-real-ac03-probe.json",
  "phase-5-real-ac05-probe.json", "phase-5-stability-ac01-1.json",
  "phase-5-stability-ac01-2.json", "phase-5-stability-ac01-3.json",
];
const DEFAULT_CANDIDATE_FILE = "candidate-v2/SKILL.md";

export interface FreezeOptions {
  candidate_id?: string;
  candidate_file?: string;
  parent_candidate?: string;
  created_from_evaluation_attempt?: string;
  diagnosis_file?: string;
  lineage?: Record<string, unknown>;
}

export interface HistoricalEvidence {
  environment: { nanobot_repo: string; nanobot_revision: string; python: string; provider: string; model_id: string; model_preset: string; temperature: number; fallback: string };
  attempt: EvaluationAttempt;
}

export function buildExperiment(source: HistoricalEvidence, candidate: EvaluationSkillArtifact) {
  const caseSet = acceptanceCaseSet("phase5-real-1", PHASE5_REAL_LIMITS);
  const suite = makeAcceptanceSuite("nanobot-full-suite", caseSet.cases);
  const baseline = makeAcceptanceArtifact("OFFICIAL", "phase4-baseline", BASELINE_SKILL);
  const parent = makeAcceptanceArtifact("CANDIDATE", "phase4-good-candidate", GOOD_CANDIDATE_SKILL);
  const allowedTools = ["apply_patch", "edit_file", "exec", "find_files", "grep", "list_dir", "read_file", "write_file"];
  const factory = makeNanobotRunSpecFactory({
    nanobot_revision: source.environment.nanobot_revision,
    provider: source.environment.provider,
    model_id: source.environment.model_id,
    tool_schema_hash: hashCanonical({ allowed_tools: allowedTools, state_tools: ["state_read", "state_apply", "state_verify"], nanobot_revision: source.environment.nanobot_revision }),
  });
  const runSpecs = caseSet.cases.map((evaluation_case) => ({
    baseline: factory.create({ evaluation_case, arm: "BASELINE", artifact: baseline }),
    candidate: factory.create({ evaluation_case, arm: "CANDIDATE", artifact: candidate }),
  }));
  const experiment = { caseSet, suite, baseline, parent, candidate, allowedTools, factory, runSpecs };
  assertHistoricalControls(experiment, source);
  return experiment;
}

export function assertHistoricalControls(experiment: ReturnType<typeof buildExperiment>, source: HistoricalEvidence): void {
  assert.equal(experiment.baseline.artifact_hash, source.attempt.baseline_artifact_hash, "Baseline drift");
  assert.equal(experiment.parent.artifact_hash, source.attempt.candidate_artifact_hash, "v1 drift");
  assert.equal(computeSuiteHash(experiment.suite), source.attempt.suite_ref.hash, "Suite/Gate drift");
  assert.equal(computeGatePolicyHash(experiment.suite.gate_policy), source.attempt.result!.gate.policy_hash, "Gate drift");
  assert.equal(experiment.caseSet.cases.length, source.attempt.paired_results.length);
  experiment.caseSet.cases.forEach((item, index) => {
    const historical = source.attempt.paired_results[index];
    assert.equal(computeCaseHash(item), historical.case_ref.hash, `Case drift: ${item.case_id}`);
    assert.equal(hashCanonical(experiment.caseSet.fixtures[item.case_id].files), item.fixture.hash, "Fixture drift");
    for (const arm of ["baseline", "candidate"] as const) {
      assert.equal(computeRunSpecFingerprints(experiment.runSpecs[index][arm]).execution_fingerprint,
        historical[arm].run_spec_fingerprints.execution_fingerprint, `RunSpec drift: ${item.case_id}/${arm}`);
    }
  });
}

function git(args: string[], cwd = REPO): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function assertPhase5ALineage(): void {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", PHASE5A_COMMIT, "HEAD"], { cwd: REPO });
  } catch {
    throw new Error(`Candidate freeze must descend from Phase 5A commit ${PHASE5A_COMMIT}`);
  }
}

async function frozenSourceHashes(): Promise<Record<string, string>> {
  const paths = git(["ls-files", "MemoryCore/src/evolution/evaluation", "MemoryCore/scripts/evolution/run-nanobot-evaluation.ts"]).split("\n");
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    const current = await readFile(join(REPO, path));
    const frozen = execFileSync("git", ["show", `${PHASE5A_COMMIT}:${path}`], { cwd: REPO });
    assert.equal(sha256(current), sha256(frozen), `Frozen Phase 5A source changed: ${path}`);
    hashes[path] = sha256(current);
  }
  return hashes;
}

function controls(experiment: ReturnType<typeof buildExperiment>) {
  return { cases: experiment.caseSet.cases, suite: experiment.suite, baseline: experiment.baseline,
    run_specs: experiment.runSpecs, allowed_tools: experiment.allowedTools };
}

/** A diagnostic probe reuses a frozen case; it never alters the full-suite attempt. */
export function selectProbeCase(experiment: ReturnType<typeof buildExperiment>, caseId: string) {
  const evaluationCase = experiment.caseSet.cases.find((item) => item.case_id === caseId);
  assert(evaluationCase, `Unknown diagnostic probe case: ${caseId}`);
  return evaluationCase;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

export async function freezeExperiment(outputDir: string, options: FreezeOptions = {}): Promise<void> {
  const source = JSON.parse(await readFile(join(SOURCE_DIR, EVIDENCE_FILES[0]), "utf8")) as HistoricalEvidence;
  const candidateId = options.candidate_id ?? CANDIDATE_ID;
  const candidateFile = options.candidate_file ?? DEFAULT_CANDIDATE_FILE;
  const parentCandidate = options.parent_candidate ?? source.attempt.candidate_id;
  const sourceAttempt = options.created_from_evaluation_attempt ?? source.attempt.attempt_id;
  const diagnosisFile = options.diagnosis_file ?? "diagnosis.json";
  assertPhase5ALineage();
  assert.equal(git(["rev-parse", "HEAD"], source.environment.nanobot_repo), source.environment.nanobot_revision);
  assert.equal(git(["diff", "HEAD", "--", "nanobot"], source.environment.nanobot_repo), "", "nanobot source changed");
  const content = await readFile(join(HERE, candidateFile), "utf8");
  assert(!/AC-\d\d|case_id|3000|STATUS_READY|\bsafe\b|old-name|new-name/.test(content), "Case answer in Skill");
  const artifact = makeAcceptanceArtifact("CANDIDATE", candidateId, content);
  const experiment = buildExperiment(source, artifact);
  const sourceHashes = await frozenSourceHashes();
  const diagnosis = JSON.parse(await readFile(join(HERE, diagnosisFile), "utf8"));
  assert.equal(diagnosis.source_evaluation_attempt, sourceAttempt);
  // Refuse an existing experiment directory: one freeze, one main attempt, no overwrite.
  await mkdir(outputDir);
  await mkdir(join(outputDir, "phase5a-frozen"));
  const evidenceHashes: Record<string, string> = {};
  for (const file of EVIDENCE_FILES) {
    const target = join(outputDir, "phase5a-frozen", file);
    await copyFile(join(SOURCE_DIR, file), target, constants.COPYFILE_EXCL);
    evidenceHashes[file] = sha256(await readFile(target));
  }
  await copyFile(join(HERE, candidateFile), join(outputDir, "SKILL.md"), constants.COPYFILE_EXCL);
  await writeJson(join(outputDir, "diagnosis.json"), diagnosis);
  const freeze = {
    frozen_at: new Date().toISOString(), phase5a_commit: PHASE5A_COMMIT,
    candidate_id: candidateId, candidate_file: candidateFile, base_skill_id: artifact.skill_id, base_version: artifact.base_version,
    parent_candidate: parentCandidate, created_from_evaluation_attempt: sourceAttempt, frozen_from_head: git(["rev-parse", "HEAD"]),
    diagnosis_summary: diagnosis.refinement_summary,
    diagnosis_hash: sha256(await readFile(join(outputDir, "diagnosis.json"))),
    artifact, environment: source.environment, evidence_hashes: evidenceHashes, source_hashes: sourceHashes,
    config_hash: sha256(await readFile(CONFIG)), controls: controls(experiment), lineage: options.lineage,
    stability_policy: "Only if AC-01 v2 uses >=90% of a token/model/tool budget or fails budget; at most 3 independent paired probes, never replace main.",
  };
  await writeJson(join(outputDir, "freeze.json"), freeze);
  await writeFile(join(outputDir, "freeze.sha256"), sha256(await readFile(join(outputDir, "freeze.json"))), { flag: "wx" });
  console.log(JSON.stringify({ output_dir: outputDir, candidate_id: candidateId, ...computeArtifactHashes(artifact), controls: "MATCH_PHASE5A", frozen_at: freeze.frozen_at }, null, 2));
}

/** Read-only evidence snapshot; host control-plane contents are not copied as task data. */
async function snapshotWorkspace(root: string) {
  const files: Record<string, { sha256: string; content_base64: string }> = {};
  async function walk(relative: string) {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (!relative && [".nanobot", "memory"].includes(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(join(root, path));
        files[path] = { sha256: sha256(bytes), content_base64: bytes.toString("base64") };
      } else throw new Error(`Unexpected non-regular fixture entry: ${path}`);
    }
  }
  await walk("");
  return files;
}

export async function runExperiment(
  outputDir: string,
  probe?: number,
  infrastructureRetry = false,
  probeCaseId = "AC-01",
  diagnosticProbe = false,
): Promise<void> {
  const freezeBytes = await readFile(join(outputDir, "freeze.json"));
  assert.equal(sha256(freezeBytes), await readFile(join(outputDir, "freeze.sha256"), "utf8"), "Freeze tampered");
  const frozen = JSON.parse(freezeBytes.toString());
  assert.deepEqual(await frozenSourceHashes(), frozen.source_hashes);
  assert.equal(sha256(await readFile(CONFIG)), frozen.config_hash, "Model config drift");
  assert.equal(git(["rev-parse", "HEAD"], frozen.environment.nanobot_repo), frozen.environment.nanobot_revision);
  assert.equal(git(["diff", "HEAD", "--", "nanobot"], frozen.environment.nanobot_repo), "");
  const candidateFile = frozen.candidate_file ?? DEFAULT_CANDIDATE_FILE;
  assert.equal(sha256(await readFile(join(HERE, candidateFile))), frozen.artifact.content_hash);
  assert.equal(sha256(await readFile(join(outputDir, "SKILL.md"))), frozen.artifact.content_hash);
  assert.equal(sha256(await readFile(join(outputDir, "diagnosis.json"))), frozen.diagnosis_hash);
  for (const [file, hash] of Object.entries(frozen.evidence_hashes)) {
    assert.equal(sha256(await readFile(join(outputDir, "phase5a-frozen", file))), hash);
    assert.equal(sha256(await readFile(join(SOURCE_DIR, file))), hash, "Original Phase 5A evidence changed");
  }
  const source = JSON.parse(await readFile(join(outputDir, "phase5a-frozen", EVIDENCE_FILES[0]), "utf8")) as HistoricalEvidence;
  const experiment = buildExperiment(source, frozen.artifact);
  assert.equal(hashCanonical(controls(experiment)), hashCanonical(frozen.controls), "Experimental controls drift");
  const retryLabel = "infrastructure-retry-1";
  const sourceLabel = infrastructureRetry ? retryLabel : "main";
  if (infrastructureRetry) {
    const historical = JSON.parse(await readFile(join(outputDir, "main.json"), "utf8"));
    assert.equal(historical.attempt.outcome, "INFRA_ERROR", "Infrastructure retry requires the preserved INFRA_ERROR attempt");
    assert.equal(historical.frozen_candidate, frozen.artifact.artifact_hash, "Historical retry candidate drift");
  }
  if (probe !== undefined) {
    assert(Number.isInteger(probe) && probe >= 1 && probe <= 3);
    const sourceAttempt = JSON.parse(await readFile(join(outputDir, `${sourceLabel}.json`), "utf8"));
    const probeCase = selectProbeCase(experiment, probeCaseId);
    const candidate = sourceAttempt.attempt.paired_results.find((pair: { case_ref: { id: string } }) => pair.case_ref.id === probeCase.case_id)?.candidate;
    assert(candidate, `Missing ${probeCaseId} in source attempt`);
    if (!diagnosticProbe) {
      assert.equal(probeCaseId, "AC-01", "Frozen stability policy only permits AC-01");
      const usage = candidate.usage;
      const b = PHASE5_REAL_LIMITS;
      const atNinetyPercent = Math.max(usage.input_tokens / b.max_input_tokens, usage.output_tokens / b.max_output_tokens,
        usage.total_tokens / b.max_total_tokens, usage.model_call_count / b.max_model_calls,
        usage.tool_call_count / b.max_tool_calls) >= 0.9;
      const budgetExhausted = candidate.failure?.codes.includes("BUDGET_EXHAUSTED") ?? false;
      assert(atNinetyPercent || budgetExhausted, "Stability trigger not met");
    }
  }
  const label = probe === undefined
    ? (infrastructureRetry ? retryLabel : "main")
    : diagnosticProbe
      ? `${sourceLabel}-diagnostic-stability-${probeCaseId.toLowerCase()}-${probe}`
      : `${sourceLabel}-stability-ac01-${probe}`;
  await writeJson(join(outputDir, `${label}-started.json`), {
    started_at: new Date().toISOString(),
    candidate_hash: frozen.artifact.artifact_hash,
    ...(infrastructureRetry ? { attempt_kind: "INFRASTRUCTURE_RETRY", retry_of_attempt_id: JSON.parse(await readFile(join(outputDir, "main.json"), "utf8")).attempt.attempt_id } : {}),
    ...(diagnosticProbe ? { probe_kind: "DIAGNOSTIC_STABILITY_PROBE", case_id: probeCaseId, repetition: probe } : {}),
  });
  const evidenceDir = join(outputDir, `${label}-evidence`);
  await mkdir(evidenceDir);
  const raw = new Map<string, { observed_conditions_hash?: string }>();
  const agent = new NanobotAgentAdapter({
    python_executable: frozen.environment.python, config_path: CONFIG,
    model_preset: frozen.environment.model_preset, allowed_tools: experiment.allowedTools,
    invoke: async (request, options) => {
      const before = await snapshotWorkspace(request.workspace);
      console.log(`Starting real run ${request.session_id}`);
      const response = await invokeNanobotBridge(request, options);
      const after = await snapshotWorkspace(request.workspace);
      // Sidecar only: exactly the original request/response is forwarded to the original adapter.
      await writeJson(join(evidenceDir, `${request.session_id}.json`), { request, response, workspace_before: before, workspace_after: after });
      raw.set(request.session_id, response.ok ? response : {});
      console.log(`Finished real run ${request.session_id}: ${response.ok ? response.usage.total_tokens : response.error.code}`);
      return response;
    },
  });
  const cases = probe === undefined ? experiment.caseSet.cases : [selectProbeCase(experiment, probeCaseId)];
  const attempt = await new MinimalEvaluationRunner({ fixture: new AcceptanceFixtureAdapter(experiment.caseSet.fixtures), agent, runSpecFactory: experiment.factory }).run({
    candidate_id: frozen.candidate_id ?? CANDIDATE_ID, cases,
    suite: probe === undefined ? experiment.suite : makeAcceptanceSuite(
      diagnosticProbe ? `phase5b-diagnostic-${probeCaseId.toLowerCase()}-${probe}` : `phase5b-stability-ac01-${probe}`,
      cases,
    ),
    baseline_artifact: experiment.baseline, candidate_artifact: frozen.artifact,
  });
  const observed = attempt.paired_results.map((pair) => {
    const baseline = raw.get(pair.baseline.session_id)?.observed_conditions_hash;
    const candidate = raw.get(pair.candidate.session_id)?.observed_conditions_hash;
    return { case_id: pair.case_ref.id, baseline, candidate, match: Boolean(baseline && baseline === candidate) };
  });
  const audit = {
    observed_conditions: observed,
    valid: observed.every((pair) => pair.match),
    config_unchanged: sha256(await readFile(CONFIG)) === frozen.config_hash,
    source_unchanged: hashCanonical(await frozenSourceHashes()) === hashCanonical(frozen.source_hashes),
  };
  await writeJson(join(outputDir, `${label}.json`), {
    phase: "5B", mode: label, frozen_candidate: frozen.artifact.artifact_hash,
    ...(infrastructureRetry ? { attempt_kind: "INFRASTRUCTURE_RETRY", retry_of_attempt_id: JSON.parse(await readFile(join(outputDir, "main.json"), "utf8")).attempt.attempt_id } : {}),
    ...(diagnosticProbe ? { probe_kind: "DIAGNOSTIC_STABILITY_PROBE", case_id: probeCaseId, repetition: probe } : {}),
    attempt, audit,
  });
  console.log(JSON.stringify({ attempt: attempt.attempt_id, outcome: attempt.outcome, comparison: attempt.result?.comparison_summary, gate: attempt.result?.gate, audit }, null, 2));
  if (!audit.valid || !audit.config_unchanged || !audit.source_unchanged || attempt.outcome === "INFRA_ERROR") process.exitCode = 2;
}
