# Production Agent Frameworks: Memory & Skill Persistence

Evidence-backed research for a memory-layer engineering team. **Verified-primary** = I read the official doc/source. **Secondhand** = blog/commentary, labeled inline. Every substantive claim links to its source.

---

## A) OpenClaw

Repo: [`github.com/openclaw/openclaw`](https://github.com/openclaw/openclaw) (linked from the docs nav). Docs root: [`docs.openclaw.ai`](https://docs.openclaw.ai/concepts/memory) (a `docs2.openclaw.ai` alias also serves the same content). The product is the "clawd" lineage — primary evidence is that skill frontmatter still accepts a legacy `metadata.clawdbot` block ([skills docs](https://docs.openclaw.ai/tools/skills)); the broader "clawdbot → moltbot → openclaw" rename chain is **secondhand** ([apidog blog](https://apidog.com/blog/openclaw-memory/)) and not stated in the pages I read.

### Memory: static files + one SQLite index

OpenClaw is explicitly "no hidden state": the model only remembers what is written to files in the agent workspace, default `~/.openclaw/workspace` ([memory overview](https://docs.openclaw.ai/concepts/memory)).

| Surface | Role | Injection |
|---|---|---|
| `AGENTS.md` + workspace instruction files | Human-authored instructions | Always, session start |
| `MEMORY.md` | Curated durable facts | Session start, provenance-gated, budgeted |
| `USER.md` (optional) | Directive user model ("Always/Never/Prefer") | Session start, separate small budget |
| `memory/YYYY-MM-DD.md` (or `-<slug>`) | Daily notes / episodic | Never auto-injected; searchable |
| `DREAMS.md` | Dream Diary, promotion summaries | Never; human review |
| SQLite | Index + provenance + intents + dreaming state | n/a |

Sources: [memory architecture](https://docs.openclaw.ai/concepts/memory-architecture), [memory overview](https://docs.openclaw.ai/concepts/memory).

The index is a per-agent SQLite DB at `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` with **FTS5/BM25** plus **sqlite-vec** vector search; files are chunked **400 tokens with 80-token overlap** and watched with a **1.5s debounce** ([builtin engine](https://docs.openclaw.ai/concepts/memory-builtin)). So OpenClaw is a hybrid: Markdown is canonical, SQLite is derived.

**Injection mechanics.** `MEMORY.md`/`USER.md` bootstrap in when provenance is eligible; over budget, the on-disk file is kept but the injected copy is truncated. Ranked recall scores hybrid relevance × 30-day-half-life recency decay × importance, with `memory.search.query.maxResults: 6` and `minScore: 0.35` defaults. Writers attach trailing annotations that become nullable SQLite columns: `<!-- trigger: phrase one, phrase two -->` and `<!-- importance: N -->` (1–10); trigger matches at **score ≥ 0.72**, **max 3 per turn**, curated tier only ([memory config](https://docs.openclaw.ai/reference/memory-config), [architecture](https://docs.openclaw.ai/concepts/memory-architecture)).

### Hooks / lifecycle around memory

- **Pre-compaction memory flush**: before compaction, a *silent turn* reminds the agent to save unwritten context to memory files. On by default; `agents.defaults.compaction.memoryFlush.enabled: false` disables it ([memory overview](https://docs.openclaw.ai/concepts/memory)). It can be pinned to a local model (`...memoryFlush.model`), and it uses a private copy of the conversation ([compaction](https://docs.openclaw.ai/concepts/compaction)).
- **Compaction** is auto-on; manual `/compact` focus is capped at **800 code points**; `keepRecentTokens` default **20,000**; default mode is `"safeguard"` with summary quality audits ([compaction](https://docs.openclaw.ai/concepts/compaction)).
- **Dreaming** (reflection job) is default-on, cron `0 3 * * *`, phases **light → REM → deep**. Deep is the only writer to `MEMORY.md` ([dreaming](https://docs.openclaw.ai/concepts/dreaming)).
- **Internal events**: `session:compact:before`, `session:compact:after`, `agent:bootstrap`, `command:new/reset`, `session:auto-reset`, `message:received/sent` ([event types](https://docs.openclaw.ai/automation/hooks/event-types)).
- **Plugin typed hooks**: `before_compaction`, `after_compaction`, `session_start`, `session_end`, `before_tool_call`, `agent_end`, plus skill lifecycle hooks `skill_proposal_evaluate`, `skill_proposal_changed`, `skill_changed` ([hook reference](https://docs.openclaw.ai/plugins/hooks/reference)).
- **Bundled `session-memory` hook**: on `/new`, `/reset`, or auto-rollover it writes `<workspace>/memory/YYYY-MM-DD-HHMM.md`, default **15 messages**, bounded to **4,096 scanned messages / 8 MiB** ([bundled hooks](https://docs.openclaw.ai/automation/hooks/bundled-hooks)).

### Skills: SKILL.md + a real review pipeline

Format is `SKILL.md` with YAML frontmatter — required `name`, `description`; optional `user-invocable`, `disable-model-invocation`, `command-dispatch: tool`, `command-tool`, `command-arg-mode`, `homepage`; gating via `metadata.openclaw.requires.{bins,anyBins,env,config}`, `os`, `always`, `primaryEnv`, `install` ([skills](https://docs.openclaw.ai/tools/skills), [creating skills](https://docs.openclaw.ai/tools/creating-skills)). Load precedence is 8 tiers from `<workspace>/skills` (highest) down to `skills.load.extraDirs` + plugin skills (lowest); discovery walks up to **6 levels** deep; sessions snapshot the list at start and refresh via a watcher with a **250 ms debounce**. Prompt cost is ~**97 chars ≈ 24 tokens per skill** before field lengths, bounded by `skills.limits.maxSkillsPromptChars` ([skills](https://docs.openclaw.ai/tools/skills)).

**Can the agent author its own skills? Yes, through a governed path.** The `skill_workshop` tool and CLI (`propose-create`, `propose-update`, `inspect`, `evaluate`, `apply`, `reject`, `quarantine`) write only under `<state-dir>/agents/<agentId>/agent/workshop-skills` ([skill workshop](https://docs.openclaw.ai/tools/skill-workshop)). Self-learning modes are `off | propose | auto` (**default `auto`**) ([self-learning](https://docs.openclaw.ai/tools/self-learning)). Autonomous capture is heavily conditioned: the foreground turn must not end in a provider/prompt error, must use **≥ 10 model iterations**, be an eligible foreground conversation, the runtime must report `skill_workshop` availability, and the system must be quiet **30 seconds**. Caps: `maxPending: 50`, `maxSkillBytes: 40000` (autonomous proposals also a 10,000-char cap), descriptions capped at 160 bytes ([configuration](https://docs.openclaw.ai/tools/skill-workshop/configuration)).

### Subagents

`sessions_spawn` creates children in `agent:<agentId>:subagent:<uuid>`. Defaults: `maxSpawnDepth: 5` (range 1–5), `maxChildrenPerAgent: 5`, `maxConcurrent: 8`, `runTimeoutSeconds: 900`, `announceTimeoutMs: 120000`; `context: "fork"` opts into the parent transcript. Sub-agents lose session/message tools by default; orchestrators below the depth cap get `sessions_spawn`/`subagents`, leaves get none; results announce one level at a time ([subagents](https://docs.openclaw.ai/tools/subagents), [nesting](https://docs.openclaw.ai/tools/subagents/nesting)).

---

## B) Claude Code (Anthropic)

### CLAUDE.md hierarchy

Load order is broad → specific, all concatenated (not overridden), root → cwd ([memory docs](https://code.claude.com/docs/en/memory)):

| Scope | Location |
|---|---|
| Managed policy | `/Library/Application Support/ClaudeCode/CLAUDE.md`, `/etc/claude-code/CLAUDE.md`, `C:\Program Files\ClaudeCode\CLAUDE.md` |
| User | `~/.claude/CLAUDE.md` |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` |
| Local | `./CLAUDE.local.md` |

Imports use `@path` with a **max depth of four hops**; external (outside-cwd) imports prompt for approval. Target **< 200 lines**; files **over 4 MiB are skipped**. Subdirectory `CLAUDE.md` loads lazily when Claude reads there. Block-level HTML comments are stripped before injection. `.claude/rules/*.md` adds path-scoped rules via `paths:` frontmatter, with a brace-expansion budget of **1,000 patterns / 4 MiB**; `claudeMdExcludes` and the managed `claudeMd` key control inclusion. An `InstructionsLoaded` hook reports which files loaded and why.

**Two systems, per the docs**: CLAUDE.md = human-written instructions; **auto memory** = notes Claude writes itself. Both load every session.

### Auto memory (the automatic memory-extraction path)

- Location: `~/.claude/projects/<project>/memory/`, containing a `MEMORY.md` **index** plus one topic file per memory; `<project>` derives from the git repo, so worktrees share one directory.
- Frontmatter `type` is one of `user`, `feedback`, `project`, `reference`.
- **Only the first 200 lines or 25 KB of `MEMORY.md`** (whichever comes first) loads at session start; topic files load on demand.
- After each write, Claude Code measures the index and reminds Claude to shorten it; over the limit the write succeeds but returns an error telling Claude to rewrite the index. Writes with frontmatter get a `modified` ISO-8601 timestamp.
- Controlled by `autoMemoryEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `autoMemoryDirectory`; browsing via `/memory`.
- Claude decides what is worth remembering, and skips anything derivable from the codebase or already in CLAUDE.md.

### Skills, subagents, hooks

- **Skills**: `SKILL.md` per [agentskills.io](https://agentskills.io); directory name becomes `/command`; locations are enterprise, personal (`~/.claude/skills/`), project (`.claude/skills/`), nested, `--add-dir`, plugin, and claude.ai-synced. Precedence: enterprise > personal > project. **Progressive disclosure** is real: only one-line descriptions sit in the startup listing (the docs' simulation budgets ~450 tokens); the body loads on use. Frontmatter controls `disable-model-invocation`, `user-invocable`, `allowed-tools`/`disallowed-tools`, `context: fork`, `agent`, `background`, `$ARGUMENTS`, and dynamic injection via `` !`cmd` ``. Visibility is overridable with `skillOverrides` (`on`/`name-only`/`user-invocable-only`/`off`); `/skill-doctor` reports per-skill context cost; the `skill-creator` plugin and `claude plugin eval` run evals ([skills](https://code.claude.com/docs/en/skills)).
- **Subagents**: `.claude/agents/*.md` and `~/.claude/agents/*.md`; scope precedence managed > `--agents` > project > user > plugin. Frontmatter includes `tools`, `model`, `skills`, `memory`, `isolation: worktree`, `omitClaudeMd`, `maxTurns`, `hooks`. The subagent description listing warns at **15,000 tokens**; nesting defaults to **3 layers** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); concurrent limit **20** (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). A subagent's `memory: user|project|local` field gives it its own directory (`~/.claude/agent-memory/<name>/`, etc.) — but if auto memory is off, the field has no effect ([subagents](https://code.claude.com/docs/en/sub-agents)).
- **Hooks**: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStart/Stop`, `InstructionsLoaded`, `PreCompact`, `PostCompact`, `SessionEnd`, and more. Exit code 2 is the blocking signal; `PostToolUse` can return `additionalContext`; `SessionStart` with the `compact` source re-injects context after compaction ([hooks](https://code.claude.com/docs/en/hooks)).

### Compaction and the manual/automatic boundary

After compaction: project-root CLAUDE.md, unscoped rules, auto memory, and the plan are re-injected from disk; path-scoped rules and nested CLAUDE.md reload lazily; up to **five** most recently modified files are re-read; **invoked skill bodies are re-injected, capped at 5,000 tokens per skill and 25,000 total**, oldest dropped; **the skill description listing does not survive**; `SessionStart` hooks matching `compact` run ([context window](https://code.claude.com/docs/en/context-window)).

**Is skill creation automatic?** Only narrowly. `/run-skill-generator` gets an app running and writes a per-project `.claude/skills/run-<name>/`; `/verify` writes `.claude/skills/verify/SKILL.md` when it had to rediscover the recipe ([skills](https://code.claude.com/docs/en/skills)). There is no general automatic *skill synthesis* loop.

---

## C) Other frameworks

| Framework | Memory mechanism | Static / dynamic | Can the agent write it? | Quality gate before persisting? |
|---|---|---|---|---|
| **Codex CLI / AGENTS.md** | `AGENTS.md` spec (root + nested, nearest wins); plus **Memories** | AGENTS.md static; Memories generated files | AGENTS.md human; Memories by Codex | Consolidation pass exists; no numeric quality threshold documented |
| **Cursor** | `.cursor/rules/*.mdc` with `alwaysApply`/`description`/`globs`; `AGENTS.md` | Static files | Via explicit `/create-rule`, `/create-skill` | No |
| **Gemini CLI** | Hierarchical `GEMINI.md` + `save_memory` tool | Static files, agent-edited | Yes (`save_memory`) | No |
| **OpenHands** | Agent Skills spec + keyword- and path-triggered skills | Static files | Authoring is manual | No |
| **LangGraph / LangMem** | Semantic / episodic / procedural; collection or profile; `BaseStore` namespaces | Dynamic store + prompt | Yes, via tools | LLM-driven consolidation (soft), no hard threshold |
| **Cline** | Memory Bank: 6 markdown files | Static files, agent-edited | Yes | No |

Details and citations:

- **AGENTS.md** is a vendor-neutral Markdown convention, used by 60k+ repos, now stewarded by the Agentic AI Foundation under the Linux Foundation; nested files mean "the closest AGENTS.md to the edited file wins," and explicit user prompts override everything ([agents.md](https://agents.md/)).
- **OpenAI Codex** keeps AGENTS.md and adds off-by-default **Memories**: enable with `memories = true` under `[features]` in `~/.codex/config.toml`. Codex turns eligible prior threads into local files under `~/.codex/memories/`, **skips active/short-lived sessions**, **redacts secrets**, and updates **in the background after the thread goes idle**. Config exposes `memories.generate_memories`, `memories.use_memories`, `memories.disable_on_external_context`, `memories.min_rate_limit_remaining_percent`, `memories.extract_model`, and `memories.consolidation_model`; `/memories` controls it per thread ([Codex memories](https://developers.openai.com/codex/memories) — **live page returned HTTP 403; content read from a [GitHub mirror of the official docs](https://raw.githubusercontent.com/crasuna/openai-dev-docs-cn-mirror/main/sources/en/codex/memories.md)**).
- **Cursor**: project rules are `.mdc` files whose `alwaysApply`/`description`/`globs` determine inclusion; plain `.md` is ignored; `AGENTS.md` is the plain-markdown alternative ([rules](https://cursor.com/docs/rules)). Skills follow the Agent Skills standard, load from `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, and also from `.claude/skills/` and `.codex/skills/`; built-ins include `/create-skill`, `/create-rule`, `/create-subagent`, `/migrate-to-skills` ([Cursor skills](https://cursor.com/docs/skills)).
- **Gemini CLI** concatenates `GEMINI.md` from `~/.gemini/GEMINI.md`, workspace + parent dirs, and JIT files discovered when a tool touches a directory; `@file.md` imports are supported; `/memory show|reload` inspects it, and `context.fileName` renames it ([GEMINI.md](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/gemini-md.md)). The `save_memory` tool routes facts to shared project `GEMINI.md`, a per-project private folder, or the global `~/.gemini/GEMINI.md`, editing via `write_file`/`replace`; facts are then included in all future sessions ([memory tool](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/memory.md)).
- **OpenHands** now documents **Skills** (Agent Skills spec plus keyword-triggered skills and path-triggered rules) with progressive disclosure and a skill-location precedence list ([OpenHands skills](https://docs.openhands.dev/overview/skills)).
- **LangMem** defines semantic, episodic, and procedural memory, and frames every operation as: accept conversation(s) + current memory state → **prompt an LLM to decide how to expand or consolidate** → return updated state. Collections insert/delete/update; profiles overwrite a single document. APIs: `create_memory_manager`, `create_memory_store_manager`, `create_prompt_optimizer(kind="metaprompt", config={"max_reflection_steps": 3})`; storage is LangGraph `BaseStore` with namespaces and semantic/metadata retrieval ([LangMem concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)).
- **Cline's Memory Bank** is a methodology, not built-in storage: six markdown files (`projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`) under `memory-bank/`, driven by custom instructions placed in a `.clinerules` file ([Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank)).

---

## D) Static vs dynamic — and who actually gates a write?

**(1) Static files a human edits**: `AGENTS.md` ([agents.md](https://agents.md/)), most CLAUDE.md scopes, Cursor `.mdc` rules, OpenHands skills.

**(2) Files the agent edits**: Claude Code auto memory and subagent `agent-memory/`; Gemini CLI `save_memory`; Cline Memory Bank; OpenHands/Cursor skills written by an explicitly-invoked authoring skill. Claude Code auto memory adds a *size* gate (200 lines / 25 KB on the index; "merge or drop stale entries" reminder) but no admission threshold ([memory](https://code.claude.com/docs/en/memory)).

**(3) Dynamic vector/DB stores**: OpenClaw's per-agent SQLite (FTS5 + sqlite-vec, 400/80-token chunks); LangGraph `BaseStore` ([builtin engine](https://docs.openclaw.ai/concepts/memory-builtin), [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)).

**(4) Learned/compiled artifacts**: OpenClaw `MEMORY.md`/`USER.md` after dreaming, `DREAMS.md`, Workshop skills; Codex `~/.codex/memories/`; LangMem profile documents.

**The decisive finding — almost nobody has a hard quality gate. OpenClaw does, and it is the only system I could verify with all three of: deterministic promotion thresholds, a structural provenance veto, and an independent skill-evaluation veto.**

- **Memory promotion gate (deterministic + model inside it).** Dreaming's deep phase ranks candidates by weighted signals — **relevance 0.30, frequency 0.24, query diversity 0.15, recency 0.15, consolidation 0.10, conceptual richness 0.06** — and requires `minScore`, `minRecallCount`, and `minUniqueQueries` to all pass. Candidates with origin class `untrusted` or `system` are removed **structurally, before any prompt is built** — "this is a precondition, not a score penalty." Only then does a model perform merge/supersede/dedupe. The rewrite is rejected unless it preserves prior entries within `phases.deep.maxPriorEntryLossFraction: 0.25`, stays within the bootstrap budget, parses as structured output, and keeps every promoted candidate's `Source: path#Lx-Ly`. A rejected rewrite falls back to append-only. Writes to `MEMORY.md` use optimistic concurrency (content-hash recheck before atomic rename) and store a preimage ([architecture](https://docs.openclaw.ai/concepts/memory-architecture), [dreaming](https://docs.openclaw.ai/concepts/dreaming), [memory config](https://docs.openclaw.ai/reference/memory-config)).
- **Skill gate.** Proposals pass static scanning, content-hash binding, size validation, and rollback metadata; a `skill_proposal_evaluate` hook lets third-party evaluators (including model graders) return a `decision`, and **only a completed `decision: "block"` vetoes apply** — errors are recorded as attributed outcomes rather than failing the run ([hook reference](https://docs.openclaw.ai/plugins/hooks/reference)).
- **Skip-list / abstention.** The self-learning reviewer must abstain for routine work, personal facts and simple preferences, transient failures, generic advice, unsupported negative claims, and secrets ([self-learning](https://docs.openclaw.ai/tools/self-learning)).

**Everyone else, by contrast, mostly appends or overwrites:**
- Codex runs a background extraction + **consolidation** pass with a dedicated `memories.consolidation_model`, but the documented gates are *eligibility* gates (idle threshold, skip active sessions, secret redaction, rate-limit floor) — not quality thresholds.
- Claude Code auto memory is model judgment ("it decides what's worth remembering") plus an index-length guard; no promotion score, dedupe pass, or human review step is documented.
- LangMem consolidates via an LLM with configurable instructions and `enable_inserts`, and explicitly warns that over-extraction reduces precision — a soft, prompt-level control.
- Gemini CLI `save_memory`, Cline Memory Bank, AGENTS.md/Cursor rules, and OpenHands skills have no gating documented at all.

---

## Could not verify

1. **OpenClaw's "clawdbot"/"moltbot" lineage** — only indirect primary evidence (legacy `metadata.clawdbot` frontmatter, `discord.gg/clawd`); the rename history itself is secondhand.
2. **Cursor "Memories"** — `cursor.com/docs/context/memories` redirects to `/docs/rules`, and the current Customize sidebar lists Rules/Skills/Subagents/Hooks/MCP but no Memories page. I could not confirm whether the feature still exists.
3. **Windsurf** — `docs.windsurf.com` now cross-origin-redirects to `docs.devin.ai`; I could not read its rules or memories pages, so **no Windsurf facts are included**.
4. **Devin, Sourcegraph Amp, Agent Zero, AutoGen, CrewAI, SWE-agent** — not verified in this pass; omitted rather than guessed.
5. **Claude Code `#` shortcut** for adding to memory — not present in the current memory docs I read; could not verify it still exists.
6. **OpenHands "microagents"** — the legacy `microagents-overview` path 404s/redirects to the new Skills docs; the microagent terminology and keyword-trigger file layout are unconfirmed.
7. **OpenAI Codex memories live page** — returned HTTP 403; facts come from a GitHub mirror of the official docs (labeled above).
8. **OpenClaw bootstrap file budget defaults** — the pages reference a "bootstrap file budget" and truncation but I did not read the numeric default; per-file injection caps I *did* verify are for `bootstrap-extra-files` (20,000 chars/file, 60,000 total, `USER.md` 4,000).
