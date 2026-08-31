import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { applyFrozenCandidate, reconcileApplication, type FrozenAssetWriter } from "./adoption.js";
import { freezeCandidate } from "./proposals.js";
import { contentHash } from "./store.js";
const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: "test", agent_id: "agent", enabled: true, asset_kinds: ["memory"], asset_ids: [], daily_tokens: 100000, daily_model_calls: 10, daily_candidates: 10, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" }, 0);
  const source = store.append({ team_id: "test", owner_user_id: "owner", agent_id: "agent", kind: "trace", title: "offline test source", status: "RECORDED", origin: "runtime", asset_ids: [], payload: {} }, "source", "owner");
  const job = store.append({ ...source, kind: "job", status: "RUNNING", payload: { job_type: "proposal" } }, "job", "owner");
  const candidate = freezeCandidate(store, source, { asset_kind: "memory", layer: "L1", target_id: "target", base_hash: contentHash(""), base_version: null, before: "", after: "frozen fact", operation: "create", source_record_ids: [source.id] }, store.allocateCandidateSlots(job.id));
  store.transition(candidate.id, 1, ["FROZEN"], "VALIDATED", "validator");
  store.review(candidate.id, 2, "REVIEW_APPROVED", "test approval", "owner");
  let tail: Promise<unknown> = Promise.resolve();
  const writer: FrozenAssetWriter = {
    withTargetLock: (_candidate, run) => { const result = tail.then(run); tail = result.catch(() => {}); return result; },
    authorizeAndPrepare: vi.fn(async () => ({ validated_hash: candidate.artifact_hash })),
    writeFrozen: vi.fn(async () => {}), verifyApplied: vi.fn(async () => true),
  };
  return { store, candidate, writer, metadata };
}
describe("durable adoption coordinator with isolated writer doubles", () => {
  it("double clicks create one intent and write once", async () => {
    const { store, candidate, writer } = setup();
    const results = await Promise.all([applyFrozenCandidate(store, candidate.id, 3, "owner", writer), applyFrozenCandidate(store, candidate.id, 3, "owner", writer)]);
    expect(results[0].id).toBe(results[1].id);
    expect(writer.writeFrozen).toHaveBeenCalledOnce();
    expect(store.get(candidate.id)?.status).toBe("APPLIED");
    expect(store.list("test", "adoption")).toHaveLength(1);
  });
  it("denied or stale authorization writes nothing", async () => {
    const { store, candidate, writer } = setup();
    writer.authorizeAndPrepare = vi.fn(async () => { throw new Error("SOURCE_CHANGED"); });
    await expect(applyFrozenCandidate(store, candidate.id, 3, "owner", writer)).rejects.toThrow("SOURCE_CHANGED");
    expect(writer.writeFrozen).not.toHaveBeenCalled(); expect(store.list("test", "adoption")).toHaveLength(0);
  });
  it("incomplete index never reports applied, reconciliation never writes again", async () => {
    const { store, candidate, writer } = setup(); writer.verifyApplied = vi.fn(async () => false);
    await expect(applyFrozenCandidate(store, candidate.id, 3, "owner", writer)).rejects.toThrow("APPLICATION_READBACK_INCOMPLETE");
    const operation = store.list("test", "adoption")[0];
    expect(operation.status).toBe("RECONCILE_REQUIRED"); expect(store.get(candidate.id)?.status).toBe("APPLYING");
    expect((await reconcileApplication(store, operation.id, "owner", writer)).status).toBe("RECONCILE_REQUIRED");
    writer.verifyApplied = vi.fn(async () => true);
    expect((await reconcileApplication(store, operation.id, "owner", writer)).status).toBe("APPLIED");
    expect(writer.writeFrozen).toHaveBeenCalledOnce();
  });
  it("a thrown write keeps its intent and cannot be blindly replayed", async () => {
    const { store, candidate, writer } = setup(); writer.writeFrozen = vi.fn(async () => { throw new Error("interrupted"); });
    await expect(applyFrozenCandidate(store, candidate.id, 3, "owner", writer)).rejects.toThrow("interrupted");
    const repeated = await applyFrozenCandidate(store, candidate.id, 3, "owner", writer);
    expect(repeated.status).toBe("RECONCILE_REQUIRED"); expect(writer.writeFrozen).toHaveBeenCalledOnce();
  });
});
