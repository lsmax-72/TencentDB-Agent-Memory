import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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

  it("freezes an immutable suite and ships the grader beside the adapter", async () => {
    const { cases } = benchmarkCaseSet(spec);
    const suite = makeBenchmarkSuite("benchmark-code-v1", cases);
    expect(suite.suite_hash).toMatch(/^sha256:/);
    expect(suite.cases).toEqual([
      { id: "abc387_b", revision: "1", hash: cases[0].case_hash },
    ]);
    // Same suite content hashes identically; a changed gate policy does not.
    expect(makeBenchmarkSuite("benchmark-code-v1", cases).suite_hash).toBe(suite.suite_hash);
    expect(existsSync(defaultGraderScript())).toBe(true);
  });
});
