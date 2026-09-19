import { expect, it, vi } from "vitest";
import { CandidateSkillWorkspace } from "../../../core/skill/candidate-skill-workspace.js";
import type { SkillToolsBackend } from "../../../core/skill/skill-tools.js";
import type { Skill } from "../../../core/skill/types.js";
import { computeArtifactHashes } from "../contracts/hash.js";
import { EVALUATION_SKILL_INJECTION_REVISION, candidateToEvaluationArtifact, emptyEvaluationArtifact, loadOfficialEvaluationArtifact } from "./tencentdb-skill-artifacts.js";

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

it("gives a brand-new skill an empty baseline instead of refusing to evaluate it", () => {
  // `CREATE` is what the proposal model emits when the diagnosis reads as
  // "there is no SOP for this". It used to throw
  // NEW_SKILL_CANDIDATE_NOT_SUPPORTED_BY_PAIRED_EVALUATION_V1, so a new skill
  // could be generated but never evaluated, and therefore never adopted.
  const withoutHashes = {
    artifact_id: "candidate-new",
    source: "CANDIDATE" as const,
    source_ref: "candidate-new",
    skill_id: "candidate-skill-new",
    base_version: 0,
    format: "SKILL_MD_V1" as const,
    content: CONTENT,
    injection_contract_revision: EVALUATION_SKILL_INJECTION_REVISION,
    read_only: true as const,
  };
  const created = candidateToEvaluationArtifact({
    candidate_id: "candidate-new",
    operation: "CREATE",
    skill_id: "candidate-skill-new",
    base_version: 0,
    content: CONTENT,
    ...computeArtifactHashes(withoutHashes),
  } as unknown as Parameters<typeof candidateToEvaluationArtifact>[0]);
  const baseline = emptyEvaluationArtifact("candidate-skill-new");
  expect(baseline.content).toBe("");
  expect(baseline.base_version).toBe(0);
  expect(baseline.skill_id).toBe(created.skill_id);
  expect(baseline.artifact_hash).not.toBe(created.artifact_hash);
  // Deterministic: the same empty baseline always hashes identically.
  expect(emptyEvaluationArtifact("candidate-skill-new").artifact_hash).toBe(baseline.artifact_hash);
});
