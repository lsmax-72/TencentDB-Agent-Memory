import { z } from "zod";
import type { DiagnosisModel } from "./diagnosis.js";
import { EvolutionError } from "./types.js";

const configSchema = z.object({
  provider: z.literal("openai-compatible"), model: z.string().min(1).max(200), base_url: z.string().url(),
  api_key: z.string().min(1), max_output_tokens: z.number().int().positive(),
  // The cap used to be 120s. A single reviewer call can legitimately take longer than
  // that on a loaded endpoint serving a reasoning model, and the abort surfaced as an
  // opaque MODEL_UPSTREAM_UNAVAILABLE. 10 minutes is a stall bound, not a latency target.
  token_ceiling: z.number().int().positive(), timeout_ms: z.number().int().min(100).max(600000),
  temperature: z.literal(0), fallback: z.literal(false),
  //: Ask a reasoning model to answer directly. The reviewer returns a bounded
  //: JSON verdict, so chain-of-thought buys nothing and costs a lot: at ~36
  //: tok/s a long internal monologue can eat the whole completion budget, and a
  //: truncated answer is indistinguishable from an unusable one. Only honoured
  //: by endpoints that accept vLLM's `chat_template_kwargs`.
  disable_thinking: z.boolean().optional(),
}).strict();
export type ReviewModelConfig = z.infer<typeof configSchema>;

export function parseReviewModelConfig(raw: ReviewModelConfig): ReviewModelConfig {
  const config = configSchema.parse(raw);
  const base = new URL(config.base_url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new EvolutionError(400, "REVIEW_ENDPOINT_INVALID");
  return config;
}

/** Independent, server-resolved reviewer binding. It does not inherit the chatting model. */
export function createReviewModel(raw: ReviewModelConfig, request: typeof fetch = fetch): DiagnosisModel {
  const config = parseReviewModelConfig(raw);
  return {
    modelId: config.model,
    tokenCeiling: config.token_ceiling,
    async complete(input) {
      // A conservative byte bound plus message framing is checked before any paid request.
      // No images, tools or hidden SDK retry can enlarge this single-call reservation.
      if (Buffer.byteLength(input.system) + Buffer.byteLength(input.evidence) + 512 + config.max_output_tokens > config.token_ceiling) throw new EvolutionError(429, "REVIEW_CONTEXT_EXCEEDS_RESERVATION");
      let response: Response;
      try {
        response = await request(`${config.base_url.replace(/\/$/, "")}/chat/completions`, {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.api_key}` },
          body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: config.max_output_tokens, stream: false,
            ...(config.disable_thinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
            messages: [{ role: "system", content: input.system }, { role: "user", content: input.evidence }] }),
          signal: AbortSignal.timeout(config.timeout_ms),
        });
      } catch (error) {
        // Keep the stable code, but carry the cause: a bare `catch {}` here made
        // an intermittent transport failure indistinguishable from a model that
        // simply was not configured, and that ambiguity cost real debugging time.
        const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new EvolutionError(503, `MODEL_UPSTREAM_UNAVAILABLE: ${cause}`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new EvolutionError(503, `MODEL_UPSTREAM_UNAVAILABLE: HTTP ${response.status} ${detail.slice(0, 200)}`);
      }
      let data: unknown;
      try { data = await response.json(); } catch { throw new EvolutionError(503, "MODEL_RESPONSE_INVALID: body is not JSON"); }
      // `content` is null when a reasoning model spends its whole completion
      // budget before answering, and `usage` is optional on some gateways. Both
      // are shape variations of a real response, not a broken one; rejecting
      // them here replaced a diagnosable "the model returned nothing" with an
      // opaque MODEL_RESPONSE_INVALID. The non-"stop" finish reason below is
      // what turns a truncated answer into an explicit unusable result.
      const parsed = z.object({ model: z.string(), choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().optional() })).min(1),
        usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
      }).safeParse(data);
      if (!parsed.success) throw new EvolutionError(503, `MODEL_RESPONSE_INVALID: ${parsed.error.issues[0]?.message ?? "shape mismatch"}`);
      if (parsed.data.model !== config.model) throw new EvolutionError(503, "ACTUAL_REVIEW_MODEL_MISMATCH");
      // Truncated output is recorded as an unusable result, never fed to candidate generation.
      const choice = parsed.data.choices[0];
      const text = choice.finish_reason === "stop" ? choice.message.content ?? "" : "";
      return { text, input_tokens: parsed.data.usage?.prompt_tokens ?? null, output_tokens: parsed.data.usage?.completion_tokens ?? null };
    },
  };
}
