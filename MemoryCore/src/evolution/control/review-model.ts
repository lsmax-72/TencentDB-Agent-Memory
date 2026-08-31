import { z } from "zod";
import type { DiagnosisModel } from "./diagnosis.js";
import { EvolutionError } from "./types.js";

const configSchema = z.object({
  provider: z.literal("openai-compatible"), model: z.string().min(1).max(200), base_url: z.string().url(),
  api_key: z.string().min(1), max_output_tokens: z.number().int().positive(),
  token_ceiling: z.number().int().positive(), timeout_ms: z.number().int().min(100).max(120000),
  temperature: z.literal(0), fallback: z.literal(false),
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
            messages: [{ role: "system", content: input.system }, { role: "user", content: input.evidence }] }),
          signal: AbortSignal.timeout(config.timeout_ms),
        });
      } catch { throw new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE"); }
      if (!response.ok) throw new EvolutionError(503, "MODEL_UPSTREAM_UNAVAILABLE");
      let data: unknown;
      try { data = await response.json(); } catch { throw new EvolutionError(503, "MODEL_RESPONSE_INVALID"); }
      const parsed = z.object({ model: z.string(), choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).min(1),
        usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
      }).safeParse(data);
      if (!parsed.success) throw new EvolutionError(503, "MODEL_RESPONSE_INVALID");
      if (parsed.data.model !== config.model) throw new EvolutionError(503, "ACTUAL_REVIEW_MODEL_MISMATCH");
      // Truncated output is recorded as an unusable result, never fed to candidate generation.
      const text = parsed.data.choices[0].finish_reason === "stop" ? parsed.data.choices[0].message.content : "";
      return { text, input_tokens: parsed.data.usage?.prompt_tokens ?? null, output_tokens: parsed.data.usage?.completion_tokens ?? null };
    },
  };
}
