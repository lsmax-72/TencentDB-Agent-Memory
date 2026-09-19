import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCaseHash, computeOracleHash, computeSuiteHash, sha256 } from "../contracts/hash.js";
import type {
  Arm,
  CaseLimits,
  EvaluationCase,
  EvaluationSuite,
  GatePolicy,
  OracleAssertion,
  OracleSpec,
} from "../contracts/types.js";
import type { FixtureAdapter, PreparedFixture } from "../runner/minimal-runner.js";
import { EvaluationExecutionError } from "../runner/minimal-runner.js";

/** The grader's "instrument could not run" exit code; see benchmark_code_grader.py. */
const GRADER_UNAVAILABLE = 2;

/**
 * Benchmark fixture adapter: the *only* part of the retired EvoAgentBench stack
 * that was ever this project's own.
 *
 * The old `scripts/evoagentbench/` shipped a driver, a proxy bridge, a CLI shim
 * and a hand-rolled memory layer, all of which duplicated product capability and
 * made the benchmark measure its own implementation. What is genuinely not in
 * the product is the ability to point the evaluation runner at an external task
 * suite and grade it. That is exactly this file plus `benchmark_code_grader.py`.
 *
 * Everything else is reused: `MinimalEvaluationRunner` runs the suite,
 * `NanobotAgentAdapter` drives the agent, and `persistSkillEvaluation` writes the
 * attempt. The task list is data, so adding a benchmark task is a spec change,
 * not a code change.
 */

export interface BenchmarkTaskSpec {
  task_id: string;
  title: string;
  goal: string;
  task_input: string;
  /** Per-task overrides; the spec default is used otherwise. */
  limits?: Partial<CaseLimits>;
  critical?: boolean;
}

export interface BenchmarkFixtureSpec {
  revision: string;
  /** Frozen pool the grader reads (one JSON object per line). */
  pool_path: string;
  /** Pinned interpreter that owns the benchmark dependencies. */
  python_executable: string;
  /** Where the agent is asked to leave its program, relative to the workspace. */
  solution_path: string;
  /** Checkout that provides `lcb_runner` to the grader. */
  lcb_repo: string;
  default_limits: CaseLimits;
  tasks: BenchmarkTaskSpec[];
}

export const BENCHMARK_GATE_POLICY: GatePolicy = {
  policy_revision: "gate-v1",
  min_newly_fixed: 1,
  max_newly_broken: 0,
  require_all_critical_candidate_pass: true,
  max_total_token_increase_ratio: 0.25,
  max_total_tool_call_increase: 5,
};

/** Default to the grader shipped beside this adapter, so the two cannot drift. */
export function defaultGraderScript(): string {
  return fileURLToPath(new URL("./benchmark_code_grader.py", import.meta.url));
}

