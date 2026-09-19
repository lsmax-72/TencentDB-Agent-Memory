import { randomUUID } from "node:crypto";
import { computeArtifactHashes, computeCaseHash, computeRunSpecFingerprints, computeSuiteHash } from "../contracts/hash.js";
import type {
  Arm,
  CaseRunResult,
  EvaluationAttempt,
  EvaluationCase,
  EvaluationResult,
  EvaluationSkillArtifact,
  EvaluationSuite,
  EvidenceRef,
  InfraErrorCode,
  PairClassification,
  RunFailure,
  RunSpec,
  RunStatus,
  RunUsage,
  TaskFailureCode,
  ToolCallSummary,
  TraceRef,
} from "../contracts/types.js";
import { aggregateCosts, emptyUsage } from "../gate/cost.js";
import { evaluateGate } from "../gate/evaluate-gate.js";
import { detectEvaluationEgress } from "./egress.js";
import { classifyPair } from "../gate/pair-classifier.js";
import { runOracle, type OracleContext } from "../oracle/deterministic-oracle.js";

export interface PreparedFixture {
  workspace_dir: string;
  changed_paths(): Promise<string[]> | string[];
  commands: OracleContext["commands"];
  schemas: OracleContext["schemas"];
  custom_assertions?: OracleContext["custom_assertions"];
  dispose?(): Promise<void> | void;
}

export interface FixtureAdapter {
  prepare(input: {
    evaluation_case: EvaluationCase;
    arm: Arm;
    session_id: string;
  }): Promise<PreparedFixture>;
}

export interface AgentRunOutput {
  observed_model_id: string;
  observed_conditions_hash: EvaluationSkillArtifact["artifact_hash"];
  usage: RunUsage;
  tool_calls: ToolCallSummary[];
  output_evidence: EvidenceRef[];
  trace_refs: TraceRef[];
  /** Adapter-level business stop with usable telemetry/evidence (for example timeout). */
  task_failure?: { code: TaskFailureCode; evidence_refs: EvidenceRef[] };
}

export interface AgentAdapter {
  run(input: {
    evaluation_case: EvaluationCase;
    run_spec: RunSpec;
    workspace_dir: string;
    session_id: string;
    skill_override: string;
  }): Promise<AgentRunOutput>;
}

export interface RunSpecFactory {
  create(input: {
    evaluation_case: EvaluationCase;
    arm: Arm;
    artifact: EvaluationSkillArtifact;
  }): RunSpec;
}

export interface EvaluationRunnerInput {
  candidate_id: string;
  suite: EvaluationSuite;
  cases: EvaluationCase[];
  baseline_artifact: EvaluationSkillArtifact;
  candidate_artifact: EvaluationSkillArtifact;
  attempt_number?: number;
  previous_attempt_id?: string;
}

export class EvaluationExecutionError extends Error {
  constructor(
    public readonly kind: "TASK" | "INFRA",
    public readonly code: TaskFailureCode | InfraErrorCode,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = "EvaluationExecutionError";
  }
}

export interface MinimalEvaluationRunnerOptions {
  fixture: FixtureAdapter;
  agent: AgentAdapter;
  runSpecFactory: RunSpecFactory;
  idFactory?: () => string;
  now?: () => Date;
}

/** Single-process, serial Baseline→Candidate runner for the v1 MVP. */
export class MinimalEvaluationRunner {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: MinimalEvaluationRunnerOptions) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async run(input: EvaluationRunnerInput): Promise<EvaluationAttempt> {
    const attemptId = this.idFactory();
    const startedAt = this.now().toISOString();
    try {
      validateAttemptInput(input);
    } catch (error) {
      if (error instanceof EvaluationExecutionError && error.kind === "INFRA") {
        return this.setupFailureAttempt(input, attemptId, startedAt, error.code as InfraErrorCode);
      }
      throw error;
    }
    const pairs = [];

