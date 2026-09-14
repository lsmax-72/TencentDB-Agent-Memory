import { describe, expect, it } from "vitest";

import { dshAdapter } from "../agent-adapters/dsh.js";

describe("EvoAgentBench dsh isolation route", () => {
  it("classifies the bridge header as auxiliary", () => {
    expect(dshAdapter.classifyRequest(
      { model: "qwen3.8-27b", messages: [] },
      "/dsh/default/v1/chat/completions",
      { "x-deepseek-harness-compact": "1" },
    )).toBe("auxiliary");
  });
});
