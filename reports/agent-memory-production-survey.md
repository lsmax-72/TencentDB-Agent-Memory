# Production Agent Memory & Skill Evolution: An Architecture Survey

**Purpose.** A design-comparison reference for a team building a memory layer for agents. The question driving the whole document is in §4: *which systems have a real SELECTION mechanism — something that decides a learned item is good enough to keep or promote — versus which merely ACCUMULATE?*

**Evidence conventions used throughout.**

| Tag | Meaning |
|---|---|
| **[primary]** | I or a delegated researcher read the source directly: source code at a pinned path, the paper's own full text/abstract, or the vendor's own documentation. Fetch evidence (HTTP status, byte counts, grep hits) was captured. |
| **[secondhand]** | Third-party write-up, blog, or an unverified vendor comparison chart. |
| **[unverified]** | Explicitly flagged as something that could not be confirmed. Nothing in this document is guessed silently. |

Source-file citations use `github.com/.../blob/main/...` URLs. I fetched the identical content over `raw.githubusercontent.com` and, where GitHub's raw host rate-limited, over the GitHub Contents API (decoded from base64). Line numbers are from the `main`-branch revision at the time of writing.

**Companion files produced by the parallel research streams in this session:**
- `agent-memory-research-report.md` — full framework-level report for §2
- `agent-memory-benchmarks-report.md` — full benchmark report for §5

---

## 1. Hermes Agent (Nous Research)

Repo: [`github.com/NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) · Site: [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/) · License MIT.

The marketing site makes the relevant claim in one line — "It learns your projects, auto-generates skills, and never forgets how it solved a problem" ([hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/)) **[primary, marketing]**. Everything below is what the code actually does.

### 1.1 There are two separate self-improvement loops

This is the single most important structural fact about Hermes, and it is easy to miss:

| Loop | Module | Trigger | Layer it improves | Gate |
|---|---|---|---|---|
| **Background review** (a.k.a. "self-improvement nudge") | `agent/background_review.py` | Per-turn / per-iteration counters | Memory (MEMORY.md, USER.md) + skills | **Effectively none** — the reviewing LLM decides and writes |
| **Curator** | `agent/curator.py`, `tools/skill_usage.py`, `tools/skill_ledger.py` | Inactivity check (7-day interval + 2-hour idle) | Skills only | **Real**: deterministic lifecycle + fail-closed guards + ledger |

The background review *produces* the learned artifacts. The curator *selects and prunes* them later. They are separate actors with separate authority, and the distinction is exactly the SELECTION-vs-ACCUMULATION axis of §4.

### 1.2 When does review fire? (the counter machinery)

Two independent counters with different units, both defaulting to 10.

**Memory → counted in user turns.** In [`agent/agent_init.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/agent_init.py):

```python
agent._memory_nudge_interval = 10
agent._turns_since_memory = 0
agent._iters_since_skill = 0
...
agent._memory_nudge_interval = int(mem_config.get("nudge_interval", 10))
```

The tick lives in [`agent/turn_context.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/turn_context.py):

```python
def _tick_memory_nudge(agent: Any) -> bool:
    """Advance the turn-based memory nudge counter; ``True`` when the review should fire."""
    if (agent._memory_nudge_interval > 0
            and "memory" in agent.valid_tool_names
            and agent._memory_store):
        agent._turns_since_memory += 1
        if agent._turns_since_memory >= agent._memory_nudge_interval:
            agent._turns_since_memory = 0
            return True
    return False
```

Three conjunctive preconditions beyond the interval: the interval must be non-zero, the `memory` tool must be live in this session's toolset, **and a memory store must exist**. So an agent whose memory surface is disabled never fires a memory review.

The same file hydrates the counter from persisted history on gateway restart so the cadence survives a process restart (PR [#12138](https://github.com/NousResearch/hermes-agent/pull/12138), PR [#22377](https://github.com/NousResearch/hermes-agent/pull/22377)):

```python
prior_user_turns = sum(1 for m in conversation_history if m.get("role") == "user")
if prior_user_turns > 0:
    agent._user_turn_count = prior_user_turns
    if agent._memory_nudge_interval > 0 and agent._turns_since_memory == 0:
        agent._turns_since_memory = prior_user_turns % agent._memory_nudge_interval
```

**Skills → counted in tool iterations, not turns.** `agent._iters_since_skill += 1` is incremented per tool iteration in `agent/turn_iteration_prep.py`. The check happens at turn *end*, in [`agent/turn_finalizer.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/turn_finalizer.py):

```python
    # Skill trigger is checked NOW — based on how many tool iterations THIS turn used.
    _should_review_skills = (
        agent._skill_nudge_interval > 0
        and agent._iters_since_skill >= agent._skill_nudge_interval
        and "skill_manage" in agent.valid_tool_names
    )
    if _should_review_skills:
        agent._iters_since_skill = 0
```

`_skill_nudge_interval` defaults to 10 and is overridden by `skills.creation_nudge_interval` ([`agent/agent_init.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/agent_init.py)).

> **Discrepancy flagged.** The curator docs describe the review as running "~every 10 agent turns" ([curator.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/curator.md)). The code counts tool *iterations*, not turns. A turn with many tool calls therefore triggers skill review much more often than every 10 turns. Minor, but it matters if you are reasoning about review cost.

**The spawn gate** is conjunctive and lives right after the skill check:

```python
    if (
        final_response
        and not interrupted
        and not getattr(agent, "skip_background_review", False)
        and (_should_review_memory or _should_review_skills)
    ):
        with suppress(Exception):
            agent._spawn_background_review(
                messages_snapshot=list(messages), review_memory=_should_review_memory,
                review_skills=_should_review_skills,
            )
```

So: **a non-empty final response, not interrupted, review not suppressed, and at least one counter tripped.** A failed or interrupted turn never learns. The code comment documents the cost rationale: the fork "costs ~30K tokens / event", and `skip_background_review` is set for cron so unattended runs do not pay it.

**Additional gates inside `_spawn_background_review`** ([`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/main/run_agent.py)):

- `if focus is None and getattr(self, "_delegate_depth", 0) > 0: return` — **subagents do not auto-review.** Only an explicit `/refine` (`focus`) reaches a nested agent.
- `load_background_review_settings()` must report `enabled`.
- The whole message list is structurally deep-cloned (`_clone_background_review_messages`) "at the single chokepoint every review path goes through", so the fork's sanitizers cannot mutate live history.
- On the managed local llama-server runtime the review is **deferred to machine idle** (`_review_should_defer` → `QUEUE.enqueue`) rather than competing for the user's GPU. A deferred review preempted by a live turn is requeued, bounded by `_REVIEW_REQUEUE_MAX_ATTEMPTS = 3`.

### 1.3 What the review prompt actually asks for

The three prompts are module-level constants in [`agent/background_review.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py) (moved out of `AIAgent` for one-place editing, with class attributes kept for back-compat). `spawn_background_review_thread` selects: `_COMBINED_REVIEW_PROMPT` if both triggers fired, `_MEMORY_REVIEW_PROMPT` if only memory, else `_SKILL_REVIEW_PROMPT`.

**`_MEMORY_REVIEW_PROMPT`** — narrowly scoped to facts *about the user*:

> Review the conversation above and consider saving to memory if appropriate.
> Focus on:
> 1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
> 2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?
> If something stands out, save it using the memory tool. If nothing is worth saving, just say 'Nothing to save.' and stop.

Note the asymmetry with the skill prompt: memory is framed as *"if appropriate"* with an explicit opt-out. Skills are not.

**`_SKILL_REVIEW_PROMPT`** — explicitly biased toward acting:

> Be ACTIVE — most sessions produce at least one skill update, even if small. **A pass that does nothing is a missed learning opportunity, not a neutral outcome.**
> Target shape of the library: CLASS-LEVEL skills, each with a rich SKILL.md and a `references/` directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries.

It then enumerates first-class signals (user corrected style/tone/format/verbosity; user corrected workflow; a non-trivial technique/fix/workaround emerged; a loaded skill turned out wrong), and imposes a **preference order**:

1. UPDATE A CURRENTLY-LOADED SKILL
2. UPDATE AN EXISTING UMBRELLA (via `skills_list` + `skill_view`)
3. ADD A SUPPORT FILE under an existing umbrella — `references/<topic>.md`, `templates/`, or `scripts/`
4. CREATE A NEW CLASS-LEVEL UMBRELLA — name must not be a PR number, error string, feature codename, library-alone name, or `fix-X`/`debug-Y` session artifact

It states the division of labour explicitly: *"Memory captures 'who the user is and what the current situation and state of your operations are'; skills capture 'how to do this class of task for this user'."*

**The negative list is the most transferable part of this design.** The prompt forbids capturing:

> - Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages.
> - Negative claims about tools or features ('browser tools do not work', 'X tool is broken'). **These harden into refusals the agent cites against itself for months after the actual problem was fixed.**
> - Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
> - One-off task narratives.

And it redirects the failure case: *"If a tool failed because of setup state, capture the FIX … never 'this tool does not work' as a standalone constraint."*

Protected targets are named: bundled skills (e.g. `hermes-agent`) and hub-installed skills are off-limits; **pinned skills CAN be improved** (pin blocks deletion/archive/consolidation by the curator, not content updates).

**`_COMBINED_REVIEW_PROMPT`** is the union of both, with `**Memory**: who the user is` and `**Skills**: how to do this class of task`, and the same preference order and negative list.

### 1.4 The review fork's runtime constraints

`_run_review_in_thread` is worth reading as a lesson in what it costs to run a second agent safely. Verified behaviours:

| Constraint | Value / mechanism |
|---|---|
| Iteration cap | `max_iterations=16` |
| Tool surface | Thread-scoped whitelist built from `get_tool_definitions(enabled_toolsets=["memory", "skills"])`; anything else denied at runtime with `"Background review denied non-whitelisted tool"` |
| External memory providers | `skip_memory=True` — the fork must not touch Honcho/Mem0/Supermemory. The docstring spells out the leak it prevents: without it the fork's `on_turn_start`, `prefetch_all` and `sync_all` would write the *harness prompt* into the user's real memory namespace |
| Built-in memory still works | `_memory_store`, `_memory_enabled`, `_user_profile_enabled` are re-bound from the parent, so `memory(action="add")` from the review still lands on disk |
| Provenance stamp | `_memory_write_origin = "background_review"`, `_memory_write_context = "background_review"` (see §1.5) |
| Recursion prevention | `_memory_nudge_interval = _skill_nudge_interval = 0` |
| Prompt-cache parity | Inherits the parent's `_cached_system_prompt`, `session_start`, `session_id` so the request prefix is byte-identical. The code cites issue #25322 / PR #17276 for "~26% end-to-end cost reduction on Sonnet 4.5" |
| Compression | `compression_enabled = False` — the fork shares the parent's `session_id`, and if it won a compression race it would rotate the parent into a child the gateway never adopts (issue #38727) |
| Dangerous commands | A local non-interactive approval callback returns `"deny"` for everything (extracted as `_bg_review_auto_deny`) |
| Output | All stdout/stderr redirected to `/dev/null`; only a compact action summary is surfaced |
| User-visible summary | `summarize_background_review_actions` scans the fork's tool messages for `success: true` and prints `💾 Self-improvement review: …`. Tool messages already in the prior snapshot are skipped, so the review cannot re-surface stale `created`/`updated` results from inherited history (issue #14944) |

The fork also drops the parent's `codex_app_server` api_mode down to `codex_responses`, because the app-server runtime bypasses Hermes' own tool dispatch and the memory/skill tools would never fire.

### 1.5 What gates exist before a skill or memory is stored

**Skill write gates.** Documented in [`website/docs/user-guide/features/skills.md`](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md), enforced in `tools/skill_manager_guards.py`.

1. **`skills.write_approval`** (default `false`). When `true`, *every* `skill_manage` write — `create` / `edit` / `patch` / `delete` / `write_file` / `remove_file` — is **staged** rather than committed, "regardless of whether the write came from a foreground turn or the background review". Staged writes survive restarts under `~/.hermes/pending/skills/` and are reviewed with `/skills pending | diff <id> | approve <id> | reject <id>`. Memory has the same gate under `memory.write_approval`.
2. **`skills.guard_agent_created`** — a content scanner (dangerous-pattern heuristics). The docs are explicit that this is *not* the approval gate and the two are independent.
3. **Advisory linter** on `create` and on `references/` writes. Two rules exist for library shape: `incident-log-shape` (body dense in PR/issue numbers) and `references-sprawl` (>60 reference files). **"They warn; they never block a write."**
4. **Tool-schema exclusivity.** Each `skill_manage` action owns exactly one text slot (`content` → create/full rewrite, `new_string` → targeted patch, `file_content` → write_file). An op carrying another action's slot "is rejected **before any op in the batch is applied**".
5. **`_background_review_write_guard`** — the authorisation gate. When the caller is the review fork, it refuses `edit`/`patch`/`delete`/`write_file`/`remove_file` on: pinned skills, `skills.external_dirs` skills, protected built-ins, hub-installed skills, bundled skills, **and anything not curator-managed**. The last one fails closed on both a missing record and `created_by: null`:
   > "Allowed exactly once" is not a policy — it is a race with our own bookkeeping. Fail closed for both shapes; `hermes curator adopt <name>` is the supported way in. See #67140.
6. **`_background_review_read_before_write_guard`** — the review fork must have *loaded the exact target in this review turn* before mutating it, else the write is REFUSED and nothing is saved:
   > Call `skill_view(name)` for SKILL.md, or `skill_view(name, file_path=...)` for a supporting file, then retry the write using the content just returned.
7. **`_curator_consolidation_delete_guard`** — a consolidation-pass delete with no forwarding target is refused. See §1.6.
8. **Pinned-skill deletion** is blocked even for the foreground agent's `skill_manage(action="delete")`; patches and edits still pass, "so the agent can improve a pinned skill's content as pitfalls come up without a pin/unpin/re-pin dance".

**Memory write gates.** [`tools/memory_tool_store.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool_store.py) and [`tools/memory_tool.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py):

- **Hard character budgets**: `memory_char_limit: 2200` (~800 tokens) and `user_char_limit: 1375` (~500 tokens). The docs describe both files as entering the system prompt as a **FROZEN snapshot at session start** — "mid-session writes hit disk but never change the prompt (prefix cache intact)".
- **Add is refused over cap** rather than truncated. Entries loaded from disk may exceed the cap; in that case the store warns and **blocks further additions** until the file is back under the limit — it "never truncate[s] a user's memories".
- **Exact-duplicate rejection**: `return self._success_response(target, "Entry already exists (no duplicate added).")`. This is exact-match only; there is no near-duplicate or semantic dedup.
- **Content scanning**: `_scan_memory_content(content)` can refuse content outright.
- **Read-failure refusal**: if the file cannot be read, the write is refused rather than treating unreadable-as-empty, "so the write is refused. Nothing was changed."
- **Drift detection**: a file that is not a clean `§`-delimited list triggers `_drift_error` with a `.bak` path rather than a silent overwrite.
- **Atomicity**: temp-file + rename, with a backup, under a whole-file lock.

**What is *not* there.** There is no importance score, confidence score, usage-frequency reinforcement, semantic dedup, or contradiction check on memory. The admission decision is entirely the reviewing LLM's judgment, optionally intercepted by `memory.write_approval` for a human. This is the crux of §4.

### 1.6 The Curator: Hermes' actual selection mechanism

Documented at [`website/docs/user-guide/features/curator.md`](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/curator.md); implemented in [`agent/curator.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/curator.py) (~62 KB) and `tools/skill_usage.py`. It exists because, in the docs' words, skills "don't pile up forever… Without maintenance, you end up with dozens of narrow near-duplicates that pollute the catalog and waste tokens."

**Triggering.** Not cron — an inactivity check run on CLI session start, gateway housekeeping, and the `hermes serve`/Desktop maintenance timer. Both conditions must hold: `interval_hours` (default **168** = 7 days) since the last run, and `min_idle_hours` (default **2**) of inactivity. Runs happen in a worker thread; a first-run seed sets `last_run_at` to now and defers the first real pass by a full interval.

