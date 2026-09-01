import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { MetadataService } from "../../metadata/service/metadata-service.js";
import { EvolutionService } from "./service.js";
import { EvolutionDispatcher } from "./dispatcher.js";
import { generateStandaloneProposals } from "./generation.js";
import { createProposalRunner } from "./proposal-runner.js";
import type { ReviewBinding } from "./model-bindings.js";
import { memorySnapshotHash, type MemoryTargetSnapshot } from "./memory-snapshot.js";
import { validateFrozenContent } from "./validation.js";
const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
const completion = { team_id: "team", agent_id: "agent", task_id: "task", session_id: "session", run_id: "run", completion: "host_task_complete", asset_ids: [],
  task_input: "我正在整理项目文档和任务证据，请记录当前工作的背景。", final_output: "offline test task output", tool_events: [],
  usage: { input_tokens: null, output_tokens: null, model_calls: 0, tool_calls: 0 }, actual_model: "OFFLINE_FIXTURE", outcome: "PASS", used_asset_versions: {} };
function modelResponse(message: Record<string, unknown>, finish_reason: "stop" | "tool_calls" = "stop") {
  return Response.json({ id: "offline", object: "chat.completion", created: 1, model: "offline-review", choices: [{ index: 0, finish_reason, message }],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } });
}
function writeTool(path: string, content: string, id: string) {
  return modelResponse({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "write", arguments: JSON.stringify({ path, content }) } }] }, "tool_calls");
}
function setup(route = "memory_gap", assetOwner = "owner", enableValidation = false, autoMemory = false, exactFact = false,
  generateWiki?: NonNullable<Parameters<typeof generateStandaloneProposals>[0]["generateWiki"]>) {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "test-owner", default_key_value: "test-key" });
  metadata.createTeam({ team_id: "team", name: "TEST ONLY", owner_user_id: "owner" });
  metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "test-agent" });
  metadata.createTask({ task_id: "task", team_id: "team", creator_user_id: "owner", title: "offline end-to-end test" });
  metadata.createAsset({ asset_id: "chat_memory-team-agent", team_id: "team", asset_type: "chat_memory", name: "test memory", owner_user_id: assetOwner, source_type: "offline_fixture", visibility: "private", status: "approved" });
  metadata.createAsset({ asset_id: "wiki-team-agent", team_id: "team", asset_type: "llm_wiki", name: "test wiki", owner_user_id: assetOwner, source_type: "offline_fixture", visibility: "private", status: "approved" });
  const store = metadata.getEvolutionStore();
  const profile = store.saveProfile({ team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill", "memory", "wiki"], asset_ids: ["chat_memory-team-agent", "wiki-team-agent"], daily_tokens: 300000, daily_model_calls: 10, daily_candidates: 50, evaluation_profile_id: null, auto_memory: autoMemory, auto_wiki_maintenance: false, authorized_by: "owner", review_model_id: "review" }, 0);
  const permissions = new MetadataService(metadata, "offline-instance");
  const complete = vi.fn(async (input: { system: string; evidence: string }) => {
    const [trace] = JSON.parse(input.evidence);
    return { text: JSON.stringify({ route, explanation: "Offline diagnosis response for wiring test", evidence: [{ record_id: trace.id, observation: "input contains task context" }] }), input_tokens: 20, output_tokens: 10 };
  });
  const request = vi.fn(async () => {
    const trace = store.list("team", "trace").find(record => record.payload.completion === "host_task_complete")!;
    return Response.json({ id: "offline", object: "chat.completion", created: 1, model: "offline-review", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify([{ scene_name: "项目", memories: [{ content: exactFact ? completion.task_input : "用户正在整理项目文档和任务证据。", type: exactFact ? "persona" : "episodic", source_message_ids: [`${trace.id}:input`] }] }]) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } });
  });
  const binding: ReviewBinding = { id: "review", fingerprint: "offline-binding", model: { modelId: "offline-review", tokenCeiling: 1000, complete },
    createProposalRunner: context => createProposalRunner({ provider: "openai-compatible", base_url: "http://offline.invalid/v1", api_key: "offline-only", model: "offline-review", max_output_tokens: 1000, token_ceiling: 64000, timeout_ms: 1000, temperature: 0, fallback: false }, context, request) };
  let service: EvolutionService;
  const snapshot = { scope: { team_id: "team", agent_id: "agent", user_id: "owner" }, records: [], files: [] };
  const snapshotMemory = vi.fn(async (): Promise<MemoryTargetSnapshot> => ({ ...snapshot, hash: memorySnapshotHash(snapshot) }));
  const authorize = (source: Parameters<EvolutionService["authorizeDispatch"]>[0], grant: typeof profile) => service.authorizeDispatch(source, grant);
  const validate = vi.fn((candidate: Parameters<typeof validateFrozenContent>[1]) => validateFrozenContent({ store, metadata, permissions, snapshotMemory,
    canRead: record => service.canReadRecord(record, candidate.owner_user_id) }, candidate));
  const autoApply = vi.fn(async () => {});
  const dispatcher = new EvolutionDispatcher(store, { admitted: () => true, resolveModel: () => binding, authorize,
    generate: (source, job, grant, model) => generateStandaloneProposals({ store, metadata, permissions, authorize, snapshotMemory, getSkillCore: () => undefined,
      ...(generateWiki ? { generateWiki } : {}) }, source, job, grant, model),
    ...(enableValidation ? { validate, autoApply } : {}),
  });
  service = new EvolutionService(store, metadata, permissions, true, dispatcher);
  return { metadata, store, profile, service, dispatcher, complete, request, snapshotMemory, validate, autoApply };
}
describe("explicit completion to real extraction pipeline with offline model responses", () => {
  it("continues diagnosis into one frozen Memory candidate without a second user command", async () => {
    const test = setup(); const assets = test.metadata.listAssetsByTeam("team");
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    expect(test.complete).toHaveBeenCalledOnce(); expect(test.request).toHaveBeenCalledOnce();
    expect(test.store.jobs(["COMPLETED"], ["diagnosis", "proposal"])).toHaveLength(2);
    const [candidate] = test.store.list("team", "candidate");
    expect(candidate.status).toBe("FROZEN"); expect(candidate.payload.asset_kind).toBe("memory"); expect(candidate.payload.layer).toBe("L1");
    expect(test.metadata.listAssetsByTeam("team")).toEqual(assets);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    expect(test.request).toHaveBeenCalledOnce(); expect(test.store.list("team", "candidate")).toHaveLength(1);
  });
  it("freezes governed L1/L2/L3 candidates atomically when the formal snapshot has higher-layer inputs", async () => {
    const test = setup();
    const scope = { team_id: "team", agent_id: "agent", user_id: "owner" };
    const snapshot = { scope, records: [{ record_id: "existing-l1", content: "用户持续整理项目证据。", type: "work_fact", priority: 50,
      scene_name: "项目", session_key: "old", session_id: "old", team_id: "team", task_id: "task", user_id: "owner", agent_id: "agent", version: 1,
      timestamp_str: "2026-09-01T00:00:00Z", timestamp_start: "2026-09-01T00:00:00Z", timestamp_end: "2026-09-01T00:00:00Z",
      created_time: "2026-09-01T00:00:00Z", updated_time: "2026-09-01T00:00:00Z", metadata_json: "{}" }],
      files: [{ key: ".metadata/scene_index.json", content: "[]" }, { key: "scene_blocks/existing.md", content: "# 已有场景\n\n项目证据。" }] };
    test.snapshotMemory.mockResolvedValue({ ...snapshot, hash: memorySnapshotHash(snapshot) });
    let turn = 0;
    test.request.mockImplementation(async () => {
      const trace = test.store.list("team", "trace").find(record => record.payload.completion === "host_task_complete")!;
      if (++turn === 1) return modelResponse({ role: "assistant", content: JSON.stringify([{ scene_name: "项目", memories: [{ content: completion.task_input,
        type: "work_fact", source_message_ids: [`${trace.id}:input`] }] }]) });
      if (turn === 2) return writeTool("scene_blocks/project.md", "# 项目\n\n持续整理项目文档和任务证据。", "l2-write");
      if (turn === 3) return modelResponse({ role: "assistant", content: "done" });
      if (turn === 4) return writeTool("persona.md", "# 用户背景\n\n用户持续整理项目文档和证据。", "l3-write");
      return modelResponse({ role: "assistant", content: "done" });
    });
    const assets = test.metadata.listAssetsByTeam("team");
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const candidates = test.store.list("team", "candidate");
    expect(candidates.map(candidate => candidate.payload.layer).sort()).toEqual(["L1", "L2", "L3"]);
    expect(test.request).toHaveBeenCalledTimes(5); expect(test.store.jobs(["COMPLETED"], ["proposal"])).toHaveLength(1);
    expect(test.metadata.listAssetsByTeam("team")).toEqual(assets);
  });
  it("blocks a three-layer Memory batch before proposal model calls when candidate quota cannot cover it", async () => {
    const test = setup();
    const current = test.store.profile("team", "agent")!;
    const { revision, updated_at: _updatedAt, ...draft } = current;
    test.store.saveProfile({ ...draft, daily_candidates: 2 }, revision);
    const snapshot = { scope: { team_id: "team", agent_id: "agent", user_id: "owner" },
      records: [{ record_id: "existing", content: "已有事实", created_time: "2026-09-01T00:00:00Z" }] as MemoryTargetSnapshot["records"],
      files: [{ key: "scene_blocks/existing.md", content: "# 已有场景" }] };
    test.snapshotMemory.mockResolvedValue({ ...snapshot, hash: memorySnapshotHash(snapshot) });
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [job] = test.store.jobs(["BLOCKED_BUDGET"], ["proposal"]);
    expect(job).toBeDefined(); expect(test.store.events(job.id).at(-1)?.document).toMatchObject({ reason: "EVOLUTION_CANDIDATE_BUDGET_EXHAUSTED" });
    expect(test.request).not.toHaveBeenCalled(); expect(test.store.list("team", "candidate")).toHaveLength(0);
  });
  it("recovers an already frozen batch without replaying the model or creating candidates twice", async () => {
    const test = setup(); await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [job] = test.store.jobs(["COMPLETED"], ["proposal"]);
    test.store.jobTransition(job, "RUNNING");
    test.dispatcher.recover(); await test.dispatcher.idle();
    expect(test.store.get(job.id)?.status).toBe("COMPLETED"); expect(test.request).toHaveBeenCalledOnce();
    expect(test.store.list("team", "candidate")).toHaveLength(1);
  });
  it("a private target stays inaccessible even to the Team admin; generation makes no model call", async () => {
    // Ownership is immutable through updateAsset; seed the actual private owner at creation.
    const test = setup("memory_gap", "someone-else");
    expect(test.metadata.getAssetById("chat_memory-team-agent")?.owner_user_id).toBe("someone-else");
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    expect(test.complete).toHaveBeenCalledOnce(); expect(test.request).not.toHaveBeenCalled();
    expect(test.store.jobs(["BLOCKED_GENERATION"], ["proposal"])).toHaveLength(1);
    expect(test.store.list("team", "candidate")).toHaveLength(0);
  });
  it("missing Wiki bridge is an explicit blocked job, never a fake candidate or formal write", async () => {
    const test = setup("wiki_gap");
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [job] = test.store.jobs(["BLOCKED_GENERATION"], ["proposal"]);
    expect(test.store.events(job.id).at(-1)?.document).toMatchObject({ reason: "WIKI_SOURCE_BRIDGE_REQUIRED" });
    expect(test.request).not.toHaveBeenCalled(); expect(test.store.list("team", "candidate")).toHaveLength(0);
  });
  it("freezes a Wiki proposal returned by the fixed internal source bridge", async () => {
    const proposal = { revision: 1 as const, base: { files: { "raw/sources/manual.md": "c291cmNl" }, hash: "a".repeat(64) },
      files: [{ path: "wiki/page.md", before: null, after: "cGFnZQ==" }], source_paths: ["raw/sources/manual.md"], hash: "b".repeat(64) };
    const generateWiki = vi.fn(async () => proposal);
    const test = setup("wiki_gap", "owner", false, false, false, generateWiki);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [candidate] = test.store.list("team", "candidate");
    expect(generateWiki).toHaveBeenCalledOnce(); expect(candidate.payload).toMatchObject({ asset_kind: "wiki", target_id: "wiki-team-agent", wiki_proposal: proposal });
    expect(test.request).not.toHaveBeenCalled();
  });
  it("preserves the failed proposal and explicitly retries once under an independent receipt", async () => {
    const test = setup(); test.request.mockResolvedValueOnce(new Response("offline failure", { status: 503 }));
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [failed] = test.store.jobs(["INFRA_ERROR"], ["proposal"]);
    expect(failed).toBeDefined(); expect(test.store.list("team", "candidate")).toHaveLength(0);
    const input = { team_id: "team", id: failed.id, request_id: "retry-one" };
    const retry = await test.service.invoke("generation/retry", input, "test-key"); await test.dispatcher.idle();
    const replay = await test.service.invoke("generation/retry", input, "test-key"); await test.dispatcher.idle();
    expect(replay).toMatchObject({ id: (retry as { id: string }).id, status: "COMPLETED", payload: { retry_of: failed.id } });
    expect(test.request).toHaveBeenCalledTimes(2); expect(test.complete).toHaveBeenCalledOnce();
    expect(test.store.get(failed.id)).toEqual(failed); expect(test.store.list("team", "candidate")).toHaveLength(1);
    await expect(test.service.invoke("generation/retry", { ...input, id: (retry as { id: string }).id }, "test-key")).rejects.toThrow("RETRY_REQUIRES_TERMINAL_PROPOSAL");
  });
  it("shared tasks do not expose private target candidates or model/tool evidence to another admin", async () => {
    const test = setup();
    test.metadata.createUser({ user_id: "other", auth_provider: "local", external_id: "other", username: "other-admin", default_key_value: "other-key" });
    test.metadata.addTeamMember({ team_id: "team", user_id: "other", role: "admin" });
    test.metadata.createAsset({ asset_id: "shared", team_id: "team", asset_type: "chat_memory", name: "shared source", owner_user_id: "owner", source_type: "offline_fixture", visibility: "team", status: "approved" });
    const trace = await test.service.invoke("task/complete", { ...completion, asset_ids: ["shared"] }, "test-key") as { id: string };
    await test.dispatcher.idle();
    await expect(test.service.invoke("records/get", { team_id: "team", id: trace.id }, "other-key")).resolves.toBeDefined();
    const derivatives = [...test.store.list("team", "candidate"), ...test.store.jobs(["COMPLETED"], ["proposal", "proposal_model_step"])];
    expect(derivatives).toHaveLength(3);
    for (const record of derivatives) {
      expect(record.asset_ids).toContain("chat_memory-team-agent");
      await expect(test.service.invoke("records/get", { team_id: "team", id: record.id }, "other-key")).rejects.toThrow("RECORD_NOT_FOUND");
    }
    // A target becoming shared still must not declassify an initially unbound private task.
    await test.service.invoke("task/complete", { ...completion, run_id: "private-run" }, "test-key"); await test.dispatcher.idle();
    const privateCandidate = test.store.list("team", "candidate")[0];
    test.metadata.updateAsset("chat_memory-team-agent", { visibility: "team" });
    await expect(test.service.invoke("records/get", { team_id: "team", id: privateCandidate.id }, "other-key")).rejects.toThrow("RECORD_NOT_FOUND");
  });
  it("automatically validates content with a durable receipt, but never calls it proven improvement or auto adopts", async () => {
    const test = setup("memory_gap", "owner", true);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [candidate] = test.store.list("team", "candidate"), [attempt] = test.store.list("team", "attempt");
    expect(candidate.status).toBe("VALIDATED");
    expect(attempt).toMatchObject({ status: "PASS", payload: { attempt_type: "content_validation", candidate_hash: candidate.artifact_hash,
      auto_eligible: false, demonstrates_improvement: false, conflict_assessment: "HUMAN_REVIEW_REQUIRED", model_calls: 0 } });
    expect(test.store.list("team", "adoption")).toHaveLength(0);
    await test.service.invoke("validation/request", { team_id: "team", id: candidate.id }, "test-key"); await test.dispatcher.idle();
    expect(test.validate).toHaveBeenCalledOnce(); expect(test.request).toHaveBeenCalledOnce();
    await test.service.invoke("review/decide", { team_id: "team", id: candidate.id, revision: candidate.revision, decision: "REVIEW_APPROVED", reason: "offline test reviewer has checked source and conflicting facts" }, "test-key");
    expect(test.store.get(candidate.id)?.status).toBe("REVIEW_APPROVED"); expect(test.store.list("team", "adoption")).toHaveLength(0);
  });
  it("auto-authorizes only an exact benign owner fact when the administrator enabled Memory auto adoption", async () => {
    const test = setup("memory_gap", "owner", true, true, true);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [candidate] = test.store.list("team", "candidate"), [attempt] = test.store.list("team", "attempt");
    expect(candidate.status).toBe("AUTO_AUTHORIZED"); expect(attempt.payload).toMatchObject({ auto_eligible: true, demonstrates_improvement: false });
    expect(test.autoApply).toHaveBeenCalledWith(expect.objectContaining({ id: candidate.id, status: "AUTO_AUTHORIZED" }));
  });
  it("a changed target becomes stale; validation retries never rewrite the frozen candidate", async () => {
    const test = setup("memory_gap", "owner", true), validate = test.validate.getMockImplementation()!;
    test.validate.mockImplementationOnce(async candidate => {
      const snapshot = await test.snapshotMemory(); snapshot.files.push({ key: "persona.md", content: "changed after generation" }); snapshot.hash = memorySnapshotHash(snapshot);
      test.snapshotMemory.mockResolvedValue(snapshot); return validate(candidate);
    });
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [candidate] = test.store.list("team", "candidate"); expect(candidate.status).toBe("STALE");
    expect(test.store.list("team", "attempt")[0].payload.reasons).toContain("MEMORY_SOURCE_OR_TARGET_CHANGED");
    const [job] = test.store.jobs(["COMPLETED"], ["validation"]);
    await expect(test.service.invoke("validation/retry", { team_id: "team", id: job.id, request_id: "cannot-update-frozen" }, "test-key")).rejects.toThrow("CANDIDATE_NOT_VALIDATABLE");
    expect(test.store.get(candidate.id)).toEqual(candidate); expect(test.request).toHaveBeenCalledOnce();
  });
  it("skips an exact duplicate without hiding or deleting the existing memory", async () => {
    const test = setup("memory_gap", "owner", true), snapshot = await test.snapshotMemory();
    snapshot.records = [{ record_id: "existing", content: "用户正在整理项目文档和任务证据。", version: 1 }] as MemoryTargetSnapshot["records"];
    snapshot.hash = memorySnapshotHash(snapshot); test.snapshotMemory.mockResolvedValue(snapshot);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const l1 = test.store.list("team", "candidate").find(candidate => candidate.payload.layer === "L1")!;
    expect(l1.status).toBe("DUPLICATE_NO_CHANGE");
    expect(test.store.list("team", "attempt").find(attempt => attempt.payload.candidate_hash === l1.artifact_hash)?.payload.existing_records_unchanged).toBe(true);
    expect(test.store.list("team", "adoption")).toHaveLength(0);
    expect(snapshot.records).toHaveLength(1);
  });
  it("rejects a tampered frozen provenance with a failed content receipt and no model call", async () => {
    const test = setup("memory_gap", "owner", true);
    await test.service.invoke("task/complete", completion, "test-key"); await test.dispatcher.idle();
    const [good] = test.store.list("team", "candidate");
    const invalid = test.store.append({ team_id: good.team_id, agent_id: good.agent_id, owner_user_id: good.owner_user_id, asset_ids: good.asset_ids,
      parent_id: good.parent_id, kind: "candidate", origin: "runtime", status: "FROZEN", title: "offline forged provenance negative case",
      payload: { ...good.payload, extracted_memory: {
        ...(good.payload.extracted_memory as Record<string, unknown>),
        source_message_ids: ["assistant-answer-is-not-proof"],
      } },
    }, "invalid-provenance", "owner");
    await test.service.invoke("validation/request", { team_id: "team", id: invalid.id }, "test-key"); await test.dispatcher.idle();
    expect(test.store.get(invalid.id)?.status).toBe("VALIDATION_FAILED");
    expect(test.store.list("team", "attempt")[0].payload.reasons).toContain("L1_UNTRUSTED_SOURCE");
    expect(test.request).toHaveBeenCalledOnce();
  });
});
