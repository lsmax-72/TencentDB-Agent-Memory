import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { EvolutionError, type EvolutionRecord, type EvolutionProfile, type RecordKind } from "./types.js";
import { canonicalJson } from "../evaluation/contracts/hash.js";

export function contentHash(value: unknown): string {
  // Hash the exact JSON representation that is persisted (optional fields are omitted).
  return createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest("hex");
}
type NewRecord = Omit<EvolutionRecord, "id" | "artifact_hash" | "revision" | "created_at" | "updated_at">;

/** Uses the metadata connection and transaction boundary; never creates another database. */
export class EvolutionStore {
  private transactionDepth = 0;
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_records (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL, document TEXT NOT NULL,
        UNIQUE(team_id, kind, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS evolution_records_team ON evolution_records(team_id, kind);
      CREATE TABLE IF NOT EXISTS evolution_profiles (
        team_id TEXT NOT NULL, agent_id TEXT NOT NULL, document TEXT NOT NULL,
        PRIMARY KEY(team_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS evolution_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL,
        actor TEXT NOT NULL, action TEXT NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evolution_reservations (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, agent_id TEXT NOT NULL, day TEXT NOT NULL,
        tokens INTEGER NOT NULL, calls INTEGER NOT NULL, candidates INTEGER NOT NULL,
        settled INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.transactionDepth--; }
  }

  get(id: string): EvolutionRecord | null {
    const row = this.db.prepare("SELECT document FROM evolution_records WHERE id=?").get(id);
    return row ? JSON.parse(String(row.document)) : null;
  }

  find(teamId: string, kind: RecordKind, dedupeKey: string): EvolutionRecord | null {
    const row = this.db.prepare("SELECT document FROM evolution_records WHERE team_id=? AND kind=? AND dedupe_key=?").get(teamId, kind, dedupeKey);
    return row ? JSON.parse(String(row.document)) : null;
  }

  /** Internal dispatcher only; callers must reauthorize the source before executing a job. */
  jobs(statuses: string[]): EvolutionRecord[] {
    return this.db.prepare("SELECT document FROM evolution_records WHERE kind='job' ORDER BY rowid").all()
      .map(row => JSON.parse(String(row.document)) as EvolutionRecord)
      .filter(record => record.origin === "runtime" && record.payload.job_type === "diagnosis" && statuses.includes(record.status));
  }

  /** A crash cannot leave an acknowledged completion without its durable dispatch receipt. */
  completeWithJob(input: NewRecord, key: string, actor: string, enqueue: (trace: EvolutionRecord) => EvolutionRecord): EvolutionRecord {
    return this.transaction(() => {
      const trace = this.append(input, key, actor);
      enqueue(trace);
      return trace;
    });
  }

  jobTransition(job: EvolutionRecord, status: string, evidence: Record<string, unknown> = {}): EvolutionRecord {
    return this.transaction(() => {
      if (job.kind !== "job" || !["diagnosis", "proposal", "proposal_model_step", "proposal_tool_event"].includes(String(job.payload.job_type))) throw new EvolutionError(409, "EXECUTION_JOB_REQUIRED");
      const result = this.transition(job.id, job.revision, [job.status], status, "evolution-dispatcher");
      this.event(job.id, "evolution-dispatcher", "JOB_EVIDENCE", evidence);
      return result;
    });
  }

  list(teamId: string, kind?: RecordKind): EvolutionRecord[] {
    const rows = kind
      ? this.db.prepare("SELECT document FROM evolution_records WHERE team_id=? AND kind=? ORDER BY rowid DESC").all(teamId, kind)
      : this.db.prepare("SELECT document FROM evolution_records WHERE team_id=? ORDER BY rowid DESC").all(teamId);
    return rows.map(row => JSON.parse(String(row.document)));
  }

  append(input: NewRecord, dedupeKey: string, actor: string): EvolutionRecord {
    input = JSON.parse(JSON.stringify(input)) as NewRecord;
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT document FROM evolution_records WHERE team_id=? AND kind=? AND dedupe_key=?")
        .get(input.team_id, input.kind, dedupeKey);
      const artifact_hash = contentHash(input);
      if (existing) {
        const record = JSON.parse(String(existing.document)) as EvolutionRecord;
        if (record.artifact_hash !== artifact_hash) throw new EvolutionError(409, "IDEMPOTENCY_CONFLICT");
        return record;
      }
      const now = new Date().toISOString();
      const record: EvolutionRecord = { ...input, id: `evo-${randomUUID()}`, artifact_hash, revision: 1, created_at: now, updated_at: now };
      this.db.prepare("INSERT INTO evolution_records VALUES (?,?,?,?,?)")
        .run(record.id, record.team_id, record.kind, dedupeKey, JSON.stringify(record));
      this.event(record.id, actor, "CREATED", { artifact_hash });
      return record;
    });
  }

  /** Frozen payloads are immutable. Only workflow status can transition, with a CAS. */
  transition(id: string, revision: number, allowedFrom: string[], status: string, actor: string): EvolutionRecord {
    return this.transaction(() => {
      const record = this.get(id);
      if (!record) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (record.origin === "historical") throw new EvolutionError(409, "HISTORICAL_RECORD_READ_ONLY");
      if (record.revision !== revision || !allowedFrom.includes(record.status)) throw new EvolutionError(409, "STATE_STALE");
      const updated = { ...record, status, revision: revision + 1, updated_at: new Date().toISOString() };
      this.db.prepare("UPDATE evolution_records SET document=? WHERE id=?").run(JSON.stringify(updated), id);
      this.event(id, actor, status, { from: record.status, revision: updated.revision });
      return updated;
    });
  }

  events(id: string): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT actor, action, document, created_at FROM evolution_events WHERE record_id=? ORDER BY seq").all(id)
      .map(row => ({ ...row, document: JSON.parse(String(row.document)) }));
  }

