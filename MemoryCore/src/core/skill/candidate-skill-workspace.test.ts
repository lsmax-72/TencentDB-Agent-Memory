import { describe, expect, it, vi } from "vitest";
import type { Skill } from "./types.js";
import type { SkillToolsBackend } from "./skill-tools.js";
import { CandidateSkillWorkspace } from "./candidate-skill-workspace.js";

const BASELINE = `---
name: workspace-operation
description: Complete small workspace operations.
---

# Workspace Operation

1. Locate the file.
2. Make the change.
`;

function officialSkill(content = BASELINE): Skill {
  return {
    row_id: "row-3",
    skill_id: "skl-workspace",
    version: 3,
    is_head: true,
    user_id: "user-1",
    owner_agent_id: "agent-1",
    team_id: "team-1",
    task_id: "task-1",
    name: "workspace-operation",
    description: "Complete small workspace operations.",
    content,
    content_hash: "official-hash",
    manifest: [],
    storage_dir: "skills/skl-workspace/v3",
    status: "active",
    metadata_json: "{}",
    created_at_ms: 1,
    updated_at_ms: 2,
  };
}

function fakeOfficial(): SkillToolsBackend & { update: ReturnType<typeof vi.fn>; writeFiles: ReturnType<typeof vi.fn> } {
  const skill = officialSkill();
  return {
    list: vi.fn(async () => ({ items: [skill], total: 1 })),
    search: vi.fn(async () => [{ skill, score: 1 }]),
    get: vi.fn(async () => skill),
    create: vi.fn(async () => { throw new Error("official create must not run"); }),
    update: vi.fn(async () => { throw new Error("official update must not run"); }),
    patch: vi.fn(async () => { throw new Error("official patch must not run"); }),
    writeFiles: vi.fn(async () => { throw new Error("official files write must not run"); }),
  };
}

describe("CandidateSkillWorkspace", () => {
  it("freezes an official Skill and applies updates only to the candidate overlay", async () => {
    const official = fakeOfficial();
    const workspace = new CandidateSkillWorkspace({
      official,
      idFactory: () => "candidate-1",
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    });

    const viewed = await workspace.get({ skill_id: "skl-workspace", version: 3 });
    const nextContent = BASELINE.replace("2. Make the change.", "2. Make the focused change.");
    const updated = await workspace.update({
      skill_id: "skl-workspace",
      expected_version: viewed.version,
      content: nextContent,
    });

    expect(updated.version).toBe(4);
    expect(workspace.exportCandidate("skl-workspace")).toMatchObject({
      candidate_id: "candidate-1",
      skill_id: "skl-workspace",
      base_version: 3,
      content: nextContent,
    });
    expect(official.update).not.toHaveBeenCalled();
  });

  it("supports candidate create and patch without calling official writes", async () => {
    const official = fakeOfficial();
    const workspace = new CandidateSkillWorkspace({ official, idFactory: () => "new-1" });
    const created = await workspace.create({
      user_id: "user-1",
      team_id: "team-1",
      agent_id: "agent-1",
      name: "new-skill",
      content: BASELINE.replace("workspace-operation", "new-skill"),
    });
    const patched = await workspace.patch({
      skill_id: created.skill_id,
      expected_version: 1,
      old_string: "Locate the file.",
      new_string: "Read the target first.",
    });

    expect(patched.version).toBe(2);
    expect(workspace.exportCandidate(created.skill_id)).toMatchObject({
      operation: "CREATE",
      base_version: 0,
    });
    expect(official.create).not.toHaveBeenCalled();
  });

  it("rejects resource writes with the explicit v1 error", async () => {
    const official = fakeOfficial();
    const workspace = new CandidateSkillWorkspace({ official });

    await expect(workspace.writeFiles({
      skill_id: "skl-workspace",
      expected_version: 3,
      files: [{ path: "notes.txt", content: "x", encoding: "utf-8" }],
    })).rejects.toMatchObject({
      code: "RESOURCE_MUTATION_NOT_SUPPORTED_V1",
    });
    expect(official.writeFiles).not.toHaveBeenCalled();
  });

  it("enforces candidate-local optimistic revisions", async () => {
    const workspace = new CandidateSkillWorkspace({ official: fakeOfficial() });
    await workspace.get({ skill_id: "skl-workspace" });

    await expect(workspace.update({
      skill_id: "skl-workspace",
      expected_version: 2,
      content: BASELINE,
    })).rejects.toMatchObject({ code: "SKILL_VERSION_STALE" });
  });
});