function assertInside(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes fixture root: ${candidate}`);
  }
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(relative(root, full), sha256(await readFile(full)));
    }
  };
  await walk(root);
  return files;
}

export class BenchmarkFixtureAdapter implements FixtureAdapter {
  private readonly instanceRoot = resolve(
    tmpdir(),
    `tencentdb-evolution-benchmark-${process.pid}-${randomUUID()}`,
  );

  constructor(
    private readonly spec: BenchmarkFixtureSpec,
    private readonly graderScript: string = defaultGraderScript(),
  ) {
    if (!spec.tasks.length) throw new Error("benchmark fixture spec has no tasks");
    if (!spec.pool_path || !spec.python_executable) throw new Error("benchmark fixture spec is incomplete");
  }

  async prepare(input: {
    evaluation_case: EvaluationCase;
    arm: Arm;
    session_id: string;
  }): Promise<PreparedFixture> {
    const task = this.spec.tasks.find((item) => item.task_id === input.evaluation_case.case_id);
    if (!task) throw new Error(`missing benchmark task ${input.evaluation_case.case_id}`);
    const root = resolve(this.instanceRoot, input.evaluation_case.case_id, input.arm, input.session_id);
    assertInside(this.instanceRoot, root);
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "problem.md"), `${task.title}\n\n${task.task_input}\n`, "utf8");
    const initial = await snapshot(root);

    return {
      workspace_dir: root,
      // nanobot owns its own control-plane files; only the agent's artifacts
      // should count as task changes.
      changed_paths: async () => {
        const now = await snapshot(root);
        const changed = new Set<string>();
        for (const [path, hash] of now) if (initial.get(path) !== hash) changed.add(path);
        for (const path of initial.keys()) if (!now.has(path)) changed.add(path);
        return [...changed].filter((path) => !path.startsWith(".nanobot/") && !path.startsWith("memory/"));
      },
      schemas: {},
      commands: {
        grade: async (context) => {
          const solution = join(context.workspace_dir, this.spec.solution_path);
          const exists = await stat(solution).then(() => true).catch(() => false);
          if (!exists) {
            // A missing submission is a graded failure, never an infra pass.
            return { exit_code: 1, output: JSON.stringify({ error: "SOLUTION_MISSING", path: this.spec.solution_path }) };
          }
          const graded = await this.runGrader(task.task_id, context.workspace_dir);
          // Exit 2 is the grader's "I could not run" code. Letting it fall through
          // as an ordinary non-zero exit would record a broken instrument as a
          // task failure, which is indistinguishable from a null effect -- the
          // exact confusion that made an earlier round unreadable.
          if (graded.exit_code === GRADER_UNAVAILABLE) {
            throw new EvaluationExecutionError("INFRA", "ORACLE_EXECUTION_ERROR", graded.output.slice(0, 500));
          }
          return graded;
        },
      },
      dispose: async () => {
        assertInside(this.instanceRoot, root);
        await rm(root, { recursive: true, force: true });
      },
    };
  }

  private runGrader(taskId: string, workspace: string): Promise<{ exit_code: number; output: string }> {
    return new Promise((resolveRun) => {
      const child = spawn(this.spec.python_executable, [
        this.graderScript,
        "--pool", this.spec.pool_path,
        "--task", taskId,
        "--solution", join(workspace, this.spec.solution_path),
        "--lcb-repo", this.spec.lcb_repo,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.on("error", (error) => resolveRun({ exit_code: 1, output: `GRADER_SPAWN_FAILED:${error.message}` }));
      child.on("close", (code) => resolveRun({ exit_code: code ?? 1, output: output.slice(-4000) }));
    });
  }
}

export interface BenchmarkCaseSet {
  cases: EvaluationCase[];
  spec: BenchmarkFixtureSpec;
}

/** Build immutable cases from the spec. The Oracle is one command assertion. */
export function benchmarkCaseSet(spec: BenchmarkFixtureSpec): BenchmarkCaseSet {
  const cases = spec.tasks.map((task) => {
    const limits: CaseLimits = { ...spec.default_limits, ...task.limits };
    const assertions: OracleAssertion[] = [
      { id: `${task.task_id}-grade`, type: "command_exit", command_ref: "grade", expected: 0 },
    ];
    const oracleWithoutHash = { revision: spec.revision, assertions };
    const oracle: OracleSpec = { ...oracleWithoutHash, oracle_hash: computeOracleHash(oracleWithoutHash) };
    const withoutHash = {
      case_id: task.task_id,
      revision: spec.revision,
      title: task.title,
      goal: task.goal,
      task_input: task.task_input,
      fixture: { id: `${task.task_id}-fixture`, revision: spec.revision, hash: sha256(`benchmark-fixture:${task.task_id}@${spec.revision}`) },
      oracle,
      limits,
      critical: task.critical ?? false,
    };
    return { ...withoutHash, case_hash: computeCaseHash(withoutHash) };
  });
  return { cases, spec };
}

export function makeBenchmarkSuite(
  id: string,
  cases: EvaluationCase[],
  targetSkillId: string,
  gatePolicy: GatePolicy = BENCHMARK_GATE_POLICY,
): EvaluationSuite {
  const withoutHash = {
    suite_id: id,
    revision: cases[0]?.revision ?? "1",
    // The skill the suite measures. It used to be the literal "skl-workspace"
    // placeholder, which made every suite claim to measure a skill that does not
    // exist; the candidate's own skill is the only correct value.
    target_skill_id: targetSkillId,
    cases: cases.map((evaluationCase) => ({
      id: evaluationCase.case_id,
      revision: evaluationCase.revision,
      hash: evaluationCase.case_hash,
    })),
    gate_policy: gatePolicy,
  };
  return { ...withoutHash, suite_hash: computeSuiteHash(withoutHash) };
}
