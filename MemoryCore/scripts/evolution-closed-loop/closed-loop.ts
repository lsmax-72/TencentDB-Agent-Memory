import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type CaseOutcome = "accepted" | "rejected" | "unmeasurable" | "no_candidate";

export interface FailureCase {
  case_id: string;
  task_input: string;
  final_output: string;
  tool_events: Array<{ name: string; arguments: string; result: string; success: boolean; sequence: number }>;
  outcome: "PASS" | "FAIL" | "INFRA_ERROR" | "UNKNOWN";
  asset_ids: string[];
  knowledge?: string;
}

export interface ClosedLoopManifest {
  team_id: string;
  agent_id: string;
  user_id: string;
  base_url: string;
  cases: FailureCase[];
}

interface EvolutionRecord {
  id: string;
  kind: string;
  status: string;
  parent_id?: string;
  payload: Record<string, unknown>;
}

interface RecordDetails {
  record: EvolutionRecord;
  events: Array<{ action?: string; document?: Record<string, unknown> }>;
  related: EvolutionRecord[];
}

export interface CandidateResult {
  candidate_id: string;
  validation_status: string;
  evaluation_status?: string;
  attempt_id?: string;
  attempt_type?: string;
  gate_result?: string;
  newly_fixed?: number;
  newly_broken?: number;
  classification_summary?: unknown;
  reason?: string;
}

export interface ClosedLoopCaseResult {
  case_id: string;
  outcome: CaseOutcome;
  reason?: string;
  trace_id?: string;
  diagnosis_id?: string;
  candidate_results: CandidateResult[];
  newly_fixed?: number;
  newly_broken?: number;
}

export interface ClosedLoopSummary {
  accepted: number;
  rejected: number;
  unmeasurable: number;
  no_candidate: number;
  accepted_cases: Array<{ case_id: string; newly_fixed: number; newly_broken: number }>;
}

export interface CaseCheckpoint {
  task_id?: string;
  trace_id?: string;
  outcome?: CaseOutcome;
  reason?: string;
  diagnosis_id?: string;
  candidate_results?: CandidateResult[];
  newly_fixed?: number;
  newly_broken?: number;
}

