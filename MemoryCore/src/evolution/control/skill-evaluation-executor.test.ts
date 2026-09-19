import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillCore } from "../../core/skill/skill-core.js";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { fileSkillEvaluationBindings } from "./skill-evaluation-executor.js";

const roots: string[] = [], stores: SqliteMetadataStore[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); stores.splice(0).forEach(store => store.close()); });

describe("operator-owned Skill evaluation binding", () => {
  it("freezes a known suite and keeps private runtime paths out of serializable evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-eval-binding-")); roots.push(root);
    const nanobotConfig = join(root, "nanobot.json"), profiles = join(root, "profiles.json");
    writeFileSync(nanobotConfig, JSON.stringify({ api_key: "do-not-store" }), { mode: 0o600 });
    const row = { id: "eval", instance_id: "instance", team_id: "team", agent_id: "agent", suite_kind: "AC_REGRESSION_V1",
      python_executable: process.execPath, nanobot_repo: resolve(process.cwd(), ".."), nanobot_config: nanobotConfig,
      model_preset: "offline", provider: "vllm", model_id: "offline-model" };
    writeFileSync(profiles, JSON.stringify([row]), { mode: 0o600 });
    const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
    const resolveBinding = fileSkillEvaluationBindings(profiles, "instance", metadata.getEvolutionStore(), {} as SkillCore);
    const profile = { team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill" as const], asset_ids: [], daily_tokens: 1,
      daily_model_calls: 1, daily_candidates: 1, evaluation_profile_id: "eval", auto_memory: false, auto_wiki_maintenance: false,
      authorized_by: "owner", revision: 1, updated_at: new Date().toISOString() };
    const binding = resolveBinding(profile)!;
    expect(binding.id).toBe("eval"); expect(JSON.stringify(binding)).not.toContain(nanobotConfig); expect(JSON.stringify(binding)).not.toContain("do-not-store");
    expect(resolveBinding({ ...profile, team_id: "other" })).toBeNull();
    chmodSync(profiles, 0o644); expect(() => resolveBinding(profile)).toThrow("EVALUATION_BINDING_INVALID");
  });

  it("rejects an evaluation endpoint that would silently skip injection", () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-eval-endpoint-")); roots.push(root);
    const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
    const profile = { team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill" as const], asset_ids: [], daily_tokens: 1,
      daily_model_calls: 1, daily_candidates: 1, evaluation_profile_id: "eval", auto_memory: false, auto_wiki_maintenance: false,
      authorized_by: "owner", revision: 1, updated_at: new Date().toISOString() };

    // Build a binding whose sole difference is where the model endpoint points.
    const withEndpoint = (apiBase: string) => {
      const dir = mkdtempSync(join(root, "case-")); 
      const nanobotConfig = join(dir, "nanobot.json"), profiles = join(dir, "profiles.json");
      writeFileSync(nanobotConfig, JSON.stringify({ providers: { custom: { apiBase } } }), { mode: 0o600 });
      writeFileSync(profiles, JSON.stringify([{ id: "eval", instance_id: "instance", team_id: "team", agent_id: "agent",
        suite_kind: "AC_REGRESSION_V1", python_executable: process.execPath, nanobot_repo: resolve(process.cwd(), ".."),
        nanobot_config: nanobotConfig, model_preset: "offline", provider: "custom", model_id: "offline-model" }]), { mode: 0o600 });
      return fileSkillEvaluationBindings(profiles, "instance", metadata.getEvolutionStore(), {} as SkillCore)(profile);
    };

    // A space-scoped, non-dsh route is what the corrected integration uses.
    expect(withEndpoint("http://127.0.0.1:8096/hermes/default/v1")!.id).toBe("eval");
    // A remote upstream has no hooks to skip, so it is not our business.
    expect(withEndpoint("https://api.example.com/v1")!.id).toBe("eval");

    // /dsh/ is the route that classified every call as `auxiliary` and skipped
    // injection, which is what made the retired benchmark inject for itself.
    expect(() => withEndpoint("http://127.0.0.1:8096/dsh/default/v1"))
      .toThrow("EVALUATION_ENDPOINT_AUXILIARY_ROUTE");
    // Without a space the arms share the instance-wide default and contaminate.
    expect(() => withEndpoint("http://127.0.0.1:8096/v1"))
      .toThrow("EVALUATION_ENDPOINT_MISSING_SPACE");
  });
});
