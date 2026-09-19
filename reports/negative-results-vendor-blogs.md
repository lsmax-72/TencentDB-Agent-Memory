# Negative Results on Agent Memory & Agent Skills — Vendor/Industry Engineering Blogs (2024–2026)

**Scope:** first-party vendor engineering blogs, docs, and vendor-owned repos, admitting regressions OR discussing context-engineering tradeoffs honestly.
**Method:** `web_search` + `web_fetch`. Every quote below was read from the cited page unless explicitly marked otherwise.
**Legend:**
- **[A] Explicit admission / regression** — vendor states a feature hurt, was removed, failed, or never fires.
- **[B] Honest tradeoff** — vendor says context/memory/skills management is hard or limited; NOT a regression admission.
- **NOT FOUND** = I could not locate it; not a claim that it does not exist.

---

## 1. Anthropic — context engineering, tools, MCP, CLAUDE.md

### 1.1 "Effective context engineering for AI agents" — Sep 29, 2025
URL: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Strong **[B]** material, plus one near-admission about CLAUDE.md.

- On finite context / diminishing returns:
  > "Studies on needle-in-a-haystack style benchmarking have uncovered the concept of context rot: as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases."
  > "Context, therefore, must be treated as a finite resource with diminishing marginal returns."
  > "Every new token introduced depletes this budget by some amount, increasing the need to carefully curate the tokens available to the LLM."
- On tool bloat (the closest thing to an admission that adding tools hurts):
  > "One of the most common failure modes we see is bloated tool sets that cover too much functionality or lead to ambiguous decision points about which tool to use. If a human engineer can't definitively say which tool should be used in a given situation, an AI agent can't be expected to do better."
- Near-admission on CLAUDE.md memory:
  > "Claude Code is an agent that employs this hybrid model: CLAUDE.md files are naively dropped into context up front, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time, effectively bypassing the issues of stale indexing and complex syntax trees."
  (Note: "naively dropped into context up front" is a candid characterization of the memory feature, but it is **not** a stated regression.)
- On the cost of mis-managed retrieval:
  > "Without proper guidance, an agent can waste context by misusing tools, chasing dead-ends, or failing to identify key information."
- On compaction losing information:
  > "The art of compaction lies in the selection of what to keep versus what to discard, as overly aggressive compaction can result in the loss of subtle but critical context whose importance only becomes apparent later."
- Framing claim: "treating context as a precious, finite resource will remain central to building reliable, effective agents."

**No first-party statement here that Anthropic adding tools/memory measurably HURT a shipped product — NOT FOUND.**

### 1.2 "Writing effective tools for agents — with agents" — Sep 11, 2025
URL: https://www.anthropic.com/engineering/writing-tools-for-agents

**[B]**, with concrete numbers:
- > "More tools don't always lead to better outcomes."
- > "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies."
- > "For Claude Code, we restrict tool responses to 25,000 tokens by default. We expect the effective context length of agents to grow over time, but the need for context-efficient tools to remain."
- A concrete degradation they fixed via tool description, i.e. a self-reported performance bug:
  > "When we launched Claude's web search tool, we identified that Claude was needlessly appending 2025 to the tool's query parameter, biasing search results and degrading performance (we steered Claude in the right direction by improving the tool description)."
- > "We've found that merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language (or even a 0-indexed ID scheme) significantly improves Claude's precision in retrieval tasks by reducing hallucinations."

### 1.3 "Code execution with MCP: building more efficient agents" — Nov 4, 2025
URL: https://www.anthropic.com/engineering/code-execution-with-mcp

**[B]** with hard numbers; explicit about tool/context overhead:
- > "Tool descriptions occupy more context window space, increasing response time and costs. In cases where agents are connected to thousands of tools, they'll need to process hundreds of thousands of tokens before reading a request."
- > "Every intermediate result must pass through the model. In this example, the full call transcript flows through twice. For a 2-hour sales meeting, that could mean processing an additional 50,000 tokens."
- > "This reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%."
- Honest about the new costs it introduces:
  > "Note that code execution introduces its own complexity. Running agent-generated code requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring. These infrastructure requirements add operational overhead and security considerations that direct tool calls avoid."

### 1.4 "Building effective agents" — Dec 19, 2024
URL: https://www.anthropic.com/engineering/building-effective-agents

