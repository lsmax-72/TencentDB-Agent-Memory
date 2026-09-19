import { afterEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { EvolutionService } from "./service.js";
import { adoptionProof } from "./adoption-proof.js";
import type { EvolutionRecord } from "./types.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "owner", default_key_value: "owner-key" });
  metadata.createUser({ user_id: "reviewer", auth_provider: "local", external_id: "reviewer", username: "reviewer", default_key_value: "reviewer-key" });
  metadata.createTeam({ team_id: "team", name: "EvoAgentBench", owner_user_id: "owner" });
  metadata.addTeamMember({ team_id: "team", user_id: "reviewer", role: "reviewer" });
  metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "nanobot" });
  metadata.createAsset({ asset_id: "skl-workspace", team_id: "team", asset_type: "skill", name: "skill",
    owner_user_id: "owner", source_type: "test", visibility: "private", status: "approved" });
  const store = metadata.getEvolutionStore();
  const candidate = store.append({
    team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", origin: "runtime",
    status: "NEEDS_EVIDENCE", title: "candidate", asset_ids: ["skl-workspace"],
    payload: { asset_kind: "skill", target_id: "skl-workspace", before: "old", after: "new" },
  }, "candidate", "owner");
  return { service: new EvolutionService(store, metadata, { checkAssetPermission: async () => ({ allowed: true, reason: "test" }) }), store, candidate };
}

const run = (status: "TASK_PASS" | "TASK_FAIL") => ({ status, reward: status === "TASK_PASS" ? 1 : 0,
  usage: { total_tokens: 10, model_call_count: 1, tool_call_count: 0 } });
const pair = (classification: "newly_fixed" | "newly_broken" | "unchanged_success") => ({
  case_ref: { id: "abc301_a", trial: 1 },
  baseline: run(classification === "newly_broken" ? "TASK_PASS" : "TASK_FAIL"),
  candidate: run(classification === "newly_broken" ? "TASK_FAIL" : "TASK_PASS"),
  classification,
});
const comparison = (pairs: unknown[], counts: Record<string, number>) => ({
  pairs, counts, transfer_gain: 0, paired_bootstrap_95_ci: [0, 0] as [number, number],
  pass_at_1: 1, token_cost_change: 0,
});

const evidence = (candidateId: string, cmp: ReturnType<typeof comparison>) => ({
  team_id: "team", agent_id: "agent", candidate_id: candidateId, attempt_id: "paired-r1",
  protocol_id: "tdai-evoagentbench-code-v1" as const,
  protocol_hash: "a".repeat(64), source_hash: "b".repeat(64), phase: "development" as const,
  comparison: cmp, evidence_limitations: ["pilot"],
});

const PASSING = comparison([pair("newly_fixed"), pair("unchanged_success")],
  { newly_fixed: 2, newly_broken: 0, unchanged_success: 1, unchanged_failure: 0, incomparable: 0 });
const BREAKING = comparison([pair("newly_fixed"), pair("newly_broken")],
  { newly_fixed: 1, newly_broken: 1, unchanged_success: 0, unchanged_failure: 0, incomparable: 0 });

