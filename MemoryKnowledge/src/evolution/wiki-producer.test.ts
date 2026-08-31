import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { produceNativeWiki } from "./wiki-producer.js";
import { snapshotWiki, applyWikiProposal } from "./wiki-workspace.js";
import type { LlmClient } from "../engines/wiki/ingest-v2/llm.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(join(tmpdir(), "native-wiki-evolution-")); roots.push(root);
  mkdirSync(join(root, "raw/sources"), { recursive: true }); mkdirSync(join(root, "wiki"));
  writeFileSync(join(root, "raw/sources/manual.md"), "离线材料：此文档描述导入后的知识页面结构。");
  return { root, workspaceRoot: join(root, "candidates"), sourcePaths: ["raw/sources/manual.md"] };
}
describe("reuse native Wiki extraction and merging in isolation", () => {
  it("finishes native generation before freeze and exact adoption never calls the client", async () => {
    const input = setup(), before = snapshotWiki(input.root); let calls = 0;
    const client: LlmClient = { config: { protocol: "openai", baseUrl: "http://unused.invalid", apiKey: "offline", model: "offline", maxTokens: 1000, timeoutMs: 1000, stream: false },
      chat: async params => { calls++; return params.label?.startsWith("analysis:") ? "Build a source page" : '<<<FILE path="wiki/sources/manual.md">>>\n---\ntype: source\ntitle: 材料说明\nsources:\n  - manual.md\n---\n此材料描述知识页面结构。\n<<<END>>>'; },
    };
    const proposal = await produceNativeWiki({ ...input, client });
    expect(calls).toBeGreaterThan(0); expect(snapshotWiki(input.root)).toEqual(before);
    const frozenCalls = calls;
    await applyWikiProposal(input.root, proposal, join(input.root, "journal.json"), async () => {});
    expect(calls).toBe(frozenCalls);
    // Native ingest canonicalizes the filename from the page title; adopt that frozen path.
    const generatedPage = proposal.files.find(file => file.path.startsWith("wiki/sources/"));
    expect(generatedPage).toBeDefined();
    expect(readFileSync(join(input.root, generatedPage!.path), "utf8")).toContain("此材料描述知识页面结构");
  });
});
