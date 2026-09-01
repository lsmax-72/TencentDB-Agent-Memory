import { readFileSync, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { contentHash } from "./store.js";
import { createReviewModel, type ReviewModelConfig } from "./review-model.js";
import type { DiagnosisModel } from "./diagnosis.js";
import { EvolutionError, type EvolutionProfile } from "./types.js";
import { createProposalRunner, type ProposalRunnerContext } from "./proposal-runner.js";
import type { LLMRunner } from "../../core/types.js";

export interface ReviewBinding {
  id: string;
  fingerprint: string;
  model: DiagnosisModel;
  createProposalRunner?: (context: ProposalRunnerContext) => LLMRunner;
  /** Server-private config for the internal Wiki generator; never persisted in a record. */
  createWikiModelConfig?: () => ReviewModelConfig;
}
export type ResolveReviewBinding = (profile: EvolutionProfile) => ReviewBinding | null;

/** The path is operator configuration, never an HTTP argument. Secrets never enter evolution records. */
export function fileReviewBindings(path: string | undefined, instanceId: string, request: typeof fetch = fetch): ResolveReviewBinding {
  return profile => {
    if (!path || !profile.review_model_id) return null;
    try {
      if (!isAbsolute(path)) throw new Error("absolute path required");
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256_000 || (stat.mode & 0o077) !== 0) throw new Error("private regular config required");
      const bindings = z.array(z.object({
        id: z.string().min(1).max(180), instance_id: z.string().min(1), team_id: z.string().min(1), agent_id: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
      }).strict()).max(100).parse(JSON.parse(readFileSync(path, "utf8")));
      const matches = bindings.filter(binding => binding.instance_id === instanceId && binding.id === profile.review_model_id && binding.team_id === profile.team_id && binding.agent_id === profile.agent_id);
      if (!matches.length) return null;
      if (matches.length !== 1) throw new Error("ambiguous binding");
      const binding = matches[0];
      const model = createReviewModel(binding.config as ReviewModelConfig, request);
      // Rotating a credential is not a change to the experiment model/configuration.
      const { api_key: _secret, ...publicConfig } = binding.config;
      return { id: binding.id, fingerprint: contentHash({ id: binding.id, instance_id: instanceId, team_id: binding.team_id, agent_id: binding.agent_id, config: publicConfig }), model,
        // A closure keeps the credential out of JSON/string inspection and all persisted evidence.
        createWikiModelConfig: () => ({ ...binding.config } as ReviewModelConfig),
        createProposalRunner: context => createProposalRunner(binding.config as ReviewModelConfig, context, request),
      };
    } catch { throw new EvolutionError(503, "REVIEW_BINDING_INVALID"); }
  };
}
