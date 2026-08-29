import type { AgentContext } from "./types.js";

export interface EvaluationContextPolicy {
  mode: "EVALUATION_V1";
  read_only_skill: true;
  normal_skill_injection: "DISABLED";
  memory_write: "DISABLED";
  automatic_skill_extraction: "DISABLED";
}

export const EVALUATION_CONTEXT_POLICY: EvaluationContextPolicy = {
  mode: "EVALUATION_V1",
  read_only_skill: true,
  normal_skill_injection: "DISABLED",
  memory_write: "DISABLED",
  automatic_skill_extraction: "DISABLED",
};

/** Only server-side evaluation adapters should attach this complete policy. */
export function isEvaluationContext(ctx: AgentContext): boolean {
  const policy = ctx.metadata.custom?.evaluationPolicy as Partial<EvaluationContextPolicy> | undefined;
  return policy?.mode === EVALUATION_CONTEXT_POLICY.mode
    && policy.read_only_skill === true
    && policy.normal_skill_injection === "DISABLED"
    && policy.memory_write === "DISABLED"
    && policy.automatic_skill_extraction === "DISABLED";
}

export function shouldSuppressHookInEvaluation(ctx: AgentContext, hookId: string): boolean {
  return isEvaluationContext(ctx) && hookId !== "evaluation-skill-override";
}
