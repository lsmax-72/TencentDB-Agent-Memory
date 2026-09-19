# Addendum to the Skill-Extraction Literature Review

**Companion to:** `reports/skill-extraction-literature-review.md`
**Date:** 2026-09-18
**Purpose:** (A) correct three claims in the main report that source-code-level inspection disproved, and (B) add new evidence on trajectory representation, token budgets, and production systems.

The main report's conclusions are unaffected; its §5 (trajectory representation) was the weakest section and is **superseded** by Part B below.

---

## Part A — Corrections to the main report

### A1. ExpeL serializes the raw ReAct **string**, not `(o, a, o', r)` tuples — CORRECTED

The main report §5.1 said ExpeL serializes "`(o_t, a_t, o_{t+1}, r_{t+1})` tuples appended to trajectory τ." **That is the algorithm's abstract bookkeeping, not what reaches the extraction model.** Verified in the released code:

- The `Trajectory` object stores **one opaque string** (`self._trajectory`). Observations/actions/thoughts are *derived* by splitting it, and only for embedding metadata.
- The extraction call receives that raw string: `success_history = traj.trajectory.strip()` and `fail_history.trajectory.strip()`, then `log += success_history + '\n' + fail_history.trajectory.strip() + ...`
- Serialized form is the agent's interleaved `Thought:` / `Action:` / `Observation:` text. **Thoughts are kept**; the shipped default is `truncate_strategy: null`. There is no reward scalar in the prompt — the pair is selected by *outcome* (success vs. fail for the same task), not by reward.

