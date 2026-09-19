# Extracting Reusable Skills and Experience from Agent Trajectories: An Evidence-Backed Literature Review (2023–2026)

**Prepared for:** agent-memory product team
**Date:** 2026-09-18
**Scope:** 2023–2026 academic literature + vendor/press reporting. Every substantive claim carries a source link. A closing **"What I could NOT find"** section flags gaps rather than guessing.

> **How to read the numbers.** Across this literature, backbones, harnesses, context budgets, evaluators and task streams all change together, so cross-paper numbers are **not** comparable effect sizes. The dynamic-skills survey makes this explicit and grades evidence accordingly ([Dynamic Agent Skills, §2.5](https://arxiv.org/html/2607.10113)). Treat within-paper ablations as strong, cross-paper deltas as directional.

---

## Executive summary — the five things that should change your design

1. **Failure-derived insight is not free and not always positive.** The single most-cited positive result is ExpeL's, and its own ablation shows that *adding reflection text to insight extraction dropped HotpotQA success from 39.0% to 29.0%*. The most direct success-vs-failure A/B test found is ReasoningBank's: success-only 46.5 → +failures 49.7, while AWM **dropped** 44.4 → 42.2 when failures were added ([ReasoningBank Fig. 7](https://ar5iv.labs.arxiv.org/html/2509.25140)).
2. **Self-generated skills are net-negative on average in the largest neutral benchmark.** SkillsBench (84 tasks, 7,308 trajectories): human-curated Skills **+16.2pp**, self-generated Skills **−1.3pp** ([SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1)). But CoEvoSkills reports **+40.5pp** from self-evolved skills *because it co-evolves a verifier* — the gate, not the generation, is the product ([CoEvoSkills](https://arxiv.org/html/2604.01687)).
3. **Unbounded libraries are non-monotone: performance rises then falls.** Ungated accumulation on Terminal-Bench 2 peaked at 62% (105 skills) then decayed to 50% (179 skills) — only +2pp above its own round 1. Deleting the 8 culprit skills afterwards recovered just 2pp of the 12pp drop ([When Self-Evolution Backfires](https://ar5iv.labs.arxiv.org/html/2608.05810)).
4. **Flat retrieval collapses at ~100 skills.** Controlled sweep: 96–98% at 16–32 skills, 92% at 64, 78% at 128, **64% at 256** ([Dynamic Agent Skills §9.3](https://arxiv.org/html/2607.10113), citing Single-Agent-Skills).
5. **Trajectory representation is a measured, not aesthetic, choice.** Replacing full history with a ≤25-token rolling summary moved Tower-of-Hanoi scores from 0.08→0.39 and 0.46→0.70, but **regressed** Messenger for other models (0.09→0.00) ([State Design Matters](https://arxiv.org/html/2602.15858)).

---

## 1. The main approaches: what is extracted, where it is stored, how it is retrieved

### 1.1 Comparison table

| System (year) | Artifact extracted | Storage | Retrieval |
|---|---|---|---|
| **Reflexion** (2023) | Natural-language **self-reflection** on a failed trial (verbal RL) | `mem` list, episodic, **bounded to Ω = 1–3** experiences (AlfWorld: last 3) | All of `mem` concatenated into the next trial's prompt; no retrieval |
| **ExpeL** (2023/24) | Natural-language **insights** (cross-task rules) via ADD/EDIT/UPVOTE/DOWNVOTE ops; plus raw successful trajectories | Insight set `ι̂` (plain text, importance counters) + Faiss vectorstore of successful trajectories | **All** insights concatenated; top-k successful trajectories by **task similarity** (all-mpnet-base-v2) |
| **Voyager** (2023) | **Executable JavaScript code** per skill, with a GPT-3.5-generated description | Vector DB; **key = description embedding**, value = program | Query = embedding of self-generated plan + environment feedback; **top-5** skills |
| **AutoGuide** (NeurIPS 2024) | **Context-aware guidelines**: `When <context>, you should <action>` | Dictionary `G[context] → {guidelines}` | Context identification module keys the dictionary; LLM picks **top-k** inside the matched context |
| **Agent Workflow Memory** (2024/ICML'25) | **Workflows**: NL description + step list of (*NL state description*, *reasoning*, *executable action*), with instance values abstracted to `{product-name}` | Workflow memory appended to the agent's system prompt / memory `M` | All induced workflows injected (offline) or accumulated streaming (online); no semantic retriever in the base method |
| **MetaClaw / "Just Talk"** (arXiv 2603.17187, 2026) | **SKILL.md-style natural-language behavioral instructions** synthesized by an LLM *skill evolver* | Evolving skill library `S`, indexed by **skill generation** `g`; versioned | **top-k cosine similarity** over sentence embeddings; injected into system prompt |
| **ReasoningBank** (arXiv 2509.25140, 2025) | Structured memory items: **title + description + content** (reasoning strategies) | Flat memory bank; consolidation = **simple addition** | Embedding similarity **top-k**, injected into system instruction |
| **Mem^p** (arXiv 2508.06433, 2025) | Two granularities: verbatim **trajectories** *and* abstracted **scripts**, plus a combined "proceduralization" | Editable repository with Add / Validation-filter / Reflection / dynamic-discard updates | Vector retrieval keyed by query (`Key=Query`) or extracted keywords (`Key=AveFact`) |
| **Dynamic Agent Skills survey** (arXiv 2607.10113) | Meta-taxonomy: skill = executable code, NL heuristic, SKILL.md package, parametric adapter, memory trace, or capability label | "Lifecycle-managed, verified, evolving artifact stores" | Eight-stage lifecycle incl. retrieval/composition; ten-operator vocabulary {Add, Refine, Merge, Split, Prune, Distill, Abstract, Compose, Rewrite, Rerank} |

Sources: [Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366) · [ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144v2) · [Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291) · [AutoGuide](https://arxiv.org/html/2403.08978v2) · [AWM](https://ar5iv.labs.arxiv.org/html/2409.07429) · [MetaClaw](https://ar5iv.labs.arxiv.org/html/2603.17187) · [ReasoningBank](https://ar5iv.labs.arxiv.org/html/2509.25140) · [Mem^p](https://ar5iv.labs.arxiv.org/html/2508.06433v4) · [Dynamic Agent Skills](https://arxiv.org/html/2607.10113).

### 1.2 Notes that matter for implementation

- **ExpeL's artifact schema is stateful, not append-only.** Insights carry an *importance count* initialised to 2; UPVOTE/EDIT increments it, DOWNVOTE decrements it, and **an insight is deleted when its count reaches zero**. ExpeL's stated rationale: "even successful trajectories can be suboptimal and mislead the generated insights" ([ExpeL §4.2](https://ar5iv.labs.arxiv.org/html/2308.10144v2)). This is a vote-based confidence mechanism you can copy directly.
- **ExpeL also keeps raw successful trajectories as few-shot exemplars**, retrieved by *task* similarity, not reasoning similarity. Its ablation measured retrieval strategies: task similarity **59.0%** > reasoning similarity 48.5% > random sampling 42.5% on ALFWorld ([ExpeL Table 3](https://ar5iv.labs.arxiv.org/html/2308.10144v2)).
- **Voyager stores code, not prose.** Storage key is the *description* embedding; retrieval top-5. Complex skills are built by composing simpler programs already in the library — this compositionality is what the ablation credits for avoiding plateaus ([Voyager §2.2, §3.4](https://ar5iv.labs.arxiv.org/html/2305.16291)).
- **AWM's step triple is the most copied trajectory representation.** It deliberately keeps the agent's *reasoning*, not just state+action. AWM explicitly abstracts instance-specific values out of workflows so sub-routines transfer; it beats retrieval of concrete full trajectories (Synapse) by +5.0 element accuracy / +4.0 step SR on Mind2Web, which the authors attribute to the abstract, reusable form ([AWM §3.2.1](https://ar5iv.labs.arxiv.org/html/2409.07429)).
- **MetaClaw's artifact is versioned by skill generation**, and support data (failure trajectories that triggered evolution) is *flushed* from the RL buffer when the library changes, to prevent stale-reward contamination ([MetaClaw §3.4](https://ar5iv.labs.arxiv.org/html/2603.17187)).
- **The 2026 survey's key structural point:** "skill" names at least **six structurally different artifacts**, and update operators are named inconsistently across papers. Before benchmarking your layer against any paper, pin down *which sense* of skill it uses ([Dynamic Agent Skills Table 1](https://arxiv.org/html/2607.10113)).

### 1.3 Headline results of each system (for calibration)

| System | Benchmark | Result |
|---|---|---|
| ExpeL | HotpotQA / ALFWorld / WebShop | 39.0% HF/WebShop etc. vs ReAct 28.0% (HotpotQA); ALFWorld 59.0% vs ReAct 40.0% |
| AutoGuide | ALFWorld / WebShop / WebArena-Reddit | **79.1% / 46% / 47.1%** SR vs ExpeL 59.0% / 35% / 21.8% and ReAct 54.5% / 30% / 8.0% |
| AWM | WebArena / Mind2Web | 35.5% total SR (+51.1% relative over BrowserGym); beats human-workflow SteP 33.0%; ~2.0 fewer steps |
| Voyager | Minecraft | 3.3× unique items, 2.3× distance, tech tree up to 15.3× faster; only method to unlock diamond |
| MetaClaw (Skills) | MetaClaw-Bench Part I/II | GPT-5.2 41.1→44.0 (+7.1% rel), Kimi-K2.5 21.4→28.3 (+32.2% rel) |
| ReasoningBank | WebArena (684 tasks) | 48.8% (Gemini-2.5-flash) vs AWM 44.1%, Synapse 42.1%, No Memory 40.5% |

Sources: [ExpeL Fig. 5/§5.6](https://ar5iv.labs.arxiv.org/html/2308.10144v2) · [AutoGuide Table 1](https://arxiv.org/html/2403.08978v2) · [AWM Tables 1–3](https://ar5iv.labs.arxiv.org/html/2409.07429) · [Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291) · [MetaClaw Table 1](https://ar5iv.labs.arxiv.org/html/2603.17187) · [ReasoningBank Table 1](https://ar5iv.labs.arxiv.org/html/2509.25140).

---

## 2. SUCCESS vs FAILURE trajectories — the most important question

### 2.1 Who uses what

| System | Successes | Failures | Different prompt/schema per outcome? |
|---|---|---|---|
| Reflexion | not reflected on | **failures only** | Yes — reflection is only generated when the Evaluator fails the trial |
| ExpeL | yes (lists of *L* successes) | yes (fail/success **pairs** on the same task) | **Same template**, two input branches (colored A/B in Fig. 2) |
| AWM | **successes only** (evaluator-judged correct) | discarded | n/a |
| AutoGuide | highest-return trajectory τ⁺ of a pair | lowest-return τ⁻ of the same task | Single contrastive prompt over the pair, at the **deviation timestep** |
| Voyager | verified successes | failure feedback used for *repair within episode*, not stored | Code-refinement prompt carries env feedback + error trace; skill only committed on self-verification pass |
| MetaClaw | **not used for skill synthesis** | **failures only** — "analyzes failure trajectories and synthesizes new skills" | n/a |
| ReasoningBank | validated strategies | counterfactual signals / pitfalls | **Yes — "we apply different extraction strategies"** per LLM-judge outcome |
| Mem^p | "Validation" update keeps *only successful* trajectories | Reflection update folds failed trajectory into memory and revises in place | Update-strategy differences, not prompt-schema differences |
| Libraries Drift / Ratchet | — | ≥3 failures sharing a canonical pattern before a skill is born | Failure-cluster trigger |

Sources: [Reflexion §3](https://ar5iv.labs.arxiv.org/html/2303.11366) · [ExpeL §4.2](https://ar5iv.labs.arxiv.org/html/2308.10144v2) · [AWM §2.3](https://ar5iv.labs.arxiv.org/html/2409.07429) · [AutoGuide §3.2](https://arxiv.org/html/2403.08978v2) · [Voyager §2.3](https://ar5iv.labs.arxiv.org/html/2305.16291) · [MetaClaw §3.2](https://ar5iv.labs.arxiv.org/html/2603.17187) · [ReasoningBank §3.2](https://ar5iv.labs.arxiv.org/html/2509.25140) · [Mem^p](https://ar5iv.labs.arxiv.org/html/2508.06433v4) · [Library Drift §4.2](https://arxiv.org/html/2605.19576).

### 2.2 The direct A/B evidence (concrete numbers)

**ReasoningBank Fig. 7** is the cleanest success-only vs both test I could find. WebArena-**Shopping**, Gemini-2.5-flash ([source](https://ar5iv.labs.arxiv.org/html/2509.25140)):

| Memory design | Success-only | With failures added | Δ |
|---|---|---|---|
| Synapse (raw trajectory memory) | 40.6 | 41.7 | **+1.1** |
| AWM (success-only workflow memory) | 44.4 | 42.2 | **−2.2** |
| ReasoningBank (outcome-aware extraction) | 46.5 | **49.7** | **+3.2** |

The authors' reading: "unlike baselines, ReasoningBank can transform failures into constructive signals rather than noise." The AWM result is the important negative: *naively appending failure-derived items to a success-only pipeline is worse than not using failures at all.*

**ExpeL's ablation is widely mis-cited.** ExpeL does **not** ablate success-only vs failure-only vs both. What it ablates is the source and quality of the extraction context ([ExpeL §5.6, Table 3](https://ar5iv.labs.arxiv.org/html/2308.10144v2)):

| Variant | HotpotQA (SR %) |
|---|---|
| ReAct baseline | 28.0 ± 1.4 |
| Hand-crafted (human) insights | 32.0 ± 1.1 |
| **Insights with reflections added** | **29.0 ± 0.4** |
| Insights from gpt-3.5-turbo instead of GPT-4 | 32.0 ± 0.4 |
| **ExpeL (ours)** | **39.0 ± 1.7** |

Two findings dominate:
- **Adding Reflexion-style reflection text into insight extraction *hurt* (−10.0pp vs the full pipeline).** ExpeL's stated cause: "reflections sometimes outputting hallucinations, therefore misleading the insight extraction stage." This is direct evidence that a *failure-derivative* (reflection) can poison a *failure-pair-based* extractor.
- **LLM-extracted insights beat hand-crafted human insights** (39.0 vs 32.0). Human priors were not better.

ExpeL's other experience-quality ablation ([§5.6, Fig. 6](https://ar5iv.labs.arxiv.org/html/2308.10144v2)): an agent extracting insights **only from the initial few-shot examples** showed "no advantage compared to the ReAct agent"; the agent using **only ReAct during collection** (no retries ⇒ fewer successes, **no success/failure pairs**) performed worse than the Reflexion-based collector with pairs. So *contrastive pairs specifically* carried the signal — consistent with AutoGuide's design.

### 2.3 Failure-driven extraction is a distinct, sometimes dominant, strategy

- **MetaClaw builds its entire skill library from failures.** "Skill-driven fast adaptation analyzes failure trajectories and synthesizes new skills." No success trajectories feed the evolver ([MetaClaw §3.2, Alg. 1 lines 7–15](https://ar5iv.labs.arxiv.org/html/2603.17187)). It reports up to **+32.2% relative** accuracy on the weaker backbone. Skills clustered on three recurring *failure* categories: time-format compliance, backup-before-modify, naming conventions — i.e. failure-derived, cross-cutting behavioral heuristics.
- **Failure-based relabeling can dominate success-based training.** AgentHER converts *failed* trajectories into valid training data by rewriting the goal (hindsight relabeling), reporting **+7.1 to +11.7pp over success-only SFT** across four model families, at **2× data efficiency**, with 97.7% relabeling precision under multi-judge verification and label noise reduced from 5.9% → 2.3% ([AgentHER](https://ar5iv.labs.arxiv.org/html/2603.21357)). Note this is offline fine-tuning, not prompt memory — but it is the strongest evidence in the corpus that discarded failures are the majority of collected signal (agents use only ~25–30% of trajectories; relabeling yields ≈3.7× more data).
- **AutoGuide deliberately contrasts a high-return and low-return trajectory of the same task** and extracts the guideline **only at the timestep where they diverge** — a surgical use of failure that avoids dumping the whole bad trajectory into the prompt ([AutoGuide §3.2, Algorithm 1](https://arxiv.org/html/2403.08978v2)).

### 2.4 Evidence that failure-derived insight *hurts*

- ExpeL's "insights with reflections" −10.0pp (above).
- AWM + failures −2.2pp (above).
- **Library Drift / Ratchet**: "Skills are born from failure patterns but never validated against outcomes. Marginal or harmful skills dilute the retrieval pool with each round" — the paper defines this as *library drift* and shows it drives the library below the no-skill floor ([Library Drift §3.2](https://arxiv.org/html/2605.19576)).
- **Self-Evolution Backfires** traces cross-round contamination to failures becoming "reference material for distilling later skills" ([§Introduction](https://ar5iv.labs.arxiv.org/html/2608.05810)).
- **SkillsBench self-generated condition**: agents prompted to write their own procedural knowledge scored **−1.3pp on average vs no skills**, with Codex + GPT-5.2 at **−5.6pp** ([SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).
- **Reflexion's own ablation** shows self-reflection can be net-negative in the wrong configuration: on the 50 hardest HumanEval-Rust problems, *omitting test generation but keeping self-reflection* scored **0.52 vs 0.60 baseline** — i.e. reflecting on failures without grounded verification made things worse than not learning at all ([Reflexion Table 3](https://ar5iv.labs.arxiv.org/html/2303.11366)). This is a within-paper negative result from the canonical "learn from failure" paper.

### 2.5 Practical reading

The literature does **not** support "always extract from both." It supports:
1. **Contrastive pairing** (same task, one success one failure) — ExpeL, AutoGuide. Strongest signal per token.
2. **Failure-only for behavioral guardrails** — MetaClaw, Ratchet's ≥3-failure pattern clustering. Works when the extracted artifact is a short directive.
3. **Both, with schema separation** — ReasoningBank (different extraction strategy per judge verdict) is the only system that reports a clean positive for adding failures *and* names the mechanism.
4. **Never** concatenate failure-derived text into a success-only pipeline without a gate — AWM's −2.2pp and ExpeL's −10.0pp are the warnings.

---

## 3. Quality filters and admission gates

### 3.1 What gates exist, by system

| System | Gate before admission | Dedup / merge | Verification of correctness |
|---|---|---|---|
| **ExpeL** | Importance-count voting: new insight starts at **2**; UPVOTE/EDIT ++, DOWNVOTE −−; **removed at 0** | EDIT rewrites an existing insight in place | Implicit — consensus across many extraction passes |
| **Voyager** | **Self-verification module must confirm task completion** before the program is committed | OpenAI text-embedding-ada-002 dedup by description embedding | Execution (program ran without error) + LLM critic confirms |
| **AutoGuide** | Context-matching LLM decides if a new context duplicates an existing one | Reuses existing context key; groups guidelines under it | None beyond the contrastive derivation |
| **AWM** | **Neural evaluator must label the trajectory successful** before induction | Rule-based + LM induction; workflows segmented on double line breaks | Evaluator judgement only |
| **ReasoningBank** | LLM-as-a-judge labels outcome success/failure; extraction strategy differs per label | **Consolidation = simple addition** (deliberately minimal) | Judge only |
| **Mem^p** | Four update strategies compared: Vanilla / **Validation (successes only)** / **Adjustment (reflection)** / dynamic discard | Add / Remove / Update operators | Reflexion-based update was the best strategy |
| **Ratchet** (Library Drift) | **Cluster of ≥3 failures sharing a canonical pattern** before a skill is born; **outcome-driven retirement** when `n(s) ≥ N_min=100` and contribution `ĉ(s) ≤ −τ (τ=0.10)`; **hard active cap C=50**; **meta-skill authoring prior** | Explicit dedup (pattern canonicalisation, cover-guard) tested and found **unnecessary** given the meta-skill | Per-skill contribution score `ĉ(s) = (successes − failures)/trials` from an append-only evidence log |
| **VaG** (Self-Evolution Backfires) | **Three heterogeneous critics, all must pass**: `SchemaCritic` (frontmatter schema) ∧ `ExecCritic` (single-skill A-B replay on held-out tasks) ∧ `AgentCritic` (one LLM call for fabricated/contradictory/unsafe advice). Then **marginal-gain greedy subset selection** for combinatorial safety | Cold → Warm → Hot trust tiers | Behavioral A-B replay is the load-bearing check |
| **CoEvoSkills** | **Co-evolved informationally-isolated surrogate verifier** generates test assertions and structured failure diagnostics | Evolution iterations up to 5 | Surrogate verifier, not ground truth |
| **MetaClaw** | **Trigger threshold on support-set size**; skill-generation versioning flushes stale data | — | No admission gate on individual skills (explicitly criticized by [VaG](https://ar5iv.labs.arxiv.org/html/2608.05810)) |
| **AutoRefine** | Pruning/merging gate; periodic maintenance | Prune + Merge | Held-out validation |

Sources: [ExpeL §4.2](https://ar5iv.labs.arxiv.org/html/2308.10144v2) · [Voyager §2.2–2.3](https://ar5iv.labs.arxiv.org/html/2305.16291) · [AutoGuide §3.2](https://arxiv.org/html/2403.08978v2) · [AWM §2.3](https://ar5iv.labs.arxiv.org/html/2409.07429) · [ReasoningBank §3.2](https://ar5iv.labs.arxiv.org/html/2509.25140) · [Mem^p](https://ar5iv.labs.arxiv.org/html/2508.06433v4) · [Library Drift §3–5](https://arxiv.org/html/2605.19576) · [VaG](https://ar5iv.labs.arxiv.org/html/2608.05810) · [CoEvoSkills](https://arxiv.org/html/2604.01687).

### 3.2 Measured value of each gate (this is the strongest section of the corpus)

**VaG's ablation on Terminal-Bench 2 (`Event-50`, R5, [Table 2](https://ar5iv.labs.arxiv.org/html/2608.05810)):**

| Configuration | Pass@1 | Pool | Δ vs full VaG |
|---|---|---|---|
| VaG (full) | **72%** | 37 | — |
| − Schema validation | 70% | 37 | −2pp |
| **− Holdout replay** | **62%** | 45 | **−10pp** |
| − Semantic check | 68% | 40 | −4pp |
| − Marginal-gain gate | 64% | 58 | −8pp |

The behavioral replay check is the single most valuable critic (**−10pp** when removed), because "it is the only check that empirically tests behavior rather than surface form." The three critics are **mutually non-substitutable** — each intercepts a largely disjoint class of harmful skills. Removing the marginal-gain gate **inflates the pool from 37 to 58** while losing 8pp, i.e. joint selection is what catches individually-harmless-but-jointly-harmful skills.

**CoEvoSkills surrogate-verifier ablation ([Table A1](https://arxiv.org/html/2604.01687)):** removing the surrogate verifier drops SkillsBench pass rate from **71.1% → 41.1% (−30.0pp)**. The generator still runs 5 evolution iterations, but with only an opaque pass/fail oracle it "cannot perform targeted repairs." This is the largest single verifier effect in the corpus.

**EvoSkill**: Pareto-front selection over held-out validation avoids "redundant/conflicting-skill accumulation seen under greedy acceptance," yielding **+7.3pp on OfficeQA** and **+12.1pp on SealQA** ([per the survey, §9.1](https://arxiv.org/html/2607.10113)).

**SkillWeaver**: removing the "practice + verify" phases (leaving only propose + hone) drops performance **below the no-skill-library baseline** on its hardest web tasks ([survey §9.1](https://arxiv.org/html/2607.10113)).

**Trace2Skill**: prevalence-weighted consolidation "is useful only when consolidation also filters on a judge score" ([survey §9.1](https://arxiv.org/html/2607.10113)).

**Ratchet's ablations ([Table 1](https://arxiv.org/html/2605.19576))** are the clearest lesson on *over*-filtering:

| Condition | Baseline | Peak | Gain | Router engagement | Active skills |
|---|---|---|---|---|---|
| Default (full governance) | 0.258 | 0.658 | **+0.328** | 73% | 50 |
| A1 no injection | 0.283 | 0.375 | **+0.002** (floor) | 0% | 42 |
| **A4 harsh retirement** (`N_min` 100→20, τ→0.0) | 0.300 | 0.433 | **−0.019** (below floor) | 19% | **2** |
| A3 no meta-skill | 0.200 | 0.592 | +0.187 | 80% | 50 |
| A5 no dedup canon | 0.275 | 0.708 | +0.374 | 80% | 50 |
| A6 no cover-guard | 0.217 | 0.700 | +0.363 | 70% | 50 |
| A7 cap=100 | 0.292 | 0.650 | +0.317 | 75% | 100 |

Two counter-intuitive, high-value findings:
- **Governance on insufficient evidence is worse than no governance.** A4's harsh retirement produced **−0.019 ± 0.010**, actively below the no-skill baseline, because with only 20 trials the Hoeffding deviation is ε≈0.44 so useful skills are retired on unlucky draws. The bank collapsed to **2 active skills** and router engagement to **19%**.
- **Explicit deduplication was unnecessary given a meta-skill authoring prior** (A5/A6 slightly *exceed* the default). If you are about to build a costly dedup/merge subsystem, this is evidence to first invest in a *style/format prior on the extractor*.
- The **meta-skill authoring prior was the single most valuable component** (removing it costs 43% of the default's gain).

**Admission is a pre-commit necessity, not a post-hoc cleanup** — this is the central theoretical claim of [Self-Evolution Backfires](https://ar5iv.labs.arxiv.org/html/2608.05810): because skills are distilled *conditioned on the currently-live pool*, a defective skill passes its flawed reasoning into later skills ("descendants"). Removing the source alone is strictly dominated by removing its whole lineage, and existing libraries don't record which skills were in context when a skill was written. Empirically: removing 8 harmful source skills from the collapsed R5 pool recovered **only 2pp (50%→52%)**, leaving a 10pp gap to the R3 peak "locked in by descendants." Their verdict: "source-only rollback recovers only 17% of the degradation."

### 3.3 "N independent supports" — what the corpus actually says

- **ExpeL**: no N-support requirement, but a **vote/importance counter** that removes an insight when it reaches 0.
- **Ratchet**: the only explicit **N-support threshold** found — **≥3 failures sharing a canonical pattern** before a skill is born ([§4.2](https://arxiv.org/html/2605.19576)). This directly implements the "reject one-off extractions" idea. But its own A4 ablation warns that too-strict evidence floors cause erosion.
- **VaG**: `k = 3` held-out replays per joint-utility estimate; `|W| ≤ 15` candidates per round keeps greedy selection exact ([§Methodology](https://ar5iv.labs.arxiv.org/html/2608.05810)).
- **AgentHER**: **multi-judge verification** — two independent judges must agree before a relabeling is accepted. This raised pipeline precision 94.1% → 97.7% and cut label noise 5.9% → 2.3% ([AgentHER](https://ar5iv.labs.arxiv.org/html/2603.21357)). This is the cleanest "N independent supports" analogue measured.
- **SkillGen** (2026) selects candidate skills by **net interventional effect**, counting both repaired failures *and* induced regressions — the closest thing to a rejection-sampling-with-counterfactual-control design ([survey §1.3/§9.1](https://arxiv.org/html/2607.10113)).
- **SkillOpt** accepts text edits only when held-out validation improves; **SkillMaster** trains edits with counterfactual utility rewards ([survey §9.1](https://arxiv.org/html/2607.10113)).

---

## 4. Known failure modes and negative results

> **⚠ DEEPENED — see `reports/skill-extraction-addendum-negative-results.md`.** That addendum adds the controlled context-pollution measurements (Lost in the Middle −22.0pp; TEPA polluted memory 0.210 vs no-memory 0.309), published self-correction critiques (Huang et al. ICLR 2024: self-correction *lowers* accuracy on every model/benchmark), and four categories absent here: **retrieval that never fires** (only 49% of Claude trajectories load all available curated skills; 16.3% without curated skills; two models below their no-skill baseline), **saturation** (Mem0/MemOS exactly equal the no-memory baseline on 3 of 4 backbones), **25% of extracted entries net-negative** with **plausibility anti-predicting utility (−0.59pp)**, and **vendor admissions** (OpenAI named memory as a sycophancy contributor; Cognition found the model's own notes worse than their summarizer). It also corrects this report's "Memory Curse" citation and the Voyager ablation gloss.

### 4.1 Non-monotonic skill accumulation ("capability–contamination phase transition")

[When Self-Evolution Backfires](https://ar5iv.labs.arxiv.org/html/2608.05810) (Tencent), Terminal-Bench 2 Event-50, 5 rounds, pass@1, 3 rollouts/task:

| Round | Ungated Pass@1 | Pool | VaG Pass@1 | VaG Pool |
|---|---|---|---|---|
| Seed (static) | 46% | 3 | 46% | 3 |
| R1 | 48% | 35 | 52% | 5 |
| R2 | **60%** | 68 | 58% | 15 |
| R3 | **62% (peak)** | 105 | 62% | 25 |
| R4 | 52% | 141 | 68% | 30 |
| R5 | **50%** | 179 | **72%** | 37 |
| + Post-hoc rollback | 52% | 171 | — | — |

- Ungated ends R5 only **+2pp above its own R1** despite growing 35 → 179 skills.
- **Contamination targets the hardest tasks**: ungated Hard-tier pass@1 peaked at 53% (R2) and eroded to **35%** (R5); VaG raised Hard to **59%** (+24pp margin).
- Gating beats **oracle early stopping**: VaG's R5 (72%) exceeds ungated's *best* round (62%) by 10pp with a **~5× smaller pool**.
- Three-level taxonomy: **individual** contamination (single skill lowers success), **combinatorial** contamination (each harmless, jointly harmful), **systemic** (the inverted-U).
- Token cost per trial: Seed 0.35M, Ungated 1.07→1.30M, VaG 0.77→0.94M.
- ⚠ **Citation caveat on the rollback number.** The paper states recovery three inconsistent ways: "**recovers only 17%** of the degradation" (Contributions), "only **2pp** (50% → 52%)" (§Main Results), and a figure decomposition implying **1.7/12.3 = 13.8%**. Cite the raw 2pp or the 13.8% decomposition, **not** the abstract's 17%.

### 4.2 "Library drift" — the silent failure mode

[Library Drift](https://arxiv.org/html/2605.19576) (AWS + HSBC), MBPP+ hard-100, 100 rounds, Claude Opus 4.7, 3 seeds:
- Operational definition: drift occurs when `E[pass@1 | S_t] < E[p_0]` — the library makes the agent **worse than having no library**.
- Three sub-modes: **stagnation** (skills never reach the solver), **bloat** (retrieval degrades), **erosion** (over-aggressive governance destroys useful skills).
- **A1 (no injection): +0.002 ± 0.005** — creating skills without injecting them produces literally nothing. This is your "retrieval never fires" measured case.
- **A2 (retrieval-only, no LLM gate): +0.077 ± 0.065 with 98% router engagement** — near-maximal injection with a low-quality gate is only ~1/4 as good as the Default (+0.328).
- **A4 (harsh retirement): −0.019 ± 0.010** — below the no-skill floor. Consistent across all three seeds (−0.005, −0.027, −0.025).
- Healthy conditions maintain **70–80% router engagement**; the drifting A4 condition fell to **19%**.
- **A5/A6 show explicit dedup is unnecessary** given a meta-skill prior; the meta-skill alone is worth 43% of the gain.

### 4.3 Skills that don't generalize / negative transfer

- **SkillFlow-Bench** (166 tasks, 20 families, lifelong protocol, agents start with empty libraries). [Source](https://arxiv.org/pdf/2604.17308v1)
  - Claude Opus 4.6: 62.65% → 71.08% (**+8.43**)
  - MiniMax M2.5 +6.63, Claude Sonnet 4.5 +6.02, GPT 5.4 +3.62, Claude Opus 4.5 +2.41, **Kimi K2.5 +0.60**
  - **GPT 5.3 Codex: 52.41% → 46.39% (−6.02)**; Qwen-Coder-Next −0.60; Qwen3-Coder-480B −0.60; MiniMax M2.7 −0.60; Claude Sonnet 4.6 unchanged
  - **"High skill usage does not imply high utility":** Kimi K2.5 gains +0.60pp despite **66.87% skill usage**
  - Failure mechanism: "incorrect early skills can induce **persistent negative transfer** and substantially degrade later performance"; weaker models suffer **cognitive overload** from trying to integrate multiple experiences
  - Consolidation > proliferation: stronger settings end with *smaller* final inventories
- **SWE-Skills-Bench** ([arXiv 2603.15401](https://arxiv.org/abs/2603.15401)): 49 public SWE skills × ~565 task instances, deterministic pytest verification:
  - **39 of 49 skills yield zero pass-rate improvement**
  - Average gain **+1.2%** (89.8% → 91.0%) while **token consumption rises 10.5%**
  - Token overhead ranges from modest savings to **+451%**, with pass rates unchanged
  - Only **7 specialized skills** produce meaningful gains (up to +30%); **3 degrade performance** (up to −10%) "due to version-mismatched guidance conflicting with project context"
  - Ecosystem context: **84,192 skills created in 136 days**
- **SkillsBench** ([arXiv 2602.12670](https://ar5iv.labs.arxiv.org/html/2602.12670v1)): curated +16.2pp but **16 of 84 tasks show negative deltas**, e.g. taxonomy-tree-merge **−39.3pp**, energy-ac-optimal-power-flow −14.3pp. Domain spread +4.5pp (SWE) to +51.9pp (Healthcare). Self-generated skills: **mean −1.3pp**, Open/close range from Opus 4.6 +1.4 to Codex+GPT-5.2 **−5.6**.
- **Raw-Experience** (2026, via [survey §8](https://arxiv.org/html/2607.10113)): model-generated skills "help on average but can **transfer negatively**," and **"a strong extractor need not be a strong consumer."** This is directly your situation.
- **XSkill's Qwen transfer caution** ([survey §9.4](https://arxiv.org/html/2607.10113)): transfer can raise *Pass@4* by encouraging exploration while *lowering* *Average@4*.
- **AutoGuide vs ExpeL** — a concrete instance of irrelevant-context harm: ExpeL feeds **all** guidelines at every step; on the same WebArena task "ExpeL mistakenly attends to the second guideline 'ensure to specify the item's number and location…', leading to wrong reasoning and action." AutoGuide's context-conditioned selection reaches 47.1% SR on WebArena-Reddit vs ExpeL 21.8% and ReAct 8.0% ([AutoGuide §4.2, Fig. 4](https://arxiv.org/html/2403.08978v2)).

### 4.4 Retrieval that degrades with scale, and retrieval that never fires

- **Flat retrieval collapse** (contradicted nowhere in the corpus): 16–32 skills ≈ **96–98%**; 64 → **92%**; 128 → **78%**; **256 → 64%**. Mitigations (hierarchy, graph retrieval, full-text rerank) "push the failure rightward… but have not shown general removal." ([survey §9.3 & Fig. 4](https://arxiv.org/html/2607.10113))
- Registry-scale corroboration: Wild-Skills stresses retrieval under **34K-pool** distractors; SkillRouter needs full-text retrieve-and-rerank at **80K** skill pool; SRA decomposes a **26,262-skill** corpus and finds incorporation/need-aware loading remain separate bottlenecks ([survey §8, §9.3](https://arxiv.org/html/2607.10113)).
- **Retrieval-never-fires is measurable and is a real outcome**: Ratchet A1's router engagement was **0%** and gain **+0.002**. A4's drifting condition fell to **19%**.
- **Maintenance is load-bearing**: AutoRefine's TravelPlanner ablation — removing periodic pruning and merging lowers final pass rate **35.6% → 31.1%**, grows the repository **4.5×**, and reduces **utilization from 0.71 → 0.08** ([survey §9.6](https://arxiv.org/html/2607.10113)). SkillOps: removing library-time maintenance drops standalone ALFWorld success to **71.9%** vs 79.5% for the full system.

### 4.5 Benchmark saturation / stronger-backbone effects

- **MetaClaw reports the headroom effect directly**: "Stronger models benefit less and weaker models benefit more." GPT-5.2 gained **+2.9pp** (41.1→44.0) while Kimi-K2.5 gained **+6.9pp** (21.4→28.3); "GPT-5.2 starts from a higher baseline, leaving less headroom for skill-driven gains" ([MetaClaw](https://ar5iv.labs.arxiv.org/html/2603.17187)).
- **SkillsBench per-domain saturation**: SWE only +4.5pp vs Healthcare +51.9pp, explained as "domains with strong pretraining coverage benefit less from external procedural guidance" ([SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).
- **SkillFlow**: Claude Sonnet 4.6 "remains unchanged at 56.63% under both settings" ([SkillFlow](https://arxiv.org/pdf/2604.17308v1)).
- The survey grades "larger relative gains for weaker backbones" only **evidence grade C** — convergent rather than controlled, and notes "rare specializations can invert the pattern if weaker models cannot route to them reliably" ([survey Table 7](https://arxiv.org/html/2607.10113)).
- **⚠ CORRECTED — do not cite the "Memory Curse: Mechanisms and Mitigations" title or the two IDs below.** An earlier draft of this bullet cited a secondary aggregator titled "Memory Curse: Mechanisms and Mitigations" and the IDs arXiv 2504.01928 / 2604.12007. **Those two IDs could not be matched to any memory-curse paper, and the title does not match the verified primary source.** The one confirmed paper is **[The Memory Curse: How Expanded Recall Erodes Cooperative Intent in LLM Agents (arXiv 2605.08060, 2026)](https://arxiv.org/abs/2605.08060)**: across 7 LLMs × 4 games × 500 rounds, "expanding accessible history degrades cooperation in **18 of 28** model–game settings" (GPT-OSS-20B Prisoner's Dilemma **99.1% → 20.6%** as history goes 1 → 80; Gemma-3-12B **51.2% → 9.5%**). Ablating chain-of-thought *reduces* the collapse (Llama-3.3-70B Trust Game **100.0% → 6.9%** with CoT). ⚠️ **This is a behavioural-economics result, not task accuracy** — cite it as such. Full context-pollution evidence with task-accuracy numbers is in `reports/skill-extraction-addendum-negative-results.md`.

### 4.6 Trajectory-summary harm (representation, not extraction)

[State Design Matters](https://arxiv.org/html/2602.15858) is the cleanest measured case that compressing the trajectory can *hurt*: replacing full history with a rolling **≤25-token** summary helped Tower of Hanoi for most mid-to-large models (Qwen2.5VL-7B 0.08→0.39; DeepSeek-R1-14B 0.46→0.70; Llama3.3-70B 0.66→1.00) but **regressed Messenger** for Qwen3-VL-32B-Instruct (0.09→**0.00**) and Llama3.3-70B (0.28→0.22), and degraded the smallest model on Hanoi (LLaVA-Phi3-3.8B 0.16→0.08). Diagnosed cause: summaries "state generic observations" instead of preserving decision-relevant context like relative distance or progress toward subgoals.

---

## 5. Trajectory representation: what is kept, what is dropped

> **⚠ SUPERSEDED IN PART — see `reports/skill-extraction-addendum-trajectory-representation.md`.**
> Source-code-level inspection corrected one factual claim below (§5.1: ExpeL feeds the raw interleaved ReAct **text string**, not `(o,a,o',r)` tuples), added ExpeL's real token budgets (failure side truncated >13,000 tok; 8 successes/call; 20-rule cap), and added the strongest observation-representation ablation in the corpus (AWM Table 8: NL-only 2.8 task SR vs NL+filtered-HTML 2.0), The Complexity Trap's raw-vs-summarized measurements, SWE-agent's structural budgets, and Claude Code / AgentCore production budgets. The main report's conclusions are unchanged; this section's representation details are.

### 5.1 Per-system serialization

| System | Serialized unit | Kept | Dropped / capped |
|---|---|---|---|
| ExpeL | `(o_t, a_t, o_{t+1}, r_{t+1})` tuples appended to trajectory τ | observations, actions, rewards | Max step count `H`; capped at `L` successes per extraction chunk |
| AutoGuide | τ = `(x_0, a_0, r_0, …, r_T)` | observations, actions, rewards | Only the **prefix up to the deviation timestep** is summarized into a context; the full pair is shown to the guideline extractor |
| AWM | step `p = (o, a)` plus NL state description and **reasoning** | state, reasoning, executable action | Instance-specific values abstracted to placeholders (`{product-name}`) |
| Reflexion | short-term = full trajectory; long-term = reflection text | reflections | **Bounded `mem` to Ω = 1–3**; AlfWorld "truncate the agent's memory to the last **3** self-reflections"; programming "max memory limit of **1** experience" |
| Voyager | generated code, env feedback, execution errors, critique | code, error trace, inventory/state | **4 rounds** of code generation before abandoning the task; top-5 retrieved skills |
| ReasoningBank | memory items `(title, description, content)` | high-level strategy | **Explicitly drops low-level execution detail.** For web browsing, uses **the model's own thinking process as the observation proxy "due to lengthy observation representations"** — i.e. raw accessibility trees are not fed to the extraction model |
| Mem^p | Script / Trajectory / Proceduralization variants | full trace or summarized script | top-k retrieved memories; too many retrieved memories degrades performance |
| MetaClaw | failure trajectories → skill instructions | failure patterns | Skills inject as short directives; AutoResearchClaw skills kept **under 2000 tokens** |
| VaG | skill record = frontmatter `(name, trigger condition, body)` + free-form guidance | structured frontmatter + body prose | — |

Sources as in §1.

### 5.2 Concrete token budgets and compression strategies

- **Reflexion**: memory bounded to **Ω = 1–3** stored experiences ("usually set to 1-3 to adhere to max context LLM limitations"); AlfWorld truncates to **last 3** reflections; programming uses **max 1** ([Reflexion §3, §4](https://ar5iv.labs.arxiv.org/html/2303.11366)).
- **Voyager**: **top-5** skill retrieval; **4** code-refinement rounds max; 160 prompting iterations total in the evaluation budget ([Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291)).
- **MetaClaw**: AutoResearchClaw prompts cap skills to be **"under 2000 tokens while preserving behavior"**; evaluation on a **23-stage pipeline** with skills injected into all 18 LLM-driven stages ([MetaClaw](https://ar5iv.labs.arxiv.org/html/2603.17187)).
- **State Design Matters**: rolling summary of **at most 25 tokens** updated every timestep; importantly notes total system tokens *increase* because summarization adds an LLM call per step even though the agent's context shrinks ([paper](https://arxiv.org/html/2602.15858)).
- **Stateless Decision Memory / DPM**: the cleanest public token-budget experiment. Trajectories ≈**26,000–28,000 chars, 82–96 discrete events**. Three memory budgets: tight **1,338 chars (20×)**, moderate **5,352 (5×)**, loose **13,381 (2×)**. At 20× compression, DPM (single task-conditioned projection over an immutable event log) beats incremental summarization on factual precision **0.907 vs 0.392 (+0.515, Cohen's h=1.17, p=0.0014)** and reasoning coherence **0.800 vs 0.267 (+0.533, h=1.13, p=0.0034)**, and is **7–15× faster** because it makes 1 LLM call at decision time instead of N ([arXiv 2604.20158](https://arxiv.org/html/2604.20158v1)). At generous budgets the two are statistically indistinguishable — i.e. **the compression strategy only matters when the budget binds.**
- **Web agents**: standard practice is accessibility-tree-only rather than raw HTML — AWM runs BrowserGym with accessibility trees, and AWM's own summary/abstract workflow representation beats retrieving full concrete trajectories (Synapse) by +5.0 element accuracy / +4.0 step SR ([AWM](https://ar5iv.labs.arxiv.org/html/2409.07429), [ReasoningBank](https://ar5iv.labs.arxiv.org/html/2509.25140)).
- **Survey's structured evidence**: SimpleMem's Table 5 — removing **write-time semantic compression** drops LoCoMo average F1 **43.24 → 31.29**. XSkill's Table 3 — removing the Experience Manager drops VisualToolBench Average@4 by **4.09** points; removing the Skill Manager drops it **3.62**; read-time decomposition/adaptation ablations are smaller. Overall pattern (grade B/C): **write-time abstraction usually beats read-time abstraction alone** ([survey §9.7](https://arxiv.org/html/2607.10113)).

### 5.3 Is there a paper comparing "summarize the trajectory" vs "feed raw"?

- **For extraction specifically: I found no clean head-to-head ablation.** The closest are (a) ExpeL's retrieval-strategy ablation (task similarity 59.0 > reasoning similarity 48.5 > random 42.5 on ALFWorld), which compares *what to retrieve*, not *how to serialize*; (b) AWM vs Synapse (abstract workflows vs concrete full examples, +4.0 step SR); and (c) Mem^p's Script vs Trajectory vs Proceduralization build comparison, which found **Trajectory beat Script** on ALFWorld dev (67.17 vs 66.67) and **Proceduralization (both) beat both** (87.14 / 77.86), while on TravelPlanner Script ≈ Trajectory ([Mem^p Table 1](https://ar5iv.labs.arxiv.org/html/2508.06433v4)). That is the nearest thing to "raw vs summarized" for *memory content*, and the answer is "combine both."
- **For agent state at inference time**, [State Design Matters](https://arxiv.org/html/2602.15858) *is* that head-to-head, with mixed results (§4.6 above).
- **For budget-constrained projection**, DPM vs incremental summarization *is* that head-to-head ([arXiv 2604.20158](https://arxiv.org/html/2604.20158v1)).

---

## 6. What I could NOT find (flagged, not guessed)

1. **No ExpeL ablation of success-only vs failure-only vs both.** ExpeL's §5.6 ablates *hand-crafted vs learned*, *±reflections*, *GPT-4 vs GPT-3.5*, and *retrieval ranking*. If someone on your team cited "ExpeL's success-only vs failure-only ablation table," that citation does not exist in the paper (v2/v3). The nearest primary evidence is ReasoningBank Fig. 7.
2. **No paper that reports a full factorial 2×2 (success / failure / both / neither) × (gate / no gate) for insight extraction.** AgentHER reports success-only SFT vs success+failure-relabeled, and ReasoningBank reports success-only vs both, but neither crosses the admission-gate factor.
3. **No measured "usage–utility gap" number for a self-generated skill library whose retrieval never fires at all** with a *named* system, other than Ratchet's A1 ablation (router forced to `none`: **+0.002**, 0.0% engagement). The survey explicitly says the field "still lacks a standard scalar repair metric" and that operator velocity and repair quality are "under-reported."
4. **No vendor engineering post** (Anthropic / OpenAI / Cursor / Microsoft) that I could locate admitting a shipped *skills* feature caused a regression, analogous to a public postmortem. The closest artifacts are benchmark papers and third-party press ([The Register, 2026-02-19](https://assets.theregister.com/2026/02/19/ai_agents_cant_teach_themselves/)) rather than first-party disclosures.
5. **No primary source for the "Memory Curse" agent-memory claims.** I could only reach a secondary topic aggregator ([emergentmind](https://www.emergentmind.com/topics/memory-curse)); the three cited primary arXiv IDs (2504.01928, 2605.08060, 2604.12007) were not fetched or verified in this pass.
6. **No controlled study isolating "failure-derived insight" as the causal agent of negative transfer** in a prompt-memory setting. The negative-transfer evidence is either (a) offline fine-tuning (AgentHER's counterfactual), (b) success-vs-both deltas (ReasoningBank), or (c) aggregate library-level collapse (VaG, Library Drift). Individual-item attribution is missing — which is precisely why Ratchet's per-skill contribution score and VaG's per-skill replay exist.
7. **No published token budget for the extraction prompt itself** in ExpeL / AWM / AutoGuide (i.e. how many tokens of trajectory go into the insight-extraction call). Only Reflexion (Ω=1–3 reflections), Voyager (top-5, 4 retries), MetaClaw (<2000 tokens/skill), State Design (25-token summary), and DPM (1,338/5,352/13,381 chars) publish explicit numbers.

---

## 7. Immediate implications for your skill-extraction layer

Ordered by evidence strength (survey grades in brackets):

1. **Put a behavioral A/B replay gate in front of admission before anything else.** [Grade A/B] VaG: **−10pp** without holdout replay; CoEvoSkills: **−30.0pp** without a verifier; SkillWeaver drops *below* no-library baseline without practice+verify. Schema/format validation alone bought only **−2pp** — it is the cheapest but least valuable check.
2. **Bound the library and retire on measured contribution.** [Grade B] Ungated accumulation is non-monotone (62% → 50%); hard cap + outcome-driven retirement is the two-mechanism fix, with **A7 (cap doubled) showing comparable mean but higher variance**. Use `N_min` large enough that the Hoeffding tolerance is well below your true effect — Ratchet's `N_min=20` produced **−0.019 (below floor)**.
3. **Use contrastive same-task pairs rather than dumping failure traces.** ExpeL and AutoGuide both do this; AWM's −2.2pp and ExpeL's −10.0pp (reflections) are the failure cases of indiscriminate failure injection.
4. **Retrieve context-conditionally, not wholesale.** [Grade A/B] AutoGuide 47.1% vs ExpeL 21.8% on WebArena-Reddit; flat retrieval collapses at 128–256 skills.
5. **Add a joint/combinatorial selector, not only per-item checks.** [Grade B] VaG marginal-gain gate: **−8pp and 2× pool inflation** when removed; individually-harmless-but-jointly-harmful skills are invisible to per-skill critics.
6. **Prefer write-time abstraction over read-time summarization** [Grade B/C] — and if your budget binds, a single task-conditioned projection over an append-only log beats N incremental summary calls by 7–15× latency and large quality margins ([DPM](https://arxiv.org/html/2604.20158v1)).
7. **Instrument per-skill contribution and router engagement, not just end-task pass@1.** Ratchet's whole diagnostic thesis is that drift is silent at the aggregate level but visible per-skill (`ĉ(s)`), per-verdict (helped/hurt/neutral), and per-engagement (73% healthy vs 19% drifting).
8. **Expect self-generation to underperform on its own.** [Grade A for the negative] SkillsBench self-generated = **−1.3pp**; SWE-Skills-Bench **39/49 zero gain**; SkillFlow **−6.02pp for one frontier model**. The positive self-evolution results (CoEvoSkills +40.5pp) all include a verifier *in the loop*. Anthropic's own Skills ecosystem assumption — that humans curate — is what the benchmark currently validates.

---

### Appendix: primary sources consulted

- [Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv 2303.11366)](https://ar5iv.labs.arxiv.org/html/2303.11366)
- [ExpeL: LLM Agents Are Experiential Learners (arXiv 2308.10144)](https://ar5iv.labs.arxiv.org/html/2308.10144v2) · [AAAI version](https://ojs.aaai.org/index.php/AAAI/article/download/29936/31635) · [code](https://github.com/LeapLabTHU/ExpeL)
- [Voyager: An Open-Ended Embodied Agent with LLMs (arXiv 2305.16291)](https://ar5iv.labs.arxiv.org/html/2305.16291)
- [AutoGuide (arXiv 2403.08978, NeurIPS 2024)](https://arxiv.org/html/2403.08978v2) · [NeurIPS proceedings](https://proceedings.neurips.cc/paper_files/paper/2024/hash/d8efbb5dd415974eb095c3f06bff1f48-Abstract-Conference.html)
- [Agent Workflow Memory (arXiv 2409.07429, ICML 2025)](https://ar5iv.labs.arxiv.org/html/2409.07429) · [ICML poster](https://icml.cc/virtual/2025/poster/45496)
- [AutoManual: Constructing Instruction Manuals by LLM Agents (arXiv 2405.16247, NeurIPS 2024)](https://dl.acm.org/doi/abs/10.5555/3737916.3737935)
- [MetaClaw: "Just Talk – An Agent That Meta-Learns and Evolves in the Wild" (arXiv 2603.17187)](https://ar5iv.labs.arxiv.org/html/2603.17187) · [ADS record](https://ui.adsabs.harvard.edu/abs/2026arXiv260317187X/abstract) · [code](https://github.com/aiming-lab/MetaClaw)
- [When Self-Evolution Backfires: Pre-Commit Gating against Skill Contamination (arXiv 2608.05810)](https://ar5iv.labs.arxiv.org/html/2608.05810)
- [Library Drift: Diagnosing and Fixing a Silent Failure Mode in Self-Evolving LLM Skill Libraries (arXiv 2605.19576)](https://arxiv.org/html/2605.19576) · [code](https://github.com/amazon-science/Self-Evolving-Agents-Ratchet)
- [Dynamic Agent Skills: A Lifecycle Survey and Taxonomy (arXiv 2607.10113)](https://arxiv.org/html/2607.10113)
- [ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory (arXiv 2509.25140)](https://ar5iv.labs.arxiv.org/html/2509.25140) · [Google Research blog](https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/)
- [Mem^p: Exploring Agent Procedural Memory (arXiv 2508.06433)](https://ar5iv.labs.arxiv.org/html/2508.06433v4) · [code](https://github.com/zjunlp/MemP)
- [EvoSkill: Automated Skill Discovery for Multi-Agent Systems (arXiv 2603.02766)](https://arxiv.org/html/2603.02766v1)
- [CoEvoSkills: Self-Evolving Agent Skills via Co-Evolutionary Verification (arXiv 2604.01687)](https://arxiv.org/html/2604.01687)
- [SkillsInjector: Dynamic Skill Context Construction for LLM Agents (arXiv 2605.29794)](https://arxiv.org/html/2605.29794v1)
- [SkillsBench (arXiv 2602.12670)](https://ar5iv.labs.arxiv.org/html/2602.12670v1)
- [SWE-Skills-Bench (arXiv 2603.15401)](https://arxiv.org/abs/2603.15401)
- [SkillFlow: Benchmarking Lifelong Skill Discovery and Evolution (arXiv 2604.17308)](https://arxiv.org/pdf/2604.17308v1)
- [AgentHER: Hindsight Experience Replay for LLM Agent Trajectory Relabeling (arXiv 2603.21357)](https://ar5iv.labs.arxiv.org/html/2603.21357) · [code](https://github.com/alphadl/AgentHER)
- [State Design Matters: How Representations Shape Dynamic Reasoning (arXiv 2602.15858)](https://arxiv.org/html/2602.15858)
- [Stateless Decision Memory for Enterprise AI Agents (arXiv 2604.20158)](https://arxiv.org/html/2604.20158v1)
- [Dynamic Cheatsheet: Test-Time Learning with Adaptive Memory (EACL 2026)](https://aclanthology.org/2026.eacl-long.333/)
- [Large Language Models Cannot Self-Correct Reasoning Yet (ICLR 2024, arXiv 2310.01798)](https://arxiv.org/abs/2310.01798)
- [The Register: "AI agents can't teach themselves new tricks – only people can" (2026-02-19)](https://assets.theregister.com/2026/02/19/ai_agents_cant_teach_themselves/)
- [Amazon Bedrock AgentCore episodic memory / new capabilities (vendor)](https://www.aboutamazon.com/news/aws/aws-amazon-bedrock-agent-core-ai-agents)
