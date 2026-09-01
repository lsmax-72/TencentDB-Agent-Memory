import type { IMetadataStore } from "../../metadata/store/interface.js";
import type { AssetEntity } from "../../metadata/types.js";
import type { MetadataService } from "../../metadata/service/metadata-service.js";
import type { SkillCore } from "../../core/skill/skill-core.js";
import type { ReviewBinding } from "./model-bindings.js";
import { EvolutionError, type EvolutionProfile, type EvolutionRecord } from "./types.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { generateSkillProposals } from "./proposals.js";
import { buildHigherMemoryPayload, buildL1Payloads } from "./memory-proposals.js";
import { StoragePaths } from "../../core/storage/types.js";
import type { SnapshotMemory } from "./memory-snapshot.js";
import { memorySnapshotHash } from "./memory-snapshot.js";
import { freezeCandidates } from "./proposals.js";
import type { FrozenWikiProposal } from "./wiki-proposal-bridge.js";

export interface GenerationDependencies {
  store: EvolutionStore;
  metadata: IMetadataStore;
  permissions: Pick<MetadataService, "checkAssetPermission" | "resolveChatMemoryTargets">;
  getSkillCore: () => SkillCore | undefined;
  authorize: (source: EvolutionRecord, profile: EvolutionProfile) => Promise<boolean>;
  snapshotMemory?: SnapshotMemory;
  generateWiki?: (input: { store: EvolutionStore; source: EvolutionRecord; job: EvolutionRecord; profile: EvolutionProfile; binding: ReviewBinding;
    target: AssetEntity; authorize: () => Promise<boolean> }) => Promise<FrozenWikiProposal>;
}

