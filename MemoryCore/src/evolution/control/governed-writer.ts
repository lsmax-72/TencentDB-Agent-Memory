import { z } from "zod";
import type { IMetadataStore } from "../../metadata/store/interface.js";
import type { MetadataService } from "../../metadata/service/metadata-service.js";
import { withFormalMutationPermit, withLocalMutationBoundary } from "../../core/local-mutation-boundary.js";
import type { FrozenAssetWriter } from "./adoption.js";
import { adoptionProof, expectedMetadataAssetType } from "./adoption-proof.js";
import type { EvolutionStore } from "./store.js";
import { EvolutionError, type AssetKind, type CandidatePayload, type EvolutionRecord } from "./types.js";

const payloadSchema = z.object({
  asset_kind: z.enum(["skill", "memory", "wiki"]), target_id: z.string().min(1), base_hash: z.string().length(64),
  base_version: z.number().int().nonnegative().nullable(), before: z.string(), after: z.string().min(1),
  source_record_ids: z.array(z.string().min(1)).min(1), operation: z.enum(["create", "update"]),
  layer: z.enum(["L1", "L2", "L3"]).optional(),
}).passthrough();

export interface FrozenHandlerSnapshot { base_hash: string; base_version: number | null; details?: Record<string, unknown> }
export interface FrozenAssetHandler {
  layers(payload: CandidatePayload): ReadonlyArray<"skill" | "L1" | "L2" | "L3" | "wiki">;
  snapshot(candidate: EvolutionRecord, payload: CandidatePayload): Promise<FrozenHandlerSnapshot>;
  write(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void>;
  verify(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<boolean>;
}

export interface GovernedWriterDependencies {
  store: EvolutionStore;
  metadata: IMetadataStore;
  permissions: Pick<MetadataService, "checkAssetPermission">;
  canRead: (record: EvolutionRecord, userId: string) => Promise<boolean>;
  handlers: Partial<Record<AssetKind, FrozenAssetHandler>>;
}

/** Server-owned writer. Reviewer models, evaluation workers and browser requests never receive these handlers. */
export class GovernedFrozenAssetWriter implements FrozenAssetWriter {
  constructor(private readonly deps: GovernedWriterDependencies) {}

  supports(kind: AssetKind): boolean { return !!this.deps.handlers[kind]; }

  withTargetLock<T>(_candidate: EvolutionRecord, run: () => Promise<T>): Promise<T> {
    return withLocalMutationBoundary(run);
  }

  private payload(candidate: EvolutionRecord): CandidatePayload {
    const parsed = payloadSchema.safeParse(candidate.payload);
    if (!parsed.success) throw new EvolutionError(409, "CANDIDATE_SCHEMA_INVALID");
    return parsed.data as CandidatePayload;
  }

  private handler(kind: AssetKind): FrozenAssetHandler {
    const handler = this.deps.handlers[kind];
    if (!handler) throw new EvolutionError(503, `${kind.toUpperCase()}_ADOPTION_UNAVAILABLE`);
    return handler;
  }

  async authorizeAndPrepare(candidate: EvolutionRecord, actorId: string): Promise<Record<string, unknown>> {
    const payload = this.payload(candidate), profile = this.deps.store.profile(candidate.team_id, candidate.agent_id);
    const [actor, member, team, agent, grantor, grantMember, target] = await Promise.all([
      this.deps.metadata.getUserById(actorId), this.deps.metadata.getTeamMember(candidate.team_id, actorId),
      this.deps.metadata.getTeamById(candidate.team_id), this.deps.metadata.getAgentById(candidate.agent_id),
      profile ? this.deps.metadata.getUserById(profile.authorized_by) : null,
      profile ? this.deps.metadata.getTeamMember(candidate.team_id, profile.authorized_by) : null,
      this.deps.metadata.getAssetById(payload.target_id),
    ]);
    if (actor?.status !== "active" || member?.status !== "active" || member.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
    if (team?.status !== "active" || agent?.status !== "active" || agent.team_id !== candidate.team_id) throw new EvolutionError(409, "TARGET_SCOPE_INACTIVE");
    if (!profile?.enabled || !profile.asset_kinds.includes(payload.asset_kind) || !profile.asset_ids.includes(payload.target_id)) throw new EvolutionError(409, "GOVERNANCE_GRANT_REQUIRED");
    if (grantor?.status !== "active" || grantMember?.status !== "active" || grantMember.role !== "admin") throw new EvolutionError(409, "GOVERNANCE_GRANT_STALE");
    if (!target || target.team_id !== candidate.team_id || target.asset_type !== expectedMetadataAssetType(payload.asset_kind)
      || !candidate.asset_ids.includes(target.asset_id)) throw new EvolutionError(409, "TARGET_ASSET_MISMATCH");
    for (const userId of new Set([actorId, profile.authorized_by])) {
      if (!(await this.deps.permissions.checkAssetPermission({ user_id: userId, asset_id: target.asset_id, action: "write" })).allowed) throw new EvolutionError(403, "TARGET_WRITE_DENIED");
      if (!await this.deps.canRead(candidate, userId)) throw new EvolutionError(403, "CANDIDATE_SOURCE_ACCESS_DENIED");
    }
    const proof = adoptionProof(this.deps.store, candidate);
    if (!proof || !await this.deps.canRead(proof, actorId) || !await this.deps.canRead(proof, profile.authorized_by)) throw new EvolutionError(409, payload.asset_kind === "skill" ? "EFFECT_EVALUATION_REQUIRED" : "CONTENT_VALIDATION_REQUIRED");
    const snapshot = await this.handler(payload.asset_kind).snapshot(candidate, payload);
    if (snapshot.base_hash !== payload.base_hash || snapshot.base_version !== payload.base_version) throw new EvolutionError(409, "TARGET_BASE_STALE");
    return { proof_id: proof.id, proof_hash: proof.artifact_hash, target_asset_id: target.asset_id,
      observed_base_hash: snapshot.base_hash, observed_base_version: snapshot.base_version, ...snapshot.details };
  }

  async writeFrozen(operationId: string, candidate: EvolutionRecord): Promise<void> {
    const operation = this.deps.store.get(operationId), payload = this.payload(candidate);
    if (!operation || operation.kind !== "adoption" || operation.parent_id !== candidate.id
      || operation.payload.candidate_hash !== candidate.artifact_hash || operation.status !== "WRITING") throw new EvolutionError(409, "APPLICATION_INTENT_REQUIRED");
    const layers = this.handler(payload.asset_kind).layers(payload);
    await withFormalMutationPermit({ operationId, candidateHash: candidate.artifact_hash,
      teamId: candidate.team_id, agentId: candidate.agent_id, layers }, () => this.handler(payload.asset_kind).write(operation, candidate, payload));
  }

  async verifyApplied(operationId: string, candidate: EvolutionRecord): Promise<boolean> {
    const operation = this.deps.store.get(operationId), payload = this.payload(candidate);
    if (!operation || operation.kind !== "adoption" || operation.parent_id !== candidate.id
      || operation.payload.candidate_hash !== candidate.artifact_hash || !["WRITING", "RECONCILE_REQUIRED", "APPLIED"].includes(operation.status)) return false;
    return this.handler(payload.asset_kind).verify(operation, candidate, payload);
  }
}
