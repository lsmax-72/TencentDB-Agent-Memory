import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluationCase } from "../contracts/types.js";
import {
  BenchmarkFixtureAdapter,
  benchmarkCaseSet,
  defaultGraderScript,
  makeBenchmarkSuite,
  type BenchmarkFixtureSpec,
} from "./benchmark-code-fixture.js";

// The grader shells out to the pinned interpreter and the frozen LiveCodeBench
// pool, so these are integration tests against the real scoring path rather than
// mocks. They are skipped where that environment is absent instead of being
// silently rewritten into something weaker.
const POOL = "/tmp/lcb14b/fullpool/test6.jsonl";
const PYTHON = "/Users/lsmax/Coder/EvoAgentBench/.venv-tdai/bin/python";
const LCB_REPO = "/Users/lsmax/Coder/LiveCodeBench";
const available = existsSync(POOL) && existsSync(PYTHON) && existsSync(LCB_REPO);
const INLINE_PYTHON = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();

const spec: BenchmarkFixtureSpec = {
  revision: "1",
  pool_path: POOL,
  python_executable: PYTHON,
  solution_path: "solution.py",
  lcb_repo: LCB_REPO,
  default_limits: {
    max_model_calls: 24, max_tool_calls: 40, max_input_tokens: 32_000,
    max_output_tokens: 8_192, max_total_tokens: 48_000, timeout_ms: 600_000,
  },
  tasks: [{
    task_id: "abc387_b",
    title: "9x9 Sum",
    goal: "Sum the 81 multiplication-table entries that are not X.",
    task_input: "Write solution.py reading X and printing the sum.",
    critical: true,
  }],
};

const GOLD = `X = int(input())
total = 0
for i in range(1, 10):
    for j in range(1, 10):
        if i * j != X:
            total += i * j
print(total)
`;

const inlineSpec = (testsPath: string): BenchmarkFixtureSpec => ({
  revision: "inline-1",
  python_executable: INLINE_PYTHON,
  solution_path: "solution.py",
  default_limits: spec.default_limits,
  tasks: [{
    task_id: "inline-task",
    title: "Inline task",
    goal: "Produce the expected output.",
    task_input: "Read standard input and write the result.",
    tests_path: testsPath,
  }],
});

