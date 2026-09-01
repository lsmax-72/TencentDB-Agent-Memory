import { z } from "zod";
import type { ReviewBinding } from "./model-bindings.js";
import { parseReviewModelConfig } from "./review-model.js";
import { contentHash, type EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionRecord } from "./types.js";

const proposalSchema = z.object({
  revision: z.literal(1),
  base: z.object({ files: z.record(z.string(), z.string()), hash: z.string().length(64) }).strict(),
  files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string() }).strict()).min(1).max(500),
  source_paths: z.array(z.string()).min(1).max(50),
  hash: z.string().length(64),
}).strict();
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), model_calls: z.number().int().positive(),
  calls: z.array(z.object({ label: z.string().max(200), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).strict()).max(8),
}).strict();
const envelopeSchema = z.object({ code: z.number().int(), message: z.string().optional(), data: z.object({ proposal: proposalSchema, usage: usageSchema }).strict().optional() }).passthrough();
export type FrozenWikiProposal = z.infer<typeof proposalSchema>;

/** Fixed internal bridge. Core reserves the whole bounded Wiki model batch before Knowledge may call a model. */
export class WikiProposalBridge {
  private readonly endpoint: string;
  constructor(private readonly config: { baseUrl: string; token: string; serviceId: string; maxCalls?: number; timeoutMs?: number }) {
    const url = new URL(config.baseUrl);
    if (!config.token || !config.serviceId || !["http:", "https:"].includes(url.protocol)) throw new EvolutionError(500, "WIKI_BRIDGE_CONFIG_INVALID");
    this.endpoint = `${url.toString().replace(/\/$/, "")}/v3/internal/evolution/wiki/propose`;
  }

  async generate(store: EvolutionStore, source: EvolutionRecord, job: EvolutionRecord, targetId: string, binding: ReviewBinding, authorize: () => Promise<boolean>): Promise<FrozenWikiProposal> {
    if (!binding.createWikiModelConfig) throw new EvolutionError(503, "WIKI_REVIEW_MODEL_UNAVAILABLE");
    const model = parseReviewModelConfig(binding.createWikiModelConfig()), maxCalls = Math.min(this.config.maxCalls ?? 8, 8);
    if (!await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
    const reservation = `${job.id}/wiki-model-batch`;
    store.reserve(reservation, source.team_id, source.agent_id, model.token_ceiling * maxCalls, maxCalls, 0);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? Math.min(model.timeout_ms * maxCalls, 600_000));
    try {
      const response = await fetch(this.endpoint, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.token}`, "x-tdai-service-id": this.config.serviceId },
        body: JSON.stringify({ team_id: source.team_id, wiki_id: targetId, job_id: job.id, max_calls: maxCalls,
          model: { ...model, api_key: model.api_key },
        }),
      });
      const parsed = envelopeSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success || parsed.data.code !== 0 || !parsed.data.data) throw new EvolutionError(response.status === 429 ? 429 : response.status >= 500 ? 503 : 409,
        parsed.success ? `WIKI_PROPOSAL_${parsed.data.message ?? response.status}` : "WIKI_PROPOSAL_RESPONSE_INVALID");
      const { proposal, usage } = parsed.data.data;
      if (usage.model_calls > maxCalls || usage.calls.length !== usage.model_calls
        || usage.input_tokens + usage.output_tokens > model.token_ceiling * maxCalls) throw new EvolutionError(503, "WIKI_USAGE_INVALID");
      if (!await authorize()) throw new EvolutionError(403, "PROPOSAL_TARGET_PERMISSION_DENIED");
      store.settle(reservation, usage.input_tokens + usage.output_tokens, usage.model_calls);
      usage.calls.forEach((call, index) => store.append({ team_id: source.team_id, owner_user_id: source.owner_user_id, agent_id: source.agent_id,
        kind: "job", origin: "runtime", status: "COMPLETED", title: `Wiki 模型步骤 ${index + 1} · ${source.title}`,
        asset_ids: job.asset_ids, parent_id: job.id, payload: { job_type: "proposal_model_step", source_id: source.id,
          actual_model: model.model, sequence: index + 1, label: call.label, usage: { ...call, model_calls: 1 }, proposal_hash: proposal.hash },
      }, `${job.id}/wiki-model/${index + 1}`, source.owner_user_id));
      return proposal;
    } catch (error) {
      if (error instanceof EvolutionError) throw error;
      throw new EvolutionError(503, error instanceof Error && error.name === "AbortError" ? "WIKI_PROPOSAL_TIMEOUT" : "WIKI_PROPOSAL_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
}
