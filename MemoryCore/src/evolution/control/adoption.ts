import type { EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionRecord } from "./types.js";

/** Registered only by the server. Neither the reviewer model nor the browser supplies a writer. */
export interface FrozenAssetWriter {
  supports?(kind: import("./types.js").AssetKind): boolean;
  /** The lock must also serialize the target's legacy mutation paths, not just adoption requests. */
  withTargetLock<T>(candidate: EvolutionRecord, run: () => Promise<T>): Promise<T>;
  /** Recheck current scope, grant, source versions, evaluation receipt, target version and hash. */
  authorizeAndPrepare(candidate: EvolutionRecord, actor: string): Promise<Record<string, unknown>>;
  /** Exactly frozen bytes; no generation. Persist operation ID with the write for recovery. */
  writeFrozen(operationId: string, candidate: EvolutionRecord): Promise<void>;
  /** Must confirm operation ownership, exact content, indexes AND formal asset registration. */
  verifyApplied(operationId: string, candidate: EvolutionRecord): Promise<boolean>;
}

/** A lost response never means "retry the write"; a separate reconciliation verifies its outcome. */
export async function applyFrozenCandidate(store: EvolutionStore, candidateId: string, revision: number, actor: string, writer: FrozenAssetWriter): Promise<EvolutionRecord> {
  const candidate = store.get(candidateId);
  if (!candidate || candidate.kind !== "candidate" || candidate.origin !== "runtime") throw new EvolutionError(409, "LIVE_CANDIDATE_REQUIRED");
  return writer.withTargetLock(candidate, async () => {
    const current = store.get(candidateId)!;
    const existing = store.list(current.team_id, "adoption").find(record => record.parent_id === current.id);
    if (existing) return existing;
    if (current.revision !== revision || !["REVIEW_APPROVED", "AUTO_AUTHORIZED"].includes(current.status)) throw new EvolutionError(409, "ADOPTION_NOT_AUTHORIZED");
    // The port resolves trusted validation/evaluation receipts; a status label alone is not proof.
    const evidence = await writer.authorizeAndPrepare(current, actor);
    let operation = store.beginApplication(candidateId, revision, actor, evidence);
    operation = store.transition(operation.id, operation.revision, ["PREPARED"], "WRITING", actor);
    try {
      await writer.writeFrozen(operation.id, current);
      if (!await writer.verifyApplied(operation.id, current)) throw new EvolutionError(503, "APPLICATION_READBACK_INCOMPLETE");
      return store.finishApplication(operation.id, operation.revision, actor);
    } catch (error) {
      store.transition(operation.id, operation.revision, ["WRITING"], "RECONCILE_REQUIRED", actor);
      throw error;
    }
  });
}

/** Read-only recovery: partial content/index writes stay blocked until the native writer repairs them. */
export async function reconcileApplication(store: EvolutionStore, operationId: string, actor: string, writer: FrozenAssetWriter): Promise<EvolutionRecord> {
  let operation = store.get(operationId);
  if (!operation || operation.kind !== "adoption" || !operation.parent_id) throw new EvolutionError(404, "APPLICATION_NOT_FOUND");
  const candidate = store.get(operation.parent_id);
  if (!candidate || candidate.artifact_hash !== operation.payload.candidate_hash) throw new EvolutionError(409, "APPLICATION_CANDIDATE_MISMATCH");
  return writer.withTargetLock(candidate, async () => {
    operation = store.get(operationId)!;
    if (operation.status === "APPLIED") return operation;
    if (!["WRITING", "RECONCILE_REQUIRED"].includes(operation.status)) throw new EvolutionError(409, "APPLICATION_NOT_RECONCILABLE");
    // No write method is reachable here; unknown outcomes cannot create duplicate versions.
    if (!await writer.verifyApplied(operation.id, candidate)) {
      if (operation.status === "WRITING") return store.transition(operation.id, operation.revision, ["WRITING"], "RECONCILE_REQUIRED", actor);
      return operation;
    }
    return store.finishApplication(operation.id, operation.revision, actor);
  });
}
