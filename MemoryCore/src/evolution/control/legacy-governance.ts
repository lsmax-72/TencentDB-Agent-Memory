import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { MetadataStoreConfig } from "../../metadata/store/factory.js";
import { DEFAULT_METADATA_DB_PREFIX } from "../../metadata/store/db-name.js";
import { GovernedMutationError, type LegacyMutationGuard } from "../../core/legacy-mutation-guard.js";

const identity = z.string().min(1);
const guardProfile = z.object({ team_id: identity, agent_id: identity, enabled: z.boolean() });

/**
 * Standalone pipelines lack a reliable Hub instance ID. Read the local metadata
 * catalog, not `default`, and deny any matching governed scope. This is only a
 * write barrier: it never selects a grant or copies evidence across instances.
 * Read-only handles avoid schema creation and the metadata pool's LRU lifetime.
 */
export function localLegacyMutationGuard(config: MetadataStoreConfig): LegacyMutationGuard {
  if (config.backend !== "sqlite" || !config.sqliteBaseDir) throw new Error("LOCAL_GOVERNANCE_REQUIRES_SQLITE");
  const base = config.sqliteBaseDir;
  const prefix = `${config.mongoDbPrefix?.trim() || DEFAULT_METADATA_DB_PREFIX}_`;
  return async scope => {
    const known = (value?: string) => value && !["default", "__legacy__"].includes(value) ? value : undefined;
    const teamId = known(scope.teamId), agentId = known(scope.agentId);
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) continue;
      // A linked or corrupt catalog is not evidence that governance is disabled.
      if (entry.isSymbolicLink()) throw new Error("GOVERNANCE_CATALOG_LINK_REJECTED");
      if (!entry.isDirectory()) continue;
      const path = join(base, entry.name, "metadata.db");
      let stat;
      try { stat = lstatSync(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("GOVERNANCE_CATALOG_FILE_REJECTED");
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_profiles'").get()) continue;
        for (const row of db.prepare("SELECT document FROM evolution_profiles").all()) {
          const profile = guardProfile.parse(JSON.parse(String(row.document)));
          // Missing scope cannot be used to bypass a known grant. Fully scoped,
          // non-governed Agents retain their original behavior.
          if (profile.enabled && (!teamId || teamId === profile.team_id)
            && (!agentId || agentId === profile.agent_id)) throw new GovernedMutationError();
        }
      } finally { db.close(); }
    }
  };
}
