import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  jsonSchema: (schema: unknown) => schema,
  tool: (definition: unknown) => definition,
}));

vi.mock("./skill-core.js", () => ({
  SkillCoreError: class SkillCoreError extends Error {
    constructor(public readonly code: string, message?: string) {
      super(message ?? code);
    }
  },
}));

import { CandidateSkillWorkspace } from "./candidate-skill-workspace.js";
import { createSkillTools, type ExtractedSkillCandidate, type SkillToolsBackend } from "./skill-tools.js";
import type { Skill } from "./types.js";

const CONTENT = `---
name: workspace-operation
description: Complete workspace operations.
---

# Workspace Operation

1. Locate the file.
`;

function skill(content = CONTENT): Skill {
  return {
    row_id: "row-3",
    skill_id: "skl-workspace",
    version: 3,
    is_head: true,
    user_id: "user",
    owner_agent_id: "agent",
    team_id: "team",
    task_id: "task",
    name: "workspace-operation",
    description: "Complete workspace operations.",
    content,
    content_hash: "hash",
    manifest: [],
    storage_dir: "skills/skl-workspace/v3",
    status: "active",
    metadata_json: "{}",
    created_at_ms: 1,
    updated_at_ms: 1,
  };
}

function officialBackend(): SkillToolsBackend & { patch: ReturnType<typeof vi.fn> } {
  const current = skill();
  return {
    get: vi.fn(async () => current),
    list: vi.fn(async () => ({ items: [current], total: 1 })),
    search: vi.fn(async () => [{ skill: current, score: 1 }]),
    create: vi.fn(async () => current),
    update: vi.fn(async () => current),
    patch: vi.fn(async (input) => skill(input.old_string
      ? current.content.replace(input.old_string, input.new_string)
      : current.content)),
    writeFiles: vi.fn(async () => current),
  };
}

function tools(core: SkillToolsBackend, auditSink: ExtractedSkillCandidate[] = []) {
  return createSkillTools({
    core,
    user_id: "user",
    team_id: "team",
    agent_id: "agent",
    task_id: "task",
    auditSink,
  }) as Record<string, { execute(input: Record<string, unknown>): Promise<string> }>;
}

describe("review-agent Skill tools backend", () => {
  it("uses the same view/patch contract to produce an isolated Candidate", async () => {
    const official = officialBackend();
    const workspace = new CandidateSkillWorkspace({ official, idFactory: () => "candidate-1" });
    const audit: ExtractedSkillCandidate[] = [];
    const candidateTools = tools(workspace, audit);

    const viewed = JSON.parse(await candidateTools.skill_view.execute({ skill_id: "skl-workspace" }));
    const patched = JSON.parse(await candidateTools.skill_patch.execute({
      skill_id: "skl-workspace",
      old_string: "Locate the file.",
      new_string: "Read the target before editing.",
      expected_version: viewed.version,
    }));
    const resourceResult = JSON.parse(await candidateTools.skill_files_write.execute({
      skill_id: "skl-workspace",
      path: "notes.txt",
      content: "x",
      expected_version: patched.version,
    }));

    expect(workspace.exportCandidate("skl-workspace").content).toContain("Read the target before editing.");
    expect(audit).toMatchObject([{ action: "patch", skill_id: "skl-workspace", version: 4 }]);
    expect(resourceResult.error).toBe("RESOURCE_MUTATION_NOT_SUPPORTED_V1");
    expect(official.patch).not.toHaveBeenCalled();
  });

  it("preserves the ordinary backend write path", async () => {
    const official = officialBackend();
    const ordinaryTools = tools(official);
    await ordinaryTools.skill_patch.execute({
      skill_id: "skl-workspace",
      old_string: "Locate the file.",
      new_string: "Read the file.",
      expected_version: 3,
    });
    expect(official.patch).toHaveBeenCalledOnce();
  });
});
