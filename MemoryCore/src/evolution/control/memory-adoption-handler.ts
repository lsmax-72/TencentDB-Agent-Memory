import { createHash } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import type { EmbeddingService } from "../../core/store/embedding.js";
import type { IMemoryStore, ProfileSyncRecord } from "../../core/store/types.js";
import type { MemoryRecord } from "../../core/record/l1-writer.js";
import { buildProfileIsolationScope, buildProfileStableId } from "../../core/profile/profile-sync.js";
import { stripSceneNavigation } from "../../core/scene/scene-navigation.js";
import { createScopedStorageAdapter, type StorageAdapter } from "../../core/storage/adapter.js";
import { StoragePaths } from "../../core/storage/types.js";
import type { FrozenAssetHandler, FrozenHandlerSnapshot } from "./governed-writer.js";
import { contentHash } from "./store.js";
import type { SnapshotMemory } from "./memory-snapshot.js";
import { EvolutionError, type CandidatePayload, type EvolutionRecord } from "./types.js";

const extractedMemory = z.object({
  content: z.string().min(1), type: z.enum(["persona", "episodic", "instruction", "work_fact", "work_task", "work_method", "work_artifact"]),
  priority: z.number().int().min(-1).max(100), source_message_ids: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.string(), z.unknown()), scene_name: z.string(),
}).strict();
const fileBundle = z.array(z.object({ key: z.string(), before: z.string(), after: z.string().min(1), base_hash: z.string().length(64) }).strict()).min(1).max(500);

export interface MemoryAdoptionTargets { store: IMemoryStore; storage: StorageAdapter; embedding?: EmbeddingService }
export interface MemoryAdoptionDependencies { snapshotMemory: SnapshotMemory; resolveTargets: () => Promise<MemoryAdoptionTargets> }
function md5(value: string): string { return createHash("md5").update(value).digest("hex"); }
function recordId(operationId: string): string { return `mem-evo-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`; }
function profileStorage(storage: StorageAdapter, candidate: EvolutionRecord): StorageAdapter {
  const scope = buildProfileIsolationScope({ teamId: candidate.team_id, agentId: candidate.agent_id });
  return createScopedStorageAdapter(storage, `profiles/${encodeURIComponent(scope)}/`);
}
function operationMarker(operation: EvolutionRecord, candidate: EvolutionRecord): string {
  return JSON.stringify({ operation_id: operation.id, candidate_id: candidate.id, candidate_hash: candidate.artifact_hash, status: "APPLIED" });
}

