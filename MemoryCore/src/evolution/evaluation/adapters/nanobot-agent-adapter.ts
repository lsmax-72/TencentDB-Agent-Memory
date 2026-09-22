import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeRunSpecFingerprints } from "../contracts/hash.js";
import type { RunUsage, ToolCallSummary } from "../contracts/types.js";
import {
  EvaluationExecutionError,
  type AgentAdapter,
  type AgentRunOutput,
} from "../runner/minimal-runner.js";

export interface NanobotAgentAdapterOptions {
  python_executable: string;
  config_path: string;
  model_preset?: string;
  bridge_path?: string;
  allowed_tools?: string[];
  invoke?: NanobotBridgeInvoker;
}

export interface NanobotBridgeRequest {
  task_input: string;
  workspace: string;
  session_id: string;
  config_path: string;
  model: {
    provider: string;
    model_id: string;
    model_preset?: string;
    temperature: number;
    fallback: "DISABLED";
  };
  budget: {
    max_model_calls: number;
    max_tool_calls: number;
    timeout_ms: number;
  };
  evaluation_skill_content: string;
  tool_policy: {
    allowed_tools: string[];
    enable_state_tools: boolean;
  };
}

export interface NanobotBridgeToolEvent {
  sequence: number;
  name: string;
  arguments: unknown;
  result?: unknown;
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN";
}

export interface NanobotBridgeSuccess {
  ok: true;
  final_output: string;
  actual_model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    model_call_count: number;
  };
  tool_events: NanobotBridgeToolEvent[];
  elapsed_ms: number;
  run_ref: string;
  stop_reason: string | null;
  observed_conditions_hash: `sha256:${string}`;
  task_failure_code?: "AGENT_TIMEOUT" | "AGENT_ABORTED" | "BUDGET_EXHAUSTED";
  /** Why nanobot stopped early; carried so AGENT_ABORTED can be triaged. */
  abort_reason?: string;
}

export interface NanobotBridgeFailure {
  ok: false;
  error: {
    kind: "TASK" | "INFRA";
    code: string;
    message: string;
  };
}

export type NanobotBridgeResponse = NanobotBridgeSuccess | NanobotBridgeFailure;
export type NanobotBridgeInvoker = (
  request: NanobotBridgeRequest,
  options: { python_executable: string; bridge_path: string; timeout_ms: number },
) => Promise<NanobotBridgeResponse>;

const DEFAULT_TOOLS = [
  "apply_patch",
  "edit_file",
  "exec",
  "find_files",
  "grep",
  "list_dir",
  "read_file",
  "write_file",
];

/** Host-only adapter; Evaluation contracts remain independent of nanobot types. */
export class NanobotAgentAdapter implements AgentAdapter {
  private readonly bridgePath: string;
  private readonly invoke: NanobotBridgeInvoker;

  constructor(private readonly options: NanobotAgentAdapterOptions) {
    this.bridgePath = options.bridge_path ?? fileURLToPath(
      new URL("./nanobot_runner.py", import.meta.url),
    );
    this.invoke = options.invoke ?? invokeNanobotBridge;
  }

  async run(input: Parameters<AgentAdapter["run"]>[0]): Promise<AgentRunOutput> {
    const request: NanobotBridgeRequest = {
      task_input: input.evaluation_case.task_input,
      workspace: input.workspace_dir,
      session_id: input.session_id,
      config_path: this.options.config_path,
      model: {
        provider: input.run_spec.model.provider,
        model_id: input.run_spec.model.model_id,
        ...(this.options.model_preset ? { model_preset: this.options.model_preset } : {}),
        temperature: input.run_spec.model.temperature,
        fallback: input.run_spec.model.fallback,
      },
      budget: {
        max_model_calls: input.run_spec.budget.max_model_calls,
        max_tool_calls: input.run_spec.budget.max_tool_calls,
        timeout_ms: input.run_spec.budget.timeout_ms,
      },
      // The runner already applies the neutral <evaluation_skill> wrapper.
      evaluation_skill_content: input.skill_override,
      tool_policy: {
        allowed_tools: this.options.allowed_tools ?? DEFAULT_TOOLS,
        enable_state_tools: input.run_spec.tools.toolset_id === "nanobot-workspace-plus-state-v1",
      },
    };

    const response = await this.invoke(request, {
      python_executable: this.options.python_executable,
      bridge_path: this.bridgePath,
      timeout_ms: input.run_spec.budget.timeout_ms,
    });
    if (!response.ok) throwBridgeFailure(response);
    if (response.actual_model !== input.run_spec.model.model_id) {
      throw new EvaluationExecutionError(
        "INFRA",
        "RUNSPEC_MISMATCH",
        `nanobot observed model '${response.actual_model}'`,
      );
    }

    const usage = mapUsage(response);
    const tool_calls: ToolCallSummary[] = response.tool_events.map((event) => ({
      sequence: event.sequence,
      name: event.name,
      outcome: event.outcome,
      event_ref: {
        kind: "tool_event",
        uri: `nanobot://${encodeURIComponent(response.run_ref)}/tool/${event.sequence}`,
        excerpt: boundedJson({ arguments: event.arguments, result: event.result }),
      },
    }));

    const outputEvidence = [
      {
        kind: "agent_output" as const,
        uri: `nanobot://${encodeURIComponent(response.run_ref)}/output`,
        excerpt: response.final_output,
      },
      {
        kind: "oracle_report" as const,
        uri: `nanobot://${encodeURIComponent(response.run_ref)}/observed-conditions`,
        excerpt: response.observed_conditions_hash,
      },
      // A bare AGENT_ABORTED cannot be triaged; keep the reason with the output.
      ...(response.abort_reason ? [{
        kind: "agent_output" as const,
        uri: `nanobot://${encodeURIComponent(response.run_ref)}/abort-reason`,
        excerpt: response.abort_reason,
      }] : []),
    ];
    return {
      observed_model_id: response.actual_model,
      observed_conditions_hash: computeRunSpecFingerprints(input.run_spec).execution_fingerprint,
      usage,
      tool_calls,
      output_evidence: outputEvidence,
      trace_refs: [{ provider: "HOST", trace_id: response.run_ref }],
      ...(response.task_failure_code ? {
        task_failure: {
          code: response.task_failure_code,
          evidence_refs: outputEvidence,
        },
      } : {}),
    };
  }
}

