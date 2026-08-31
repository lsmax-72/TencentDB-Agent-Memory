import { basename } from "node:path";
import { extractSource, commitCandidates, scanExistingPages } from "../engines/wiki/ingest-v2/index.js";
import { rebuildIndexFile } from "../engines/wiki/ingest-v2/index-builder.js";
import { parseFrontmatter } from "../engines/wiki/ingest-v2/frontmatter.js";
import type { LlmClient } from "../engines/wiki/ingest-v2/llm.js";
import { prepareWikiProposal, type FrozenWikiProposal } from "./wiki-workspace.js";

/** The caller provides a per-call budgeted client. No environment/model fallback is constructed here. */
export async function produceNativeWiki(input: {
  root: string; workspaceRoot: string; sourcePaths: string[]; client: LlmClient;
}): Promise<FrozenWikiProposal> {
  const proposal = await prepareWikiProposal(input.root, input.workspaceRoot, input.sourcePaths, async (shadow, source) => {
    const candidates = await extractSource(shadow, source, {}, scanExistingPages(shadow), { llm: input.client });
    const result = await commitCandidates(shadow, [{ sourceFilename: basename(source), candidates }], input.client);
    // Legacy ingest tolerates partial merge/index failures. A frozen candidate may not.
    if (result.mergeErrors.length) throw new Error("WIKI_ISOLATED_MERGE_FAILED");
    if (!result.written.length) throw new Error("WIKI_NO_WRITABLE_PAGE");
    rebuildIndexFile(shadow);
  });
  const knownSources = new Set(Object.keys(proposal.base.files).filter(path => path.startsWith("raw/sources/")).map(path => basename(path)));
  for (const file of proposal.files) {
    if (["wiki/index.md", "wiki/log.md"].includes(file.path)) continue;
    const page = parseFrontmatter(Buffer.from(file.after, "base64").toString("utf8"));
    if (!page.hasFrontmatter || !page.body.trim() || !Array.isArray(page.frontmatter.sources)
      || !page.frontmatter.sources.length || page.frontmatter.sources.some(source => !knownSources.has(source))) throw new Error("WIKI_PAGE_SOURCE_INVALID");
  }
  return proposal;
}
