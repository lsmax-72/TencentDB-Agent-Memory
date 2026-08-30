import { describe, expect, it, vi } from "vitest";
import { shouldSuppressHookInEvaluation } from "../../evaluation-context.js";
import type { AgentContext, AgentContextMetadata } from "../../types.js";
import type { ProtocolAdapter } from "../../adapters/interface.js";
import { recordTdaiTurn } from "../../../tdai/recorder.js";
import { InjectionPipeline } from "../../pipeline.js";
import { HookRegistryImpl } from "../../registry.js";
// This unit test exercises injection/logging, not optional telemetry exporters.
vi.mock("../../observer.js", () => ({ NoopInjectionObserver: class {} }));
import {
  EvaluationSkillOverride,
  EvaluationSkillSessionRegistry,
  evaluationSkillSessions,
  evaluationMetadata,
  isEvaluationSession,
} from "../evaluation-skill-override.js";

const BASELINE_CONTENT_HASH = "sha256:8ba8496a2525ae171ffd104d632dede6ef418d9b95962a9d88e2fcdbc8d48d24";
const CANDIDATE_CONTENT_HASH = "sha256:dda18a0e21ae47c53b4309434cbc02ae8bf764fa83a6defbb719431242722aa7";

function metadata(sessionId: string): AgentContextMetadata {
  return {
    protocol: "openai",
    traceId: "trace-1",
    keyId: "key-1",
    modelId: "deterministic-v1",
    stream: false,
    agentSource: "test",
    custom: evaluationMetadata(sessionId),
  };
}

function adapter(): ProtocolAdapter {
  return {
    protocol: "openai",
    parse(_body, meta): AgentContext {
      return {
        messages: [{ role: "system", blocks: [{ type: "text", content: "system" }] }],
        requestParams: {},
        metadata: meta,
      };
    },
    serialize(ctx) {
      return { system: ctx.messages[0].blocks.map((block) => block.content).join("\n") };
    },
  };
}

describe("EvaluationSkillOverride", () => {
  it("injects evaluation content without writing it to console previews", async () => {
    const sessions = new EvaluationSkillSessionRegistry();
    sessions.bind("preview-session", {
      skill_id: "skl-a", base_version: 3, content: "candidate",
      content_hash: CANDIDATE_CONTENT_HASH, artifact_hash: "sha256:candidate", read_only: true,
    });
    const registry = new HookRegistryImpl();
    registry.register(new EvaluationSkillOverride(sessions));
    const pipeline = new InjectionPipeline(registry, new Map([["openai", adapter()]]));
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const output = await pipeline.process({}, metadata("preview-session"));
      expect(output.system).toContain("candidate");
      expect(logged.mock.calls.flat().join(" ")).not.toContain("candidate");
      expect(logged.mock.calls.flat().join(" ")).not.toContain("text preview");
    } finally {
      logged.mockRestore();
    }
  });
  it("uses a neutral uncached template for both arms", () => {
    const sessions = new EvaluationSkillSessionRegistry();
    const hook = new EvaluationSkillOverride(sessions);
    sessions.bind("baseline-session", {
      skill_id: "skl-a",
      base_version: 3,
      content: "baseline",
      content_hash: BASELINE_CONTENT_HASH,
      artifact_hash: "sha256:baseline",
      read_only: true,
    });
    sessions.bind("candidate-session", {
      skill_id: "skl-a",
      base_version: 3,
      content: "candidate",
      content_hash: CANDIDATE_CONTENT_HASH,
      artifact_hash: "sha256:candidate",
      read_only: true,
    });

    const baseline = hook.execute(adapter().parse({}, metadata("baseline-session")))[0].content;
    const candidate = hook.execute(adapter().parse({}, metadata("candidate-session")))[0].content;
    expect(hook.cacheStrategy).toBe("none");
    expect(baseline.replace("baseline", "CONTENT")).toBe(candidate.replace("candidate", "CONTENT"));
    expect(`${baseline}${candidate}`).not.toMatch(/BASELINE|CANDIDATE|OFFICIAL/);
  });

  it("suppresses normal hooks and their caches in evaluation mode", () => {
    const context = adapter().parse({}, metadata("evaluation-session"));
    expect(shouldSuppressHookInEvaluation(context, "skill-injector")).toBe(true);
    expect(shouldSuppressHookInEvaluation(context, "tdai-l1-recall-injector")).toBe(true);
    expect(shouldSuppressHookInEvaluation(context, "evaluation-skill-override")).toBe(false);
  });

  it("exposes a trusted process-local session guard for write paths", async () => {
    evaluationSkillSessions.bind("guarded-session", {
      skill_id: "skl-a",
      base_version: 3,
      content: "candidate",
      content_hash: CANDIDATE_CONTENT_HASH,
      artifact_hash: "sha256:candidate",
      read_only: true,
    });
    expect(isEvaluationSession("guarded-session")).toBe(true);
    const addConversation = vi.fn();
    await recordTdaiTurn(
      { addConversation } as never,
      { teamId: "team", userId: "user", agentId: "agent", sessionId: "guarded-session" },
      { role: "user", content: "task" },
      "answer",
    );
    expect(addConversation).not.toHaveBeenCalled();
    evaluationSkillSessions.unbind("guarded-session");
    expect(isEvaluationSession("guarded-session")).toBe(false);
    await recordTdaiTurn(
      { addConversation } as never,
      { teamId: "team", userId: "user", agentId: "agent", sessionId: "normal-session" },
      { role: "user", content: "task" },
      "answer",
    );
    expect(addConversation).toHaveBeenCalledOnce();
  });
});
