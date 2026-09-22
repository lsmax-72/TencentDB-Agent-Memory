import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillCore } from "../../core/skill/skill-core.js";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import { fileSkillEvaluationBindings } from "./skill-evaluation-executor.js";

const roots: string[] = [], stores: SqliteMetadataStore[] = [];
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  stores.splice(0).forEach(store => store.close());
});

const profile = {
  team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["skill" as const], asset_ids: [], daily_tokens: 1,
  daily_model_calls: 1, daily_candidates: 1, evaluation_profile_id: "inline-eval", auto_memory: false, auto_wiki_maintenance: false,
  authorized_by: "owner", revision: 1, updated_at: new Date().toISOString(),
};

function resolveInlineBinding(root: string, task: Record<string, unknown>) {
  const nanobotConfig = join(root, "nanobot.json"), profiles = join(root, "profiles.json"), tasksPath = join(root, "tasks.json");
  writeFileSync(nanobotConfig, "{}", { mode: 0o600 });
  writeFileSync(tasksPath, JSON.stringify({ revision: "inline-1", tasks: [task] }));
  writeFileSync(profiles, JSON.stringify([{ id: "inline-eval", instance_id: "instance", team_id: "team", agent_id: "agent",
    suite_kind: "BENCHMARK_CODE_V1", python_executable: process.execPath, nanobot_repo: resolve(process.cwd(), ".."),
    nanobot_config: nanobotConfig, model_preset: "offline", provider: "vllm", model_id: "offline-model",
    benchmark_tasks_path: tasksPath }]), { mode: 0o600 });
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  return fileSkillEvaluationBindings(profiles, "instance", metadata.getEvolutionStore(), {} as SkillCore)(profile);
}

describe("inline Skill evaluation binding", () => {
  it("accepts all-inline tasks without a pool or LiveCodeBench checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-inline-binding-")); roots.push(root);
    const testsPath = join(root, "tests.json");
    writeFileSync(testsPath, JSON.stringify([{ input: "x\n", output: "x\n" }]));
    expect(resolveInlineBinding(root, {
      task_id: "inline-task", title: "Inline", goal: "Return output", task_input: "Read and write.", tests_path: testsPath,
    })?.id).toBe("inline-eval");
  });

  it("refuses a task with no inline tests or external grader source", () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-missing-grader-")); roots.push(root);
    expect(() => resolveInlineBinding(root, {
      task_id: "ungraded-task", title: "Ungraded", goal: "Return output", task_input: "Read and write.",
    })).toThrow("BENCHMARK_TASK_GRADING_SOURCE_MISSING:ungraded-task");
  });
});