export async function invokeNanobotBridge(
  request: NanobotBridgeRequest,
  options: { python_executable: string; bridge_path: string; timeout_ms: number },
): Promise<NanobotBridgeResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.python_executable, [options.bridge_path], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        // A dead proxy for everything except the local evaluation services. The
        // agent under test must not be able to look up the task it is being
        // graded on: on 2026-09-19 the only positive result this project ever
        // produced was the agent curling the AtCoder page for its own task.
        // This blocks the well-behaved clients (curl, wget, pip, requests); it
        // is a barrier, not a sandbox, so `detectEvaluationEgress` still audits
        // every tool call and refuses to score an arm that got out.
        HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9",
        http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9",
        NO_PROXY: "localhost,127.0.0.1,::1,tdai-proxy,memory-proxy",
        no_proxy: "localhost,127.0.0.1,::1,tdai-proxy,memory-proxy",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new EvaluationExecutionError("TASK", "AGENT_TIMEOUT"));
    }, options.timeout_ms);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new EvaluationExecutionError("INFRA", "TOOL_RUNTIME_UNAVAILABLE", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let response: NanobotBridgeResponse;
      try {
        response = JSON.parse(stdout) as NanobotBridgeResponse;
      } catch {
        reject(new EvaluationExecutionError(
          "INFRA",
          "RUNNER_INTERNAL_ERROR",
          `nanobot bridge exited ${code}; stderr=${stderr.slice(-512)}`,
        ));
        return;
      }
      resolve(response);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function mapUsage(response: NanobotBridgeSuccess): RunUsage {
  const usage = response.usage;
  for (const key of [
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "model_call_count",
  ] as const) {
    if (!Number.isFinite(usage[key])) {
      throw new EvaluationExecutionError("INFRA", "TELEMETRY_INCOMPLETE", `missing ${key}`);
    }
  }
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    ...(usage.cache_read_tokens === undefined ? {} : { cache_read_tokens: usage.cache_read_tokens }),
    ...(usage.cache_write_tokens === undefined ? {} : { cache_write_tokens: usage.cache_write_tokens }),
    model_call_count: usage.model_call_count,
    tool_call_count: response.tool_events.length,
    tool_names: response.tool_events.map((event) => event.name),
    elapsed_ms: response.elapsed_ms,
  };
}

function throwBridgeFailure(response: NanobotBridgeFailure): never {
  const infraCodes = new Set([
    "MODEL_UPSTREAM_UNAVAILABLE",
    "ENVIRONMENT_SETUP_FAILED",
    "TOOL_RUNTIME_UNAVAILABLE",
    "RUNNER_INTERNAL_ERROR",
    "TELEMETRY_INCOMPLETE",
  ]);
  const taskCodes = new Set([
    "BUDGET_EXHAUSTED",
    "AGENT_ABORTED",
    "TOOL_POLICY_VIOLATION",
  ]);
  if (response.error.kind === "INFRA" && infraCodes.has(response.error.code)) {
    throw new EvaluationExecutionError(
      "INFRA",
      response.error.code as "MODEL_UPSTREAM_UNAVAILABLE" | "ENVIRONMENT_SETUP_FAILED" | "TOOL_RUNTIME_UNAVAILABLE" | "RUNNER_INTERNAL_ERROR" | "TELEMETRY_INCOMPLETE",
      response.error.message,
    );
  }
  if (response.error.kind === "TASK" && taskCodes.has(response.error.code)) {
    throw new EvaluationExecutionError(
      "TASK",
      response.error.code as "BUDGET_EXHAUSTED" | "AGENT_ABORTED" | "TOOL_POLICY_VIOLATION",
      response.error.message,
    );
  }
  throw new EvaluationExecutionError("INFRA", "RUNNER_INTERNAL_ERROR", response.error.message);
}

function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 512);
  } catch {
    return "<unserializable>";
  }
}
