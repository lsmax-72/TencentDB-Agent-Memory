import type { CaseRunResult, PairedCaseResult } from "../contracts/types.js";

/**
 * True when the arm was stopped by its resource envelope rather than judged.
 *
 * `BUDGET_EXHAUSTED` and `AGENT_TIMEOUT` both mean the run was interrupted, so
 * the oracle never got to express an opinion on the work. Scoring that as a task
 * failure says "wrong answer" when the truth is "no answer yet", and it does so
 * asymmetrically: a skill that makes the agent keep working costs more and hits
 * the envelope sooner, so thoroughness is punished as incorrectness. That is not
 * hypothetical -- four separate runs produced a submission the grader scored
 * 42/42 or 43/43 and still recorded the arm as a failure for this reason.
 *
 * Cost is not ignored: the gate measures it on the cases whose outcome did not
 * change. Here the honest label is "uncomparable", which the gate turns into
 * INFRA_ERROR -- no verdict -- instead of a fabricated one.
 */
function cutOff(run: CaseRunResult): boolean {
  return run.failure?.kind === "TASK"
    && run.failure.codes.some((code) => code === "BUDGET_EXHAUSTED" || code === "AGENT_TIMEOUT");
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
    && !cutOff(baseline) && !cutOff(candidate)) {
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
      model_calls: candidate.usage.model_call_count - baseline.usage.model_call_count,
      elapsed_ms: candidate.usage.elapsed_ms - baseline.usage.elapsed_ms,
    },
  };
}