**Phase 1 — deterministic transitions (always on, no LLM).** Defaults from the docs' config block:

```yaml
curator:
  enabled: true
  interval_hours: 168          # 7 days
  min_idle_hours: 2
  stale_after_days: 14
  archive_after_days: 30
  consolidate: false           # LLM umbrella-building pass — opt-in
  prune_builtins: true
```

Driven by the usage sidecar at `~/.hermes/skills/.usage.json`:

```json
{ "my-skill": { "use_count": 12, "view_count": 34, "last_used_at": "...",
  "last_viewed_at": "...", "patch_count": 3, "last_patched_at": "...",
  "created_at": "...", "state": "active", "pinned": false, "archived_at": null } }
```

`view_count` increments on `skill_view`; `use_count` when the skill is loaded into a conversation prompt; `patch_count` on `skill_manage patch/edit/write_file/remove_file`. Bundled and hub-installed skills are excluded from telemetry writes. Transitions: `active → stale → archived`, with **archival into `~/.hermes/skills/.archive/` and never deletion**. Several exemptions are first-class: pinned skills, skills referenced by *any* cron job (including paused/disabled ones), and a **grace floor for never-used skills** — `use_count == 0` "is absence of evidence, not proof the skill is disposable", so they are not archived until at least `stale_after_days` old.

> **Docs contradiction flagged.** The config block and the "How it runs" section say `stale_after_days: 14` / `archive_after_days: 30`. A later section ("Skills that ARE agent-created follow the full lifecycle") says `active → (30d unused) stale → (90d unused) archived`. These are inconsistent. Treat the config block as authoritative.

