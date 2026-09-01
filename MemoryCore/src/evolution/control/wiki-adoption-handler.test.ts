import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiFrozenAssetHandler } from "./wiki-adoption-handler.js";
import { contentHash } from "./store.js";
import type { CandidatePayload, EvolutionRecord } from "./types.js";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
function fixture() {
  const proposal = { revision: 1 as const, base: { files: { "raw/sources/manual.md": "c291cmNl" }, hash: "base-hash" },
    files: [{ path: "wiki/page.md", before: null, after: "cGFnZQ==" }], source_paths: ["raw/sources/manual.md"], hash: "proposal-hash" };
  const payload: CandidatePayload = { asset_kind: "wiki", target_id: "wiki-1", operation: "update", base_version: null,
    before: JSON.stringify(proposal.base), after: JSON.stringify(proposal.files), base_hash: contentHash(JSON.stringify(proposal.base)), source_record_ids: ["source"], wiki_proposal: proposal };
  const candidate = { id: "candidate", team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "candidate", title: "wiki", status: "REVIEW_APPROVED",
    origin: "runtime", asset_ids: ["wiki-1"], payload, artifact_hash: contentHash(payload), revision: 3,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" } as EvolutionRecord;
  return { proposal, payload, candidate, operation: { ...candidate, id: "operation", kind: "adoption", parent_id: candidate.id, status: "WRITING" } as EvolutionRecord };
}
describe("Wiki adoption bridge client", () => {
  it("uses fixed internal endpoints and applies only the validated frozen proposal", async () => {
    const { payload, candidate, operation } = fixture();
    const replies = [{ hash: "base-hash" }, { valid: true, proposal_hash: "proposal-hash" }, { applied: true, proposal_hash: "proposal-hash" }, { applied: true }];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: replies.shift() }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const handler = new WikiFrozenAssetHandler({ baseUrl: "http://127.0.0.1:8421", token: "secret", serviceId: "instance" });
    expect(await handler.snapshot(candidate, payload)).toMatchObject({ base_hash: payload.base_hash, details: { wiki_proposal_hash: "proposal-hash" } });
    await handler.write(operation, candidate, payload); expect(await handler.verify(operation, candidate, payload)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(globalThis.fetch).mock.calls) {
      expect(String(call[0])).toMatch(/^http:\/\/127\.0\.0\.1:8421\/v3\/internal\/evolution\/wiki\//);
      expect((call[1]?.headers as Record<string, string>).authorization).toBe("Bearer secret");
    }
  });
  it("rejects a changed base without reaching apply", async () => {
    const { payload, candidate } = fixture();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { hash: "changed" } }), { status: 200 })) as typeof fetch;
    await expect(new WikiFrozenAssetHandler({ baseUrl: "http://127.0.0.1:8421", token: "secret", serviceId: "instance" }).snapshot(candidate, payload)).rejects.toThrow("WIKI_BASE_STALE");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
