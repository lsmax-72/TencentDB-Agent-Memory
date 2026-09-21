import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runClosedLoop,
  runManifestFile,
  type ClosedLoopManifest,
  type FailureCase,
  type FetchLike,
} from "./closed-loop.js";

const baseCase = {
  case_id: "failure-1",
  task_input: "fix the command",
  final_output: "the command failed",
  tool_events: [{ name: "exec", arguments: "{}", result: "exit 1", success: false, sequence: 0 }],
  outcome: "FAIL" as const,
  asset_ids: ["skill-1"],
};

function manifest(cases: FailureCase[] = [baseCase]): ClosedLoopManifest {
  return {
    team_id: "team-1",
    agent_id: "agent-1",
    user_id: "user-1",
    base_url: "http://127.0.0.1:8420",
    cases,
  };
}

function record(id: string, kind: string, status: string, payload: Record<string, unknown> = {}) {
  return { id, kind, status, payload };
}

function envelope(data: unknown): Response {
  return Response.json({ code: 0, message: "ok", data });
}

function queuedFetch(responses: unknown[]) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn<FetchLike>(async (input, init) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected HTTP call");
    return envelope(next);
  });
  return { fetch, requests };
}

function happyResponses() {
  return [
    { task_id: "task-1" },
    record("trace-1", "trace", "RECORDED"),
    record("diagnosis-job", "job", "QUEUED", { job_type: "diagnosis" }),
    { record: record("diagnosis-job", "job", "COMPLETED", { job_type: "diagnosis" }), events: [{ document: { result_id: "diagnosis-1" } }], related: [] },
    { record: record("diagnosis-1", "diagnosis", "DIAGNOSED", { route: "skill_defect" }), events: [], related: [record("proposal-job", "job", "QUEUED", { job_type: "proposal" })] },
    { record: record("proposal-job", "job", "COMPLETED", { job_type: "proposal" }), events: [{ document: { result_ids: ["candidate-1"], no_change: false } }], related: [] },
    { record: record("candidate-1", "candidate", "FROZEN", { asset_kind: "skill" }), events: [], related: [] },
    record("validation-job", "job", "QUEUED", { job_type: "validation" }),
    { record: record("validation-job", "job", "COMPLETED", { job_type: "validation" }), events: [], related: [] },
    record("evaluation-job", "job", "QUEUED", { job_type: "evaluation" }),
    { record: record("evaluation-job", "job", "COMPLETED", { job_type: "evaluation" }), events: [{ document: { result_id: "attempt-1" } }], related: [] },
    { record: record("attempt-1", "attempt", "PASS", {
      attempt_type: "skill_effect_evaluation",
      gate_result: "PASS",
      newly_fixed: 2,
      newly_broken: 0,
      comparison_summary: { newly_fixed: ["case-a", "case-b"], newly_broken: [] },
    }), events: [], related: [] },
  ];
}

function blockedResponses() {
  return [
    { task_id: "task-1" },
    record("trace-1", "trace", "RECORDED"),
    record("diagnosis-job", "job", "BLOCKED_AUTOMATION_DISABLED", { job_type: "diagnosis" }),
    {
      record: record("diagnosis-job", "job", "BLOCKED_AUTOMATION_DISABLED", { job_type: "diagnosis" }),
      events: [{ action: "JOB_EVIDENCE", document: { reason: "AUTOMATION_NOT_ENABLED" } }],
      related: [],
    },
  ];
}

const options = { apiKey: "gateway-key", userKey: "user-key", pollIntervalMs: 0 };

describe("closed-loop yield driver", () => {
  it("runs the complete path and counts a gate-accepted Skill candidate", async () => {
    const fake = queuedFetch(happyResponses());
    const result = await runClosedLoop(manifest(), { ...options, fetch: fake.fetch });

    expect(result.results).toMatchObject([{
      case_id: "failure-1",
      outcome: "accepted",
      newly_fixed: 2,
      newly_broken: 0,
      candidate_results: [{
        attempt_type: "skill_effect_evaluation",
        gate_result: "PASS",
        classification_summary: { newly_fixed: ["case-a", "case-b"], newly_broken: [] },
      }],
    }]);
    expect(result.summary).toEqual({
      accepted: 1,
      rejected: 0,
      unmeasurable: 0,
      no_candidate: 0,
      accepted_cases: [{ case_id: "failure-1", newly_fixed: 2, newly_broken: 0 }],
    });
  });

  it("always requests isolated diagnosis evidence", async () => {
    const fake = queuedFetch(blockedResponses());
    await runClosedLoop(manifest(), { ...options, fetch: fake.fetch });

    const diagnosis = fake.requests.find(request => request.path === "/v3/evolution/diagnosis/request");
    expect(diagnosis?.body).toMatchObject({ evidence: { mode: "isolated" } });
  });

  it("records a blocked diagnosis as unmeasurable with its raw status and reason", async () => {
    const fake = queuedFetch(blockedResponses());
    const result = await runClosedLoop(manifest(), { ...options, fetch: fake.fetch });

    expect(result.results[0]).toMatchObject({
      outcome: "unmeasurable",
      reason: "BLOCKED_AUTOMATION_DISABLED:AUTOMATION_NOT_ENABLED",
    });
    expect(result.summary.unmeasurable).toBe(1);
  });

  it("skips a case finished in the state file without making an HTTP call", async () => {
    const directory = mkdtempSync(join(tmpdir(), "closed-loop-resume-"));
    try {
      const manifestPath = join(directory, "manifest.json");
      const statePath = join(directory, "state.json");
      writeFileSync(manifestPath, JSON.stringify(manifest()), "utf8");
      writeFileSync(statePath, JSON.stringify({
        version: 1,
        cases: { "failure-1": { outcome: "rejected", reason: "FAIL", candidate_results: [] } },
      }), "utf8");
      const fetch = vi.fn<FetchLike>();

      const result = await runManifestFile(manifestPath, statePath, { ...options, fetch });

      expect(fetch).not.toHaveBeenCalled();
      expect(result.summary.rejected).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("appends operator knowledge only when the field is present", async () => {
    const withKnowledge = queuedFetch(blockedResponses());
    await runClosedLoop(manifest([{ ...baseCase, knowledge: "The binary requires --json." }]), { ...options, fetch: withKnowledge.fetch });
    const enriched = withKnowledge.requests.find(request => request.path === "/v3/evolution/task/complete");
    expect(enriched?.body.final_output).toBe("the command failed\n\nKNOWN FACTS (provided by the operator):\nThe binary requires --json.");

    const withoutKnowledge = queuedFetch(blockedResponses());
    await runClosedLoop(manifest(), { ...options, fetch: withoutKnowledge.fetch });
    const unchanged = withoutKnowledge.requests.find(request => request.path === "/v3/evolution/task/complete");
    expect(unchanged?.body.final_output).toBe("the command failed");
  });
});