**Phase 2 — LLM consolidation (OFF by default, `curator.consolidate: true`).** A single aux-model pass with a high iteration ceiling ("a full curation sweep typically takes 50–100 API calls"). The forked agent surveys agent-created skills, can read any with `skill_view`, and decides per skill whether to **keep / patch / consolidate into a class-level umbrella / archive**. The prompt ([`agent/curator.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/curator.py), `CURATOR_REVIEW_PROMPT`) is a genuine selection policy, not a summarizer:

> This is an UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder.
> The goal of the skill collection is a LIBRARY OF CLASS-LEVEL INSTRUCTIONS AND EXPERIENTIAL KNOWLEDGE. A collection of hundreds of narrow skills where each one captures one session's specific bug is a FAILURE of the library — not a feature.

Its hard rules include:

- **"DO NOT use usage counters as a reason to skip consolidation.** The counters are new and often mostly zero. Judge overlap on CONTENT, not on use_count. 'use=0' is not evidence a skill is valuable; it's absence of evidence either way." — with a corollary that `use=0` is *also* not grounds to prune.
- **"DO NOT reject consolidation on the grounds that 'each skill has a distinct trigger'.** Pairwise distinctness is the wrong bar. The right bar is: 'would a human maintainer write this as N separate skills, or as one skill with N labeled subsections?'"
- Never archive a never-used skill unless it is ≥30 days old **and** its content is genuinely obsolete or fully absorbed.
- **`'keep' is a legitimate decision ONLY when the skill is already a class-level umbrella** and none of the proposed merges would improve discoverability.
- **"If you end the pass with fewer than 10 archives, you stopped too early — go back and look at the clusters you left alone."**
- Every delete **must** carry `absorbed_into=<umbrella>`, which "drives cron-job skill-reference migration — guessing from your YAML summary after the fact is fragile."
- No terminal access at all: "every filesystem mutation goes through `skill_manage` above so it is ledgered and rollback-able (issue #96962)."

The pass must emit a machine-readable block so downstream tooling can distinguish consolidation from pruning:

```yaml
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence — why merged, not just 'similar'>
prunings:
  - name: <skill-name>
    reason: <one short sentence — why archived with no merge target>
```

**Fail-closed enforcement.** `_curator_consolidation_delete_guard` in [`tools/skill_manager_guards.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/skill_manager_guards.py) is the code behind the prompt's delete rule. Its docstring records why it exists — issue #29912, where the pass "archived whole clusters of active skills with zero verified consolidations (`consolidated_this_run == 0`), leaving active automations pointing at names that no longer resolve":

```python
def _curator_consolidation_delete_guard(name, absorbed_into):
    if not _is_background_review() or (isinstance(absorbed_into, str) and absorbed_into.strip()):
        return None
    return _refusal(
        f"Refusing background curator delete of skill '{name}': the consolidation pass may only "
        f"archive a skill it has absorbed into an umbrella. ... Pruning a skill with no "
        f"forwarding target is not permitted here — the deterministic inactivity prune handles "
        f"staleness archival separately. Keeping '{name}' active.",
        _fail_closed=True)
```

**Audit and reversibility** (documented, and the reason this is a real policy rather than a prompt):

- Whole-tree `tar.gz` snapshot before every real pass at `~/.hermes/skills/.curator_backups/<utc-iso>/skills.tar.gz`, pruned to `curator.backup.keep` (default 5).
- Append-only JSONL ledger at `~/.hermes/skills/.curator_ledger.jsonl`, one entry per mutation from **any** actor (`curator` / `agent` / `user`), with `action`, `evidence` (including `absorbed_into` for consolidations), and per-file `{path, sha256}` before/after manifests; file contents stored content-addressed under `.curator_backups/blobs/`.
- `hermes curator rollback <entry-id>` restores exactly one mutation; whole-tree rollback is itself reversible. **"The ledger is telemetry, never a gate."**
- Archive TTL purge is explicit-only (`curator.archive_ttl_days: 180`).

**Who is eligible.** Only skills marked agent-created: name not in `.bundled_manifest`, not in `.hub/lock.json`, and `.usage.json` entry has `"created_by": "agent"` or `"agent_created": true`. Critically, **only the background review fork sets this marker** — a foreground `skill_manage(action="create")`, including `/learn`, records `created_by: learn` and is "considered user-directed and the curator intentionally leaves them alone". `hermes curator adopt` is the manual escape hatch. The docs are unusually candid that `created_by` "is a policy flag, not a provenance claim" — it answers "may autonomous curation touch this?", not "who wrote this file".

### 1.7 Learning journey and provenance

[`agent/learning_graph.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/learning_graph.py) and [`agent/learning_mutations.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/learning_mutations.py) render everything learned as a timeline, with node ids `skills → the skill name` and `memories → memory:<source>:<index>` (`source` = `memory` for MEMORY.md, `profile` for USER.md). Deletion semantics differ by artifact type and are worth copying: **deleting a skill archives it** (`hermes curator restore` recovers it) while **deleting a memory rewrites its file** (destructive). The mutation layer also respects pin state for autonomous actors — the background review "is the same kind of autonomous, no-user-present actor, so it must not write to a pinned skill either (issue #25839)".

### 1.8 Success vs failure trajectories

[`agent/trajectory.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/trajectory.py) is small and does exactly one thing:

```python
def save_trajectory(trajectory, model, completed, filename=None):
    """Append a ShareGPT-format entry to a JSONL file (default trajectory_samples.jsonl /
    failed_trajectories.jsonl by ``completed``)."""
    if filename is None:
        filename = "trajectory_samples.jsonl" if completed else "failed_trajectories.jsonl"
    entry = {"conversations": trajectory, "timestamp": ..., "model": model, "completed": completed}
    ...
    with open(filename, "a", encoding="utf-8") as f:
        _lock_append_handle(f, True)   # flock (POSIX) / msvcrt.locking (Windows)
        try:
            f.write(line); f.flush()
        finally:
            _lock_append_handle(f, False)
```

The separation is therefore **a pure function of the `completed` boolean**, nothing semantic:

| File | Contents |
|---|---|
| `trajectory_samples.jsonl` | `completed=True` |
| `failed_trajectories.jsonl` | `completed=False` (failed *or* interrupted) |

([`website/docs/developer-guide/trajectory-format.md`](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/trajectory-format.md)) **[primary]**. The exclusive lock around write+flush exists because "gateway sessions and batch workers append to the SAME default file; without an exclusive lock around write+flush, entries larger than one write() interleave and the JSONL stops parsing (#12684)".

Conversations are ShareGPT role-mapped (`system`/`human`/`gpt`/`tool`), and all reasoning is normalized into `<think>` tags regardless of provider — including a `convert_scratchpad_to_think` helper for `<REASONING_SCRATCHPAD>` and a `has_incomplete_scratchpad` detector.

**There is no ranking, filtering, or selection on trajectories.** Success and failure are separated by a boolean and then simply accumulate as training/analysis data. The one selection-shaped use is in issue #337's plan (§1.10), not in shipped code.

### 1.9 The trajectory compression algorithm (head/tail protection and token budgets)

This is specified precisely enough to reimplement. [`trajectory_compressor.py`](https://github.com/NousResearch/hermes-agent/blob/main/trajectory_compressor.py) — a **standalone post-processing tool**. Its module docstring states the strategy:

> Compress agent trajectories to fit within a token budget. Strategy: protect the head (system, human, first gpt, first tool) and the last N [turns].

**Full default configuration** (`CompressionConfig`):

| Field | Default |
|---|---|
| `tokenizer_name` | `moonshotai/Kimi-K2-Thinking` (`trust_remote_code=True`) |
| `target_max_tokens` | **15250** |
| `summary_target_tokens` | **750** |
| `protect_first_system` / `_human` / `_gpt` / `_tool` | all `True` |
| `protect_last_n_turns` | **4** |
| `summarization_model` | `google/gemini-3-flash-preview` |
| `base_url` / `api_key_env` | OpenRouter base URL / `OPENROUTER_API_KEY` |
| `temperature` | 0.3 |
| `max_retries` / `retry_delay` | 3 / 2 |
| `add_summary_notice` | `True` |
| `summary_notice_text` | `"\n\nSome of your previous tool responses may be summarized to preserve context."` |
| `output_suffix` | `_compressed` |
| `num_workers` / `max_concurrent_requests` | 4 / 50 |
| `skip_under_target` / `save_over_limit` | `True` / `True` |
| `per_trajectory_timeout` | 300 s |
| `metrics_enabled` / `metrics_per_trajectory` / `metrics_output_file` | `True` / `True` / `compression_metrics.json` |

**The protected-region algorithm** (`_find_protected_indices`) returns `(protected_set, compressible_start, compressible_end)`:

```python
protected = {first_seen[role] for role in ("system", "human", "gpt", "tool")
             if getattr(self.config, f"protect_first_{role}") and role in first_seen}
protected.update(range(max(0, n - self.config.protect_last_n_turns), n))
# Compressible region: after the last protected head turn, before the first tail turn.
head_protected = [i for i in protected if i < n // 2]
tail_protected = [i for i in protected if i >= n // 2]
return protected, max(head_protected) + 1 if head_protected else 0,
       min(tail_protected) if tail_protected else n
```

So the protected head is **the first occurrence of each of the four roles** (not a token budget), the protected tail is **the last 4 turns**, and the middle is compressed. Two further correctness rules are visible in the source: compression "never *start[s]* on an orphaned `<tool_response>` whose `<tool_call>` is in the protected head", and there is a `_SUMMARY_FALLBACK` string for when summarization fails entirely.

The design intent — "summarizes only as much of the middle as needed into one human summary turn, and keeps the remaining middle intact" — means the middle is *not* uniformly summarized. Only enough of it to hit `target_max_tokens` is replaced by a single summary turn of about `summary_target_tokens`; the rest is preserved verbatim. Metrics are per-trajectory and aggregate (original/compressed tokens, ratio, turns removed, `compression_region` {start_idx, end_idx, turns_count}, summarization API calls and errors, success rate).

> **Important distinction.** This is the **offline** trajectory compressor for datasets. Hermes' **live** context compression is a different, much larger system in [`agent/conversation_compression.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/conversation_compression.py) (~229 KB) plus `agent/context_compressor.py`, `agent/micro_compaction.py`, `agent/native_compaction.py`. Do not read the head/tail-4/target-15250 numbers as the runtime compaction policy — they are not.

### 1.10 The supporting runners and their role

**[`batch_runner.py`](https://github.com/NousResearch/hermes-agent/blob/main/batch_runner.py)** — the parallel evaluation harness: a JSONL prompt dataset, multiprocessing pool, per-batch `batch_N.jsonl` output, checkpointing for `--resume`, aggregated tool-usage statistics. Notably, batch agents are constructed with **`skip_context_files=True`** ("Don't pollute trajectories with SOUL.md/AGENTS.md") and **`skip_memory=True`** ("Don't use persistent memory in batch runs"), and `platform="batch"`. Each result carries `completed`, `partial`, `api_calls`, `toolsets_used`, `tool_stats` and `tool_error_counts` — both normalized to **every** tool in `TOOL_TO_TOOLSET_MAP` with zero defaults "ensuring consistent schema across entries for HuggingFace dataset loading". Trajectories are appended with `fsync` per row so "a crash never loses an acknowledged prompt", and the resume path scans batch files for completed prompts by **content hash** (#93527).

**[`mini_swe_runner.py`](https://github.com/NousResearch/hermes-agent/blob/main/mini_swe_runner.py)** — a rollout generator, not an evaluator. It runs tool-calling agent tasks in Hermes' execution environments (local / docker / modal), exposes exactly one `terminal` tool, and writes Hermes-format trajectories "compatible with batch_runner.py and trajectory_compressor.py". Task completion is signalled in-band by the agent echoing `MINI_SWE_AGENT_FINAL_OUTPUT` followed by a summary. **There is no built-in success/failure classification or reward computation** — that is the caller's job.

**[`agent/error_classifier.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/error_classifier.py)** — a **priority-ordered pipeline for *API/transport* errors, not task failures.** `_STAGES = (_plugin_verdict, _provider_special_cases, _by_status, _moa_special_cases, _by_error_code, _by_message, _by_transport)`, producing a `ClassifiedError` whose recovery hints (`retryable`, `should_compress`, `should_rotate_credential`, `should_fallback`) the retry loop consumes. The taxonomy is large — `FailoverReason` includes `auth`, `billing`, `rate_limit`, `upstream_rate_limit`, `overloaded`, `timeout`, `context_overflow`, `payload_too_large`, `image_too_large`, `content_policy_blocked`, `format_error`, `model_not_found`, and provider-specific cases like `thinking_signature` and `oauth_long_context_beta_forbidden`.

This matters to a memory team for one reason: **it does not classify whether the agent solved the task**, so it does not feed the learning loop. It is listed in the brief as a self-evolution component; it is not one. Its one learning-adjacent decision is a genuine anti-destructive gate worth noting — a transport disconnect on a *large session* normally routes to `context_overflow` (i.e. "compress the history"), but for reasoning models the classifier overrides to `timeout`:

> Reasoning models: far more likely the gateway idle-killed a long thinking stream — never compress on a phantom overflow (#52310). … The default disconnect+large-session routing below would otherwise send the user into the compression branch (should_compress=True) and **silently delete conversation history** on a phantom context-length error.

**[`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/delegate_tool.py)** — the subagent architecture:

> Spawns child `AIAgent` instances with a fresh conversation, their own task_id (terminal session, file-ops cache), the parent's toolsets minus child-blocked tools, and a focused system prompt built from goal + context. Single-task and batch (parallel) modes… **The parent only ever sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning.**

Verified defaults: `DEFAULT_MAX_ITERATIONS = 250`; **`MAX_DEPTH = 1`** ("flat by default: parent (0) -> child (1); deeper needs `max_spawn_depth`"); `_DEFAULT_MAX_CONCURRENT_CHILDREN = 10`. Top-level delegations **always** run in the background — `_model_background_value` returns `not (_delegate_depth > 0)`, and the model does not choose; the `background` argument is accepted but deprecated and ignored. Children get output-schema validation, heartbeats, timeouts, and their own transcripts on disk. Module layout: `delegate_tool_child_run.py`, `_config.py`, `_dispatch.py`, `_progress.py`, `_registry.py`, `_results.py`, `_tasks.py`, `_toolsets.py`.

The memory-relevant consequence: `_delegate_depth > 0` blocks the *automatic* review, so **work done inside subagents is not learned from** unless someone explicitly invokes `/refine`. Given that Hermes' own value proposition includes running fan-out subagents, this is a real blind spot in the learning loop.

### 1.11 Issue #337 and the evolutionary self-improvement work

**[primary]** Issue: [NousResearch/hermes-agent#337](https://github.com/NousResearch/hermes-agent/issues/337) — "Feature: Evolutionary Self-Improvement — Auto-Evolving Skills & Prompts via LLM-Driven Search", by `teknium1`, opened 2026-03-03, **closed 2026-05-16**, label `type/feature`. Three comments.

**The proposal.** Import Imbue's Darwinian Evolver pattern — claimed "2-3x performance improvements" and ARC-AGI-2 95.1% with Gemini 3.1 Pro — directly into Hermes rather than wrapping the AGPL external CLI (that is companion issue #336). The five components it identifies as load-bearing:

1. **Population + weighted selection** — sigmoid-scaled fitness × novelty bonus, with a dynamic midpoint (Nth percentile) to keep selection pressure meaningful as the population improves.
2. **Failure-driven mutation** — "Mutations are targeted at specific failure cases, not random. The LLM sees concrete examples of what went wrong and proposes fixes. This is dramatically more effective than random perturbation."
3. **Learning logs** — a history of "what was tried → what happened" given to the mutator, preventing re-trying failed approaches.
4. **Post-mutation verification** — test the mutation only on the failure cases it targeted before full evaluation; Imbue reports >10x cost reduction from this filter alone.
5. **Crossover** — 25% of mutations combine logic from multiple parents.

It correctly diagnoses the gap:

> **What's Missing** — No population management for skill/prompt variants · No fitness scoring of skills (which skill version produces better outcomes?) · No mutation loop (propose skill changes → test → select) · No mechanism to A/B test skill variants.

And names the integration points: `batch_runner.py`, `agent/trajectory.py`, `environments/hermes_base_env.py` `compute_reward()`, the skill system, `agent/prompt_builder.py`, and `hermes_state.py` FTS5. The stated risks are the ones that matter: **"Evaluation is hard — Defining 'good' for complex agent tasks is subjective. Bad evaluation → bad evolution. This is the critical challenge."**; cost ("10 iterations × 5 parents × 50 eval tasks = 2,500 API calls per skill optimization"); and regression/overfitting, requiring holdout sets and manual approval.

**The resolution (comment 2026-03-09).** The design was unified onto **DSPy + GEPA** as the primary engine, with Darwinian Evolver demoted to code-only Phase 4:

> **Key discovery:** GEPA (Genetic-Pareto, ICLR 2026 Oral, MIT licensed) is now integrated into DSPy as `dspy.GEPA`. It uses **'Actionable Side Information'** — reads execution traces to understand WHY failures happen, enabling much more efficient optimization than blind evolutionary search. Results: +6% over RL with 35x fewer rollouts, ARC-AGI 32%→89%.

Architecture as settled: `DSPy + GEPA` = skills/prompts/tool descriptions (MIT, primary engine); `Darwinian Evolver` = code and algorithms (AGPL, external CLI, Phase 3/4); `batch_runner` = evaluation harness; `SessionDB` = mine real usage for eval datasets. A third comment reports the repo was created with Phase 1 implemented: `forge/core/` (dataset builder, fitness functions, constraint validators) and `forge/skills/` (skill-as-DSPy-module), 23 tests passing.

**A rigorous, arguably stronger, selection design was filed separately** — issue #483, "Post-Task Reflection & Missing Affordance Detection", cross-referenced from #337. Its pattern classifies every failure into one of five modes (`incorrect_task_interpretation`, `incorrect_world_assumption`, **`missing_affordance`**, `tool_limitation_or_misbehavior`, `exhausted_or_misdirected_search`) and logs structured evidence to `create_tool_opportunities.jsonl` when the mode is `missing_affordance`, from which a meta-tool can auto-generate new tool implementations staged for human review. The comment's framing is the correct division of labour: "**Gap detection** tells the system *what new skills/tools to build*; **evolutionary optimization** tells the system *how to improve existing skills*."

#### 1.11.1 The self-evolution repo — and a correction to the brief

> **CORRECTION [primary].** The brief identifies `github.com/o2alexanderfedin/hermes-agent-self-evolution` as the community extension. It is **not**. GitHub API confirms `o2alexanderfedin/hermes-agent-self-evolution` has `"fork": true`, `"source": "NousResearch/hermes-agent-self-evolution"`, and 2 stars (created 2026-03-22). The upstream is **`github.com/NousResearch/hermes-agent-self-evolution`** — not a fork, **5,366 stars**, created 2026-03-09T10:42:48Z (the same timestamp as the #337 comment announcing "hermes-forge repo created"), last pushed 2026-06-17. The `o2alexanderfedin` repo is a stale personal copy, not an extension of interest.

> **[unverified, high confidence]** `NousResearch/hermes-forge` returns 404 from the GitHub API. Given the identical creation timestamp and the fact that the README's quick-start invokes `python -m evolution.skills.evolve_skill` while the #337 comment documents `forge/skills/`, the most likely explanation is that `hermes-forge` was renamed to `hermes-agent-self-evolution`. I could not confirm the rename from a primary source.

**README ([NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)) [primary].** "No GPU training required. Everything operates via API calls — mutating text, evaluating results, and selecting the best variants. ~$2-10 per optimization run." Pipeline:

```
Read current skill/prompt/tool ──► Generate eval dataset
                                        │
                                   GEPA Optimizer ◄── Execution traces
                                        │
                                   Candidate variants ──► Evaluate
                                        │
                                   Constraint gates (tests, size limits, benchmarks)
                                        │
                                   Best variant ──► PR against hermes-agent
```

Phase status: **Phase 1 (skill files / SKILL.md) ✅ Implemented**; Phases 2–5 (tool descriptions, system prompt sections, tool implementation code via Darwinian Evolver, continuous improvement loop) all 🔲 **Planned**. The README's guardrails list is one of the few explicit constraint systems found anywhere in this survey:

1. **Full test suite** — `pytest tests/ -q` must pass 100%
2. **Size limits** — skills ≤ **15 KB**, tool descriptions ≤ **500 chars**
3. **Caching compatibility** — no mid-conversation changes
4. **Semantic preservation** — must not drift from original purpose
5. **PR review** — all changes go through human review, never direct commit

**`PLAN.md`** (~40 KB) is the substantive document and is worth reading in full. The parts that matter for a memory/selection design:

**Fitness is LLM-as-judge over a rubric, and it is deliberately not the same thing as the gates.** The eval dataset builder creates train/val/**holdout** splits (`10 train / 5 val / 5-10 holdout`), notes "GEPA works with as few as 3 examples", and draws from four sources: synthetic generation (a strong model reads the skill and emits `(task_input, expected_behavior)` pairs where expected behavior is a *rubric*, not exact text), **SessionDB mining** (query sessions where the skill was loaded, LLM-judge the pairs, "high-scoring pairs become 'good' examples; low-scoring pairs become failure cases for GEPA's reflective analysis"), hand-curated golden sets, and skill-specific auto-evaluation (e.g. plant a bug for `systematic-debugging`). The rubric is explicit:

> - Did the agent follow the skill's procedure? (0-1)
> - Was the output correct/useful? (0-1)
> - Was it concise (within token budget)? (0-1)

**The gate ladder is the real selection mechanism**, and the plan states its philosophy bluntly:

> **Key principle:** Benchmarks are GATES, not fitness functions. The fitness function is task-specific (did the skill/tool/prompt do its job better?). Benchmarks ensure the improvement didn't break something else. **A variant that improves skill quality by 20% but drops TBLite by 5% is REJECTED.**

```
Candidate Variant
    ├──► pytest (must pass 100%) ────────── GATE 1: functional correctness
    ├──► TBLite fast subset (20 tasks) ──── GATE 2: quick capability check (~20 min)
    ├──► Task-specific eval dataset ─────── FITNESS: skill/tool/prompt quality score
    ▼
Top Candidates Only (top 3)
    ├──► Full TBLite (100 tasks) ────────── GATE 3: thorough regression check
    ├──► YC-Bench fast_test ─────────────── GATE 4: coherence check
    ▼
Best Candidate → PR with full metrics
```

Benchmarks by role: **TBLite** (100 tasks, ~1–2 h, ~$20–50) = primary regression gate "fast enough to run on every candidate"; **TerminalBench2** (89 harder tasks, Docker) = thorough validation on final candidates; **YC-Bench** (100–500 turns) = coherence check so "evolved prompts don't break multi-turn behavior".

Constraints, with the failure mode named: "Every candidate variant must pass ALL of these before it can be considered valid. **Variants that fail any constraint are discarded — GEPA/MIPROv2 never see them as successful.**" Beyond the test suite and size limits, the plan adds a **length penalty** in the fitness function ("this prevents evolutionary drift toward verbose solutions") and **semantic similarity checks** against the original to prevent drift ("only improved in effectiveness"). Deployment is by PR with before/after scores on train, validation **and holdout**, plus "any constraint violations that were caught and rejected during evolution".

> **Minor inconsistency flagged.** `PLAN.md`'s file tree names `fitness.py`, `constraints.py`, `benchmark_gate.py` under `forge/`, and the #337 comment documents `forge/core/` and `forge/skills/`, while the README quick-start invokes `python -m evolution.skills.evolve_skill`. Either the package was renamed (`forge` → `evolution`) or both exist. I did not resolve this.

**Assessment for your purposes.** This is the most complete *selection* architecture in the entire survey: explicit fitness (rubric LLM-judge with length penalty and semantic-preservation check), explicit hard gates (test suite, size, benchmark regression, coherence), holdout separation, rejection recorded in the PR, and a human merge step. It is also almost entirely **unshipped** — Phase 1 is the only implemented phase, and even that lives in a separate repository that produces PRs against Hermes rather than running inside it. The contrast with the in-product review loop (which writes immediately, ungated) is the sharpest illustration of the thesis in §4.

---

## 2. OpenClaw, Claude Code, and other agent frameworks

Full report, with all citations: **`agent-memory-research-report.md`** (same `reports/` directory). This section is the condensed version. I independently re-verified the highest-stakes OpenClaw claims against the live docs (§2.1) rather than relying on the delegated pass.

### 2.1 OpenClaw — the only framework with a hard quality gate

Docs: [`docs.openclaw.ai`](https://docs.openclaw.ai/concepts/memory) · Repo: [`github.com/openclaw/openclaw`](https://github.com/openclaw/openclaw) · Maintained by an [OpenClaw Foundation](https://openclaw.org).

**Memory surfaces** — Markdown is canonical, SQLite is a derived index. `MEMORY.md` (curated durable facts, injected at session start subject to provenance gating and a budget), optional `USER.md` (directive user model), `memory/YYYY-MM-DD.md` daily notes (never auto-injected, searchable), `DREAMS.md` (human-reading promotion summaries), and per-agent SQLite at `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` with **FTS5/BM25 + sqlite-vec**, chunked at **400 tokens with 80-token overlap** and file-watched with a 1.5 s debounce ([memory architecture](https://docs.openclaw.ai/concepts/memory-architecture), [builtin engine](https://docs.openclaw.ai/concepts/memory-builtin)).

**The promotion gate — verified directly at [docs.openclaw.ai/concepts/dreaming](https://docs.openclaw.ai/concepts/dreaming) [primary].** A background "dreaming" sweep runs three cooperative phases — **light → REM → deep** — on cron `0 3 * * *` (default `enabled: true`). Only the deep phase writes to `MEMORY.md`. The gate is deterministic and conjunctive:

> Deep phase — Ranks candidates with weighted scoring and threshold gates (`minScore`, `minRecallCount`, `minUniqueQueries` must all pass).

The six weighted base signals plus phase reinforcement:

| Signal | Weight | Description |
|---|---|---|
| Relevance | **0.30** | Average retrieval quality for the entry |
| Frequency | **0.24** | How many short-term signals the entry accumulated |
| Query diversity | **0.15** | Distinct interactive recall queries that surfaced it |
| Recency | **0.15** | Time-decayed freshness score |
| Consolidation | **0.10** | Multi-day recurrence strength |
| Conceptual richness | **0.06** | Concept-tag density from snippet/path |

Light and REM phase hits "add a small recency-decayed boost". Then, and only after those thresholds pass:

> **Consolidation safety.** The deterministic score, recall-count, and query-diversity thresholds remain the candidate gate. Consolidation runs only after those gates pass.
> Before building the consolidation prompt, `memory-core` removes candidates whose indexed provenance is `untrusted` or `system`. **This is a structural taint gate, not a score penalty.**

The model then returns **operation decisions, not replacement prose**, and the writer applies them. An accepted rewrite must satisfy four conditions:

> - preserve prior entries within `phases.deep.maxPriorEntryLossFraction`
> - include every promoted candidate's `Source: path#Lx-Ly` reference
> - stay within the `MEMORY.md` bootstrap-safe file budget
> - parse as the expected structured response

If validation fails: **"Falls back to the previous append-only promotion path when the model is unavailable or the rewrite fails validation."** The previous `MEMORY.md` is stored as a **rewrite preimage** in SQLite before the file changes. Key defaults: `maxPriorEntryLossFraction: 0.25`, `maxPromotedSnippetTokens: 160`, `frequency: 0 3 * * *`. Promoted entries carry trailing annotations that become nullable SQLite columns: `<!-- trigger: phrase one, phrase two -->` and `<!-- importance: N -->` (1–10).

This is a **real selection mechanism with a real rejection path**: deterministic thresholds, a structural (not scored) provenance veto, a bounded-loss constraint on rewrites, a source-citation requirement, structural output validation, an append-only fallback, and a stored preimage. The design explicitly frames the base algorithm as **sleep-time compute** (cites [arXiv:2504.13171](https://arxiv.org/abs/2504.13171)) and the provenance/reflection boundary as following the **Generative Agents** durable-memory framing.

**Admission controls.** Session-transcript ingestion is restricted: "Only interactive sessions are eligible. Cron, heartbeat, subagent, and unknown sessions stay out of durable candidate ingestion", personal/sensitive content is redacted before ingestion, and "runtime-marked recalled context is removed so recalled snippets cannot be learned again as new memory". Two operator controls record *why* a session was excluded: a memory admission policy (matches retained hook-source / channel / chat-type metadata) and `memory forget` (records session IDs as `forgotten`). Manual backfill is available and reversible (`memory rem-harness --grounded`, `rem-backfill --rollback`, `session-backfill --apply`/`--rollback`).

**Hooks around memory.** A **pre-compaction memory flush** runs a *silent turn* before compaction reminding the agent to persist unwritten context (on by default; `agents.defaults.compaction.memoryFlush.enabled: false`). Compaction defaults: `keepRecentTokens: 20000`, mode `"safeguard"` with summary quality audits. Plugin lifecycle hooks include `before_compaction`, `after_compaction`, `session_start`, `session_end`, `before_tool_call`, `agent_end`, plus skill hooks `skill_proposal_evaluate`, `skill_proposal_changed`, `skill_changed` ([hook reference](https://docs.openclaw.ai/plugins/hooks/reference)). The bundled `session-memory` hook writes `memory/YYYY-MM-DD-HHMM.md` on `/new`, `/reset`, or auto-rollover, default 15 messages.

**Skills.** `SKILL.md` + YAML frontmatter, 8-tier load precedence, discovery to 6 levels deep, session-start snapshot with a 250 ms-debounce watcher refresh, and a documented prompt cost of ~**97 chars ≈ 24 tokens per skill** ([skills](https://docs.openclaw.ai/tools/skills)). Agent self-authoring goes through a governed `skill_workshop` (`propose-create`, `propose-update`, `inspect`, `evaluate`, `apply`, `reject`, `quarantine`), writing only under a workshop directory. Self-learning modes are `off | propose | auto` with **default `auto`**, but autonomous capture is heavily conditioned: the turn must not end in a provider/prompt error, must use **≥10 model iterations**, must be an eligible foreground conversation, the runtime must report `skill_workshop` availability, and the system must be quiet **30 seconds**. Caps: `maxPending: 50`, `maxSkillBytes: 40000`.

**The skill gate** is a plugin hook: proposals pass static scanning, content-hash binding, size validation and rollback metadata, then a `skill_proposal_evaluate` hook lets third-party evaluators return a `decision` — and **only a completed `decision: "block"` vetoes**. Errors are recorded as attributed outcomes rather than failing the run.

### 2.2 Claude Code (Anthropic)

Docs: [code.claude.com/docs](https://code.claude.com/docs/en/memory).

**Two distinct systems, and the docs say so.** `CLAUDE.md` is human-written instructions; **auto memory** is notes Claude writes itself. The `CLAUDE.md` hierarchy is managed-policy → user (`~/.claude/CLAUDE.md`) → project (`./CLAUDE.md` or `./.claude/CLAUDE.md`) → local (`./CLAUDE.local.md`), all **concatenated rather than overridden**, broad → specific. Imports use `@path` with a **max depth of four hops**; external imports prompt for approval; target **<200 lines**; **files over 4 MiB are skipped**. Block-level HTML comments are stripped before injection. `.claude/rules/*.md` adds path-scoped rules via `paths:` frontmatter with a brace-expansion budget of 1,000 patterns / 4 MiB. An `InstructionsLoaded` hook reports which files loaded and why.

**Auto memory.** Located at `~/.claude/projects/<project>/memory/`, containing a `MEMORY.md` **index** plus one topic file per memory; `<project>` derives from the git repo so worktrees share a directory. Frontmatter `type ∈ {user, feedback, project, reference}`. **Only the first 200 lines or 25 KB of the index load at session start**; topic files load on demand. After each write Claude Code measures the index and reminds Claude to shorten it; over the limit the write succeeds but returns an error telling Claude to rewrite the index. Writes with frontmatter get an ISO-8601 `modified` timestamp. Controls: `autoMemoryEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `autoMemoryDirectory`; browsing via `/memory`.

**Is there a quality gate? No.** The documentation describes the admission decision as model judgment — Claude "decides what is worth remembering, and skips anything derivable from the codebase or already in CLAUDE.md". The only hard constraint is the **index size guard** (200 lines / 25 KB), which is a budget, not a quality threshold. There is no promotion score, no dedup pass, no contradiction check, and no human review step.

**Skills.** `SKILL.md` per [agentskills.io](https://agentskills.io); directory name becomes `/command`; precedence enterprise > personal > project; progressive disclosure is real (only one-line descriptions in the startup listing, body loads on use). Frontmatter controls `disable-model-invocation`, `user-invocable`, `allowed-tools`/`disallowed-tools`, `context: fork`, `agent`, `background`, `$ARGUMENTS`. `/skill-doctor` reports per-skill context cost. **Automatic skill authoring is narrow**: `/run-skill-generator` writes a per-project `.claude/skills/run-<name>/`, and `/verify` writes `.claude/skills/verify/SKILL.md` when it had to rediscover a recipe. There is no general automatic skill-synthesis loop.

**Compaction boundary.** After compaction: project-root CLAUDE.md, unscoped rules, auto memory and the plan are re-injected from disk; path-scoped rules and nested CLAUDE.md reload lazily; up to five most-recently-modified files are re-read; **invoked skill bodies are re-injected, capped at 5,000 tokens per skill and 25,000 total**, oldest dropped; **the skill description listing does not survive**; `SessionStart` hooks matching `compact` run.

**Hooks.** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStart/Stop`, `InstructionsLoaded`, `PreCompact`, `PostCompact`, `SessionEnd`. Exit code 2 is the blocking signal; `PostToolUse` can return `additionalContext`. **There is no documented hook that performs automatic memory extraction** — writes are model-initiated.

### 2.3 Other frameworks

| Framework | Memory mechanism | Static / dynamic | Agent-writable | Quality gate before persisting |
|---|---|---|---|---|
| **Codex CLI / AGENTS.md** | `AGENTS.md` (root + nested, nearest wins) + **Memories** | AGENTS.md static; Memories generated files | AGENTS.md human; Memories by Codex | Consolidation pass exists; **no numeric quality threshold** documented |
| **Cursor** | `.cursor/rules/*.mdc` (`alwaysApply`/`description`/`globs`); `AGENTS.md` | Static files | Via explicit `/create-rule`, `/create-skill` | No |
| **Gemini CLI** | Hierarchical `GEMINI.md` + `save_memory` tool | Static files, agent-edited | Yes (`save_memory`) | No |
| **OpenHands** | Agent Skills spec + keyword- and path-triggered skills | Static files | Manual authoring | No |
| **LangGraph / LangMem** | Semantic / episodic / procedural; collection or profile; `BaseStore` namespaces | Dynamic store + prompt | Yes, via tools | LLM consolidation (soft), no hard threshold |
| **Cline** | Memory Bank: 6 markdown files | Static files, agent-edited | Yes | No |

Notes with citations:

- **AGENTS.md** is a vendor-neutral Markdown convention, used by 60k+ repos, now stewarded by the Agentic AI Foundation under the Linux Foundation; nested files mean "the closest AGENTS.md to the edited file wins", and explicit user prompts override everything ([agents.md](https://agents.md/)).
- **OpenAI Codex Memories** are off by default (`memories = true` under `[features]` in `~/.codex/config.toml`). Codex turns eligible prior threads into local files under `~/.codex/memories/`, **skips active/short-lived sessions**, **redacts secrets**, and updates in the background after the thread goes idle. Config exposes `memories.generate_memories`, `use_memories`, `disable_on_external_context`, `min_rate_limit_remaining_percent`, `extract_model`, and **`consolidation_model`**. **These are eligibility gates, not quality gates.** *(Source caveat: `developers.openai.com/codex/memories` returned HTTP 403; the delegated researcher read a [GitHub mirror of the official docs](https://raw.githubusercontent.com/crasuna/openai-dev-docs-cn-mirror/main/sources/en/codex/memories.md).)*
- **Gemini CLI** concatenates `GEMINI.md` from `~/.gemini/GEMINI.md`, workspace and parent dirs, plus JIT files discovered when a tool touches a directory; `@file.md` imports are supported; `/memory show|reload` inspects it ([gemini-md.md](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/gemini-md.md)). `save_memory` routes facts to project `GEMINI.md`, a per-project private folder, or the global file ([memory tool](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/memory.md)). No gate.
- **LangMem** frames every operation as: conversation(s) + current memory state → **prompt an LLM to decide how to expand or consolidate** → updated state. Collections insert/delete/update; profiles overwrite a single document. `create_prompt_optimizer(kind="metaprompt", config={"max_reflection_steps": 3})` exists for optimizing the memory prompts themselves ([LangMem concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)). The docs warn that over-extraction reduces precision — soft, prompt-level control.
- **Cline's Memory Bank** is a methodology, not built-in storage: `projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md` under `memory-bank/`, driven by instructions in a `.clinerules` file ([Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank)).

### 2.4 The static-vs-dynamic taxonomy

Four buckets, and the gate column is the point:

1. **Static files a human edits** — `AGENTS.md`, most `CLAUDE.md` scopes, Cursor `.mdc` rules, OpenHands skills. No agent write path, hence no gate needed.
2. **Files the agent edits** — Claude Code auto memory and subagent `agent-memory/`; Gemini CLI `save_memory`; Cline Memory Bank; Cursor/OpenHands skills written by an explicitly-invoked authoring skill. **Claude Code is the only one in this bucket with any constraint at all, and it is a size guard, not an admission threshold.**
3. **Dynamic vector/DB stores** — OpenClaw's per-agent SQLite (FTS5 + sqlite-vec); LangGraph `BaseStore`.
4. **Learned/compiled artifacts** — OpenClaw `MEMORY.md`/`USER.md` after dreaming, `DREAMS.md`, Workshop skills; Codex `~/.codex/memories/`; LangMem profile documents. **Only OpenClaw gates this conversion.**

**Verdict for this section: across the frameworks surveyed, OpenClaw is the only one that combines (a) deterministic promotion thresholds, (b) a structural provenance veto applied before the model sees the candidate, and (c) an independent skill-evaluation veto. Codex has a consolidation step and Claude Code has a size guard; neither has a quality threshold.**

---

## 3. Memory-as-a-service

Full per-claim citations for this section come from the delegated research stream (reproduced in this session's transcript). I independently re-verified Mem0's algorithm, the Zep and Hindsight paper identities, Mem0's current ADD-only source, and Hindsight's write path from primary sources.

### 3.1 Mem0 — and a material architecture change you must know about

Paper: **"Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory"**, [arXiv:2504.19413](https://arxiv.org/abs/2504.19413) (abstract verified directly) · Repo: [`github.com/mem0ai/mem0`](https://github.com/mem0ai/mem0).

**The paper's architecture is a genuine selection mechanism, and I verified it from the paper's own Algorithm 1 [primary].** Two phases:

1. **Extraction** — per message *pair* `(m_{t-1}, m_t)`, an LLM combines an asynchronously refreshed conversation summary `S`, a recency window of `m = 10` prior messages, and the new pair, returning candidate facts `Ω`.
2. **Update** — for each candidate fact, retrieve the top **`s` semantically similar existing memories** by vector embedding, then present candidate + retrieved memories to the LLM through a function-calling interface. The paper's wording is unambiguous:

> The LLM itself determines which of four distinct operations to execute: **ADD** for creation of new memories when no semantically equivalent memory exists; **UPDATE** for augmentation of existing memories with complementary information; **DELETE** for removal of memories contradicted by new information; and **NOOP** when the candidate fact requires no modification to the knowledge base. **Rather than using a separate classifier, we leverage the LLM's reasoning capabilities to directly select the appropriate operation** based on the semantic relationship between the candidate fact and existing memories.

Algorithm 1 makes the guards explicit: `UPDATE` applies only if `InformationContent(f) > InformationContent(m_i)` ("Replace with richer information"); `DELETE` runs `FindContradictedMemory(f, M)` then `M ← M \ {m_i}`; `NOOP` is a documented no-op branch. `ClassifyOperation` is `¬SemanticallySimilar → ADD`, `Contradicts → DELETE`, `Augments → UPDATE`.

**Mem0^g (graph variant)** adds contradiction-driven invalidation rather than deletion — architecturally close to Zep: *"An LLM-based update resolver determines if certain relationships should be obsolete, marking them as invalid rather than physically removing them to enable temporal reasoning."*

**⚠️ But v3 changed this, and the change is exactly in the axis you care about.** Per the delegated pass, which read the migration guides and the `main`-branch source: the platform migration guide states extraction went from *"Two LLM passes (extract + merge)"* to *"Single-pass ADD-only (one LLM call)"*, memory mutations went from ADD/UPDATE/DELETE to **"ADD only: nothing is overwritten or deleted"**, and conflicts are now handled **at retrieval time rather than write time** ([platform migration](https://docs.mem0.ai/migration/platform-v2-to-v3), [OSS migration](https://docs.mem0.ai/migration/oss-v2-to-v3)). **I verified this directly in source**: `mem0/configs/prompts.py` on `main` defines `ADDITIVE_EXTRACTION_PROMPT` whose text reads *"Your sole operation is ADD: identify every piece of memorable information and produce self-contained, contextually rich factual statements"*, and there is a `generate_additive_extraction_prompt()` documented as "the user prompt for additive (ADD-only) extraction with linking". The write path is batch embed → **MD5 hash dedup** → insert.

> **Verified documentation contradiction to flag to your team.** [docs.mem0.ai/core-concepts/memory-types](https://docs.mem0.ai/core-concepts/memory-types) still says a single LLM call *"decides, per fact, whether to ADD, UPDATE, DELETE, or leave a memory alone."* That describes v2. The migration guides and current source agree on ADD-only. Do not cite the Mem0 docs' memory-types page as evidence of conflict resolution.

**So Mem0 must be split in two when you do your comparison:**
- **Mem0 v1 / the arXiv paper = SELECTION.** LLM-judged ADD/UPDATE/DELETE/NOOP at write time, with two genuine reject branches (DELETE and NOOP) and an information-content guard on UPDATE.
- **Mem0 v3 = ACCUMULATION.** ADD-only with MD5 exact-duplicate rejection; near-duplicates are handled by feeding the extractor the top-10 existing memories as dedup context; selection is deferred to retrieval-time ranking (semantic + BM25 + entity-overlap boost fused into one score, where "BM25 is a boost signal, not a recall expander — only semantic search results are candidates").

**Retrieval (current OSS v3):** preprocess (lemmatize + extract entities) → parallel semantic / BM25 / entity-overlap-boost → normalize and fuse → single `score`. Entity matching lives in a parallel `{collection}_entities` store. Reranking exists (`rerank=True`, ~200–400 ms) but **defaults to `false`**. The paper's Mem0^g retrieval is dual: entity-centric subgraph traversal plus semantic triplet scoring.

**Tiers:** effectively none. The SDK exposes a `memory_type` enum but only `procedural_memory` is implemented; `semantic_memory` and `episodic_memory` are defined and rejected by validation. Everything else is a flat fact store scoped by `user_id`/`agent_id`/`run_id`.

**Storage:** paper uses **Neo4j** for graph memory plus an unnamed dense vector store. OSS supports ~20 pluggable vector stores (pgvector, Qdrant, Pinecone, Elasticsearch, OpenSearch, Redis, …).

**Reported results (paper, 10 runs, mean ± std, GPT-4o-mini for all LLM ops):** overall LLM-as-Judge on LOCOMO — **Mem0 66.88 ± 0.15**, **Mem0^g 68.44 ± 0.17**, Zep 65.99, LangMem 58.10, A-Mem 48.38, OpenAI (ChatGPT memory) 52.90. Efficiency: Mem0 search p50 0.148 s / p95 0.200 s; 1,764 tokens vs 4,437 for OpenAI. The abstract claims 91% lower p95 latency and >90% token savings vs full-context and ~26% relative J improvement over OpenAI. **Full-context scored 72.9%, i.e. it beat both Mem0 variants on overall J** — a fact Mem0's abstract does not highlight and Zep's rebuttal does. (See the sibling report `memory-negative-results-review.md` in this directory for the independent audit of these claims.)

### 3.2 Zep / Graphiti — contradiction invalidation, never deletion

Paper: **"Zep: A Temporal Knowledge Graph Architecture for Agent Memory"**, [arXiv:2501.13956](https://arxiv.org/abs/2501.13956) (title and abstract verified directly) · Repo: [`github.com/getzep/graphiti`](https://github.com/getzep/graphiti).

**Three subgraphs:** episode (raw messages/text/JSON, explicitly non-lossy), semantic entity (entities + fact edges), and community (clusters of strongly connected entities with summaries).

**Bi-temporal model:** `T` = event time (`t_valid`, `t_invalid` — when a fact held true in the world) and `T′` = transaction/ingestion time (`t_created`, `t_expired`). `T′` is conventional DB auditing; `T` is the addition that enables "what was true then" queries.

**Extraction:** per episode ingestion via `add_episode`, synchronously. Entity extraction uses the current message plus the last **n = 4** messages, with a reflexion-style pass to reduce hallucination. Graph writes use **predefined Cypher queries, not LLM-generated queries**, to keep schema consistency. `SEMAPHORE_LIMIT` defaults to 10.

**The selection mechanism — and it is a real one.** Nothing is deleted; contradictions expire edges:

1. **Entity resolution** — embed names to 1024-d vectors, cosine-search existing nodes *plus* a full-text search on names/summaries, then an **LLM entity-resolution prompt** decides duplicates and generates an updated name/summary.
2. **Edge dedup** — hybrid search constrained to edges **between the same entity pair** (reduces error surface and cost), then an LLM dedup step.
3. **Contradiction detection** — the `resolve_edge` prompt returns `duplicate_facts` and `contradicted_facts` lists, and explicitly warns that numeric/date/qualifier differences are *not* duplicates.
4. **Invalidation** — `resolve_edge_contradictions` sets the old edge's `invalid_at = new_edge.valid_at` when the contradiction is temporally overlapping, and **"Graphiti consistently prioritizes new information."**

So: **yes, an LLM judge; the reject action is temporal invalidation, preserving full history.**

**Retrieval:** `f(α) = χ(ρ(φ(α)))` — Search → Reranker → Constructor. Search = cosine + Okapi BM25 (both via Neo4j's Lucene) + BFS over n hops. Rerankers = RRF, MMR, **episode-mentions** (frequency of mentions — a usage-frequency reinforcement signal), **node-distance**, and cross-encoder. The constructor emits facts with their `t_valid`/`t_invalid` ranges. Default is `EdgeReranker.rrf`.

**Community summaries** use **label propagation**, not Leiden, "chosen because it extends dynamically". Storage: Neo4j 5.26 / FalkorDB 1.1.2 / Amazon Neptune (+ OpenSearch Serverless for FTS) / Kuzu (deprecated); Zep managed runs a proprietary "Context Graph Engine".

**Reported results:** DMR **94.8%** (gpt-4-turbo) / **98.2%** (gpt-4o-mini) vs MemGPT 93.4%; LongMemEval_s up to **+18.5% accuracy** and **90% lower latency**. The paper itself cautions that DMR conversations are only 60 messages.

### 3.3 Letta / MemGPT — powerful primitives, zero selection

Paper: **"MemGPT: Towards LLMs as Operating Systems"**, [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) (verified) · Repo: [`github.com/letta-ai/letta`](https://github.com/letta-ai/letta) · Docs: [docs.letta.com](https://docs.letta.com/).

**Tiers:** main context (= LLM prompt tokens: system instructions + working context + FIFO queue) vs external context (recall storage = message DB; archival storage = arbitrary-length text). The FIFO queue's index 0 holds a recursive summary of evicted messages. **The paper says "working context", not "core memory"** — the latter is implementation terminology.

**Trigger is event-driven** — user messages, system messages, user interactions, and **timed events on a schedule**. The queue manager appends, triggers inference, writes both input and output to recall storage, and re-appends retrieved messages to the back of the queue.

**The eviction policy is the closest thing to a gate, and it is a token threshold, not a quality judgement:** at ~**70%** of the context window it injects a **"memory pressure" warning** so the agent can save important information to working context or archival storage; at ~**100%** it **flushes ~50%** of the queue and generates a new recursive summary.

**⚠️ Verified negative worth knowing before you cite MemGPT.** The paper does **not** contain the strings `core_memory_append`, `core_memory_replace`, `archival_memory_insert`, or `archival_memory_search` (grep of both HTML and text). Those names are from the implementation, not the paper. Current Letta tools are **`memory_insert`, `memory_replace`, `memory_rethink`** for blocks and `archival_memory_insert` / `archival_memory_search` for archival. The memory-blocks docs page itself carries `status: legacy`.

**Current Letta.** Blocks are always-visible context sections with `label`, `description`, `value`, `limit`, `read_only`, persisted individually and "compiled" into the prompt; shareable across agents; recommended <50 k chars and <20 blocks per agent. The block `description` is the main instruction the agent uses to decide how to write it. Archival memory is a semantic-search vector store that agents **cannot easily modify or delete**, retrieved only on demand. MemGPT's default storage is **PostgreSQL with pgvector + HNSW**.

**Sleep-time compute** (Letta 0.7.0): two agents — a primary agent **with no core-memory-editing tools**, and a sleep-time agent holding the memory tools that can edit both its own and the primary's in-context memory, running asynchronously at a configurable frequency, with a stronger/slower model recommended. Letta's own framing of the problem is the honest one: *"Memory formation in MemGPT is incremental, so memories may become messy and disorganized over time."* ([Letta blog](https://www.letta.com/blog/sleep-time-compute), [arXiv:2504.13171](https://arxiv.org/abs/2504.13171)).

**Letta has since moved to MemFS**, a git-backed memory filesystem: files under `system/` are always in the prompt, the rest stay out with the tree as signposts, **no semantic/vector index by default**, every edit is a git commit, and memory subagents use worktrees. "Dreaming" (successor framing of sleep-time) uses background subagents triggered by `step-count` (default 25) or `compaction-event`, with `behavior: reminder | auto-launch` and an optional "Agent reviews before applying" second pass.

**Quality gate: NONE.** Memory is entirely agent-discretionary self-editing. The only constraints are per-block character limits (overflow errors are fed back to the model), read-only flags, and retrieval pagination. **There is no confidence score, importance score, promotion, merge, or reject mechanism.** The closest analogues are the optional dream/consolidation second pass and Letta's separate Evals framework — which is an evaluation product, not a memory-write gate.

### 3.4 Honcho — selection exists, but on the Dreamer's schedule

Repo: [`github.com/plastic-labs/honcho`](https://github.com/plastic-labs/honcho) · Docs: [honcho.dev](https://honcho.dev/). *(Claims below are from the delegated pass; I did not independently re-verify them.)*

**Model is peer-centric, not tier-centric:** Workspaces (isolation + auth) → Peers and Sessions (many-to-many) → Messages. A peer's **Representation** holds **conclusions** (deductive/inductive/abductive), **summaries** (short every 20 messages, long every 60), and **peer cards** (cached biographical facts). Representations are **directional** — scoped to an `(observer, observed)` pair, with observation modes `observe_me` / `observe_others` producing perspective-bounded knowledge per peer.

**Extraction:** two processes — an API server (synchronous write path) and a worker (queue consumer). On every message the message is stored **and** a reasoning task is enqueued in the same request, so the API returns immediately and the LLM call never blocks the caller. The **Deriver** runs **per-message, not on a schedule**; the **Summarizer** runs in parallel. Reasoning output is structured formal logic (premises + deductive conclusions) produced by **custom-trained models** — the explicit-reasoning model is named **Neuromancer XR** — not a general frontier LLM.

**The dialectic API is the query path, not the extraction path:** `chat()` spawns an agent that searches conclusions semantically, pulls supporting messages, **traces a conclusion back to the premises it was drawn from**, and synthesizes a grounded answer inline. High latency is accepted here to keep writes fast.

**Selection:** philosophy is "accumulate-by-reasoning, then consolidate". The gate is **Dreaming** (experimental), run per `(workspace, observer, observed)`:
- **Deduction specialist** — knowledge updates (**deletes the outdated conclusion and creates a new one** on change), logical implications, **contradiction resolution**, peer-card updates.
- **Induction specialist** — behavioral tendencies/preferences/traits/correlations; each pattern requires **≥2 source conclusions** and is **assigned a confidence level based on the number of supporting observations**.

Dreaming requires **≥50 new conclusions** since the last dream, an **≥8 h cooldown**, and `dream.enabled`; then an **idle timeout (default 60 min)** waits for user inactivity and cancels if new messages arrive. **Real-time writes never reject.** Storage is **PostgreSQL + pgvector**.

### 3.5 Supermemory — an explicit human-reviewed reject queue

Site: [supermemory.ai](https://supermemory.ai/docs/concepts/how-it-works) · Repo: [`github.com/supermemoryai/supermemory`](https://github.com/supermemoryai/supermemory). *(From the delegated pass; benchmark claims are vendor self-reported.)*

**Architecture:** a **custom learning model** ("Decides what and how to learn, what is important, when to forget, creating relations", branded `learner-1`) plus a **"Temporal Vector-graph engine"** — "Fact-based temporal graph that has Vector, FTS, and graph built in".

**Two-phase ingestion:** (1) a document pipeline (queued → extracting text/OCR/transcription → chunking → embedding → indexing → `done`); (2) **"dreaming"**, which produces *memories* (graph facts). `dreaming: "dynamic"` (default) groups related documents so memories form from coherent units and **memory extraction may continue after `status: done`**; `dreaming: "instant"` dreams a document alone immediately and bills an extra operation. Extraction is therefore asynchronous and batched by coherent unit, not per-turn.

**Retrieval:** `POST /v4/search` with `searchMode: "memories" | "documents" | "hybrid"` (hybrid recommended); results carry a `similarity` score and `include.relatedMemories` exposes graph edges. `POST /v4/profile` returns a query-independent profile split into **static** (`isStatic: true`) and **dynamic** facts, positioned explicitly as a complement to search for facts no query would surface. **The ranking fusion algorithm is not published** — no BM25/RRF/cross-encoder detail. There is no endpoint literally named `/context`.

**Quality gate: YES, and it is the clearest explicit human/agent-reviewed *reject* gate in this comparison.** Inferred memories (the `derives` relation) are flagged `isInference: true` and **down-weighted in search until confirmed**. A review queue (`GET /v3/container-tags/{tag}/inferred`) supports **approve** (ranks like a stated fact), **decline** (`isForgotten` set → removed from search), or **undo**.

**Forgetting and merge:** time-based expiry of temporary facts; contradiction (updates win for "what's true now"); noise filtering of non-meaningful chatter. Soft-delete via `DELETE /v4/memories` (`isForgotten=true`, preserved in DB) and agentic mass-forget by query with `dryRun`, `threshold` (default 0.5), `maxForget` (default 100). Three graph edge types: **`updates`** (replaces for search; `isLatest` keeps retrieval on the current fact while retaining history for audit), **`extends`** (adds detail), **`derives`** (infers unstated facts). Memory types behave differently — **facts persist until updated, preferences strengthen with repetition, episodes decay unless significant** — an explicit frequency-based reinforcement signal. Storage is an embedded self-contained binary; **no arXiv paper found**.

### 3.6 Hindsight (Vectorize)

**[primary]** Identified as **Vectorize's Hindsight**, *"Agent Memory That Learns"* — repo [`github.com/vectorize-io/hindsight`](https://github.com/vectorize-io/hindsight), paper **"Hindsight is 20/20: Building Agent Memory that Retains, Recalls, and Reflects"**, [arXiv:2512.12818](https://arxiv.org/abs/2512.12818) (title verified directly). Distinct from Hindsight Experience Replay (RL), which is unrelated. Hindsight is also shipped as a **memory provider inside Hermes** alongside Honcho, Mem0, OpenViking, Holographic, RetainDB, ByteRover and Supermemory ([Hermes memory-providers docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory-providers.md)) — a useful integration cross-check, since it means Hermes users can run Hindsight underneath an ungated review loop.

**Four logical networks inside a bank** (paper §3): **world** (objective external facts), **experience** (the agent's own first-person actions/recommendations), **opinion** (subjective judgments as tuples with **confidence `c ∈ [0,1]`**), and **observation** (preference-neutral entity summaries synthesized from many facts). The design goal is to keep **evidence separate from inference and synthesis**; banks are strict isolation units carrying disposition traits (skepticism, literalism, empathy).

**Extraction (`retain`) [primary, verified from the engineering blog].** An LLM extracts: core facts; the *feeling and significance*; and the *reasoning* — so the system can answer "why did Alice join Google?", not just "where does Alice work?". It also preserves narrative rather than shredding it into disconnected shards. Every fact is classified as **experience** (the agent acting/observing) or **world** (a fact about someone else), *by who is speaking*. **Extraction is additive, not a replacement** — the original text is also stored, chunked if long, so every memory traces back to exactly what was said. Then:

- **Entity resolution** — fuzzy name matching collapses "Alice"/"Alice Chen"/"Alice C.", with co-occurrence disambiguation for ambiguous common names.
- **Knowledge graph construction** via four edge kinds: **entity** connections, **time** connections, **meaning** connections, and **causal** connections ("Alice felt burned out" ← caused by ← "she worked 80-hour weeks").
- **Dual temporal grounding** — occurrence time *and* mention time. The blog's justification is precise: "Without event time, 'What did Alice do in 2024?' cannot find a marriage you were told about in 2025. Without the mention time, recency ranking has nothing recent to prioritize."
- **Consolidation into observations, as a separate background step.** Related facts become durable observations that are **not** invented summaries: "Each one references the specific memories that support it, with quotes, and carries a **proof count**. New evidence **refines** it rather than overwriting it, and its history is preserved. When two observations drift into saying the same thing, Hindsight reconciles the near-duplicates."

Control knobs: a **retain mission** narrows extraction ("always keep technical decisions and architectural trade-offs; ignore greetings and logistics"), and an **extraction mode** (`concise` | `verbose` | `custom`) trades speed for richness.

**Retrieval (`recall`) [primary].** For each fact type, several strategies run in parallel: **semantic vector search + BM25 keyword search + graph activation over linked entities + a temporal pass** when the query has a time element. Then **Reciprocal Rank Fusion**, then a **cross-encoder rerank** (local by default), then trim to a token budget. **`recall` never calls an LLM** — "the whole pipeline is embeddings plus a reranker, both local by default", which is why it is sub-second. `budget` ∈ {`low`, `mid`, `high`} controls graph-traversal depth (~100/300/1000 units); `max_tokens` caps output; `query_timestamp` anchors relative dates; `tags_match` scopes by label. The paper specifies HNSW pgvector for semantic, a **GIN** index for BM25, and `cross-encoder/ms-marco-MiniLM-L-6-v2` for reranking with formatted temporal info in the reranker input.

**`reflect`** is a separate agentic loop: it searches hierarchically — **mental models** (user-curated, self-refreshing summaries) → **observations** (consolidated, evidence-backed knowledge) → **raw facts** (via `recall`, "as ground truth to verify against when the higher levels are stale") — and synthesizes an answer with an LLM. It supports `response_schema` for validated structured output, and `include_based_on` returns a `based_on` block naming the exact memories used, "validated against what was retrieved, so it cannot invent a source". The blog's framing is the cleanest statement of the read-path tradeoff in this whole survey: **use `recall` for "what did I say about X?", `reflect` for "what should I do about X?"**

**Quality gate: YES, and it is numeric [primary, paper].** **Opinions carry an explicit confidence score.** New evidence is LLM-assessed as `{reinforce, weaken, contradict, neutral}` and confidence is updated by a step α: `c+α` (capped at 1.0), `c−α` (floored at 0.0), or **`c−2α` on contradiction**. That is an explicit, evidence-based, numeric promotion/demotion mechanism — one of only two found in this survey (the other is Supermemory's review queue). Observations are deduped and refined with evidence counts rather than overwritten. Mental models / knowledge pages are standing answers rewritten in the background and read with a plain DB read, no retrieval or LLM call.

**Storage:** **PostgreSQL** — HNSW-based pgvector for semantic retrieval and a **GIN** index for BM25 full-text. Docker default persists to `/home/hindsight/.pg0` (embedded Postgres), with external PostgreSQL or optional Oracle AI Database.

**Reported results (vendor):** with an open-source 20B backbone, LongMemEval accuracy rises **39% → 83.6%** over a full-context baseline with the same backbone, beating full-context GPT-4o; scaling the backbone reaches **91.4% on LongMemEval** and up to **89.61% on LoCoMo**. The README claims independent reproduction by Virginia Tech's Sanghani Center and The Washington Post while stating that other vendors' scores in its chart are self-reported. **Treat the comparison chart as secondhand.**

### 3.7 Summary table

| Product | Layers / tiers | Extraction trigger | Retrieval | Quality gate? (what) | Promotion / merge / reject |
|---|---|---|---|---|---|
| **Mem0** (v1 paper) | Flat fact store + optional graph; only `procedural_memory` implemented | Per message pair on `add()`; async summary + 10-message window | Dense vector (top-10 for update); Mem0^g: entity-centric subgraph + semantic triplet | **Yes, LLM-judged** (`ClassifyOperation` tool call) | ADD / UPDATE (only if higher `InformationContent`) / **DELETE** (contradicted) / **NOOP** |
| **Mem0** (v3 current) | Same, graph built-in on Platform | Single-pass, async `add()`; top-10 existing as dedup context | Hybrid semantic + BM25 + entity boost fused; **only semantic results are candidates** | **No write-time judge**; MD5 exact-dup only | **ADD-only — accumulates**; conflicts resolved at retrieval |
| **Zep / Graphiti** | Episode (raw, non-lossy) → semantic entity → community | Per episode (`add_episode`); last 4 messages + reflexion pass | cosine + Okapi BM25 + BFS(n) → RRF / MMR / episode-mentions / node-distance / cross-encoder → constructor with validity ranges | **Yes, LLM judge** on duplicates + contradictions | Duplicates merged; contradictions **invalidated** (`invalid_at`), never deleted |
| **Letta / MemGPT** | Main context (system + blocks + FIFO queue) vs external (recall DB + archival); now MemFS git files | Event-driven (messages, system alerts, timed events); flush at ~70% / ~100% context | Blocks always in-context; archival = semantic vector search via tools; MemFS = file read + optional search mods | **No — agent-discretionary**; block char limits, read-only flags, error feedback only | No promotion/merge/reject; agent rewrites blocks and inserts archival items |
| **Honcho** | Workspace → Peer (Representation) / Session → Messages; conclusions, summaries, peer cards; directional `(observer, observed)` | Per message, async Deriver in a worker queue (+ parallel Summarizer); Dreamer periodic | Dialectic agent: semantic search over conclusions + supporting messages + premise tracing, inline | **Partly — Dreamer is the gate**, not the write path | Dreaming deletes outdated conclusions on contradiction; inductive patterns need ≥2 sources and carry confidence from support count |
| **Supermemory** | Documents (chunks) + memories (graph) + profile (static/dynamic) | Async document pipeline; memories from a second "dreaming" phase (dynamic grouped / instant immediate) | `searchMode` memories / documents / hybrid; `similarity` score; `relatedMemories`; `/v4/profile` | **Yes** — inferred (`derives`) memories flagged and down-weighted until reviewed | `updates` / `extends` / `derives`; **decline a review → forgotten**; time/contradiction/noise forgetting; preferences strengthen with repetition |
| **Hindsight** (Vectorize) | Four networks: world, experience, opinion, observation (+ banks, mental models) | Explicit `retain`; LLM extracts facts + temporal ranges + entity links + network classification | 4-way parallel: pgvector semantic + BM25 (GIN) + graph traversal + temporal filter → RRF → cross-encoder → token budget | **Yes** — numeric opinion confidence updated by LLM-assessed reinforce/weaken/contradict | Opinions `c±α`, `c−2α`; observations deduped/refined with proof counts, never overwritten |

| Product | Storage |
|---|---|
| Mem0 | Neo4j (paper, graph) + ~20 pluggable vector stores; Platform graph built-in |
| Zep / Graphiti | Neo4j 5.26 / FalkorDB / Neptune + OpenSearch / Kuzu (deprecated); Zep = proprietary Context Graph Engine |
| Letta / MemGPT | PostgreSQL + pgvector + HNSW (paper); blocks/archival in DB; MemFS = git repo |
| Honcho | PostgreSQL + pgvector + SQLAlchemy/Alembic |
| Supermemory | Embedded "temporal vector-graph engine" (vector + FTS + graph); no third-party DB named |
| Hindsight | PostgreSQL: HNSW pgvector + GIN BM25; embedded `.pg0` default |

### 3.8 Verification notes for §3

1. **Mem0 docs contradiction (verified).** The core-concepts memory-types page still describes ADD/UPDATE/DELETE, contradicting both migration guides and `main`-branch source (`ADDITIVE_EXTRACTION_PROMPT`, verified). Unresolved.
2. **MemGPT function names (verified negative).** `core_memory_append` / `core_memory_replace` / `archival_memory_insert` / `archival_memory_search` do **not** appear in arXiv:2310.08560.
3. **Supermemory retrieval internals and storage engine** are not publicly documented beyond "custom learning model + temporal vector-graph engine"; no arXiv paper found; benchmark claims are vendor self-reported.
4. **Hindsight identification** confirmed as `vectorize-io/hindsight`; paper [arXiv:2512.12818](https://arxiv.org/abs/2512.12818) verified by title.
5. **Benchmark comparability.** Mem0's paper numbers (LoCoMo J 66.88/68.44, Apr 2025) and Mem0's v3 vendor numbers (LoCoMo 91.6, LongMemEval 93.4) are **not comparable** — different algorithms and harnesses. Hindsight and Supermemory publish LoCoMo/LongMemEval numbers with different backbones and no shared harness. **Do not place these in one column without re-running.**

---

## 4. The critical comparison: who SELECTS and who merely ACCUMULATES

### 4.1 Three tiers, defined precisely

The brief's binary (selection vs accumulation) is real but too coarse. What the survey actually found is **three** tiers, and the middle one is where most products sit — which is why teams often believe they have a gate when they do not.

**Tier A — ACCUMULATE.** Every extracted item is persisted. Nothing is refused, demoted, merged, or contradicted. Retrieval ranking is the only filter, applied *after* the store has already accepted the item. There may be an exact-duplicate check, but that is identity dedup, not judgment.

**Tier B — ELIGIBILITY GATE.** Something must be true about the *circumstances* of the write before it happens — the session was idle, the agent used enough iterations, the content passed a secret scan, the file is under a size budget, the source session is the right kind, rate-limit headroom exists. These gates reduce *volume* and *risk*. **They contain no opinion about whether the item is good.** A wrong-but-plausible fact passes an eligibility gate exactly as easily as a correct one.

**Tier C — QUALITY GATE.** Something evaluates the *content or its evidence* and can conclude "no". Tier C is what a selection mechanism actually is. It has three sub-forms, and they have very different cost/failure profiles:

- **C1 — Deterministic score + thresholds.** Arithmetic over observable signals (retrieval relevance, frequency, query diversity, recency, reinforcement count), compared against fixed thresholds. Cheap, auditable, reproducible, and *cannot be talked out of a decision by a persuasive generation*.
- **C2 — LLM judge.** A model is asked to classify the candidate against existing state (ADD/UPDATE/DELETE/NOOP; duplicate/contradicted/neither; keep/patch/consolidate/archive). Cheap per item, flexible, but inherits every model failure mode and is unverifiable unless the decision is logged with its evidence.
- **C3 — Evidence accounting / human review.** A numeric confidence updated by counted evidence (`c±α`, proof counts, support-count thresholds) or an explicit approve/decline queue. The most trustworthy, the most expensive, and the only form that can *reverse* a prior decision.

**The single most useful finding of this survey is that Tier C gates in production are almost always C1 or C2 acting on *evidence about usage or contradiction*, and almost never acting on *judgment about usefulness*.** Nobody has a reliable automatic answer to "is this lesson actually good?" The systems that look principled (OpenClaw, the Hermes curator, the self-evolution pipeline) all sidestep that question by gating on **fitness proxies they can measure** — retrieval demand, recurrence, test suites, benchmark regression — rather than on quality per se.

### 4.2 Per-system verdict

| System | Tier | The gate, concretely | Can it say **no** to a *good-looking but wrong* item? |
|---|---|---|---|
| **OpenClaw memory** (dreaming deep phase) | **C (C1 + C2 + C3-lite)** | Deterministic weighted score (`minScore` ∧ `minRecallCount` ∧ `minUniqueQueries`) → structural removal of `untrusted`/`system` provenance **before prompting** → LLM returns operation decisions → rewrite rejected unless prior-entry loss ≤ 25%, every promoted candidate carries `Source: path#Lx-Ly`, size budget respected, and structured output parses → else **append-only fallback**; preimage stored | **Yes** — the score can fail, provenance can disqualify before any model sees it, and the rewrite validator can reject the model's own output |
| **OpenClaw skills** (`skill_workshop` + `skill_proposal_evaluate`) | **C (C3 veto)** | Static scan, content-hash binding, size validation, rollback metadata, plus a plugin evaluator that can return `decision: "block"` (only a completed block vetoes). Capture also requires ≥10 iterations + 30 s quiet + eligible foreground turn | **Yes** — but the veto is opt-in (a plugin must implement it), so a default install may have none |
| **Hermes skills — Curator** | **C (C1 + C2)** | ① Deterministic lifecycle from usage telemetry (`use_count`/`view_count`/`patch_count`/`last_activity`), with pinned / cron-referenced / never-used-grace exemptions. ② Opt-in LLM pass that must keep / patch / consolidate / archive, with **code-enforced fail-closed guards**: deletes require a verified `absorbed_into` target, writes require a read-in-this-turn, non-curator-managed skills are off-limits | **Yes, for staleness and duplication** (measured). **No, for correctness** — a wrong-but-used skill survives, and the LLM pass is off by default |
| **Hermes memory** (MEMORY.md / USER.md) | **B** | Char budgets (2200 / 1375), exact-duplicate rejection, content scan, read-failure refusal, drift detection, atomic write — plus optional `memory.write_approval` for a human | **No.** Admission is the reviewing LLM's judgment. The budgets and dedup check are eligibility, not quality |
| **Hermes background review** (the producer) | **A** | None beyond the tool whitelist and the review prompt's negative list | **No** — and the prompt is explicitly biased *toward* writing: "A pass that does nothing is a missed learning opportunity, not a neutral outcome" |
| **Hermes self-evolution** (`hermes-agent-self-evolution`) | **C (strongest in survey)** | Fitness = rubric LLM-judge with length penalty + semantic-similarity check; **gates**: pytest 100% ∧ TBLite fast subset ∧ (top-3 only) full TBLite ∧ YC-Bench coherence; train/val/**holdout** splits; **"a variant that improves skill quality by 20% but drops TBLite by 5% is REJECTED"**; output is a PR, never a commit | **Yes** — and it is the only system here with an explicit *regression* gate and holdout separation. **Caveat: Phase 1 is the only implemented phase, and it produces PRs rather than running in-product** |
| **Mem0 v1 / arXiv** | **C (C2)** | Per-fact LLM `ClassifyOperation` over the top-10 similar memories → ADD / UPDATE (only if higher information content) / **DELETE** against contradicted memories / **NOOP** | **Yes** — DELETE and NOOP are genuine reject outcomes, and the UPDATE information-content guard blocks low-information overwrites |
| **Mem0 v3 (current)** | **A** | MD5 exact-duplicate rejection only. Conflicts moved to retrieval time. `ADDITIVE_EXTRACTION_PROMPT`: "Your sole operation is ADD" | **No.** *This is a regression in selection capability that the docs have not fully caught up with* |
| **Zep / Graphiti** | **C (C2)** | LLM `resolve_edge` returns `duplicate_facts` + `contradicted_facts`; contradictions set the old edge's `invalid_at` (never deleted); entity resolution merges duplicates | **Yes** — a contradicted fact is retired. But priority is given to *new* information, so a confidently-stated wrong fact can invalidate a right one |
| **Letta / MemGPT** | **A** | Per-block char limits, read-only flags, error feedback, retrieval pagination. Eviction at ~70%/100% context is a *token* threshold | **No.** Explicitly agent-discretionary. Letta's own blog concedes memories "may become messy and disorganized over time" |
| **Honcho** | **A at write time / C (C2+C3-lite) at dream time** | Dreamer deduction deletes outdated conclusions and resolves contradictions; induction requires ≥2 supporting conclusions and assigns confidence from support count; triggers at ≥50 new conclusions + ≥8 h cooldown + 60 min idle | **Eventually, yes** — but never on the write path, so wrong facts are live and retrievable for hours |
| **Supermemory** | **C (C3)** | Inferred (`derives`) memories flagged `isInference: true` and **down-weighted until reviewed**; review queue supports approve / **decline → forgotten** / undo. Forgetting by expiry, contradiction, and noise; preferences strengthen with repetition | **Yes, and it is the only system with an explicit human-in-the-loop reject queue as a first-class product surface** |
| **Hindsight (Vectorize)** | **C (C3)** | Opinions carry confidence `c ∈ [0,1]`; new evidence is classified `{reinforce, weaken, contradict, neutral}` and applied as `c+α` / `c−α` / **`c−2α`**; observations consolidated with exact quotes and a **proof count**, refined rather than overwritten | **Yes, numerically** — a contradicted opinion is demoted twice as hard as it is strengthened. Note it demotes rather than rejects, so low-confidence items remain retrievable |
| **Claude Code auto memory** | **B** | Index size guard (first 200 lines / 25 KB load at session start) + model judgment | **No** |
| **Codex Memories** | **B** | Idle threshold, skip active/short-lived sessions, secret redaction, rate-limit floor, separate `consolidation_model` | **No** |
| **Gemini CLI `save_memory`, Cline Memory Bank, AGENTS.md, Cursor rules, OpenHands skills, LangMem** | **A / B** | None documented. LangMem's LLM consolidation is a soft prompt-level control | **No** |

### 4.3 Four selection archetypes, and what each is actually good for

Pulling the Tier-C systems apart, there are only four mechanisms in production anywhere in this survey. This is the most reusable output of the whole document.

**Archetype 1 — Demand-driven promotion (OpenClaw dreaming).** The signal is *retrieval demand*: relevance, frequency, distinct queries that surfaced the item, recurrence across days. The insight is that **a memory nobody ever retrieves is not worth promoting, regardless of how true it is**, and that this is measurable without any judgment about content. Guard rails that make it work: thresholds are conjunctive (score ∧ recall-count ∧ query-diversity, so a single high-relevance hit cannot promote), only *interactive* sessions feed the corpus, recalled context is stripped so the system cannot learn its own output, and the LLM's rewrite is validated against a bounded prior-entry loss. **Weakness:** a genuinely important fact that has not yet been needed cannot be promoted. This is a *popularity* gate, which is a proxy for usefulness, not a measure of it.

**Archetype 2 — Lifecycle curation by telemetry (Hermes curator).** The signal is *use over time*: `use_count`, `view_count`, `patch_count`, `last_activity`, with an explicit never-used grace floor because "`use=0` is absence of evidence, not proof the skill is disposable". Selection here is mostly *negative* — it removes what has gone unused, and optionally asks an LLM to consolidate overlapping items into umbrellas. The design choices worth stealing are the ones that make it safe rather than the ones that make it clever: **fail-closed guards** (a delete without a verified forwarding target is refused; a write without a read-in-this-turn is refused; anything not explicitly marked as curator-managed is off-limits), the **append-only ledger with per-file `{path, sha256}` before/after manifests and content-addressed blobs**, whole-tree snapshots, single-entry rollback, and the honest framing that `created_by` "is a policy flag, not a provenance claim". **Weakness:** all of it is *staleness* selection. A wrong-but-popular skill is never challenged.

**Archetype 3 — LLM conflict resolution at write time (Mem0 v1, Zep, Mem0^g).** The signal is *semantic relation to existing state*: not-similar → add; contradicts → delete or invalidate; augments → update; equivalent → noop. This is the only archetype that directly attacks **contradiction**, which is the failure mode users notice most. Three implementation lessons: (a) always retrieve the nearest neighbours *first* and put them in the judging context, or the judge has nothing to compare against; (b) give the judge an explicit **NOOP/equivalent** branch, or it will invent a write to look productive; (c) prefer **invalidate over delete** (both Zep and Mem0^g do) so temporal queries stay answerable. **Weakness:** the judge is a model, the decision is unauditable unless logged with evidence, and — as Mem0 v3 demonstrates — a vendor under latency pressure may quietly drop the whole mechanism. *Always verify the current code path, not the paper.*

**Archetype 4 — Evidence accounting / human review (Hindsight, Supermemory).** The signal is *counted support*. Hindsight stores opinions with a numeric confidence and applies `c+α` on reinforcement and **`c−2α` on contradiction**; observations carry a proof count and exact quotes and are refined rather than overwritten. Supermemory flags inferred (`derives`) memories, down-weights them until reviewed, and gives the user approve/decline/undo. This is the only archetype where a learned item has an *explicit, inspectable quality state* that changes over time — which is exactly what makes a memory store debuggable. **Weakness:** cost, and the fact that low-confidence items remain retrievable rather than being held back.

### 4.4 Cross-cutting engineering lessons

1. **Separate the producer from the selector.** Hermes is the clearest case: an eager, ungated producer (background review — explicitly told that doing nothing is a "missed learning opportunity") paired with a conservative, gated selector (curator, off by default). OpenClaw does the same with light/REM (no durable writes) feeding a gated deep phase. Codex, Claude Code and Letta fuse the two roles and consequently have no gate at all. **If you build one thing from this report, build them as two components with different authority.**
2. **Gate on measurements, not on assertions.** Every credible gate found is arithmetic or a test suite. The only place `LLM quality judgment` appears as the *sole* gate is in systems with no gate (Letta, Hermes memory, Claude Code).
3. **Make the gate fail closed, and prove it in code.** The two most instructive artifacts in this survey are `_curator_consolidation_delete_guard` (a delete with no forwarding target is refused, because issue #29912 showed whole clusters of active skills being archived with `consolidated_this_run == 0`) and `_background_review_read_before_write_guard` (a write without a read-in-this-turn is refused). Prompts do not enforce policy; refusals do. Both guards carry the incident number that motivated them — worth copying as a documentation practice.
4. **Budget is not judgment, but it is load-bearing.** Every system has size limits (Hermes 2200/1375 chars; Claude Code 200 lines/25 KB; self-evolution 15 KB skills / 500-char tool descriptions; OpenClaw `maxPromotedSnippetTokens: 160`). These prevent prompt bloat and cost blowup; they do nothing for correctness. Do not let a size guard be reported internally as a quality gate.
5. **Keep the negative list.** Hermes' skill prompt enumerates what *not* to learn — environment-dependent failures, negative claims about tools ("these harden into refusals the agent cites against itself for months after the actual problem was fixed"), transient errors that resolved, one-off narratives — and redirects each to the correct capture (the *fix*, or the retry pattern). This is a cheap, high-leverage artifact: it is a rejection policy expressed as prose, and it is the closest thing in production to "reject these classes of memory".
6. **Never learn from the system's own output.** OpenClaw strips "runtime-marked recalled context … so recalled snippets cannot be learned again as new memory". Hermes passes `skip_memory=True` to the review fork precisely so the *harness prompt* cannot leak into the user's memory namespace. This is a real, observed failure mode in both projects.
7. **Do not learn from subagents, or decide deliberately that you want to.** Hermes blocks automatic review when `_delegate_depth > 0`, which means work done in fan-out subagents is invisible to the learning loop. That may be right (children lack the parent's context) or wrong (most of the work happens there) — but it should be a decision, not an emergent property.
8. **Log the decision, including the rejections.** The Hermes ledger stores before/after hashes and supports single-mutation rollback; OpenClaw's Dream Diary records "added, merged, and superseded counts plus short diff-style highlights", and deep reports "summarize why ranked candidates were not promoted, using **counts by rejection category**". A store that cannot tell you *why* something was rejected cannot be tuned.
9. **Expect the ablation to be the hard part.** Issue #337's own risk list names the real problem: *"Evaluation is hard — Defining 'good' for complex agent tasks is subjective. Bad evaluation → bad evolution. This is the critical challenge."* §5 shows that the benchmark community has largely not solved it either.

### 4.5 Recency warning for your comparison

Two of the systems most often cited as having conflict resolution have moved *away* from it or never had it in a form you can rely on:

- **Mem0** is the canonical "ADD/UPDATE/DELETE/NOOP" citation, and its current code path is **ADD-only**. If your comparison table says "Mem0: LLM-judged conflict resolution", it is describing a 2025 paper, not the 2026 product. *(Verified in `mem0/configs/prompts.py`.)*
- **Letta/MemGPT** is the canonical "self-editing memory" citation, and self-editing is *agent discretion*, not selection. The API names people cite from it (`core_memory_append`, `core_memory_replace`) are not in the paper at all. *(Verified negative.)*

**Always re-verify at the code path, and date every entry in your table.**

---

## 5. Agent memory benchmarks

Full report with per-claim citations and the reliability audit: **`agent-memory-benchmarks-report.md`** (same `reports/` directory). Every arXiv ID in this section was **independently re-verified by me** by fetching its `arxiv.org/abs/` page and reading the returned `<title>` / `citation_title`; the titles below are the actual verified titles. Where a suggested ID in the brief was wrong, I say so.

### 5.1 LongMemEval

**"LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory"** — [arXiv:2410.10813](https://arxiv.org/abs/2410.10813) (**verified**). Repo: [`github.com/xiaowu0162/LongMemEval`](https://github.com/xiaowu0162/LongMemEval). Data: `huggingface.co/datasets/xiaowu0162/longmemeval-cleaned`. ICLR 2025 (submitted Oct 2024, revised Mar 2025).

**Measures five core abilities over 500 questions:** information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and abstention. Seven concrete question types: single-session-user, single-session-assistant, single-session-preference, multi-session, knowledge-update, temporal-reasoning, and abstention (`_abs` suffix).

**Design.** A **164-attribute** user ontology in 5 categories seeds LLM-proposed Q/A pairs, which **human experts then filtered and rewrote in full**, decomposing answers into evidence statements with timestamps. Each statement is embedded into a task-oriented evidence session via self-chat so facts are conveyed *indirectly*, and then human-screened again. Histories are freely scalable: **LongMemEval_S ≈ 115 k tokens (~40 sessions)** and **LongMemEval_M = 500 sessions (~1.5 M tokens)**, plus an oracle variant containing only evidence sessions.

**Retrieval-vs-long-context evaluation.** Memory is decomposed into three stages (indexing, retrieval, reading) with four control points (value, key, query, reading strategy). Reported findings: round-level granularity beats session-level; fact compression helps multi-session reasoning but hurts overall; key expansion with user facts improves recall@k by **9.4%** and QA by **5.4%**; time-aware query expansion improves temporal recall by **6.8–11.3%**; Chain-of-Note with structured formatting improves QA by up to **10 absolute points**. Judging is an LLM judge (`gpt-4o-2024-08-06`) with **>97% human agreement**; Recall@k and NDCG@k come from answer-location labels.

**Headline results.** 30–60% drop for long-context LLMs on _S; ChatGPT+GPT-4o **0.5773**, GPT-4o-mini **0.7113**, offline reading **0.9184**.

**Fairness.** Partially separates memory-system quality from model quality: the harness fixes the reader and varies the memory pipeline, and it reports retrieval metrics separately from end-to-end QA. But end-to-end accuracy still confounds reader strength, and the judge is a moving part.

**Limitations.** MemoryAgentBench criticizes its "limited topical diversity and less realistic interaction patterns". More seriously, the authors **re-cleaned the histories in September 2025 "to prevent interference on answer correctness"** — a tacit contamination admission. Successor: **LongMemEval-V2** ([arXiv:2605.12493](https://arxiv.org/abs/2605.12493), verified: *"Evaluating Long-Term Agent Memory Toward Experienced Colleagues"*).

### 5.2 LoCoMo — and why you should not rank systems with it

**"Evaluating Very Long-Term Conversational Memory of LLM Agents"** — [arXiv:2402.17753](https://arxiv.org/abs/2402.17753) (**verified**). UNC/USC/Snap. Site: [snap-research.github.io/locomo](https://snap-research.github.io/locomo/).

**Design.** A machine–human pipeline: two LLM agents with personas and **temporal event graphs** (up to 25 causally-linked events over 6–12 months), a reflect-and-respond memory module, and image share/react. Human annotators edited **~15% of turns** and removed or substituted **~19% of images**. **50 conversations**, **304.9 turns** avg, **19.3 sessions**, **9,209.2 tokens** avg, spanning months.

**Question types and metrics — a correction to a common claim.** Five QA types: single-hop, multi-hop, temporal, open-domain, adversarial. The original paper's QA metric is **F1** ("F1 partial match"), with a human ceiling of **87.9**. The frequently repeated "F1, BLEU, ROUGE" is **wrong for the original paper**: for event summarization the authors explicitly reject BLEU/ROUGE ("focus on lexical similarity … not meeting our needs") and use **FactScore** (atomic-fact precision/recall/F1); multimodal dialogue uses **MMRelevance**. BLEU/ROUGE appear only in downstream reimplementations.

**The "J-score" is Mem0's, not LoCoMo's.** Mem0 ([arXiv:2504.19413](https://arxiv.org/abs/2504.19413), verified) evaluated **LOCOMO only** and replaced F1 with an LLM-as-Judge "J" score (GPT-4o). Zep ([arXiv:2501.13956](https://arxiv.org/abs/2501.13956), verified) reports **DMR 94.8% vs MemGPT 93.4%** and, on LongMemEval, up to an 18.5% accuracy gain with 90% lower latency.

**⚠️ Reliability problems — flag these to anyone about to quote LoCoMo numbers.** An independent audit at [`github.com/dial481/locomo-audit`](https://github.com/dial481/locomo-audit) **[secondhand but methodologically specific]** reports:

- **99 of 1,540 questions (6.4%) have wrong gold answers**, capping the achievable score at **93.57%**;
- **62.81%** of intentionally wrong "vague but topical" answers are accepted by the LLM judge;
- **446 adversarial questions (22.5%)** are effectively unevaluated, and the original multiple-choice formatter is broken on 444 of them;
- EverMemOS claimed **92.32%**, reproduced by a third party at **38.38%**;
- multiple open **Mem0** reproducibility issues, and Zep acknowledged and corrected a **Category-5 scoring bug**;
- per-category sample sizes range 96–841, so most adjacent-pair comparisons are statistically indistinguishable at 95% CI; only Mem0 documents a multi-run methodology.

There is also a public **Zep-vs-Mem0 dispute**, in which Mem0's own reported **full-context baseline (72.9%) beat both Mem0 variants (66.88 / 68.44)** on overall J. **Bottom line: LoCoMo is cheap, widely reported, and currently not a reliable ranking instrument.** If you must use it, report multi-run means with variance and treat category-level differences as noise.

### 5.3 MemoryAgentBench

**"Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions"** — [arXiv:2507.05257](https://arxiv.org/abs/2507.05257) (**verified — the ID in the brief is correct; the title is not what the brief says**). UCSD; ICLR 2026. Repo: [`github.com/HUST-AI-HYZ/MemoryAgentBench`](https://github.com/HUST-AI-HYZ/MemoryAgentBench).

**Four competencies — with a version discrepancy worth knowing.** The v4 camera-ready lists: **accurate retrieval, test-time learning, long-range understanding, and selective forgetting**. The earlier arXiv version and the current repo README list **"conflict resolution"** instead of selective forgetting. The underlying `FactConsolidation` dataset is unchanged and the repo's metric table still says "Conflict Resolution". So if you cite "conflict resolution" you are citing the preprint; if you cite "selective forgetting" you are citing the camera-ready. Both refer to the same dataset.

**Datasets (2,071 questions, contexts 103 K–1.44 M tokens):** RULER-QA, RULER-NIAH-MQ, infBench-QA, LongMemEval(S\*) plus a new **EventQA** (accurate retrieval); BANKING77, CLINC150, NLU, TREC-Coarse/Fine, REDIAL (test-time learning); infBench-Sum (long-range understanding); new **FactConsolidation-SH/MH** (conflict resolution / selective forgetting).

**The central methodological claim.** Static long-context datasets "are not directly applicable to evaluating memory agents" because memory is compressed and distilled and agents "process context incrementally" — so MemoryAgentBench **chunks inputs and feeds them one at a time**, and uses "inject once, query multiple times" for efficiency. This is the single most important design idea in the memory-benchmark literature for a team building a streaming memory layer.

**Results.** RAG wins accurate retrieval; **long-context wins test-time learning and long-range understanding**; and **all methods fail conflict resolution** — multi-hop performance is "at most 6%". Commercial memory agents score poorly: **Mem0 28.0 on RULER-QA, 4.8 on NIAH-MQ, 3.4 on MCC, 0.8 on infBench-Sum**, attributed to fact extraction discarding content plus single-pass retrieval.

**Fairness.** Reasonably controlled — all RAG and commercial agents share a **GPT-4o-mini** backbone with long-context rows as a same-family reference — but it is not a pure memory-score decomposition.

### 5.4 The 2025–2026 wave

All IDs below were verified by me against `arxiv.org/abs/`.

| Benchmark | ID (verified) | What it measures | Notes |
|---|---|---|---|
| **HaluMem** | [2511.03506](https://arxiv.org/abs/2511.03506) "HaluMem: Evaluating Hallucinations in Memory Systems of Agents" | Operation-level hallucination: extraction, updating, QA | ~15 k memory points, ~3.5 k questions, 1.5 k–2.6 k turns/user, >1 M tokens; shows hallucinations accumulate through extraction/update and propagate to QA |
| **MemBench** | [2506.21605](https://arxiv.org/abs/2506.21605) "MemBench: Towards More Comprehensive Evaluation on the Memory of LLM-based Agents" | Factual vs reflective memory; participation vs observation | ACL 2025 Findings. **Distinct from MemoryBench** — commonly conflated |
| **MemoryBench** | [2510.17281](https://arxiv.org/abs/2510.17281) "MemoryBench: A Benchmark for Memory and Continual Learning in LLM Systems" | Continual learning from accumulated **user feedback** | Explicitly service-time feedback, not long-form reading |
| **PersonaMem** | [2504.14225](https://arxiv.org/abs/2504.14225) "Know Me, Respond to Me: Benchmarking LLMs for Dynamic User Profiling and Personalized Responses at Scale" | Dynamic profiling + personalization | COLM 2025; 180+ profiles, up to 60 sessions; frontier ~50% |
| **PersonaMem-v2** | [2512.06688](https://arxiv.org/abs/2512.06688) "PersonaMem-v2: Towards Personalized Intelligence via Learning Implicit User Personas and Agentic Memory" | Implicit persona learning; agentic memory | 1,000 interactions, 300+ scenarios, 20 k+ preferences; frontier 37–48%; agentic memory 55% at 16× fewer tokens |
| **PrefEval** | [2502.09597](https://arxiv.org/abs/2502.09597) "Do LLMs Recognize Your Preferences? Evaluating Personalized Preference Following in LLMs" | Infer / memorize / adhere to preferences | ICLR 2025 oral; 3,000 pairs, 20 topics, to 100 k tokens. **⚠️ The brief's suggested ID 2505.15347 is wrong — that is FlowKV.** **Your suggested ID was incorrect; the correct one is 2502.09597** |
| **StructMemEval** | [2602.11243](https://arxiv.org/abs/2602.11243) "Evaluating Memory Structure in LLM Agents" | **Memory organization** (ledgers, to-do lists, trees) | RAG LLMs struggle; memory agents succeed only when prompted how to organize |
| **MemoryArena** | [2602.16313](https://arxiv.org/abs/2602.16313) "MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks" | Memory **guiding action** in interdependent multi-session tasks | ICML 2026; LoCoMo-saturated agents perform poorly |
| **MemGym** | [2605.20833](https://arxiv.org/abs/2605.20833) "MemGym: a Long-Horizon Memory Environment for LLM Agents" | Agentic memory across tau2-bench, deep research, SWE-Gym, WebArena | Reports **"memory-isolated scores that decouple memory performance from reasoning, retrieval, and tool-use ability"** |
| **LongMemEval-V2** | [2605.12493](https://arxiv.org/abs/2605.12493) "LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues" | static state recall, dynamic state tracking, **workflow knowledge**, **environment gotchas**, premise awareness | 451 questions, up to 500 trajectories / **115 M tokens**; AgentRunbook-C 72.5% vs best RAG 48.5% |
| **MemGAS** | [2505.19549](https://arxiv.org/abs/2505.19549) "From Single to Multi-Granularity: Toward Long-Term Memory Association and Selection of Conversational Agents" | Multi-granularity association/selection | **This is a method, not a benchmark** — commonly miscited as one |
| **MemAgent** | [2507.02259](https://arxiv.org/abs/2507.02259) "MemAgent: Reshaping Long-Context LLM with Multi-Conv RL-based Memory Agent" | RL segmented reading with overwrite memory | ICLR 2026 oral; 8 K→3.5 M token QA with <5% loss |
| **Memory-R1** | [2508.19828](https://arxiv.org/abs/2508.19828) "Memory-R1: Enhancing Large Language Model Agents to Manage and Utilize Memories via Reinforcement Learning" | An RL memory manager that learns ADD/UPDATE/DELETE/NOOP | 152 training QA pairs; evaluated on LoCoMo, MSC, LongMemEval. **Directly relevant to §4: it learns the selection policy rather than prompting it** |
| **AgentMemoryBench** | [ICLR 2026 workshop](https://iclr.cc/virtual/2026/10012519) (OpenReview `MSXbrNExax`) | improvement, retention, forgetting, **generalization**, conflict | Five modes over interleaved streams; full text behind a browser check |

**Non-memory benchmarks, verified for completeness:** GAIA [2311.12983](https://arxiv.org/abs/2311.12983) (466 questions; humans 92% vs GPT-4+plugins 15%); τ-bench [2406.12045](https://arxiv.org/abs/2406.12045) (tool-agent-user, pass^k); SWE-bench [2310.06770](https://arxiv.org/abs/2310.06770) (2,294 issues, 12 Python repos). **None is a memory benchmark and none has a cross-episode transfer protocol.**

### 5.5 Do any of them measure TRANSFER?

**Direct answer: recall and update/conflict handling are well covered; transfer is measured by only a handful of benchmarks, and none of the popular ones.** LongMemEval, LoCoMo, MemBench, MemoryBench, PersonaMem/-v2, PrefEval and HaluMem measure essentially zero transfer.

Split the field into three categories:

**(a) Recall of stored information** — LongMemEval, LoCoMo, MemBench, PersonaMem/-v2, PrefEval, HaluMem's QA stage, MemoryBench, and MemoryAgentBench's accurate-retrieval and long-range-understanding competencies. MemoryAgentBench's own results show RAG wins this outright, which means **a good recall score mostly tells you your retriever works.**

**(b) Update / conflict handling** — LongMemEval knowledge-update, MemoryAgentBench's `FactConsolidation`, HaluMem's extraction and updating stages, and the ADD/UPDATE/DELETE/NOOP line of work (Mem0, Memory-R1). The finding to internalize: **"all methods fail on the multi-hop situation (with achieving at most 6% accuracy)"**. This is the least-solved competency, and it is precisely the one §4's Tier-C gates exist to address.

**(c) A→B transfer — does a memory or skill learned on task A improve performance on task B?** Genuinely measured only by:

- **AWM — Agent Workflow Memory** ([arXiv:2409.07429](https://arxiv.org/abs/2409.07429), verified): induces reusable workflows offline or online and injects them to guide generation. Reports **"cross-task, website, and domain evaluations, surpassing baselines from 8.9 to 14.0 absolute points as train-test task distribution gaps widen"** on Mind2Web and WebArena (+24.6% / +51.1% relative success).
- **ExpeL** ([arXiv:2308.10144](https://arxiv.org/abs/2308.10144), verified): extracts natural-language insights from a training task set and recalls them at inference; explicit "transfer learning potential". *I could not verify a numeric transfer gain or the exact task-domain list from primary text.*
- **"Managing Procedural Memory in LLM Agents: Control, Adaptation, and Evaluation"** ([arXiv:2606.23127](https://arxiv.org/abs/2606.23127), verified — this is the paper the delegated pass referred to as **AFTER**): **382 enterprise tasks, six roles, 22 procedural skills**, with controlled settings for **local improvement, cross-task transfer, cross-role transfer, and cross-model generalization**. One refinement round improves 3.7–6.7 points; multi-model traces reach **73.1% cross-model accuracy**; some skills transfer broadly while others specialize and lose effectiveness.
- **AgentCL** ([arXiv:2606.02461](https://arxiv.org/abs/2606.02461), verified): **compositional streams in which earlier sub-solutions, evidence and workflows are intentionally reusable**, with explicit **transfer-gain metrics**. Its key methodological finding is the one to design around: **"naive streams offer limited ability to distinguish memory designs, whereas controlled streams more clearly distinguish their plasticity"** — and held-out settings often show limited gains and can expose memory-induced *degradation*.
- **AgentMemoryBench** (above): its generalization mode.
- **Diagnostic support — "When Continual Learning Moves to Memory"** ([arXiv:2604.27003](https://arxiv.org/abs/2604.27003), verified): on ALFWorld/BabyAI it finds **abstract procedural memories transfer more reliably than detailed trajectories**, negative transfer hurts hard cases most, and **strong forward transfer can induce severe forgetting**. This is the most actionable single result in the transfer literature: the *abstraction level* of what you store determines whether it transfers.
- **MemoryArena** (above): learn from earlier actions/feedback, distill to memory, guide later actions.
- **LongMemEval-V2** partially, via "workflow knowledge" and "environment gotchas" — recurring-task *knowledge* rather than behavioural transfer.

**Explicitly flagged:** purpose-built transfer benchmarks are essentially all 2026. Pre-2025 transfer evidence is AWM and ExpeL, which are *methods papers with transfer ablations*, not leaderboards. **If your team needs to claim transfer, you will have to build or adopt a harness rather than cite a benchmark.**

**Vendor evals:** I could not verify any rigorous published memory benchmark from Anthropic, OpenAI or Google — no primary harness, dataset, or results table. Treat all "vendor X reports Y on memory" claims, including the Supermemory and Hindsight numbers in §3, as unverified unless a paper and reproduction are attached.

### 5.6 Summary table

| Benchmark | Year | Measures | Metrics | Transfer? | Repo / ID |
|---|---|---|---|---|---|
| LongMemEval | 2024 (ICLR'25) | Recall: extraction, multi-session, temporal, knowledge update, abstention | LLM-judge accuracy (>97% human agreement), Recall@k, NDCG@k | No — (a)+(b) | `xiaowu0162/LongMemEval` |
| LoCoMo | 2024 | Very-long dialogue recall; event summarization; multimodal dialogue | QA **F1**; **FactScore**; MMRelevance; downstream J | No — (a) | `snap-research/locomo` |
| MemoryAgentBench | 2025 (ICLR'26) | AR, test-time learning, long-range understanding, conflict/selective forgetting | Accuracy, substring/exact match, Recall@5, LLM-judge, F1 | Partial — test-time learning is skill acquisition, but no A→B held-out protocol | `HUST-AI-HYZ/MemoryAgentBench` |
| HaluMem | 2025 | Operation-level hallucination: extraction, update, QA | Stage-wise hallucination/accuracy | No — (a)/(b) | 2511.03506 |
| MemBench | 2025 (ACL Findings) | Factual + reflective memory; participation/observation | Effectiveness, efficiency, capacity | No — (a) | `import-myself/Membench` |
| MemoryBench | 2025 | Continual learning from user feedback | Task metrics across domains/languages | Continual learning, not A→B | `THUIR/MemoryBench` |
| PersonaMem / v2 | 2025 / 2025 | Dynamic profiling, implicit personalization | Accuracy (~50%; v2 37–48%) | No — (a) | `bowen-upenn/PersonaMem` |
| PrefEval | 2025 (ICLR'25 oral) | Infer / memorize / adhere to preferences | Generation + classification | No — (a) | `prefeval.github.io` |
| StructMemEval | 2026 | Memory organization (ledgers, lists, trees) | Task accuracy | No (structure, not transfer) | 2602.11243 |
| MemoryArena | 2026 (ICML) | Memory guiding action in interdependent multi-session tasks | Task success | **Yes — action-level reuse** | `ZexueHe/MemoryArena` |
| MemGym | 2026 | Agentic memory across tau2-bench, deep research, coding, computer use | **Memory-isolated scores** | Isolates memory quality; not framed as A→B | 2605.20833 |
| LongMemEval-V2 | 2026 | Static/dynamic state, workflow knowledge, environment gotchas | Accuracy + latency | Partial — recurring-task knowledge | 2605.12493 |
| Memory-R1 | 2025 | Learned RL memory manager (ADD/UPDATE/DELETE/NOOP) | LoCoMo, MSC, LongMemEval | No — (b) | 2508.19828 |
| MemAgent | 2025 (ICLR'26 oral) | RL segmented reading with overwrite memory | RULER, 3.5 M-token QA | No (long-context) | 2507.02259 |
| AgentMemoryBench | 2026 (workshop) | Improvement, retention, forgetting, generalization, conflict | Five modes over interleaved streams | **Yes — generalization mode** | ICLR'26 workshop |
| *Managing Procedural Memory in LLM Agents* ("AFTER") | 2026 | Procedural skills: local improvement, cross-task, cross-role, cross-model | +3.7–6.7 pts; 73.1% cross-model | **Yes — the most explicit** | 2606.23127 |
| AgentCL | 2026 | Continual learning; transfer gains on compositional streams | Transfer-gain metrics; MemProbe | **Yes — explicit metrics** | 2606.02461 |
| AWM | 2024 | Workflow induction + reuse on web navigation | Success rate; +8.9–14.0 pts as train-test gap widens | **Yes** | 2409.07429 |
| ExpeL | 2023 (AAAI'24) | Insight/experience extraction + transfer | Task performance vs training volume | **Yes** | 2308.10144 |
| GAIA / τ-bench / SWE-bench | 2023–24 | Tool use / tool-agent-user / repo issue fixing | Accuracy; pass^k; % resolved | Not memory benchmarks | 2311.12983 / 2406.12045 / 2310.06770 |

### 5.7 Design lessons for your own harness

1. **Instrument three deltas separately, never one number.** Forward transfer (A→B gain), retention (does the gain persist), and **negative transfer** (does learning A hurt B) trade off against each other — [2604.27003](https://arxiv.org/abs/2604.27003) shows strong forward transfer can induce severe forgetting. A single "memory score" hides the failure you most need to see.
2. **Report a memory-isolated score, or run an explicit no-memory ablation on identical held-out tasks.** MemGym ([2605.20833](https://arxiv.org/abs/2605.20833)) is the reference implementation of the first approach. Without one of the two, you are measuring your reader model, not your memory layer.
3. **Construct reusability deliberately, or your transfer gains are indistinguishable from noise.** AgentCL's finding — naive streams cannot distinguish memory designs — means a benchmark built from independent tasks will show no measurable effect no matter how good your memory layer is.
4. **Feed context incrementally, not in one shot.** MemoryAgentBench's core methodological claim; it is also the only setting that resembles production.
5. **Prefer round/turn-level granularity and human-curated questions**, and **budget for an LLM-judge leniency check** — the LoCoMo audit found ~63% of deliberately wrong topical answers accepted.
6. **Report multi-run means with variance** (Mem0's paper does; almost nobody else does) and treat category-level differences as noise when per-category n is small.
7. **Start from the two competencies nobody passes.** Conflict resolution multi-hop is ≤6% across methods; abstention is a LongMemEval type most systems fail. Those are where a new memory design can still show a real result.

---

## Appendix A. Corrections to the brief's premises

1. **`o2alexanderfedin/hermes-agent-self-evolution` is a fork, not the origin.** GitHub API: `"fork": true`, source `NousResearch/hermes-agent-self-evolution`, 2 stars vs upstream 5,366. The upstream is the actual work. (§1.11.1)
2. **`hermes-forge` (named in issue #337) 404s.** The self-evolution repo was created at the exact timestamp of that comment. Rename is likely but **[unverified]**. (§1.11.1)
3. **`agent/error_classifier.py` is not a self-evolution component.** It classifies API/transport errors to drive failover; it does not classify task success and does not feed the learning loop. (§1.10)
4. **`core_memory_append` / `core_memory_replace` / `archival_memory_insert` / `archival_memory_search` are not in the MemGPT paper** (verified negative). The paper says "working context"; current Letta uses `memory_insert` / `memory_replace` / `memory_rethink`. (§3.3)
5. **Mem0's "ADD/UPDATE/DELETE/NOOP" is not what current Mem0 does.** `main`-branch source uses `ADDITIVE_EXTRACTION_PROMPT` ("Your sole operation is ADD"). The docs' memory-types page contradicts the migration guides and the code. (§3.1)
6. **MemoryAgentBench's ID is right but the title in the brief is wrong,** and its 4th competency was renamed between preprint and camera-ready ("conflict resolution" → "selective forgetting"). (§5.3)
7. **PrefEval is [2502.09597](https://arxiv.org/abs/2502.09597), not 2505.15347** (that is FlowKV). (§5.4)
8. **LoCoMo does not use BLEU/ROUGE for QA.** The paper uses F1, explicitly rejects BLEU/ROUGE for summarization in favor of FactScore, and the "J-score" is Mem0's addition. (§5.2)
9. **Hermes' trajectory head/tail protection budgets are the offline compressor's, not the runtime's.** The live context compressor is a separate, much larger subsystem. (§1.9)
10. **The Hermes curator docs contradict themselves** on `stale_after_days` / `archive_after_days` (14/30 in the config block vs 30/90 in the lifecycle prose). The config block is authoritative. (§1.6)
11. **The Hermes skill nudge is counted in tool iterations, not agent turns,** despite the docs' "~every 10 agent turns". (§1.2)

## Appendix B. What I could NOT verify

- **The `hermes-forge` → `hermes-agent-self-evolution` rename.** High confidence, no primary confirmation.
- **The `forge/` vs `evolution/` package name** in the self-evolution repo — `PLAN.md` and the issue comment say `forge/`, the README quick-start says `evolution/`.
- **OpenClaw's "clawdbot → moltbot → openclaw" rename lineage.** Only indirect primary evidence (a legacy `metadata.clawdbot` frontmatter block); the history itself is secondhand.
- **Cursor "Memories".** `cursor.com/docs/context/memories` redirects to `/docs/rules`; could not confirm whether the feature still exists.
- **Windsurf memory/rules docs** — `docs.windsurf.com` cross-origin-redirects to `docs.devin.ai`; no facts included rather than guessed.
- **OpenAI Codex memories live docs** — returned HTTP 403; the delegated pass used a third-party GitHub mirror of the official docs (labeled).
- **Claude Code's `#` shortcut** for adding to memory — absent from current memory docs; could not verify it still exists.
- **Devin, Sourcegraph Amp, Agent Zero, AutoGen, CrewAI, SWE-agent** — not verified in this pass; omitted rather than guessed.
- **OpenHands' legacy "microagents"** terminology and file layout — the legacy doc path 404s to the new Skills docs.
- **Supermemory's retrieval fusion algorithm and storage engine** — not publicly documented; no arXiv paper found; benchmark claims are vendor self-reported.
- **ExpeL's exact task-domain list and a numeric transfer gain** — not extractable from the primary text I saw.
- **SWE-bench Verified's exact size, and the "SWE-bench Illusion"/SWE-bench+ contamination critiques** — no primary source found.
- **Any rigorous published memory benchmark from Anthropic, OpenAI or Google** — no primary harness, dataset, or results table exists publicly. All vendor memory-benchmark claims are unverified.
- **The AgentMemoryBench workshop paper's full text** — the venue page is public but the paper is behind a browser check.
- **`NousResearch/hermes-agent` line numbers** are from the `main` revision at the time of writing and will drift. All quoted text was read from that revision; URLs use `blob/main/`, which will track the moving head rather than pin the revision.
- **Honcho's and Supermemory's claims in §3.4–3.5 are from the delegated pass only.** I did not independently re-verify them; I verified Mem0, Zep, MemGPT, Hindsight, and the benchmark IDs myself.

## Appendix C. Sibling reports in this directory

Three other workstreams have written into `reports/` for what appears to be the same program. They are complementary to this document and I did not duplicate their content:

| File | Relationship to this report |
|---|---|
| `agent-memory-research-report.md` | The full §2 framework report (OpenClaw / Claude Code / other frameworks) with per-claim citations |
| `agent-memory-benchmarks-report.md` | The full §5 benchmark report, including the LoCoMo reliability audit in more detail |
| `memory-negative-results-review.md` | Independent audits and negative results for Mem0 and others — read alongside §3.1 and §5.2 before quoting any vendor number |
| `skill-extraction-literature-review.md` | 2023–2026 literature on extracting reusable skills/experience from trajectories — the academic counterpart to §1's in-product loops |
| `measuring-skill-memory-transfer-report.md` | Dedicated treatment of the measurement instrument for transfer (the §5.5 question) |
| `negative-results-vendor-blogs.md`, `negative-results-agent-memory-skill-libraries.md` | Negative-results evidence bases |