describe("benchmark fixture inline tests", () => {
  it("accepts a correct solution and rejects a wrong one", async () => {
    const root = await mkdtemp(join(tmpdir(), "benchmark-inline-"));
    const testsPath = join(root, "tests.json");
    await writeFile(testsPath, JSON.stringify([
      { input: "alpha\n", output: "ALPHA\n" },
      { input: "beta\n", output: "BETA\n" },
    ]), "utf8");
    const inline = inlineSpec(testsPath);
    const evaluationCase = benchmarkCaseSet(inline).cases[0];
    const adapter = new BenchmarkFixtureAdapter(inline);
    const prepared = await adapter.prepare({ evaluation_case: evaluationCase, arm: "BASELINE", session_id: "inline" });
    const solution = join(prepared.workspace_dir, inline.solution_path);
    const context = { workspace_dir: prepared.workspace_dir, changed_paths: [], tool_calls: [],
      commands: prepared.commands, schemas: prepared.schemas };
    try {
      await writeFile(solution, "print(input().upper())\n", "utf8");
      const passed = await prepared.commands.grade(context);
      expect(passed.exit_code).toBe(0);
      expect(JSON.parse(passed.output)).toEqual({ passed: 2, total: 2, failed_cases: [] });

      await writeFile(solution, "print('wrong')\n", "utf8");
      const failed = await prepared.commands.grade(context);
      expect(failed.exit_code).toBe(1);
      expect(JSON.parse(failed.output)).toEqual({ passed: 0, total: 2, failed_cases: [0, 1] });
    } finally {
      await prepared.dispose?.();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns a missing tests file into an infrastructure error", async () => {
    const root = await mkdtemp(join(tmpdir(), "benchmark-inline-missing-"));
    const inline = inlineSpec(join(root, "missing.json"));
    const evaluationCase = benchmarkCaseSet(inline).cases[0];
    const adapter = new BenchmarkFixtureAdapter(inline);
    const prepared = await adapter.prepare({ evaluation_case: evaluationCase, arm: "BASELINE", session_id: "missing" });
    const context = { workspace_dir: prepared.workspace_dir, changed_paths: [], tool_calls: [],
      commands: prepared.commands, schemas: prepared.schemas };
    try {
      await writeFile(join(prepared.workspace_dir, inline.solution_path), "print(input())\n", "utf8");
      await expect(prepared.commands.grade(context)).rejects.toMatchObject({
        kind: "INFRA",
        code: "ORACLE_EXECUTION_ERROR",
      });
    } finally {
      await prepared.dispose?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!available)("benchmark fixture adapter", () => {
  it("grades through the real oracle: gold passes, empty and missing fail", async () => {
    const { cases } = benchmarkCaseSet(spec);
    expect(cases).toHaveLength(1);
    const evaluationCase: EvaluationCase = cases[0];
    expect(evaluationCase.oracle.assertions).toEqual([
      { id: "abc387_b-grade", type: "command_exit", command_ref: "grade", expected: 0 },
    ]);

    const adapter = new BenchmarkFixtureAdapter(spec);
    const prepared = await adapter.prepare({ evaluation_case: evaluationCase, arm: "BASELINE", session_id: "s1" });
    const solution = join(prepared.workspace_dir, spec.solution_path);
    const context = {
      workspace_dir: prepared.workspace_dir, changed_paths: [], tool_calls: [],
      commands: prepared.commands, schemas: prepared.schemas,
    };

    // No submission yet: a graded failure, and the task statement is present.
    expect(await readFile(join(prepared.workspace_dir, "problem.md"), "utf8")).toContain("9x9 Sum");
    expect((await prepared.commands.grade(context)).exit_code).toBe(1);

    // An unrunnable submission must not read as success.
    await writeFile(solution, "", "utf8");
    expect((await prepared.commands.grade(context)).exit_code).toBe(1);

    // A known-correct submission must pass; this is the assertion that makes the
    // instrument trustworthy, and the one both retired benchmarks lacked.
    await writeFile(solution, GOLD, "utf8");
    const graded = await prepared.commands.grade(context);
    expect(graded.exit_code).toBe(0);
    expect(graded.output).toContain('"total": 43');

    await prepared.dispose?.();
  });
});

describe.skipIf(!existsSync(PYTHON))("benchmark fixture instrument failures", () => {
  it("reports an unusable grader as INFRA, never as a task failure", async () => {
    const { cases } = benchmarkCaseSet(spec);
    const evaluationCase: EvaluationCase = cases[0];
    // A grader that cannot run must not be recorded as a candidate that did not
    // help: exit 2 is the fixture's instrument-failure signal.
    const stub = join(tmpdir(), `grader-stub-${process.pid}.py`);
    await writeFile(stub, 'import sys\nprint("GRADER_UNAVAILABLE:no lcb_runner")\nsys.exit(2)\n', "utf8");
    const broken = new BenchmarkFixtureAdapter(spec, stub);
    const prepared = await broken.prepare({ evaluation_case: evaluationCase, arm: "BASELINE", session_id: "s2" });
    await writeFile(join(prepared.workspace_dir, spec.solution_path), GOLD, "utf8");
    const context = {
      workspace_dir: prepared.workspace_dir, changed_paths: [], tool_calls: [],
      commands: prepared.commands, schemas: prepared.schemas,
    };
    await expect(prepared.commands.grade(context)).rejects.toMatchObject({
      kind: "INFRA",
      code: "ORACLE_EXECUTION_ERROR",
    });
    await prepared.dispose?.();
    await rm(stub, { force: true });
  });
});

describe.skipIf(!available)("benchmark suite identity", () => {
  it("freezes an immutable suite and ships the grader beside the adapter", async () => {
    const { cases } = benchmarkCaseSet(spec);
    const suite = makeBenchmarkSuite("benchmark-code-v1", cases, "skl-test-target");
    expect(suite.suite_hash).toMatch(/^sha256:/);
    expect(suite.cases).toEqual([
      { id: "abc387_b", revision: "1", hash: cases[0].case_hash },
    ]);
    // Same suite content hashes identically. `suite_hash` covers cases and gate
    // policy only; the measured skill travels in `target_skill_id` and the
    // attempt's baseline/candidate artifact hashes carry the skill provenance.
    expect(makeBenchmarkSuite("benchmark-code-v1", cases, "skl-test-target").suite_hash).toBe(suite.suite_hash);
    expect(suite.target_skill_id).toBe("skl-test-target");
    expect(existsSync(defaultGraderScript())).toBe(true);
  });
});
