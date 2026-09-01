import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { MetadataService } from "../../metadata/service/metadata-service.js";
import { EvolutionDispatcher } from "./dispatcher.js";
import { EvolutionService } from "./service.js";
import { persistSkillEvaluation } from "./skill-evaluation-executor.js";
import type { EvaluationAttempt } from "../evaluation/contracts/types.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

async function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "owner", default_key_value: "key" });
  metadata.createTeam({ team_id: "team", name: "team", owner_user_id: "owner" });
  metadata.createAgent({ agent_id: "agent", team_id: "team", owner_user_id: "owner", name: "agent" });
  metadata.createAsset({ asset_id: "skl-workspace", team_id: "team", asset_type: "skill", name: "skill", owner_user_id: "owner", source_type: "test", visibility: "private", status: "approved" });
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill"], asset_ids: ["skl-workspace"],
    daily_tokens: 1_000_000, daily_model_calls: 100, daily_candidates: 10, evaluation_profile_id: "eval", review_model_id: "review",
    auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" }, 0);
  const source = store.append({ team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "diagnosis", origin: "runtime",
    status: "DIAGNOSED", title: "source", asset_ids: ["skl-workspace"], payload: { route: "skill_defect" } }, "source", "owner");
  const candidate = store.append({ team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", origin: "runtime",
    status: "NEEDS_EVIDENCE", title: "candidate", asset_ids: ["skl-workspace"], parent_id: source.id,
    payload: { asset_kind: "skill", target_id: "skl-workspace", source_record_ids: [source.id], before: "old", after: "new" } }, "candidate", "owner");
  const attempt = (jobId: string): EvaluationAttempt => ({ attempt_id: "attempt", attempt_number: 1, candidate_id: candidate.id,
    candidate_artifact_hash: "sha256:candidate", baseline_skill_id: "skl-workspace", baseline_version: 1, baseline_artifact_hash: "sha256:baseline",
    suite_ref: { id: "suite", revision: "1", hash: "sha256:suite" }, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), outcome: "PASS", paired_results: [],
    result: { attempt_id: "attempt", candidate_ref: { candidate_id: candidate.id, artifact_hash: "sha256:candidate" }, baseline_ref: { skill_id: "skl-workspace", version: 1, artifact_hash: "sha256:baseline" },
      suite_ref: { id: "suite", revision: "1", hash: "sha256:suite" }, baseline_summary: { pass: 0, fail: 0, infra: 0 }, candidate_summary: { pass: 0, fail: 0, infra: 0 },
      comparison_summary: { newly_fixed: ["AC-01"], newly_broken: [], unchanged_success: [], unchanged_failure: [], uncomparable: [] }, critical_candidate_failures: [],
      cost_summary: { baseline: { input_tokens: 1, output_tokens: 1, total_tokens: 2, model_call_count: 1, tool_call_count: 0, tool_names: [], elapsed_ms: 1 }, candidate: { input_tokens: 1, output_tokens: 1, total_tokens: 2, model_call_count: 1, tool_call_count: 0, tool_names: [], elapsed_ms: 1 }, token_increase_ratio: 0, tool_call_increase: 0, model_call_increase: 0 },
      gate: { status: "PASS", reasons: [], policy_hash: "sha256:policy" },
    } });
  const evaluate = vi.fn(async (record, job) => persistSkillEvaluation(store, record, job, attempt(job.id)));
  let service: EvolutionService;
  const dispatcher = new EvolutionDispatcher(store, { admitted: () => true, resolveModel: () => null,
    authorize: (record, profile) => service.authorizeDispatch(record, profile), resolveEvaluation: () => ({ id: "eval", fingerprint: "frozen" }), evaluate });
  service = new EvolutionService(store, metadata, new MetadataService(metadata, "test"), true, dispatcher, { supports: () => true } as never);
  return { store, service, dispatcher, candidate, evaluate };
}

describe("durable Skill evaluation dispatch", () => {
  it("creates one fixed evaluation job and a candidate-bound effect receipt", async () => {
    const test = await setup();
    await test.service.invoke("evaluation/request", { team_id: "team", id: test.candidate.id }, "key"); await test.dispatcher.idle();
    expect(test.evaluate).toHaveBeenCalledOnce();
    const [receipt] = test.store.list("team", "attempt");
    expect(receipt.payload).toMatchObject({ attempt_type: "skill_effect_evaluation", candidate_hash: test.candidate.artifact_hash,
      gate_result: "PASS", newly_fixed: 1, newly_broken: 0, demonstrates_improvement: true });
    await test.service.invoke("evaluation/request", { team_id: "team", id: test.candidate.id }, "key"); await test.dispatcher.idle();
    expect(test.evaluate).toHaveBeenCalledOnce(); expect(test.store.list("team", "attempt")).toHaveLength(1);
  });

  it("recovers a persisted result without replaying nanobot", async () => {
    const test = await setup();
    await test.service.invoke("evaluation/request", { team_id: "team", id: test.candidate.id }, "key"); await test.dispatcher.idle();
    const [job] = test.store.jobs(["COMPLETED"], ["evaluation"]); test.store.jobTransition(job, "RUNNING");
    test.dispatcher.recover(); await test.dispatcher.idle();
    expect(test.store.get(job.id)?.status).toBe("COMPLETED"); expect(test.evaluate).toHaveBeenCalledOnce();
  });
});
