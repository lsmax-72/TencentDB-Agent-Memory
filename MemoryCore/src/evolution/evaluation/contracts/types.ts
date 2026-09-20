export type Sha256 = `sha256:${string}`;

export interface FrozenRef {
  id: string;
  revision: string;
  hash: Sha256;
}

export interface CaseLimits {
  max_model_calls: number;
  max_tool_calls: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_total_tokens: number;
  timeout_ms: number;
}

export interface EvaluationCase {
  case_id: string;
  revision: string;
  case_hash: Sha256;
  title: string;
  goal: string;
  task_input: string;
  fixture: FrozenRef;
  oracle: OracleSpec;
  limits: CaseLimits;
  critical: boolean;
  source_trace_ref?: string;
}

export interface OracleSpec {
  revision: string;
  oracle_hash: Sha256;
  assertions: OracleAssertion[];
}

export type OracleAssertion =
  | { id: string; type: "command_exit"; command_ref: string; expected: number }
  | { id: string; type: "file_exists"; path: string; expected: boolean }
  | {
      id: string;
      type: "file_content";
      path: string;
      match: "exact" | "contains" | "sha256";
      expected: string;
    }
  | { id: string; type: "json_schema"; path: string; schema_ref: FrozenRef }
  | {
      id: string;
      type: "json_value";
      path: string;
      json_pointer: string;
      operator: "equals" | "absent";
      expected?: unknown;
    }
  | {
      id: string;
      type: "custom_assertion";
      assertion_ref: FrozenRef;
      config: Record<string, unknown>;
    };

export type AssertionStatus = "PASS" | "FAIL" | "ERROR";

export interface OracleAssertionResult {
  assertion_id: string;
  status: AssertionStatus;
  evidence_refs: EvidenceRef[];
  error_code?: InfraErrorCode;
}

export interface EvaluationSkillArtifact {
  artifact_id: string;
  source: "OFFICIAL" | "CANDIDATE";
  source_ref: string;
  skill_id: string;
  base_version: number;
  format: "SKILL_MD_V1";
  content: string;
  content_hash: Sha256;
  artifact_hash: Sha256;
  injection_contract_revision: string;
  read_only: true;
}

export type Arm = "BASELINE" | "CANDIDATE";

export interface RunSpec {
  contract_revision: "run-spec-v1";
  arm: Arm;
  case_ref: FrozenRef;
  agent: {
    adapter_id: string;
    code_revision: string;
    system_prompt_hash: Sha256;
    harness_config_hash: Sha256;
  };
  model: {
    provider: string;
    model_id: string;
    temperature: number;
    top_p: number;
    seed: number | "UNSUPPORTED";
    fallback: "DISABLED";
  };
  tools: {
    toolset_id: string;
    schema_hash: Sha256;
    implementation_revision: string;
    permission_policy_hash: Sha256;
  };
  environment: {
    fixture_ref: FrozenRef;
    workspace_image_hash: Sha256;
    isolation: "FRESH_COPY_PER_ARM";
    reset_revision: string;
    sandbox_policy_hash: Sha256;
    network_policy_hash: Sha256;
  };
  context: {
    policy_revision: string;
    non_target_context_hash: Sha256;
    memory_mode: "DISABLED" | "READ_ONLY_SNAPSHOT";
    normal_skill_injection: "DISABLED";
    automatic_skill_extraction: "DISABLED";
  };
  budget: CaseLimits;
  retry_policy: { mode: "NONE" };
  skill_artifact: EvaluationSkillArtifact;
}

export interface RunSpecFingerprints {
  execution_fingerprint: Sha256;
  full_run_fingerprint: Sha256;
}

export type RunStatus = "TASK_PASS" | "TASK_FAIL" | "INFRA_ERROR";

export type TaskFailureCode =
  | "ORACLE_ASSERTION_FAILED"
  | "TOOL_POLICY_VIOLATION"
  | "BUDGET_EXHAUSTED"
  | "AGENT_TIMEOUT"
  | "AGENT_ABORTED";

export type InfraErrorCode =
  | "CASE_REVISION_CONFLICT"
  | "MODEL_UPSTREAM_UNAVAILABLE"
  | "ENVIRONMENT_SETUP_FAILED"
  | "ENVIRONMENT_RESET_FAILED"
  | "TOOL_RUNTIME_UNAVAILABLE"
  | "ORACLE_EXECUTION_ERROR"
  | "TELEMETRY_INCOMPLETE"
  | "RUNSPEC_MISMATCH"
  | "BASELINE_ARTIFACT_MISMATCH"
  //: The agent under test reached the network. A task is not a holdout if it can be looked up.
  | "EVALUATION_EGRESS_DETECTED"
  | "RUNNER_INTERNAL_ERROR";

export interface EvidenceRef {
  kind: "agent_output" | "workspace_file" | "command_output" | "tool_event" | "oracle_report";
  uri: string;
  sha256?: Sha256;
  excerpt?: string;
}