/** Local host integration: no formal writer is given to a reviewer or to a generation job. */
export async function generateStandaloneProposals(deps: GenerationDependencies, source: EvolutionRecord, job: EvolutionRecord, profile: EvolutionProfile, binding: ReviewBinding): Promise<EvolutionRecord[]> {
  const { store, metadata, permissions } = deps;
  if (source.kind !== "diagnosis" || source.origin !== "runtime" || job.payload.source_hash !== source.artifact_hash) throw new EvolutionError(409, "LIVE_DIAGNOSIS_REQUIRED");
  const kind = job.payload.stage === "skill" ? "skill" : job.payload.stage === "memory_l1" ? "memory" : job.payload.stage === "wiki" ? "wiki" : null;
  if (!kind || !profile.asset_kinds.includes(kind)) throw new EvolutionError(403, "GENERATION_ASSET_SCOPE_DENIED");
  const createRunner = binding.createProposalRunner;
  if (kind !== "wiki" && !createRunner) throw new EvolutionError(503, "PROPOSAL_RUNNER_UNAVAILABLE");
  const trace = source.parent_id ? store.get(source.parent_id) : null;
  if (!trace || trace.kind !== "trace" || trace.origin !== "runtime" || trace.team_id !== source.team_id || trace.agent_id !== source.agent_id || trace.owner_user_id !== source.owner_user_id) throw new EvolutionError(409, "DIAGNOSIS_TRACE_MISSING");
  const targetType = kind === "memory" ? "chat_memory" : kind === "wiki" ? "llm_wiki" : "skill";
  const targets: AssetEntity[] = [];
  for (const id of profile.asset_ids) {
    const asset = await metadata.getAssetById(id);
    if (asset?.asset_type === targetType) targets.push(asset);
  }
  async function authorize(): Promise<boolean> {
    if (contentHash(store.profile(source.team_id, source.agent_id)) !== contentHash(profile)
      || !await deps.authorize(source, profile) || !await deps.authorize(trace!, profile)) return false;
    for (const target of targets) {
      const asset = await metadata.getAssetById(target.asset_id);
      // Standalone legacy rows use "active"; the metadata status union also has "approved".
      if (!asset || asset.team_id !== source.team_id || !["active", "approved"].includes(String(asset.status)) || asset.asset_type !== targetType
        || contentHash(asset) !== contentHash(target)) return false;
      for (const user_id of new Set([source.owner_user_id, profile.authorized_by])) {
        if (!(await permissions.checkAssetPermission({ user_id, asset_id: asset.asset_id, action: "read" })).allowed
          || !(await permissions.checkAssetPermission({ user_id, asset_id: asset.asset_id, action: "write" })).allowed) return false;
      }
    }
    return true;
  }
  if (!await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
  // Source ACL is never broadened by the target list; all target reads are independently checked.
  if (kind === "wiki") {
    if (targets.length !== 1) throw new EvolutionError(409, "ONE_EXPLICIT_WIKI_TARGET_REQUIRED");
    if (!deps.generateWiki) throw new EvolutionError(501, "WIKI_SOURCE_BRIDGE_REQUIRED");
    const allocationId = store.allocateCandidateSlots(job.id, 1);
    const proposal = await deps.generateWiki({ store, source, job, profile, binding, target: targets[0], authorize });
    const before = JSON.stringify(proposal.base), after = JSON.stringify(proposal.files);
    return freezeCandidates(store, source, [{ asset_kind: "wiki", target_id: targets[0].asset_id, operation: "update",
      base_hash: contentHash(before), base_version: null, before, after, source_record_ids: [source.id], wiki_proposal: proposal,
    }], allocationId);
  }
  if (kind === "memory") {
    if (targets.length !== 1) throw new EvolutionError(409, "ONE_EXPLICIT_MEMORY_TARGET_REQUIRED");
    const [target] = await permissions.resolveChatMemoryTargets([targets[0].asset_id]);
    if (target.team_id !== source.team_id || target.agent_id !== source.agent_id) throw new EvolutionError(403, "MEMORY_TARGET_AGENT_MISMATCH");
    if (!deps.snapshotMemory) throw new EvolutionError(503, "MEMORY_SNAPSHOT_UNAVAILABLE");
    const scope = { team_id: source.team_id, agent_id: source.agent_id, user_id: source.owner_user_id };
    const snapshot = await deps.snapshotMemory(scope);
    if (contentHash(snapshot.scope) !== contentHash(scope) || snapshot.hash !== memorySnapshotHash(snapshot)) throw new EvolutionError(409, "MEMORY_SNAPSHOT_INVALID");
    const snapshotRecord = store.append({ team_id: source.team_id, agent_id: source.agent_id, owner_user_id: source.owner_user_id,
      kind: "trace", origin: "runtime", status: "SNAPSHOT", title: `Memory 来源快照：${source.title}`, asset_ids: job.asset_ids, parent_id: source.id,
      payload: { evidence_type: "memory_snapshot", target_id: target.asset_id, snapshot_hash: snapshot.hash, snapshot },
    }, `${job.id}/memory-snapshot`, source.owner_user_id);
    const authorizeSnapshot = async () => await authorize() && (await deps.snapshotMemory!(scope)).hash === snapshot.hash;
    const frozenSnapshot = new Map(snapshot.files.map(file => [file.key, Buffer.from(file.content)]));
    const runL2 = snapshot.records.length > 0;
    const runL3 = snapshot.files.some(file => file.key === StoragePaths.sceneIndex || file.key.startsWith(StoragePaths.sceneBlocksDir));
    const higherLayerCount = Number(runL2) + Number(runL3);
    // Reserve the maximum output batch before any model call. One job freezes L1/L2/L3 together or none.
    const allocationId = store.allocateCandidateSlots(job.id, 10 + higherLayerCount);
    const allocation = store.assertCandidateAllocation(allocationId, source.team_id, source.agent_id, source.owner_user_id);
    if (allocation <= higherLayerCount) {
      freezeCandidates(store, source, [], allocationId);
      throw new EvolutionError(429, "EVOLUTION_CANDIDATE_BUDGET_EXHAUSTED");
    }
    const runner = createRunner!({ store, source, jobId: job.id, allocationId, authorize: authorizeSnapshot });
    // Only task input is offered as an L1 fact source; an assistant answer is not factual proof.
    const proposalInput = { store, source, allocationId, targetId: target.asset_id, snapshotRecord, snapshot: frozenSnapshot, runner };
    const payloads = await buildL1Payloads(proposalInput, [{
      id: `${trace.id}:input`, role: "user", content: String(trace.payload.task_input ?? ""), timestamp: Date.parse(trace.created_at),
    }], allocation - higherLayerCount);
    if (runL2) {
      const l2 = await buildHigherMemoryPayload(proposalInput, "L2", snapshot.records.map(record => ({
        id: record.record_id, content: record.content, created_at: record.created_time,
      })));
      if (l2) payloads.push(l2);
    }
    if (runL3) {
      const l3 = await buildHigherMemoryPayload(proposalInput, "L3");
      if (l3) payloads.push(l3);
    }
    return freezeCandidates(store, source, payloads, allocationId);
  }
  if (source.payload.route !== "skill_defect") throw new EvolutionError(409, "SKILL_DEFECT_EVIDENCE_REQUIRED");
  const core = deps.getSkillCore();
  if (!core) throw new EvolutionError(503, "SKILL_MODULE_UNAVAILABLE");
  const allowed = new Set(targets.map(target => target.asset_id));
  const ids = { team_id: source.team_id, agent_id: source.agent_id, user_id: source.owner_user_id };
  const scoped = new Proxy(core, { get(_target, name) {
    if (name === "list") return async () => {
      if (!await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
      const page = await core.list({ ...ids, pagination: { limit: 1000, offset: 0 } });
      const items = page.items.filter(skill => allowed.has(skill.skill_id));
      return { items, total: items.length };
    };
    if (name === "search") return async (input: Parameters<SkillCore["search"]>[0]) => {
      if (!await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
      return (await core.search({ ...input, ...ids })).filter(hit => allowed.has(hit.skill.skill_id));
    };
    if (name === "get") return async (input: Parameters<SkillCore["get"]>[0]) => {
      if (!allowed.has(input.skill_id) || !await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
      return core.get({ ...input, ...ids });
    };
    throw new EvolutionError(403, "FORMAL_SKILL_METHOD_NOT_AVAILABLE_TO_REVIEWER");
  } });
  const allocationId = store.allocateCandidateSlots(job.id);
  const runner = createRunner!({ store, source, jobId: job.id, allocationId, authorize });
  return generateSkillProposals({ core: scoped, runner, prefixSkillsLimit: 0 }, {
    ...ids, task_id: String(trace.payload.task_id), session_id: String(trace.payload.session_id),
    messages: [{ role: "user", content: JSON.stringify({ diagnosis: source.payload, task_input: trace.payload.task_input, tool_events: trace.payload.tool_events, final_output: trace.payload.final_output }) }],
  }, source, store, allocationId);
}
