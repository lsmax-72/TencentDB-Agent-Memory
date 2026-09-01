import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWikiProposal } from "../evolution/wiki-workspace.js";
import { createEvolutionWikiRoutes } from "./evolution-wiki.js";
const roots: string[] = [], previous = process.env.EVOLUTION_INTERNAL_TOKEN;
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  vi.unstubAllGlobals();
  if (previous === undefined) delete process.env.EVOLUTION_INTERNAL_TOKEN; else process.env.EVOLUTION_INTERNAL_TOKEN = previous; });
describe("private Wiki evolution bridge", () => {
  it("requires a server token, validates frozen bytes, applies once and supports read-only verification", async () => {
    process.env.EVOLUTION_INTERNAL_TOKEN = "private-test-token";
    const root = mkdtempSync(join(tmpdir(), "wiki-evolution-route-")); roots.push(root);
    mkdirSync(join(root, "raw/sources"), { recursive: true }); mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(join(root, "raw/sources/manual.md"), "trusted source");
    const proposal = await prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => {
      mkdirSync(join(shadow, "wiki"), { recursive: true });
      writeFileSync(join(shadow, "wiki/page.md"), "---\ntitle: Page\ntype: source\nsources:\n  - manual.md\n---\n\nFrozen body.\n");
    });
    const wikiService = { getById: vi.fn(() => ({ wiki_id: "wiki", team_id: "team", status: "ready" })), dirFor: vi.fn(() => root) };
    const wikiMgr = { init: vi.fn(), sync: vi.fn(), get: vi.fn(() => ({ status: "ready" })), getPages: vi.fn(() => [{ id: "page" }]) };
    const app = createEvolutionWikiRoutes({ wikiService: wikiService as never, wikiMgr: wikiMgr as never });
    const request = (path: string, body: Record<string, unknown>, token = "private-test-token") => app.request(path, { method: "POST",
      headers: { "content-type": "application/json", "x-tdai-service-id": "service", authorization: `Bearer ${token}` }, body: JSON.stringify({ team_id: "team", wiki_id: "wiki", ...body }) });
    expect((await request("/snapshot", {}, "wrong")).status).toBe(401);
    expect((await request("/validate", { proposal })).status).toBe(200);
    expect((await request("/apply", { proposal, operation_id: "operation-1" })).status).toBe(200);
    const verified = await (await request("/verify", { proposal, operation_id: "operation-1" })).json() as { data: { applied: boolean } };
    expect(verified.data.applied).toBe(true); expect(wikiMgr.sync).toHaveBeenCalled();
    expect((await request("/apply", { proposal, operation_id: "operation-1" })).status).toBe(409);
  });
  it("derives sources server-side and returns bounded no-retry model usage with the frozen proposal", async () => {
    process.env.EVOLUTION_INTERNAL_TOKEN = "private-test-token";
    const root = mkdtempSync(join(tmpdir(), "wiki-evolution-proposal-route-")); roots.push(root);
    mkdirSync(join(root, "raw/sources"), { recursive: true }); writeFileSync(join(root, "raw/sources/manual.md"), "trusted source");
    const wikiService = { getById: vi.fn(() => ({ wiki_id: "wiki", team_id: "team", service_id: "service", status: "ready" })),
      dirFor: vi.fn(() => root), rawLs: vi.fn(() => [{ filename: "manual.md", size: 14, status: "uploaded" }]) };
    const frozen = { revision: 1 as const, base: { files: { "raw/sources/manual.md": "dHJ1c3RlZCBzb3VyY2U=" }, hash: "a".repeat(64) },
      files: [{ path: "wiki/page.md", before: null, after: "cGFnZQ==" }], source_paths: ["raw/sources/manual.md"], hash: "b".repeat(64) };
    const produce = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof createEvolutionWikiRoutes>[0]["produce"]>>[0]) => {
      await input.client.chat({ system: "system", prompt: "prompt", temperature: 0, label: "analysis:manual.md" });
      return frozen;
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "offline", object: "chat.completion", created: 1, model: "offline",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } })));
    const app = createEvolutionWikiRoutes({ wikiService: wikiService as never, wikiMgr: {} as never, produce });
    const response = await app.request("/propose", { method: "POST", headers: { "content-type": "application/json", "x-tdai-service-id": "service", authorization: "Bearer private-test-token" },
      body: JSON.stringify({ team_id: "team", wiki_id: "wiki", job_id: "job", max_calls: 2, model: { provider: "openai-compatible", model: "offline",
        base_url: "http://model.invalid/v1", api_key: "secret", max_output_tokens: 100, token_ceiling: 1000, timeout_ms: 1000, temperature: 0, fallback: false } }) });
    const body = await response.json() as { data: { proposal: unknown; usage: { model_calls: number; input_tokens: number; output_tokens: number } } };
    expect(response.status).toBe(200); expect(body.data.proposal).toEqual(frozen);
    expect(body.data.usage).toMatchObject({ model_calls: 1, input_tokens: 11, output_tokens: 3 });
    expect(produce.mock.calls[0][0].sourcePaths).toEqual(["raw/sources/manual.md"]);
  });
});
