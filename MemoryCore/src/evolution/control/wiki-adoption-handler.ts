import { z } from "zod";
import type { FrozenAssetHandler } from "./governed-writer.js";
import { contentHash } from "./store.js";
import { EvolutionError, type CandidatePayload, type EvolutionRecord } from "./types.js";

const proposalSchema = z.object({ revision: z.literal(1), base: z.object({ files: z.record(z.string(), z.string()), hash: z.string().min(1) }),
  files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string() })).min(1), source_paths: z.array(z.string()).min(1), hash: z.string().min(1) }).strict();
interface BridgeEnvelope { code: number; message?: string; data?: Record<string, unknown> }
export interface WikiBridgeConfig { baseUrl: string; token: string; serviceId: string; timeoutMs?: number }

/** Narrow internal client: fixed endpoints and JSON only; no browser-provided URL, path or command. */
export class WikiFrozenAssetHandler implements FrozenAssetHandler {
  private readonly base: string;
  constructor(private readonly config: WikiBridgeConfig) {
    const url = new URL(config.baseUrl);
    if (!config.token || !config.serviceId || !["http:", "https:"].includes(url.protocol)) throw new EvolutionError(500, "WIKI_BRIDGE_CONFIG_INVALID");
    this.base = `${url.toString().replace(/\/$/, "")}/v3/internal/evolution/wiki`;
  }
  layers() { return ["wiki"] as const; }
  private proposal(payload: CandidatePayload) {
    const proposal = proposalSchema.parse(payload.wiki_proposal);
    if (payload.operation !== "update" || payload.base_version !== null || payload.before !== JSON.stringify(proposal.base)
      || payload.after !== JSON.stringify(proposal.files) || contentHash(payload.before) !== payload.base_hash) throw new EvolutionError(409, "WIKI_FROZEN_PAYLOAD_MISMATCH");
    return proposal;
  }
  private async call(path: "snapshot" | "validate" | "apply" | "verify", candidate: EvolutionRecord, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${this.base}/${path}`, { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.token}`, "x-tdai-service-id": this.config.serviceId },
        body: JSON.stringify({ team_id: candidate.team_id, wiki_id: candidate.payload.target_id, ...body }) });
      const envelope = await response.json() as BridgeEnvelope;
      if (!response.ok || envelope.code !== 0 || !envelope.data) throw new EvolutionError(response.status >= 500 ? 503 : 409, `WIKI_BRIDGE_${path.toUpperCase()}_${envelope.message ?? response.status}`);
      return envelope.data;
    } catch (error) {
      if (error instanceof EvolutionError) throw error;
      throw new EvolutionError(503, error instanceof Error && error.name === "AbortError" ? "WIKI_BRIDGE_TIMEOUT" : "WIKI_BRIDGE_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
  async snapshot(candidate: EvolutionRecord, payload: CandidatePayload) {
    const proposal = this.proposal(payload), current = await this.call("snapshot", candidate, {});
    if (current.hash !== proposal.base.hash) throw new EvolutionError(409, "WIKI_BASE_STALE");
    const validated = await this.call("validate", candidate, { proposal });
    if (validated.valid !== true || validated.proposal_hash !== proposal.hash) throw new EvolutionError(409, "WIKI_VALIDATION_INCOMPLETE");
    return { base_hash: payload.base_hash, base_version: null, details: { wiki_snapshot_hash: current.hash, wiki_proposal_hash: proposal.hash } };
  }
  async write(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<void> {
    const proposal = this.proposal(payload), result = await this.call("apply", candidate, { operation_id: operation.id, proposal });
    if (result.applied !== true || result.proposal_hash !== proposal.hash) throw new EvolutionError(503, "WIKI_APPLICATION_INCOMPLETE");
  }
  async verify(operation: EvolutionRecord, candidate: EvolutionRecord, payload: CandidatePayload): Promise<boolean> {
    const proposal = this.proposal(payload);
    try { return (await this.call("verify", candidate, { operation_id: operation.id, proposal })).applied === true; }
    catch { return false; }
  }
}
