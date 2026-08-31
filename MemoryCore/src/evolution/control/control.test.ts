import { afterEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { EvolutionService } from "./service.js";
import type { EvolutionRecord, EvolutionProfile } from "./types.js";

const stores: SqliteMetadataStore[] = [];
function setup() {
  const metadata = new SqliteMetadataStore(":memory:");
  metadata.init(); stores.push(metadata);
  return metadata.getEvolutionStore();
}
const record = { team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", title: "冻结候选", status: "FROZEN", origin: "runtime", asset_ids: [], payload: { content: "unchanged" } } as const;
const draft = () => ({ ...record, asset_ids: [] }) as Omit<EvolutionRecord, "id" | "artifact_hash" | "revision" | "created_at" | "updated_at">;
const profile: Omit<EvolutionProfile, "revision" | "updated_at"> = { team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["memory"], asset_ids: [], daily_tokens: 100, daily_model_calls: 3, daily_candidates: 2, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" };
afterEach(() => { stores.splice(0).forEach(store => store.close()); });

describe("evolution durable control", () => {
  it("replays identical receipt but rejects a different payload with the same key", () => {
    const store = setup(); const first = store.append(draft(), "key", "owner");
    expect(store.append(draft(), "key", "owner")).toEqual(first);
    expect(() => store.append({ ...draft(), title: "changed" }, "key", "owner")).toThrow("IDEMPOTENCY_CONFLICT");
    expect(store.list("team")).toHaveLength(1);
  });
  it("state transitions preserve frozen hash and reject stale concurrent writes", () => {
    const store = setup(); const first = store.append(draft(), "key", "owner");
    const updated = store.transition(first.id, 1, ["FROZEN"], "NEEDS_EVIDENCE", "reviewer");
    expect(updated.artifact_hash).toBe(first.artifact_hash);
    expect(updated.payload).toEqual(first.payload);
    expect(() => store.transition(first.id, 1, ["FROZEN"], "REVIEW_APPROVED", "reviewer")).toThrow("STATE_STALE");
    expect(store.events(first.id)).toHaveLength(2);
  });
  it("cannot change historical FAIL into PASS", () => {
    const store = setup(); const historical = store.append({ ...draft(), origin: "historical", status: "FAIL" }, "v4", "owner");
    expect(() => store.transition(historical.id, 1, ["FAIL"], "PASS", "owner")).toThrow("HISTORICAL_RECORD_READ_ONLY");
  });
  it("requires caps, reserves before calls and never refunds unknown usage", () => {
    const store = setup();
    expect(() => store.reserve("a", "team", "agent", 60, 1, 1)).toThrow("AUTOMATION_NOT_ENABLED");
    store.saveProfile(profile, 0);
    store.reserve("a", "team", "agent", 60, 1, 1);
    store.settle("a", null, null);
    expect(() => store.reserve("b", "team", "agent", 50, 1, 1)).toThrow("EVOLUTION_BUDGET_EXHAUSTED");
    expect(() => store.reserve("a", "team", "agent", 60, 1, 1)).toThrow("RESERVATION_ALREADY_USED");
    store.settle("a", 30, 1);
    store.reserve("b", "team", "agent", 50, 1, 1);
    expect(() => store.settle("a", 0, 0)).toThrow("USAGE_ALREADY_SETTLED");
  });
  it("rejects negative reservations and stale profiles", () => {
    const store = setup(); store.saveProfile(profile, 0);
    expect(() => store.reserve("a", "team", "agent", -1, 0, 0)).toThrow("INVALID_RESERVATION");
    expect(() => store.saveProfile(profile, 0)).toThrow("PROFILE_STALE");
  });
  it("isolates records and profiles from formal metadata assets", () => {
    const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
    metadata.getEvolutionStore().append(draft(), "key", "owner");
    expect(metadata.getEvolutionStore().list("other-team")).toEqual([]);
    expect(metadata.listAssetsByTeam("team").items).toEqual([]);
  });
  it("a rejected duplicate review leaves one receipt and does not change the frozen content", () => {
    const store = setup(); const candidate = store.append(draft(), "key", "owner");
    store.review(candidate.id, 1, "NEEDS_EVIDENCE", "missing source", "reviewer");
    expect(() => store.review(candidate.id, 1, "REJECTED", "stale click", "reviewer")).toThrow("STATE_STALE");
    expect(store.list("team", "review")).toHaveLength(1);
    expect(store.get(candidate.id)?.artifact_hash).toBe(candidate.artifact_hash);
  });
});

describe("evolution authorization", () => {
  function service(role = "admin", allowed = false) {
    const store = setup();
    const metadata = { getUserByKey: async (key: string) => key === "valid" ? { user_id: "admin", status: "active" } : null,
      getTeamMember: async (team: string) => team === "team" ? { role, status: "active" } : null,
      getAgentById: async () => ({ team_id: "team", status: "active" }),
      getAssetById: async () => ({ team_id: "team" }),
    };
    return new EvolutionService(store, metadata as never, { checkAssetPermission: async () => ({ allowed, reason: "test" }) });
  }
  it("validates identity and membership on every action", async () => {
    const svc = service();
    await expect(svc.invoke("overview", { team_id: "team" }, "bad")).rejects.toThrow("UNAUTHORIZED");
    await expect(svc.invoke("overview", { team_id: "other" }, "valid")).rejects.toThrow("TEAM_ACCESS_DENIED");
  });
  it("admin cannot read another user's unbound or private evidence", async () => {
    const svc = service();
    const privateRecord = svc.store.append(draft(), "key", "owner");
    svc.store.append({ ...draft(), asset_ids: ["private-asset"] }, "key2", "owner");
    await expect(svc.invoke("records/list", { team_id: "team" }, "valid")).resolves.toEqual({ items: [], total: 0 });
    await expect(svc.invoke("records/get", { team_id: "team", id: privateRecord.id }, "valid")).rejects.toThrow("RECORD_NOT_FOUND");
  });
  it("does not let configuration bypass runtime safety admission", async () => {
    const svc = service();
    await expect(svc.invoke("profiles/save", { ...profile, authorized_by: undefined, revision: 0 }, "valid")).rejects.toThrow();
    const { authorized_by: _, ...input } = profile;
    await expect(svc.invoke("profiles/save", { ...input, revision: 0 }, "valid")).rejects.toThrow("AUTOMATION_ADMISSION_REQUIRED");
    await expect(svc.invoke("profiles/save", { ...input, enabled: false, revision: 0 }, "valid")).resolves.toMatchObject({ enabled: false, authorized_by: "admin" });
  });
});
