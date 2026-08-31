import { extractL1Memories } from "../../core/record/l1-extractor.js";
import { SceneExtractor } from "../../core/scene/scene-extractor.js";
import { PersonaGenerator } from "../../core/persona/persona-generator.js";
import { StorageAdapter } from "../../core/storage/adapter.js";
import { StoragePaths } from "../../core/storage/types.js";
import type { LLMRunner } from "../../core/types.js";
import type { ConversationMessage } from "../../core/conversation/l0-recorder.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionRecord, type CandidatePayload } from "./types.js";
import { ShadowStorageBackend } from "./shadow-storage.js";
import { freezeCandidate, freezeCandidates } from "./proposals.js";

interface MemoryProposalInput {
  allocationId: string;
  store: EvolutionStore;
  source: EvolutionRecord;
  targetId: string;
  /** A server-resolved, already ACL-filtered snapshot of ONE memory asset. */
  snapshot: ReadonlyMap<string, Buffer>;
  /** Must reserve each actual model/tool step upstream; no default/fallback runner exists here. */
  runner: LLMRunner;
  snapshotRecord?: EvolutionRecord;
}
function snapshotEvidence(input: MemoryProposalInput) {
  return { source_record_ids: [input.source.id, ...(input.snapshotRecord ? [input.snapshotRecord.id] : [])],
    ...(input.snapshotRecord ? { target_snapshot_hash: input.snapshotRecord.payload.snapshot_hash, target_snapshot_id: input.snapshotRecord.id } : {}) };
}
function requireSource(source: EvolutionRecord): void {
  if (source.origin !== "runtime" || !["trace", "diagnosis"].includes(source.kind)) throw new EvolutionError(409, "LIVE_MEMORY_SOURCE_REQUIRED");
}

export async function proposeL1(input: MemoryProposalInput, messages: ConversationMessage[]): Promise<EvolutionRecord[]> {
  requireSource(input.source);
  input.store.assertCandidateAllocation(input.allocationId, input.source.team_id, input.source.agent_id);
  const payloads: CandidatePayload[] = [];
  const messageIds = new Set(messages.map(message => message.id));
  const result = await extractL1Memories({
    messages, sessionKey: input.source.id, baseDir: "evolution-shadow-only", config: {},
    options: { llmRunner: input.runner, enableDedup: false, proposalSink: async memories => {
      // Validate the entire batch before creating any immutable proposal.
      if (memories.some(memory => !memory.source_message_ids.length || memory.source_message_ids.some(id => !messageIds.has(id)))) throw new EvolutionError(400, "MEMORY_SOURCE_FABRICATED");
      for (const memory of memories) payloads.push({
        asset_kind: "memory", target_id: input.targetId, layer: "L1", operation: "create",
        base_hash: contentHash(""), base_version: null, before: "", after: memory.content,
        ...snapshotEvidence(input), extracted_memory: memory,
      });
    } },
  });
  if (!result.success) throw new EvolutionError(503, "MEMORY_EXTRACTION_FAILED");
  return freezeCandidates(input.store, input.source, payloads, input.allocationId);
}

/** Run the existing L2/L3 algorithms, including navigation/index post-processing, in shadow storage. */
export async function proposeHigherMemory(input: MemoryProposalInput, layer: "L2" | "L3", memories: Array<{ content: string; created_at: string; id?: string }> = []): Promise<EvolutionRecord | null> {
  requireSource(input.source);
  input.store.assertCandidateAllocation(input.allocationId, input.source.team_id, input.source.agent_id);
  const writable = (key: string) => key === StoragePaths.persona || key === StoragePaths.checkpoint
    || (layer === "L2" && (key === StoragePaths.sceneIndex || key.startsWith(StoragePaths.sceneBlocksDir)));
  const shadow = new ShadowStorageBackend(input.snapshot, writable);
  const storage = new StorageAdapter(shadow);
  const options = { dataDir: "evolution-shadow-only", config: {}, storage, llmRunner: input.runner };
  const success = layer === "L2"
    ? (await new SceneExtractor(options).extract(memories)).success
    : await new PersonaGenerator(options).generateLocalPersona("governed task completion");
  if (!success) throw new EvolutionError(503, "MEMORY_GENERATION_FAILED");
  const files = shadow.freeze();
  if (!files.length) { freezeCandidates(input.store, input.source, [], input.allocationId); return null; }
  if (files.some(file => file.after.trim() === "[DELETED]" || !file.after.trim())) throw new EvolutionError(409, "MEMORY_DESTRUCTIVE_PROPOSAL_REQUIRES_SEPARATE_REVIEW");
  // The bundle is one candidate: index and navigation changes cannot be adopted independently.
  const before = JSON.stringify(files.map(({ key, before }) => ({ key, content: before })));
  const after = JSON.stringify(files.map(({ key, after }) => ({ key, content: after })));
  return freezeCandidate(input.store, input.source, {
    asset_kind: "memory", target_id: input.targetId, layer, operation: "update",
    base_hash: contentHash(before), base_version: null, before, after,
    ...snapshotEvidence(input), memory_files: files,
    source_snapshot_hash: contentHash([...input.snapshot].map(([key, bytes]) => [key, bytes.toString("base64")]).sort()),
  }, input.allocationId);
}
