import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ToolSet } from "ai";
import type { LLMRunner, LLMRunParams } from "../../core/types.js";
import { createStorageTools } from "../../adapters/standalone/storage-tools.js";
import { parseReviewModelConfig, type ReviewModelConfig } from "./review-model.js";
import { EvolutionStore, contentHash } from "./store.js";
import { EvolutionError, type EvolutionRecord } from "./types.js";
import { ShadowStorageBackend } from "./shadow-storage.js";
import { redactEvidence } from "./evidence.js";

const SKILL_TOOLS = new Set(["skill_list", "skill_view", "skill_create", "skill_update", "skill_patch", "skill_files_write", "skill_files_read", "skill_files_remove"]);
export interface ProposalRunnerContext {
  allocationId: string;
  store: EvolutionStore;
  source: EvolutionRecord;
  /** A durable, unique generation job ID; never reused for retries. */
  jobId: string;
  authorize: () => Promise<boolean>;
}

/** Same extraction interfaces, but a separate provider and no default filesystem/shell tools. */
export function createProposalRunner(raw: ReviewModelConfig, context: ProposalRunnerContext, request: typeof fetch = fetch): LLMRunner {
  const config = parseReviewModelConfig(raw);
  let callSequence = 0, toolSequence = 0, running = false;
  const { source, store, jobId } = context;
  const job = store.get(jobId);
  if (source.origin !== "runtime" || !["trace", "diagnosis"].includes(source.kind) || !job || job.kind !== "job"
    || job.origin !== "runtime" || job.team_id !== source.team_id || job.agent_id !== source.agent_id
    || job.owner_user_id !== source.owner_user_id) throw new EvolutionError(409, "LIVE_PROPOSAL_JOB_REQUIRED");
  const initialProfileHash = contentHash(store.profile(source.team_id, source.agent_id));
  async function authorize() {
    if (!await context.authorize() || contentHash(store.profile(source.team_id, source.agent_id)) !== initialProfileHash) throw new EvolutionError(403, "PROPOSAL_AUTHORIZATION_CHANGED");
    if (context.allocationId !== `${jobId}/candidates`) throw new EvolutionError(409, "CANDIDATE_ALLOCATION_JOB_MISMATCH");
    store.assertCandidateAllocation(context.allocationId, source.team_id, source.agent_id, source.owner_user_id);
  }
  function record(key: string, type: string, status: string, payload: Record<string, unknown>) {
    return store.append({ team_id: source.team_id, owner_user_id: source.owner_user_id, agent_id: source.agent_id,
      kind: "job", title: `${type} · ${source.title}`, status, origin: "runtime", asset_ids: source.asset_ids, parent_id: jobId,
      payload: { job_type: type, source_id: source.id, ...payload },
    }, key, source.owner_user_id);
  }
  const budgetedFetch: typeof fetch = async (url, init) => {
    await authorize();
    if (String(url) !== `${config.base_url.replace(/\/$/, "")}/chat/completions` || typeof init?.body !== "string") throw new EvolutionError(400, "PROPOSAL_TRANSPORT_REJECTED");
    const body = JSON.parse(init.body);
    if (body.model !== config.model || body.temperature !== 0 || body.stream === true
      || !Number.isSafeInteger(body.max_tokens) || body.max_tokens > config.max_output_tokens) throw new EvolutionError(400, "PROPOSAL_MODEL_CONFIG_CHANGED");
    if (Buffer.byteLength(init.body) + body.max_tokens + 512 > config.token_ceiling) throw new EvolutionError(429, "REVIEW_CONTEXT_EXCEEDS_RESERVATION");
    const callId = `${jobId}/model/${++callSequence}`;
    store.reserve(callId, source.team_id, source.agent_id, config.token_ceiling, 1, 0);
    const step = record(callId, "proposal_model_step", "RUNNING", { actual_model: config.model, request_hash: contentHash(body), sequence: callSequence });
    let usage: { input_tokens: number | null; output_tokens: number | null; model_calls: number } | null = null;
    try {
      const response = await request(url, init);
      if (!response.ok) throw new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE");
      const data = await response.clone().json();
      const validToken = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      usage = { input_tokens: validToken(data.usage?.prompt_tokens) ? data.usage.prompt_tokens : null,
        output_tokens: validToken(data.usage?.completion_tokens) ? data.usage.completion_tokens : null, model_calls: 1 };
      const tokens = usage.input_tokens === null || usage.output_tokens === null ? null : usage.input_tokens + usage.output_tokens;
      store.settle(callId, tokens, 1);
      if (tokens === null) throw new EvolutionError(503, "MODEL_USAGE_MISSING");
      if (tokens > config.token_ceiling) throw new EvolutionError(429, "REVIEW_BUDGET_OVERRUN");
      if (data.model !== config.model) throw new EvolutionError(503, "ACTUAL_REVIEW_MODEL_MISMATCH");
      if (!Array.isArray(data.choices) || data.choices.length !== 1 || !["stop", "tool_calls"].includes(data.choices[0]?.finish_reason)) throw new EvolutionError(503, "PROPOSAL_OUTPUT_INCOMPLETE");
      store.jobTransition(step, "COMPLETED", { usage, response_hash: contentHash(data), finish_reason: data.choices[0].finish_reason });
      return response;
    } catch (error) {
      const failure = error instanceof EvolutionError ? error : new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE");
      store.jobTransition(step, "INFRA_ERROR", { usage, reason: failure.message });
      throw failure;
    }
  };
  const provider = createOpenAI({ baseURL: config.base_url, apiKey: config.api_key, fetch: budgetedFetch });
  return {
    async run(params: LLMRunParams): Promise<string> {
      if (running) throw new EvolutionError(409, "PROPOSAL_RUNNER_CONCURRENT_USE");
      running = true;
      let fatalToolError: unknown;
      try {
        await authorize();
        let tools: ToolSet | undefined;
        if (params.enableTools ?? !!params.storage) {
          if (params.tools && Object.keys(params.tools).length) {
            if (Object.keys(params.tools).some(name => !SKILL_TOOLS.has(name))) throw new EvolutionError(400, "PROPOSAL_TOOL_NOT_ALLOWED");
            tools = params.tools as ToolSet;
          } else {
            if (!(params.storage?.getBackend() instanceof ShadowStorageBackend)) throw new EvolutionError(400, "PROPOSAL_SHADOW_STORAGE_REQUIRED");
            tools = createStorageTools(params.storage, params.storagePrefix ?? "");
          }
        }
        let tail: Promise<unknown> = Promise.resolve();
        const wrapped = tools && Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
          if (typeof tool.execute !== "function") throw new EvolutionError(400, "PROPOSAL_TOOL_EXECUTOR_REQUIRED");
          return [name, { ...tool, execute: (args: unknown, options: never) => {
            const execution = tail.then(async () => {
              await authorize();
              const sequence = ++toolSequence;
              if (sequence > 64) throw new EvolutionError(429, "PROPOSAL_TOOL_LIMIT");
              const result = await tool.execute!(args, options);
              const encoded = typeof result === "string" ? result : JSON.stringify(result);
              let success = true;
              try { success = !JSON.parse(encoded)?.error; } catch { /* Plain text is a normal read result. */ }
              record(`${jobId}/tool/${sequence}`, "proposal_tool_event", success ? "COMPLETED" : "TOOL_ERROR", {
                sequence, name, arguments: redactEvidence(JSON.stringify(args)).text,
                result: redactEvidence(encoded).text, success,
              });
              return result;
            }).catch(error => { fatalToolError = error; throw error; });
            tail = execution.catch(() => {});
            return execution;
          } }];
        })) as ToolSet | undefined;
        const signals = [AbortSignal.timeout(Math.min(params.timeoutMs ?? config.timeout_ms, config.timeout_ms))];
        if (params.abortSignal) signals.push(params.abortSignal);
        const result = await generateText({ model: provider.chat(config.model), system: params.systemPrompt, prompt: params.prompt,
          temperature: 0, maxOutputTokens: Math.min(params.maxTokens ?? config.max_output_tokens, config.max_output_tokens), maxRetries: 0,
          tools: wrapped, stopWhen: stepCountIs(Math.min(params.maxIterations ?? 16, 20)), abortSignal: AbortSignal.any(signals),
          providerOptions: { openai: { parallelToolCalls: false } },
        });
        if (fatalToolError) throw fatalToolError;
        if (result.finishReason !== "stop") throw new EvolutionError(429, "PROPOSAL_ITERATION_BUDGET_EXHAUSTED");
        await authorize();
        return result.text;
      } finally { running = false; }
    },
  };
}