  review(id: string, revision: number, decision: string, reason: string, actor: string): EvolutionRecord {
    return this.transaction(() => {
      const updated = this.transition(id, revision, ["FROZEN", "VALIDATED", "NEEDS_EVIDENCE"], decision, actor);
      this.append({ team_id: updated.team_id, owner_user_id: updated.owner_user_id, agent_id: updated.agent_id,
        kind: "review", origin: "runtime", title: updated.title, status: decision, asset_ids: updated.asset_ids, parent_id: id,
        payload: { reason, candidate_hash: updated.artifact_hash, reviewer: actor },
      }, `${id}/${updated.revision}`, actor);
      return updated;
    });
  }

  /** Persist an immutable operation intent and lock the candidate in the same transaction. */
  beginApplication(id: string, revision: number, actor: string, evidence: Record<string, unknown>): EvolutionRecord {
    return this.transaction(() => {
      const candidate = this.get(id);
      if (!candidate || candidate.kind !== "candidate" || candidate.origin !== "runtime") throw new EvolutionError(409, "LIVE_CANDIDATE_REQUIRED");
      const previous = this.list(candidate.team_id, "adoption").find(record => record.parent_id === id);
      if (previous) return previous;
      this.transition(id, revision, ["REVIEW_APPROVED", "AUTO_AUTHORIZED"], "APPLYING", actor);
      return this.append({ team_id: candidate.team_id, owner_user_id: candidate.owner_user_id,
        agent_id: candidate.agent_id, kind: "adoption", title: candidate.title, origin: "runtime", status: "PREPARED",
        asset_ids: candidate.asset_ids, parent_id: id,
        payload: { candidate_hash: candidate.artifact_hash, candidate_payload: candidate.payload, evidence },
      }, `${id}/${candidate.artifact_hash}`, actor);
    });
  }

  finishApplication(operationId: string, revision: number, actor: string): EvolutionRecord {
    return this.transaction(() => {
      const operation = this.get(operationId);
      if (!operation || operation.kind !== "adoption" || !operation.parent_id) throw new EvolutionError(404, "APPLICATION_NOT_FOUND");
      const candidate = this.get(operation.parent_id);
      if (!candidate || candidate.artifact_hash !== operation.payload.candidate_hash) throw new EvolutionError(409, "APPLICATION_CANDIDATE_MISMATCH");
      const result = this.transition(operationId, revision, ["WRITING", "RECONCILE_REQUIRED"], "APPLIED", actor);
      this.transition(candidate.id, candidate.revision, ["APPLYING"], "APPLIED", actor);
      return result;
    });
  }

