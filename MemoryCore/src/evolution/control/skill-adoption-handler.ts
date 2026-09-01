import { createHash } from "node:crypto";
import { z } from "zod";
import type { SkillCore } from "../../core/skill/skill-core.js";
import { parseSkillFile, validateSkillFile } from "../../core/skill/skill-format.js";
import type { CandidateArtifact } from "../../core/skill/candidate-types.js";
import type { FrozenAssetHandler } from "./governed-writer.js";
import { contentHash } from "./store.js";
import { EvolutionError, type CandidatePayload, type EvolutionRecord } from "./types.js";

const artifactSchema = z.object({
  candidate_id: z.string().min(1), operation: z.enum(["CREATE", "UPDATE"]), skill_id: z.string().min(1), base_version: z.number().int().nonnegative(),
  content: z.string().min(1), content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), artifact_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  source: z.object({ user_id: z.string().optional(), team_id: z.string().optional(), agent_id: z.string().optional(), task_id: z.string().optional() }), created_at: z.string(),
}).strict();
function sha(value: string): `sha256:${string}` { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function marker(operation: EvolutionRecord, candidate: EvolutionRecord) {
  return { operation_id: operation.id, candidate_id: candidate.id, candidate_hash: candidate.artifact_hash };
}
function metadata(raw: string): Record<string, unknown> { try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }

/** Skill publication is allowed only after the common writer resolves a real paired-effect receipt. */
export class SkillFrozenAssetHandler implements FrozenAssetHandler {
  constructor(private readonly core: SkillCore) {}
  layers() { return ["skill"] as const; }
  private artifact(candidate: EvolutionRecord, payload: CandidatePayload): CandidateArtifact {
    const parsed = artifactSchema.parse(payload.skill_artifact) as CandidateArtifact;
    const expectedArtifactHash = sha(JSON.stringify({ skill_id: parsed.skill_id, base_version: parsed.base_version, content_hash: parsed.content_hash, format: "SKILL_MD_V1" }));
    if (parsed.content !== payload.after || parsed.skill_id !== payload.target_id || parsed.content_hash !== sha(payload.after)
      || parsed.artifact_hash !== expectedArtifactHash || parsed.base_version !== (payload.base_version ?? 0)
      || parsed.operation !== payload.operation.toUpperCase()) throw new EvolutionError(409, "SKILL_ARTIFACT_MISMATCH");
    const file = parseSkillFile(payload.after); validateSkillFile(file);
    return parsed;
  }
  async snapshot(candidate: EvolutionRecord, payload: CandidatePayload) {
    const artifact = this.artifact(candidate, payload);
    if (payload.operation === "create") {
      const file = parseSkillFile(payload.after);
      const existing = await this.core.list({ team_id: candidate.team_id, agent_id: candidate.agent_id, filters: { name_prefix: file.frontmatter.name }, pagination: { limit: 100, offset: 0 } });
      if (existing.items.some(item => item.name === file.frontmatter.name)) throw new EvolutionError(409, "SKILL_NAME_ALREADY_EXISTS");
      return { base_hash: contentHash(""), base_version: payload.base_version, details: { candidate_artifact_hash: artifact.artifact_hash } };
    }
    const head = await this.core.get({ skill_id: payload.target_id, team_id: candidate.team_id, user_id: candidate.owner_user_id, agent_id: candidate.agent_id, include_content: true });
    return { base_hash: contentHash(head.content), base_version: head.version, details: { current_skill_hash: head.content_hash, candidate_artifact_hash: artifact.artifact_hash } };
  }
  async write(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void> {
    this.artifact(candidate, payload); const audit = marker(operation, candidate);
    if (payload.operation === "create") {
      const file = parseSkillFile(payload.after);
      await this.core.create({ name: file.frontmatter.name, content: payload.after, team_id: candidate.team_id, agent_id: candidate.agent_id,
        user_id: candidate.owner_user_id, task_id: operation.id, metadata: { evolution_adoption: audit } });
      return;
    }
    const head = await this.core.get({ skill_id: payload.target_id, team_id: candidate.team_id, user_id: candidate.owner_user_id, agent_id: candidate.agent_id, include_content: true });
    await this.core.update({ skill_id: payload.target_id, expected_version: payload.base_version!, content: payload.after, team_id: candidate.team_id,
      agent_id: candidate.agent_id, user_id: candidate.owner_user_id, task_id: operation.id,
      metadata: { ...metadata(head.metadata_json), evolution_adoption: audit } });
  }
  async verify(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<boolean> {
    this.artifact(candidate, payload); const expected = marker(operation, candidate);
    const matches = payload.operation === "create"
      ? (await this.core.list({ team_id: candidate.team_id, agent_id: candidate.agent_id, pagination: { limit: 100, offset: 0 } })).items
      : [await this.core.get({ skill_id: payload.target_id, team_id: candidate.team_id, user_id: candidate.owner_user_id, agent_id: candidate.agent_id, include_content: true })];
    return matches.some(skill => skill.content === payload.after && skill.version === (payload.operation === "create" ? 1 : payload.base_version! + 1)
      && contentHash(skill.content) === contentHash(payload.after) && JSON.stringify(metadata(skill.metadata_json).evolution_adoption) === JSON.stringify(expected));
  }
}
