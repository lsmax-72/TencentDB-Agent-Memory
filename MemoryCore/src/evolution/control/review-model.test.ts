import { describe, expect, it, vi } from "vitest";
import { createReviewModel, type ReviewModelConfig } from "./review-model.js";
const config: ReviewModelConfig = { provider: "openai-compatible", model: "offline-review-model", base_url: "http://unused.invalid/v1", api_key: "test-only", max_output_tokens: 100, token_ceiling: 1000, temperature: 0, fallback: false, timeout_ms: 1000 };
describe("independent bounded reviewer binding (mock transport only)", () => {
  it("uses its own model, no tools, temp zero and exact usage", async () => {
    const request = vi.fn(async (_url, input) => {
      const body = JSON.parse(input!.body as string);
      expect(body.model).toBe(config.model); expect(body.temperature).toBe(0);
      expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBe(100);
      return Response.json({ model: config.model, choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 2 } });
    });
    expect(await createReviewModel(config, request as typeof fetch).complete({ system: "review", evidence: "trace" })).toEqual({ text: "{}", input_tokens: 20, output_tokens: 2 });
    expect(request).toHaveBeenCalledOnce();
  });
  it("does not retry errors or spend on oversized context", async () => {
    const request = vi.fn(async () => Response.json({ error: "provider details not echoed" }, { status: 503 }));
    const model = createReviewModel(config, request as typeof fetch);
    await expect(model.complete({ system: "x", evidence: "x".repeat(1000) })).rejects.toThrow("EXCEEDS_RESERVATION");
    expect(request).not.toHaveBeenCalled();
    await expect(model.complete({ system: "x", evidence: "x" })).rejects.toThrow("MODEL_UPSTREAM_UNAVAILABLE");
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects model substitution and preserves unknown usage", async () => {
    const response = { model: "fallback", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
    const request = async () => Response.json(response);
    await expect(createReviewModel(config, request as typeof fetch).complete({ system: "x", evidence: "x" })).rejects.toThrow("MODEL_MISMATCH");
    response.model = config.model;
    expect(await createReviewModel(config, request as typeof fetch).complete({ system: "x", evidence: "x" })).toMatchObject({ input_tokens: null, output_tokens: null });
  });
});
