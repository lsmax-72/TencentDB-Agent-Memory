import { describe, expect, it, vi } from "vitest";
import { computeArtifactHashes, hashCanonical } from "../contracts/hash.js";
import type { EvaluationCase, EvaluationSkillArtifact, RunSpec } from "../contracts/types.js";
import { NanobotAgentAdapter, type NanobotBridgeRequest } from "./nanobot-agent-adapter.js";

const H = hashCanonical("nanobot-test");

describe("NanobotAgentAdapter", () => {
  it("maps the framework-neutral run input to the Python bridge and preserves evidence", async () => {
    let captured: NanobotBridgeRequest | undefined;
    const invoke = vi.fn(async (request: NanobotBridgeRequest) => {
      captured = request;
      return {
        ok: true as const,
        final_output: "done",
        actual_model: "qwen3.8-27b",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          model_call_count: 2,
        },
        tool_events: [{
          sequence: 1,
          name: "edit_file",
          arguments: { path: "notes/todo.txt" },
          result: "ok",
          outcome: "SUCCEEDED" as const,
        }],
        elapsed_ms: 250,
        run_ref: "session-ac04",
        stop_reason: "completed",
        observed_conditions_hash: H,
      };
    });
    const adapter = new NanobotAgentAdapter({
      python_executable: "/python",
      config_path: "/config.json",
      model_preset: "qwen3.8-27b",
      bridge_path: "/bridge.py",
      invoke,
    });

    const output = await adapter.run({
      evaluation_case: evaluationCase("AC-04"),
      run_spec: runSpec("AC-04"),
      workspace_dir: "/fixture/ac04",
      session_id: "session-ac04",
      skill_override: "<evaluation_skill>candidate</evaluation_skill>",
    });

    expect(captured).toMatchObject({
      task_input: "task AC-04",
      workspace: "/fixture/ac04",
      session_id: "session-ac04",
      model: {
        provider: "vllm",
        model_id: "qwen3.8-27b",
        model_preset: "qwen3.8-27b",
        temperature: 0,
        fallback: "DISABLED",
      },
      evaluation_skill_content: "<evaluation_skill>candidate</evaluation_skill>",
      tool_policy: { enable_state_tools: false },
    });
    expect(output.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      model_call_count: 2,
      tool_call_count: 1,
    });
    expect(output.tool_calls[0]).toMatchObject({ name: "edit_file", outcome: "SUCCEEDED" });
    expect(output.output_evidence[0].excerpt).toBe("done");
    expect(output.trace_refs[0].trace_id).toBe("session-ac04");
  });

  it("enables deterministic state tools from the frozen RunSpec toolset", async () => {
    let captured: NanobotBridgeRequest | undefined;
    const adapter = new NanobotAgentAdapter({
      python_executable: "/python",
      config_path: "/config.json",
      invoke: async (request) => {
        captured = request;
        return success();
      },
    });

    await adapter.run({
      evaluation_case: evaluationCase("AC-03"),
      run_spec: { ...runSpec("AC-03"), tools: { ...runSpec("AC-03").tools, toolset_id: "nanobot-workspace-plus-state-v1" } },
      workspace_dir: "/fixture/ac03",
      session_id: "session-ac03",
      skill_override: "<evaluation_skill>skill</evaluation_skill>",
    });

    expect(captured?.tool_policy.enable_state_tools).toBe(true);

    await adapter.run({
      evaluation_case: evaluationCase("HO-07"),
      run_spec: { ...runSpec("HO-07"), tools: { ...runSpec("HO-07").tools, toolset_id: "nanobot-workspace-plus-state-v1" } },
      workspace_dir: "/fixture/ho07",
      session_id: "session-ho07",
      skill_override: "<evaluation_skill>skill</evaluation_skill>",
    });
    expect(captured?.tool_policy.enable_state_tools).toBe(true);
  });

  it("maps upstream bridge failures to Phase 4 infrastructure errors", async () => {
    const adapter = new NanobotAgentAdapter({
      python_executable: "/python",
      config_path: "/config.json",
      invoke: async () => ({
        ok: false,
        error: {
          kind: "INFRA",
          code: "MODEL_UPSTREAM_UNAVAILABLE",
          message: "provider 503",
        },
      }),
    });

    await expect(adapter.run({
      evaluation_case: evaluationCase("AC-04"),
      run_spec: runSpec("AC-04"),
      workspace_dir: "/fixture/ac04",
      session_id: "session-ac04",
      skill_override: "<evaluation_skill>skill</evaluation_skill>",
    })).rejects.toMatchObject({ kind: "INFRA", code: "MODEL_UPSTREAM_UNAVAILABLE" });
  });

  it("preserves evidence when nanobot stops for a business budget", async () => {
    const adapter = new NanobotAgentAdapter({
      python_executable: "/python",
      config_path: "/config.json",
      invoke: async () => ({
        ...success(),
        final_output: "partial result",
        task_failure_code: "BUDGET_EXHAUSTED",
      }),
    });

    const output = await adapter.run({
      evaluation_case: evaluationCase("AC-04"),
      run_spec: runSpec("AC-04"),
      workspace_dir: "/fixture/ac04",
      session_id: "session-ac04",
      skill_override: "<evaluation_skill>skill</evaluation_skill>",
    });

    expect(output.task_failure).toMatchObject({ code: "BUDGET_EXHAUSTED" });
    expect(output.usage.total_tokens).toBe(2);
    expect(output.output_evidence[0].excerpt).toBe("partial result");
  });

  it("keeps the abort reason so AGENT_ABORTED can be triaged", async () => {
    const adapter = new NanobotAgentAdapter({
      python_executable: "/python",
      config_path: "/config.json",
      invoke: async () => ({
        ...success(),
        stop_reason: "error",
        task_failure_code: "AGENT_ABORTED" as const,
        abort_reason: "model returned an empty completion",
      }),
    });

    const output = await adapter.run({
      evaluation_case: evaluationCase("AC-05"),
      run_spec: runSpec("AC-05"),
      workspace_dir: "/fixture/ac05",
      session_id: "session-ac05",
      skill_override: "",
    });

    expect(output.task_failure).toMatchObject({ code: "AGENT_ABORTED" });
    expect(output.output_evidence.map(item => item.excerpt))
      .toContain("model returned an empty completion");
  });
});

