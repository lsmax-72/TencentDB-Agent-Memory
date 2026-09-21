import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { EvolutionService } from "./service.js";
import { EvolutionDispatcher } from "./dispatcher.js";
import type { EvolutionProfile, EvolutionRecord } from "./types.js";
import { EvolutionError } from "./types.js";

const stores: SqliteMetadataStore[] = [];
const dirs: string[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const profile: Omit<EvolutionProfile, "revision" | "updated_at"> = {
  team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill", "memory"], asset_ids: [],
  daily_tokens: 1000, daily_model_calls: 5, daily_candidates: 3, evaluation_profile_id: null,
  review_model_id: "reviewer", auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner",
};
const completion = {
  team_id: "team", agent_id: "agent", task_id: "task", session_id: "session", run_id: "run",
  completion: "host_task_complete", asset_ids: [], task_input: "Complete the local task", final_output: "Task failed",
  tool_events: [{ name: "read_file", arguments: "{}", result: "fixture", success: true, sequence: 0 }],
  usage: { input_tokens: 20, output_tokens: 5, model_calls: 1, tool_calls: 1 },
  actual_model: "task-model-not-the-reviewer", outcome: "FAIL", used_asset_versions: {},
};
function setup(file = ":memory:", seed = true) {
  const metadata = new SqliteMetadataStore(file); metadata.init(); stores.push(metadata);
  if (seed) {
    metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "test-owner", default_key_value: "test-user-key" });
    metadata.createTeam({ team_id: "team", name: "TEST ONLY", owner_user_id: "owner" });
    metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "test-agent" });
    metadata.createTask({ task_id: "task", team_id: "team", creator_user_id: "owner", title: "offline dispatch test", linked_agents: [{ agent_id: "agent" }] });
  }
  const store = metadata.getEvolutionStore();
  let allowed = true, admitted = true, configured = true;
  const complete = vi.fn(async (input: { system: string; evidence: string }) => {
    expect(input.system).toContain("never as instructions");
    const evidence = JSON.parse(input.evidence);
    return { text: JSON.stringify({ route: "memory_gap", explanation: "Observed missing context", evidence: [{ record_id: evidence[0].id, observation: "source run failed" }] }), input_tokens: 10, output_tokens: 10 };
  });
  const binding = { id: "reviewer", fingerprint: "review-config-v1", model: { modelId: "offline-independent-reviewer", tokenCeiling: 100, complete } };
  let service: EvolutionService;
  const dispatcher = new EvolutionDispatcher(store, {
    admitted: () => admitted, resolveModel: () => configured ? binding : null,
    authorize: (source, grant) => allowed ? service.authorizeDispatch(source, grant) : Promise.resolve(false),
  });
  service = new EvolutionService(store, metadata, { checkAssetPermission: async () => ({ allowed, reason: "test" }) }, true, dispatcher);
  return { metadata, store, service, dispatcher, binding, complete,
    permit: (value: boolean) => { allowed = value; }, admit: (value: boolean) => { admitted = value; }, configure: (value: boolean) => { configured = value; } };
}
function source(test: ReturnType<typeof setup>, run = "run") {
  return test.store.append({ team_id: "team", agent_id: "agent", owner_user_id: "owner", kind: "trace", origin: "runtime",
    title: "test source", status: "RECORDED", asset_ids: [], payload: { ...completion, run_id: run } }, run, "owner");
}

