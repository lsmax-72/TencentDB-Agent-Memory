import { afterEach, describe, expect, it } from "vitest";
import { MetadataService } from "../../metadata/service/metadata-service.js";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import type { FixedAssetBindingInput } from "../../metadata/types.js";
import { EvolutionService } from "./service.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

async function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "owner", default_key_value: "key" });
  metadata.createTeam({ team_id: "team", name: "team", owner_user_id: "owner" }); metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "agent" });
  const assets = [{ asset_id: "skill", asset_type: "skill" }, { asset_id: "memory", asset_type: "chat_memory" },
    { asset_id: "wiki", asset_type: "llm_wiki" }, { asset_id: "graph", asset_type: "code_graph" }] as const;
  for (const asset of assets) metadata.createAsset({ ...asset, team_id: "team", name: asset.asset_id, owner_user_id: "owner", source_type: "test", visibility: "private", status: "approved" });
  metadata.setAgentFixedAssets("agent", assets.map(asset => ({ asset_id: asset.asset_id, asset_type: asset.asset_type, created_by: "owner" } as FixedAssetBindingInput)));
  const service = new EvolutionService(metadata.getEvolutionStore(), metadata, new MetadataService(metadata, "instance"), true, undefined,
    { supports: () => true } as never, { reviewBindingIds: () => ["review"], evaluationBindingIds: () => ["eval"] });
  return { metadata, service };
}

describe("native Hub profile options and activation", () => {
  it("shows only writable Agent assets and enables the exact governed scope", async () => {
    const { service } = await setup();
    const options = await service.invoke("profiles/options", { team_id: "team", agent_id: "agent" }, "key") as { assets: Array<{ id: string; asset_kind: string }> };
    expect(options.assets.map(asset => asset.id).sort()).toEqual(["memory", "skill", "wiki"]); expect(options.assets.some(asset => asset.asset_kind === "code_graph")).toBe(false);
    const profile = await service.invoke("profiles/save", { team_id: "team", agent_id: "agent", enabled: true, revision: 0,
      asset_kinds: ["memory", "wiki"], asset_ids: ["memory", "wiki"], daily_tokens: 1000, daily_model_calls: 10, daily_candidates: 2,
      evaluation_profile_id: null, review_model_id: "review", auto_memory: true, auto_wiki_maintenance: true }, "key");
    expect(profile).toMatchObject({ enabled: true, asset_kinds: ["memory", "wiki"], authorized_by: "owner" });
  });

  it("requires an assigned target and frozen evaluator for Skill governance", async () => {
    const { metadata, service } = await setup();
    await expect(service.invoke("profiles/save", { team_id: "team", agent_id: "agent", enabled: true, revision: 0,
      asset_kinds: ["skill"], asset_ids: ["skill"], daily_tokens: 1000, daily_model_calls: 10, daily_candidates: 2,
      evaluation_profile_id: null, review_model_id: "review", auto_memory: false, auto_wiki_maintenance: false }, "key")).rejects.toThrow("SKILL_EVALUATION_PROFILE_REQUIRED");
    metadata.setAgentFixedAssets("agent", []);
    await expect(service.invoke("profiles/save", { team_id: "team", agent_id: "agent", enabled: false, revision: 0,
      asset_kinds: ["memory"], asset_ids: ["memory"], daily_tokens: 1000, daily_model_calls: 10, daily_candidates: 2,
      evaluation_profile_id: null, review_model_id: null, auto_memory: false, auto_wiki_maintenance: false }, "key")).rejects.toThrow("TARGET_WRITE_DENIED");
  });
});
