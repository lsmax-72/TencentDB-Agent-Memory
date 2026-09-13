import { afterEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { EvolutionService } from "./service.js";
import type { EvolutionRecord } from "./types.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "owner", default_key_value: "owner-key" });
  metadata.createUser({ user_id: "other", auth_provider: "local", external_id: "other", username: "other", default_key_value: "other-key" });
  metadata.createTeam({ team_id: "team", name: "EvoAgentBench", owner_user_id: "owner" });
  metadata.addTeamMember({ team_id: "team", user_id: "other", role: "admin" });
  metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "nanobot" });
  metadata.createTask({ task_id: "task", team_id: "team", creator_user_id: "owner", title: "development / vanilla" });
  return new EvolutionService(metadata.getEvolutionStore(), metadata, { checkAssetPermission: async () => ({ allowed: true, reason: "test" }) });
}

const run = { status: "TASK_PASS", reward: 1, usage: { total_tokens: 10, model_call_count: 1, tool_call_count: 0 } } as const;
const comparison = { pairs: [{ case_ref: { id: "abc301_a", trial: 1 }, baseline: run, candidate: run, classification: "unchanged_success" }],
  counts: { newly_fixed: 0, newly_broken: 0, unchanged_success: 1, unchanged_failure: 0, incomparable: 0 },
  transfer_gain: 0, paired_bootstrap_95_ci: [0, 0], pass_at_1: 1, token_cost_change: 0 } as const;
const input = { team_id: "team", agent_id: "agent", attempt_id: "pilot-r1", protocol_id: "tdai-evoagentbench-code-v1",
  protocol_hash: "a".repeat(64), source_hash: "b".repeat(64), phase: "development", status: "FAIL",
  comparisons: { memory: comparison, skill: comparison },
  cost_summary: { vanilla: { total_tokens: 10, model_call_count: 1, tool_call_count: 0, elapsed_ms: 100 }, memory: { total_tokens: 10, model_call_count: 1, tool_call_count: 0, elapsed_ms: 100 }, skill: { total_tokens: 10, model_call_count: 1, tool_call_count: 0, elapsed_ms: 100 } },
  candidate_hash: null, retrieval_coverage: { memory: 0, skill: 0 }, evidence_limitations: ["pilot"], contamination_findings: [],
} as const;

