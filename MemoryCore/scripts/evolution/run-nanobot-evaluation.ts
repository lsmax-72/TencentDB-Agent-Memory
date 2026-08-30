import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { NanobotAgentAdapter } from "../../src/evolution/evaluation/adapters/nanobot-agent-adapter.js";
import { hashCanonical } from "../../src/evolution/evaluation/contracts/hash.js";
import {
  AcceptanceFixtureAdapter,
  BASELINE_SKILL,
  GOOD_CANDIDATE_SKILL,
  PHASE5_REAL_LIMITS,
  acceptanceCaseSet,
  makeAcceptanceArtifact,
  makeAcceptanceSuite,
  makeNanobotRunSpecFactory,
} from "../../src/evolution/evaluation/fixtures/acceptance-cases.js";
import { MinimalEvaluationRunner } from "../../src/evolution/evaluation/runner/minimal-runner.js";

const args = new Set(process.argv.slice(2));
const mode = args.has("--full") ? "full" : "smoke";
const caseIndex = process.argv.indexOf("--case");
const requestedCase = caseIndex >= 0 ? process.argv[caseIndex + 1] : undefined;
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const nanobotRepo = resolve(process.env.NANOBOT_REPO ?? "/Users/lsmax/Coder/nanobot");
const pythonExecutable = resolve(
  process.env.NANOBOT_PYTHON ?? `${nanobotRepo}/.venv/bin/python`,
);
const configPath = resolve(
  process.env.NANOBOT_CONFIG ?? `${homedir()}/.nanobot/config.json`,
);
const modelPreset = process.env.NANOBOT_MODEL_PRESET ?? "qwen3.8-27b";
const modelId = process.env.NANOBOT_MODEL_ID ?? "qwen3.8-27b";
const provider = process.env.NANOBOT_PROVIDER ?? "vllm";
const nanobotRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: nanobotRepo,
  encoding: "utf8",
}).trim();

const caseSet = acceptanceCaseSet("phase5-real-1", PHASE5_REAL_LIMITS);
const cases = mode === "smoke"
  ? caseSet.cases.filter((evaluationCase) => evaluationCase.case_id === (requestedCase ?? "AC-04"))
  : caseSet.cases;
if (cases.length === 0) throw new Error(`unknown evaluation case '${requestedCase}'`);
const suite = makeAcceptanceSuite(`nanobot-${mode}-suite`, cases);
const allowedTools = [
  "apply_patch",
  "edit_file",
  "exec",
  "find_files",
  "grep",
  "list_dir",
  "read_file",
  "write_file",
];
const toolSchemaHash = hashCanonical({
  allowed_tools: allowedTools,
  state_tools: ["state_read", "state_apply", "state_verify"],
  nanobot_revision: nanobotRevision,
});
const runner = new MinimalEvaluationRunner({
  fixture: new AcceptanceFixtureAdapter(caseSet.fixtures),
  agent: new NanobotAgentAdapter({
    python_executable: pythonExecutable,
    config_path: configPath,
    model_preset: modelPreset,
    allowed_tools: allowedTools,
  }),
  runSpecFactory: makeNanobotRunSpecFactory({
    nanobot_revision: nanobotRevision,
    provider,
    model_id: modelId,
    tool_schema_hash: toolSchemaHash,
  }),
});

const attempt = await runner.run({
  candidate_id: "phase4-good-candidate",
  suite,
  cases,
  baseline_artifact: makeAcceptanceArtifact("OFFICIAL", "phase4-baseline", BASELINE_SKILL),
  candidate_artifact: makeAcceptanceArtifact(
    "CANDIDATE",
    "phase4-good-candidate",
    GOOD_CANDIDATE_SKILL,
  ),
});
const payload = {
  phase: "Phase 5A",
  mode,
  environment: {
    nanobot_repo: nanobotRepo,
    nanobot_revision: nanobotRevision,
    python: pythonExecutable,
    provider,
    model_id: modelId,
    model_preset: modelPreset,
    temperature: 0,
    fallback: "DISABLED",
  },
  contract_adjustment: {
    expected: "Phase 4 deterministic harness used one model call and a one-second timeout.",
    actual: "A real nanobot tool loop requires model-tool-model iterations and provider network latency.",
    impact: "Case/Oracle semantics are unchanged; only CaseLimits and case revision differ.",
    minimal_fix: PHASE5_REAL_LIMITS,
  },
  attempt,
};
const json = `${JSON.stringify(payload, null, 2)}\n`;
if (outputPath) {
  await writeFile(resolve(outputPath), json, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: resolve(outputPath),
    outcome: attempt.outcome,
    comparison: attempt.result?.comparison_summary,
    gate_reasons: attempt.result?.gate.reasons,
  }, null, 2)}\n`);
} else {
  process.stdout.write(json);
}
if (attempt.outcome === "INFRA_ERROR") process.exitCode = 2;