    for (const evaluationCase of input.cases) {
      const baselineSpec = this.options.runSpecFactory.create({
        evaluation_case: evaluationCase,
        arm: "BASELINE",
        artifact: input.baseline_artifact,
      });
      const candidateSpec = this.options.runSpecFactory.create({
        evaluation_case: evaluationCase,
        arm: "CANDIDATE",
        artifact: input.candidate_artifact,
      });
      const baselinePrints = computeRunSpecFingerprints(baselineSpec);
      const candidatePrints = computeRunSpecFingerprints(candidateSpec);

      let baseline: CaseRunResult;
      let candidate: CaseRunResult;
      if (baselinePrints.execution_fingerprint !== candidatePrints.execution_fingerprint) {
        baseline = infraRunResult({
          attemptId,
          runId: this.idFactory(),
          sessionId: this.idFactory(),
          runSpec: baselineSpec,
          fingerprints: baselinePrints,
          code: "RUNSPEC_MISMATCH",
          now: this.now,
        });
        candidate = infraRunResult({
          attemptId,
          runId: this.idFactory(),
          sessionId: this.idFactory(),
          runSpec: candidateSpec,
          fingerprints: candidatePrints,
          code: "RUNSPEC_MISMATCH",
          now: this.now,
        });
      } else {
        baseline = await this.runArm(attemptId, evaluationCase, baselineSpec);
        candidate = await this.runArm(attemptId, evaluationCase, candidateSpec);
      }
      pairs.push(classifyPair(baseline, candidate, evaluationCase.critical));
    }

