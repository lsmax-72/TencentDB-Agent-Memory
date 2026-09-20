import { describe, expect, it, vi } from "vitest";
import { computeArtifactHashes, hashCanonical } from "../contracts/hash.js";
import type { EvaluationCase, EvaluationSkillArtifact, RunSpec } from "../contracts/types.js";
import {
  CodexAgentAdapter,
  type CodexInvocation,
  type CodexInvocationResult,
} from "./codex-agent-adapter.js";

const H = hashCanonical("codex-adapter-test");

describe("CodexAgentAdapter", () => {
  it("invokes Codex with the task and injected skill and parses structured telemetry", async () => {
    let captured: CodexInvocation | undefined;
    const invoke = vi.fn(async (invocation: CodexInvocation): Promise<CodexInvocationResult> => {
      captured = invocation;
      return success();
    });
    const adapter = new CodexAgentAdapter({
      codex_executable: "/usr/local/bin/codex",
      model_id: "gpt-5.4",
      invoke,
    });

    const output = await adapter.run(runInput());

    expect(captured?.stdin).toBe("<evaluation_skill>candidate</evaluation_skill>\n\ntask AC-04");
    expect(captured).toMatchObject({
      executable: "/usr/local/bin/codex",
      cwd: "/fixture/ac04",
      timeout_ms: 120_000,
    });
    expect(captured?.args).toEqual([
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/fixture/ac04",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--model",
      "gpt-5.4",
      "-",
    ]);
    expect(output.usage).toEqual({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cache_read_tokens: 40,
      cache_write_tokens: 5,
      model_call_count: null,
      tool_call_count: 1,
      tool_names: ["command_execution"],
      elapsed_ms: 250,
    });
    expect(output.tool_calls[0]).toMatchObject({ name: "command_execution", outcome: "SUCCEEDED" });
    expect(output.output_evidence[0].excerpt).toBe("done");
    expect(output.observed_conditions_hash).toBe(runSpec().skill_artifact.artifact_hash);
    expect(output.trace_refs[0].trace_id).toBe("thread-ac04");
  });

  it("maps an invocation timeout to AGENT_TIMEOUT", async () => {
    const adapter = new CodexAgentAdapter({
      codex_executable: "codex",
      model_id: "gpt-5.4",
      invoke: async () => ({
        stdout: "",
        stderr: "",
        exit_code: null,
        elapsed_ms: 120_000,
        timed_out: true,
      }),
    });

    await expect(adapter.run(runInput())).rejects.toMatchObject({
      kind: "TASK",
      code: "AGENT_TIMEOUT",
    });
  });

  it("maps a spawn failure to TOOL_RUNTIME_UNAVAILABLE", async () => {
    const adapter = new CodexAgentAdapter({
      codex_executable: "/missing/codex",
      model_id: "gpt-5.4",
      invoke: async () => { throw new Error("spawn ENOENT"); },
    });

    await expect(adapter.run(runInput())).rejects.toMatchObject({
      kind: "INFRA",
      code: "TOOL_RUNTIME_UNAVAILABLE",
      message: expect.stringContaining("spawn ENOENT"),
    });
  });

  it("fails closed when Codex omits token usage", async () => {
    const adapter = new CodexAgentAdapter({
      codex_executable: "codex",
      model_id: "gpt-5.4",
      invoke: async () => ({
        stdout: jsonLines(
          { type: "thread.started", thread_id: "thread-ac04" },
          { type: "turn.started" },
          { type: "item.completed", item: { id: "message-1", type: "agent_message", text: "done" } },
        ),
        stderr: "",
        exit_code: 0,
        elapsed_ms: 10,
      }),
    });

    await expect(adapter.run(runInput())).rejects.toMatchObject({
      kind: "INFRA",
      code: "TELEMETRY_INCOMPLETE",
      message: expect.stringContaining("missing turn.completed usage"),
    });
  });

  it("fails closed when Codex omits input or output tokens", async () => {
    for (const field of ["input_tokens", "output_tokens"] as const) {
      const result = success();
      result.stdout = result.stdout.replace(new RegExp(`"${field}":[0-9]+,?`), "");
      const adapter = new CodexAgentAdapter({
        codex_executable: "codex",
        model_id: "gpt-5.4",
        invoke: async () => result,
      });

      await expect(adapter.run(runInput())).rejects.toMatchObject({
        kind: "INFRA",
        code: "TELEMETRY_INCOMPLETE",
        message: expect.stringContaining(`missing ${field}`),
      });
    }
  });

  it("fails closed on an unparsable JSONL record", async () => {
    const result = success();
    result.stdout = `not-json\n${result.stdout}`;
    const adapter = new CodexAgentAdapter({
      codex_executable: "codex",
      model_id: "gpt-5.4",
      invoke: async () => result,
    });

    await expect(adapter.run(runInput())).rejects.toMatchObject({
      kind: "INFRA",
      code: "TELEMETRY_INCOMPLETE",
      message: expect.stringContaining("invalid Codex JSONL record"),
    });
  });

  it("fails closed when reported and structured tool counts differ", async () => {
    const result = success();
    result.stdout = result.stdout.replace('"tool_call_count":1', '"tool_call_count":2');
    const adapter = new CodexAgentAdapter({
      codex_executable: "codex",
      model_id: "gpt-5.4",
      invoke: async () => result,
    });

    await expect(adapter.run(runInput())).rejects.toMatchObject({
      kind: "INFRA",
      code: "TELEMETRY_INCOMPLETE",
      message: expect.stringContaining("differs from 1 structured tool events"),
    });
  });

  it("accepts Codex usage without a model call count and reports it as unknown", async () => {
    const adapter = new CodexAgentAdapter({
      codex_executable: "codex",
      model_id: "gpt-5.4",
      invoke: async () => success(),
    });

    const output = await adapter.run(runInput());

    expect(output.usage.model_call_count).toBeNull();
    expect(output.usage.model_call_count).not.toBe(0);
  });
});