export interface ClosedLoopState {
  version: 1;
  cases: Record<string, CaseCheckpoint>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RunOptions {
  fetch?: FetchLike;
  apiKey: string;
  userKey: string;
  serviceId?: string;
  timeoutMinutes?: number;
  pollIntervalMs?: number;
  state?: ClosedLoopState;
  persistState?: (state: ClosedLoopState) => void | Promise<void>;
  onCase?: (result: ClosedLoopCaseResult) => void | Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

class DriverFailure extends Error {}
class DriverTimeout extends Error {}

class Deadline {
  constructor(private readonly expiresAt: number, private readonly now: () => number) {}

  remaining(): number {
    const remaining = this.expiresAt - this.now();
    if (remaining <= 0) throw new DriverTimeout("driver_timeout");
    return remaining;
  }
}

class ApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly headers: Record<string, string>,
    private readonly deadline: Deadline,
    private readonly caseId: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async post<T>(path: string, body: unknown, requestLabel: string): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DriverTimeout("driver_timeout"));
      }, this.deadline.remaining());
    });
    try {
      const request = (async () => {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            ...this.headers,
            "content-type": "application/json",
            "x-request-id": deterministicId(this.caseId, requestLabel),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        let envelope: ApiEnvelope<T>;
        try {
          envelope = JSON.parse(text) as ApiEnvelope<T>;
        } catch {
          throw new DriverFailure(`HTTP_${response.status}:${text}`);
        }
        if (!response.ok || envelope.code !== 0 || envelope.data === undefined) {
          throw new DriverFailure(`API_${envelope.code}:${envelope.message ?? text}`);
        }
        return envelope.data;
      })();
      return await Promise.race([request, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

const ACTIVE_JOB_STATUSES = new Set(["QUEUED", "RUNNING"]);

function deterministicId(caseId: string, purpose: string): string {
  const hash = createHash("sha256").update(`${caseId}\0${purpose}`).digest("hex").slice(0, 24);
  return `closed-loop-${hash}`;
}

function eventDocument(details: RecordDetails, key: string): unknown {
  for (let index = details.events.length - 1; index >= 0; index--) {
    const value = details.events[index]?.document?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function rawTerminalReason(details: RecordDetails): string {
  const reason = eventDocument(details, "reason") ?? details.record.payload.reason;
  return reason === undefined ? details.record.status : `${details.record.status}:${String(reason)}`;
}

async function waitForTerminal(
  client: ApiClient,
  teamId: string,
  recordId: string,
  requestLabel: string,
  deadline: Deadline,
  pollIntervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<RecordDetails> {
  for (;;) {
    const details = await client.post<RecordDetails>(
      "/v3/evolution/records/get",
      { team_id: teamId, id: recordId },
      requestLabel,
    );
    if (!ACTIVE_JOB_STATUSES.has(details.record.status)) return details;
    await sleep(Math.min(pollIntervalMs, deadline.remaining()));
  }
}

function finish(
  failure: FailureCase,
  outcome: CaseOutcome,
  reason: string | undefined,
  traceId: string | undefined,
  diagnosisId: string | undefined,
  candidateResults: CandidateResult[],
): ClosedLoopCaseResult {
  const accepted = candidateResults.filter(result => result.attempt_type === "skill_effect_evaluation" && result.gate_result === "PASS");
  const newlyFixed = accepted.reduce((sum, result) => sum + (result.newly_fixed ?? 0), 0);
  const newlyBroken = accepted.reduce((sum, result) => sum + (result.newly_broken ?? 0), 0);
  return {
    case_id: failure.case_id,
    outcome,
    ...(reason ? { reason } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(diagnosisId ? { diagnosis_id: diagnosisId } : {}),
    candidate_results: candidateResults,
    ...(outcome === "accepted" ? { newly_fixed: newlyFixed, newly_broken: newlyBroken } : {}),
  };
}

async function runCase(
  manifest: ClosedLoopManifest,
  failure: FailureCase,
  checkpoint: CaseCheckpoint,
  client: ApiClient,
  deadline: Deadline,
  pollIntervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  saveCheckpoint: (checkpoint: CaseCheckpoint) => Promise<void>,
): Promise<ClosedLoopCaseResult> {
  let taskId = checkpoint.task_id;
  if (!taskId) {
    const task = await client.post<{ task_id: string }>("/v3/meta/task/create", {
      team_id: manifest.team_id,
      creator_user_id: manifest.user_id,
      title: `Closed-loop yield · ${failure.case_id}`,
      description: `Replay of failure manifest case ${failure.case_id}`,
      source_type: "manual",
      status: "completed",
      metadata_json: JSON.stringify({ closed_loop_case_id: failure.case_id }),
      linked_agents: [{ agent_id: manifest.agent_id, role_in_task: "failure_source" }],
    }, "task-create");
    taskId = task.task_id;
    await saveCheckpoint({ ...checkpoint, task_id: taskId });
  }

  let traceId = checkpoint.trace_id;
  if (!traceId) {
    // This is the knowledge-source input. Without operator knowledge the loop can
    // only emit process advice in the measured sample (0/4 effect).
    const finalOutput = failure.knowledge === undefined
      ? failure.final_output
      : `${failure.final_output}\n\nKNOWN FACTS (provided by the operator):\n${failure.knowledge}`;
    const trace = await client.post<EvolutionRecord>("/v3/evolution/task/complete", {
      team_id: manifest.team_id,
      agent_id: manifest.agent_id,
      task_id: taskId,
      session_id: deterministicId(failure.case_id, "session"),
      run_id: deterministicId(failure.case_id, "run"),
      completion: "host_task_complete",
      asset_ids: failure.asset_ids,
      task_input: failure.task_input,
      final_output: finalOutput,
      tool_events: failure.tool_events,
      usage: { input_tokens: null, output_tokens: null, model_calls: null, tool_calls: null },
      actual_model: "unknown",
      outcome: failure.outcome,
      used_asset_versions: {},
    }, "task-complete");
    traceId = trace.id;
    await saveCheckpoint({ ...checkpoint, task_id: taskId, trace_id: traceId });
  }

  const diagnosisJob = await client.post<EvolutionRecord>("/v3/evolution/diagnosis/request", {
    team_id: manifest.team_id,
    id: traceId,
    evidence: { mode: "isolated" },
  }, "diagnosis-request");
  const diagnosisJobDetails = await waitForTerminal(
    client, manifest.team_id, diagnosisJob.id, "diagnosis-poll", deadline, pollIntervalMs, sleep,
  );
  if (diagnosisJobDetails.record.status !== "COMPLETED") {
    return finish(failure, "unmeasurable", rawTerminalReason(diagnosisJobDetails), traceId, undefined, []);
  }

  const diagnosisId = eventDocument(diagnosisJobDetails, "result_id");
  if (typeof diagnosisId !== "string") {
    return finish(failure, "unmeasurable", "COMPLETED:missing_result_id", traceId, undefined, []);
  }
  const diagnosis = await client.post<RecordDetails>("/v3/evolution/records/get", {
    team_id: manifest.team_id, id: diagnosisId,
  }, "diagnosis-record");
  const proposalJob = diagnosis.related.find(record => record.kind === "job" && record.payload.job_type === "proposal");
  if (!proposalJob) {
    const route = diagnosis.record.payload.route;
    return finish(failure, "no_candidate", `${diagnosis.record.status}:${String(route ?? "no_proposal_job")}`, traceId, diagnosisId, []);
  }

  const proposalDetails = await waitForTerminal(
    client, manifest.team_id, proposalJob.id, "proposal-poll", deadline, pollIntervalMs, sleep,
  );
  if (proposalDetails.record.status !== "COMPLETED") {
    return finish(failure, "unmeasurable", rawTerminalReason(proposalDetails), traceId, diagnosisId, []);
  }

  const resultIds = eventDocument(proposalDetails, "result_ids");
  const candidateIds = Array.isArray(resultIds) ? resultIds.filter((id): id is string => typeof id === "string") : [];
  if (candidateIds.length === 0) {
    const noChange = eventDocument(proposalDetails, "no_change");
    return finish(failure, "no_candidate", `COMPLETED:no_change=${String(noChange ?? true)}`, traceId, diagnosisId, []);
  }

  const candidates = await Promise.all(candidateIds.map(id => client.post<RecordDetails>(
    "/v3/evolution/records/get", { team_id: manifest.team_id, id }, `candidate-${id}`,
  ).then(details => details.record)));
  const skillCandidates = candidates.filter(candidate => candidate.payload.asset_kind === "skill");
  if (skillCandidates.length === 0) {
    const kinds = candidates.map(candidate => String(candidate.payload.asset_kind)).join(",");
    return finish(failure, "no_candidate", `COMPLETED:candidate_asset_kind=${kinds}`, traceId, diagnosisId, []);
  }

  const validated: Array<{ candidate: EvolutionRecord; result: CandidateResult }> = [];
  for (const candidate of skillCandidates) {
    const validationJob = await client.post<EvolutionRecord>("/v3/evolution/validation/request", {
      team_id: manifest.team_id, id: candidate.id,
    }, `validation-request-${candidate.id}`);
    const validation = await waitForTerminal(
      client, manifest.team_id, validationJob.id, `validation-poll-${candidate.id}`, deadline, pollIntervalMs, sleep,
    );
    const candidateResult: CandidateResult = { candidate_id: candidate.id, validation_status: validation.record.status };
    validated.push({ candidate, result: candidateResult });
    if (validation.record.status !== "COMPLETED") {
      candidateResult.reason = rawTerminalReason(validation);
    }
  }

  for (const { candidate, result: candidateResult } of validated) {
    if (candidateResult.validation_status !== "COMPLETED") continue;
    const evaluationJob = await client.post<EvolutionRecord>("/v3/evolution/evaluation/request", {
      team_id: manifest.team_id, id: candidate.id,
    }, `evaluation-request-${candidate.id}`);
    const evaluation = await waitForTerminal(
      client, manifest.team_id, evaluationJob.id, `evaluation-poll-${candidate.id}`, deadline, pollIntervalMs, sleep,
    );
    candidateResult.evaluation_status = evaluation.record.status;
    if (evaluation.record.status !== "COMPLETED") {
      candidateResult.reason = rawTerminalReason(evaluation);
      continue;
    }

    const attemptId = eventDocument(evaluation, "result_id");
    if (typeof attemptId !== "string") {
      candidateResult.reason = "COMPLETED:missing_result_id";
      continue;
    }
    const attempt = await client.post<RecordDetails>("/v3/evolution/records/get", {
      team_id: manifest.team_id, id: attemptId,
    }, `evaluation-attempt-${candidate.id}`);
    candidateResult.attempt_id = attemptId;
    candidateResult.attempt_type = typeof attempt.record.payload.attempt_type === "string" ? attempt.record.payload.attempt_type : undefined;
    candidateResult.gate_result = typeof attempt.record.payload.gate_result === "string" ? attempt.record.payload.gate_result : undefined;
    candidateResult.newly_fixed = typeof attempt.record.payload.newly_fixed === "number" ? attempt.record.payload.newly_fixed : undefined;
    candidateResult.newly_broken = typeof attempt.record.payload.newly_broken === "number" ? attempt.record.payload.newly_broken : undefined;
    candidateResult.classification_summary = attempt.record.payload.comparison_summary;
    if (["INFRA_ERROR", "RECONCILE_REQUIRED"].includes(attempt.record.status)) candidateResult.reason = attempt.record.status;
  }

  const candidateResults = validated.map(item => item.result);
  if (candidateResults.some(result => result.attempt_type === "skill_effect_evaluation" && result.gate_result === "PASS")) {
    return finish(failure, "accepted", undefined, traceId, diagnosisId, candidateResults);
  }
  const measurementFailure = candidateResults.find(result => result.reason
    || (result.evaluation_status !== undefined && result.evaluation_status !== "COMPLETED")
    || (result.attempt_type !== undefined && result.attempt_type !== "skill_effect_evaluation"));
  if (measurementFailure) {
    const reason = measurementFailure.reason
      ?? measurementFailure.evaluation_status
      ?? String(measurementFailure.attempt_type);
    return finish(failure, "unmeasurable", reason, traceId, diagnosisId, candidateResults);
  }
  if (candidateResults.some(result => result.gate_result === "FAIL")) {
    return finish(failure, "rejected", "FAIL", traceId, diagnosisId, candidateResults);
  }
  return finish(failure, "unmeasurable", "COMPLETED:missing_gate_result", traceId, diagnosisId, candidateResults);
}

function validateManifest(value: unknown): asserts value is ClosedLoopManifest {
  if (!value || typeof value !== "object") throw new Error("manifest must be a JSON object");
  const manifest = value as Partial<ClosedLoopManifest>;
  for (const field of ["team_id", "agent_id", "user_id", "base_url"] as const) {
    if (typeof manifest[field] !== "string" || !manifest[field]) throw new Error(`manifest.${field} is required`);
  }
  if (!Array.isArray(manifest.cases)) throw new Error("manifest.cases must be an array");
  const ids = new Set<string>();
  for (const item of manifest.cases) {
    if (!item || typeof item.case_id !== "string" || !item.case_id) throw new Error("every case requires case_id");
    if (ids.has(item.case_id)) throw new Error(`duplicate case_id: ${item.case_id}`);
    ids.add(item.case_id);
    if (typeof item.task_input !== "string" || typeof item.final_output !== "string") throw new Error(`${item.case_id}: task_input and final_output must be strings`);
    if (!Array.isArray(item.tool_events) || !Array.isArray(item.asset_ids)) throw new Error(`${item.case_id}: tool_events and asset_ids must be arrays`);
    if (!["PASS", "FAIL", "INFRA_ERROR", "UNKNOWN"].includes(item.outcome)) throw new Error(`${item.case_id}: invalid outcome`);
  }
  new URL(String(manifest.base_url));
}

export function summarize(results: ClosedLoopCaseResult[]): ClosedLoopSummary {
  const summary: ClosedLoopSummary = { accepted: 0, rejected: 0, unmeasurable: 0, no_candidate: 0, accepted_cases: [] };
  for (const result of results) {
    summary[result.outcome]++;
    if (result.outcome === "accepted") {
      summary.accepted_cases.push({
        case_id: result.case_id,
        newly_fixed: result.newly_fixed ?? 0,
        newly_broken: result.newly_broken ?? 0,
      });
    }
  }
  return summary;
}

export async function runClosedLoop(manifestValue: unknown, options: RunOptions): Promise<{ results: ClosedLoopCaseResult[]; summary: ClosedLoopSummary; state: ClosedLoopState }> {
  validateManifest(manifestValue);
  const manifest = manifestValue;
  if (!options.apiKey || !options.userKey) throw new Error("apiKey and userKey are required");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is unavailable");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds)));
  const timeoutMinutes = options.timeoutMinutes ?? 45;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new Error("timeoutMinutes must be positive");
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) throw new Error("pollIntervalMs must be non-negative");
  const state = options.state ?? { version: 1, cases: {} };
  const results: ClosedLoopCaseResult[] = [];

  for (const failure of manifest.cases) {
    const checkpoint = state.cases[failure.case_id] ?? {};
    if (checkpoint.outcome) {
      results.push({
        case_id: failure.case_id,
        outcome: checkpoint.outcome,
        ...(checkpoint.reason ? { reason: checkpoint.reason } : {}),
        ...(checkpoint.trace_id ? { trace_id: checkpoint.trace_id } : {}),
        ...(checkpoint.diagnosis_id ? { diagnosis_id: checkpoint.diagnosis_id } : {}),
        candidate_results: checkpoint.candidate_results ?? [],
        ...(checkpoint.newly_fixed !== undefined ? { newly_fixed: checkpoint.newly_fixed } : {}),
        ...(checkpoint.newly_broken !== undefined ? { newly_broken: checkpoint.newly_broken } : {}),
      });
      continue;
    }

    const deadline = new Deadline(now() + timeoutMinutes * 60_000, now);
    const client = new ApiClient(manifest.base_url, fetchImpl, {
      authorization: `Bearer ${options.apiKey}`,
      "x-tdai-service-id": options.serviceId ?? "default",
      "x-tdai-user-key": options.userKey,
    }, deadline, failure.case_id);
    const saveCheckpoint = async (next: CaseCheckpoint) => {
      state.cases[failure.case_id] = next;
      await options.persistState?.(state);
    };
    let result: ClosedLoopCaseResult;
    try {
      result = await runCase(manifest, failure, checkpoint, client, deadline, pollIntervalMs, sleep, saveCheckpoint);
    } catch (error) {
      const reason = error instanceof DriverTimeout ? "driver_timeout"
        : error instanceof Error ? error.message : String(error);
      result = finish(failure, "unmeasurable", reason, checkpoint.trace_id, undefined, []);
    }
    await saveCheckpoint({ ...state.cases[failure.case_id], ...result });
    results.push(result);
    await options.onCase?.(result);
  }
  return { results, summary: summarize(results), state };
}

export function defaultStatePath(manifestPath: string): string {
  return `${resolve(manifestPath)}.closed-loop-state.json`;
}

export function loadState(statePath: string): ClosedLoopState {
  if (!existsSync(statePath)) return { version: 1, cases: {} };
  const parsed = JSON.parse(readFileSync(statePath, "utf8")) as ClosedLoopState;
  if (parsed.version !== 1 || !parsed.cases || typeof parsed.cases !== "object") throw new Error("invalid closed-loop state file");
  return parsed;
}

export function saveState(statePath: string, state: ClosedLoopState): void {
  const absolute = resolve(statePath);
  const temporary = resolve(dirname(absolute), `.${createHash("sha256").update(absolute).digest("hex").slice(0, 12)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, absolute);
}

export async function runManifestFile(
  manifestPath: string,
  statePath: string,
  options: Omit<RunOptions, "state" | "persistState">,
): Promise<{ results: ClosedLoopCaseResult[]; summary: ClosedLoopSummary; state: ClosedLoopState }> {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
  const state = loadState(statePath);
  return runClosedLoop(manifest, { ...options, state, persistState: next => saveState(statePath, next) });
}
