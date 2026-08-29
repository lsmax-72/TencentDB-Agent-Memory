import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeArtifactHashes,
  computeCaseHash,
  computeOracleHash,
  computeSuiteHash,
  hashCanonical,
  sha256,
} from "../contracts/hash.js";
import type {
  Arm,
  EvaluationCase,
  EvaluationSkillArtifact,
  EvaluationSuite,
  GatePolicy,
  OracleAssertion,
  RunSpec,
  ToolCallSummary,
} from "../contracts/types.js";
import { builtInCustomAssertions } from "../oracle/deterministic-oracle.js";
import {
  EvaluationExecutionError,
  MinimalEvaluationRunner,
  type AgentAdapter,
  type FixtureAdapter,
  type PreparedFixture,
  type RunSpecFactory,
} from "./minimal-runner.js";

const BASELINE_SKILL = `---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. Locate the file or state relevant to the request.
2. Make the requested change.
3. Keep the change focused and report completion.
`;

const GOOD_CANDIDATE_SKILL = `---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. Read \`.task/targets.json\` before resolving any logical target name.
2. Read the resolved target before modifying it; never edit a guessed or decoy path.
3. For JSON, use a structured JSON-path update, preserve all unrequested values, and parse the file again after writing.
4. Modify only the requested target. Check the workspace diff after the change.
5. For state operations, call \`state_read\`, then \`state_apply\` with the observed revision, then \`state_verify\`.
6. If a required target does not exist, stop and report failure.
`;

const REGRESSIVE_CANDIDATE_SKILL = `${GOOD_CANDIDATE_SKILL}\n7. Always edit \`notes/archive.txt\` instead of an explicitly requested notes path.\n`;
const H = hashCanonical("fixed-condition");
const CUSTOM = builtInCustomAssertions();
const POLICY: GatePolicy = {
  policy_revision: "gate-v1",
  min_newly_fixed: 1,
  max_newly_broken: 0,
  require_all_critical_candidate_pass: true,
  max_total_token_increase_ratio: 0.25,
  max_total_tool_call_increase: 5,
};

interface FixtureDefinition {
  files: Record<string, string>;
  commands?: PreparedFixture["commands"];
  schemas?: PreparedFixture["schemas"];
}

class AcceptanceFixtureAdapter implements FixtureAdapter {
  constructor(
    private readonly definitions: Record<string, FixtureDefinition>,
    private readonly failReset?: { case_id: string; arm: Arm },
  ) {}

  async prepare(input: {
    evaluation_case: EvaluationCase;
    arm: Arm;
  }): Promise<PreparedFixture> {
    if (this.failReset?.case_id === input.evaluation_case.case_id && this.failReset.arm === input.arm) {
      throw new EvaluationExecutionError("INFRA", "ENVIRONMENT_RESET_FAILED");
    }
    const definition = this.definitions[input.evaluation_case.case_id];
    if (!definition) throw new Error(`missing fixture ${input.evaluation_case.case_id}`);
    const root = await mkdtemp(join(tmpdir(), `evolution-${input.evaluation_case.case_id}-`));
    for (const [path, content] of Object.entries(definition.files)) {
      await writeWorkspaceFile(root, path, content);
    }
    const initial = await snapshot(root);
    return {
      workspace_dir: root,
      changed_paths: async () => diffPaths(initial, await snapshot(root)),
      commands: definition.commands ?? {},
      schemas: definition.schemas ?? {},
    };
  }
}

class DeterministicWorkspaceAgent implements AgentAdapter {
  readonly sessions: string[] = [];

