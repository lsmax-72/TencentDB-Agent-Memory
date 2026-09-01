import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VectorStore } from "../../core/store/sqlite.js";
import { StorageAdapter, createScopedStorageAdapter } from "../../core/storage/adapter.js";
import { LocalStorageBackend } from "../../core/storage/local-backend.js";
import { buildProfileIsolationScope } from "../../core/profile/profile-sync.js";
import { MemoryFrozenAssetHandler } from "./memory-adoption-handler.js";
import { memorySnapshotHash, type MemoryTargetSnapshot } from "./memory-snapshot.js";
import { contentHash } from "./store.js";
import type { CandidatePayload, EvolutionRecord } from "./types.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function runtime(payload: CandidatePayload) {
  const candidate = { id: "candidate", team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", title: "candidate",
    status: "REVIEW_APPROVED", origin: "runtime", asset_ids: [payload.target_id], payload, artifact_hash: contentHash(payload), revision: 3,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" } as EvolutionRecord;
  const operation = { ...candidate, id: "operation", kind: "adoption", parent_id: candidate.id, status: "WRITING", payload: { candidate_hash: candidate.artifact_hash },
    artifact_hash: contentHash({ operation: candidate.artifact_hash }), revision: 2 } as EvolutionRecord;
  return { candidate, operation };
}
function snapshot(files: MemoryTargetSnapshot["files"] = []): MemoryTargetSnapshot {
  const value = { scope: { team_id: "team", agent_id: "agent", user_id: "owner" }, records: [], files };
  return { ...value, hash: memorySnapshotHash(value) };
}
async function setup(current: MemoryTargetSnapshot) {
  const root = mkdtempSync(join(tmpdir(), "memory-adopt-")); roots.push(root);
  const store = new VectorStore(join(root, "memory.sqlite"), 3); await store.init();
  const storage = new StorageAdapter(new LocalStorageBackend(root));
  const handler = new MemoryFrozenAssetHandler({ snapshotMemory: async () => current, resolveTargets: async () => ({ store, storage }) });
  return { root, store, storage, handler };
}
describe("exact frozen Memory adoption", () => {
  it("publishes one deterministic L1 record to JSONL and retrieval index", async () => {
    const current = snapshot(), { handler, store } = await setup(current);
    const payload: CandidatePayload = { asset_kind: "memory", target_id: "memory", layer: "L1", operation: "create", base_hash: contentHash(""), base_version: null,
      before: "", after: "User prefers concise reports.", source_record_ids: ["trace"], target_snapshot_hash: current.hash,
      extracted_memory: { content: "User prefers concise reports.", type: "persona", priority: 70, source_message_ids: ["trace:input"], metadata: {}, scene_name: "preferences" } };
    const { candidate, operation } = runtime(payload);
    expect(await handler.snapshot(candidate, payload)).toMatchObject({ base_hash: payload.base_hash, base_version: null });
    await handler.write(operation, candidate, payload);
    expect(await handler.verify(operation, candidate, payload)).toBe(true);
    expect(await store.searchL1Fts("concise", 5, { teamId: "team", agentId: "agent", userId: "owner" })).toHaveLength(1);
    await expect(handler.write(operation, candidate, payload)).rejects.toThrow("L1_APPLICATION_ALREADY_STARTED");
    store.close();
  });
  it("publishes a frozen L2 bundle and verifies both file bytes and profile index", async () => {
    const before = "# Existing\n", after = "# Existing\n\nVerified workflow.\n", current = snapshot([{ key: "scene_blocks/work.md", content: before }]);
    const { handler, storage, store } = await setup(current), scope = buildProfileIsolationScope({ teamId: "team", agentId: "agent" });
    const scoped = createScopedStorageAdapter(storage, `profiles/${encodeURIComponent(scope)}/`);
    await scoped.writeFile("scene_blocks/work.md", before);
    const files = [{ key: "scene_blocks/work.md", before, after, base_hash: contentHash(before) }];
    const payload: CandidatePayload = { asset_kind: "memory", target_id: "memory", layer: "L2", operation: "update", base_hash: contentHash(JSON.stringify(files.map(file => ({ key: file.key, content: file.before })))),
      base_version: null, before: JSON.stringify(files.map(file => ({ key: file.key, content: file.before }))), after: JSON.stringify(files.map(file => ({ key: file.key, content: file.after }))),
      source_record_ids: ["trace"], target_snapshot_hash: current.hash, memory_files: files };
    const { candidate, operation } = runtime(payload);
    await handler.write(operation, candidate, payload);
    expect(await handler.verify(operation, candidate, payload)).toBe(true);
    expect(await scoped.readFile("scene_blocks/work.md")).toBe(after);
    store.close();
  });
});
