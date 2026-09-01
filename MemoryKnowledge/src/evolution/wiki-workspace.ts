import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { basename } from "node:path";
import { parseFrontmatter } from "../engines/wiki/ingest-v2/frontmatter.js";

export interface WikiSnapshot { files: Record<string, string>; hash: string }
export interface FrozenWikiProposal {
  revision: 1;
  base: WikiSnapshot;
  files: Array<{ path: string; before: string | null; after: string }>;
  source_paths: string[];
  hash: string;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safePath(root: string, relative: string): string {
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error("WIKI_SYMLINK_REJECTED");
  if (!/^(wiki|raw)\//.test(relative) || relative.includes("\\") || relative.includes("\0") || relative.split("/").some(part => !part || part === "." || part === "..")) throw new Error("WIKI_PATH_REJECTED");
  const target = resolve(root, relative);
  for (let current = target; current !== resolve(root); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("WIKI_SYMLINK_REJECTED");
  }
  return target;
}
export function snapshotWiki(root: string): WikiSnapshot {
  const files: Record<string, string> = {};
  let bytes = 0;
  function visit(relative: string) {
    const target = safePath(root, relative);
    if (!existsSync(target)) return;
    const stat = lstatSync(target);
    if (stat.isDirectory()) { for (const name of readdirSync(target).sort()) visit(`${relative}/${name}`); return; }
    if (!stat.isFile()) throw new Error("WIKI_SPECIAL_FILE_REJECTED");
    bytes += stat.size;
    if (bytes > 64 * 1024 * 1024 || Object.keys(files).length >= 1000) throw new Error("WIKI_SNAPSHOT_TOO_LARGE");
    files[relative] = readFileSync(target).toString("base64");
  }
  // Root paths retain the same path-validation rules as their descendants.
  for (const prefix of ["raw", "wiki"]) {
    const dir = join(root, prefix);
    if (!existsSync(dir)) continue;
    if (lstatSync(dir).isSymbolicLink()) throw new Error("WIKI_SYMLINK_REJECTED");
    for (const name of readdirSync(dir).sort()) visit(`${prefix}/${name}`);
  }
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { files: ordered, hash: hash(ordered) };
}

/** The supplied generator is the existing extract+merge pipeline, running only in this copy. */
export async function prepareWikiProposal(root: string, workspaceRoot: string, sources: string[], generate: (shadowRoot: string, sourcePath: string) => Promise<void>): Promise<FrozenWikiProposal> {
  const base = snapshotWiki(root);
  if (!sources.length || sources.some(source => !source.startsWith("raw/sources/") || !Object.hasOwn(base.files, source))) throw new Error("WIKI_SOURCE_REQUIRED");
  mkdirSync(workspaceRoot, { recursive: true });
  const shadow = mkdtempSync(join(workspaceRoot, "wiki-candidate-"));
  for (const [path, bytes] of Object.entries(base.files)) {
    const target = safePath(shadow, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(bytes, "base64"));
  }
  for (const source of sources) await generate(shadow, safePath(shadow, source));
  const after = snapshotWiki(shadow);
  const files: FrozenWikiProposal["files"] = [];
  for (const [path, bytes] of Object.entries(base.files)) {
    if (!(path in after.files)) throw new Error("WIKI_DELETE_NOT_ALLOWED");
    if (path.startsWith("raw/") && bytes !== after.files[path]) throw new Error("WIKI_SOURCE_MUTATED");
  }
  for (const [path, bytes] of Object.entries(after.files)) {
    if (bytes === base.files[path]) continue;
    if (!path.startsWith("wiki/") || !path.endsWith(".md")) throw new Error("WIKI_UNEXPECTED_OUTPUT");
    const before = base.files[path] ?? null;
    if (before && /^locked:\s*true\s*$/m.test(Buffer.from(before, "base64").toString("utf8"))) throw new Error("WIKI_LOCKED_PAGE_CHANGED");
    if (["wiki/schema.md", "wiki/purpose.md"].includes(path)) throw new Error("WIKI_PROTECTED_PAGE_CHANGED");
    if (Buffer.from(bytes, "base64").length > 512 * 1024) throw new Error("WIKI_PAGE_TOO_LARGE");
    files.push({ path, before, after: bytes });
  }
  if (!files.length) throw new Error("WIKI_NO_CHANGE");
  if (snapshotWiki(root).hash !== base.hash) throw new Error("WIKI_BASE_STALE");
  const payload = { revision: 1 as const, base, files, source_paths: [...sources] };
  return { ...payload, hash: hash(payload) };
}

function durableWrite(file: string, bytes: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.evo-${randomUUID()}`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
  const directory = openSync(dirname(file), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export interface WikiApplyJournal { proposal: FrozenWikiProposal; status: "APPLYING" | "APPLIED" | "RECOVERY_REQUIRED" | "ROLLED_BACK" }

export function validateFrozenWikiProposal(root: string, proposal: FrozenWikiProposal): void {
  const { hash: expected, ...payload } = proposal;
  if (proposal.revision !== 1 || hash(payload) !== expected || hash(proposal.base.files) !== proposal.base.hash) throw new Error("WIKI_ARTIFACT_MISMATCH");
  if (!proposal.files.length || !proposal.source_paths.length || proposal.source_paths.some(path => !path.startsWith("raw/sources/") || !Object.hasOwn(proposal.base.files, path))) throw new Error("WIKI_SOURCE_REQUIRED");
  const paths = new Set<string>();
  for (const file of proposal.files) {
    safePath(root, file.path);
    if (paths.has(file.path) || !file.path.startsWith("wiki/") || !file.path.endsWith(".md")) throw new Error("WIKI_UNEXPECTED_OUTPUT");
    paths.add(file.path);
    if (["wiki/schema.md", "wiki/purpose.md"].includes(file.path)) throw new Error("WIKI_PROTECTED_PAGE_CHANGED");
    if ((proposal.base.files[file.path] ?? null) !== file.before || file.before === file.after) throw new Error("WIKI_ARTIFACT_MISMATCH");
    if (file.before && /^locked:\s*true\s*$/m.test(Buffer.from(file.before, "base64").toString("utf8"))) throw new Error("WIKI_LOCKED_PAGE_CHANGED");
    const decoded = Buffer.from(file.after, "base64");
    if (decoded.toString("base64") !== file.after || decoded.length > 512 * 1024) throw new Error("WIKI_INVALID_PAGE");
  }
}

/** True only for provenance-list normalization that leaves every page body and other metadata unchanged. */
export function isMechanicalWikiMaintenance(proposal: FrozenWikiProposal): boolean {
  try {
    validateFrozenWikiProposal(".", proposal);
    const known = new Set(Object.keys(proposal.base.files).filter(path => path.startsWith("raw/sources/")).map(path => basename(path)));
    return proposal.files.every(file => {
      if (file.before === null) return false;
      const before = parseFrontmatter(Buffer.from(file.before, "base64").toString("utf8"));
      const after = parseFrontmatter(Buffer.from(file.after, "base64").toString("utf8"));
      if (!before.hasFrontmatter || !after.hasFrontmatter || before.body !== after.body) return false;
      const beforeSources = Array.isArray(before.frontmatter.sources) ? before.frontmatter.sources.filter((v): v is string => typeof v === "string") : [];
      const afterSources = Array.isArray(after.frontmatter.sources) ? after.frontmatter.sources.filter((v): v is string => typeof v === "string") : [];
      const beforeMeta = { ...before.frontmatter, sources: undefined }, afterMeta = { ...after.frontmatter, sources: undefined };
      return hash(beforeMeta) === hash(afterMeta) && afterSources.length === new Set(afterSources).size
        && beforeSources.every(source => afterSources.includes(source)) && afterSources.every(source => known.has(source));
    });
  } catch { return false; }
}

/** Caller must hold the Wiki service's exclusive mutation boundary across this operation. */
export async function applyWikiProposal(root: string, proposal: FrozenWikiProposal, journalPath: string, syncAndVerifyIndex: () => Promise<void>): Promise<void> {
  validateFrozenWikiProposal(root, proposal);
  if (existsSync(journalPath)) throw new Error("WIKI_APPLY_ALREADY_STARTED");
  if (snapshotWiki(root).hash !== proposal.base.hash) throw new Error("WIKI_BASE_STALE");
  const journal: WikiApplyJournal = { proposal, status: "APPLYING" };
  durableWrite(journalPath, Buffer.from(JSON.stringify(journal)));
  try {
    for (const file of proposal.files) durableWrite(safePath(root, file.path), Buffer.from(file.after, "base64"));
    await syncAndVerifyIndex();
    for (const file of proposal.files) if (readFileSync(safePath(root, file.path)).toString("base64") !== file.after) throw new Error("WIKI_APPLY_READBACK_MISMATCH");
    journal.status = "APPLIED";
    durableWrite(journalPath, Buffer.from(JSON.stringify(journal)));
  } catch (error) {
    journal.status = "RECOVERY_REQUIRED";
    durableWrite(journalPath, Buffer.from(JSON.stringify(journal)));
    throw error;
  }
}

/** Recovery never overwrites an unrelated concurrent change; keep that case blocked. */
export async function recoverWikiApply(root: string, journalPath: string, syncAndVerifyIndex: () => Promise<void>): Promise<void> {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as WikiApplyJournal;
  if (!["APPLYING", "RECOVERY_REQUIRED"].includes(journal.status)) throw new Error("WIKI_NOT_RECOVERABLE");
  validateFrozenWikiProposal(root, journal.proposal);
  // Check the whole snapshot before restoring any byte, not only the proposed pages.
  const currentSnapshot = snapshotWiki(root);
  const proposedPaths = new Set(journal.proposal.files.map(file => file.path));
  for (const path of new Set([...Object.keys(currentSnapshot.files), ...Object.keys(journal.proposal.base.files)])) {
    if (!proposedPaths.has(path) && currentSnapshot.files[path] !== journal.proposal.base.files[path]) throw new Error("WIKI_RECOVERY_CONFLICT");
  }
  for (const file of journal.proposal.files) {
    const target = safePath(root, file.path);
    const current = existsSync(target) ? readFileSync(target).toString("base64") : null;
    if (current !== file.before && current !== file.after) throw new Error("WIKI_RECOVERY_CONFLICT");
  }
  for (const file of journal.proposal.files) {
    const target = safePath(root, file.path);
    if (file.before === null) { if (existsSync(target)) unlinkSync(target); }
    else durableWrite(target, Buffer.from(file.before, "base64"));
  }
  await syncAndVerifyIndex();
  if (snapshotWiki(root).hash !== journal.proposal.base.hash) throw new Error("WIKI_RECOVERY_READBACK_MISMATCH");
  journal.status = "ROLLED_BACK";
  durableWrite(journalPath, Buffer.from(JSON.stringify(journal)));
}

/** Read-only verification for a Core reconciliation. It never repairs or rewrites content. */
export function verifyWikiApply(root: string, journalPath: string, proposal: FrozenWikiProposal): boolean {
  try {
    validateFrozenWikiProposal(root, proposal);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as WikiApplyJournal;
    if (journal.status !== "APPLIED" || journal.proposal.hash !== proposal.hash) return false;
    return proposal.files.every(file => existsSync(safePath(root, file.path)) && readFileSync(safePath(root, file.path)).toString("base64") === file.after);
  } catch { return false; }
}