    const costSummary = aggregateCosts(pairs);
    const gate = evaluateGate(pairs, costSummary, input.suite.gate_policy);
    const result = buildEvaluationResult({ input, attemptId, pairs, costSummary, gate });
    return {
      attempt_id: attemptId,
      attempt_number: input.attempt_number ?? 1,
      ...(input.previous_attempt_id ? { previous_attempt_id: input.previous_attempt_id } : {}),
      candidate_id: input.candidate_id,
      candidate_artifact_hash: input.candidate_artifact.artifact_hash,
      baseline_skill_id: input.baseline_artifact.skill_id,
      baseline_version: input.baseline_artifact.base_version,
      baseline_artifact_hash: input.baseline_artifact.artifact_hash,
      suite_ref: suiteRef(input.suite),
      started_at: startedAt,
      finished_at: this.now().toISOString(),
      outcome: gate.status,
      paired_results: pairs,
      result,
    };
  }

  private setupFailureAttempt(
    input: EvaluationRunnerInput,
    attemptId: string,
    startedAt: string,
    code: InfraErrorCode,
  ): EvaluationAttempt {
    const pairs = input.cases.map((evaluationCase) => {
      const baselineSpec = this.options.runSpecFactory.create({
        evaluation_case: evaluationCase,
        arm: "BASELINE",
        artifact: input.baseline_artifact,
      });
      const candidateSpec = this.options.runSpecFactory.create({
        evaluation_case: evaluationCase,
        arm: "CANDIDATE",
        artifact: input.candidate_artifact,
      });
      const baseline = infraRunResult({
        attemptId,
        runId: this.idFactory(),
        sessionId: this.idFactory(),
        runSpec: baselineSpec,
        fingerprints: computeRunSpecFingerprints(baselineSpec),
        code,
        now: this.now,
      });
      const candidate = infraRunResult({
        attemptId,
        runId: this.idFactory(),
        sessionId: this.idFactory(),
        runSpec: candidateSpec,
        fingerprints: computeRunSpecFingerprints(candidateSpec),
        code,
        now: this.now,
      });
      return classifyPair(baseline, candidate, evaluationCase.critical);
    });
    const costSummary = aggregateCosts(pairs);
    const gate = evaluateGate(pairs, costSummary, input.suite.gate_policy);
    return {
      attempt_id: attemptId,
      attempt_number: input.attempt_number ?? 1,
      ...(input.previous_attempt_id ? { previous_attempt_id: input.previous_attempt_id } : {}),
      candidate_id: input.candidate_id,
      candidate_artifact_hash: input.candidate_artifact.artifact_hash,
      baseline_skill_id: input.baseline_artifact.skill_id,
      baseline_version: input.baseline_artifact.base_version,
      baseline_artifact_hash: input.baseline_artifact.artifact_hash,
      suite_ref: suiteRef(input.suite),
      started_at: startedAt,
      finished_at: this.now().toISOString(),
      outcome: "INFRA_ERROR",
      paired_results: pairs,
      result: buildEvaluationResult({ input, attemptId, pairs, costSummary, gate }),
    };
  }

  private async runArm(
    attemptId: string,
    evaluationCase: EvaluationCase,
    runSpec: RunSpec,
  ): Promise<CaseRunResult> {
    const runId = this.idFactory();
    const sessionId = this.idFactory();
    const fingerprints = computeRunSpecFingerprints(runSpec);
    const startedAt = this.now().toISOString();
    let fixture: PreparedFixture | undefined;
    try {
      fixture = await this.options.fixture.prepare({
        evaluation_case: evaluationCase,
        arm: runSpec.arm,
        session_id: sessionId,
      });
      const output = await withTimeout(
        this.options.agent.run({
          evaluation_case: evaluationCase,
          run_spec: runSpec,
          workspace_dir: fixture.workspace_dir,
          session_id: sessionId,
          skill_override: renderEvaluationSkillOverride(runSpec.skill_artifact.content),
        }),
        runSpec.budget.timeout_ms,
      );
      validateTelemetry(output, runSpec);
      // Refuse to score an arm that went to the network: a task the agent can look
      // up is not a holdout, and a contaminated pass is indistinguishable from a
      // real improvement once it reaches the gate. See egress.ts for the incident.
      const egress = detectEvaluationEgress(output.tool_calls);
      if (egress.length) throw new EvaluationExecutionError("INFRA", "EVALUATION_EGRESS_DETECTED",
        `${egress.length} outbound network indicator(s); first=[seq ${egress[0].sequence} ${egress[0].tool} ${egress[0].indicator}] ${egress[0].detail}`);
      const oracleResults = await runOracle(evaluationCase.oracle, {
        workspace_dir: fixture.workspace_dir,
        changed_paths: await fixture.changed_paths(),
        tool_calls: output.tool_calls,
        commands: fixture.commands,
        schemas: fixture.schemas,
        custom_assertions: fixture.custom_assertions,
      });

      const oracleError = oracleResults.some((result) => result.status === "ERROR");
      const oracleFailure = oracleResults.some((result) => result.status === "FAIL");
      const budgetFailure = exceedsBudget(output.usage, runSpec);
      const adapterTaskFailure = output.task_failure;
      const status: RunStatus = oracleError
        ? "INFRA_ERROR"
        : oracleFailure || budgetFailure || adapterTaskFailure
          ? "TASK_FAIL"
          : "TASK_PASS";
      const evidence = oracleResults.flatMap((result) => result.evidence_refs);
      let failure: RunFailure | undefined;
      if (oracleError) {
        failure = { kind: "INFRA", codes: ["ORACLE_EXECUTION_ERROR"], evidence_refs: evidence };
      } else if (oracleFailure || budgetFailure || adapterTaskFailure) {
        const codes: TaskFailureCode[] = [];
        if (oracleFailure) codes.push("ORACLE_ASSERTION_FAILED");
        if (budgetFailure) codes.push("BUDGET_EXHAUSTED");
        if (adapterTaskFailure && !codes.includes(adapterTaskFailure.code)) {
          codes.push(adapterTaskFailure.code);
        }
        failure = {
          kind: "TASK",
          codes,
          evidence_refs: [...evidence, ...(adapterTaskFailure?.evidence_refs ?? [])],
        };
      }

      return {
        run_id: runId,
        attempt_id: attemptId,
        arm: runSpec.arm,
        case_ref: runSpec.case_ref,
        session_id: sessionId,
        run_spec_fingerprints: fingerprints,
        skill_artifact_hash: runSpec.skill_artifact.artifact_hash,
        observed_model_id: output.observed_model_id,
        observed_conditions_hash: output.observed_conditions_hash,
        status,
        ...(failure ? { failure } : {}),
        oracle_results: oracleResults,
        usage: output.usage,
        tool_calls: output.tool_calls,
        output_evidence: output.output_evidence,
        trace_refs: output.trace_refs,
        started_at: startedAt,
        finished_at: this.now().toISOString(),
      };
    } catch (error) {
      const executionError = normalizeExecutionError(error, fixture === undefined);
      return infraOrTaskRunResult({
        attemptId,
        runId,
        sessionId,
        runSpec,
        fingerprints,
        error: executionError,
        startedAt,
        now: this.now,
      });
    } finally {
      await fixture?.dispose?.();
    }
  }
}

