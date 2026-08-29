import { createHash, randomUUID } from "node:crypto";
import { parseSkillFile, validateSkillFile } from "./skill-format.js";
import type { SkillToolsBackend } from "./skill-tools.js";
import type {
  CreateInput,
  GetInput,
  ListInput,
  PatchInput,
  SearchInput,
  UpdateInput,
  WriteFilesInput,
} from "./skill-core.js";
import type { SkillSearchResult } from "./skill-store.interface.js";
import type { Skill } from "./types.js";
import type { CandidateArtifact } from "./candidate-types.js";

export type CandidateWorkspaceErrorCode =
  | "INVALID_FRONTMATTER"
  | "SKILL_NAME_DUPLICATE"
  | "SKILL_NOT_FOUND"
  | "SKILL_VERSION_STALE"
  | "SKILL_PATCH_NOT_UNIQUE"
  | "RESOURCE_MUTATION_NOT_SUPPORTED_V1";

export class CandidateWorkspaceError extends Error {
  constructor(public readonly code: CandidateWorkspaceErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "CandidateWorkspaceError";
  }
}

interface CandidateEntry {
  candidateId: string;
  operation: "CREATE" | "UPDATE";
  base: Skill | null;
  current: Skill;
  source: CandidateArtifact["source"];
  createdAt: string;
}

export interface CandidateSkillWorkspaceOptions {
  official: SkillToolsBackend;
  idFactory?: () => string;
  now?: () => Date;
}

/**
 * Session-local Skill backend for review-agent writes.
 * Official Skill data is snapshotted on first view and never mutated.
 */
export class CandidateSkillWorkspace implements SkillToolsBackend {
  private readonly official: SkillToolsBackend;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly entries = new Map<string, CandidateEntry>();