function success(): CodexInvocationResult {
  return {
    stdout: jsonLines(
      { type: "thread.started", thread_id: "thread-ac04" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "tool-1",
          type: "command_execution",
          command: "printf done",
          aggregated_output: "done",
          exit_code: 0,
          status: "completed",
        },
      },
      { type: "item.completed", item: { id: "message-1", type: "agent_message", text: "done" } },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          cache_write_input_tokens: 5,
          output_tokens: 20,
          tool_call_count: 1,
        },
      },
    ),
    stderr: "",
    exit_code: 0,
    elapsed_ms: 250,
  };
}

function jsonLines(...events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function runInput() {
  return {
    evaluation_case: evaluationCase(),
    run_spec: runSpec(),
    workspace_dir: "/fixture/ac04",
    session_id: "session-ac04",
    skill_override: "<evaluation_skill>candidate</evaluation_skill>",
  };
}

function evaluationCase(): EvaluationCase {
  return {
    case_id: "AC-04",
    revision: "codex-test-1",
    case_hash: H,
    title: "AC-04",
    goal: "task AC-04",
    task_input: "task AC-04",
    fixture: { id: "AC-04-fixture", revision: "1", hash: H },
    oracle: { revision: "1", oracle_hash: H, assertions: [] },
    limits: {
      max_model_calls: 8,
      max_tool_calls: 12,
      max_input_tokens: 20_000,
      max_output_tokens: 4_000,
      max_total_tokens: 24_000,
      timeout_ms: 120_000,
    },
    critical: false,
  };
}

function runSpec(): RunSpec {
  const artifactBase = {
    artifact_id: "candidate",
    source: "CANDIDATE" as const,
    source_ref: "candidate",
    skill_id: "skl-workspace",
    base_version: 3,
    format: "SKILL_MD_V1" as const,
    content: "candidate",
    injection_contract_revision: "evaluation-skill-override-v1",
    read_only: true as const,
  };
  const artifact: EvaluationSkillArtifact = {
    ...artifactBase,
    ...computeArtifactHashes(artifactBase),
  };
  return {
    contract_revision: "run-spec-v1",
    arm: "CANDIDATE",
    case_ref: { id: "AC-04", revision: "codex-test-1", hash: H },
    agent: {
      adapter_id: "codex-cli-0.147.0",
      code_revision: "test",
      system_prompt_hash: H,
      harness_config_hash: H,
    },
    model: {
      provider: "openai",
      model_id: "gpt-5.4",
      temperature: 0,
      top_p: 1,
      seed: "UNSUPPORTED",
      fallback: "DISABLED",
    },
    tools: {
      toolset_id: "codex-workspace-v1",
      schema_hash: H,
      implementation_revision: "test",
      permission_policy_hash: H,
    },
    environment: {
      fixture_ref: { id: "AC-04-fixture", revision: "1", hash: H },
      workspace_image_hash: H,
      isolation: "FRESH_COPY_PER_ARM",
      reset_revision: "1",
      sandbox_policy_hash: H,
      network_policy_hash: H,
    },
    context: {
      policy_revision: "codex-runtime-context-v1",
      non_target_context_hash: H,
      memory_mode: "DISABLED",
      normal_skill_injection: "DISABLED",
      automatic_skill_extraction: "DISABLED",
    },
    budget: evaluationCase().limits,
    retry_policy: { mode: "NONE" },
    skill_artifact: artifact,
  };
}
