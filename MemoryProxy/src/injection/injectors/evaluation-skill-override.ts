import { createHash } from "node:crypto";
import { EVALUATION_CONTEXT_POLICY, isEvaluationContext } from "../evaluation-context.js";
import type {
  AgentContext,
  AnchorTarget,
  CacheStrategy,
  ContextBlock,
  HookPriority,
  InjectionHook,
} from "../types.js";
import { HOOK_PRIORITY } from "../types.js";

export interface EvaluationOverrideArtifact {
  skill_id: string;
  base_version: number;
  content: string;
  content_hash: `sha256:${string}`;
  artifact_hash: `sha256:${string}`;
  read_only: true;
}

/** Process-local trusted mapping; artifacts never enter listing, pin, or hook cache. */
export class EvaluationSkillSessionRegistry {
  private readonly artifacts = new Map<string, EvaluationOverrideArtifact>();

  bind(sessionId: string, artifact: EvaluationOverrideArtifact): void {
    if (!sessionId) throw new Error("evaluation session id is required");
    if (artifact.read_only !== true || hashContent(artifact.content) !== artifact.content_hash) {
      throw new Error("invalid evaluation Skill artifact");
    }
    this.artifacts.set(sessionId, Object.freeze({ ...artifact }));
  }

  unbind(sessionId: string): void {
    this.artifacts.delete(sessionId);
  }

  get(sessionId: string): EvaluationOverrideArtifact | undefined {
    return this.artifacts.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.artifacts.has(sessionId);
  }
}

/** Shared by the injection pipeline and write-side guards in this process. */
export const evaluationSkillSessions = new EvaluationSkillSessionRegistry();

export function isEvaluationSession(sessionId: string | undefined): boolean {
  return typeof sessionId === "string" && evaluationSkillSessions.has(sessionId);
}

/** Same neutral rendering path for Baseline and Candidate artifacts. */
export class EvaluationSkillOverride implements InjectionHook {
  id = "evaluation-skill-override";
  point = "system.before_tools" as const;
  anchor: AnchorTarget = { slot: "skills", relation: "before" };
  priority: HookPriority = HOOK_PRIORITY.SKILL - 2;
  description = "Inject one session-bound read-only evaluation Skill artifact.";
  cacheStrategy: CacheStrategy = "none";

  constructor(private readonly sessions: EvaluationSkillSessionRegistry) {}

  execute(ctx: AgentContext): ContextBlock[] {
    if (!isEvaluationContext(ctx)) return [];
    const sessionId = readSessionId(ctx);
    if (!sessionId) throw new Error("evaluation context is missing session_id");
    const artifact = this.sessions.get(sessionId);
    if (!artifact) throw new Error(`evaluation artifact not bound for session '${sessionId}'`);

    return [{
      type: "text",
      content: renderEvaluationSkill(artifact.content),
      metadata: {
        source: this.id,
        skill_id: artifact.skill_id,
        base_version: artifact.base_version,
        content_hash: artifact.content_hash,
        artifact_hash: artifact.artifact_hash,
        cacheStrategy: "none",
      },
    }];
  }
}

export function renderEvaluationSkill(content: string): string {
  return `<evaluation_skill>\n${content}\n</evaluation_skill>`;
}

export function evaluationMetadata(sessionId: string): Record<string, unknown> {
  return {
    evaluationPolicy: EVALUATION_CONTEXT_POLICY,
    session: { session_id: sessionId },
  };
}

function readSessionId(ctx: AgentContext): string | undefined {
  const session = ctx.metadata.custom?.session as { session_id?: unknown } | undefined;
  return typeof session?.session_id === "string" ? session.session_id : undefined;
}

function hashContent(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