  async run(input: Parameters<AgentAdapter["run"]>[0]) {
    this.sessions.push(input.session_id);
    const skill = input.skill_override;
    const task = input.evaluation_case.task_input;
    const events: ToolCallSummary[] = [];
    const emit = (name: string) => events.push(toolEvent(events.length + 1, name));

    if (task.includes("primary_config")) {
      let path = "configs/service.json";
      if (skill.includes("Read `.task/targets.json`")) {
        emit("file_read");
        const targets = JSON.parse(await readFile(join(input.workspace_dir, ".task/targets.json"), "utf8"));
        path = targets.primary_config;
      }
      emit("json_update");
      const absolute = join(input.workspace_dir, path);
      const value = JSON.parse(await readFile(absolute, "utf8"));
      value.runtime.timeout_ms = 3000;
      await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`);
      if (skill.includes("parse the file again after writing")) {
        emit("file_read");
        JSON.parse(await readFile(absolute, "utf8"));
      }
    } else if (task.includes("release_notes")) {
      if (skill.includes("Modify only the requested target")) {
        emit("file_read");
        const targets = JSON.parse(await readFile(join(input.workspace_dir, ".task/targets.json"), "utf8"));
        emit("text_update");
        const path = join(input.workspace_dir, targets.release_notes);
        await writeFile(path, (await readFile(path, "utf8")).replace("STATUS_PENDING", "STATUS_READY"));
        emit("workspace_diff");
      } else {
        for (const path of ["README.md", "docs/releases/current.md", "docs/releases/template.md"]) {
          emit("text_update");
          const absolute = join(input.workspace_dir, path);
          await writeFile(absolute, (await readFile(absolute, "utf8")).replace("STATUS_PENDING", "STATUS_READY"));
        }
      }
    } else if (task.includes("service") && task.includes("safe")) {
      const path = join(input.workspace_dir, ".task/state.json");
      const state = JSON.parse(await readFile(path, "utf8"));
      if (skill.includes("state_read")) emit("state_read");
      emit("state_apply");
      state.mode = "safe";
      state.revision += 1;
      await writeFile(path, JSON.stringify(state));
      if (skill.includes("state_verify")) emit("state_verify");
    } else if (task.includes("notes/todo.txt")) {
      emit("file_read");
      const target = skill.includes("Always edit `notes/archive.txt`")
        ? "notes/archive.txt"
        : "notes/todo.txt";
      emit("text_update");
      const absolute = join(input.workspace_dir, target);
      await writeFile(absolute, (await readFile(absolute, "utf8")).replace("OPEN", "DONE"));
    } else if (task.includes("old-name") && task.includes("new-name")) {
      emit("file_read");
      emit("file_rename");
      await rename(
        join(input.workspace_dir, "services/old-name.json"),
        join(input.workspace_dir, "services/new-name.json"),
      );
    }

    return {
      observed_model_id: input.run_spec.model.model_id,
      observed_conditions_hash: H,
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        model_call_count: 1,
        tool_call_count: events.length,
        tool_names: events.map((event) => event.name),
        elapsed_ms: 10,
      },
      tool_calls: events,
      output_evidence: [{ kind: "agent_output" as const, uri: `host://${input.session_id}` }],
      trace_refs: [{ provider: "HOST" as const, trace_id: input.session_id }],
    };
  }
}

const RUN_SPEC_FACTORY: RunSpecFactory = {
  create({ evaluation_case, arm, artifact }): RunSpec {
    return {
      contract_revision: "run-spec-v1",
      arm,
      case_ref: caseRef(evaluation_case),
      agent: {
        adapter_id: "deterministic-workspace-agent",
        code_revision: "acceptance-v1",
        system_prompt_hash: H,
        harness_config_hash: H,
      },
      model: {
        provider: "fixture",
        model_id: "deterministic-workspace-v1",
        temperature: 0,
        top_p: 1,
        seed: 1,
        fallback: "DISABLED",
      },
      tools: {
        toolset_id: "workspace-tools-v1",
        schema_hash: H,
        implementation_revision: "1",
        permission_policy_hash: H,
      },
      environment: {
        fixture_ref: evaluation_case.fixture,
        workspace_image_hash: evaluation_case.fixture.hash,
        isolation: "FRESH_COPY_PER_ARM",
        reset_revision: "1",
        sandbox_policy_hash: H,
        network_policy_hash: H,
      },
      context: {
        policy_revision: "evaluation-context-v1",
        non_target_context_hash: H,
        memory_mode: "DISABLED",
        normal_skill_injection: "DISABLED",
        automatic_skill_extraction: "DISABLED",
      },
      budget: evaluation_case.limits,
      retry_policy: { mode: "NONE" },
      skill_artifact: artifact,
    };
  },
};

