import { diagnose } from "./diagnosis.js";
import type { ResolveReviewBinding, ReviewBinding } from "./model-bindings.js";
import { contentHash, EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionProfile, type EvolutionRecord } from "./types.js";
import type { ValidationReport } from "./validation.js";

interface DispatcherOptions {
  /** Enabled only after all governed writers and adoption paths have passed admission. */
  admitted: () => boolean;
  resolveModel: ResolveReviewBinding;
  authorize: (source: EvolutionRecord, profile: EvolutionProfile) => Promise<boolean>;
  generate?: (source: EvolutionRecord, job: EvolutionRecord, profile: EvolutionProfile, binding: ReviewBinding) => Promise<EvolutionRecord[]>;
  validate?: (candidate: EvolutionRecord) => Promise<ValidationReport>;
  /** Runs only after an AUTO_AUTHORIZED transition; failures remain visible and never fall back to legacy writes. */
  autoApply?: (candidate: EvolutionRecord) => Promise<void>;
  evaluate?: (candidate: EvolutionRecord, job: EvolutionRecord, profile: EvolutionProfile) => Promise<EvolutionRecord>;
  resolveEvaluation?: (profile: EvolutionProfile) => { id: string; fingerprint: string } | null;
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
      if (result) this.store.completeDiagnosis(job, result, () => this.enqueueProposal(result, job));
      else this.store.jobTransition(job, "RECONCILE_REQUIRED", { reason: "INTERRUPTED_CALL_OUTCOME_UNKNOWN" });
    }
    for (const job of this.store.jobs(["RUNNING"], ["proposal", "proposal_model_step"])) {
      const batch = job.payload.job_type === "proposal" ? this.store.frozenBatch(job) : null;
      if (batch) this.store.completeProposal(job, batch, () => batch.forEach(candidate => this.enqueueValidation(candidate)));
      else this.store.jobTransition(job, "RECONCILE_REQUIRED", { reason: "INTERRUPTED_CALL_OUTCOME_UNKNOWN" });
    }
    for (const job of this.store.jobs(["RUNNING"], ["validation"])) this.store.jobTransition(job, "RECONCILE_REQUIRED", { reason: "VALIDATION_INTERRUPTED_NO_FORMAL_WRITE", model_calls: 0 });
    for (const job of this.store.jobs(["RUNNING"], ["evaluation"])) {
      const result = this.store.find(job.team_id, "attempt", job.id);
      if (result) this.store.jobTransition(job, "COMPLETED", { result_id: result.id, result_hash: result.artifact_hash });
      else this.store.jobTransition(job, "RECONCILE_REQUIRED", { reason: "INTERRUPTED_EVALUATION_OUTCOME_UNKNOWN" });
    }
    this.wake();
  }

  wake(): void {
    if (this.running || this.stopping) return;
    this.running = Promise.resolve().then(() => this.drain()).catch(() => this.options.onError?.()).finally(() => { this.running = null; });
  }

  async idle(): Promise<void> { await this.running; }
  async close(): Promise<void> { this.stopping = true; await this.idle(); }

  private enqueueProposal(source: EvolutionRecord, diagnosisJob: EvolutionRecord): void {
    if (!this.options.generate) return;
    const stage = ({ skill_defect: "skill", memory_gap: "memory_l1", wiki_gap: "wiki" } as Record<string, string>)[String(source.payload.route)];
    if (!stage) return;
    this.store.append({ team_id: source.team_id, owner_user_id: source.owner_user_id, agent_id: source.agent_id,
      kind: "job", origin: "runtime", title: `候选生成：${source.title}`, status: "QUEUED",
      // Generation may read private target contents even when the task itself is shared.
      asset_ids: [...new Set([...source.asset_ids, ...(this.store.profile(source.team_id, source.agent_id)?.asset_ids ?? [])])], parent_id: source.id,
      payload: { ...diagnosisJob.payload, job_type: "proposal", stage, source_id: source.id, source_hash: source.artifact_hash, retry_of: null },
    }, `${source.id}/proposal/${stage}`, source.owner_user_id);
  }

  retryProposal(source: EvolutionRecord, previous: EvolutionRecord, requestId: string): EvolutionRecord {
    if (source.kind !== "diagnosis" || source.origin !== "runtime" || previous.origin !== "runtime"
      || previous.kind !== "job" || previous.payload.job_type !== "proposal" || previous.payload.source_id !== source.id
      || previous.payload.source_hash !== source.artifact_hash || previous.team_id !== source.team_id
      || previous.agent_id !== source.agent_id || previous.owner_user_id !== source.owner_user_id
      || !["INFRA_ERROR", "RECONCILE_REQUIRED", "NEEDS_EVIDENCE"].includes(previous.status) && !previous.status.startsWith("BLOCKED_")) throw new EvolutionError(409, "RETRY_REQUIRES_TERMINAL_PROPOSAL");
    // A recovered frozen batch is complete, not a reason to generate a second batch.
    if (this.store.frozenBatch(previous)) throw new EvolutionError(409, "FROZEN_BATCH_REQUIRES_RECOVERY");
    const key = `${source.id}/proposal/retry/${previous.id}/${requestId}`;
    const existing = this.store.find(source.team_id, "job", key);
    if (existing) return existing;
    const profile = this.store.profile(source.team_id, source.agent_id);
    let binding: ReviewBinding | null = null;
    try { binding = profile ? this.options.resolveModel(profile) : null; } catch { /* Recorded as configuration blocked. */ }
    const status = !profile?.enabled ? "BLOCKED_AUTOMATION_DISABLED" : !binding ? "BLOCKED_MODEL_CONFIGURATION" : !this.options.admitted() ? "BLOCKED_AUTOMATION_ADMISSION" : "QUEUED";
    return this.store.append({ team_id: source.team_id, owner_user_id: source.owner_user_id, agent_id: source.agent_id,
      kind: "job", origin: "runtime", title: `重试候选生成：${source.title}`, status,
      asset_ids: [...new Set([...source.asset_ids, ...(profile?.asset_ids ?? [])])], parent_id: source.id,
      payload: { ...previous.payload, profile_hash: profile ? contentHash(profile) : null, review_binding_id: binding?.id ?? null,
        review_binding_hash: binding?.fingerprint ?? null, retry_of: previous.id },
    }, key, source.owner_user_id);
  }

  enqueueValidation(candidate: EvolutionRecord, retry?: { previous: EvolutionRecord; requestId: string }): EvolutionRecord | null {
    if (!this.options.validate) return null;
    if (candidate.kind !== "candidate" || candidate.origin !== "runtime") throw new EvolutionError(409, "LIVE_CANDIDATE_REQUIRED");
    if (retry && (retry.previous.payload.job_type !== "validation" || retry.previous.origin !== "runtime"
      || retry.previous.payload.source_id !== candidate.id || retry.previous.payload.source_hash !== candidate.artifact_hash
      || !["COMPLETED", "INFRA_ERROR", "RECONCILE_REQUIRED"].includes(retry.previous.status) && !retry.previous.status.startsWith("BLOCKED_"))) throw new EvolutionError(409, "RETRY_REQUIRES_TERMINAL_VALIDATION");
    const key = retry ? `${candidate.id}/validation/retry/${retry.previous.id}/${retry.requestId}` : `${candidate.id}/validation`;
    const existing = this.store.find(candidate.team_id, "job", key); if (existing) return existing;
    if (!["FROZEN", "NEEDS_EVIDENCE", "VALIDATION_FAILED"].includes(candidate.status)) throw new EvolutionError(409, "CANDIDATE_NOT_VALIDATABLE");
    return this.store.append({ team_id: candidate.team_id, owner_user_id: candidate.owner_user_id, agent_id: candidate.agent_id,
      kind: "job", origin: "runtime", title: `校验：${candidate.title}`, status: "QUEUED", asset_ids: candidate.asset_ids, parent_id: candidate.id,
      payload: { job_type: "validation", source_id: candidate.id, source_hash: candidate.artifact_hash, retry_of: retry?.previous.id ?? null },
    }, key, candidate.owner_user_id);
  }

  enqueueEvaluation(candidate: EvolutionRecord, retry?: { previous: EvolutionRecord; requestId: string }): EvolutionRecord | null {
    if (!this.options.evaluate) return null;
    if (candidate.kind !== "candidate" || candidate.origin !== "runtime" || candidate.payload.asset_kind !== "skill") throw new EvolutionError(409, "LIVE_SKILL_CANDIDATE_REQUIRED");
    if (retry && (retry.previous.payload.job_type !== "evaluation" || retry.previous.payload.source_id !== candidate.id
      || retry.previous.payload.source_hash !== candidate.artifact_hash || retry.previous.origin !== "runtime"
      || !["COMPLETED", "INFRA_ERROR", "RECONCILE_REQUIRED"].includes(retry.previous.status) && !retry.previous.status.startsWith("BLOCKED_"))) throw new EvolutionError(409, "RETRY_REQUIRES_TERMINAL_EVALUATION");
    const key = retry ? `${candidate.id}/evaluation/retry/${retry.previous.id}/${retry.requestId}` : `${candidate.id}/evaluation`;
    const existing = this.store.find(candidate.team_id, "job", key); if (existing) return existing;
    if (!["FROZEN", "NEEDS_EVIDENCE"].includes(candidate.status)) throw new EvolutionError(409, "CANDIDATE_NOT_EVALUATABLE");
    const profile = this.store.profile(candidate.team_id, candidate.agent_id);
    let binding: { id: string; fingerprint: string } | null = null;
    try { binding = profile && this.options.resolveEvaluation ? this.options.resolveEvaluation(profile) : null; } catch { /* Persist configuration failure. */ }
    const status = !profile?.enabled ? "BLOCKED_AUTOMATION_DISABLED" : !profile.evaluation_profile_id || !binding ? "BLOCKED_EVALUATOR_CONFIGURATION"
      : !this.options.admitted() ? "BLOCKED_AUTOMATION_ADMISSION" : "QUEUED";
    return this.store.append({ team_id: candidate.team_id, owner_user_id: candidate.owner_user_id, agent_id: candidate.agent_id,
      kind: "job", origin: "runtime", title: `对照评测：${candidate.title}`, status, asset_ids: candidate.asset_ids, parent_id: candidate.id,
      payload: { job_type: "evaluation", source_id: candidate.id, source_hash: candidate.artifact_hash,
        profile_hash: profile ? contentHash(profile) : null, evaluation_profile_id: binding?.id ?? profile?.evaluation_profile_id ?? null,
        evaluation_binding_hash: binding?.fingerprint ?? null, retry_of: retry?.previous.id ?? null },
    }, key, candidate.owner_user_id);
  }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      const job = this.store.jobs(["QUEUED"], ["diagnosis", "proposal", "validation", "evaluation"])[0];
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
    if (job.payload.job_type === "validation") {
      if (!this.options.validate) { block("BLOCKED_VALIDATOR_CONFIGURATION", "VALIDATOR_UNAVAILABLE"); return; }
      const claimed = this.store.jobTransition(job, "RUNNING", { model_calls: 0 });
      try {
        this.store.completeValidation(claimed, source, await this.options.validate(source));
        const candidate = this.store.get(source.id);
        if (candidate?.status === "AUTO_AUTHORIZED" && this.options.autoApply) {
          try { await this.options.autoApply(candidate); } catch { this.options.onError?.(); }
        }
      }
      catch (error) { this.store.jobTransition(claimed, error instanceof EvolutionError && error.code === 403 ? "BLOCKED_SOURCE_PERMISSION" : "INFRA_ERROR", { reason: error instanceof EvolutionError ? error.message : "VALIDATION_FAILED_TO_RUN", model_calls: 0 }); }
      return;
    }
    if (!profile?.enabled) { block("BLOCKED_AUTOMATION_DISABLED", "AUTOMATION_NOT_ENABLED"); return; }
    if (!this.options.admitted()) { block("BLOCKED_AUTOMATION_ADMISSION", "AUTOMATION_ADMISSION_REQUIRED"); return; }
    if (contentHash(profile) !== job.payload.profile_hash) { block("BLOCKED_PROFILE_CHANGED", "RENEW_DISPATCH_REQUIRED"); return; }
    if (job.payload.job_type === "evaluation") {
      if (!this.options.evaluate) { block("BLOCKED_EVALUATOR_CONFIGURATION", "EVALUATOR_UNAVAILABLE"); return; }
      try {
        if (!await this.options.authorize(source, profile)) { block("BLOCKED_SOURCE_PERMISSION", "SOURCE_ACCESS_REVOKED"); return; }
        const binding = this.options.resolveEvaluation?.(profile);
        if (!binding || binding.id !== job.payload.evaluation_profile_id || binding.fingerprint !== job.payload.evaluation_binding_hash) {
          block("BLOCKED_EVALUATOR_CONFIGURATION", "EVALUATION_BINDING_MISSING_OR_CHANGED"); return;
        }
      } catch { block("BLOCKED_SOURCE_PERMISSION", "ADMISSION_CHECK_FAILED"); return; }
      const claimed = this.store.jobTransition(job, "RUNNING");
      try {
        const result = await this.options.evaluate(source, claimed, profile);
        this.store.jobTransition(claimed, "COMPLETED", { result_id: result.id, result_hash: result.artifact_hash, outcome: result.status });
      } catch (error) {
        const known = error instanceof EvolutionError;
        this.store.jobTransition(claimed, known && error.code === 429 ? "BLOCKED_BUDGET" : known && [403, 409].includes(error.code) ? "BLOCKED_EVALUATION" : "INFRA_ERROR",
          { reason: known ? error.message : "EVALUATION_RUNNER_FAILED", usage: null });
      }
      return;
    }
    let binding: ReturnType<ResolveReviewBinding>;
    try {
      if (!await this.options.authorize(source, profile)) { block("BLOCKED_SOURCE_PERMISSION", "SOURCE_ACCESS_REVOKED"); return; }
      binding = this.options.resolveModel(profile);
      if (!binding || binding.id !== job.payload.review_binding_id || binding.fingerprint !== job.payload.review_binding_hash) {
        block("BLOCKED_MODEL_CONFIGURATION", "REVIEW_BINDING_MISSING_OR_CHANGED"); return;
      }
    } catch { block("BLOCKED_SOURCE_PERMISSION", "ADMISSION_CHECK_FAILED"); return; }
    if (job.payload.job_type === "proposal") {
      if (!this.options.generate || !binding.createProposalRunner) { block("BLOCKED_GENERATOR_CONFIGURATION", "PROPOSAL_RUNNER_UNAVAILABLE"); return; }
      const claimed = this.store.jobTransition(job, "RUNNING", { actual_model: binding.model.modelId });
      try {
        const results = await this.options.generate(source, claimed, profile, binding);
        this.store.completeProposal(claimed, results, () => results.forEach(candidate => this.enqueueValidation(candidate)));
      } catch (error) {
        const known = error instanceof EvolutionError;
        this.store.jobTransition(claimed, known && error.code === 429 ? "BLOCKED_BUDGET" : known && [403, 409, 501].includes(error.code) ? "BLOCKED_GENERATION" : "INFRA_ERROR", { reason: known ? error.message : "PROPOSAL_GENERATION_FAILED", usage: null });
      }
      return;
    }
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
      this.store.completeDiagnosis(claimed, result, () => this.enqueueProposal(result, claimed));
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
