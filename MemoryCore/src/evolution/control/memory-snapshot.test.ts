import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localMemorySnapshot, memorySnapshotHash } from "./memory-snapshot.js";
import type { L1RecordRow } from "../../core/store/types.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const scope = { team_id: "team", agent_id: "agent", user_id: "owner" };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "evolution-snapshot-")); dirs.push(dir);
  const root = join(dir, "profiles", encodeURIComponent("team:team|agent:agent")); mkdirSync(root, { recursive: true });
  const row = { record_id: "one", team_id: "team", agent_id: "agent", user_id: "owner", content: "existing fact", version: 1 } as L1RecordRow;
  const queryL1Records = vi.fn(async () => [row]);
  return { dir, root, row, queryL1Records, snapshot: localMemorySnapshot(dir, async () => ({ queryL1Records })) };
}
describe("standalone Memory sources are exact, bounded and scope-specific", () => {
  it("reads only this profile and filters L1 by Team/Agent/user, never using a global fallback", async () => {
    const test = setup(); writeFileSync(join(test.dir, "persona.md"), "UNSCOPED SECRET");
    writeFileSync(join(test.root, "persona.md"), "scoped persona");
    const snapshot = await test.snapshot(scope);
    expect(test.queryL1Records).toHaveBeenCalledWith({ teamId: "team", agentId: "agent", userId: "owner" });
    expect(snapshot.files).toEqual([{ key: "persona.md", content: "scoped persona" }]);
    expect(snapshot.hash).toBe(memorySnapshotHash(snapshot));
    test.row.content = "updated externally";
    expect(snapshot.records[0].content).toBe("existing fact");
    expect((await test.snapshot(scope)).hash).not.toBe(snapshot.hash);
  });
  it("rejects a store returning another user's row, missing scope, or an oversized source", async () => {
    const test = setup(); test.row.user_id = "someone-else";
    await expect(test.snapshot(scope)).rejects.toThrow("MEMORY_STORE_SCOPE_MISMATCH");
    await expect(test.snapshot({ ...scope, agent_id: "default" })).rejects.toThrow("EXPLICIT_MEMORY_SCOPE_REQUIRED");
    test.row.user_id = "owner"; test.row.content = "x".repeat(2_000_001);
    await expect(test.snapshot(scope)).rejects.toThrow("MEMORY_SNAPSHOT_TOO_LARGE");
  });
  it("rejects file and directory links without reading outside the target", async () => {
    const first = setup(); const secret = join(first.dir, "secret"); writeFileSync(secret, "private");
    symlinkSync(secret, join(first.root, "persona.md"));
    await expect(first.snapshot(scope)).rejects.toThrow("MEMORY_SNAPSHOT_LINK_REJECTED");
    const second = setup(); symlinkSync(first.dir, join(second.root, ".metadata"));
    await expect(second.snapshot(scope)).rejects.toThrow("MEMORY_SNAPSHOT_LINK_REJECTED");
  });
  it("reads native index/checkpoint/nested scenes and changes hash when content changes", async () => {
    const test = setup(); mkdirSync(join(test.root, ".metadata")); mkdirSync(join(test.root, "scene_blocks", "project"), { recursive: true });
    writeFileSync(join(test.root, ".metadata", "scene_index.json"), "[]");
    writeFileSync(join(test.root, ".metadata", "checkpoint.json"), "{}");
    writeFileSync(join(test.root, "scene_blocks", "project", "one.md"), "# Project");
    const before = await test.snapshot(scope); expect(before.files).toHaveLength(3);
    writeFileSync(join(test.root, "scene_blocks", "project", "one.md"), "# Changed");
    expect((await test.snapshot(scope)).hash).not.toBe(before.hash);
  });
});
