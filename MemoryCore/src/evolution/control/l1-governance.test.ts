import { describe, expect, it, vi } from "vitest";
import { extractL1Memories } from "../../core/record/l1-extractor.js";

describe("L1 proposal seam", () => {
  function params() {
    const write = vi.fn(async () => {});
    const llmRunner = { run: vi.fn(async () => JSON.stringify([{ scene_name: "project", message_ids: ["m1"], memories: [{ content: "用户正在进行文档编写项目。", type: "episodic", source_message_ids: ["m1"] }] }])) };
    return {
      messages: [{ id: "m1", role: "user", content: "我现在正在进行文档编写项目，希望记录当前的项目背景。", timestamp: Date.now() }],
      sessionKey: "offline-governance", baseDir: "/unused-offline-test", config: {},
      options: { llmRunner, enableDedup: false }, storage: { write } as never, write,
    };
  }
  it("routes extracted memories to the proposal sink without official writes", async () => {
    const input = params(); const sink = vi.fn(async () => {});
    const result = await extractL1Memories({ ...input, options: { ...input.options, proposalSink: sink } } as never);
    expect(sink).toHaveBeenCalledOnce();
    expect(result.storedCount).toBe(0); expect(result.proposedCount).toBe(1);
    expect(input.write).not.toHaveBeenCalled();
  });
  it("propagates sink failure instead of returning to legacy storage", async () => {
    const input = params();
    await expect(extractL1Memories({ ...input, options: { ...input.options, proposalSink: async () => { throw new Error("CANDIDATE_STORE_UNAVAILABLE"); } } } as never)).rejects.toThrow("CANDIDATE_STORE_UNAVAILABLE");
    expect(input.write).not.toHaveBeenCalled();
  });
});
