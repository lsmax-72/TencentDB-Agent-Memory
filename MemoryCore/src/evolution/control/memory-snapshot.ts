import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { IMemoryStore, L1RecordRow } from "../../core/store/types.js";
import { buildProfileIsolationScope } from "../../core/profile/profile-sync.js";
import { StoragePaths } from "../../core/storage/types.js";
import { contentHash } from "./store.js";
import { EvolutionError } from "./types.js";

export interface MemoryTargetSnapshot {
  scope: { team_id: string; agent_id: string; user_id: string };
  records: L1RecordRow[];
  files: Array<{ key: string; content: string }>;
  hash: string;
}
export type SnapshotMemory = (scope: MemoryTargetSnapshot["scope"]) => Promise<MemoryTargetSnapshot>;

export function memorySnapshotHash(snapshot: Omit<MemoryTargetSnapshot, "hash">): string {
  return contentHash({ scope: snapshot.scope, records: [...snapshot.records].sort((a, b) => a.record_id.localeCompare(b.record_id)),
    files: [...snapshot.files].sort((a, b) => a.key.localeCompare(b.key)) });
}

/** Only the local standalone layout, with explicit scope. Never fallback to global or other users. */
export function localMemorySnapshot(dataRoot: string, resolveStore: () => Promise<Pick<IMemoryStore, "queryL1Records">>): SnapshotMemory {
  if (!isAbsolute(dataRoot)) throw new EvolutionError(500, "LOCAL_MEMORY_ROOT_REQUIRED");
  return async scope => {
    if (Object.values(scope).some(id => !/^[\w.:-]{1,180}$/.test(id) || ["default", "__legacy__"].includes(id))) throw new EvolutionError(400, "EXPLICIT_MEMORY_SCOPE_REQUIRED");
    const store = await resolveStore();
    const records = await store.queryL1Records({ teamId: scope.team_id, agentId: scope.agent_id, userId: scope.user_id });
    if (records.some(row => row.team_id !== scope.team_id || row.agent_id !== scope.agent_id || row.user_id !== scope.user_id)) throw new EvolutionError(403, "MEMORY_STORE_SCOPE_MISMATCH");
    if (records.length > 1000 || Buffer.byteLength(JSON.stringify(records)) > 2_000_000) throw new EvolutionError(413, "MEMORY_SNAPSHOT_TOO_LARGE");
    const files: MemoryTargetSnapshot["files"] = [];
    let bytes = 0;
    const stat = (path: string) => {
      try { const value = lstatSync(path); if (value.isSymbolicLink()) throw new EvolutionError(403, "MEMORY_SNAPSHOT_LINK_REJECTED"); return value; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    };
    if (!stat(dataRoot)?.isDirectory()) throw new EvolutionError(503, "MEMORY_STORAGE_UNAVAILABLE");
    const parents = [join(dataRoot, "profiles"), join(dataRoot, "profiles", encodeURIComponent(buildProfileIsolationScope({ teamId: scope.team_id, agentId: scope.agent_id })))];
    for (const parent of parents) { const value = stat(parent); if (value && !value.isDirectory()) throw new EvolutionError(403, "MEMORY_SNAPSHOT_SPECIAL_FILE"); }
    const root = parents[1];
    function visit(key: string): void {
      const path = join(root, key), value = stat(path);
      if (!value) return;
      if (value.isDirectory()) { for (const name of readdirSync(path).sort()) visit(`${key}/${name}`); return; }
      if (!value.isFile() || value.nlink !== 1) throw new EvolutionError(403, "MEMORY_SNAPSHOT_SPECIAL_FILE");
      // Index/checkpoint plus Markdown are sufficient for the existing L2/L3 algorithms.
      if (key.startsWith(StoragePaths.sceneBlocksDir) && !key.endsWith(".md")) return;
      bytes += value.size;
      if (bytes > 8_000_000 || files.length >= 500) throw new EvolutionError(413, "MEMORY_SNAPSHOT_TOO_LARGE");
      const buffer = readFileSync(path), content = buffer.toString("utf8");
      if (!Buffer.from(content).equals(buffer) || content.includes("\0")) throw new EvolutionError(400, "MEMORY_SNAPSHOT_INVALID_TEXT");
      files.push({ key, content });
    }
    const metadata = stat(join(root, ".metadata"));
    if (metadata && !metadata.isDirectory()) throw new EvolutionError(403, "MEMORY_SNAPSHOT_SPECIAL_FILE");
    for (const key of [StoragePaths.persona, StoragePaths.sceneIndex, StoragePaths.checkpoint, "scene_blocks"]) visit(key);
    const snapshot = { scope, records: JSON.parse(JSON.stringify(records)) as L1RecordRow[], files };
    return { ...snapshot, hash: memorySnapshotHash(snapshot) };
  };
}