Source: [`agent/expel.py` L133–139, L343–352](https://github.com/LeapLabTHU/ExpeL/blob/main/agent/expel.py) · [`configs/agent/expel.yaml`](https://github.com/LeapLabTHU/ExpeL/blob/main/configs/agent/expel.yaml) · [paper](https://arxiv.org/abs/2308.10144).

### A2. ExpeL has concrete token budgets the main report omitted — ADDED

| Limit | Value | Where |
|---|---|---|
| Insight block hard cap | `max_num_rules: 20` | `expel.yaml` |
| Insight block soft cap | 25 (20+5), then the prompt switches to *"Focus on REMOVE rules first, and stop ADD rule unless the new rule is VERY insightful"* | `prompts/templates/human.py` |
| Successes per all-success extraction call | `success_critique_num: 8` (`random_divide_list`) | `expel.py` L159 |
| **Failure-side truncation** | `if self.token_counter(failed_trials) > 13000:` → prints `TRUNCATING FAILED TRIALS`, **drops exactly one failed trajectory** by `critique_truncate_strategy` = `random` (default) / `longest` / `shortest` | `expel.py` L173–192 |
| Acting-time context truncation | `token_counter(log_history) > 15800` | `agent/base.py` |
| HotpotQA budget | `max_steps: 7`, `num_fewshots: 6`, retrieval `k = 6 × buffer_retrieve_ratio 4 = 24` candidates | `configs/benchmark/hotpotqa.yaml` |

**Design observation worth stealing:** ExpeL's *only* hard trajectory truncation is on the **failure** side (>13,000 tok → drop one failure). The successful side has **no per-trajectory token cap**. Failure trajectories are longer and noisier; ExpeL bounds them and leaves successes alone.

### A3. Voyager does **not** truncate execution errors — the main report was right to flag this as NOT FOUND, now confirmed negative

Main report §"What I could NOT find" listed Voyager error truncation as unverified. Traced end-to-end in source: `onError.js` stores and returns the raw error (`this.obs = err; … return result`) with **no `split`/`slice`/line cap**, and `render_human_message` builds `error = "\n".join(error_messages)` → `Execution error:\n{error}` verbatim. **No "first N lines" truncation exists.**

What *is* filtered: chat logs. `summarize_chatlog()` keeps only craft/mine-failure regexes and collapses them to `"I also need <item>, <item>."`

Also confirmed from source: skill artifact = `{"code": program_code, "description": skill_description}` written to `skill/code/{n}.js` + `skill/description/{n}.txt`; `skill.txt` instructs *"summarize the function in **no more than 6 sentences**… a **single line of text**"*; retrieval embeds the *description* but returns the **code**, `retrieval_top_k = 5`; `action_agent_task_max_retries = 4`; and **the critic receives a state snapshot, not the trajectory** (`{reasoning, success, critique}` JSON).

Sources: [`onError.js`](https://github.com/MineDojo/Voyager/blob/main/voyager/env/mineflayer/lib/observation/onError.js) · [`action.py`](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/action.py) · [`skill.py`](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py) · [`skill.txt`](https://github.com/MineDojo/Voyager/blob/main/voyager/prompts/skill.txt).

### A4. Reflexion's memory limit is a **count** window, not a token budget — CLARIFIED

Main report §5.2 correctly reported Ω = 1–3 from the paper. Source adds: `if len(env['memory']) > 3: memory = env['memory'][-3:]` is hard-coded, memory is a **list of free-text reflection strings, not tuples**, and there is **no token-denominated cap** and **no published 1/3/5-reflection ablation**. Also: the reflector is fed the **raw rollout**, with the prompt explicitly instructing *"**Do not summarize your environment**, but rather think about the strategy and path you took."*

Source: [`generate_reflections.py`](https://github.com/noahshinn/reflexion/blob/main/alfworld_runs/generate_reflections.py) · [paper](https://arxiv.org/abs/2303.11366).

---

## Part B — New evidence: what is actually serialized, and at what budget

### B1. The single best observation-representation ablation in the corpus (AWM Table 8)

**[Directly verified from the paper source by me, not relayed.]** Mind2Web cross-task, GPT-3.5-turbo, [AWM §4.3 Table 8](https://ar5iv.labs.arxiv.org/html/2409.07429):

| NL state description | Filtered HTML | Elem Acc | Action F1 | Step SR | Task SR |
|---|---|---|---|---|---|
| ✓ | ✗ | **39.0** | 52.8 | **34.6** | **2.8** |
| ✗ | ✓ | 38.1 | **54.0** | 33.8 | 2.8 |
| ✓ | ✓ | 37.1 | 51.3 | 32.9 | **2.0** |

Verbatim: *"NL description of states is more useful than HTML… Interestingly, using both NL and filtered HTML leads to **worse** results… the filtered HTML has a substantial number of irrelevant items (**missing all correct elements 47% of the time**) thus potentially contradicting NL descriptions and impairing agent abilities."*

**This is the actionable finding for your extraction prompt:** summarize the observation to natural language, and **do not also append the raw/filtered DOM.** Adding the structured observation on top of the NL summary cost **−0.8 task SR / −0.9 step SR** and eroded element accuracy by 1.9 points. The mechanism is corroborated by [State Design Matters](https://arxiv.org/html/2602.15858) (summaries fail when they drop decision-relevant detail) and by [Stateless Decision Memory](https://arxiv.org/html/2604.20158v1).

Related AWM ablations: abstract-LM workflows **4.8** task SR vs rule-induced full examples **2.0**; code-format vs text-format workflows show "no substantial performance variance" (4.8 vs 3.6).

**Also key for the extraction pipeline:** AWM's *published* workflow step is a triple (NL state, **reasoning**, executable action), but the *induction input* differs by benchmark. On WebArena, `format_trajectory()` emits only `<think>{t}</think><action>{acts}</action>` — **the observation/accessibility tree is never serialized into the extraction prompt at all.** Before induction, `remove_invalid_steps()` deletes `scroll(...)`/`noop(...)` and unparseable clicks/fills.

Sources: [`webarena/induce_prompt.py`](https://github.com/zorazrw/agent-workflow-memory/blob/main/webarena/induce_prompt.py) · [`mind2web/utils/data.py`](https://github.com/zorazrw/agent-workflow-memory/blob/main/mind2web/utils/data.py).

### B2. The Complexity Trap — the best measured raw-vs-summarized numbers (acting context)

[The Complexity Trap (arXiv 2508.21433, NeurIPS'25 DL4C)](https://arxiv.org/abs/2508.21433), SWE-agent on SWE-bench Verified, solve rate % / cost $ per instance:

| Model | Strategy | Solve Rate | Cost |
|---|---|---|---|
| Qwen3-32B | Raw agent | 17.0 | 1.12 |
| | Observation masking | 15.0 (−11.8%) | **0.55 (−50.9%)** |
| | LLM summary | 16.0 (−5.9%) | 0.50 (−55.4%) |
| Qwen3-32B (thinking) | Raw | 23.0 | 0.51 |
| | Observation masking | **24.6 (+7.0%)** | 0.46 |
| | LLM summary | **24.8 (+7.3%)** | 0.51 |
| Qwen3-Coder 480B | Raw | 53.4 | 1.29 |
| | Observation masking | **54.8 (+2.6%)** | **0.61 (−52.7%)** |

Headline: masking is **52% cheaper and improves solve rate 2.6%** on the strongest model, and beats LLM-summary by $0.03/instance ($15 across 500). Hybrid masking+summary cuts a further **7% vs masking, 11% vs summary**. The paper also reports a **"Trajectory Elongation Effect"** — summarization makes trajectories *longer*.

**Two critical caveats:** (1) this measures *acting* context, **not skill-extraction quality**; (2) the optimal window is **agent-specific** — reusing SWE-agent's optimum on OpenHands "degrades drastically." Do not port a compression hyperparameter across harnesses.

Also: [AgentDiet (arXiv 2509.23586, FSE 2026)](https://arxiv.org/abs/2509.23586) removes "useless, redundant, and expired" content at inference for **39.9–59.7% input-token reduction** and **21.1–35.9% total cost reduction** "while maintaining the same agent performance."

### B3. SWE-agent — budget by **structure**, not summarization (the design to copy)

[SWE-agent (arXiv 2405.15793)](https://arxiv.org/abs/2405.15793):
- file viewer window = **at most 100 lines**; `scroll_down`/`scroll_up` move exactly 100;
- search returns **at most 50 results**; if exceeded **nothing is shown** and the agent is told to narrow the query;
- **"observations preceding the last 5 are each collapsed into a single line"** (placeholder `Old output omitted (101 lines)`);
- **"all past error messages except the first are omitted"**;
- the system prompt is never collapsed.

Its own Table 3 ablation of those budgets (Lite, GPT-4 Turbo, %): file viewer **30 lines 14.3**, **100 lines 18.0**, **full file 12.7**; search **summarized 18.0** vs **verbose 12.0**; context **last-5-obs 18.0** vs **full history 15.0**; edit w/ linting 18.0 vs 15.0.

**Reading more of the same file is strictly worse than the 100-line window.** This is the strongest single argument in the corpus for hard structural budgets over free-form summarization.

### B4. Production token budgets (vendor docs)

**Claude Code** ([memory](https://code.claude.com/docs/en/memory), [context window](https://code.claude.com/docs/en/context-window)) — the best-quantified set published:
- auto memory `MEMORY.md`: **first 200 lines or 25 KB, whichever comes first**, loaded every session; content past the limit is not loaded; **one line per memory**, indexing separate topic files; memories are typed `user | feedback | project | reference`;
- `CLAUDE.md`: target **<200 lines**; **files >4 MiB skipped entirely**;
- after `/compact`: re-reads **up to 5** most-recently-modified files; a file **>5,000 tokens** is returned as a path reference only;
- invoked skill bodies: **≤5,000 tok/skill and ≤25,000 tok total, oldest dropped first**;
- hook/tool output **>10,000 characters** is offloaded to a file, leaving "a preview and the file path";
- MCP tool schemas deferred by default; loaded only if within **10% of the context window**.

What compaction keeps vs. drops, verbatim: it "keeps: your requests and intent, key technical concepts, files examined or modified with important code snippets, **errors and how they were fixed**, pending tasks… It replaces the verbatim conversation: **full tool outputs and intermediate reasoning are gone.**"

Auto memory drops even more by design: *"Claude **skips anything it can derive from the codebase**, such as architecture, file paths, or debugging fixes."*

**AWS AgentCore Memory** separates the two layers explicitly: short-term = "**raw interactions**… the entire conversation history as a series of events"; long-term = "**structured information extracted from raw agent interactions**… preserves only the key insights," via async Extraction → Consolidation with semantic retrieval. Its episodic schema stores "scenarios, intents, thoughts, actions taken, outcomes, and artifacts," decomposed into "situation, intent, assessment, justification, and episode-level reflection," analysed **turn-by-turn**, indexed on **intent** (episodes) and **use case** (reflections). Pro-raw instruction: *"when creating short-term memories with `CreateEvent`, **including `TOOL` results will yield optimal results**";* for reuse, **"linearize the turns"** and feed only that.
Sources: [memory types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html) · [episodic strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/episodic-memory-strategy.html).

**OpenHands** ships `LLMSummarizingCondenser` as default (threshold-triggered, keeps recent messages intact, "preserves key information (user goals, technical specifications, critical files)"), with `PipelineCondenser` for composition. [Docs](https://docs.openhands.dev/sdk/arch/condenser).

**Cursor — negative finding:** `cursor.com/docs/context/memories` **redirects to the Rules page**, which documents only author-written `.cursor/rules/*.mdc` and `AGENTS.md`, and states "Large language models don't retain memory between completions." **No official Cursor doc on automatic trajectory→memory extraction exists.** [Docs](https://cursor.com/docs/rules).

### B5. Web-agent observation reduction (2025–2026)

- **FocusAgent ([arXiv 2510.03204](https://arxiv.org/abs/2510.03204), TMLR 08/2026):** a lightweight LLM retriever extracts the most relevant **accessibility-tree lines** guided by the goal — matches strong baselines while **cutting observation size >50%**, and a variant significantly reduces prompt-injection success.
- **Revisiting Observation Reduction ([arXiv 2605.29397](https://arxiv.org/abs/2605.29397), 2026):** defines the **Minimal Failure Set** (the minimal HTML elements whose removal causes task failure) and *coverage* as the fraction of instances fully retaining it. MFS-optimized pruning gives **2.2× faster per-step latency on WorkArena L1 retaining 84% success** and **3.1× faster on WebLinx retaining 89%**. (Their end-to-end sweep of 11 methods × 32 configs × 33 tasks took 232.4 cumulative hours.)

### B6. 2025–2026 systems that explicitly restructure before extraction

- **Skill-Evo4GUI / "From Interaction Traces to Persistent Skills" ([arXiv 2609.04869](https://arxiv.org/abs/2609.04869))** — the most explicit serialization contract found. The Extractor must produce `{step, observed_state, action_taken, post_action_effect, notes}` with the preservation rule *"`step_level_record`: include EVERY step without selective omission,"* and is forbidden to judge: *"State facts only; do not make judgments… Do not evaluate or reference any skill library."* The pipeline is `Extractor.md → Proposer.md → skill_builder.md`, so **the trajectory is never shown to the skill author**. Screenshots dropped by default. Result: **+5.7 to +18.6 pp** across four OSWorld domains vs a configuration-matched empty-library control — but it documents **"revision churn," where repeated accepted edits fail to recover the originating task** (iterative compression is not monotonic). [Extractor.md](https://github.com/LongtaoHu/Skill-Evo4GUI/blob/main/Extractor.md)
- **SkillRL ([arXiv 2602.08234](https://arxiv.org/abs/2602.08234), ICLR 2026)** states the motivation verbatim: *"Existing memory-based methods primarily store **raw trajectories, which are often redundant and noise-heavy**. This prevents agents from extracting high-level, reusable behavioral patterns…"* Hierarchical `SkillBank`, **>15.3%** over strong baselines.
- **Trace2Skill ([arXiv 2603.25158](https://arxiv.org/abs/2603.25158))** consolidates trajectories **in parallel** into one skill directory; "outperforms sequential skill editing and **ReasoningBank-style retrieval memories**"; Qwen3.5-35B trajectories → Qwen3.5-122B agent **+57.65 pp** on WikiTableQuestions.
- **Trace2Tower ([arXiv 2609.05261](https://arxiv.org/abs/2609.05261))** abstracts steps to **canonical events** before building a graph. 87.31% ALFWorld, 50.67% WebShop exact.
- **Experience Compression Spectrum ([arXiv 2604.15877](https://arxiv.org/abs/2604.15877))** formalizes Levels 0→3: raw trace 1:1 → episodic 5–20× → procedural skill 50–500× → declarative rule 1,000×+. ExpeL and AutoGuide are the only cross-level systems; "none supports adaptive cross-level compression… the **missing diagonal**." Its key negative row: **self-generated L2 +0.0 pp** vs curated L2 +16.2 pp — *"compression level alone is insufficient; **the fidelity of the compression process** determines whether the artifact is useful or merely compact noise."*
- **SkillTTA / "Skills on the Fly" ([arXiv 2605.16986](https://arxiv.org/abs/2605.16986))** synthesizes a **temporary** skill at read time conditioned on the visible target context, rather than compressing a stored trace once.
- **Agentless ([arXiv 2407.01489](https://arxiv.org/abs/2407.01489))** — the boundary case: **no trajectory memory at all.** Fixed localization → repair → patch validation, **32.00% (96 fixes) on SWE-bench Lite at $0.70**. Useful as a "does memory even help here?" control.

---

## Part C — Consolidated corrections to the main report's gaps section

The main report's gap #7 ("no published token budget for the extraction prompt") is now **partially filled** (ExpeL A2, MetaClaw, Reflexion, Voyager, Claude Code, AgentCore above), and two of its gaps are **confirmed as genuine holes in the literature** rather than just unfound by me:

1. **No controlled experiment varies only trajectory compression level while holding source experience constant** — stated explicitly by the 2026 survey: *"A controlled experiment holding source experience constant while varying only compression level has not been conducted"* ([arXiv 2604.15877](https://arxiv.org/abs/2604.15877) §3.3). **This is the experiment your team could run and publish.** Your product has the one thing the literature lacks: many trajectories from one task distribution, so you can hold source experience fixed and vary only the serialization.
2. **No ablation isolates "summarize the trajectory, then extract" vs. "feed the raw trajectory to the extractor" inside one skill-extraction system.** Nearest substitutes are The Complexity Trap / AgentDiet (acting context) and AWM Table 8 (observation representation *inside* the artifact).

Still NOT FOUND: ExpeL's literal prompt template (Figs. 2–3, 8–13 are images); what ExpeL's `max_fewshot_tokens: auto` resolves to numerically; AutoGuide's prompt text (Appendix C.1–C.4 are figures, no public repo); AgentCore's actual extraction/projection prompt text; Cursor's memory serialization.

**Do not cite as empirical:** Claude Code's "summary ≈ 12% of tokens" figure comes from a documentation *simulation's source code*, not a published measurement.

---

### Sources added in this addendum

[ExpeL code](https://github.com/LeapLabTHU/ExpeL/blob/main/agent/expel.py) · [ExpeL config](https://github.com/LeapLabTHU/ExpeL/blob/main/configs/agent/expel.yaml) · [Reflexion reflection code](https://github.com/noahshinn/reflexion/blob/main/alfworld_runs/generate_reflections.py) · [Voyager skill agent](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py) · [Voyager error observation](https://github.com/MineDojo/Voyager/blob/main/voyager/env/mineflayer/lib/observation/onError.js) · [AWM WebArena induction prompt](https://github.com/zorazrw/agent-workflow-memory/blob/main/webarena/induce_prompt.py) · [AWM Mind2Web data utils](https://github.com/zorazrw/agent-workflow-memory/blob/main/mind2web/utils/data.py) · [The Complexity Trap](https://arxiv.org/abs/2508.21433) · [AgentDiet](https://arxiv.org/abs/2509.23586) · [SWE-agent](https://arxiv.org/abs/2405.15793) · [Claude Code memory](https://code.claude.com/docs/en/memory) · [Claude Code context window](https://code.claude.com/docs/en/context-window) · [OpenHands condenser](https://docs.openhands.dev/sdk/arch/condenser) · [AgentCore memory types](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html) · [AgentCore episodic strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/episodic-memory-strategy.html) · [Cursor rules](https://cursor.com/docs/rules) · [FocusAgent](https://arxiv.org/abs/2510.03204) · [Revisiting Observation Reduction](https://arxiv.org/abs/2605.29397) · [Skill-Evo4GUI](https://arxiv.org/abs/2609.04869) · [SkillRL](https://arxiv.org/abs/2602.08234) · [Trace2Skill](https://arxiv.org/abs/2603.25158) · [Trace2Tower](https://arxiv.org/abs/2609.05261) · [Experience Compression Spectrum](https://arxiv.org/abs/2604.15877) · [SkillTTA](https://arxiv.org/abs/2605.16986) · [Agentless](https://arxiv.org/abs/2407.01489)