  private event(id: string, actor: string, action: string, payload: unknown): void {
    this.db.prepare("INSERT INTO evolution_events(record_id,actor,action,document,created_at) VALUES(?,?,?,?,?)")
      .run(id, actor, action, JSON.stringify(payload), new Date().toISOString());
  }

  profile(teamId: string, agentId: string): EvolutionProfile | null {
    const row = this.db.prepare("SELECT document FROM evolution_profiles WHERE team_id=? AND agent_id=?").get(teamId, agentId);
    return row ? JSON.parse(String(row.document)) : null;
  }

  profiles(teamId: string): EvolutionProfile[] {
    return this.db.prepare("SELECT document FROM evolution_profiles WHERE team_id=?").all(teamId).map(row => JSON.parse(String(row.document)));
  }

  /** Reserve output slots before generation; unknown/interrupted outcomes keep them charged. */
  allocateCandidateSlots(jobId: string, limit = 20): string {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new EvolutionError(400, "INVALID_CANDIDATE_LIMIT");
    return this.transaction(() => {
      const job = this.get(jobId);
      if (!job || job.kind !== "job" || job.origin !== "runtime" || job.payload.job_type !== "proposal" || job.status !== "RUNNING") throw new EvolutionError(409, "LIVE_PROPOSAL_JOB_REQUIRED");
      const profile = this.profile(job.team_id, job.agent_id);
      if (!profile?.enabled || !profile.daily_candidates) throw new EvolutionError(409, "AUTOMATION_NOT_ENABLED");
      const used = this.db.prepare("SELECT COALESCE(SUM(candidates),0) n FROM evolution_reservations WHERE team_id=? AND agent_id=? AND day=?")
        .get(job.team_id, job.agent_id, new Date().toISOString().slice(0, 10))!;
      const count = Math.min(limit, profile.daily_candidates - Number(used.n));
      if (count < 1) throw new EvolutionError(429, "EVOLUTION_CANDIDATE_BUDGET_EXHAUSTED");
      const id = `${jobId}/candidates`;
      this.reserve(id, job.team_id, job.agent_id, 0, 0, count);
      return id;
    });
  }

  assertCandidateAllocation(id: string, teamId: string, agentId: string, ownerId?: string): number {
    const job = id.endsWith("/candidates") ? this.get(id.slice(0, -"/candidates".length)) : null;
    if (!job || job.kind !== "job" || job.origin !== "runtime" || job.payload.job_type !== "proposal" || job.status !== "RUNNING"
      || job.team_id !== teamId || job.agent_id !== agentId || ownerId && job.owner_user_id !== ownerId) throw new EvolutionError(409, "LIVE_PROPOSAL_JOB_REQUIRED");
    const row = this.db.prepare("SELECT * FROM evolution_reservations WHERE id=?").get(id);
    if (!row || row.team_id !== teamId || row.agent_id !== agentId || row.tokens !== 0 || row.calls !== 0 || row.settled || Number(row.candidates) < 1) throw new EvolutionError(409, "CANDIDATE_ALLOCATION_NOT_OPEN");
    if (!this.profile(teamId, agentId)?.enabled) throw new EvolutionError(409, "AUTOMATION_NOT_ENABLED");
    return Number(row.candidates);
  }

  /** Freeze the complete batch and settle its output quota in one SQLite transaction. */
  commitCandidateBatch(allocationId: string, source: EvolutionRecord, entries: Array<{ input: NewRecord; key: string }>): EvolutionRecord[] {
    return this.transaction(() => {
      const limit = this.assertCandidateAllocation(allocationId, source.team_id, source.agent_id, source.owner_user_id);
      if (entries.length > limit) throw new EvolutionError(429, "CANDIDATE_BATCH_EXCEEDS_RESERVATION");
      if (entries.some(({ input }) => input.kind !== "candidate" || input.origin !== "runtime" || input.team_id !== source.team_id
        || input.agent_id !== source.agent_id || input.owner_user_id !== source.owner_user_id)) throw new EvolutionError(403, "CANDIDATE_ALLOCATION_SCOPE_MISMATCH");
      let created = 0;
      const records = entries.map(({ input, key }) => {
        if (!this.find(input.team_id, "candidate", key)) created++;
        return this.append(input, key, source.owner_user_id);
      });
      this.db.prepare("UPDATE evolution_reservations SET candidates=?, settled=1 WHERE id=?").run(created, allocationId);
      this.event(source.id, source.owner_user_id, "CANDIDATE_BATCH_FROZEN", { allocation_id: allocationId, candidate_ids: records.map(record => record.id), reserved: limit, created });
      return records;
    });
  }

