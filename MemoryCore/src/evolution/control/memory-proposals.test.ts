import { afterEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { proposeHigherMemory, proposeL1 } from "./memory-proposals.js";
import type { LLMRunner } from "../../core/types.js";
import type { ConversationMessage } from "../../core/conversation/l0-recorder.js";
const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: "t", agent_id: "a", enabled: true, asset_kinds: ["memory"], asset_ids: [], daily_tokens: 100000, daily_model_calls: 10, daily_candidates: 10, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "u" }, 0);
  const source = store.append({ team_id: "t", agent_id: "a", owner_user_id: "u", kind: "trace", title: "offline source", status: "RECORDED", origin: "runtime", asset_ids: [], payload: {} }, "source", "u");
  const job = store.append({ ...source, kind: "job", status: "RUNNING", payload: { job_type: "proposal" } }, "job", "u");
  return { store, source, metadata, targetId: "memory-asset", allocationId: store.allocateCandidateSlots(job.id), snapshot: new Map<string, Buffer>() };
}
describe("native Memory pipelines use isolated proposals", () => {
  it("L1 preserves extracted provenance without registering official Memory", async () => {
    const input = setup();
    const runner: LLMRunner = { run: async () => JSON.stringify([{ scene_name: "项目", memories: [{ content: "用户正在编写项目文档。", type: "episodic", source_message_ids: ["m1"] }] }]) };
    const messages = [{ id: "m1", role: "user", content: "我正在编写项目文档，希望记录任务的当前背景。", timestamp: Date.now() }] as unknown as ConversationMessage[];
    const candidates = await proposeL1({ ...input, runner }, messages);
    expect(candidates).toHaveLength(1); expect(candidates[0].payload.layer).toBe("L1");
    expect(input.metadata.listAssetsByTeam("t").items).toEqual([]);
  });
  it("L2 includes derived index/navigation, while source bytes remain unchanged", async () => {
    const input = setup();
    const runner: LLMRunner = { run: async params => { await params.storage!.writeFile("scene_blocks/project.md", "# 项目\n\n正在编写项目文档。"); return "done"; } };
    const candidate = await proposeHigherMemory({ ...input, runner }, "L2", [{ content: "正在编写项目文档。", created_at: "2026-08-31T00:00:00Z" }]);
    expect(candidate?.payload.layer).toBe("L2");
    expect(candidate?.payload.after).toContain("scene_index.json");
    expect(input.snapshot.size).toBe(0); expect(input.metadata.listAssetsByTeam("t").items).toEqual([]);
  });
  it("L3 uses the real postprocessor, but never touches official persona", async () => {
    const input = setup();
    const runner: LLMRunner = { run: async params => { await params.storage!.writeFile("persona.md", "# 用户背景\n\n正在编写文档。"); return "done"; } };
    const candidate = await proposeHigherMemory({ ...input, runner }, "L3");
    expect(candidate?.payload.layer).toBe("L3"); expect(candidate?.payload.after).toContain("persona.md");
    expect(input.snapshot.size).toBe(0); expect(input.metadata.listAssetsByTeam("t").items).toEqual([]);
  });
  it("rejects out-of-scope L3 writes and never falls back to a live runner", async () => {
    const input = setup();
    const runner: LLMRunner = { run: async params => { await params.storage!.writeFile("scene_blocks/overwrite.md", "forbidden"); return "done"; } };
    await expect(proposeHigherMemory({ ...input, runner }, "L3")).rejects.toThrow("MEMORY_GENERATION_FAILED");
    expect(input.store.list("t", "candidate")).toHaveLength(0);
  });
});