export function renderEvaluationSkillOverride(content: string): string {
  return `<evaluation_skill>\n${content}\n</evaluation_skill>`;
}

function validateAttemptInput(input: EvaluationRunnerInput): void {
  if (computeSuiteHash(input.suite) !== input.suite.suite_hash) {
    throw new EvaluationExecutionError("INFRA", "RUNNER_INTERNAL_ERROR", "suite hash mismatch");
  }
  if (input.suite.cases.length !== input.cases.length) {
    throw new EvaluationExecutionError("INFRA", "CASE_REVISION_CONFLICT", "suite case count mismatch");
  }
  input.cases.forEach((evaluationCase, index) => {
    const ref = input.suite.cases[index];
    if (computeCaseHash(evaluationCase) !== evaluationCase.case_hash
      || ref.id !== evaluationCase.case_id
      || ref.revision !== evaluationCase.revision
      || ref.hash !== evaluationCase.case_hash) {
      throw new EvaluationExecutionError("INFRA", "CASE_REVISION_CONFLICT", evaluationCase.case_id);
    }
  });
  validateArtifact(input.baseline_artifact, "BASELINE_ARTIFACT_MISMATCH");
  validateArtifact(input.candidate_artifact, "RUNNER_INTERNAL_ERROR");
  if (input.baseline_artifact.source !== "OFFICIAL") throw new Error("baseline must be OFFICIAL");
  if (input.candidate_artifact.source !== "CANDIDATE") throw new Error("candidate must be CANDIDATE");
  if (input.baseline_artifact.skill_id !== input.candidate_artifact.skill_id
    || input.baseline_artifact.base_version !== input.candidate_artifact.base_version) {
    throw new EvaluationExecutionError("INFRA", "RUNSPEC_MISMATCH", "baseline/candidate identity mismatch");
  }
  if (input.baseline_artifact.artifact_hash === input.candidate_artifact.artifact_hash) {
    throw new Error("NO_ARTIFACT_CHANGE");
  }
}

function validateArtifact(artifact: EvaluationSkillArtifact, code: InfraErrorCode): void {
  const { content_hash, artifact_hash } = computeArtifactHashes({
    artifact_id: artifact.artifact_id,
    source: artifact.source,
    source_ref: artifact.source_ref,
    skill_id: artifact.skill_id,
    base_version: artifact.base_version,
    format: artifact.format,
    content: artifact.content,
    injection_contract_revision: artifact.injection_contract_revision,
    read_only: artifact.read_only,
  });
  if (content_hash !== artifact.content_hash || artifact_hash !== artifact.artifact_hash) {
    throw new EvaluationExecutionError("INFRA", code, `${artifact.source}_ARTIFACT_MISMATCH`);
  }
}

function validateTelemetry(output: AgentRunOutput, runSpec: RunSpec): void {
  const usage = output.usage;
  const numeric = [
    usage.input_tokens,
    usage.output_tokens,
    usage.total_tokens,
    usage.model_call_count,
    usage.tool_call_count,
    usage.elapsed_ms,
  ];
  if (numeric.some((value) => !Number.isFinite(value) || value < 0)
    || usage.tool_call_count !== output.tool_calls.length) {
    throw new EvaluationExecutionError("INFRA", "TELEMETRY_INCOMPLETE");
  }
  if (output.observed_model_id !== runSpec.model.model_id) {
    throw new EvaluationExecutionError("INFRA", "RUNSPEC_MISMATCH", "observed model differs");
  }
}

