import { afterEach, describe, expect, it } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { EvolutionService } from "./service.js";
import type { EvolutionRecord } from "./types.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

function setup() {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  metadata.createUser({ user_id: "owner", auth_provider: "local", external_id: "owner", username: "owner", default_key_value: "owner-key" });
  metadata.createUser({ user_id: "other", auth_provider: "local", external_id: "other", username: "other", default_key_value: "other-key" });
  metadata.createTeam({ team_id: "team", name: "Codex Observation", owner_user_id: "owner" });
  metadata.addTeamMember({ team_id: "team", user_id: "other", role: "admin" });
  metadata.createAgent({ agent_id: "codex", team_id: "team", owner_user_id: "owner", name: "Codex" });
  return new EvolutionService(metadata.getEvolutionStore(), metadata, { checkAssetPermission: async () => ({ allowed: true, reason: "test" }) });
}

const observation = {
  team_id: "team", agent_id: "codex", source: "codex", event_id: "event-1", session_id: "session-1", turn_id: "turn-1",
  terminal_event: "STOP", task_input: "Inspect api_key=top-secret-value", final_output: "Done with sk-proj-abcdefghijklmnop",
  tool_events: [{ tool_use_id: "tool-1", name: "Bash", arguments: "password=hunter2-secret", result: "exit 0", success: true, sequence: 0 }],
  usage: { input_tokens: null, output_tokens: null, model_calls: null, tool_calls: 1 },
  actual_model: "gpt-test", cwd: "/tmp/repo", permission_mode: "default",
} as const;

describe("Codex observation ingestion", () => {
  it("records an idempotent private turn without diagnosis or formal assets", async () => {
    const service = setup();
    const first = await service.invoke("observation/ingest", observation, "owner-key") as EvolutionRecord;
    const replay = await service.invoke("observation/ingest", observation, "owner-key");
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ status: "OBSERVED", origin: "runtime", asset_ids: [] });
    expect(first.payload).toMatchObject({ evidence_mode: "observation", completion: "codex_turn_stopped", source: "codex" });
    expect(JSON.stringify(first.payload)).not.toContain("top-secret-value");
    expect(JSON.stringify(first.payload)).not.toContain("hunter2-secret");
    expect(JSON.stringify(first.payload)).not.toContain("sk-proj-abcdefghijklmnop");
    expect(service.store.list("team", "job")).toEqual([]);
    await expect(service.invoke("diagnosis/request", { team_id: "team", id: first.id }, "owner-key"))
      .rejects.toThrow("HOST_TASK_COMPLETION_REQUIRED");
  });

  it("rejects changed replays and non-owner ingestion", async () => {
    const service = setup();
    await service.invoke("observation/ingest", observation, "owner-key");
    await expect(service.invoke("observation/ingest", { ...observation, final_output: "changed" }, "owner-key"))
      .rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(service.invoke("observation/ingest", { ...observation, event_id: "event-2" }, "other-key"))
      .rejects.toThrow("AGENT_OWNER_REQUIRED");
  });

  it("preserves interrupted turns as observations rather than task failures", async () => {
    const service = setup();
    const record = await service.invoke("observation/ingest", { ...observation, event_id: "event-2", terminal_event: "INTERRUPT" }, "owner-key") as EvolutionRecord;
    expect(record.status).toBe("INTERRUPTED");
    expect(record.payload.completion).toBe("codex_turn_interrupted");
    expect(service.store.list("team", "job")).toEqual([]);
  });
});