describe("Phase 4 acceptance suite", () => {
  it("produces 3 fixed, 1 unchanged success, 1 unchanged failure, and Gate PASS", async () => {
    const { cases, fixtures } = acceptanceCases();
    const suite = makeSuite("acceptance-suite", cases, POLICY);
    const agent = new DeterministicWorkspaceAgent();
    const runner = runnerFor(fixtures, agent);
    const attempt = await runner.run({
      candidate_id: "candidate-good",
      suite,
      cases,
      baseline_artifact: artifact("OFFICIAL", "baseline", BASELINE_SKILL),
      candidate_artifact: artifact("CANDIDATE", "candidate-good", GOOD_CANDIDATE_SKILL),
    });

    expect(attempt.outcome).toBe("PASS");
    expect(attempt.result?.comparison_summary).toEqual({
      unchanged_success: ["AC-04"],
      newly_fixed: ["AC-01", "AC-02", "AC-03"],
      newly_broken: [],
      unchanged_failure: ["AC-05"],
      uncomparable: [],
    });
    expect(new Set(agent.sessions).size).toBe(10);
    for (const pair of attempt.paired_results) {
      expect(pair.fairness.status).toBe("MATCH");
      expect(pair.baseline.run_spec_fingerprints.execution_fingerprint)
        .toBe(pair.candidate.run_spec_fingerprints.execution_fingerprint);
      expect(pair.baseline.skill_artifact_hash).not.toBe(pair.candidate.skill_artifact_hash);
    }
  });

  it("detects the regression probe as newly_broken and Gate FAIL", async () => {
    const { cases, fixtures } = acceptanceCases();
    const regressionCase = cases.find((item) => item.case_id === "AC-04")!;
    const suite = makeSuite("regression-probe", [regressionCase], POLICY);
    const attempt = await runnerFor(fixtures, new DeterministicWorkspaceAgent()).run({
      candidate_id: "candidate-regressive",
      suite,
      cases: [regressionCase],
      baseline_artifact: artifact("OFFICIAL", "baseline", BASELINE_SKILL),
      candidate_artifact: artifact("CANDIDATE", "candidate-regressive", REGRESSIVE_CANDIDATE_SKILL),
    });

    expect(attempt.paired_results[0].classification).toBe("newly_broken");
    expect(attempt.outcome).toBe("FAIL");
    expect(attempt.result?.gate.reasons.map((reason) => reason.code)).toContain("NEW_REGRESSION");
  });

  it("keeps a reset failure uncomparable and returns Gate INFRA_ERROR", async () => {
    const { cases, fixtures } = acceptanceCases();
    const infraCase = cases.find((item) => item.case_id === "AC-04")!;
    const suite = makeSuite("infra-probe", [infraCase], POLICY);
    const agent = new DeterministicWorkspaceAgent();
    const runner = new MinimalEvaluationRunner({
      fixture: new AcceptanceFixtureAdapter(fixtures, { case_id: "AC-04", arm: "CANDIDATE" }),
      agent,
      runSpecFactory: RUN_SPEC_FACTORY,
    });
    const attempt = await runner.run({
      candidate_id: "candidate-good",
      suite,
      cases: [infraCase],
      baseline_artifact: artifact("OFFICIAL", "baseline", BASELINE_SKILL),
      candidate_artifact: artifact("CANDIDATE", "candidate-good", GOOD_CANDIDATE_SKILL),
    });

    expect(attempt.paired_results[0].classification).toBe("uncomparable");
    expect(attempt.paired_results[0].candidate.status).toBe("INFRA_ERROR");
    expect(attempt.paired_results[0].candidate.failure).toMatchObject({
      kind: "INFRA",
      codes: ["ENVIRONMENT_RESET_FAILED"],
    });
    expect(attempt.outcome).toBe("INFRA_ERROR");
  });

  it("turns a baseline artifact mismatch into Gate INFRA_ERROR", async () => {
    const { cases, fixtures } = acceptanceCases();
    const evaluationCase = cases.find((item) => item.case_id === "AC-04")!;
    const baseline = artifact("OFFICIAL", "baseline", BASELINE_SKILL);
    baseline.content_hash = sha256("tampered");
    const attempt = await runnerFor(fixtures, new DeterministicWorkspaceAgent()).run({
      candidate_id: "candidate-good",
      suite: makeSuite("artifact-probe", [evaluationCase], POLICY),
      cases: [evaluationCase],
      baseline_artifact: baseline,
      candidate_artifact: artifact("CANDIDATE", "candidate-good", GOOD_CANDIDATE_SKILL),
    });

    expect(attempt.outcome).toBe("INFRA_ERROR");
    expect(attempt.result?.gate.reasons.map((reason) => reason.code))
      .toContain("BASELINE_ARTIFACT_MISMATCH");
  });
});

