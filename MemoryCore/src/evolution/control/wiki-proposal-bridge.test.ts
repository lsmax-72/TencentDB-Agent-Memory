import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";
import type { ReviewBinding } from "./model-bindings.js";
import { WikiProposalBridge } from "./wiki-proposal-bridge.js";

const stores: SqliteMetadataStore[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.close()); vi.unstubAllGlobals(); });

function setup(response: () => Promise<Response>) {
  const metadata = new SqliteMetadataStore(":memory:"); metadata.init(); stores.push(metadata);
  const store = metadata.getEvolutionStore();
  store.saveProfile({ team_id: "team", agent_id: "agent", enabled: true, asset_kinds: ["wiki"], asset_ids: ["wiki"],
    daily_tokens: 20_000, daily_model_calls: 8, daily_candidates: 1, evaluation_profile_id: null, review_model_id: "review",
    auto_memory: false, auto_wiki_maintenance: false, authorized_by: "owner" }, 0);
  const source = store.append({ team_id: "team", owner_user_id: "owner", agent_id: "agent", kind: "diagnosis", origin: "runtime",
    status: "DIAGNOSED", title: "offline wiki diagnosis", asset_ids: ["wiki"], payload: { route: "wiki_gap" } }, "source", "owner");
  const job = store.append({ ...source, kind: "job", status: "RUNNING", parent_id: source.id,
    payload: { job_type: "proposal", source_id: source.id, source_hash: source.artifact_hash } }, "job", "owner");
  const fetch = vi.fn(response); vi.stubGlobal("fetch", fetch);
  const config = { provider: "openai-compatible" as const, model: "offline-review", base_url: "http://knowledge.invalid",
    api_key: "private-secret", max_output_tokens: 100, token_ceiling: 1000, timeout_ms: 1000, temperature: 0 as const, fallback: false as const };
  const binding: ReviewBinding = { id: "review", fingerprint: "f", model: { modelId: config.model, tokenCeiling: 1000, complete: vi.fn() },
    createWikiModelConfig: () => ({ ...config }) };
  return { store, source, job, fetch, binding, bridge: new WikiProposalBridge({ baseUrl: "http://knowledge.invalid", token: "bridge-token", serviceId: "instance" }) };
}

describe("budgeted Wiki proposal bridge", () => {
  it("reserves before the internal run and records complete non-secret usage evidence", async () => {
    const proposal = { revision: 1, base: { files: { "raw/sources/a.md": "YQ==" }, hash: "a".repeat(64) },
      files: [{ path: "wiki/a.md", before: null, after: "Yg==" }], source_paths: ["raw/sources/a.md"], hash: "b".repeat(64) };
    const test = setup(async () => Response.json({ code: 0, data: { proposal, usage: { input_tokens: 80, output_tokens: 20, model_calls: 2,
      calls: [{ label: "analysis:a", input_tokens: 50, output_tokens: 10 }, { label: "generate:a", input_tokens: 30, output_tokens: 10 }] } } }));
    expect(await test.bridge.generate(test.store, test.source, test.job, "wiki", test.binding, async () => true)).toEqual(proposal);
    expect(test.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(test.store.list("team"))).not.toContain("private-secret");
    expect(test.store.list("team", "job").filter(record => record.payload.job_type === "proposal_model_step")).toHaveLength(2);
  });

  it("keeps the conservative reservation and creates no step evidence when usage is missing", async () => {
    const test = setup(async () => Response.json({ code: 0, data: { proposal: {}, usage: null } }));
    await expect(test.bridge.generate(test.store, test.source, test.job, "wiki", test.binding, async () => true)).rejects.toThrow("WIKI_PROPOSAL_RESPONSE_INVALID");
    expect(test.store.list("team", "job").filter(record => record.payload.job_type === "proposal_model_step")).toHaveLength(0);
    expect(() => test.store.reserve(`${test.job.id}/wiki-model-batch`, "team", "agent", 8000, 8, 0)).toThrow("RESERVATION_ALREADY_USED");
  });
});
