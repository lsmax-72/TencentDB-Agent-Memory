import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { contentHash } from "./store.js";
import { freezeCandidates } from "./proposals.js";
import { createProposalRunner } from "./proposal-runner.js";
import type { CandidatePayload } from "./types.js";
const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["memory"], asset_ids: [], daily_tokens: 10000, daily_model_calls: 10, daily_candidates: 3, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" }, 0);
  const source = store.append({ team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "trace", origin: "runtime", status: "RECORDED", title: "offline test", asset_ids: [], payload: {} }, "source", "owner");
  const job = (key: string) => store.append({ ...source, kind: "job", status: "RUNNING", payload: { job_type: "proposal" } }, key, "owner");
  const payload = (target: string): CandidatePayload => ({ asset_kind: "memory", layer: "L1", operation: "create", target_id: target, base_hash: contentHash(""), base_version: null, before: "", after: `Fact ${target}`, source_record_ids: [source.id] });
  return { metadata, store, source, job, payload };
}
describe("candidate slots before model calls and atomic freezing", () => {
  it("concurrent jobs cannot allocate past the daily cap; missing allocation makes no model call", async () => {
    const input = setup(); const first = input.job("first"), second = input.job("second");
    input.store.allocateCandidateSlots(first.id, 3);
    expect(() => input.store.allocateCandidateSlots(second.id)).toThrow("EVOLUTION_CANDIDATE_BUDGET_EXHAUSTED");
    const request = vi.fn();
    const runner = createProposalRunner({ provider: "openai-compatible", base_url: "http://offline.invalid/v1", api_key: "offline", model: "offline", max_output_tokens: 100, token_ceiling: 1000, timeout_ms: 1000, temperature: 0, fallback: false },
      { ...input, jobId: second.id, allocationId: `${second.id}/candidates`, authorize: async () => true }, request);
    await expect(runner.run({ prompt: "test", taskId: "test" })).rejects.toThrow("CANDIDATE_ALLOCATION_NOT_OPEN");
    expect(request).not.toHaveBeenCalled();
  });
  it("invalid or oversized batches freeze nothing and preserve their reserved slots", () => {
    const { store, source, job, payload } = setup(); const allocation = store.allocateCandidateSlots(job("first").id, 2);
    expect(() => freezeCandidates(store, source, [payload("one"), { ...payload("two"), base_hash: "bad" }], allocation)).toThrow("BASE_HASH_MISMATCH");
    expect(() => freezeCandidates(store, source, [payload("one"), payload("two"), payload("three")], allocation)).toThrow("CANDIDATE_BATCH_EXCEEDS_RESERVATION");
    expect(store.list("team", "candidate")).toHaveLength(0); expect(store.assertCandidateAllocation(allocation, "team", "agent")).toBe(2);
  });
  it("commits the whole batch and returns only unused quota, with no reusable allocation", () => {
    const { store, source, job, payload } = setup(); const allocation = store.allocateCandidateSlots(job("first").id, 3);
    expect(freezeCandidates(store, source, [payload("one"), payload("two")], allocation)).toHaveLength(2);
    expect(() => freezeCandidates(store, source, [payload("three")], allocation)).toThrow("CANDIDATE_ALLOCATION_NOT_OPEN");
    const next = store.allocateCandidateSlots(job("second").id);
    expect(store.assertCandidateAllocation(next, "team", "agent")).toBe(1);
    expect(store.list("team", "candidate")).toHaveLength(2);
  });
  it("a mid-batch storage failure rolls back all candidates and quota settlement", () => {
    const { store, source, job, payload } = setup(); const allocation = store.allocateCandidateSlots(job("first").id, 2);
    const append = store.append.bind(store); let count = 0;
    const mock = vi.spyOn(store, "append").mockImplementation((...args) => { if (++count === 2) throw new Error("DISK_FAILURE"); return append(...args); });
    expect(() => freezeCandidates(store, source, [payload("one"), payload("two")], allocation)).toThrow("DISK_FAILURE");
    mock.mockRestore();
    expect(store.list("team", "candidate")).toHaveLength(0); expect(store.assertCandidateAllocation(allocation, "team", "agent")).toBe(2);
    expect(freezeCandidates(store, source, [], allocation)).toEqual([]);
    expect(store.assertCandidateAllocation(store.allocateCandidateSlots(job("second").id), "team", "agent")).toBe(3);
  });
});