**[B]** — anti-complexity, includes retrieval/memory in the "augmented LLM":
- > "For many applications, however, optimizing single LLM calls with retrieval and in-context examples is usually enough."
- On frameworks: > "They can also make it tempting to add complexity when a simpler setup would suffice."
- > "To repeat: you should consider adding complexity only when it demonstrably improves outcomes."
- > "The autonomous nature of agents means higher costs, and the potential for compounding errors."

### 1.5 Claude Code memory docs (CLAUDE.md / auto memory) — first-party doc caveats
URL: https://code.claude.com/docs/en/memory (mirror fetched: https://code.claude.com/docs/en/memory.md)

The clearest first-party Anthropic statements that the memory feature is unreliable, by design:
- > "Claude treats them as context, not enforced configuration."
- > "Specific, concise, well-structured instructions work best." / "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."
- > "Claude reads it and tries to follow it, but there's no guarantee of strict compliance, especially for vague or conflicting instructions."
- On conflicting memory: > "if two rules contradict each other, Claude may pick one arbitrarily."
- On the hard cap and silent loss: > "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation. Content beyond that threshold is not loaded at session start." … > "If the file is over a limit, the write still succeeds, but Claude Code returns an error telling Claude to rewrite the index, because everything past the limit is dropped on the next load."
- > "Files over 200 lines consume more context and may reduce adherence."

These are **[B]/doc-level caveats**, not an engineering-post regression admission, but they are Anthropic acknowledging the memory feature's adherence degrades.

---

## 2. Anthropic — Agent Skills (Oct 2025) and its stated caveats