  saveProfile(input: Omit<EvolutionProfile, "revision" | "updated_at">, expectedRevision: number): EvolutionProfile {
    return this.transaction(() => {
      const previous = this.profile(input.team_id, input.agent_id);
      if ((previous?.revision ?? 0) !== expectedRevision) throw new EvolutionError(409, "PROFILE_STALE");
      const profile = { ...input, revision: expectedRevision + 1, updated_at: new Date().toISOString() };
      this.db.prepare("INSERT INTO evolution_profiles VALUES(?,?,?) ON CONFLICT(team_id,agent_id) DO UPDATE SET document=excluded.document")
        .run(input.team_id, input.agent_id, JSON.stringify(profile));
      this.event(`${input.team_id}/${input.agent_id}`, input.authorized_by, "PROFILE_UPDATED", profile);
      return profile;
    });
  }

  /** Unknown usage leaves the full reservation charged; retries need independent reservations. */
  reserve(id: string, teamId: string, agentId: string, tokens: number, calls: number, candidates: number, day = new Date().toISOString().slice(0, 10)): void {
    if (![tokens, calls, candidates].every(value => Number.isSafeInteger(value) && value >= 0)) throw new EvolutionError(400, "INVALID_RESERVATION");
    this.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM evolution_reservations WHERE id=?").get(id);
      if (prior) {
        if (prior.team_id !== teamId || prior.agent_id !== agentId || prior.tokens !== tokens || prior.calls !== calls || prior.candidates !== candidates) throw new EvolutionError(409, "RESERVATION_CONFLICT");
        throw new EvolutionError(409, "RESERVATION_ALREADY_USED");
      }
      const profile = this.profile(teamId, agentId);
      if (!profile?.enabled || !profile.daily_tokens || !profile.daily_model_calls || !profile.daily_candidates) throw new EvolutionError(409, "AUTOMATION_NOT_ENABLED");
      const used = this.db.prepare("SELECT COALESCE(SUM(tokens),0) tokens, COALESCE(SUM(calls),0) calls, COALESCE(SUM(candidates),0) candidates FROM evolution_reservations WHERE team_id=? AND agent_id=? AND day=?")
        .get(teamId, agentId, day)!;
      if (Number(used.tokens) + tokens > profile.daily_tokens || Number(used.calls) + calls > profile.daily_model_calls || Number(used.candidates) + candidates > profile.daily_candidates) throw new EvolutionError(429, "EVOLUTION_BUDGET_EXHAUSTED");
      this.db.prepare("INSERT INTO evolution_reservations(id,team_id,agent_id,day,tokens,calls,candidates) VALUES(?,?,?,?,?,?,?)")
        .run(id, teamId, agentId, day, tokens, calls, candidates);
    });
  }

  settle(id: string, tokens: number | null, calls: number | null): void {
    if (tokens === null || calls === null) return;
    if (![tokens, calls].every(value => Number.isSafeInteger(value) && value >= 0)) throw new EvolutionError(400, "INVALID_USAGE");
    this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM evolution_reservations WHERE id=?").get(id);
      if (!row) throw new EvolutionError(404, "RESERVATION_NOT_FOUND");
      if (row.settled) throw new EvolutionError(409, "USAGE_ALREADY_SETTLED");
      // An upstream overrun is still billed; it must not disappear from the ledger.
      this.db.prepare("UPDATE evolution_reservations SET tokens=?,calls=?,settled=1 WHERE id=?").run(tokens, calls, id);
    });
  }
}
