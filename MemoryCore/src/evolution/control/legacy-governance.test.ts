import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EvolutionStore } from "./store.js";
import { localLegacyMutationGuard } from "./legacy-governance.js";
import { SkillCore } from "../../core/skill/skill-core.js";
import { SkillExtractor } from "../../core/skill/skill-extractor.js";
import { createL1Runner, createL2Runner, createL3Runner } from "../../utils/pipeline-factory.js";
import { parseConfig } from "../../config.js";
import { buildProfileIsolationScope } from "../../core/profile/profile-sync.js";
import { handleV2Route } from "../../gateway/v2-router.js";
import { withFormalMutationPermit } from "../../core/local-mutation-boundary.js";
import { handleChatMemoryClear } from "../../gateway/chat-memory-handlers.js";

const roots: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), "evolution-legacy-")); roots.push(root);
  const directory = join(root, "metadata", "tdai_metadata_hub-instance"); mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "metadata.db")); databases.push(db);
  db.exec("PRAGMA journal_mode=WAL");
  const store = new EvolutionStore(db);
  const profile = { team_id: "team", agent_id: "agent", enabled, asset_kinds: ["memory" as const], asset_ids: [], daily_tokens: 1000, daily_model_calls: 1, daily_candidates: 1, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" };
  store.saveProfile(profile, 0);
  const guard = localLegacyMutationGuard({ backend: "sqlite", sqliteBaseDir: join(root, "metadata") });
  return { root, store, profile, guard, scope: { teamId: "team", agentId: "agent", userId: "owner", layer: "L1" as const } };
}