/** Exact frozen Memory publication. It performs no extraction, merge, deletion or model call. */
export class MemoryFrozenAssetHandler implements FrozenAssetHandler {
  constructor(private readonly deps: MemoryAdoptionDependencies) {}
  layers(payload: CandidatePayload) {
    if (!payload.layer) throw new EvolutionError(409, "MEMORY_LAYER_REQUIRED");
    return [payload.layer] as ReadonlyArray<"L1" | "L2" | "L3">;
  }
  private async current(candidate: EvolutionRecord, payload: CandidatePayload) {
    const scope = { team_id: candidate.team_id, agent_id: candidate.agent_id, user_id: candidate.owner_user_id };
    const snapshot = await this.deps.snapshotMemory(scope);
    if (payload.target_snapshot_hash !== snapshot.hash) throw new EvolutionError(409, "MEMORY_TARGET_SNAPSHOT_STALE");
    return snapshot;
  }
  async snapshot(candidate: EvolutionRecord, payload: CandidatePayload): Promise<FrozenHandlerSnapshot> {
    const current = await this.current(candidate, payload);
    if (payload.layer === "L1") return { base_hash: contentHash(""), base_version: null, details: { target_snapshot_hash: current.hash } };
    const files = fileBundle.parse(payload.memory_files), byKey = new Map(current.files.map(file => [file.key, file.content]));
    if (files.some(file => (byKey.get(file.key) ?? "") !== file.before || contentHash(file.before) !== file.base_hash)) throw new EvolutionError(409, "MEMORY_FILE_BASE_STALE");
    return { base_hash: contentHash(JSON.stringify(files.map(file => ({ key: file.key, content: file.before })))), base_version: null,
      details: { target_snapshot_hash: current.hash, file_count: files.length } };
  }
  async write(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void> {
    await this.current(candidate, payload);
    const targets = await this.deps.resolveTargets();
    if (payload.layer === "L1") return this.writeL1(targets, operation, candidate, payload);
    return this.writeHigher(targets, operation, candidate, payload);
  }
  private async writeL1(targets: MemoryAdoptionTargets, operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void> {
    const memory = extractedMemory.parse(payload.extracted_memory);
    if (memory.content !== payload.after || payload.before !== "" || payload.operation !== "create") throw new EvolutionError(409, "L1_FROZEN_CONTENT_MISMATCH");
    const id = recordId(operation.id), existing = await targets.store.queryL1Records({ recordIds: [id], teamId: candidate.team_id, agentId: candidate.agent_id, userId: candidate.owner_user_id });
    if (existing.length) throw new EvolutionError(409, "L1_APPLICATION_ALREADY_STARTED");
    const timestamp = operation.created_at;
    const record: MemoryRecord = { id, content: memory.content, type: memory.type, priority: memory.priority, scene_name: memory.scene_name,
      source_message_ids: memory.source_message_ids, metadata: { ...memory.metadata, evolution_operation_id: operation.id, candidate_hash: candidate.artifact_hash },
      timestamps: [timestamp], createdAt: timestamp, updatedAt: timestamp, version: 1,
      sessionKey: `evolution:${candidate.id}`, sessionId: operation.id, teamId: candidate.team_id, userId: candidate.owner_user_id, agentId: candidate.agent_id };
    const key = StoragePaths.record(timestamp.slice(0, 10));
    await targets.storage.appendFile(key, `${JSON.stringify(record)}\n`);
    const embedding = targets.embedding ? await targets.embedding.embed(record.content) : undefined;
    if (!await targets.store.upsertL1(record, embedding)) throw new EvolutionError(503, "L1_INDEX_WRITE_FAILED");
  }
  private async writeHigher(targets: MemoryAdoptionTargets, operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void> {
    const files = fileBundle.parse(payload.memory_files), storage = profileStorage(targets.storage, candidate);
    if (files.some(file => file.after.includes("\0") || file.after.trim() === "[DELETED]" || file.after === file.before)) throw new EvolutionError(409, "MEMORY_FROZEN_BUNDLE_INVALID");
    const profileInputs: ProfileSyncRecord[] = [];
    const scope = buildProfileIsolationScope({ teamId: candidate.team_id, agentId: candidate.agent_id });
    for (const file of files) {
      if ((await storage.readFile(file.key) ?? "") !== file.before) throw new EvolutionError(409, "MEMORY_FILE_BASE_STALE");
      await storage.writeFile(file.key, file.after);
      const isL2 = payload.layer === "L2" && file.key.startsWith(StoragePaths.sceneBlocksDir) && file.key.endsWith(".md");
      const isL3 = payload.layer === "L3" && file.key === StoragePaths.persona;
      if (!isL2 && !isL3) continue;
      const filename = isL2 ? basename(file.key) : StoragePaths.persona;
      const type = isL2 ? "l2" as const : "l3" as const, id = buildProfileStableId(scope, type, filename);
      const [existing] = targets.store.queryProfilesByIds ? await targets.store.queryProfilesByIds([id]) : [];
      const content = isL3 ? stripSceneNavigation(file.after).trim() : file.after;
      profileInputs.push({ id, type, filename, content, contentMd5: md5(content), teamId: candidate.team_id, agentId: candidate.agent_id,
        version: (existing?.version ?? 0) + 1, baselineVersion: existing?.version, createdAtMs: existing?.createdAtMs ?? Date.parse(operation.created_at), updatedAtMs: Date.parse(operation.created_at) });
    }
    if (profileInputs.length) {
      // Local standalone VectorStore has no separate profile collection; scoped files are its authoritative L2/L3 store.
      // Remote backends must expose both sides of the capability so publication can be read back.
      if (!!targets.store.syncProfiles !== !!targets.store.queryProfilesByIds) throw new EvolutionError(503, "PROFILE_INDEX_INCOMPLETE");
      if (targets.store.syncProfiles) await targets.store.syncProfiles(profileInputs);
    }
    await storage.writeFile(`.evolution-adoptions/${operation.id}.json`, operationMarker(operation, candidate));
  }
  async verify(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<boolean> {
    const targets = await this.deps.resolveTargets();
    if (payload.layer === "L1") {
      const id = recordId(operation.id), [row] = await targets.store.queryL1Records({ recordIds: [id], teamId: candidate.team_id, agentId: candidate.agent_id, userId: candidate.owner_user_id });
      if (!row || row.content !== payload.after) return false;
      try { const metadata = JSON.parse(row.metadata_json); if (metadata.evolution_operation_id !== operation.id || metadata.candidate_hash !== candidate.artifact_hash) return false; } catch { return false; }
      const names = await targets.storage.readdirNames(StoragePaths.recordsDir, ".jsonl");
      for (const name of names) {
        const raw = await targets.storage.readFile(`${StoragePaths.recordsDir}${name}`);
        if (raw?.split("\n").some(line => { try { const record = JSON.parse(line); return record.id === id && record.content === payload.after && record.metadata?.evolution_operation_id === operation.id; } catch { return false; } })) return true;
      }
      return false;
    }
    const files = fileBundle.parse(payload.memory_files), storage = profileStorage(targets.storage, candidate);
    for (const file of files) if (await storage.readFile(file.key) !== file.after) return false;
    if (await storage.readFile(`.evolution-adoptions/${operation.id}.json`) !== operationMarker(operation, candidate)) return false;
    const scope = buildProfileIsolationScope({ teamId: candidate.team_id, agentId: candidate.agent_id });
    for (const file of files) {
      const isL2 = payload.layer === "L2" && file.key.startsWith(StoragePaths.sceneBlocksDir) && file.key.endsWith(".md"), isL3 = payload.layer === "L3" && file.key === StoragePaths.persona;
      if (!isL2 && !isL3) continue;
      if (!targets.store.queryProfilesByIds) continue;
      const filename = isL2 ? basename(file.key) : StoragePaths.persona, type = isL2 ? "l2" as const : "l3" as const;
      const [row] = await targets.store.queryProfilesByIds([buildProfileStableId(scope, type, filename)]);
      const expected = isL3 ? stripSceneNavigation(file.after).trim() : file.after;
      if (!row || row.content !== expected || row.contentMd5 !== md5(expected)) return false;
    }
    return true;
  }
}
