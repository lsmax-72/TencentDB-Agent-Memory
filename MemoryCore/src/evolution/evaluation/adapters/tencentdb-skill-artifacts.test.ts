import { expect, it, vi } from "vitest";
import { CandidateSkillWorkspace } from "../../../core/skill/candidate-skill-workspace.js";
import type { SkillToolsBackend } from "../../../core/skill/skill-tools.js";
import type { Skill } from "../../../core/skill/types.js";
import { candidateToEvaluationArtifact, loadOfficialEvaluationArtifact } from "./tencentdb-skill-artifacts.js";

const CONTENT = `---
name: workspace-operation
description: Complete workspace operations.
---

# Workspace Operation
`;

function skill(): Skill {
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
    content: CONTENT,
    content_hash: "official-store-hash",
    manifest: [],
    storage_dir: "skills/skl-workspace/v3",
    status: "active",
    metadata_json: "{}",
    created_at_ms: 1,
    updated_at_ms: 1,
  };
}

it("loads an explicit official version and converts an isolated Candidate", async () => {
  const officialSkill = skill();
  const update = vi.fn(async () => officialSkill);
  const official: SkillToolsBackend = {
    get: vi.fn(async () => officialSkill),
    list: vi.fn(async () => ({ items: [officialSkill], total: 1 })),
    search: vi.fn(async () => [{ skill: officialSkill, score: 1 }]),
    create: vi.fn(async () => officialSkill),
    update,
    patch: vi.fn(async () => officialSkill),
    writeFiles: vi.fn(async () => officialSkill),
  };
  const baseline = await loadOfficialEvaluationArtifact(official, {
    skill_id: "skl-workspace",
    version: 3,
    team_id: "team",
    agent_id: "agent",
  });
  const workspace = new CandidateSkillWorkspace({ official, idFactory: () => "candidate-1" });
  await workspace.get({ skill_id: "skl-workspace", version: 3 });
  await workspace.update({
    skill_id: "skl-workspace",
    expected_version: 3,
    content: `${CONTENT}\n1. Read the target before editing.\n`,
  });
  const candidate = candidateToEvaluationArtifact(workspace.exportCandidate("skl-workspace"));

  expect(official.get).toHaveBeenCalledWith(expect.objectContaining({ skill_id: "skl-workspace", version: 3 }));
  expect(baseline.skill_id).toBe(candidate.skill_id);
  expect(baseline.base_version).toBe(candidate.base_version);
  expect(baseline.artifact_hash).not.toBe(candidate.artifact_hash);
  expect(update).not.toHaveBeenCalled();
});
