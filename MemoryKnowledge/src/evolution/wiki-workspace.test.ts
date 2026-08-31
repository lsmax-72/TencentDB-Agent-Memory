import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWikiProposal, applyWikiProposal, recoverWikiApply, snapshotWiki } from "./wiki-workspace.js";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wiki-evolution-test-")); roots.push(root);
  mkdirSync(join(root, "raw/sources"), { recursive: true }); mkdirSync(join(root, "wiki"));
  writeFileSync(join(root, "raw/sources/manual.md"), "source"); writeFileSync(join(root, "wiki/page.md"), "old");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("Wiki frozen publication", () => {
  it("generates in isolation and applies exact frozen bytes without another model call", async () => {
    const root = fixture(); let calls = 0;
    const proposal = await prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => { calls++; writeFileSync(join(shadow, "wiki/page.md"), "final merged content"); });
    expect(readFileSync(join(root, "wiki/page.md"), "utf8")).toBe("old");
    await applyWikiProposal(root, proposal, join(root, "journal.json"), async () => {});
    expect(calls).toBe(1); expect(readFileSync(join(root, "wiki/page.md"), "utf8")).toBe("final merged content");
    expect(JSON.parse(readFileSync(join(root, "journal.json"), "utf8")).status).toBe("APPLIED");
    await expect(applyWikiProposal(root, proposal, join(root, "journal.json"), async () => {})).rejects.toThrow("ALREADY_STARTED");
  });
  it("rejects source changes and locked-page mutation", async () => {
    const root = fixture();
    const proposal = await prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => { writeFileSync(join(shadow, "wiki/page.md"), "new"); });
    writeFileSync(join(root, "raw/sources/manual.md"), "changed source");
    await expect(applyWikiProposal(root, proposal, join(root, "journal.json"), async () => {})).rejects.toThrow("BASE_STALE");
    writeFileSync(join(root, "wiki/page.md"), "---\nlocked: true\n---\nprotected");
    await expect(prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => { writeFileSync(join(shadow, "wiki/page.md"), "new"); })).rejects.toThrow("LOCKED_PAGE_CHANGED");
  });
  it("preserves a failed application and restores before-images after index failure", async () => {
    const root = fixture(); const before = snapshotWiki(root);
    const proposal = await prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => { writeFileSync(join(shadow, "wiki/page.md"), "new"); });
    const journal = join(root, "journal.json");
    await expect(applyWikiProposal(root, proposal, journal, async () => { throw new Error("index down"); })).rejects.toThrow("index down");
    expect(JSON.parse(readFileSync(journal, "utf8")).status).toBe("RECOVERY_REQUIRED");
    await recoverWikiApply(root, journal, async () => {});
    expect(snapshotWiki(root)).toEqual(before);
    expect(JSON.parse(readFileSync(journal, "utf8")).status).toBe("ROLLED_BACK");
  });
  it("refuses symlinks", async () => {
    const root = fixture(); symlinkSync(join(root, "raw"), join(root, "wiki/link"));
    expect(() => snapshotWiki(root)).toThrow("SYMLINK_REJECTED");
  });
  it("keeps unrelated edits and corrupted journals blocked before any recovery writes", async () => {
    const root = fixture();
    const proposal = await prepareWikiProposal(root, join(root, "candidates"), ["raw/sources/manual.md"], async shadow => { writeFileSync(join(shadow, "wiki/page.md"), "new"); });
    const journal = join(root, "journal.json");
    await expect(applyWikiProposal(root, proposal, journal, async () => { throw new Error("index down"); })).rejects.toThrow();
    writeFileSync(join(root, "raw/sources/manual.md"), "concurrent edit");
    await expect(recoverWikiApply(root, journal, async () => {})).rejects.toThrow("RECOVERY_CONFLICT");
    expect(readFileSync(join(root, "wiki/page.md"), "utf8")).toBe("new");
    const corrupted = JSON.parse(readFileSync(journal, "utf8"));
    corrupted.proposal.files[0].before = Buffer.from("not the original").toString("base64");
    writeFileSync(journal, JSON.stringify(corrupted));
    await expect(recoverWikiApply(root, journal, async () => {})).rejects.toThrow("ARTIFACT_MISMATCH");
    expect(readFileSync(join(root, "wiki/page.md"), "utf8")).toBe("new");
  });
});
