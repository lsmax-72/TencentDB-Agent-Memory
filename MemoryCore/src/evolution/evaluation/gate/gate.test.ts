import { describe, expect, it } from "vitest";
import { hashCanonical } from "../contracts/hash.js";
import type { CaseRunResult, GatePolicy, RunStatus } from "../contracts/types.js";
import { aggregateCosts } from "./cost.js";
import { evaluateGate } from "./evaluate-gate.js";
import { classifyPair } from "./pair-classifier.js";

const HASH = hashCanonical("same");
const POLICY: GatePolicy = {
  policy_revision: "gate-v1",
  min_newly_fixed: 1,
  max_newly_broken: 0,
  require_all_critical_candidate_pass: true,
  max_total_token_increase_ratio: 0.25,
  max_total_tool_call_increase: 5,
};

function run(caseId: string, arm: "BASELINE" | "CANDIDATE", status: RunStatus): CaseRunResult {
  return {
    run_id: `${caseId}-${arm}`,
    attempt_id: "attempt-1",
    arm,
    case_ref: { id: caseId, revision: "1", hash: HASH },
    session_id: `${caseId}-${arm}-session`,
    run_spec_fingerprints: { execution_fingerprint: HASH, full_run_fingerprint: hashCanonical({ arm }) },
    skill_artifact_hash: hashCanonical({ arm, artifact: true }),
    observed_model_id: "deterministic-v1",
    observed_conditions_hash: HASH,
    status,
    ...(status === "TASK_FAIL" ? {
      failure: { kind: "TASK" as const, codes: ["ORACLE_ASSERTION_FAILED" as const], evidence_refs: [] },
    } : {}),
    ...(status === "INFRA_ERROR" ? {
      failure: { kind: "INFRA" as const, codes: ["ENVIRONMENT_RESET_FAILED" as const], evidence_refs: [] },
    } : {}),
    oracle_results: status === "INFRA_ERROR" ? [] : [{
      assertion_id: "assert-1",
      status: status === "TASK_PASS" ? "PASS" : "FAIL",
      evidence_refs: [{ kind: "oracle_report", uri: `memory://${caseId}` }],
    }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, model_call_count: 1, tool_call_count: 1, tool_names: ["edit"], elapsed_ms: 10 },
    tool_calls: [],
    output_evidence: [],
    trace_refs: [],
    started_at: "2026-08-29T00:00:00.000Z",
    finished_at: "2026-08-29T00:00:00.010Z",
  };
}

describe("classifyPair", () => {
  const statuses: RunStatus[] = ["TASK_PASS", "TASK_FAIL", "INFRA_ERROR"];
  const expected = [
    ["unchanged_success", "newly_broken", "uncomparable"],
    ["newly_fixed", "unchanged_failure", "uncomparable"],
    ["uncomparable", "uncomparable", "uncomparable"],
  ];

  for (const [baselineIndex, baselineStatus] of statuses.entries()) {
    for (const [candidateIndex, candidateStatus] of statuses.entries()) {
      it(`${baselineStatus} + ${candidateStatus}`, () => {
        expect(classifyPair(
          run("case", "BASELINE", baselineStatus),
          run("case", "CANDIDATE", candidateStatus),
          false,
        ).classification).toBe(expected[baselineIndex][candidateIndex]);
      });
    }
  }

  it("marks a fingerprint mismatch uncomparable", () => {
    const candidate = run("case", "CANDIDATE", "TASK_PASS");
    candidate.run_spec_fingerprints.execution_fingerprint = hashCanonical("different");
    const pair = classifyPair(run("case", "BASELINE", "TASK_PASS"), candidate, false);
    expect(pair.classification).toBe("uncomparable");
    expect(pair.fairness.status).toBe("MISMATCH");
  });
});