describe("benchmark evidence reaches the adoption gate", () => {
  it("connects path three: paired evidence alone unblocks review approval", async () => {
    const { service, store, candidate } = setup();

    // Without candidate-scoped evidence the gate refuses, which is exactly the
    // state the project was stuck in: the numbers existed, the gate never saw them.
    await expect(service.invoke("review/decide",
      { team_id: "team", id: candidate.id, revision: candidate.revision, decision: "REVIEW_APPROVED", reason: "looks good" },
      "reviewer-key")).rejects.toThrow("EFFECT_EVALUATION_REQUIRED");
    expect(adoptionProof(store, store.get(candidate.id)!)).toBeNull();

    const attempt = await service.invoke("benchmark/candidate/evidence",
      evidence(candidate.id, PASSING), "owner-key") as EvolutionRecord;

    expect(attempt).toMatchObject({ kind: "attempt", origin: "runtime", parent_id: candidate.id, status: "PASS" });
    expect(attempt.payload).toMatchObject({
      attempt_type: "skill_effect_evaluation", candidate_hash: candidate.artifact_hash,
      gate_result: "PASS", newly_fixed: 2, newly_broken: 0, demonstrates_improvement: true,
    });

    // The load-bearing assertion: the adoption gate now resolves this evidence.
    expect(adoptionProof(store, store.get(candidate.id)!)?.id).toBe(attempt.id);

    const approved = await service.invoke("review/decide",
      { team_id: "team", id: candidate.id, revision: candidate.revision, decision: "REVIEW_APPROVED", reason: "evidence is positive" },
      "reviewer-key") as EvolutionRecord;
    expect(approved.status).toBe("REVIEW_APPROVED");
  });

  it("records a regression as a FAIL instead of a promotion proof", async () => {
    const { service, store, candidate } = setup();
    const attempt = await service.invoke("benchmark/candidate/evidence",
      evidence(candidate.id, BREAKING), "owner-key") as EvolutionRecord;
    expect(attempt).toMatchObject({ status: "FAIL" });
    expect(attempt.payload).toMatchObject({ gate_result: "FAIL", newly_fixed: 1, newly_broken: 1, demonstrates_improvement: false });
    expect(adoptionProof(store, store.get(candidate.id)!)).toBeNull();
    await expect(service.invoke("review/decide",
      { team_id: "team", id: candidate.id, revision: candidate.revision, decision: "REVIEW_APPROVED", reason: "still no" },
      "reviewer-key")).rejects.toThrow("EFFECT_EVALUATION_REQUIRED");
  });

  it("refuses evidence aimed at a non-skill candidate or an unknown record", async () => {
    const { service, store } = setup();
    const memoryCandidate = store.append({
      team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", origin: "runtime",
      status: "NEEDS_EVIDENCE", title: "memory", asset_ids: [],
      payload: { asset_kind: "memory", target_id: "mem", before: "old", after: "new" },
    }, "memory-candidate", "owner");
    await expect(service.invoke("benchmark/candidate/evidence",
      evidence(memoryCandidate.id, PASSING), "owner-key")).rejects.toThrow("SKILL_CANDIDATE_REQUIRED");
    await expect(service.invoke("benchmark/candidate/evidence",
      evidence("evo-missing", PASSING), "owner-key")).rejects.toThrow("RECORD_NOT_FOUND");
  });

  it("leaves the protocol-level research sink research-only", async () => {
    const { service, store, candidate } = setup();
    const research = await service.invoke("benchmark/attempt/ingest", {
      team_id: "team", agent_id: "agent", attempt_id: "pilot-r1", protocol_id: "tdai-evoagentbench-code-v1",
      protocol_hash: "a".repeat(64), source_hash: "b".repeat(64), phase: "development", status: "PASS",
      comparisons: { memory: PASSING, skill: PASSING },
      cost_summary: {
        vanilla: { total_tokens: 1, model_call_count: 1, tool_call_count: 0, elapsed_ms: 1 },
        memory: { total_tokens: 1, model_call_count: 1, tool_call_count: 0, elapsed_ms: 1 },
        skill: { total_tokens: 1, model_call_count: 1, tool_call_count: 0, elapsed_ms: 1 },
      },
      candidate_hash: null, retrieval_coverage: { memory: 0, skill: 0 },
      evidence_limitations: ["pilot"], contamination_findings: [],
    }, "owner-key") as EvolutionRecord;
    expect(research.payload).toMatchObject({ attempt_type: "benchmark_transfer_evaluation", research_only: true, promotion_allowed: false });
    expect(research.parent_id).toBeUndefined();
    expect(adoptionProof(store, store.get(candidate.id)!)).toBeNull();
    expect(store.list("team", "attempt")).toHaveLength(1);
  });
});
