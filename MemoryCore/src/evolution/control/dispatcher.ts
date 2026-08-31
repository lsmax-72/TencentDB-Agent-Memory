import { diagnose } from "./diagnosis.js";
import type { ResolveReviewBinding } from "./model-bindings.js";
import { contentHash, EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionProfile, type EvolutionRecord } from "./types.js";

interface DispatcherOptions {
  /** Enabled only after all governed writers and adoption paths have passed admission. */
  admitted: () => boolean;
  resolveModel: ResolveReviewBinding;
  authorize: (source: EvolutionRecord, profile: EvolutionProfile) => Promise<boolean>;
  onError?: () => void;
}

/** One in-process executor per metadata store. No shell, asset writer or promotion credentials. */
export class EvolutionDispatcher {
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(private readonly store: EvolutionStore, private readonly options: DispatcherOptions) {}

  enqueue(trace: EvolutionRecord, retry?: { previous: EvolutionRecord; requestId: string }): EvolutionRecord {
    if (trace.kind !== "trace" || trace.origin !== "runtime") throw new EvolutionError(409, "LIVE_TRACE_REQUIRED");
    if (retry && (retry.previous.origin !== "runtime" || retry.previous.payload.job_type !== "diagnosis"
      || retry.previous.payload.source_id !== trace.id || retry.previous.team_id !== trace.team_id
      || !["INFRA_ERROR", "RECONCILE_REQUIRED", "NEEDS_EVIDENCE"].includes(retry.previous.status) && !retry.previous.status.startsWith("BLOCKED_"))) throw new EvolutionError(409, "RETRY_REQUIRES_TERMINAL_JOB");
    const key = retry ? `${trace.id}/diagnosis/retry/${retry.previous.id}/${retry.requestId}` : `${trace.id}/diagnosis`;
    const existing = this.store.find(trace.team_id, "job", key);
    if (existing) return existing; // Re-reporting completion is not permission to retry a paid call.
    const profile = this.store.profile(trace.team_id, trace.agent_id);
    let status = !profile?.enabled ? "BLOCKED_AUTOMATION_DISABLED" : "QUEUED";
    let binding: ReturnType<ResolveReviewBinding> = null;
    if (status === "QUEUED") {
      try { binding = this.options.resolveModel(profile!); }
      catch { status = "BLOCKED_MODEL_CONFIGURATION"; }
      if (status === "QUEUED" && !binding) status = "BLOCKED_MODEL_CONFIGURATION";
      if (status === "QUEUED" && !this.options.admitted()) status = "BLOCKED_AUTOMATION_ADMISSION";
    }
    return this.store.append({ team_id: trace.team_id, owner_user_id: trace.owner_user_id, agent_id: trace.agent_id,
      kind: "job", origin: "runtime", title: `诊断：${trace.title}`, status, asset_ids: trace.asset_ids, parent_id: trace.id,
      payload: { job_type: "diagnosis", source_id: trace.id, source_hash: trace.artifact_hash,
        profile_hash: profile ? contentHash(profile) : null, review_binding_id: binding?.id ?? null,
        review_binding_hash: binding?.fingerprint ?? null, retry_of: retry?.previous.id ?? null,
      },
    }, key, trace.owner_user_id);
  }

  /** Recover durable results, but never guess whether an interrupted upstream call was charged. */
  recover(): void {
    for (const job of this.store.jobs(["RUNNING"])) {
      const result = this.store.find(job.team_id, "diagnosis", job.id);
      this.store.jobTransition(job, result ? "COMPLETED" : "RECONCILE_REQUIRED", {
        result_id: result?.id ?? null, reason: result ? "PERSISTED_RESULT_RECOVERED" : "INTERRUPTED_CALL_OUTCOME_UNKNOWN",
      });
    }
    this.wake();
  }

  wake(): void {
    if (this.running || this.stopping) return;
    this.running = Promise.resolve().then(() => this.drain()).catch(() => this.options.onError?.()).finally(() => { this.running = null; });
  }

