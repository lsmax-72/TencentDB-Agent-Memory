import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWikiProposal } from "../evolution/wiki-workspace.js";
import { createEvolutionWikiRoutes } from "./evolution-wiki.js";
const roots: string[] = [], previous = process.env.EVOLUTION_INTERNAL_TOKEN;
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
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
});