describe("evaluateGate", () => {
  it("passes a fixed case with no regression", () => {
    const pairs = [classifyPair(
      run("fixed", "BASELINE", "TASK_FAIL"),
      run("fixed", "CANDIDATE", "TASK_PASS"),
      true,
    )];
    expect(evaluateGate(pairs, aggregateCosts(pairs), POLICY)).toMatchObject({ status: "PASS", reasons: [] });
  });

  it("fails a regression with structured reasons", () => {
    const pairs = [classifyPair(
      run("regression", "BASELINE", "TASK_PASS"),
      run("regression", "CANDIDATE", "TASK_FAIL"),
      true,
    )];
    const gate = evaluateGate(pairs, aggregateCosts(pairs), POLICY);
    expect(gate.status).toBe("FAIL");
    expect(gate.reasons.map((reason) => reason.code)).toEqual([
      "NO_NEW_FIX",
      "NEW_REGRESSION",
      "CRITICAL_CASE_FAILED",
    ]);
  });

  it("returns INFRA_ERROR instead of candidate failure", () => {
    const pairs = [classifyPair(
      run("infra", "BASELINE", "TASK_PASS"),
      run("infra", "CANDIDATE", "INFRA_ERROR"),
      false,
    )];
    const gate = evaluateGate(pairs, aggregateCosts(pairs), POLICY);
    expect(gate.status).toBe("INFRA_ERROR");
    expect(gate.reasons[0]).toMatchObject({ code: "UNCOMPARABLE_CASE", case_ids: ["infra"] });
  });

  it("does not charge a fix for its own token cost", () => {
    // The baseline aborts early, so it is cheap *because* it failed. Charging
    // that difference to the fix rejected a candidate that had just turned a
    // failure into a pass.
    const baseline = run("hard", "BASELINE", "TASK_FAIL");
    const candidate = run("hard", "CANDIDATE", "TASK_PASS");
    candidate.usage = { ...candidate.usage, input_tokens: 1_000, total_tokens: 1_000, model_call_count: 20 };
    const pairs = [classifyPair(baseline, candidate, true)];
    expect(pairs[0].classification).toBe("newly_fixed");
    expect(evaluateGate(pairs, aggregateCosts(pairs), POLICY)).toMatchObject({ status: "PASS", reasons: [] });
  });

  it("still rejects collateral bloat on unchanged cases", () => {
    const baseline = run("stable", "BASELINE", "TASK_PASS");
    const candidate = run("stable", "CANDIDATE", "TASK_PASS");
    candidate.usage = { ...candidate.usage, input_tokens: 1_000, total_tokens: 1_000 };
    const pairs = [classifyPair(baseline, candidate, false)];
    expect(pairs[0].classification).toBe("unchanged_success");
    const gate = evaluateGate(pairs, aggregateCosts(pairs), POLICY);
    expect(gate.status).toBe("FAIL");
    expect(gate.reasons.map((reason) => reason.code)).toContain("TOKEN_COST_REGRESSION");
  });
});

describe("cut-off arms", () => {
  it("does not record an unfinished arm as a wrong answer", () => {
    // A grader that scores 43/43 while the harness reports BUDGET_EXHAUSTED is
    // the shape that produced four false negatives: the arm was interrupted, so
    // nobody judged it. That is "uncomparable", never "unchanged_failure".
    const baseline = run("grind", "BASELINE", "TASK_FAIL");
    const candidate = run("grind", "CANDIDATE", "TASK_FAIL");
    candidate.failure = { kind: "TASK", codes: ["BUDGET_EXHAUSTED"], evidence_refs: [] };
    const pair = classifyPair(baseline, candidate, false);
    expect(pair.classification).toBe("uncomparable");
    expect(evaluateGate([pair], aggregateCosts([pair]), POLICY).status).toBe("INFRA_ERROR");
  });

  it("treats a wall-clock timeout the same way", () => {
    const baseline = run("slow", "BASELINE", "TASK_PASS");
    const candidate = run("slow", "CANDIDATE", "TASK_FAIL");
    candidate.failure = { kind: "TASK", codes: ["AGENT_TIMEOUT"], evidence_refs: [] };
    expect(classifyPair(baseline, candidate, false).classification).toBe("uncomparable");
  });
});