  async idle(): Promise<void> { await this.running; }
  async close(): Promise<void> { this.stopping = true; await this.idle(); }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      const job = this.store.jobs(["QUEUED"])[0];
      if (!job) return;
      try { await this.execute(job); }
      catch (error) {
        // Another dispatcher may have won the CAS. Never mark its in-flight call interrupted.
        if (error instanceof EvolutionError && error.message === "STATE_STALE") continue;
        const current = this.store.get(job.id);
        if (current?.status === "QUEUED") this.store.jobTransition(current, "INFRA_ERROR", { reason: "DISPATCH_PREPARATION_FAILED", model_calls: 0 });
        else throw error; // Storage failures retain the current receipt for recovery, without a busy loop.
      }
    }
  }

  private async execute(job: EvolutionRecord): Promise<void> {
    const source = this.store.get(String(job.payload.source_id));
    const profile = this.store.profile(job.team_id, job.agent_id);
    const block = (status: string, reason: string) => this.store.jobTransition(job, status, { reason, model_calls: 0 });
    if (!source || source.artifact_hash !== job.payload.source_hash) { block("NEEDS_EVIDENCE", "SOURCE_MISSING_OR_CHANGED"); return; }
    if (!profile?.enabled) { block("BLOCKED_AUTOMATION_DISABLED", "AUTOMATION_NOT_ENABLED"); return; }
    if (!this.options.admitted()) { block("BLOCKED_AUTOMATION_ADMISSION", "AUTOMATION_ADMISSION_REQUIRED"); return; }
    if (contentHash(profile) !== job.payload.profile_hash) { block("BLOCKED_PROFILE_CHANGED", "RENEW_DISPATCH_REQUIRED"); return; }
    let binding: ReturnType<ResolveReviewBinding>;
    try {
      if (!await this.options.authorize(source, profile)) { block("BLOCKED_SOURCE_PERMISSION", "SOURCE_ACCESS_REVOKED"); return; }
      binding = this.options.resolveModel(profile);
      if (!binding || binding.id !== job.payload.review_binding_id || binding.fingerprint !== job.payload.review_binding_hash) {
        block("BLOCKED_MODEL_CONFIGURATION", "REVIEW_BINDING_MISSING_OR_CHANGED"); return;
      }
    } catch { block("BLOCKED_SOURCE_PERMISSION", "ADMISSION_CHECK_FAILED"); return; }
    if (source.payload.outcome === "INFRA_ERROR") { block("SCREENED_INFRASTRUCTURE", "HOST_REPORTED_INFRA_ERROR_NOT_SKILL_DEFECT"); return; }
    if (source.payload.outcome === "UNKNOWN" || !source.payload.task_input || !source.payload.final_output) {
      block("NEEDS_EVIDENCE", "TASK_OUTCOME_OR_CONTENT_MISSING"); return;
    }
    // Only readable, same-owner evidence can support a systemic diagnosis; never mix Teams/users.
    const related: EvolutionRecord[] = [];
    for (const record of this.store.list(source.team_id, "trace")) {
      if (related.length === 2) break;
      if (record.id !== source.id && record.origin === "runtime" && record.agent_id === source.agent_id && record.owner_user_id === source.owner_user_id
        && record.payload.outcome === "FAIL" && await this.options.authorize(record, profile)) related.push(record);
    }
    // Recheck after asynchronous related-evidence reads, immediately before the paid operation.
    if (!await this.options.authorize(source, profile)) { block("BLOCKED_SOURCE_PERMISSION", "SOURCE_ACCESS_REVOKED"); return; }
    if (contentHash(this.store.profile(job.team_id, job.agent_id)) !== job.payload.profile_hash) { block("BLOCKED_PROFILE_CHANGED", "RENEW_DISPATCH_REQUIRED"); return; }
    // A single writer claims with CAS before model dispatch; another request cannot claim it again.
    const claimed = this.store.jobTransition(job, "RUNNING", { actual_model: binding.model.modelId });
    try {
      const result = await diagnose(this.store, source, related, binding.model, job.id);
      this.store.jobTransition(claimed, "COMPLETED", { result_id: result.id, result_hash: result.artifact_hash, usage: result.payload.usage });
    } catch (error) {
      const known = error instanceof EvolutionError;
      this.store.jobTransition(claimed, known && error.code === 429 ? "BLOCKED_BUDGET" : "INFRA_ERROR", {
        reason: known ? error.message : "DIAGNOSIS_RUNNER_ERROR",
        // Null is deliberately not zero: a transport error may already have consumed tokens.
        usage: null,
      });
    }
  }
}