function success() {
  return {
    ok: true as const,
    final_output: "ok",
    actual_model: "qwen3.8-27b",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, model_call_count: 1 },
    tool_events: [],
    elapsed_ms: 1,
    run_ref: "run",
    stop_reason: "completed",
    observed_conditions_hash: H,
  };
}

function evaluationCase(caseId: string): EvaluationCase {
  return {
    case_id: caseId,
    revision: "phase5-real-1",
    case_hash: H,
    title: caseId,
    goal: `task ${caseId}`,
    task_input: `task ${caseId}`,
    fixture: { id: `${caseId}-fixture`, revision: "1", hash: H },
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

function runSpec(caseId: string): RunSpec {
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
    case_ref: { id: caseId, revision: "phase5-real-1", hash: H },
    agent: {
      adapter_id: "nanobot-0.3.0",
      code_revision: "415df576",
      system_prompt_hash: H,
      harness_config_hash: H,
    },
    model: {
      provider: "vllm",
      model_id: "qwen3.8-27b",
      temperature: 0,
      top_p: 1,
      seed: "UNSUPPORTED",
      fallback: "DISABLED",
    },
    tools: {
      toolset_id: "nanobot-workspace-v1",
      schema_hash: H,
      implementation_revision: "415df576",
      permission_policy_hash: H,
    },
    environment: {
      fixture_ref: { id: `${caseId}-fixture`, revision: "1", hash: H },
      workspace_image_hash: H,
      isolation: "FRESH_COPY_PER_ARM",
      reset_revision: "1",
      sandbox_policy_hash: H,
      network_policy_hash: H,
    },
    context: {
      policy_revision: "nanobot-runtime-context-v1",
      non_target_context_hash: H,
      memory_mode: "DISABLED",
      normal_skill_injection: "DISABLED",
      automatic_skill_extraction: "DISABLED",
    },
    budget: evaluationCase(caseId).limits,
    retry_policy: { mode: "NONE" },
    skill_artifact: artifact,
  };
}
