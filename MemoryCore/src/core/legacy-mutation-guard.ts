/** Host wiring only. A task's prompt or tool arguments cannot disable governance. */
export interface LegacyMutationScope {
  teamId?: string;
  agentId?: string;
  userId?: string;
  layer: "skill" | "skill_review" | "L1" | "L2" | "L3";
}

export type LegacyMutationGuard = (scope: LegacyMutationScope) => Promise<void>;

export class GovernedMutationError extends Error {
  readonly code = "EVOLUTION_TASK_COMPLETE_REQUIRED";
  constructor() {
    super("EVOLUTION_TASK_COMPLETE_REQUIRED: legacy writes disabled; use the explicit task-complete candidate workflow");
    this.name = "GovernedMutationError";
  }
}
