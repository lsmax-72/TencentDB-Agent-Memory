import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
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
  CaseLimits,
  EvaluationCase,
  EvaluationSkillArtifact,
  EvaluationSuite,
  GatePolicy,
  OracleAssertion,
  RunSpec,
} from "../contracts/types.js";
import { builtInCustomAssertions } from "../oracle/deterministic-oracle.js";
import type {
  FixtureAdapter,
  PreparedFixture,
  RunSpecFactory,
} from "../runner/minimal-runner.js";

export const BASELINE_SKILL = `---
name: workspace-operation
description: Complete small, scoped operations in the current workspace.
---

# Workspace Operation

1. Locate the file or state relevant to the request.
2. Make the requested change.
3. Keep the change focused and report completion.
`;

export const GOOD_CANDIDATE_SKILL = `---
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

export const ACCEPTANCE_GATE_POLICY: GatePolicy = {
  policy_revision: "gate-v1",
  min_newly_fixed: 1,
  max_newly_broken: 0,
  require_all_critical_candidate_pass: true,
  max_total_token_increase_ratio: 0.25,
  max_total_tool_call_increase: 5,
};

export const PHASE4_LIMITS: CaseLimits = {
  max_model_calls: 1,
  max_tool_calls: 8,
  max_input_tokens: 100,
  max_output_tokens: 100,
  max_total_tokens: 200,
  timeout_ms: 1_000,
};

/** Real agent loops need a model→tool→model cycle and network-scale timeout. */
export const PHASE5_REAL_LIMITS: CaseLimits = {
  max_model_calls: 8,
  max_tool_calls: 12,
  max_input_tokens: 40_000,
  max_output_tokens: 8_000,
  max_total_tokens: 48_000,
  timeout_ms: 180_000,
};

interface FixtureDefinition {
  files: Record<string, string>;
  commands?: PreparedFixture["commands"];
  schemas?: PreparedFixture["schemas"];
}

export interface AcceptanceCaseSet {
  cases: EvaluationCase[];
  fixtures: Record<string, FixtureDefinition>;
}

/** Same fixtures and Oracles as Phase 4; only the real-host operational limits change. */
export function acceptanceCaseSet(
  revision = "1",
  limits: CaseLimits = PHASE4_LIMITS,
): AcceptanceCaseSet {
  const custom = builtInCustomAssertions();
  const targetJson = `${JSON.stringify({ runtime: { timeout_ms: 1_000 }, nested: { keep: true } }, null, 2)}\n`;
  const decoyJson = `${JSON.stringify({ runtime: { timeout_ms: 1_000 }, decoy: true }, null, 2)}\n`;
  const configSchemaRef = {
    id: "ac01-config-schema",
    revision: "1",
    hash: sha256("ac01-config-schema@1"),
  };
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
              runtime: {
                type: "object",
                required: ["timeout_ms"],
                properties: { timeout_ms: { type: "integer" } },
              },
              nested: {
                type: "object",
                required: ["keep"],
                properties: { keep: { type: "boolean" } },
              },
            },
          },
        },
      },
      commands: {
        "assert-json-only-change-v1": async (context) => {
          const current = JSON.parse(
            await readFile(join(context.workspace_dir, "objects/a91.json"), "utf8"),
          );
          const pass = current.runtime.timeout_ms === 3_000
            && current.nested.keep === true
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
          const state = JSON.parse(
            await readFile(join(context.workspace_dir, ".task/state.json"), "utf8"),
          );
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
          const registry = JSON.parse(
            await readFile(join(context.workspace_dir, "registry.json"), "utf8"),
          );
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
      { id: "value", type: "json_value", path: "objects/a91.json", json_pointer: "/runtime/timeout_ms", operator: "equals", expected: 3_000 },
      { id: "only-change", type: "command_exit", command_ref: "assert-json-only-change-v1", expected: 0 },
      { id: "decoy", type: "file_content", path: "configs/service.json", match: "sha256", expected: sha256(decoyJson) },
    ], revision, limits),
    makeCase("AC-02", "Resolve release_notes and replace STATUS_PENDING with STATUS_READY only in that target.", false, fixtures, [
      { id: "target", type: "file_content", path: "docs/releases/current.md", match: "contains", expected: "STATUS_READY" },
      { id: "allowlist", type: "custom_assertion", assertion_ref: custom.workspace_diff_allowlist_v1.ref, config: { allowed_paths: ["docs/releases/current.md"] } },
      { id: "readme", type: "file_content", path: "README.md", match: "sha256", expected: sha256("STATUS_PENDING\n") },
      { id: "template", type: "file_content", path: "docs/releases/template.md", match: "sha256", expected: sha256("Template: STATUS_PENDING\n") },
    ], revision, limits),
    makeCase("AC-03", "Switch the service to safe mode and confirm the final state.", false, fixtures, [
      { id: "sequence", type: "custom_assertion", assertion_ref: custom.tool_event_sequence_v1.ref, config: { expected_names: ["state_read", "state_apply", "state_verify"] } },
      { id: "state", type: "json_value", path: ".task/state.json", json_pointer: "/mode", operator: "equals", expected: "safe" },
      { id: "revision", type: "command_exit", command_ref: "assert-revision-once-v1", expected: 0 },
    ], revision, limits),
    makeCase("AC-04", "Replace OPEN with DONE in notes/todo.txt and change no other file.", true, fixtures, [
      { id: "target", type: "file_content", path: "notes/todo.txt", match: "exact", expected: "DONE\n" },
      { id: "allowlist", type: "custom_assertion", assertion_ref: custom.workspace_diff_allowlist_v1.ref, config: { allowed_paths: ["notes/todo.txt"] } },
    ], revision, limits),
    makeCase("AC-05", "Rename old-name to new-name and update every registry reference.", false, fixtures, [
      { id: "new", type: "file_exists", path: "services/new-name.json", expected: true },
      { id: "old", type: "file_exists", path: "services/old-name.json", expected: false },
      { id: "registry", type: "json_value", path: "registry.json", json_pointer: "/service", operator: "equals", expected: "services/new-name.json" },
      { id: "integrity", type: "command_exit", command_ref: "assert-reference-integrity-v1", expected: 0 },
    ], revision, limits),
  ];
  return { cases, fixtures };
}

/** Recreates the same absolute workspace path from the frozen snapshot per arm. */
export class AcceptanceFixtureAdapter implements FixtureAdapter {
  private readonly instanceRoot = resolve(
    tmpdir(),
    `tencentdb-evolution-nanobot-${process.pid}-${randomUUID()}`,
  );

  constructor(private readonly definitions: Record<string, FixtureDefinition>) {}

  async prepare(input: {
    evaluation_case: EvaluationCase;
    arm: Arm;
    session_id: string;
  }): Promise<PreparedFixture> {
    const definition = this.definitions[input.evaluation_case.case_id];
    if (!definition) throw new Error(`missing fixture ${input.evaluation_case.case_id}`);
    const root = resolve(this.instanceRoot, input.evaluation_case.case_id, "workspace");
    assertInside(this.instanceRoot, root);
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    for (const [path, content] of Object.entries(definition.files)) {
      await writeWorkspaceFile(root, path, content);
    }
    const initial = await snapshot(root);
    return {
      workspace_dir: root,
      // nanobot owns these control-plane files; Oracle task diffs only cover the frozen fixture.
      changed_paths: async () => diffPaths(initial, await snapshot(root))
        .filter((path) => !path.startsWith(".nanobot/") && !path.startsWith("memory/")),
      commands: definition.commands ?? {},
      schemas: definition.schemas ?? {},
      dispose: async () => {
        assertInside(this.instanceRoot, root);
        await rm(root, { recursive: true, force: true });
      },
    };
  }
}

export function makeAcceptanceSuite(
  id: string,
  cases: EvaluationCase[],
  gatePolicy: GatePolicy = ACCEPTANCE_GATE_POLICY,
): EvaluationSuite {
  const withoutHash = {
    suite_id: id,
    revision: cases[0]?.revision ?? "1",
    target_skill_id: "skl-workspace",
    cases: cases.map(caseRef),
    gate_policy: gatePolicy,
  };
  return { ...withoutHash, suite_hash: computeSuiteHash(withoutHash) };
}

export function makeAcceptanceArtifact(
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

export function makeNanobotRunSpecFactory(input: {
  nanobot_revision: string;
  provider: string;
  model_id: string;
  tool_schema_hash: RunSpec["tools"]["schema_hash"];
}): RunSpecFactory {
  const shared = hashCanonical({
    nanobot_revision: input.nanobot_revision,
    provider: input.provider,
    model_id: input.model_id,
  });
  return {
    create({ evaluation_case, arm, artifact }): RunSpec {
      return {
        contract_revision: "run-spec-v1",
        arm,
        case_ref: caseRef(evaluation_case),
        agent: {
          adapter_id: "nanobot-python-sdk",
          code_revision: input.nanobot_revision,
          system_prompt_hash: hashCanonical({ nanobot_revision: input.nanobot_revision, prompt: "nanobot-default" }),
          harness_config_hash: shared,
        },
        model: {
          provider: input.provider,
          model_id: input.model_id,
          temperature: 0,
          top_p: 1,
          seed: "UNSUPPORTED",
          fallback: "DISABLED",
        },
        tools: {
          toolset_id: evaluation_case.case_id === "AC-03"
            ? "nanobot-workspace-plus-state-v1"
            : "nanobot-workspace-v1",
          schema_hash: input.tool_schema_hash,
          implementation_revision: input.nanobot_revision,
          permission_policy_hash: hashCanonical({ restrict_to_workspace: true }),
        },
        environment: {
          fixture_ref: evaluation_case.fixture,
          workspace_image_hash: evaluation_case.fixture.hash,
          isolation: "FRESH_COPY_PER_ARM",
          reset_revision: "nanobot-fixture-v1",
          sandbox_policy_hash: hashCanonical({ restrict_to_workspace: true }),
          network_policy_hash: hashCanonical({ provider_only: true }),
        },
        context: {
          policy_revision: "nanobot-runtime-context-v1",
          non_target_context_hash: shared,
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
}

function makeCase(
  caseId: string,
  taskInput: string,
  critical: boolean,
  fixtures: Record<string, FixtureDefinition>,
  assertions: OracleAssertion[],
  revision: string,
  limits: CaseLimits,
): EvaluationCase {
  const fixtureRef = {
    id: `${caseId}-fixture`,
    revision: "1",
    hash: hashCanonical(fixtures[caseId].files),
  };
  const oracleWithoutHash = { revision: "1", assertions };
  const oracle = { ...oracleWithoutHash, oracle_hash: computeOracleHash(oracleWithoutHash) };
  const withoutHash = {
    case_id: caseId,
    revision,
    title: caseId,
    goal: taskInput,
    task_input: taskInput,
    fixture: fixtureRef,
    oracle,
    limits: { ...limits },
    critical,
  };
  return { ...withoutHash, case_hash: computeCaseHash(withoutHash) };
}

function caseRef(evaluationCase: EvaluationCase) {
  return {
    id: evaluationCase.case_id,
    revision: evaluationCase.revision,
    hash: evaluationCase.case_hash,
  };
}

async function writeWorkspaceFile(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, path);
  assertInside(root, absolute);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function snapshot(root: string): Promise<Map<string, string>> {
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

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`fixture path escapes root: ${path}`);
  }
}

// Retained for deterministic test agents that need to exercise rename semantics.
export async function renameWorkspaceFile(root: string, from: string, to: string): Promise<void> {
  await rename(join(root, from), join(root, to));
}