function acceptanceCases(): {
  cases: EvaluationCase[];
  fixtures: Record<string, FixtureDefinition>;
} {
  const targetJson = `${JSON.stringify({ runtime: { timeout_ms: 1000 }, nested: { keep: true } }, null, 2)}\n`;
  const decoyJson = `${JSON.stringify({ runtime: { timeout_ms: 1000 }, decoy: true }, null, 2)}\n`;
  const configSchemaRef = { id: "ac01-config-schema", revision: "1", hash: sha256("ac01-config-schema@1") };
  const fixtures: Record<string, FixtureDefinition> = {
    "AC-01": {
      files: {
        ".task/targets.json": JSON.stringify({ primary_config: "objects/a91.json" }),
        "objects/a91.json": targetJson,
        "configs/service.json": decoyJson,
      },
      schemas: {
        "ac01-config-schema": {
          ref: configSchemaRef,
          schema: {
            type: "object",
            required: ["runtime", "nested"],
            properties: {
              runtime: { type: "object", required: ["timeout_ms"], properties: { timeout_ms: { type: "integer" } } },
              nested: { type: "object", required: ["keep"], properties: { keep: { type: "boolean" } } },
            },
          },
        },
      },
      commands: {
        "assert-json-only-change-v1": async (context) => {
          const current = JSON.parse(await readFile(join(context.workspace_dir, "objects/a91.json"), "utf8"));
          const pass = current.runtime.timeout_ms === 3000 && current.nested.keep === true
            && context.changed_paths.every((path) => path === "objects/a91.json");
          return { exit_code: pass ? 0 : 1, output: JSON.stringify({ changed: context.changed_paths }) };
        },
      },
    },
    "AC-02": {
      files: {
        ".task/targets.json": JSON.stringify({ release_notes: "docs/releases/current.md" }),
        "README.md": "STATUS_PENDING\n",
        "docs/releases/current.md": "Release: STATUS_PENDING\n",
        "docs/releases/template.md": "Template: STATUS_PENDING\n",
      },
    },
    "AC-03": {
      files: { ".task/state.json": JSON.stringify({ mode: "normal", revision: 7 }) },
      commands: {
        "assert-revision-once-v1": async (context) => {
          const state = JSON.parse(await readFile(join(context.workspace_dir, ".task/state.json"), "utf8"));
          return { exit_code: state.revision === 8 ? 0 : 1, output: JSON.stringify(state) };
        },
      },
    },
    "AC-04": {
      files: { "notes/todo.txt": "OPEN\n", "notes/archive.txt": "OPEN\n" },
    },
    "AC-05": {
      files: {
        "registry.json": JSON.stringify({ service: "services/old-name.json" }),
        "services/old-name.json": JSON.stringify({ name: "old-name" }),
      },
      commands: {
        "assert-reference-integrity-v1": async (context) => {
          const registry = JSON.parse(await readFile(join(context.workspace_dir, "registry.json"), "utf8"));
          return {
            exit_code: registry.service === "services/new-name.json" ? 0 : 1,
            output: JSON.stringify(registry),
          };
        },
      },
    },
  };

  const cases = [
    makeCase("AC-01", "Update primary_config /runtime/timeout_ms to 3000 and preserve everything else.", true, fixtures, [
      { id: "schema", type: "json_schema", path: "objects/a91.json", schema_ref: configSchemaRef },
      { id: "value", type: "json_value", path: "objects/a91.json", json_pointer: "/runtime/timeout_ms", operator: "equals", expected: 3000 },
      { id: "only-change", type: "command_exit", command_ref: "assert-json-only-change-v1", expected: 0 },
      { id: "decoy", type: "file_content", path: "configs/service.json", match: "sha256", expected: sha256(decoyJson) },
    ]),
    makeCase("AC-02", "Resolve release_notes and replace STATUS_PENDING with STATUS_READY only in that target.", false, fixtures, [
      { id: "target", type: "file_content", path: "docs/releases/current.md", match: "contains", expected: "STATUS_READY" },
      { id: "allowlist", type: "custom_assertion", assertion_ref: CUSTOM.workspace_diff_allowlist_v1.ref, config: { allowed_paths: ["docs/releases/current.md"] } },
      { id: "readme", type: "file_content", path: "README.md", match: "sha256", expected: sha256("STATUS_PENDING\n") },
      { id: "template", type: "file_content", path: "docs/releases/template.md", match: "sha256", expected: sha256("Template: STATUS_PENDING\n") },
    ]),
    makeCase("AC-03", "Switch the service to safe mode and confirm the final state.", false, fixtures, [
      { id: "sequence", type: "custom_assertion", assertion_ref: CUSTOM.tool_event_sequence_v1.ref, config: { expected_names: ["state_read", "state_apply", "state_verify"] } },
      { id: "state", type: "json_value", path: ".task/state.json", json_pointer: "/mode", operator: "equals", expected: "safe" },
      { id: "revision", type: "command_exit", command_ref: "assert-revision-once-v1", expected: 0 },
    ]),
    makeCase("AC-04", "Replace OPEN with DONE in notes/todo.txt and change no other file.", true, fixtures, [
      { id: "target", type: "file_content", path: "notes/todo.txt", match: "exact", expected: "DONE\n" },
      { id: "allowlist", type: "custom_assertion", assertion_ref: CUSTOM.workspace_diff_allowlist_v1.ref, config: { allowed_paths: ["notes/todo.txt"] } },
    ]),
    makeCase("AC-05", "Rename old-name to new-name and update every registry reference.", false, fixtures, [
      { id: "new", type: "file_exists", path: "services/new-name.json", expected: true },
      { id: "old", type: "file_exists", path: "services/old-name.json", expected: false },
      { id: "registry", type: "json_value", path: "registry.json", json_pointer: "/service", operator: "equals", expected: "services/new-name.json" },
      { id: "integrity", type: "command_exit", command_ref: "assert-reference-integrity-v1", expected: 0 },
    ]),
  ];
  return { cases, fixtures };
}