describe("EvoAgentBench evidence ingestion", () => {
  it("stores immutable research evidence without jobs or adoption proof semantics", async () => {
    const service = setup();
    const first = await service.invoke("benchmark/attempt/ingest", input, "owner-key") as EvolutionRecord;
    expect(await service.invoke("benchmark/attempt/ingest", input, "owner-key")).toEqual(first);
    expect(first).toMatchObject({ kind: "attempt", status: "FAIL", origin: "runtime", asset_ids: [] });
    expect(first.payload).toMatchObject({ attempt_type: "benchmark_transfer_evaluation", research_only: true, promotion_allowed: false });
    expect(service.store.list("team", "job")).toEqual([]);
  });

  it("rejects changed replays and another administrator importing for the owner", async () => {
    const service = setup();
    await service.invoke("benchmark/attempt/ingest", input, "owner-key");
    await expect(service.invoke("benchmark/attempt/ingest", { ...input, status: "PASS" }, "owner-key")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(service.invoke("benchmark/attempt/ingest", { ...input, attempt_id: "other-r1" }, "other-key")).rejects.toThrow("AGENT_OWNER_REQUIRED");
  });

  it("accepts known frozen protocol revisions and rejects unknown protocols", async () => {
    const service = setup();
    const v2 = { ...input, attempt_id: "discriminative-r3", protocol_id: "tdai-evoagentbench-code-v2-discriminative" } as const;
    const record = await service.invoke("benchmark/attempt/ingest", v2, "owner-key") as EvolutionRecord;
    expect(record.payload).toMatchObject({ protocol_id: "tdai-evoagentbench-code-v2-discriminative", research_only: true });
    const v4 = { ...input, attempt_id: "trace2skill-r2", protocol_id: "tdai-evoagentbench-code-v3-suite-generation-v2" } as const;
    expect(await service.invoke("benchmark/attempt/ingest", v4, "owner-key")).toMatchObject({
      payload: { protocol_id: "tdai-evoagentbench-code-v3-suite-generation-v2", promotion_allowed: false },
    });
    const v5 = { ...input, attempt_id: "factorial-r1", protocol_id: "tdai-evoagentbench-code-v5-factorial-heldout",
      comparisons: { ...input.comparisons, memory_skill: comparison },
      cost_summary: { ...input.cost_summary, memory_skill: input.cost_summary.skill },
      factorial: { comparable_task_count: 1, combined_minus_memory: 0, combined_minus_skill: 0, interaction_effect: 0,
        combined_minus_memory_95_ci: [0, 0], combined_minus_skill_95_ci: [0, 0], interaction_95_ci: [0, 0] },
    } as const;
    expect(await service.invoke("benchmark/attempt/ingest", v5, "owner-key")).toMatchObject({
      payload: { protocol_id: "tdai-evoagentbench-code-v5-factorial-heldout", factorial: { comparable_task_count: 1 } },
    });
    for (const protocol_id of [
      "tdai-evoagentbench-code-v5-factorial-generation-v2",
      "tdai-evoagentbench-code-v5-factorial-generation-v3",
      "tdai-evoagentbench-code-v5-factorial-frozen-composite-v1",
    ] as const) {
      expect(await service.invoke("benchmark/attempt/ingest", {
        ...v5, attempt_id: protocol_id, protocol_id,
      }, "owner-key")).toMatchObject({ payload: { protocol_id, promotion_allowed: false } });
    }
    await expect(service.invoke("benchmark/attempt/ingest", { ...v2, attempt_id: "unknown", protocol_id: "unknown-protocol" }, "owner-key"))
      .rejects.toThrow();
  });

  it("stores development run details without dispatching diagnosis", async () => {
    const service = setup();
    const body = {
      team_id: "team", agent_id: "agent", task_id: "task", run_id: "development-a-vanilla-trial-1", session_id: "session-1",
      protocol_hash: "a".repeat(64), phase: "development", arm: "vanilla", trial: 1,
      status: "TASK_PASS", reward: 1, candidate_revision: null, candidate_hash: null,
      task_input: "Solve safely", final_output: "Done", tool_events: [],
      usage: { input_tokens: 10, output_tokens: 2, model_calls: 1, tool_calls: 0 }, actual_model: "qwen3.8-27b", injected_assets: [],
    } as const;
    const record = await service.invoke("benchmark/run/ingest", body, "owner-key") as EvolutionRecord;
    expect(record).toMatchObject({ kind: "trace", status: "RECORDED", asset_ids: [] });
    expect(record.payload).toMatchObject({ evidence_mode: "benchmark", completion: "benchmark_verifier_complete", test_traces_candidate_eligible: false });
    expect(service.store.list("team", "job")).toEqual([]);
    await expect(service.invoke("diagnosis/request", { team_id: "team", id: record.id }, "owner-key"))
      .rejects.toThrow("HOST_TASK_COMPLETION_REQUIRED");
  });

  it("records an evolved retrieval abstention when the frozen candidate remains bound", async () => {
    const service = setup();
    const body = {
      team_id: "team", agent_id: "agent", task_id: "task", run_id: "development-a-skill-r2-trial-1", session_id: "session-2",
      protocol_hash: "a".repeat(64), phase: "development", arm: "skill", trial: 1,
      status: "TASK_PASS", reward: 1, candidate_revision: 2, candidate_hash: "c".repeat(64),
      task_input: "Solve safely", final_output: "Done", tool_events: [],
      usage: { input_tokens: 10, output_tokens: 2, model_calls: 1, tool_calls: 0 }, actual_model: "qwen3.8-27b", injected_assets: [],
    } as const;
    const record = await service.invoke("benchmark/run/ingest", body, "owner-key") as EvolutionRecord;
    expect(record.payload).toMatchObject({ arm: "skill", candidate_revision: 2, injected_assets: [], used_asset_versions: {} });
  });

  it("accepts the bounded combined arm with one frozen candidate binding", async () => {
    const service = setup();
    const body = {
      team_id: "team", agent_id: "agent", task_id: "task", run_id: "development-a-memory_skill-r2-trial-1", session_id: "session-3",
      protocol_hash: "a".repeat(64), phase: "development", arm: "memory_skill", trial: 1,
      status: "TASK_PASS", reward: 1, candidate_revision: 2, candidate_hash: "c".repeat(64),
      task_input: "Solve safely", final_output: "Done", tool_events: [],
      usage: { input_tokens: 10, output_tokens: 2, model_calls: 1, tool_calls: 0 }, actual_model: "qwen3.8-27b",
      injected_assets: [
        { id: "skill-1", hash: "d".repeat(64) }, { id: "memory-1", hash: "e".repeat(64) },
      ],
    } as const;
    const record = await service.invoke("benchmark/run/ingest", body, "owner-key") as EvolutionRecord;
    expect(record.payload).toMatchObject({ arm: "memory_skill", candidate_revision: 2 });
  });
});
