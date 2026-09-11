import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { importHistoricalEvolutionRecords } from "./history.js";

// Operator-only file import; this entrypoint is deliberately not an HTTP action.
const config = z.object({
  database: z.string(), approved_root: z.string(), files: z.array(z.string()).min(1).max(100),
  scope: z.object({ team_id: z.string(), agent_id: z.string(), owner_user_id: z.string() }),
}).strict().parse(JSON.parse(readFileSync(process.argv[2], "utf8")));
if (!existsSync(config.database)) throw new Error("EXISTING_METADATA_DATABASE_REQUIRED");
const metadata = new SqliteMetadataStore(config.database);
metadata.init();
try {
  const { team_id, agent_id, owner_user_id } = config.scope;
  const member = metadata.getTeamMember(team_id, owner_user_id);
  const agent = metadata.getAgentById(agent_id);
  if (!member || member.status !== "active" || !agent || agent.team_id !== team_id || agent.owner_user_id !== owner_user_id) throw new Error("HISTORY_OWNER_SCOPE_REQUIRED");
  const records = config.files.flatMap(file => importHistoricalEvolutionRecords(metadata.getEvolutionStore(), file, config.approved_root, config.scope));
  process.stdout.write(JSON.stringify(records.map(({ id, status, artifact_hash }) => ({ id, status, artifact_hash }))));
} finally { metadata.close(); }
