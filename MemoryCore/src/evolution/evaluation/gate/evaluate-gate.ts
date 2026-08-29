import { computeGatePolicyHash } from "../contracts/hash.js";
import type {
  CostSummary,
  GatePolicy,
  GateReason,
  GateResult,
  InfraErrorCode,
  PairedCaseResult,
} from "../contracts/types.js";

export function evaluateGate(
  pairedResults: PairedCaseResult[],
  costSummary: CostSummary,
  gatePolicy: GatePolicy,
): GateResult {
  const policy_hash = computeGatePolicyHash(gatePolicy);
  const infraReasons = collectInfraReasons(pairedResults);
  if (infraReasons.length > 0) {
    return { status: "INFRA_ERROR", policy_hash, reasons: infraReasons };
  }

  const reasons: GateReason[] = [];
  const newlyFixed = caseIds(pairedResults, "newly_fixed");
  const newlyBroken = caseIds(pairedResults, "newly_broken");
  if (newlyFixed.length < gatePolicy.min_newly_fixed) {
    reasons.push({ code: "NO_NEW_FIX", observed: newlyFixed.length, limit: gatePolicy.min_newly_fixed });
  }
  if (newlyBroken.length > gatePolicy.max_newly_broken) {
    reasons.push({
      code: "NEW_REGRESSION",
      case_ids: newlyBroken,
      observed: newlyBroken.length,
      limit: gatePolicy.max_newly_broken,
    });
  }

  const criticalFailures = pairedResults
    .filter((pair) => pair.critical && pair.candidate.status !== "TASK_PASS")
    .map((pair) => pair.case_ref.id);
  if (gatePolicy.require_all_critical_candidate_pass && criticalFailures.length > 0) {
    reasons.push({ code: "CRITICAL_CASE_FAILED", case_ids: criticalFailures });
  }

  const budgetFailures = pairedResults
    .filter((pair) => pair.candidate.failure?.kind === "TASK"
      && pair.candidate.failure.codes.includes("BUDGET_EXHAUSTED"))
    .map((pair) => pair.case_ref.id);
  if (budgetFailures.length > 0) {
    reasons.push({ code: "CANDIDATE_BUDGET_EXHAUSTED", case_ids: budgetFailures });
  }

  const tokenRegression = costSummary.token_increase_ratio === null
    ? costSummary.candidate.total_tokens > 0
    : costSummary.token_increase_ratio > gatePolicy.max_total_token_increase_ratio;
  if (tokenRegression) {
    reasons.push({
      code: "TOKEN_COST_REGRESSION",
      observed: costSummary.token_increase_ratio ?? "ZERO_BASELINE",
      limit: gatePolicy.max_total_token_increase_ratio,
    });
  }
  if (costSummary.tool_call_increase > gatePolicy.max_total_tool_call_increase) {
    reasons.push({
      code: "TOOL_COST_REGRESSION",
      observed: costSummary.tool_call_increase,
      limit: gatePolicy.max_total_tool_call_increase,
    });
  }

  return { status: reasons.length === 0 ? "PASS" : "FAIL", policy_hash, reasons };
}

function collectInfraReasons(pairs: PairedCaseResult[]): GateReason[] {
  const reasons: GateReason[] = [];
  const uncomparable = pairs
    .filter((pair) => pair.classification === "uncomparable")
    .map((pair) => pair.case_ref.id);
  if (uncomparable.length > 0) reasons.push({ code: "UNCOMPARABLE_CASE", case_ids: uncomparable });

  const mismatches = pairs
    .filter((pair) => pair.fairness.status === "MISMATCH")
    .map((pair) => pair.case_ref.id);
  if (mismatches.length > 0) reasons.push({ code: "RUNSPEC_MISMATCH", case_ids: mismatches });

  const baselineMismatch = pairs
    .filter((pair) => hasInfraCode(pair, "BASELINE_ARTIFACT_MISMATCH"))
    .map((pair) => pair.case_ref.id);
  if (baselineMismatch.length > 0) {
    reasons.push({ code: "BASELINE_ARTIFACT_MISMATCH", case_ids: baselineMismatch });
  }

  const missingEvidence = pairs
    .filter((pair) => !hasRequiredEvidence(pair.baseline) || !hasRequiredEvidence(pair.candidate))
    .map((pair) => pair.case_ref.id);
  if (missingEvidence.length > 0) {
    reasons.push({ code: "MISSING_REQUIRED_EVIDENCE", case_ids: missingEvidence });
  }
  return reasons;
}

function hasInfraCode(pair: PairedCaseResult, code: InfraErrorCode): boolean {
  return [pair.baseline, pair.candidate].some(
    (run) => run.failure?.kind === "INFRA" && run.failure.codes.includes(code),
  );
}

function hasRequiredEvidence(run: PairedCaseResult["baseline"]): boolean {
  if (run.status === "INFRA_ERROR") return true;
  if (run.status === "TASK_FAIL"
    && run.failure?.kind === "TASK"
    && !run.failure.codes.includes("ORACLE_ASSERTION_FAILED")) {
    return run.failure.evidence_refs.length > 0;
  }
  return run.oracle_results.length > 0
    && run.oracle_results.every((result) => result.evidence_refs.length > 0);
}

function caseIds(
  pairs: PairedCaseResult[],
  classification: PairedCaseResult["classification"],
): string[] {
  return pairs.filter((pair) => pair.classification === classification).map((pair) => pair.case_ref.id);
}