function makeCase(
  caseId: string,
  taskInput: string,
  critical: boolean,
  fixtures: Record<string, FixtureDefinition>,
  assertions: OracleAssertion[],
): EvaluationCase {
  const fixture = fixtures[caseId];
  const fixtureRef = { id: `${caseId}-fixture`, revision: "1", hash: hashCanonical(fixture.files) };
  const oracleWithoutHash = { revision: "1", assertions };
  const oracle = { ...oracleWithoutHash, oracle_hash: computeOracleHash(oracleWithoutHash) };
  const withoutHash = {
    case_id: caseId,
    revision: "1",
    title: caseId,
    goal: taskInput,
    task_input: taskInput,
    fixture: fixtureRef,
    oracle,
    limits: {
      max_model_calls: 1,
      max_tool_calls: 8,
      max_input_tokens: 100,
      max_output_tokens: 100,
      max_total_tokens: 200,
      timeout_ms: 1000,
    },
    critical,
  };
  return { ...withoutHash, case_hash: computeCaseHash(withoutHash) };
}

function makeSuite(id: string, cases: EvaluationCase[], gate_policy: GatePolicy): EvaluationSuite {
  const withoutHash = {
    suite_id: id,
    revision: "1",
    target_skill_id: "skl-workspace",
    cases: cases.map(caseRef),
    gate_policy,
  };
  return { ...withoutHash, suite_hash: computeSuiteHash(withoutHash) };
}

function artifact(
  source: "OFFICIAL" | "CANDIDATE",
  sourceRef: string,
  content: string,
): EvaluationSkillArtifact {
  const withoutHashes = {
    artifact_id: `${sourceRef}-artifact`,
    source,
    source_ref: sourceRef,
    skill_id: "skl-workspace",
    base_version: 3,
    format: "SKILL_MD_V1" as const,
    content,
    injection_contract_revision: "evaluation-skill-override-v1",
    read_only: true as const,
  };
  return { ...withoutHashes, ...computeArtifactHashes(withoutHashes) };
}

function runnerFor(fixtures: Record<string, FixtureDefinition>, agent: AgentAdapter) {
  return new MinimalEvaluationRunner({
    fixture: new AcceptanceFixtureAdapter(fixtures),
    agent,
    runSpecFactory: RUN_SPEC_FACTORY,
  });
}

function caseRef(evaluationCase: EvaluationCase) {
  return { id: evaluationCase.case_id, revision: evaluationCase.revision, hash: evaluationCase.case_hash };
}

function toolEvent(sequence: number, name: string): ToolCallSummary {
  return {
    sequence,
    name,
    outcome: "SUCCEEDED",
    event_ref: { kind: "tool_event", uri: `tool://${sequence}/${name}` },
  };
}

async function writeWorkspaceFile(root: string, path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const { readdir } = await import("node:fs/promises");
  const result = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.set(relative(root, path), sha256(await readFile(path)));
    }
  }
  await walk(root);
  return result;
}

function diffPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}
