import type { CaseRunResult, PairedCaseResult } from "../contracts/types.js";

/**
 * True only when the arm was genuinely interrupted, so nobody judged it.
 *
 * `AGENT_TIMEOUT` kills the run mid-flight: there may be no submission at all,
 * and the oracle never expressed an opinion. That is "unknown", and calling it a
 * wrong answer would be a fabrication.
 *
 * `BUDGET_EXHAUSTED` is NOT this. `exceedsBudget` is checked *after* the oracle
 * runs, so a budget-exhausted arm has completed, submitted, and been graded --
 * its verdict is real. Merging the two codes was a mistake: it reclassified
 * repeat 1 of the abc387_f experiment as "no verdict" when the grader had in
 * fact judged the candidate wrong, which nearly turned 1 pass out of 3 into a
 * signal. Over-budget stays a cost matter, reported by the gate as
 * CANDIDATE_BUDGET_EXHAUSTED, and never rewrites the correctness verdict.
 */
function interrupted(run: CaseRunResult): boolean {
  return run.failure?.kind === "TASK" && run.failure.codes.includes("AGENT_TIMEOUT");
}

export function classifyPair(
  baseline: CaseRunResult,
  candidate: CaseRunResult,
  critical: boolean,
): PairedCaseResult {
  const mismatchedFields: string[] = [];
  if (
    baseline.run_spec_fingerprints.execution_fingerprint
      !== candidate.run_spec_fingerprints.execution_fingerprint
  ) {
    mismatchedFields.push("execution_fingerprint");
  }
  if (baseline.observed_conditions_hash !== candidate.observed_conditions_hash) {
    mismatchedFields.push("observed_conditions_hash");
  }

  const fairness = mismatchedFields.length === 0 ? "MATCH" : "MISMATCH";
  let classification: PairedCaseResult["classification"] = "uncomparable";
  if (fairness === "MATCH" && baseline.status !== "INFRA_ERROR" && candidate.status !== "INFRA_ERROR"
    && !interrupted(baseline) && !interrupted(candidate)) {
    if (baseline.status === "TASK_PASS" && candidate.status === "TASK_PASS") {
      classification = "unchanged_success";
    } else if (baseline.status === "TASK_FAIL" && candidate.status === "TASK_PASS") {
      classification = "newly_fixed";
    } else if (baseline.status === "TASK_PASS" && candidate.status === "TASK_FAIL") {
      classification = "newly_broken";
    } else {
      classification = "unchanged_failure";
    }
  }

  return {
    case_ref: baseline.case_ref,
    critical,
    baseline,
    candidate,
    fairness: {
      status: fairness,
      baseline_execution_fingerprint: baseline.run_spec_fingerprints.execution_fingerprint,
      candidate_execution_fingerprint: candidate.run_spec_fingerprints.execution_fingerprint,
      ...(mismatchedFields.length > 0 ? { mismatched_fields: mismatchedFields } : {}),
    },
    classification,
    cost_delta: {
      total_tokens: candidate.usage.total_tokens - baseline.usage.total_tokens,
      tool_calls: candidate.usage.tool_call_count - baseline.usage.tool_call_count,
      model_calls: candidate.usage.model_call_count === null || baseline.usage.model_call_count === null
        ? null
        : candidate.usage.model_call_count - baseline.usage.model_call_count,
      elapsed_ms: candidate.usage.elapsed_ms - baseline.usage.elapsed_ms,
    },
  };
}
