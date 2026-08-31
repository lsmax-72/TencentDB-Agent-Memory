import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { StorageAdapter } from "../../core/storage/adapter.js";
import { ShadowStorageBackend } from "./shadow-storage.js";
import { createProposalRunner } from "./proposal-runner.js";
import { generateSkillProposals } from "./proposals.js";
import { proposeHigherMemory } from "./memory-proposals.js";
import type { ReviewModelConfig } from "./review-model.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
const config: ReviewModelConfig = { provider: "openai-compatible", base_url: "http://offline.invalid/v1", api_key: "offline-secret-never-record",
  model: "offline-review", max_output_tokens: 1000, token_ceiling: 64000, timeout_ms: 10000, temperature: 0, fallback: false };
const params = { prompt: "Make an isolated proposal from evidence", taskId: "offline-task" };
function response(message: Record<string, unknown>, options: { model?: string; usage?: boolean; finish?: string } = {}) {
  return Response.json({ id: "offline-response", object: "chat.completion", created: 1, model: options.model ?? config.model,
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: options.finish ?? (message.tool_calls ? "tool_calls" : "stop") }],
    ...(options.usage === false ? {} : { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }),
  });
}
const toolCall = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: "call-offline", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
function setup(calls = 5) {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const store = metadata.getEvolutionStore();
  const profile = store.saveProfile({ team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill", "memory"], asset_ids: [],
    daily_tokens: 500000, daily_model_calls: calls, daily_candidates: 10, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" }, 0);
  const source = store.append({ team_id: "team", agent_id: "agent", owner_user_id: "owner", kind: "diagnosis", origin: "runtime", status: "DIAGNOSED", title: "Offline evidence", asset_ids: [], payload: { route: "skill_defect" } }, "source", "owner");
  const job = store.append({ ...source, kind: "job", status: "RUNNING", payload: { job_type: "proposal" } }, "job", "owner");
  return { metadata, store, source, jobId: job.id, allocationId: store.allocateCandidateSlots(job.id, 10), authorize: async () => true, profile };
}

describe("independent proposal runner with real SDK and offline HTTP responses", () => {
  it("reserves and records each request before transport, preserving separate model and usage", async () => {
    const input = setup();
    const request = vi.fn(async (_url, init) => {
      expect(input.store.list("team", "job").some(job => job.payload.job_type === "proposal_model_step" && job.status === "RUNNING")).toBe(true);
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(config.model); expect(body.temperature).toBe(0);
      return response({ content: "done" });
    }) as unknown as typeof fetch;
    const runner = createProposalRunner(config, input, request);
    expect(await runner.run(params)).toBe("done");
    const step = input.store.list("team", "job").find(job => job.payload.job_type === "proposal_model_step")!;
    expect(input.store.events(step.id).at(-1)).toMatchObject({ action: "JOB_EVIDENCE" });
    expect(step.status).toBe("COMPLETED");
    expect(JSON.stringify(input.store.list("team"))).not.toContain(config.api_key);
  });
  it("real Skill Review tools create only frozen candidates, not formal Skill", async () => {
    const input = setup(); let turn = 0;
    const content = "---\nname: reusable-checks\ndescription: Verify edits using task evidence.\n---\nInspect the relevant sources and verify the resulting state once.";
    const request = vi.fn(async () => ++turn === 1 ? response(toolCall("skill_create", { name: "reusable-checks", content })) : response({ content: "Candidate proposed." }));
    const officialWrite = vi.fn();
    const core = { create: officialWrite, update: officialWrite, list: async () => ({ items: [], total: 0 }) };
    const records = await generateSkillProposals({ core: core as never, runner: createProposalRunner(config, input, request) },
      { team_id: "team", agent_id: "agent", user_id: "owner", messages: [{ role: "user", content: "Repeated evidence shows missing verification." }] }, input.source, input.store, input.allocationId);
    expect(records).toHaveLength(1); expect(records[0].status).toBe("FROZEN"); expect(officialWrite).not.toHaveBeenCalled();
    expect(input.store.list("team", "job").filter(job => job.payload.job_type === "proposal_model_step")).toHaveLength(2);
    expect(input.store.list("team", "job").filter(job => job.payload.job_type === "proposal_tool_event")).toHaveLength(1);
    expect(input.metadata.listAssetsByTeam("team").items).toEqual([]);
  });
  it("real L2 pipeline selects shadow tools when enableTools is omitted and freezes derived files", async () => {
    const input = setup(); let turn = 0;
    const request = vi.fn(async () => ++turn === 1 ? response(toolCall("write", { path: "project.md", content: "# 项目\n\n用户正在整理证据。" })) : response({ content: "done" }));
    const snapshot = new Map<string, Buffer>();
    const candidate = await proposeHigherMemory({ ...input, targetId: "memory", snapshot, runner: createProposalRunner(config, input, request) }, "L2", [{ content: "正在整理证据。", created_at: "2026-09-01T00:00:00Z" }]);
    expect(candidate?.payload.after).toContain("scene_index.json"); expect(snapshot.size).toBe(0);
    expect(input.metadata.listAssetsByTeam("team").items).toEqual([]);
  });
  it("budget exhaustion stops the second model step after an isolated tool result", async () => {
    const input = setup(1);
    const storage = new StorageAdapter(new ShadowStorageBackend(new Map(), key => key === "proposal.md"));
    const request = vi.fn(async () => response(toolCall("write", { path: "proposal.md", content: "shadow only" })));
    await expect(createProposalRunner(config, input, request).run({ ...params, storage })).rejects.toThrow("EVOLUTION_BUDGET_EXHAUSTED");
    expect(request).toHaveBeenCalledOnce(); expect(await storage.readFile("proposal.md")).toBe("shadow only");
    expect(input.store.list("team", "candidate")).toHaveLength(0);
  });
  it("real L3 postprocessing writes only the isolated final frozen persona", async () => {
    const input = setup(); let turn = 0;
    const request = vi.fn(async () => ++turn === 1 ? response(toolCall("write", { path: "persona.md", content: "# 用户背景\n\n正在整理项目证据。" })) : response({ content: "done" }));
    const candidate = await proposeHigherMemory({ ...input, targetId: "memory", snapshot: new Map(), runner: createProposalRunner(config, input, request) }, "L3");
    expect(candidate?.payload.layer).toBe("L3"); expect(candidate?.payload.after).toContain("persona.md");
    expect(request).toHaveBeenCalledTimes(2); expect(input.metadata.listAssetsByTeam("team").items).toEqual([]);
  });
  it("a grant change during the model response prevents the following tool mutation", async () => {
    const input = setup(); const shadow = new ShadowStorageBackend(new Map(), () => true);
    const request = vi.fn(async () => {
      const { revision, updated_at, ...fields } = input.profile;
      input.store.saveProfile({ ...fields, enabled: false }, revision);
      return response(toolCall("write", { path: "blocked.md", content: "must not be written" }));
    });
    await expect(createProposalRunner(config, input, request).run({ ...params, storage: new StorageAdapter(shadow) })).rejects.toThrow("PROPOSAL_AUTHORIZATION_CHANGED");
    expect(request).toHaveBeenCalledOnce(); expect(shadow.freeze()).toEqual([]);
  });
  it("tool traversal is rejected by real storage tools and preserved as error evidence", async () => {
    const input = setup(); let turn = 0; const shadow = new ShadowStorageBackend(new Map(), () => true);
    const request = vi.fn(async () => ++turn === 1 ? response(toolCall("write", { path: "../outside.md", content: "must not escape" })) : response({ content: "No valid modification." }));
    await createProposalRunner(config, input, request).run({ ...params, storage: new StorageAdapter(shadow) });
    expect(shadow.freeze()).toEqual([]);
    expect(input.store.list("team", "job").find(job => job.payload.job_type === "proposal_tool_event")?.status).toBe("TOOL_ERROR");
  });
  it("does not retry 5xx, substitute models or spend after revoked authorization", async () => {
    const input = setup(); const request = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(createProposalRunner(config, input, request).run(params)).rejects.toThrow("MODEL_UPSTREAM_UNAVAILABLE");
    expect(request).toHaveBeenCalledOnce();
    await expect(createProposalRunner(config, { ...input, authorize: async () => false }, request).run(params)).rejects.toThrow("PROPOSAL_AUTHORIZATION_CHANGED");
    expect(request).toHaveBeenCalledOnce();
    const another = setup();
    await expect(createProposalRunner(config, another, async () => response({ content: "wrong" }, { model: "other" })).run(params)).rejects.toThrow("ACTUAL_REVIEW_MODEL_MISMATCH");
  });
  it("missing usage stays unknown and cannot be treated as a free call", async () => {
    const input = setup(1); const request = vi.fn(async () => response({ content: "no usage" }, { usage: false }));
    await expect(createProposalRunner(config, input, request).run(params)).rejects.toThrow("MODEL_USAGE_MISSING");
    expect(() => input.store.reserve("another", "team", "agent", 1, 1, 0)).toThrow("EVOLUTION_BUDGET_EXHAUSTED");
  });
  it("rejects arbitrary commands, live storage and oversized context before transport", async () => {
    const input = setup(); const request = vi.fn(); const runner = createProposalRunner(config, input, request);
    await expect(runner.run({ ...params, enableTools: true, tools: { shell: {} } })).rejects.toThrow("PROPOSAL_TOOL_NOT_ALLOWED");
    await expect(runner.run({ ...params, enableTools: true, workspaceDir: "/tmp" })).rejects.toThrow("PROPOSAL_SHADOW_STORAGE_REQUIRED");
    await expect(runner.run({ ...params, prompt: "x".repeat(config.token_ceiling) })).rejects.toThrow("REVIEW_CONTEXT_EXCEEDS_RESERVATION");
    expect(request).not.toHaveBeenCalled();
  });
});