function exceedsBudget(usage: RunUsage, runSpec: RunSpec): boolean {
  const budget = runSpec.budget;
  return usage.model_call_count > budget.max_model_calls
    || usage.tool_call_count > budget.max_tool_calls
    || usage.input_tokens > budget.max_input_tokens
    || usage.output_tokens > budget.max_output_tokens
    || usage.total_tokens > budget.max_total_tokens;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(
          new EvaluationExecutionError("TASK", "AGENT_TIMEOUT"),
        ), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeExecutionError(error: unknown, duringPrepare: boolean): EvaluationExecutionError {
  if (error instanceof EvaluationExecutionError) return error;
  return new EvaluationExecutionError(
    "INFRA",
    duringPrepare ? "ENVIRONMENT_SETUP_FAILED" : "RUNNER_INTERNAL_ERROR",
    (error as Error).message,
  );
}

function infraOrTaskRunResult(input: {
  attemptId: string;
  runId: string;
  sessionId: string;
  runSpec: RunSpec;
  fingerprints: ReturnType<typeof computeRunSpecFingerprints>;
  error: EvaluationExecutionError;
  startedAt: string;
  now: () => Date;
}): CaseRunResult {
  const status = input.error.kind === "INFRA" ? "INFRA_ERROR" : "TASK_FAIL";
  const errorEvidence: EvidenceRef[] = [{
    kind: input.error.kind === "INFRA" ? "oracle_report" : "agent_output",
    uri: `runner-error://${input.error.code}`,
    excerpt: input.error.message,
  }];
  const failure: RunFailure = input.error.kind === "INFRA"
    ? { kind: "INFRA", codes: [input.error.code as InfraErrorCode], evidence_refs: errorEvidence }
    : { kind: "TASK", codes: [input.error.code as TaskFailureCode], evidence_refs: errorEvidence };
  return {
    run_id: input.runId,
    attempt_id: input.attemptId,
    arm: input.runSpec.arm,
    case_ref: input.runSpec.case_ref,
    session_id: input.sessionId,
    run_spec_fingerprints: input.fingerprints,
    skill_artifact_hash: input.runSpec.skill_artifact.artifact_hash,
    observed_model_id: input.runSpec.model.model_id,
    observed_conditions_hash: input.fingerprints.execution_fingerprint,
    status,
    failure,
    oracle_results: [],
    usage: emptyUsage(),
    tool_calls: [],
    output_evidence: [],
    trace_refs: [],
    started_at: input.startedAt,
    finished_at: input.now().toISOString(),
  };
}

function infraRunResult(input: {
  attemptId: string;
  runId: string;
  sessionId: string;
  runSpec: RunSpec;
  fingerprints: ReturnType<typeof computeRunSpecFingerprints>;
  code: InfraErrorCode;
  now: () => Date;
}): CaseRunResult {
  const startedAt = input.now().toISOString();
  return infraOrTaskRunResult({
    ...input,
    error: new EvaluationExecutionError("INFRA", input.code),
    startedAt,
  });
}

function buildEvaluationResult(input: {
  input: EvaluationRunnerInput;
  attemptId: string;
  pairs: ReturnType<typeof classifyPair>[];
  costSummary: ReturnType<typeof aggregateCosts>;
  gate: ReturnType<typeof evaluateGate>;
}): EvaluationResult {
  const comparison: Record<PairClassification, string[]> = {
    unchanged_success: [],
    newly_fixed: [],
    newly_broken: [],
    unchanged_failure: [],
    uncomparable: [],
  };
  input.pairs.forEach((pair) => comparison[pair.classification].push(pair.case_ref.id));
  return {
    attempt_id: input.attemptId,
    candidate_ref: {
      candidate_id: input.input.candidate_id,
      artifact_hash: input.input.candidate_artifact.artifact_hash,
    },
    baseline_ref: {
      skill_id: input.input.baseline_artifact.skill_id,
      version: input.input.baseline_artifact.base_version,
      artifact_hash: input.input.baseline_artifact.artifact_hash,
    },
    suite_ref: suiteRef(input.input.suite),
    baseline_summary: summarize(input.pairs.map((pair) => pair.baseline.status)),
    candidate_summary: summarize(input.pairs.map((pair) => pair.candidate.status)),
    comparison_summary: comparison,
    critical_candidate_failures: input.pairs
      .filter((pair) => pair.critical && pair.candidate.status !== "TASK_PASS")
      .map((pair) => pair.case_ref.id),
    cost_summary: input.costSummary,
    gate: input.gate,
  };
}

function summarize(statuses: RunStatus[]) {
  return {
    pass: statuses.filter((status) => status === "TASK_PASS").length,
    fail: statuses.filter((status) => status === "TASK_FAIL").length,
    infra: statuses.filter((status) => status === "INFRA_ERROR").length,
  };
}

function suiteRef(suite: EvaluationSuite) {
  return { id: suite.suite_id, revision: suite.revision, hash: suite.suite_hash };
}
