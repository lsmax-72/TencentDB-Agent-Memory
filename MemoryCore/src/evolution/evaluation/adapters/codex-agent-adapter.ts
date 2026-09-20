import { spawn } from "node:child_process";
import type { EvidenceRef, RunUsage, ToolCallSummary } from "../contracts/types.js";
import {
  EvaluationExecutionError,
  type AgentAdapter,
  type AgentRunOutput,
} from "../runner/minimal-runner.js";

export interface CodexAgentAdapterOptions {
  codex_executable: string;
  timeout_ms?: number;
  invoke?: CodexInvoker;
  model_id: string;
}

export interface CodexInvocation {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeout_ms: number;
}

export interface CodexInvocationResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  elapsed_ms: number;
  timed_out?: boolean;
}

export type CodexInvoker = (invocation: CodexInvocation) => Promise<CodexInvocationResult>;

/** This adapter invokes the real Codex coding agent so evaluations exercise production agent behavior. */
const CODEX_EXEC_SUBCOMMAND = "exec";

export class CodexAgentAdapter implements AgentAdapter {
  private readonly invoke: CodexInvoker;

  constructor(private readonly options: CodexAgentAdapterOptions) {
    this.invoke = options.invoke ?? invokeCodex;
  }

  async run(input: Parameters<AgentAdapter["run"]>[0]): Promise<AgentRunOutput> {
    if (this.options.model_id !== input.run_spec.model.model_id) {
      throw new EvaluationExecutionError(
        "INFRA",
        "RUNSPEC_MISMATCH",
        `configured Codex model '${this.options.model_id}' differs from RunSpec model '${input.run_spec.model.model_id}'`,
      );
    }

    const timeoutMs = Math.min(
      input.run_spec.budget.timeout_ms,
      this.options.timeout_ms ?? input.run_spec.budget.timeout_ms,
    );
    const invocation: CodexInvocation = {
      executable: this.options.codex_executable,
      args: [
        CODEX_EXEC_SUBCOMMAND,
        "--json",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "--cd",
        input.workspace_dir,
        "--skip-git-repo-check",
        "--color",
        "never",
        "--model",
        this.options.model_id,
        "-",
      ],
      cwd: input.workspace_dir,
      stdin: `${input.skill_override}\n\n${input.evaluation_case.task_input}`,
      timeout_ms: timeoutMs,
    };

    let result: CodexInvocationResult;
    try {
      result = await this.invoke(invocation);
    } catch (error) {
      if (error instanceof EvaluationExecutionError) throw error;
      throw new EvaluationExecutionError(
        "INFRA",
        "TOOL_RUNTIME_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (result.timed_out) {
      throw new EvaluationExecutionError("TASK", "AGENT_TIMEOUT");
    }

    const parsed = parseJsonLines(result.stdout);
    if (result.exit_code !== 0 && !parsed.turnStarted) {
      throw new EvaluationExecutionError(
        "INFRA",
        "TOOL_RUNTIME_UNAVAILABLE",
        `codex exited ${result.exit_code ?? "by signal"} before the run started; stderr=${result.stderr.slice(-512)}`,
      );
    }
    if (parsed.invalidLine !== undefined) {
      throw new EvaluationExecutionError(
        "INFRA",
        "TELEMETRY_INCOMPLETE",
        `invalid Codex JSONL record: ${parsed.invalidLine.slice(0, 160)}`,
      );
    }

    const toolCalls = parseToolCalls(parsed.events, parsed.threadId);
    const usage = parseUsage(parsed.events, toolCalls, result.elapsed_ms);
    const outputEvidence = parseOutputEvidence(parsed.events, parsed.threadId);
    return {
      observed_model_id: input.run_spec.model.model_id,
      observed_conditions_hash: input.run_spec.skill_artifact.artifact_hash,
      usage,
      tool_calls: toolCalls,
      output_evidence: outputEvidence,
      trace_refs: parsed.threadId ? [{ provider: "HOST", trace_id: parsed.threadId }] : [],
    };
  }
}

export function invokeCodex(invocation: CodexInvocation): Promise<CodexInvocationResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CodexInvocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        stdout,
        stderr,
        exit_code: null,
        elapsed_ms: Date.now() - startedAt,
        timed_out: true,
      });
    }, invocation.timeout_ms);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => finish({
      stdout,
      stderr,
      exit_code: code,
      elapsed_ms: Date.now() - startedAt,
    }));
    child.stdin.end(invocation.stdin);
  });
}

type JsonObject = Record<string, unknown>;