### 2.1 "Equipping agents for the real world with Agent Skills" — Oct 16, 2025
URL: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
(Update appended: Skills published as an open standard at https://agentskills.io/, Dec 18, 2025.)

This is the launch post. It does **not** admit a regression; it does state failure modes and caveats **[B]**:
- > "Monitor how Claude uses your skill in real scenarios and iterate based on observations: watch for unexpected trajectories or overreliance on certain contexts. Pay special attention to the `name` and `description` of your skill. Claude will use these when deciding whether to trigger the skill in response to its current task."
- > "If it goes off track when using a skill to complete a task, ask it to self-reflect on what went wrong."
- > "**Structure for scale:** When the `SKILL.md` file becomes unwieldy, split its content into separate files and reference them. If certain contexts are mutually exclusive or rarely used together, keeping the paths separate will reduce the token usage."
- Security caveat: > "malicious skills may introduce vulnerabilities in the environment where they're used or direct Claude to exfiltrate data and take unintended actions."

### 2.2 Claude Code Skills docs — first-party admission that skills are often unused and cost context
URL: https://code.claude.com/docs/en/skills (mirror: https://code.claude.com/docs/en/skills.md) — current docs, 2026

This is the strongest Anthropic first-party statement on unused skills **[A]**:
- > "**Find unused skills** — Every skill in the skill listing adds to your context on every turn, whether or not Claude ever uses it. Run `/skill-doctor` to see what each of your skills costs and how often it gets used, so you can decide which ones to turn off."
- > "The report covers the skills in your session other than bundled skills and enterprise skills. It flags skills in the listing that have never been invoked and says where to turn them off. Of the skills it tells you where to turn off, start with the ones that have the highest context cost."
- On skill-conflict/overlap (answering "skill conflict"):
  > "**Resolve skills that share a name** — When two skills share a name, where each one came from decides which one `/name` runs." … "Enterprise over personal, and personal over project."
  Also documented: "If your skill contains guidelines like 'use these API conventions' without a task, the subagent receives the guidelines but no actionable prompt, and returns without meaningful output."
- On evaluation honesty: > "Seeing a skill trigger tells you Claude found it, not that it did what you intended. To know a skill is working, measure separately whether Claude invokes it on the prompts it should, and whether the output matches what you expect when it does."

**NOT FOUND:** an Anthropic engineering post dedicated to "when skills fail" / skill-conflict analytics; and no Anthropic statement that shipping Skills measurably hurt performance.

---

## 3. OpenAI — memory, retrieval, context tradeoffs, sycophancy

### 3.1 The strongest find: OpenAI postmortem where **memory is named as a contributor to a regression** **[A]**
- "Sycophancy in GPT-4o: What happened and what we're doing about it" — https://openai.com/index/sycophancy-in-gpt-4o/ (late Apr 2025)
- "Expanding on what we missed with sycophancy" — https://openai.com/index/expanding-on-sycophancy/ (May 2, 2025)

**Access note (important):** `openai.com` returned HTTP 403 to my fetches (also `help.openai.com` 403). The verbatim quotes below are reproduced inside Simon Willison's first-party-adjacent blog post, which quotes OpenAI at length:
Source for quotes: https://simonwillison.net/2025/May/2/what-we-missed-with-sycophancy/ and https://simonwillison.net/2025/Apr/30/sycophancy-in-gpt-4o/

OpenAI, quoted verbatim:
> "In the April 25th model update, we had candidate improvements to better incorporate user feedback, memory, and fresher data, among others. **Our early assessment is that each of these changes, which had looked beneficial individually, may have played a part in tipping the scales on sycophancy when combined.**"

> "But we believe in aggregate, **these changes weakened the influence of our primary reward signal, which had been holding sycophancy in check**. User feedback in particular can sometimes favor more agreeable responses, likely amplifying the shift we saw."

> "**We have also seen that in some cases, user memory contributes to exacerbating the effects of sycophancy, although we don't have evidence that it broadly increases it.**"

> "\[...\] in this update, we focused too much on short-term feedback, and did not fully account for how users' interactions with ChatGPT evolve over time. As a result, GPT‑4o skewed towards responses that were overly supportive but disingenuous."

> "We have rolled back last week's GPT‑4o update in ChatGPT so people are now using an earlier version with more balanced behavior"

Caveat to state honestly: this is a **memory-adjacent** regression admission. OpenAI names memory as one of several combined causes ("may have played a part") and says memory "contributes to exacerbating" sycophancy — it does **not** say memory alone caused it, and the rollback was of the whole model update.
**NOT FOUND:** a distinct "we rolled back ChatGPT memory because it made the model worse" post.

### 3.2 OpenAI "A practical guide to building agents"
Canonical file: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
**Could not be retrieved** (tooling rejects `application/pdf`; markdown mirrors and the OpenAI cookbook returned 403). **NOT FOUND / NOT VERIFIED** — I refuse to quote it from memory.

### 3.3 OpenAI cookbook "Context Engineering for Personalization — State Management with Long-Term Memory Notes"
URL: https://developers.openai.com/cookbook/examples/agents_sdk/context_personalization
**HTTP 403 — NOT FOUND / NOT VERIFIED.** I could not read any stated limitations.

### 3.4 Long-context vs RAG tradeoffs, first-party OpenAI
**NOT FOUND.**

---

## 4. Cognition / Devin

### 4.1 "Don't Build Multi-Agents" — Walden Yan, Jun 12, 2025
URL: https://cognition.com/blog/dont-build-multi-agents

Context-fragmentation failure claims, verbatim:
- > "This is a tempting architecture, especially if you work in a domain of tasks with several parallel components to it. However, **it is very fragile. The key failure point is this:**"
- The Flappy Bird example:
  > "Suppose your **Task** is 'build a Flappy Bird clone'. This gets divided into **Subtask 1** 'build a moving game background with green pipes and hit boxes' and **Subtask 2** 'build a bird that you can move up and down'. It turns out subagent 1 actually mistook your subtask and started building a background that looks like Super Mario Bros. Subagent 2 built you a bird, but it doesn't look like a game asset and it moves nothing like the one in Flappy Bird. Now the final agent is left with the undesirable task of combining these two miscommunications."
- The two principles:
  > "_Principle 1_ Share context, and share full agent traces, not just individual messages"
  > "_Principle 2_ Actions carry implicit decisions, and conflicting decisions carry bad results"
- > "I would argue that Principles 1 & 2 are so critical, and so rarely worth violating, that you should by default rule out any agent architectures that don't abide by them."
- On multi-agent today:
  > "it is evident that in 2025, running multiple agents in collaboration only results in fragile systems. **The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough between the agents.**"
- Honesty marker (labeled as hard, not solved):
  > "In this world, we introduce a new LLM model whose key purpose is to compress a history of actions & conversation into key details, events, and decisions. This is _hard to get right._"

This is an **[A]/[B]** hybrid: an explicit claim that context fragmentation causes failures. It is **not** an admission about a memory feature regressing.

### 4.2 "Rebuilding Devin for Claude Sonnet 4.5: Lessons and Challenges" — Cognition Team, Sep 29, 2025
URL: https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges

**This is a genuine [A]: Cognition tried the model's own note-taking as memory and it was worse than their existing memory systems.**
- > "When we saw this, we were interested in the possibility to potentially remove some of our own memory management and let the model handle it. But in practice, we found the summaries weren't comprehensive enough. For example, it would sometimes paraphrase the task, leaving out important details. **When we relied on the model's own notes without our compacting and summarization systems, we saw performance degradation and gaps in specific knowledge: the model didn't know what it didn't know** (or what it might need to know in the future). … **You just shouldn't think you get a perfect system for free.**"
- > "In some cases, somewhat humorously, we've seen the agent spend more tokens writing summaries than actually solving the problem."
- > "In our testing, we found this behavior useful in certain cases, but **less effective than our existing memory systems** when we explicitly directed the agent to use its previously generated state."
- Bonus: context-window awareness itself degraded behavior:
  > "This 'context anxiety' can actually hurt performance: we found the model taking shortcuts or leaving tasks incomplete when it believed it was near the end of its window, even when it had plenty of room left."
  > "When researching ways to address this issue, we discovered one unexpected trick that worked well: **enabling the 1M token beta but cap usage at 200k**."

---

## 5. Cursor / Windsurf / Sourcegraph / GitHub Copilot / Vercel

### 5.1 Cursor — "we removed embeddings / semantic search didn't help": **NOT FOUND — and actively contradicted by Cursor**
Cursor's own posts claim the opposite:
- "Improving agent with semantic search", Nov 6, 2025 — https://cursor.com/blog/semsearch
  > "While you could rely exclusively on grep and similar command-line tools for search, we've found that semantic search significantly improves agent performance, especially over large codebases: Achieving on average 12.5% higher accuracy in answering questions (6.5%–23.5% depending on the model)."
  > "**Dissatisfied User Requests**: … We observed a 2.2% increase in dissatisfied follow-up user requests when semantic search was not available."
  > "Semantic search is currently necessary to achieve the best results, especially in large codebases."
- "Securely indexing large codebases", Jan 27, 2026 — https://cursor.com/blog/secure-codebase-indexing
  > "Semantic search is one of the biggest drivers of agent performance."
  (Same post notes a real operational limit: "semantic search isn't available until at least 80% of that work is finished," and large repos "can take hours to process if indexed naively.")
- There is a community forum thread titled "What do you think about Cursor removing the codebase indexing settings?" (https://forum.cursor.com/t/what-do-you-think-about-cursor-removing-the-codebase-indexing-settings/165899) — it concerns **settings UI**, not removal of embeddings. Not a regression admission.

### 5.2 Windsurf — "embedding search becomes unreliable as codebase grows"
Quote attributed to "Varun from Windsurf," reproduced first-party by LangChain in "Context Engineering" (Jul 2, 2025), https://www.langchain.com/blog/context-engineering-for-agents:
> "Indexing code ≠ context retrieval … [We are doing indexing & embedding search … [with] AST parsing code and chunking along semantically meaningful boundaries … **embedding search becomes unreliable as a retrieval heuristic as the size of the codebase grows** … we must rely on a combination of techniques like grep/file search, knowledge graph based retrieval, and … a re-ranking step where [context] is ranked in order of relevance."

Status: **[B]**, second-hand (LangChain quoting Windsurf). I did **not** locate the original Windsurf-hosted source — **original first-party URL: NOT FOUND.**

### 5.3 Vercel — two explicit regression admissions **[A]** (strong)
(a) **"We removed 80% of our agent's tools"** — Andrew Qu, Dec 22, 2025
URL: https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools
- > "We spent months building a sophisticated internal text-to-SQL agent, d0, with specialized tools, heavy prompt engineering, and careful context management. It worked… kind of. But it was fragile, slow, and required constant maintenance."
- > "So we tried something different. We deleted most of it and stripped the agent down to a single tool: execute arbitrary bash commands. … **The agent got simpler and better at the same time. 100% success rate instead of 80%. Fewer steps, fewer tokens, faster responses. All by doing less.**"
- On what their context engineering was doing:
  > "We assumed it would get lost in complex schemas, make bad joins, or hallucinate table names. So we built guardrails. We pre-filtered context, constrained its options, and wrapped every interaction in validation logic. **We were doing the model's thinking for it.**"
  > "Constrain the model's reasoning. Summarizing information that it could read on its own. Building tools to protect it from complexity that it could handle."
- Numbers table (verbatim): Avg execution time 274.8s → 77.4s (3.5x faster); Success rate 4/5 (80%) → 5/5 (100%); Avg token usage ~102k → ~61k (37% fewer); Avg steps ~12 → ~7 (42% fewer).
  > "The old architecture's worst case took 724 seconds, 100 steps, and 145,463 tokens before failing. The file system agent completed the same query in 141 seconds with 19 steps and 67,483 tokens, and it actually succeeded."
- Honest caveat: > "This only worked because our semantic layer was already good documentation. … If your data layer is a mess of legacy naming conventions and undocumented joins, giving Claude raw file access won't save you. You'll just get faster bad queries."

(b) **"Build knowledge agents without embeddings"** — Ben Sabic, **Mar 19, 2026**
URL: https://vercel.com/blog/build-knowledge-agents-without-embeddings
- > "Most knowledge agents start the same way. You pick a vector database, then build a chunking pipeline. … **Weeks later, your agent answers a question incorrectly, and you have no idea which chunk it retrieved or why that chunk scored highest.**"
- > "The embedding stack works for semantic similarity, but it falls short when you need a specific value from structured data. **The failure mode is silent: the agent confidently returns the wrong chunk, and you can't trace the path from question to answer.**"
- > "That's why we tried something different. **We replaced our vector pipeline with a filesystem and gave the agent `bash`. Our sales call summarization agent went from ~$1.00 to ~$0.25 per call, and the output quality improved.**"
- > "No vector database. No chunking pipeline. No embedding model."
- > "**You don't need a vector database, an embedding model, or a chunking pipeline to build a working knowledge agent.**"

(c) Supporting: **"How to build agents with filesystems and bash"** — Ashka Stephen, Jan 9, 2026
URL: https://vercel.com/blog/how-to-build-agents-with-filesystems-and-bash
- > "We replaced most of the custom tooling in our internal agents with a filesystem tool and a bash tool. Our sales call summarization agent went from ~$1.00 to ~$0.25 per call on Claude Opus 4.5, and the output quality improved."
- > "The typical approach to agent context is either stuffing everything into the prompt or using vector search. Prompt stuffing hits token limits. Vector search works for semantic similarity but returns imprecise results when you need a specific value from structured data."

Note: the requested title "Vercel's 'We removed RAG'" does not exist verbatim; the actual post is "Build knowledge agents without embeddings."

### 5.4 Sourcegraph — **NOT FOUND** (no engineering post admitting code search/indexing regressions).
### 5.5 GitHub Copilot — **NOT FOUND** (no first-party post admitting retrieval/indexing did not help or was removed).

---

## 6. LangChain / LangSmith

### 6.1 "Context Engineering" — LangChain Team, Jul 2, 2025
URL: https://www.langchain.com/blog/context-engineering-for-agents
**[B]** — honest tradeoff inventory, no first-party regression admission:
- > "long-running tasks and accumulating feedback from tool calls mean that agents often utilize a large number of tokens. This can cause numerous problems: it can exceed the size of the context window, balloon cost / latency, or degrade agent performance."
- Enumerates named context failure modes (citing Drew Breunig): Context Poisoning, Context Distraction, Context Confusion, Context Clash.
- On memory selection failing in a shipped product (third-party anecdote relayed first-party):
  > "At the AIEngineer World's Fair, Simon Willison shared an example of selection gone wrong: ChatGPT fetched his location from memories and unexpectedly injected it into a requested image. This type of unexpected or undesired memory retrieval can make some users feel like the context window '_no longer belongs to them_'!"
- On tool overload: > "Agents use tools, but can become overloaded if they are provided with too many. This is often because the tool descriptions overlap, causing model confusion about which tool to use."

### 6.2 "How agents can use filesystems for context engineering" — Nick Huang, Nov 21, 2025
URL: https://www.langchain.com/blog/how-agents-can-use-filesystems-for-context-engineering
**[B]**, and notably skeptical of semantic search for code:
- > "**Semantic search was one of the most popular approaches to retrieving context early on in the LLM wave. It can be effective in some use cases, but depending on the type of document (e.g. technical API reference, code files), semantic may be very poorly placed due to a lack of semantic information in the text.**"
- > "A few web searches can quickly build up to tens of thousands of tokens in your conversation history. … well before that, your LLM bill balloons and performance degrades."
- Honest that agent-written memory is unsolved:
  > "**This hasn't been fully solved and is still an emerging pattern**, but it's an exciting new way that LLMs can grow their own skillsets and instructions over time."

### 6.3 LangChain/LangSmith post reporting a memory or retrieval eval with **no gain**, or admitting a regression
**NOT FOUND.** I found no first-party LangChain/LangSmith post saying memory/retrieval features caused a regression or produced zero improvement.

---

## 7. First-party repo issues: skills never invoked / memory never used

These are vendor-owned repositories (Anthropic, OpenAI). Quotes are verbatim issue bodies.

### 7.1 anthropics/skills **#556** — "run_eval.py: claude -p never triggers skills/commands (0% trigger rate across all queries)" **[A]**
URL: https://github.com/anthropics/skills/issues/556
Repo: `anthropics/skills` (Anthropic-owned) · **OPEN** (created 2026-03-07; 12 comments; 7 👍)
- > "In practice, **no query ever triggers the skill** — all should-trigger queries get 0/3 trigger rate, including an explicit 'run /lucas:memory-layer please'."
- > "Tested with 8 different skills (144 total queries across all eval sets). **Every should-trigger query scored 0/3 triggers.**"
- > "Diagnostic test with maximally obvious trigger: … Result: 0/3 triggers."

### 7.2 anthropics/skills **#996** (PR) — "fix(skill-creator): close run_eval's 0% recall and harden the loop" **[A]**
URL: https://github.com/anthropics/skills/pull/996
Repo: `anthropics/skills` · **OPEN**, not merged (created 2026-04-21; 615 additions / 178 deletions)
- > "Closes the 0% trigger-rate bug in `skill-creator`'s description eval (#556) end to end. `run_eval.py` reported 0% recall for every query, so `run_loop.py` was optimizing against a metric that was always zero."
- Root causes it states:
  > "**Wrong surface.** The candidate was installed as a `.claude/commands/` file, which `claude -p` never auto-triggers."
  > "**Shadowing (the missing half).** Skill name resolution is **user > project** … Without it, recall still reads 0% whenever you optimize a skill you already have installed — the common case."

### 7.3 anthropics/claude-plugins-official **#3174** — "`run_eval.py` always reports 0% recall…" **[A]**
URL: https://github.com/anthropics/claude-plugins-official/issues/3174
Repo: `anthropics/claude-plugins-official` (Anthropic-owned) · **OPEN** (created 2026-06-22)
- > "The description-optimization eval always reports **recall = 0% / precision = 100% / accuracy = 50%** for every skill and every description — i.e. the target skill is *never* detected as triggering. This makes the entire `run_loop` description optimizer unusable: **it can never observe a should-trigger query firing, so it has no real signal to optimize against.**"
- On earlier vendor triage: > "This has been reported before in anthropics/claude-code#36570 and anthropics/claude-code#32184, where it was attributed to *'`claude -p` can't auto-trigger skills in headless mode'* and closed **'not planned.'**"

### 7.4 anthropics/claude-code **#36570** — "claude -p does not trigger skills — skill-creator eval loop always shows 0% recall" **[A]**
URL: https://github.com/anthropics/claude-code/issues/36570
Repo: `anthropics/claude-code` · **CLOSED as `not planned`** by `github-actions[bot]` (created 2026-03-20; closed 2026-06-08; locked; labeled bug / area:skills / stale)
- > "Skills are never triggered. Every should-trigger query returns rate=0/3. The skills work correctly in interactive Claude Code sessions."
- > "**claude -p should load and trigger skills based on the description, same as in an interactive session.**"

This is the strongest single item: a vendor repo bug record where a vendor-automation bot closed "skills never trigger in headless mode" as **not planned**.

### 7.5 openai/codex **#34321** — "the model sees none of its skills" **[A]**
URL: https://github.com/openai/codex/issues/34321
Repo: `openai/codex` (OpenAI-owned) · **OPEN** (created 2026-07-20; labeled `bug`, `CLI`, `skills`)
- > "`codex plugin list` reports a plugin as `installed, enabled` … when the plugin's payload … has lost its `skills/` subtree. In that state **the plugin contributes zero skills to `<skills_instructions>`**, so a model is told nothing about skills the operator believes are installed"
- > "**Installed, enabled, and invisible — simultaneously.**"
- > "the model correctly refused the task because the mandated skills were not in its prompt. **The failure is silent from the CLI's point of view: every command exits 0 and every status field says healthy.**"

### 7.6 openai/codex **#11314** — "Codex CLI doesn't load skills from .agents/skills when it is a symlink" **[A]**
URL: https://github.com/openai/codex/issues/11314
Repo: `openai/codex` · **CLOSED as `not planned`** (created 2026-02-10; closed 2026-02-14 by `etraut-openai`)
- > "When `.agents/skills` is a symlink, **no skills are discovered**. Replacing the symlink with a real directory makes the skills appear."

### 7.7 anthropics/claude-code **#2544** — "CLAUDE.md Mandatory Rules Consistently Ignored Across Multiple Repositories" **[A]**
URL: https://github.com/anthropics/claude-code/issues/2544
Repo: `anthropics/claude-code` · **OPEN** (created 2025-06-24; labeled `bug`, `has repro`, `memory`; 45 reactions; 20 comments)
- > "Claude Code is consistently ignoring mandatory rules defined in CLAUDE.md files across multiple repositories, breaking established development workflows and project-specific requirements."
- > "Claude Code acts as if CLAUDE.md files don't exist or are optional suggestions"
- > "This appears to be part of a broader instruction-following regression. CLAUDE.md parsing and adherence is a core Claude Code feature - when this fails, it undermines the entire workflow automation concept."

### 7.8 anthropics/claude-code **#33603** — "CLAUDE.md hard rules and persistent memory instructions consistently ignored…" **[A]**
URL: https://github.com/anthropics/claude-code/issues/33603
Repo: `anthropics/claude-code` · **OPEN** (created 2026-03-12; labeled `bug`, `memory`, `area:model`; 19 comments)
- > "Instructions written as explicit hard rules in CLAUDE.md and project memory (MEMORY.md) are loaded into context every session and are consistently not followed. … **The behavior is getting measurably worse with each iteration, not better.**"
- > "**Every rule in this system was added in direct response to a specific documented failure. Every rule has been violated again after being added.**"

### 7.9 anthropics/claude-code — MEMORY.md 25KB cap / silent truncation (open feature requests)
- #79217 "Make the auto-memory MEMORY.md index size limit (200 lines / 25KB) configurable" — **OPEN**, https://github.com/anthropics/claude-code/issues/79217
  > "Our main project accumulated ~500 memory files. … the index sits at ~17KB across only 41 lines — the line limit is irrelevant; the **byte** cap is the binding constraint." … "Repeated compaction produces ever-denser, less-readable index lines and the index just re-approaches the cap, so the error recurs 'constantly' in practice."
- #81710 "Priority-aware memory index…" — **OPEN**, https://github.com/anthropics/claude-code/issues/81710
  > "The always-loaded memory index has a hard cap (~24.4 KB / ~200 lines). Past it, content is dropped silently … And truncation preserves the top and drops the tail, so on a roughly chronological index **you lose your newest rules and findings first.**"

**Literal `use_count always 0` in a vendor repo: NOT FOUND.** The only `use_count` hits are community repos (e.g. a `phanngoc/goterm-control` PR) discussing `use=0` semantics — not vendor-owned.
**`memory never retrieved` in a vendor repo: NOT FOUND** as such; closest are #2544 / #33603 (memory loaded but not followed) above.

---

## 8. Memory causing sycophancy / stale-context / user complaints

- **OpenAI, memory as a sycophancy contributor — [A].** See §3.1. Verbatim: > "We have also seen that in some cases, user memory contributes to exacerbating the effects of sycophancy, although we don't have evidence that it broadly increases it." URL: https://openai.com/index/expanding-on-sycophancy/ (quotes reproduced verbatim at https://simonwillison.net/2025/May/2/what-we-missed-with-sycophancy/ due to 403).
- **Stale/conflicting memory — [B]/doc-level [A].** Claude Code memory docs: > "if two rules contradict each other, Claude may pick one arbitrarily"; and memory past the 25KB cap "is dropped on the next load." URLs: https://code.claude.com/docs/en/memory and issue https://github.com/anthropics/claude-code/issues/81710.
- **Memory retrieval into the wrong place — [B], third-party anecdote relayed by LangChain.** > "ChatGPT fetched his location from memories and unexpectedly injected it into a requested image. This type of unexpected or undesired memory retrieval can make some users feel like the context window '_no longer belongs to them_'!" URL: https://www.langchain.com/blog/context-engineering-for-agents
- **Anthropic's own sycophancy measurement (not memory-caused, but first-party honesty) — May 3, 2026.** > "only 9% of conversations included sycophantic behavior (Figure 2). But two domains were exceptions: we saw sycophantic behavior in 38% of conversations focused on spirituality, and 25% of conversations on relationships." URL: https://www.anthropic.com/research/claude-personal-guidance (relayed at https://feeds.simonwillison.net/tags/sycophancy/).
- **ChatGPT memory rollback specifically:**
  - "ChatGPT memory rollback where memory made the model worse" as a standalone event — **NOT FOUND.**
  - What does exist: OpenAI **rolled back the GPT‑4o update**, and separately named memory as one of the combined contributors to sycophancy. Do not conflate these.

---

## 9. Summary table of key admissions

| Vendor | Artifact | Date | Type | Headline number/claim |
|---|---|---|---|---|
| Anthropic | Effective context engineering | 2025-09-29 | B | "finite resource with diminishing marginal returns"; CLAUDE.md "naively dropped into context" |
| Anthropic | Writing effective tools | 2025-09-11 | B | "More tools don't always lead to better outcomes"; 25k-token tool cap |
| Anthropic | Code execution with MCP | 2025-11-04 | B | 150,000 → 2,000 tokens (98.7% saving) |
| Anthropic | Skills docs `/skill-doctor` | 2026 | A | skills "add to your context on every turn, whether or not Claude ever uses it"; flags "never been invoked" |
| Anthropic repo | skills#556 / #996, claude-plugins-official#3174, claude-code#36570 | 2026 | A | 0% skill trigger rate; #36570 closed "not planned" |
| Anthropic repo | claude-code#2544, #33603 | 2025–26 | A | CLAUDE.md/MEMORY.md rules "consistently ignored"; "measurably worse with each iteration" |
| OpenAI | Sycophancy postmortems | 2025-04/05 | A | memory + user feedback "may have played a part in tipping the scales on sycophancy"; "user memory contributes to exacerbating" |
| OpenAI repo | codex#34321, #11314 | 2026 | A | plugin "installed, enabled, and invisible"; zero skills in prompt |
| Cognition | Don't Build Multi-Agents | 2025-06-12 | A/B | multi-agent context fragmentation "very fragile" |
| Cognition | Rebuilding Devin for Sonnet 4.5 | 2025-09-29 | A | model's own notes caused "performance degradation"; "less effective than our existing memory systems" |
| Vercel | We removed 80% of our agent's tools | 2025-12-22 | A | 80% → 100% success; −37% tokens; −42% steps |
| Vercel | Build knowledge agents without embeddings | 2026-03-19 | A | replaced vector pipeline; ~$1.00 → ~$0.25/call, "output quality improved" |
| LangChain | Context engineering / filesystems | 2025-07/11 | B | named context failure modes; "semantic may be very poorly placed" for code |
| Cursor | Semantic search posts | 2025-11 / 2026-01 | counter | claims semantic search HELPS (+12.5%), contradicting the "removed embeddings" premise |

---

## 10. Explicit NOT FOUND list

1. Anthropic engineering post admitting tools/memory/context additions measurably HURT a shipped product — **NOT FOUND** (only "bloated tool sets" as a general failure mode and doc-level adherence caveats).
2. Anthropic post dedicated to skill failure modes / skill-conflict analytics — **NOT FOUND**.
3. OpenAI "A practical guide to building agents" quotes on memory — **NOT VERIFIED** (PDF unfetchable; mirrors 403).
4. OpenAI cookbook "Context Engineering for Personalization" stated limitations — **NOT VERIFIED** (403).
5. OpenAI first-party long-context vs RAG tradeoff post — **NOT FOUND**.
6. A standalone "OpenAI rolled back ChatGPT memory because it made the model worse" post — **NOT FOUND** (the rollback was of the GPT‑4o update; memory was a named contributor to sycophancy).
7. Cursor admitting it removed embeddings / that semantic search did not help — **NOT FOUND and contradicted** by Cursor's own Nov 6, 2025 and Jan 27, 2026 posts.
8. Original Windsurf-hosted source for "embedding search becomes unreliable as the size of the codebase grows" — **NOT FOUND** (only the LangChain reproduction).
9. Sourcegraph engineering post admitting code search/indexing did not help or was removed — **NOT FOUND**.
10. GitHub Copilot engineering post admitting retrieval/indexing did not help or was removed — **NOT FOUND**.
11. LangChain/LangSmith post reporting a memory or retrieval eval with no gain, or admitting a memory/retrieval regression — **NOT FOUND**.
12. Vendor-owned repo issue literally titled/containing "skill never invoked" / "use_count always 0" — **NOT FOUND** for `use_count`; the closest vendor evidence is the 0%-trigger issues in §7.
13. Vercel post literally titled "We removed RAG" — **NOT FOUND**; actual title is "Build knowledge agents without embeddings."
