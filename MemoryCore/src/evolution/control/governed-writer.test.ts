import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { freezeCandidate } from "./proposals.js";
import { contentHash } from "./store.js";
import { GovernedFrozenAssetWriter, type FrozenAssetHandler } from "./governed-writer.js";
import type { MetadataService } from "../../metadata/service/metadata-service.js";
const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

async function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const owner = await metadata.createUser({ auth_provider: "local", external_id: "owner", username: "owner" });
  const team = await metadata.createTeam({ name: "test", owner_user_id: owner.user_id });
  const agent = await metadata.createAgent({ team_id: team.team_id, owner_user_id: owner.user_id, name: "agent" });
  const asset = await metadata.createAsset({ asset_id: `chat_memory-${team.team_id}-${agent.agent_id}`, team_id: team.team_id,
    asset_type: "chat_memory", name: "memory", owner_user_id: owner.user_id, source_type: "manual", visibility: "private" });
  await metadata.addAgentFixedAsset(agent.agent_id, { asset_id: asset.asset_id, asset_type: "chat_memory", created_by: owner.user_id });
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: team.team_id, agent_id: agent.agent_id, enabled: true, asset_kinds: ["memory"], asset_ids: [asset.asset_id],
    daily_tokens: 1, daily_model_calls: 1, daily_candidates: 1, evaluation_profile_id: null, auto_memory: false,
    auto_wiki_maintenance: false, authorized_by: owner.user_id }, 0);
  const trace = store.append({ team_id: team.team_id, owner_user_id: owner.user_id, agent_id: agent.agent_id, kind: "trace", title: "source",
    status: "RECORDED", origin: "runtime", asset_ids: [asset.asset_id], payload: {} }, "source", owner.user_id);
  const job = store.append({ ...trace, kind: "job", status: "RUNNING", payload: { job_type: "proposal" } }, "job", owner.user_id);
  const candidate = freezeCandidate(store, trace, { asset_kind: "memory", layer: "L1", target_id: asset.asset_id, base_hash: contentHash(""),
    base_version: null, before: "", after: "fact", operation: "create", source_record_ids: [trace.id] }, store.allocateCandidateSlots(job.id));
  store.append({ team_id: team.team_id, owner_user_id: owner.user_id, agent_id: agent.agent_id, kind: "attempt", title: "validation", status: "PASS",
    origin: "runtime", asset_ids: [asset.asset_id], parent_id: candidate.id,
    payload: { attempt_type: "content_validation", result: "PASS", demonstrates_improvement: false, candidate_hash: candidate.artifact_hash } }, "proof", owner.user_id);
  const handler: FrozenAssetHandler = { layers: () => ["L1"], snapshot: vi.fn(async () => ({ base_hash: contentHash(""), base_version: null })),
    write: vi.fn(async () => {}), verify: vi.fn(async () => true) };
  const permissions: Pick<MetadataService, "checkAssetPermission"> = { checkAssetPermission: vi.fn(async ({ user_id, asset_id }) => ({ allowed: user_id === owner.user_id && asset_id === asset.asset_id, reason: "test" })) };
  const writer = new GovernedFrozenAssetWriter({ store, metadata, permissions,
    canRead: async (record, userId) => userId === owner.user_id && record.team_id === team.team_id, handlers: { memory: handler } });
  return { metadata, store, owner, candidate, handler, writer };
}

describe("server-owned governed adoption writer", () => {
  it("requires a current grant, exact proof and base before issuing a formal write permit", async () => {
    const { store, owner, candidate, handler, writer } = await setup();
    const evidence = await writer.authorizeAndPrepare(candidate, owner.user_id);
    expect(evidence).toMatchObject({ target_asset_id: candidate.payload.target_id, observed_base_hash: candidate.payload.base_hash });
    store.transition(candidate.id, candidate.revision, ["FROZEN"], "REVIEW_APPROVED", owner.user_id);
    const operation = store.beginApplication(candidate.id, 2, owner.user_id, evidence);
    const writing = store.transition(operation.id, operation.revision, ["PREPARED"], "WRITING", owner.user_id);
    await writer.writeFrozen(writing.id, store.get(candidate.id)!);
    expect(handler.write).toHaveBeenCalledOnce(); expect(await writer.verifyApplied(writing.id, store.get(candidate.id)!)).toBe(true);
  });
  it("rejects stale target bytes and unavailable handlers without writing", async () => {
    const { owner, candidate, handler, writer } = await setup();
    handler.snapshot = vi.fn(async () => ({ base_hash: contentHash("changed"), base_version: null }));
    await expect(writer.authorizeAndPrepare(candidate, owner.user_id)).rejects.toThrow("TARGET_BASE_STALE");
    expect(handler.write).not.toHaveBeenCalled();
  });
});