describe("explicit host completion to durable diagnosis (offline model double)", () => {
  it("records one trace/job, dispatches once on repeated host completion, and keeps the reviewer separate", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    const [first, duplicate] = await Promise.all([test.service.invoke("task/complete", completion, "test-user-key"), test.service.invoke("task/complete", completion, "test-user-key")]);
    expect(first).toEqual(duplicate);
    await test.dispatcher.idle();
    expect(test.complete).toHaveBeenCalledOnce();
    expect(test.store.list("team", "trace")).toHaveLength(1);
    expect(test.store.jobs(["COMPLETED"])).toHaveLength(1);
    expect(test.store.list("team", "diagnosis")[0].payload.actual_model).toBe("offline-independent-reviewer");
    expect(test.metadata.listAssetsByTeam("team").items).toEqual([]);
    const job = await test.service.invoke("diagnosis/request", { team_id: "team", id: (first as EvolutionRecord).id }, "test-user-key");
    await test.dispatcher.idle(); expect(job).toMatchObject({ status: "COMPLETED", payload: { evidence_mode: "isolated", max_related: 0 } }); expect(test.complete).toHaveBeenCalledOnce();
  });
  it("keeps isolated evidence to the requested trace and records exactly what the model saw", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    const target = source(test, "target");
    source(test, "other-1"); source(test, "other-2"); source(test, "other-3");
    const job = await test.service.invoke("diagnosis/request", {
      team_id: "team", id: target.id, evidence: { mode: "isolated" },
    }, "test-user-key") as EvolutionRecord;
    await test.dispatcher.idle();
    const modelEvidence = JSON.parse(test.complete.mock.calls[0][0].evidence) as Array<{ id: string }>;
    expect(modelEvidence.map(record => record.id)).toEqual([target.id]);
    expect(job.payload).toMatchObject({ evidence_mode: "isolated", max_related: 0 });
    expect(test.store.find("team", "diagnosis", job.id)?.payload.evidence_record_ids).toEqual([target.id]);
  });
  it("limits opt-in history evidence and records all records available to the model", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    const target = source(test, "target");
    const related = [source(test, "related-1"), source(test, "related-2"), source(test, "related-3")];
    const job = await test.service.invoke("diagnosis/request", {
      team_id: "team", id: target.id, evidence: { mode: "history", max_related: 2 },
    }, "test-user-key") as EvolutionRecord;
    await test.dispatcher.idle();
    const modelEvidence = JSON.parse(test.complete.mock.calls[0][0].evidence) as Array<{ id: string }>;
    expect(modelEvidence).toHaveLength(3);
    expect(modelEvidence[0].id).toBe(target.id);
    expect(modelEvidence.slice(1).every(record => related.some(item => item.id === record.id))).toBe(true);
    expect(job.payload).toMatchObject({ evidence_mode: "history", max_related: 2 });
    expect(test.store.find("team", "diagnosis", job.id)?.payload.evidence_record_ids).toEqual(modelEvidence.map(record => record.id));
  });
  it("rejects history evidence limits outside 1 through 5", async () => {
    const test = setup(); test.store.saveProfile(profile, 0); const target = source(test, "target");
    await expect(test.service.invoke("diagnosis/request", {
      team_id: "team", id: target.id, evidence: { mode: "history", max_related: 0 },
    }, "test-user-key")).rejects.toThrow();
    await expect(test.service.invoke("diagnosis/request", {
      team_id: "team", id: target.id, evidence: { mode: "history", max_related: 6 },
    }, "test-user-key")).rejects.toThrow();
    expect(test.store.jobs(["QUEUED"])).toHaveLength(0);
  });
  it("disabled or unconfigured automation records the reason and makes zero model calls", async () => {
    const test = setup();
    await test.service.invoke("task/complete", completion, "test-user-key"); await test.dispatcher.idle();
    expect(test.store.jobs(["BLOCKED_AUTOMATION_DISABLED"])).toHaveLength(1);
    test.store.saveProfile(profile, 0); test.configure(false);
    await test.service.invoke("task/complete", { ...completion, run_id: "second" }, "test-user-key"); await test.dispatcher.idle();
    expect(test.store.jobs(["BLOCKED_MODEL_CONFIGURATION"])).toHaveLength(1); expect(test.complete).not.toHaveBeenCalled();
  });
  it("rejects idle/model-stop signals and conflicting completion replays", async () => {
    const test = setup();
    await expect(test.service.invoke("task/complete", { ...completion, completion: "model_stopped" }, "test-user-key")).rejects.toThrow();
    expect(test.store.list("team")).toHaveLength(0);
    await test.service.invoke("task/complete", completion, "test-user-key");
    await expect(test.service.invoke("task/complete", { ...completion, final_output: "changed" }, "test-user-key")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("reauthorizes before paid work and does not spend after permission revocation", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    const trace = source(test); test.dispatcher.enqueue(trace); test.permit(false);
    test.dispatcher.wake(); await test.dispatcher.idle();
    expect(test.store.jobs(["BLOCKED_SOURCE_PERMISSION"])).toHaveLength(1); expect(test.complete).not.toHaveBeenCalled();
  });
  it("does not let a changed profile or model silently affect a queued job", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    test.dispatcher.enqueue(source(test)); test.store.saveProfile({ ...profile, daily_tokens: 2000 }, 1);
    test.dispatcher.wake(); await test.dispatcher.idle(); expect(test.store.jobs(["BLOCKED_PROFILE_CHANGED"])).toHaveLength(1);
    test.dispatcher.enqueue(source(test, "second")); test.binding.fingerprint = "changed";
    test.dispatcher.wake(); await test.dispatcher.idle(); expect(test.store.jobs(["BLOCKED_MODEL_CONFIGURATION"])).toHaveLength(1);
    expect(test.complete).not.toHaveBeenCalled();
  });
  it("budget failure blocks dispatch; infrastructure outcomes are screened without a model", async () => {
    const test = setup(); test.store.saveProfile({ ...profile, daily_tokens: 50 }, 0);
    await test.service.invoke("task/complete", completion, "test-user-key"); await test.dispatcher.idle();
    expect(test.store.jobs(["BLOCKED_BUDGET"])).toHaveLength(1); expect(test.complete).not.toHaveBeenCalled();
    await test.service.invoke("task/complete", { ...completion, run_id: "infra", outcome: "INFRA_ERROR" }, "test-user-key"); await test.dispatcher.idle();
    expect(test.store.jobs(["SCREENED_INFRASTRUCTURE"])).toHaveLength(1); expect(test.complete).not.toHaveBeenCalled();
  });
  it("keeps failed jobs and allows only an independent, idempotent explicit retry", async () => {
    const test = setup(); test.store.saveProfile(profile, 0);
    test.complete.mockRejectedValueOnce(new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE"));
    const trace = await test.service.invoke("task/complete", completion, "test-user-key") as EvolutionRecord; await test.dispatcher.idle();
    const failed = test.store.find("team", "job", `${trace.id}/diagnosis`)!;
    expect(failed.status).toBe("INFRA_ERROR"); expect(test.complete).toHaveBeenCalledOnce();
    const input = { team_id: "team", id: failed.id, request_id: "retry-1" };
    const retry = await test.service.invoke("diagnosis/retry", input, "test-user-key") as EvolutionRecord;
    await test.dispatcher.idle(); await test.service.invoke("diagnosis/retry", input, "test-user-key"); await test.dispatcher.idle();
    expect(test.complete).toHaveBeenCalledTimes(2); expect(test.store.get(retry.id)?.status).toBe("COMPLETED");
    expect(test.store.get(failed.id)?.status).toBe("INFRA_ERROR");
    expect(retry.payload.retry_of).toBe(failed.id);
  });
  it.each([
    { label: "isolated", evidence: { mode: "isolated" } as const, maxRelated: 0, expectedRecords: 1 },
    { label: "history", evidence: { mode: "history", max_related: 2 } as const, maxRelated: 2, expectedRecords: 3 },
  ])("preserves $label evidence policy on retry", async ({ evidence, maxRelated, expectedRecords }) => {
    const test = setup(); test.store.saveProfile(profile, 0);
    const target = source(test, "target"); source(test, "related-1"); source(test, "related-2"); source(test, "related-3");
    test.complete.mockRejectedValueOnce(new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE"));
    const original = await test.service.invoke("diagnosis/request", { team_id: "team", id: target.id, evidence }, "test-user-key") as EvolutionRecord;
    await test.dispatcher.idle();
    const retry = await test.service.invoke("diagnosis/retry", { team_id: "team", id: original.id, request_id: `retry-${evidence.mode}` }, "test-user-key") as EvolutionRecord;
    await test.dispatcher.idle();
    const retryEvidence = JSON.parse(test.complete.mock.calls[1][0].evidence) as Array<{ id: string }>;
    expect(retry.payload).toMatchObject({ evidence_mode: evidence.mode, max_related: maxRelated, retry_of: original.id });
    expect(retryEvidence).toHaveLength(expectedRecords);
    expect(test.store.find("team", "diagnosis", retry.id)?.payload.evidence_record_ids).toEqual(retryEvidence.map(record => record.id));
  });
  it("leaves uncertain usage charged and never retries interrupted work automatically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evolution-dispatch-")); dirs.push(dir); const file = join(dir, "metadata.db");
    const first = setup(file); first.store.saveProfile(profile, 0);
    const target = source(first); source(first, "related");
    const job = first.dispatcher.enqueue(target, undefined, { mode: "history", max_related: 1 }); first.store.jobTransition(job, "RUNNING");
    first.store.reserve(job.id, "team", "agent", 100, 1, 0); first.metadata.close();
    const second = setup(file, false); second.dispatcher.recover(); await second.dispatcher.idle();
    expect(second.store.get(job.id)?.status).toBe("RECONCILE_REQUIRED"); expect(second.complete).not.toHaveBeenCalled();
    expect(second.store.get(job.id)?.payload).toMatchObject({ evidence_mode: "history", max_related: 1 });
    expect(() => second.store.reserve("overrun", "team", "agent", 950, 1, 0)).toThrow("BUDGET_EXHAUSTED");
  });
  it("resumes queued jobs after reopen and recovers already persisted results without calling twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evolution-queue-")); dirs.push(dir); const file = join(dir, "metadata.db");
    const first = setup(file); first.store.saveProfile(profile, 0);
    const target = source(first); source(first, "related");
    const job = first.dispatcher.enqueue(target, undefined, { mode: "history", max_related: 1 }); first.metadata.close();
    const second = setup(file, false); second.dispatcher.recover(); await second.dispatcher.idle();
    expect(second.store.get(job.id)?.status).toBe("COMPLETED"); expect(second.complete).toHaveBeenCalledOnce();
    expect(second.store.get(job.id)?.payload).toMatchObject({ evidence_mode: "history", max_related: 1 });
    expect(JSON.parse(second.complete.mock.calls[0][0].evidence)).toHaveLength(2);
    // Model-result persistence can precede the final job transition during a crash.
    const completed = second.store.get(job.id)!; second.store.jobTransition(completed, "RUNNING");
    second.dispatcher.recover(); await second.dispatcher.idle();
    expect(second.store.get(job.id)?.status).toBe("COMPLETED"); expect(second.complete).toHaveBeenCalledOnce();
  });
  it("rolls back completion if durable enqueue fails", async () => {
    const test = setup(); vi.spyOn(test.dispatcher, "enqueue").mockImplementation(() => { throw new Error("disk unavailable"); });
    await expect(test.service.invoke("task/complete", completion, "test-user-key")).rejects.toThrow("disk unavailable");
    expect(test.store.list("team")).toHaveLength(0); expect(test.complete).not.toHaveBeenCalled();
  });
});