  constructor(options: CandidateSkillWorkspaceOptions) {
    this.official = options.official;
    this.idFactory = options.idFactory ?? (() => `candidate-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
  }

  async list(input: ListInput): Promise<{ items: Skill[]; total: number }> {
    const officialPage = await this.official.list({
      ...input,
      pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    });
    const byId = new Map(officialPage.items.map((skill) => [skill.skill_id, skill]));
    for (const [skillId, entry] of this.entries) {
      byId.set(skillId, entry.current);
    }
    const items = [...byId.values()]
      .filter((skill) => matchesListFilters(skill, input))
      .sort((a, b) => b.updated_at_ms - a.updated_at_ms);
    const offset = input.pagination?.offset ?? 0;
    const limit = input.pagination?.limit ?? 50;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async search(input: SearchInput): Promise<SkillSearchResult[]> {
    const officialHits = await this.official.search(input);
    const byId = new Map<string, SkillSearchResult>();
    for (const hit of officialHits) {
      const entry = this.entries.get(hit.skill.skill_id);
      byId.set(hit.skill.skill_id, entry ? { ...hit, skill: entry.current } : hit);
    }

    const query = input.query.trim().toLowerCase();
    for (const [skillId, entry] of this.entries) {
      const haystack = `${entry.current.name}\n${entry.current.description}\n${entry.current.content}`.toLowerCase();
      if (query && haystack.includes(query)) {
        byId.set(skillId, { skill: entry.current, score: 1 });
      }
    }
    return [...byId.values()].slice(0, input.top_k ?? 10);
  }

  async get(input: GetInput): Promise<Skill> {
    const existing = this.entries.get(input.skill_id);
    if (existing) {
      if (input.version === undefined || input.version === existing.current.version) {
        return cloneSkill(existing.current);
      }
      if (existing.base && input.version === existing.base.version) {
        return cloneSkill(existing.base);
      }
      return this.official.get(input);
    }

    const snapshot = cloneSkill(await this.official.get(input));
    this.entries.set(input.skill_id, {
      candidateId: this.idFactory(),
      operation: "UPDATE",
      base: cloneSkill(snapshot),
      current: snapshot,
      source: sourceOf(input),
      createdAt: this.now().toISOString(),
    });
    return cloneSkill(snapshot);
  }

  async create(input: CreateInput): Promise<Skill> {
    const file = parseAndValidate(input.content);
    if (file.name !== input.name) {
      throw new CandidateWorkspaceError(
        "INVALID_FRONTMATTER",
        `frontmatter.name '${file.name}' != body.name '${input.name}'`,
      );
    }

    const visible = await this.list({
      user_id: input.user_id,
      team_id: input.team_id,
      agent_id: input.agent_id,
      pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    });
    if (visible.items.some((skill) => skill.name === input.name)) {
      throw new CandidateWorkspaceError("SKILL_NAME_DUPLICATE", input.name);
    }

    const candidateId = this.idFactory();
    const skillId = `candidate-skill-${candidateId}`;
    const nowMs = this.now().getTime();
    const skill = makeSkill({
      skillId,
      version: 1,
      content: input.content,
      name: input.name,
      description: file.description,
      ids: input,
      nowMs,
    });
    this.entries.set(skillId, {
      candidateId,
      operation: "CREATE",
      base: null,
      current: skill,
      source: sourceOf(input),
      createdAt: new Date(nowMs).toISOString(),
    });
    return cloneSkill(skill);
  }

  async update(input: UpdateInput): Promise<Skill> {
    const entry = await this.requireEntry(input);
    assertFresh(entry.current.version, input.expected_version);
    const file = parseAndValidate(input.content);
    if (file.name !== entry.current.name) {
      throw new CandidateWorkspaceError("INVALID_FRONTMATTER", "name change is not allowed");
    }
    entry.current = nextRevision(entry.current, input.content, file.description, this.now().getTime());
    return cloneSkill(entry.current);
  }

  async patch(input: PatchInput): Promise<Skill> {
    const entry = await this.requireEntry(input);
    assertFresh(entry.current.version, input.expected_version);
    const occurrences = countOccurrences(entry.current.content, input.old_string);
    if (occurrences === 0 || (occurrences > 1 && !input.replace_all)) {
      throw new CandidateWorkspaceError(
        "SKILL_PATCH_NOT_UNIQUE",
        occurrences === 0
          ? "old_string not found"
          : `old_string occurs ${occurrences} times; pass replace_all=true to replace all`,
      );
    }
    const content = input.replace_all
      ? entry.current.content.split(input.old_string).join(input.new_string)
      : entry.current.content.replace(input.old_string, input.new_string);
    const file = parseAndValidate(content);
    if (file.name !== entry.current.name) {
      throw new CandidateWorkspaceError("INVALID_FRONTMATTER", "patch attempted to rename skill");
    }
    entry.current = nextRevision(entry.current, content, file.description, this.now().getTime());
    return cloneSkill(entry.current);
  }

  async writeFiles(_input: WriteFilesInput): Promise<Skill> {
    throw new CandidateWorkspaceError(
      "RESOURCE_MUTATION_NOT_SUPPORTED_V1",
      "Candidate evaluation and promotion are SKILL.md-only in v1",
    );
  }

  exportCandidate(skillId: string): CandidateArtifact {
    const entry = this.entries.get(skillId);
    if (!entry) throw new CandidateWorkspaceError("SKILL_NOT_FOUND", skillId);
    const contentHash = sha256(entry.current.content);
    const baseVersion = entry.base?.version ?? 0;
    const artifactHash = sha256(JSON.stringify({
      skill_id: skillId,
      base_version: baseVersion,
      content_hash: contentHash,
      format: "SKILL_MD_V1",
    }));
    return {
      candidate_id: entry.candidateId,
      operation: entry.operation,
      skill_id: skillId,
      base_version: baseVersion,
      content: entry.current.content,
      content_hash: contentHash,
      artifact_hash: artifactHash,
      source: { ...entry.source },
      created_at: entry.createdAt,
    };
  }

  listCandidateSkillIds(): string[] {
    return [...this.entries.keys()];
  }

  private async requireEntry(input: GetInput): Promise<CandidateEntry> {
    let entry = this.entries.get(input.skill_id);
    if (!entry) {
      await this.get(input);
      entry = this.entries.get(input.skill_id);
    }
    if (!entry) throw new CandidateWorkspaceError("SKILL_NOT_FOUND", input.skill_id);
    return entry;
  }
}

function parseAndValidate(content: string): { name: string; description: string } {
  try {
    const file = parseSkillFile(content);
    validateSkillFile(file);
    return { name: file.frontmatter.name, description: file.frontmatter.description };
  } catch (error) {
    throw new CandidateWorkspaceError("INVALID_FRONTMATTER", (error as Error).message);
  }
}

function assertFresh(current: number, expected: number): void {
  if (current !== expected) {
    throw new CandidateWorkspaceError(
      "SKILL_VERSION_STALE",
      `expected v${expected}, current candidate revision is v${current}`,
    );
  }
}

function nextRevision(skill: Skill, content: string, description: string, nowMs: number): Skill {
  if (skill.content === content) return skill;
  return {
    ...skill,
    version: skill.version + 1,
    content,
    content_hash: sha256(content),
    description,
    updated_at_ms: nowMs,
  };
}

function makeSkill(input: {
  skillId: string;
  version: number;
  content: string;
  name: string;
  description: string;
  ids: CreateInput;
  nowMs: number;
}): Skill {
  return {
    row_id: input.skillId,
    skill_id: input.skillId,
    version: input.version,
    is_head: true,
    user_id: input.ids.user_id ?? "",
    owner_agent_id: input.ids.agent_id ?? "",
    team_id: input.ids.team_id ?? "",
    task_id: input.ids.task_id ?? "",
    name: input.name,
    description: input.description,
    content: input.content,
    content_hash: sha256(input.content),
    manifest: [],
    storage_dir: "",
    status: "active",
    metadata_json: "{}",
    created_at_ms: input.nowMs,
    updated_at_ms: input.nowMs,
  };
}

function sourceOf(input: { user_id?: string; team_id?: string; agent_id?: string; task_id?: string }) {
  return {
    user_id: input.user_id,
    team_id: input.team_id,
    agent_id: input.agent_id,
    task_id: input.task_id,
  };
}

function matchesListFilters(skill: Skill, input: ListInput): boolean {
  if (input.team_id && skill.team_id !== input.team_id) return false;
  if (input.agent_id && skill.owner_agent_id !== input.agent_id) return false;
  if (input.filters?.owner_agent_id && skill.owner_agent_id !== input.filters.owner_agent_id) return false;
  if (input.filters?.name_prefix && !skill.name.startsWith(input.filters.name_prefix)) return false;
  if (input.filters?.status && !input.filters.status.includes(skill.status)) return false;
  return true;
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function cloneSkill(skill: Skill): Skill {
  return { ...skill, manifest: skill.manifest.map((entry) => ({ ...entry })) };
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