export interface TraceRef {
  provider: "OPIK" | "LANGFUSE" | "HOST";
  trace_id: string;
  url?: string;
}

export interface ToolCallSummary {
  sequence: number;
  name: string;
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  event_ref: EvidenceRef;
}

export interface RunUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  /** null means the agent runtime does not report it (Codex does not); it must never be coerced to 0. */
  model_call_count: number | null;
  tool_call_count: number;
  tool_names: string[];
  elapsed_ms: number;
}

export type RunFailure =
  | { kind: "TASK"; codes: TaskFailureCode[]; evidence_refs: EvidenceRef[] }
  | { kind: "INFRA"; codes: InfraErrorCode[]; evidence_refs: EvidenceRef[] };

export interface CaseRunResult {
  run_id: string;
  attempt_id: string;
  arm: Arm;
  case_ref: FrozenRef;
  session_id: string;
  run_spec_fingerprints: RunSpecFingerprints;
  skill_artifact_hash: Sha256;
  observed_model_id: string;
  observed_conditions_hash: Sha256;
  status: RunStatus;
  failure?: RunFailure;
  oracle_results: OracleAssertionResult[];
  usage: RunUsage;
  tool_calls: ToolCallSummary[];
  output_evidence: EvidenceRef[];
  trace_refs: TraceRef[];
  started_at: string;
  finished_at: string;
}

export type PairClassification =
  | "unchanged_success"
  | "newly_fixed"
  | "newly_broken"
  | "unchanged_failure"
  | "uncomparable";

export interface PairedCaseResult {
  case_ref: FrozenRef;
  critical: boolean;
  baseline: CaseRunResult;
  candidate: CaseRunResult;
  fairness: {
    status: "MATCH" | "MISMATCH";
    baseline_execution_fingerprint: Sha256;
    candidate_execution_fingerprint: Sha256;
    mismatched_fields?: string[];
  };
  classification: PairClassification;
  cost_delta: {
    total_tokens: number;
    tool_calls: number;
    model_calls: number | null;
    elapsed_ms: number;
  };
}

export interface EvaluationSuite {
  suite_id: string;
  revision: string;
  suite_hash: Sha256;
  target_skill_id: string;
  cases: FrozenRef[];
  gate_policy: GatePolicy;
  extension_metadata?: Record<string, unknown>;
}

export type EvaluationOutcome = "RUNNING" | "PASS" | "FAIL" | "INFRA_ERROR";

export interface EvaluationAttempt {
  attempt_id: string;
  attempt_number: number;
  previous_attempt_id?: string;
  candidate_id: string;
  candidate_artifact_hash: Sha256;
  baseline_skill_id: string;
  baseline_version: number;
  baseline_artifact_hash: Sha256;
  suite_ref: FrozenRef;
  started_at: string;
  finished_at?: string;
  outcome: EvaluationOutcome;
  paired_results: PairedCaseResult[];
  result?: EvaluationResult;
}

export interface EvaluationResult {
  attempt_id: string;
  candidate_ref: { candidate_id: string; artifact_hash: Sha256 };
  baseline_ref: { skill_id: string; version: number; artifact_hash: Sha256 };
  suite_ref: FrozenRef;
  baseline_summary: { pass: number; fail: number; infra: number };
  candidate_summary: { pass: number; fail: number; infra: number };
  comparison_summary: Record<PairClassification, string[]>;
  critical_candidate_failures: string[];
  cost_summary: CostSummary;
  gate: GateResult;
}

export interface CostSummary {
  baseline: RunUsage;
  candidate: RunUsage;
  token_increase_ratio: number | null;
  token_ratio_undefined_reason?: "ZERO_BASELINE";
  tool_call_increase: number;
  model_call_increase: number | null;
}

export interface GatePolicy {
  policy_revision: "gate-v1";
  min_newly_fixed: 1;
  max_newly_broken: 0;
  require_all_critical_candidate_pass: true;
  max_total_token_increase_ratio: number;
  max_total_tool_call_increase: number;
}

export type GateStatus = "PASS" | "FAIL" | "INFRA_ERROR";

export type GateReasonCode =
  | "UNCOMPARABLE_CASE"
  | "RUNSPEC_MISMATCH"
  | "BASELINE_ARTIFACT_MISMATCH"
  | "MISSING_REQUIRED_EVIDENCE"
  | "NO_NEW_FIX"
  | "NEW_REGRESSION"
  | "CRITICAL_CASE_FAILED"
  | "TOKEN_COST_REGRESSION"
  | "TOOL_COST_REGRESSION"
  | "CANDIDATE_BUDGET_EXHAUSTED";

export interface GateReason {
  code: GateReasonCode;
  case_ids?: string[];
  observed?: number | string;
  limit?: number | string;
}

export interface GateResult {
  status: GateStatus;
  policy_hash: Sha256;
  reasons: GateReason[];
}