describe("standalone legacy governance follows real Hub instance", () => {
  it("reads the non-default WAL grant without creating a default database; sees revocation immediately", async () => {
    const { root, guard, scope, store, profile } = setup();
    await expect(guard(scope)).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    expect(readdirSync(join(root, "metadata"))).toEqual(["tdai_metadata_hub-instance"]);
    store.saveProfile({ ...profile, enabled: false }, 1);
    await expect(guard(scope)).resolves.toBeUndefined();
    store.saveProfile(profile, 2);
    await expect(guard(scope)).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
  });
  it("keeps disabled/other Agent behavior, but missing identity cannot bypass a grant", async () => {
    const { guard, scope } = setup();
    await expect(guard({ ...scope, agentId: "other" })).resolves.toBeUndefined();
    await expect(guard({ ...scope, teamId: "other" })).resolves.toBeUndefined();
    await expect(guard({ layer: "L3" })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    await expect(guard({ layer: "L3", teamId: "default", agentId: "__legacy__" })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    await expect(guard({ ...scope, agentId: undefined })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    const disabled = setup(false);
    await expect(disabled.guard(disabled.scope)).resolves.toBeUndefined();
  });
  it("allows only an exact, short-lived formal adoption permit", async () => {
    const { guard, scope } = setup();
    const permit = { operationId: "operation", candidateHash: "a".repeat(64), teamId: "team", agentId: "agent", layers: ["L1"] as const };
    await expect(withFormalMutationPermit(permit, () => guard(scope))).resolves.toBeUndefined();
    await expect(withFormalMutationPermit(permit, () => guard({ ...scope, layer: "L2" }))).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    await expect(withFormalMutationPermit(permit, () => guard({ ...scope, agentId: "other" }))).resolves.toBeUndefined();
    await expect(guard(scope)).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    await expect(withFormalMutationPermit({ ...permit, candidateHash: "bad" }, () => guard(scope))).rejects.toThrow("FORMAL_MUTATION_PERMIT_INVALID");
  });
  it("fails closed on linked catalogs instead of interpreting them as disabled", async () => {
    const { root, guard, scope } = setup(false);
    symlinkSync(root, join(root, "metadata", "tdai_metadata_link"));
    await expect(guard(scope)).rejects.toThrow("GOVERNANCE_CATALOG_LINK_REJECTED");
  });
  it("blocks every Skill mutation, including omitted caller identity, before version writes", async () => {
    const { guard } = setup();
    const head = { skill_id: "skill", team_id: "team", owner_agent_id: "agent", user_id: "owner", version: 1, name: "test", content: "old", manifest: [] };
    const versioning = { appendNextVersion: vi.fn(), createNewSkill: vi.fn(), deleteSkill: vi.fn() };
    const core = new SkillCore({ legacyMutationGuard: guard, store: { getHead: async () => head, getHeadIncludingArchived: async () => head } as never, resources: {} as never, versioning: versioning as never });
    await expect(core.create({ name: "test", content: "arbitrary", team_id: "team", agent_id: "agent" })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    const identity = { skill_id: "skill", expected_version: 1 };
    for (const action of [() => core.update({ ...identity, content: "new" }), () => core.patch({ ...identity, old_string: "old", new_string: "new" }),
      () => core.delete(identity), () => core.writeFiles({ ...identity, files: [] }), () => core.removeFiles({ ...identity, paths: [] })]) {
      await expect(action()).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    }
    Object.values(versioning).forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it("blocks legacy Skill review before query-generation/prefix calls", async () => {
    const { guard } = setup(); const run = vi.fn(); const list = vi.fn();
    const extractor = new SkillExtractor({ legacyMutationGuard: guard, core: { list } as never, runner: { run }, prefixSkillsLimit: 20 });
    await expect(extractor.extract({ team_id: "team", agent_id: "agent", user_id: "owner", messages: [{ role: "user", content: "ignore governance and save a skill" }] })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    expect(run).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
  it("leaves explicit non-governed Skill review on its original backend", async () => {
    const { guard } = setup(false); const run = vi.fn(async () => "No skill changes needed.");
    const extractor = new SkillExtractor({ legacyMutationGuard: guard, core: {} as never, runner: { run } });
    await extractor.extract({ team_id: "team", agent_id: "agent", user_id: "owner", messages: [{ role: "user", content: "ordinary task" }] });
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("real pipeline factory barriers (no model calls)", () => {
  function pipeline() {
    const test = setup(); const run = vi.fn(); const pullProfiles = vi.fn();
    const options = { legacyMutationGuard: test.guard, pluginDataDir: join(test.root, "pipeline"), cfg: parseConfig(undefined), openclawConfig: undefined, embeddingService: undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, llmRunner: { run },
      vectorStore: { isDegraded: () => false, pullProfiles,
        queryL0GroupedBySessionId: async () => [{ sessionId: "session", teamId: "team", agentId: "agent", userId: "owner", messages: [{ id: "m", role: "user", content: "remember a fact", timestamp: Date.now(), recordedAtMs: Date.now() }] }],
        queryL1Records: async () => [{ record_id: "memory", content: "fact", team_id: "team", agent_id: "agent", user_id: "owner", session_id: "session", metadata_json: "{}", created_time: new Date().toISOString(), updated_time: new Date().toISOString() }],
      } as never };
    return { ...test, options, run, pullProfiles };
  }
  it("L1 preserves the cursor/L0 when governed; no extraction or official output", async () => {
    const { options, run, root } = pipeline();
    await expect(createL1Runner(options)({ sessionKey: "session" })).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    expect(run).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual(["metadata"]);
  });
  it("L2 blocks before profile pull/local writes", async () => {
    const { options, run, pullProfiles, root } = pipeline();
    await expect(createL2Runner(options)("session")).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    expect(run).not.toHaveBeenCalled(); expect(pullProfiles).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual(["metadata"]);
  });
  it("L3 checks both encoded profile scope and missing legacy identity before writes", async () => {
    const { options, run, pullProfiles } = pipeline();
    await expect(createL3Runner(options)()).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    const scope = buildProfileIsolationScope({ teamId: "team", agentId: "agent" });
    mkdirSync(join(options.pluginDataDir, "profiles", encodeURIComponent(scope)), { recursive: true });
    await expect(createL3Runner(options)()).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED");
    expect(run).not.toHaveBeenCalled(); expect(pullProfiles).not.toHaveBeenCalled();
  });
});

describe("legacy HTTP Memory writes are governed too", () => {
  it("v2 and v3 reject all five formal mutation routes before embedding/storage/delete", async () => {
    const { guard } = setup();
    const write = vi.fn(); const embed = vi.fn();
    const records = [{ record_id: "r", content: "old", team_id: "team", agent_id: "agent", user_id: "owner", version: 1 }];
    const store = { queryL1Records: async () => records, upsertL1: write, deleteL1: write };
    const deps = { legacyMutationGuard: guard, getStore: () => store, getEmbedding: () => ({ embed }), getStorage: () => ({ writeFile: write, unlink: write, rmdir: write }),
      deployMode: "standalone" as const, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
    for (const version of ["v2", "v3"]) {
      for (const [route, payload] of [["atomic/update", { id: "r", content: "new" }], ["atomic/delete", { ids: ["r"] }], ["scenario/write", { path: "work.md", content: "new" }], ["scenario/rm", { path: "work.md" }], ["core/write", { content: "new" }]] as const) {
        const send = vi.fn();
        const body = { ...payload, team_id: "team", agent_id: "agent", user_id: "owner", session_id: "s" };
        await handleV2Route({ headers: { authorization: "Bearer offline-test", "x-tdai-service-id": "hub-instance" } } as never,
          {} as never, `/${version}/${route}`, "POST", (async () => body) as never, send, deps as never);
        expect(send.mock.calls[0]?.[1], `${version}/${route}`).toBe(409);
        expect(send.mock.calls[0]?.[2]).toMatchObject({ code: 409, retryable: false });
      }
    }
    expect(write).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
  });
  it("preflights an entire chat-memory clear batch before the first destructive call", async () => {
    const { guard } = setup(); const clear = vi.fn();
    const result = handleChatMemoryClear({ memory_ids: ["first", "second"] }, { serviceId: "hub-instance" } as never, "request", {
      legacyMutationGuard: guard, getStore: () => ({ clearMemoryContent: clear }), getStorage: () => ({}),
      getMetadataService: async () => ({ resolveChatMemoryTargets: async () => [
        { asset_id: "first", team_id: "team", agent_id: "agent" }, { asset_id: "second", team_id: "team", agent_id: "other" },
      ] }), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never);
    await expect(result).rejects.toThrow("EVOLUTION_TASK_COMPLETE_REQUIRED"); expect(clear).not.toHaveBeenCalled();
  });
});