function parseJsonLines(stdout: string): {
  events: JsonObject[];
  threadId?: string;
  turnStarted: boolean;
  invalidLine?: string;
} {
  const events: JsonObject[] = [];
  let invalidLine: string | undefined;
  for (const line of stdout.split(/\r?\n/).filter((candidate) => candidate.trim())) {
    try {
      const value: unknown = JSON.parse(line);
      if (!isObject(value)) {
        invalidLine ??= line;
        continue;
      }
      events.push(value);
    } catch {
      invalidLine ??= line;
    }
  }
  const threadEvent = events.find((event) => event.type === "thread.started");
  return {
    events,
    ...(typeof threadEvent?.thread_id === "string" ? { threadId: threadEvent.thread_id } : {}),
    turnStarted: events.some((event) => event.type === "turn.started"),
    ...(invalidLine === undefined ? {} : { invalidLine }),
  };
}

function parseUsage(
  events: JsonObject[],
  toolCalls: ToolCallSummary[],
  elapsedMs: number,
): RunUsage {
  const completed = [...events].reverse().find((event) => event.type === "turn.completed");
  const rawUsage = isObject(completed?.usage) ? completed.usage : undefined;
  if (!rawUsage) {
    throw new EvaluationExecutionError("INFRA", "TELEMETRY_INCOMPLETE", "missing turn.completed usage");
  }

  const inputTokens = requiredNumber(rawUsage, "input_tokens");
  const outputTokens = requiredNumber(rawUsage, "output_tokens");
  const reportedToolCallCount = optionalNumber(rawUsage, "tool_call_count");
  if (reportedToolCallCount !== undefined && reportedToolCallCount !== toolCalls.length) {
    throw new EvaluationExecutionError(
      "INFRA",
      "TELEMETRY_INCOMPLETE",
      `reported tool_call_count ${reportedToolCallCount} differs from ${toolCalls.length} structured tool events`,
    );
  }

  const cacheReadTokens = optionalNumber(rawUsage, "cached_input_tokens");
  const cacheWriteTokens = optionalNumber(rawUsage, "cache_write_input_tokens");
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cache_read_tokens: cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cache_write_tokens: cacheWriteTokens }),
    model_call_count: null,
    tool_call_count: toolCalls.length,
    tool_names: toolCalls.map((call) => call.name),
    elapsed_ms: elapsedMs,
  };
}

function parseToolCalls(events: JsonObject[], threadId?: string): ToolCallSummary[] {
  const toolTypes = new Set([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "collab_tool_call",
    "web_search",
  ]);
  const items = events
    .filter((event) => event.type === "item.completed" && isObject(event.item))
    .map((event) => event.item as JsonObject)
    .filter((item) => typeof item.type === "string" && toolTypes.has(item.type));

  return items.map((item, index) => ({
    sequence: index + 1,
    name: toolName(item),
    outcome: toolOutcome(item),
    event_ref: {
      kind: "tool_event",
      uri: `codex://${encodeURIComponent(threadId ?? "unknown")}/tool/${encodeURIComponent(String(item.id ?? index + 1))}`,
      excerpt: boundedJson(item),
    },
  }));
}

function parseOutputEvidence(events: JsonObject[], threadId?: string): EvidenceRef[] {
  return events
    .filter((event) => event.type === "item.completed" && isObject(event.item))
    .map((event) => event.item as JsonObject)
    .filter((item) => item.type === "agent_message" && typeof item.text === "string")
    .map((item, index) => ({
      kind: "agent_output" as const,
      uri: `codex://${encodeURIComponent(threadId ?? "unknown")}/output/${encodeURIComponent(String(item.id ?? index + 1))}`,
      excerpt: item.text as string,
    }));
}

function toolName(item: JsonObject): string {
  if (item.type === "mcp_tool_call" && typeof item.server === "string" && typeof item.tool === "string") {
    return `${item.server}.${item.tool}`;
  }
  if (item.type === "collab_tool_call" && typeof item.tool === "string") return `collab.${item.tool}`;
  return String(item.type);
}

function toolOutcome(item: JsonObject): ToolCallSummary["outcome"] {
  if (item.status === "failed" || item.status === "declined") return "FAILED";
  if (item.type === "command_execution" && typeof item.exit_code === "number") {
    return item.exit_code === 0 ? "SUCCEEDED" : "FAILED";
  }
  return item.status === "completed" ? "SUCCEEDED" : "UNKNOWN";
}

function requiredNumber(object: JsonObject, key: string): number {
  const value = optionalNumber(object, key);
  if (value === undefined) {
    throw new EvaluationExecutionError("INFRA", "TELEMETRY_INCOMPLETE", `missing ${key}`);
  }
  return value;
}

function optionalNumber(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new EvaluationExecutionError("INFRA", "TELEMETRY_INCOMPLETE", `invalid ${key}`);
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 512);
  } catch {
    return "<unserializable>";
  }
}
