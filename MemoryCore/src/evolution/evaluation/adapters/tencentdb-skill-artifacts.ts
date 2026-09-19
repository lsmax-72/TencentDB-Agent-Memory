import type { CandidateArtifact } from "../../../core/skill/candidate-types.js";
import type { Skill } from "../../../core/skill/types.js";
import { computeArtifactHashes } from "../contracts/hash.js";
import type { EvaluationSkillArtifact } from "../contracts/types.js";

export const EVALUATION_SKILL_INJECTION_REVISION = "evaluation-skill-override-v1";

export interface OfficialSkillReader {
  get(input: OfficialSkillGetInput): Promise<Skill>;
}

export interface OfficialSkillGetInput {
  user_id?: string;
  team_id?: string;
  agent_id?: string;
  task_id?: string;
  skill_id: string;
  version: number;
}

export async function loadOfficialEvaluationArtifact(
  reader: OfficialSkillReader,
  input: OfficialSkillGetInput,
): Promise<EvaluationSkillArtifact> {
  const skill = await reader.get(input);
  if (skill.skill_id !== input.skill_id || skill.version !== input.version) {
    throw new Error("BASELINE_ARTIFACT_MISMATCH");
  }
  return makeArtifact({
    artifact_id: `official:${skill.skill_id}@${skill.version}`,
    source: "OFFICIAL",
    source_ref: `${skill.skill_id}@v${skill.version}`,
    skill_id: skill.skill_id,
    base_version: skill.version,
    content: skill.content,
  });
}

/**
 * The baseline for a brand-new skill.
 *
 * A CREATE candidate has no earlier version to compare against, so the only
 * honest baseline is "the same agent with no skill at all". Making it explicit
 * is what lets a new skill be effect-evaluated at all: `CREATE` is what the
 * proposal model emits whenever the diagnosis reads as "there is no SOP for
 * this", and rejecting those candidates meant the loop could generate a new
 * skill but never produce the adoption proof it needs.
 */
export function emptyEvaluationArtifact(skillId: string): EvaluationSkillArtifact {
  return makeArtifact({
    artifact_id: `empty:${skillId}`,
    source: "OFFICIAL",
    source_ref: `${skillId}@v0`,
    skill_id: skillId,
    base_version: 0,
    content: "",
  });
}

export function candidateToEvaluationArtifact(
  candidate: CandidateArtifact,
): EvaluationSkillArtifact {
  if (!["CREATE", "UPDATE"].includes(candidate.operation) || candidate.base_version < 0) {
    throw new Error(`UNSUPPORTED_CANDIDATE_OPERATION:${candidate.operation}`);
  }
  if (computeArtifactHashes({
    artifact_id: candidate.candidate_id,
    source: "CANDIDATE",
    source_ref: candidate.candidate_id,
    skill_id: candidate.skill_id,
    base_version: candidate.base_version,
    format: "SKILL_MD_V1",
    content: candidate.content,
    injection_contract_revision: EVALUATION_SKILL_INJECTION_REVISION,
    read_only: true,
  }).content_hash !== candidate.content_hash) {
    throw new Error("CANDIDATE_ARTIFACT_MISMATCH");
  }
  return makeArtifact({
    artifact_id: candidate.candidate_id,
    source: "CANDIDATE",
    source_ref: candidate.candidate_id,
    skill_id: candidate.skill_id,
    base_version: candidate.base_version,
    content: candidate.content,
  });
}

function makeArtifact(input: {
  artifact_id: string;
  source: EvaluationSkillArtifact["source"];
  source_ref: string;
  skill_id: string;
  base_version: number;
  content: string;
}): EvaluationSkillArtifact {
  const withoutHashes = {
    ...input,
    format: "SKILL_MD_V1" as const,
    injection_contract_revision: EVALUATION_SKILL_INJECTION_REVISION,
    read_only: true as const,
  };
  return { ...withoutHashes, ...computeArtifactHashes(withoutHashes) };
}
