import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SkillCore } from "../../core/skill/skill-core.js";
import type { Skill } from "../../core/skill/types.js";
import { SkillFrozenAssetHandler } from "./skill-adoption-handler.js";
import { contentHash } from "./store.js";
import type { CandidatePayload, EvolutionRecord } from "./types.js";
const before = `---\nname: safe-edit\ndescription: Edit and verify files.\n---\n\n# Safe edit\n\nRead, edit, verify.\n`;
const after = before.replace("Read, edit, verify.", "Read, edit, verify, then stop.");
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function artifact(content = after) {
  const content_hash = sha(content), fields = { skill_id: "skl-safe", base_version: 3, content_hash, format: "SKILL_MD_V1" };
  return { candidate_id: "candidate-artifact", operation: "UPDATE", skill_id: "skl-safe", base_version: 3, content, content_hash,
    artifact_hash: sha(JSON.stringify(fields)), source: { user_id: "owner", team_id: "team", agent_id: "agent" }, created_at: "2026-09-01T00:00:00.000Z" };
}
function candidate(payload: CandidatePayload): EvolutionRecord { return { id: "candidate", team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", title: "skill",
  status: "REVIEW_APPROVED", origin: "runtime", asset_ids: ["skl-safe"], payload, artifact_hash: contentHash(payload), revision: 3,
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }; }
function skill(content = before, version = 3, metadata_json = "{}"): Skill { return { row_id: `row-${version}`, skill_id: "skl-safe", version, is_head: true,
  user_id: "owner", owner_agent_id: "agent", team_id: "team", task_id: "task", name: "safe-edit", description: "Edit and verify files.",
  content, content_hash: sha(content), manifest: [], storage_dir: `skills/skl-safe/v${version}`, status: "active", metadata_json, created_at_ms: 1, updated_at_ms: 2 }; }
describe("exact frozen Skill adoption", () => {
  it("updates only the frozen bytes and persists operation ownership in the new version", async () => {
    let head = skill();
    const core = { get: vi.fn(async () => head), list: vi.fn(async () => ({ items: [head], total: 1 })), create: vi.fn(),
      update: vi.fn(async (input) => head = skill(input.content, 4, JSON.stringify(input.metadata))) } as unknown as SkillCore;
    const payload: CandidatePayload = { asset_kind: "skill", target_id: "skl-safe", operation: "update", base_hash: contentHash(before), base_version: 3,
      before, after, source_record_ids: ["diagnosis"], skill_artifact: artifact() };
    const frozen = candidate(payload), operation = { ...frozen, id: "operation", kind: "adoption", parent_id: frozen.id, status: "WRITING" } as EvolutionRecord;
    const handler = new SkillFrozenAssetHandler(core);
    expect(await handler.snapshot(frozen, payload)).toMatchObject({ base_hash: payload.base_hash, base_version: 3 });
    await handler.write(operation, frozen, payload);
    expect(core.update).toHaveBeenCalledWith(expect.objectContaining({ content: after, expected_version: 3 }));
    expect(await handler.verify(operation, frozen, payload)).toBe(true);
  });
  it("rejects a candidate artifact whose frozen content hash was changed", async () => {
    const core = { get: vi.fn(async () => skill()), list: vi.fn(async () => ({ items: [], total: 0 })) } as unknown as SkillCore;
    const payload: CandidatePayload = { asset_kind: "skill", target_id: "skl-safe", operation: "update", base_hash: contentHash(before), base_version: 3,
      before, after, source_record_ids: ["diagnosis"], skill_artifact: { ...artifact(), content_hash: sha("tampered") } };
    await expect(new SkillFrozenAssetHandler(core).snapshot(candidate(payload), payload)).rejects.toThrow("SKILL_ARTIFACT_MISMATCH");
  });
});
