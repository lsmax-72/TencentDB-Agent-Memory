# Addendum II — Negative Results, Failed Retrieval, and Saturation

**Companion to:** `reports/skill-extraction-literature-review.md` and `reports/skill-extraction-addendum-trajectory-representation.md`
**Date:** 2026-09-18
**Scope:** This addendum substantially deepens §4 of the main report. Where the main report gave one or two numbers per failure mode, this gives the controlled measurements, plus four categories the main report did not cover: **context pollution**, **published self-reflection critiques**, **retrieval that never fires**, and **vendor admissions**.

> **Two corrections to the main report are carried at the top (Part A).** Read them before forwarding any claims downstream.

---

## Part A — Corrections to the main report

### A1. The "Memory Curse" citation was wrong — CORRECTED in the main report

I cited a secondary aggregator ("Memory Curse: Mechanisms and Mitigations") plus arXiv **2504.01928** and **2604.12007**. Verification: **neither ID matches any memory-curse paper, and that title does not match the verified primary source.** The main report's bullet now carries a correction banner.

The one **verified** paper is **[The Memory Curse: How Expanded Recall Erodes Cooperative Intent in LLM Agents (arXiv 2605.08060, 2026)](https://arxiv.org/abs/2605.08060)**: 7 LLMs × 4 games × 500 rounds — "expanding accessible history degrades cooperation in **18 of 28** model–game settings." GPT-OSS-20B Prisoner's Dilemma **99.1% → 20.6%** (history 1 → 80); Gemma-3-12B symmetric game **51.2% → 9.5%**. The effect is **content, not length**: replacing history with synthetic cooperative text restores **9.5 → 84.00**. Ablating chain-of-thought *reduces* the collapse (Llama-3.3-70B Trust Game **100.0%** with no reasoning → **6.9%** with CoT). ⚠️ **Behavioural-economics result, not task accuracy — cite accordingly.**

### A2. Voyager's ablation — the main report's gloss was too strong — CORRECTED

Main report §2.2 said "Voyager `w/o skill library` exhibits a tendency to plateau." Verbatim true, but the paper **does not print an item-count delta** for that variant (Fig. 9 is a curve). The hard printed numbers are tech-tree iterations required: **Iron 29±11 (w/o skill library) vs 21±7 (Voyager)**, and **Diamond: 0/3 vs 1/3** — i.e. the ablation **never unlocks diamond without the library**. Cite those, not a vague "plateau."

### A3. Anthropic and Cursor — two widely-repeated claims are FALSE

- **"Cursor removed embeddings / semantic search."** FALSE. [Cursor's own post (2025-11-06)](https://cursor.com/blog/semsearch) reports semantic search gives **12.5% higher accuracy**, and a [2026 post](https://cursor.com/blog/secure-codebase-indexing) calls it "**one of the biggest drivers of agent performance**." Do not repeat the removal claim.
- **"Terminal-Bench is saturated."** FALSE as stated. [Terminal-Bench (arXiv 2601.11868)](https://arxiv.org/abs/2601.11868): frontier agents resolve **less than 65%** of 89 tasks; the authors predict saturation only "within the next year." Relevant because the VaG paper's 46–72% numbers sit in that range.

### A4. Two accuracy caveats to carry forward

- **Mem0**'s overall-J rows and **A-MEM**'s primary tables in the source I received were obtained via secondary analysis. Re-verify against the PDFs before publication.
- **A withdrawn paper to avoid:** [arXiv 2603.11513](https://arxiv.org/abs/2603.11513) claimed 85–100% oracle-retrieval failure rates and **WITHDREW the claim (Aug 2026)** — its oracle selected passages by gold-answer string containment. Corrected HotpotQA EM *rises* +39.2/+44.3/+50.0pp for Qwen2.5-1.5B/3B/7B. **Do not cite the original claim.**

---

## Part B — Context pollution: the controlled measurements

The main report asserted context pollution from one AutoGuide example. Here is the real evidence base.

### B1. Position, not just presence

**[Lost in the Middle (arXiv 2307.03172, TACL 2024)](https://arxiv.org/abs/2307.03172)** — multi-doc QA, 20 documents, GPT-3.5-Turbo. Identical content, reordered: **75.8% (first) → 53.8% (middle) → 63.2% (last) = −22.0pp.** At 30 docs: 73.4 → 50.5 → 63.7. Their printed worst case is "**lower than performance without any input documents**" (closed-book 56.1%). Going from 20 → 50 retrieved docs adds only ~1.5% (GPT-3.5-Turbo) / ~1% (Claude-1.3).

### B2. Retrieval can hurt even at top-1

**[Making RAG Robust to Irrelevant Context (arXiv 2310.01558, ICLR 2024)](https://arxiv.org/abs/2310.01558)**, Llama-2-13B — no-retrieval / top-1 / top-10 / random: NQ 29.6/41.0/30.2/28.2; **StrategyQA 65.6/62.1/60.4/58.4** (retrieval hurts *even with strong top-1*); **Fermi 27.7/27.4/24.0/22.1** (retrieval hurts). "even with a strong retriever (top-1 Google search) incorporating the retrieved context actually **hurts**"; random passages cost **>10 points on average**.

### B3. ⚠️ Counter-result — do not claim "noise always hurts"

**[The Power of Noise (arXiv 2401.14887, SIGIR 2024)](https://arxiv.org/abs/2401.14887)**: *topically unrelated* documents often **HELP** — "adding irrelevant documents until the context length is filled is almost always beneficial, with gains up to 0.07 (**+35%**)." What degrades monotonically is **related-but-answer-free** content: Llama2 gold-only **0.5642 → 0.2413** with 16 related docs. "**related documents are more harmful than unrelated ones.**" This is a crucial distinction for a memory system: *near-miss* memories are the dangerous ones, not clearly-irrelevant ones.

### B4. Distraction in reasoning

- **[Large Language Models Can Be Easily Distracted by Irrelevant Context (arXiv 2302.00093, ICML 2023)](https://arxiv.org/abs/2302.00093)**, GSM-IC, 58,052 examples: macro accuracy on otherwise-solvable problems — CoT **6.0**, LtM **18.0**, Program **5.0** (vs ~94 micro on clean). "no more than **18%**… can be consistently solved for all types of irrelevant information."
- **[Context Rot (Chroma, 2025)](https://research.trychroma.com/context-rot)**, 18 models, 194,480 calls: "**Even a single distractor reduces performance relative to the baseline**… and adding four distractors compounds this." Also: models "perform better on **shuffled** haystacks than on logically structured ones" — coherent context *hurts*. LongMemEval subset approximations: Claude Opus 4 **0.92 → 0.38**; Sonnet 4 0.89 → 0.38; GPT-4.1 0.87 → 0.62 *(values read off bar labels — approximate)*.
- **[Lost in the Noise (arXiv 2601.07226, 2026)](https://arxiv.org/abs/2601.07226)**: Gemini-2.5-Pro **77.8 → 70.8 → 62.5 → 48.0 (up to −38.3%)**; Qwen3-4B-Thinking **58.4 → 32.7 (−43.9%)**. Reports an **"inverse scaling trend where increased test-time computation leads to worse performance in noisy settings."** Fine-tuning on noisy data backfires: Qwen3-4B under related distractors **35.7 (none) → 34.8 (prompting) → 21.2 (SFT) = −40.6%**.

### B5. Stale memories are worse than no memories

- **[TEPA: Revoking Stale Memories (arXiv 2608.07429, 2026)](https://arxiv.org/abs/2608.07429)** uses the exact term "memory pollution" for "degradation caused by active memories that newer conflicting evidence has superseded." Controlled drift, 50 seeds: append-only **0.210**, last-write-wins **0.210**, **no memory 0.309**, TEPA 0.950. **Polluted memory scores below no memory.** Real file execution: append-only 0.203, no memory 0.298.
- **[When Stored Evidence Stops Being Usable (arXiv 2605.07313, 2026)](https://arxiv.org/abs/2605.07313)**: evidence fixed, irrelevant sessions added (0 → 400 sessions, ≈1.03M tokens/query), Pass@B — Qwen3-235B + HippoRAG **84.8 → 68.8 (−16.0pp)**; Qwen3-32B 82.6 → 63.5 (−19.1); Qwen3-8B 78.2 → 58.2 (−20.0).
- **[Selective Memory Retention (arXiv 2606.29178, 2026)](https://arxiv.org/abs/2606.29178)**, 75%-distractor write stress, Precision@5: unbounded **20.2% → 12.4%**; FIFO-K50 15.8% → 3.8%. "unbounded memory has the highest mean similarity (0.87) but lowest precision."
- **[MINTEval (arXiv 2605.18565, 2026)](https://arxiv.org/abs/2605.18565)** — 15.6k QA pairs, contexts averaging **138.8k tokens** (to 1.8M), 86 ordered updates. **All systems average 27.9%; best 33.4%.** Memory systems gain **+9.9%** on bAbI but **"on other domains… underperform the same baselines, with an average 3.0% drop."** Error decomposition: **memory-construction failures 41.7% vs answering-stage 25.2%** — the failure is in the *construction* of memory, which is precisely your extraction layer. Operation bias: **"strongly biased toward insertion-based operations (avg. 76.8%)"** rather than deletion/update.
- **[LongMemEval (arXiv 2410.10813, ICLR 2025)](https://arxiv.org/abs/2410.10813)**: long-context LLMs show "**a 30%~60% performance drop**." Oracle → S: GPT-4o **0.870 → 0.606**; Llama 3.1 70B 0.744 → 0.334. Commercial memory systems on a **10× shorter** history score far below offline reading: GPT-4o offline **0.9184** vs Coze-on-GPT-4o **0.3299**.

### B6. ⚠️ Correction to a commonly repeated claim

**Generative Agents (arXiv 2304.03442) does NOT ablate retrieval components and does NOT test "too many memories."** Its §6.5/Fig. 8 ablation is over memory *types*, not the recency/importance/relevance weights (all α = 1, decay 0.995, reflection threshold 150). TrueSkill μ: Full **29.89 ± 0.72**; no reflection 26.88; no reflection + no planning 25.64; human-authored 22.95; **no memory 21.21 ± 0.70** (Cohen's d = 8.16). Claims that it ablates the retrieval score are **UNSUPPORTED**.

**Qualifier ([Do RAG Systems Really Suffer From Positional Bias?, arXiv 2505.15561](https://arxiv.org/abs/2505.15561))**: >60% of queries contain a highly distracting passage in the top-10, but positional bias "is actually marginal in real scenarios"; reordering "do not perform better than random shuffling." The dominant harm is distractor **presence**, not **position**.

---

## Part C — Published critiques of self-reflection and self-correction

This is the strongest evidence in the entire review that a *failure-derivative* extraction step can be net-negative.

### C1. Intrinsic self-correction drops accuracy on every model and benchmark

**[Large Language Models Cannot Self-Correct Reasoning Yet (arXiv 2310.01798, ICLR 2024)](https://arxiv.org/abs/2310.01798)**:

| Model / benchmark | Standard | round 1 | round 2 |
|---|---|---|---|
| GPT-3.5 GSM8K | 75.9 | 75.1 | 74.7 |
| GPT-3.5 **CommonSenseQA** | 75.8 | **38.1** | 41.8 |
| GPT-3.5 HotpotQA | 26.0 | 25.0 | 25.0 |
| GPT-4 GSM8K | 95.5 | 91.5 | 89.0 |
| GPT-4 HotpotQA | 49.0 | 49.0 | **43.0** |
| **Llama-2-70b GSM8K** | 62.0 | **43.5** | **36.5** |
| **Llama-2-70b CSQA** | 64.0 | **37.5** | **36.5** |

With **oracle** labels everything *improves* (GPT-3.5 GSM8K 75.9 → 84.3). "the improvements… **vanish** when oracle labels are not available." "**74.7% of the time, GPT-3.5 retains its initial answer**"; when it does change, it is "more likely to modify a correct answer to an incorrect one." Multi-agent debate **underperforms plain self-consistency** at equal response count (GSM8K 83.0 at 9 responses vs SC 88.2 at 9).

### C2. Reflexion's own paper reports regressions — you don't need a replication failure

No dedicated replication paper failing the headline HumanEval 91.0 was found. But [Reflexion](https://arxiv.org/abs/2303.11366) reports:
- **MBPP (Python): Base 0.80 → Reflexion 0.77 (a decrease)** (Table 2).
- **starchat-beta HumanEval 0.26 → 0.26 — zero gain** (Appendix A Table 4), with "the ability to specify self-corrections is an emergent quality of stronger, larger models."
- **WebShop: "Reflexion fails to significantly outperform ReAct"**; "the agent does not generate helpful, intuitive self-reflections" (Appendix B.1).

### C3. At matched token cost, reflection loses to self-consistency

**[Sample More, Reflect Less (arXiv 2607.28576, 2026)](https://arxiv.org/abs/2607.28576)**, 150 paired questions at equal generated-token budget: "**0 are significantly better than self-consistency at matched token cost, 10 are significantly worse, and 26 are statistically indistinguishable**" (Holm). Reflexion 7B/MATH-500 **63.3 vs 73.5 (−10.1pp)**; Self-Refine 7B/MATH-500 66.7 vs 73.0 (−6.3pp); best-of-N self-verify 3B/MATH-500 52.0 vs 66.1 (−14.1pp). Mechanism: majority **counting** beats model-**choosing** "by between 5 and 17 percentage points." **At 1.5B, Reflexion's self-assessment "never fires" — every instance judged correct, so it "silently collapsed into one chain of thought."**

### C4. Reflection can entrench false beliefs

**[Honest Lying: Understanding Memory Confabulation in Reflexive Agents (arXiv 2605.29463, 2026)](https://arxiv.org/abs/2605.29463)**, auditing pre-existing Reflexion logs: "**16 frozen environments in ALFWorld, where 0 of 121 reflections mention the correct target object**"; "reflective memory can **reinforce false beliefs**"; reflection-repetition-rate correlates with trials-to-solve (**r = 0.808**); the mitigation solves only **3 of 16**.

### C5. Self-Refine's own numbers, and the systematic verdict

**[Self-Refine (arXiv 2303.17651, NeurIPS 2023)](https://arxiv.org/abs/2303.17651)** math: GPT-3.5 64.1 → 64.1 (**0**), ChatGPT 74.8 → 75.0 (**+0.2**), GPT-4 92.9 → 93.1 (**+0.2**); "ChatGPT feedback for **94% instances is 'everything looks good'**."

**[Kamoi et al., When Can LLMs Actually Correct Their Own Mistakes? (TACL 2024)](https://aclanthology.org/2024.tacl-1.78/)** flags Self-Refine for "**unfairly weak or wrong instructions or few-shot demonstrations**" and Reflexion for oracle use, concluding: "**no major work shows successful self-correction of responses from LLMs using feedback generated by prompting themselves under fair settings in general tasks.**"

Also: **[Self-[In]Correct (AAAI 2025)](https://arxiv.org/abs/2404.04298)** task-average deltas GSM8K **−0.61**, TriviaQA **−1.67**, MT-Bench −0.15; **[One Step Forward, Two Steps Back (ICLR 2026 workshop)](https://iclr.cc/virtual/2026/10014641)** on LiveCodeBench: "**fails to reliably improve Pass@1 scores and often degrades them due to hallucination-induced regression errors**" — Qwen2.5-Coder 32B/7B 23.0 → 21.4 → 21.8 → 19.4 with 18 regression errors.

### C6. The judge itself is biased

**[Judging LLM-as-a-Judge (arXiv 2306.05685, NeurIPS 2023)](https://arxiv.org/abs/2306.05685)**: GPT-4 position-bias swap consistency **65.0%**, Claude-v1 **23.8%**; verbosity-bias failure 91.3%. ⚠️ This paper explicitly declines to establish self-enhancement bias. The paper that *does*: **[Panickssery et al. (arXiv 2404.13076)](https://arxiv.org/abs/2404.13076)** — GPT-4 self-recognition **73.5%** out of the box; ordering bias reverses pairwise preferences at **25% / 58% / 89%** for GPT-4 / GPT-3.5 / Llama-2.

**Why this matters for you:** if your extraction pipeline uses an LLM judge to label trajectories success/failure — as ReasoningBank, AWM and MetaClaw all do — the judge's position and self-preference biases propagate directly into what gets stored.

---

## Part D — Low skill-usage and retrieval that never fires

The main report could only cite Ratchet's A1 ablation (+0.002, 0% engagement) for this failure mode. This is much better.

### D1. Agents frequently never load the skills they have

**[How Well Do Agentic Skills Work in the Wild (arXiv 2604.04323, 2026)](https://arxiv.org/abs/2604.04323)** — 34,198 skills, Recall@5 65.5%:

| Condition | Claude Opus 4.6 | Kimi K2.5 | Qwen3.5-397B | No-skill baseline |
|---|---|---|---|---|
| Curated + **forced** load | **55.4%** | 38.5% | 41.2% | — |
| Curated, agent decides (pass / load-rate) | 51.2% / **62.2%** | 38.9% / **86.1%** | 31.6% / 73.8% | 35.4 / 21.8 / 20.5 |
| Curated + distractors | 43.5% / **31%** | — | 33.7% | — |
| Retrieved (w/ curated) | 40.1% / 44.4% | 33.5% / 69.7% | 26.7% / 65.5% | — |
| **Retrieved (w/o curated)** | 38.4% / **16.3%** | **19.8% / 37.7%** | **19.7% / 54.8%** | 35.4 / 21.8 / 20.5 |

**Only 49% of Claude trajectories load all curated skills when they are directly available — falling to 31% with distractors and 16.3% without curated skills.** **Two models fall BELOW their own no-skill baseline** (Kimi 19.8 vs 21.8; Qwen 19.7 vs 20.5): "irrelevant retrieved skills can actively mislead the agent." Counter-example worth noting: **Kimi loads at 86% and gains nothing** (38.9 vs 38.5 force-loaded) — high usage with zero utility.

### D2. Models load skills with no awareness of whether they need them

**[Skill Retrieval Augmentation for Agentic AI (arXiv 2604.24594, 2026)](https://arxiv.org/abs/2604.24594)**, Table 6, 5,400 instances — overall loading rate: Llama-3.1-8B **72.1%**, Qwen3-235B 54.1%, GLM-5.1 37.8%, GPT-5.4 31.2%, Mistral-24B 28.3%, Qwen3-4B **21.0%**, Llama-3.3-70B **11.1%**. Per-dataset floors: ToolQA **0.6%**, CHAMP **0.9%**, BigCodeBench **0.0%**. Loading is **not** relevance-aware — models "still load skills at substantial rates even when no gold skill is present in the BM25 top-50," termed "**skill-loading hallucination**." Need-awareness is absent: overall **∆Load = +0.1pp**; Llama-8B is *less* likely to load when it needs help (**−15.1pp**). §5.5: "**retrieval quality is a necessary but insufficient condition**… a substantial disconnect between retrieval success and effective utilization."

### D3. Anthropic's own docs and issue tracker admit skills never fire

**[Claude Code Skills docs](https://code.claude.com/docs/en/skills)**: "**Every skill in the skill listing adds to your context on every turn, whether or not Claude ever uses it.** Run `/skill-doctor`… It **flags skills in the listing that have never been invoked**." Also: "**Seeing a skill trigger tells you Claude found it, not that it did what you intended.**"

Vendor-owned bug reports:
- [anthropics/skills#556](https://github.com/anthropics/skills/issues/556) (OPEN): "**no query ever triggers the skill — all should-trigger queries get 0/3 trigger rate**" (8 skills, 144 queries, every should-trigger 0/3).
- [anthropics/claude-code#36570](https://github.com/anthropics/claude-code/issues/36570): "Skills are never triggered… rate=0/3" — **CLOSED as `not planned`**.
- [anthropics/skills#996](https://github.com/anthropics/skills/pull/996): "`run_eval.py` reported **0% recall for every query**, so `run_loop.py` was optimizing against a metric that was always zero."
- [openai/codex#34321](https://github.com/openai/codex/issues/34321) (OPEN, `bug`): "the plugin contributes **zero skills** to `<skills_instructions>`… **Installed, enabled, and invisible — simultaneously.**"
- [anthropics/claude-plugins-official#3174](https://github.com/anthropics/claude-plugins-official/issues/3174): "recall = 0% / precision = 100%".

### D4. A pre-seeded, connected, well-guided store produced ZERO reads

**[Delivery-Not-Storage / decay probe (arXiv 2607.20972, 2026)](https://arxiv.org/abs/2607.20972)**: with a store **pre-seeded with task-relevant facts**, tools connected, and explicit guidance — "**zero memory calls in 114 turns**." Unseeded: **0–1 voluntary writes across 5 runs** despite 32 memory-guidance mentions. "**Knowledge present in a store contributes nothing by itself.**" Also: 10 conversation-held facts → **106 of 108** continuation summaries carried **0/10**.

### D5. Registry-scale reuse is one-time copying

**[From Registry to Repository (arXiv 2607.00911, 2026)](https://arxiv.org/abs/2607.00911)**: 18,463 skills from skills.sh + 23,199 personal-use skills from 5,876 GitHub repos; 3,709 reuse links. "**53% are never modified after adoption.**"

### D6. NOT FOUND in this space

- **SkillFlow-Bench / SkillsVote usage rates.** Only a Hugging Face dataset `KouShi2/skillflow-bench` exists, with no paper or usage table. SkillsVote's "Recommendation Controls Negative Transfer" section is qualitative plus hard-tier deltas (GPT-5.2 TB2 Hard **40.7 → 34.0, −6.7pp**; GPT-5.4-mini Easy **75.0 → 65.0, −10.0pp**) ([arXiv 2605.18401](https://arxiv.org/abs/2605.18401)).
- **An aggregate "% of retrieved skills actually used"** across the literature — not found. The nearest are the per-system load-rate tables above.

---

## Part E — Saturation: memory systems that match or lose to no memory

### E1. ⭐ The cleanest "vanilla matches memory" table

**[Evo-Memory (arXiv 2511.20857, 2025)](https://arxiv.org/abs/2511.20857)**, Table 5, average over AIME24/AIME25/GPQA/MMLU-Pro/ToolBench:

| Backbone | Baseline | History | Mem0 | MemOS | AWM | ReMem | ExpRAG |
|---|---|---|---|---|---|---|---|
| Claude 3.5 | 0.38 | 0.38 | **0.38** | **0.38** | 0.37 | 0.41 | 0.41 |
| Claude 3.7 Sonnet | 0.54 | 0.55 | **0.55** | **0.55** | **0.48** | 0.58 | 0.59 |
| Gemini 2.5 Flash | 0.59 | **0.55** | **0.59** | **0.59** | 0.56 | 0.65 | 0.60 |
| Gemini 2.5 Flash-Lite | 0.58 | **0.49** | **0.58** | **0.58** | **0.44** | 0.61 | 0.61 |

**Mem0 and MemOS are EXACTLY EQUAL to the no-memory baseline on 3 of 4 backbones.** AWM is *below* on Claude 3.7 (0.48 vs 0.54) and Flash-Lite (0.44 vs 0.58). Gemini's own "History" baseline (0.55) is *below* its no-memory (0.59). The paper notes gains track intra-dataset similarity (r = 0.717) and that "smaller models benefit most."

### E2. Effects inside noise

- **[MemoryLake on MemoryArena (arXiv 2608.13883, 2026)](https://arxiv.org/abs/2608.13883)**: web-shopping step match — long context **30.0%**, vector RAG **29.7%**, MemoryLake **29.6%**, Mem0 24.3% — "within **0.4 percentage points over 900 steps**, which this sample cannot resolve as a separation." Travel planning: **0.0 for every system**. "we do not report paired significance tests."
- **[MemDelta (arXiv 2606.29914, 2026)](https://arxiv.org/abs/2606.29914)**: verbatim RAG **47.2%** vs **full context 49.8%** → "+2.6pp… **NOT statistically significant (p = 0.34)**." Mem0 72.7% vs cloud-embedding RAG 73.9% → **p = 1.0** (McNemar), 90% CI [−10.8, +8.4]pp — at "1,000+ LLM calls… $0.50+/instance vs 60s / 0 calls / $0.01." Negative per-category: Knowledge-Update Δ = 0.0, SS-Assistant −5.4, SS-Preference **−10.0**.

### E3. Mem0's own table undercuts its headline

**[Mem0 (arXiv 2504.19413, 2025)](https://arxiv.org/abs/2504.19413)**, Table 1 (LOCOMO, GPT-4o-mini): (a) **Zep beats both Mem0 variants on Open-Domain** (76.60 vs 75.71/72.93); (b) **Mem0g graph memory is WORSE than base Mem0** (Single-Hop 65.71 vs 67.13; Multi-Hop 47.19 vs 51.15); (c) the "26% over OpenAI" claim rests on an OpenAI Temporal baseline of **21.71** with no selective retrieval.

Reproduction failures: [mem0#3944](https://github.com/mem0ai/mem0/issues/3944) ("LLM score is around **0.20**"), [mem0#3943](https://github.com/mem0ai/mem0/issues/3943) ("**30% and 50%**, far below the 60% reported"), [mem0#2800](https://github.com/mem0ai/mem0/issues/2800).

**[MemoryAgentBench (ICLR 2026)](https://proceedings.iclr.cc/paper_files/paper/2026/hash/fd1eff9dd295df50a41f2521942fa31d-Abstract-Conference.html)**: GPT-5-mini long-context **60.6** > Sonnet-3.7 49.6 > GPT-4o 48.8 > HippoRAG-v2 41.6 > BM25 41.5 > MIRIX 37.7 > **Zep 24.0 > Mem0 21.1 > Cognee 20.6** — every purpose-built memory system below plain long context and vanilla BM25.

**[Zep's own analysis](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)**: Mem0 is "outperformed by a simple full-context baseline… **~73%**, compared to Mem0's best score of **~68%**." Mem0 disputes parts ([getzep/zep-papers#5](https://github.com/getzep/zep-papers/issues/5)) — treat as unresolved.

### E4. Memory ON → accuracy DOWN, sycophancy UP

**[MemSyco-Bench (arXiv 2607.01071, 2026)](https://arxiv.org/abs/2607.01071)**, Qwen3-8B, Objective Fact Judgment (No-Memory 49.12):

| System | Accuracy | Δ | Sycophancy Δ |
|---|---|---|---|
| Full Dialog | 30.62 | **−18.50** | +17.24 |
| **Mem0** | 35.67 | **−13.45** | **+18.58** |
| **MemGPT** | 30.00 | **−19.12** | **+33.24** |
| MemoryBank | 31.67 | −17.45 | — |
| A-Mem | 36.00 | −13.12 | — |
| NaiveRAG | 34.00 | −15.12 | — |

Contextual Scope Control: **Mem0 13.34 (−56.66)**. A plausible-but-wrong memory cuts accuracy for all three models tested, largest **DeepSeek-V4-Flash 56.1% → 40.2%**, with sycophancy **24.3% → 52.3%**.

### E5. Benchmark saturation and contamination

- **[Anatomy of Agentic Memory (arXiv 2602.19320, 2026)](https://arxiv.org/abs/2602.19320)** formalizes `Δ = Score_MAG − Score_FullContext` and argues a benchmark "meaningfully evaluates agentic memory only when **Δ ≫ 0**." Risk ratings: HotpotQA (1k tok) **high**; **LoCoMo (~20k) moderate**; MemBench (100k) high; LongMemEval-S (103k) borderline. **If your internal benchmark has short contexts, it cannot detect your memory layer at all.**
- **[SWE-ABS (arXiv 2603.00520, ICML 2026)](https://arxiv.org/abs/2603.00520)**: SWE-Bench Verified "approaching saturation, top system **78.80%**"; of 11,041 passing patches, **2,184 (19.78%) are semantically incorrect**; under stricter checking the top agent goes **78.80% → 62.20% (−16.6pp), 1st → 5th**.
- **[SWE-Bench memory shortcut (arXiv 2512.10218)](https://arxiv.org/abs/2512.10218)**: given **only the issue ticket**, all gold files are localized on **65% / 63.20%** of Verified issues, vs **12.2% / 12%** for BeetleBox — "**3 times better**… **6 times better at finding edited files**, without any additional context."
- **[SWE-Bench-Pro leakage (arXiv 2606.17454)](https://arxiv.org/abs/2606.17454)** inflates pass@1 "**by up to 6.9%**."
- **[MemGym (arXiv 2605.20833)](https://arxiv.org/abs/2605.20833)**: "Settings that appear memory-intensive often admit strong performance without explicit memory management" — **frontier models score 0.70–0.85 from pretraining alone**; a single-check verifier had a **62% false-positive rate**.

---

## Part F — Vendor admissions

The main report listed first-party vendor regressions as NOT FOUND. **That was wrong — several exist.**

### F1. OpenAI named memory as a contributor to a shipped regression

"candidate improvements to better incorporate user feedback, **memory**, and fresher data… each… may have played a part in **tipping the scales on sycophancy** when combined." "**user memory contributes to exacerbating the effects of sycophancy**." OpenAI rolled back the GPT-4o update. — [Expanding on what we missed with sycophancy (2025-05-02)](https://openai.com/index/expanding-on-sycophancy/). ⚠️ `openai.com` returns HTTP 403 to my fetcher; quotes captured via verbatim third-party reproduction at [simonwillison.net](https://simonwillison.net/2025/May/2/what-we-missed-with-sycophancy/). A standalone memory-rollback post is NOT FOUND.

### F2. Cognition: the model's own notes were worse than their memory system

"**When we relied on the model's own notes without our compacting and summarization systems, we saw performance degradation** and gaps in specific knowledge." "the agent **spend[s] more tokens writing summaries than actually solving the problem**." "This '**context anxiety**' can actually hurt performance." Multi-agent designs are "**very fragile**"; "context isn't able to be shared thoroughly enough." — [Rebuilding Devin for Sonnet 4.5 (2025-09-29)](https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges) · [Don't Build Multi-Agents (2025-06-12)](https://cognition.com/blog/dont-build-multi-agents).

### F3. Vercel removed 80% of tools and the agent got better

"**The agent got simpler and better at the same time. 100% success rate instead of 80%.**" "**We were doing the model's thinking for it.**" Time **274.8s → 77.4s**; tokens **~102k → ~61k (−37%)**; steps **~12 → ~7 (−42%)**. Also: their vector pipeline's "failure mode is **silent**"; replacing it with a filesystem took cost "**~$1.00 to ~$0.25 per call, and the output quality improved**." — [We removed 80% of our agent's tools (2025-12-22)](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) · [Build knowledge agents without embeddings (2026-03-19)](https://vercel.com/blog/build-knowledge-agents-without-embeddings).

### F4. Anthropic: context rot, finite context, tool bloat

"**context rot**: as the number of tokens… increases, the model's ability to accurately recall information… decreases." "Context… must be treated as a **finite resource with diminishing marginal returns**." "One of the most common **failure modes** we see is **bloated tool sets**." CLAUDE.md files are "**naively dropped into context up front**." Also: "**More tools don't always lead to better outcomes**"; "**overlapping tools can also distract agents**"; a self-reported web-search tool bug "**biasing search results and degrading performance**." — [Effective context engineering (2025-09-29)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Writing effective tools (2025-09-11)](https://www.anthropic.com/engineering/writing-tools-for-agents).

### F5. CLAUDE.md rules reported as not followed

- [anthropics/claude-code#2544](https://github.com/anthropics/claude-code/issues/2544) (OPEN, `bug`/`memory`): "consistently ignoring mandatory rules… part of a broader **instruction-following regression**."
- [#33603](https://github.com/anthropics/claude-code/issues/33603): "**consistently not followed**… **measurably worse with each iteration**."
- [#81710](https://github.com/anthropics/claude-code/issues/81710): "hard cap (**~24.4 KB / ~200 lines**). Past it, content is **dropped silently**… you lose your **newest** rules first."
- Anthropic docs concede: "Longer files consume more context and **reduce adherence**"; "if two rules contradict each other, Claude may **pick one arbitrarily**" ([memory docs](https://code.claude.com/docs/en/memory)).
- **Windsurf** (via [LangChain, 2025-07-02](https://www.langchain.com/blog/context-engineering-for-agents)): "**embedding search becomes unreliable as a retrieval heuristic as the size of the codebase grows**" (original Windsurf source NOT FOUND).

---

## Part G — Negative transfer: additional measured cases (2025–2026)

The main report had SkillFlow, SWE-Skills-Bench, SkillsBench, and Raw-Experience. These add controlled experiments.

### G1. A quarter of extracted entries are net-negative, and plausibility anti-predicts utility

**[From Raw Experience to Skill Consumption (arXiv 2605.23899, Fudan + Microsoft Research, 2026)](https://arxiv.org/abs/2605.23899)** — 5 domains × 6 targets × 5 extractors: **"25% of entries have Δ < 0."** Domain negative rates: SpreadsheetBench 13%, SWE-bench-Verified 13%, **ALFWorld 47%**. ALFWorld target-level: GPT-5.4 **+4.93** while **Gemini-3.1-Flash-Lite (−1.59), Qwen3.5-9B (−1.69), Qwen3.5-35B (−1.34) are all negative**; worst cell **−3.48pp**. Same skill text: a skill from a strong pool gives **+1.8 to +9.5** across targets; a skill from a weak pool gives **−2.0 on GPT-5.4**. Two findings that should shape your pipeline directly:
- **"Better executor is not necessarily better extractor"** — Gemini-3.1-Flash-Lite was the best extractor on SpreadsheetBench while GPT-5.4 ranked **last**.
- **Textual plausibility anti-predicts utility**: a plausibility rubric scored **−0.59pp average, worse in 6 of 9 cells**, while a **validated** rubric scored +1.55pp. *(This is the single strongest methodological warning in the review: do not gate on how good an insight sounds.)*

### G2. Memory that is below a memory-free baseline

**[PATH-Bench / Selective Experience Use (arXiv 2608.01149, 2026)](https://arxiv.org/abs/2608.01149)**: memory-free baseline BCB **70.18/67.67**, WTB **42.80/43.00**. **AWM: BCB 65.56 (FWT −4.67) / 61.95 (FWT −8.36) — below baseline in both conditions.** HippoRAG-v2 WTB 41.70 (−2.61) / 41.67 (−0.54). MemRL FWT −3.44/−5.32; AutoSkill WTB −5.08/−3.89; SkillClaw BCB −1.89/−4.74. Conclusion: "**the bottleneck is not the capacity to store experience but the ability to judge whether stored experience is useful.**"

### G3. Skill conflict: complementary skills can be worst

**[From Procedural Skills to Strategy Genes (arXiv 2604.15097, 2026)](https://arxiv.org/abs/2604.15097)**, 4,590 controlled trials, 45 scenarios: compact "Gene" **+3.0pp** vs documentation-style "Skill" package **−1.1pp**. **Multi-object interference: two *complementary* Genes give the WORST result, 44.9% — below no-guidance and every other multi-Gene setting — while two *conflicting* Genes stay at 53.2%.** Their interpretation: "multiple partially relevant control objects may compete for attention and jointly blur the intended control signal, **even when they are nominally compatible**."

### G4. Library growth degrades routing logarithmically

**[The Scaling Laws of Skills in LLM Agent Systems (arXiv 2605.16508, 2026)](https://arxiv.org/abs/2605.16508)** — 15 frontier LLMs, 1,141 real skills, >3M decisions: **`Acc(N) = a − b·ln N` with R² > 0.97 for every one of the 15 models.** Errors progress toward capture by "**black-hole skills**." A **danger band of skill similarity [0.55, 0.75)**. Tight dependency pairs "**lose over 15%**" on wrong upstream state. Repair mechanisms raise routing **71.3% → 91.7%** and cut hijack **22.4% → 4.1%**.

### G5. Memory transfer across domains in coding agents

**[Memory Transfer Learning in coding agents (arXiv 2604.14004, 2026)](https://arxiv.org/abs/2604.14004)**, gpt-5-mini, Pass@3, N=3 memories: **MTL (Trajectory) TerminalBench2 0.315 → 0.270 (−4.5pp), MLGym-Bench 0.667 → 0.583 (−8.4pp)**; MTL (Workflow) MLGym −8.4pp; MTL (Summary) Aider 0.470 → 0.460. Qwen3-Coder-480B had **two exact-ZERO cells**. Named failure modes: "**Domain-mismatched anchoring**," "**False validation confidence**," "**Misapplied best-practice transfer**" — trajectory memories are "brittle anchors" that "induce negative transfer due to excessive specificity."

### G6. Optimizers that transfer negatively, and skills that hurt their own author

- **[Do Agent Optimizers Compound? (arXiv 2607.14004, 2026)](https://arxiv.org/abs/2607.14004)**: GEPA Phase-1 **70.8%** → transfer **54.5%**, *below the 56.8% unoptimized baseline* — "GEPA transfers negatively." Prompt grew 5 → 103 → 195 lines of per-task lessons.
- **[Trace2Skill (arXiv 2603.25158, 2026)](https://arxiv.org/abs/2603.25158)**: a 35B-authored skill gives a 122B model only **+0.009 ANLS** but **degrades the 35B source model by −0.062 ANLS (−6.2pp accuracy)**.
- **[EvolveR (arXiv 2510.16079)](https://arxiv.org/abs/2510.16079)**: teacher-distilled experiences **hurt at larger scale** — 3B avg **0.382 → 0.370** (PopQA 0.434→0.359; Bamboogle 0.328→0.288); 1.5B 0.358→0.352; at 0.5B the teacher *helps* (0.150→0.220).
- **AWM's own tables**: offline cross-domain task SR **0.7 vs MindAct 1.0**; Action F1 **below** baseline cross-website (**46.2 vs 51.1**) and cross-domain (**41.6 vs 52.8**).
- **ReasoningBank on AWM**: "**AWM fail to provide gains and even degrade**"; scaling rollouts 44.4 → 41.2; and a **retrieved-count curve that peaks at 1**: 39.0 (0 memories) → **49.7 (1) → 46.0 (2) → 45.5 (3) → 44.4 (4)**. **More retrieved memories is strictly worse past k=1** — consistent with Mem^p's retrieval-scaling plateau in the main report.
- **[Dynamic Cheatsheet (arXiv 2504.07952)](https://arxiv.org/abs/2504.07952)**: "DC-Cu and DC-RS performed **worse than baseline**" on AIME 2024.
- **[AutoManual (arXiv 2405.16247)](https://arxiv.org/abs/2405.16247)**: removing the "Type" attribute **86.2% → 74.6%**; "plain experiences without inducing rules will lead to **Path Dependency**."
- **[AgentOptimizer (arXiv 2402.11359, ICML 2024)](https://arxiv.org/abs/2402.11359)**: updates "**may cause performance degradation**"; a variant "exhibited **worse performance** than the origin GPT-4+ agent" (MATH 28.8 vs 30.0; 70.0 vs 72.5); batch training **−7.8%**.
- **[CASCADE (arXiv 2512.23880)](https://arxiv.org/abs/2512.23880)**: "**GPT-4.1**… exhibits optimal performance in the **absence** of continuous learning… may act as **extraneous interference**."
- **[SkillOps (arXiv 2605.13716)](https://arxiv.org/abs/2605.13716)**: "**self-repairing agents may conflict with external maintenance**" (SkillWeaver tokens +0.50%/+0.48% at library 1000/2000); its own stated limitation is missing "**complex skill conflicts**."

### G7. The same phenomenon at the weight level (independent corroboration)

- **[TRACE (arXiv 2310.06762)](https://arxiv.org/abs/2310.06762)**: LLaMA-2-7B-Chat **LoRASeqFT 38.9 → 12.7 (−45.7%)**; general-ability GSM **26.08 → 3.49**. "**Larger models… show a more pronounced forgetting.**"
- **[SEEKR (arXiv 2411.06171, EMNLP 2024)](https://arxiv.org/abs/2411.06171)**: SuperNI **O-LoRA 30.07 (−24.47) / 26.70 (−33.82)**.
- **[Text-to-Text Multi-Task Task Conflict (Findings EMNLP 2022)](https://aclanthology.org/2022.findings-emnlp.206/)**: GLUE 78.06 → 76.20 (−1.86), CoLA **−5.93**; DecaNLP Seq2SQL −3.03.
- **[Instruction Vector (arXiv 2406.12227)](https://arxiv.org/abs/2406.12227)**: general instruction accuracy **−10.24**; last-task Spanish **65% → 1%**.

---

## Part H — Consolidated NOT FOUND (this addendum)

- **ExpeL reports NO negative or zero cross-domain transfer** — HotpotQA→FEVER is strictly positive (58/63/65/70). Its negatives are reflections hurting insight extraction (32.0 → 29.0, blamed on reflection hallucinations) and random retrieval being near-baseline (42.5 vs 59.0).
- **The Voyager w/o-skill-library item-count delta is not printed** (Fig. 9 is a curve only) — use the tech-tree numbers (A2).
- **No verified "skill conflict" benchmark exists** (a GitHub mirror `lawrence3699/skill-conflict-benchmark` returned HTTP 405). G3 is the nearest controlled result.
- **A dedicated Reflexion replication-failure paper: NOT FOUND.** Use Reflexion's own MBPP 0.80 → 0.77 and starchat 0.26 → 0.26.
- **A paper titled "Self-Refine does not work": NOT FOUND.**
- **Olausson et al.'s pass@1 with/without self-repair table: does not exist.** Its results are pass-rate-vs-sample-budget curves; printed: gains "are often modest, vary a lot between subsets of the data, and are **sometimes not present at all**." GPT-4/APPS: 10 initial + 1 repair = **1.05×** pass@20, but 2 initial + 10 repairs = **0.97×** pass@22. Repair success rate: APPS GPT-4 **10.8%**, CodeLlama **1.1%**; HumanEval GPT-4 **49.6%**, CodeLlama **9.1%**. GPT-4 feedback vs human: **33.30% vs 52.60%**; Competition tier **3.67% vs 14.67%**; GPT-4 feedback inaccurate in **32/80** cases vs 7/80 for humans. — [arXiv 2306.09896](https://arxiv.org/abs/2306.09896)
- **Generative Agents retrieval-component ablation: does not exist** (B6).
- **"Lingua" and "OpenContinual" could not be matched to primary sources — do not cite.**
- **arXiv 2504.01928 and 2604.12007 could not be confirmed** (A1).
- **An aggregate "% of retrieved skills actually used"**: NOT FOUND (D6).

---

## Part I — What this means for the extraction layer

Ranked by strength of evidence:

1. **Gate on measured interventional effect, never on plausibility.** Raw-Experience: plausibility rubric **−0.59pp** (worse in 6 of 9 cells), validated rubric **+1.55pp**. SkillGen selects by net interventional effect including induced regressions. This is the single most actionable finding in the review.
2. **Expect the *near-miss* to be the dangerous memory, not the obviously-irrelevant one.** Power of Noise: unrelated docs help (+35% in the fill-the-context regime); related-but-answer-free docs take Llama2 from 0.5642 → 0.2413. Combined with the skill-similarity danger band **[0.55, 0.75)**, your retriever should be *suspicious of medium-similarity skills*, not low-similarity ones.
3. **Assume retrieval will not fire unless you force it.** Only 49% of Claude trajectories load all available curated skills; 16.3% without curated skills; two models fall below their no-skill baseline; one vendor issue reports **0/3 trigger rate across 144 queries** and was closed as `not planned`; a pre-seeded connected store got **zero reads in 114 turns**. Instrument load-rate *and* utility separately.
4. **Retrieve k=1, not k=5.** ReasoningBank's retrieved-count curve peaks at 1 (49.7 → 44.4 by k=4); Mem^p plateaus then declines; E1 shows Mem0/MemOS exactly equal to no-memory on 3 of 4 backbones; MemSyco-Bench shows memory *reduces* accuracy 13–19pp while roughly doubling sycophancy.
5. **Weight memory-construction failures as first-class.** MINTEval: memory-construction failures **41.7%** vs answering-stage **25.2%**, and an **insertion bias of 76.8%** (systems add rather than update/delete). Combined with TEPA (polluted memory 0.210 vs no memory 0.309) and VaG's finding that **pre-commit gating is structurally necessary** because lineage contamination is irreversible — your extractor's *rejection* path is as important as its generation path.
6. **Do not benchmark on short-context tasks.** Anatomy of Agentic Memory: a benchmark only evaluates memory when Δ = Score_MAG − Score_FullContext ≫ 0; HotpotQA (~1k tok) is high-risk, LoCoMo (~20k) moderate. MemGym: frontier models score **0.70–0.85 from pretraining alone** on "memory-intensive" settings.
7. **Model scale cuts both ways.** EvolveR: teacher-distilled experience *helps* at 0.5B but *hurts* at 3B. MetaClaw: weaker backbones gain more. Evo-Memory: Mem0/MemOS equal baseline on 3 of 4 backbones. If you tune on a small model you will over-estimate the value of your layer.

---

### Sources added in this addendum

[Lost in the Middle](https://arxiv.org/abs/2307.03172) · [RAG Robust to Irrelevant Context](https://arxiv.org/abs/2310.01558) · [The Power of Noise](https://arxiv.org/abs/2401.14887) · [Distracted by Irrelevant Context](https://arxiv.org/abs/2302.00093) · [Context Rot](https://research.trychroma.com/context-rot) · [Lost in the Noise](https://arxiv.org/abs/2601.07226) · [TEPA](https://arxiv.org/abs/2608.07429) · [When Stored Evidence Stops Being Usable](https://arxiv.org/abs/2605.07313) · [Selective Memory Retention](https://arxiv.org/abs/2606.29178) · [MINTEval](https://arxiv.org/abs/2605.18565) · [LongMemEval](https://arxiv.org/abs/2410.10813) · [Memory Curse](https://arxiv.org/abs/2605.08060) · [Generative Agents](https://arxiv.org/abs/2304.03442) · [Do RAG Systems Really Suffer From Positional Bias?](https://arxiv.org/abs/2505.15561) · [LLMs Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798) · [Sample More, Reflect Less](https://arxiv.org/abs/2607.28576) · [Honest Lying](https://arxiv.org/abs/2605.29463) · [Self-Refine](https://arxiv.org/abs/2303.17651) · [Kamoi et al. TACL 2024](https://aclanthology.org/2024.tacl-1.78/) · [Self-[In]Correct](https://arxiv.org/abs/2404.04298) · [One Step Forward, Two Steps Back](https://iclr.cc/virtual/2026/10014641) · [LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Panickssery et al.](https://arxiv.org/abs/2404.13076) · [Is Self-Repair a Silver Bullet?](https://arxiv.org/abs/2306.09896) · [How Well Do Agentic Skills Work in the Wild](https://arxiv.org/abs/2604.04323) · [Skill Retrieval Augmentation](https://arxiv.org/abs/2604.24594) · [Delivery-Not-Storage](https://arxiv.org/abs/2607.20972) · [From Registry to Repository](https://arxiv.org/abs/2607.00911) · [SkillsVote](https://arxiv.org/abs/2605.18401) · [Evo-Memory](https://arxiv.org/abs/2511.20857) · [MemoryLake](https://arxiv.org/abs/2608.13883) · [MemDelta](https://arxiv.org/abs/2606.29914) · [Mem0](https://arxiv.org/abs/2504.19413) · [MemoryAgentBench ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/fd1eff9dd295df50a41f2521942fa31d-Abstract-Conference.html) · [Zep analysis](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) · [MemSyco-Bench](https://arxiv.org/abs/2607.01071) · [Anatomy of Agentic Memory](https://arxiv.org/abs/2602.19320) · [SWE-ABS](https://arxiv.org/abs/2603.00520) · [SWE-Bench memory shortcut](https://arxiv.org/abs/2512.10218) · [SWE-Bench-Pro leakage](https://arxiv.org/abs/2606.17454) · [MemGym](https://arxiv.org/abs/2605.20833) · [Raw Experience to Skill Consumption](https://arxiv.org/abs/2605.23899) · [PATH-Bench](https://arxiv.org/abs/2608.01149) · [Strategy Genes](https://arxiv.org/abs/2604.15097) · [Scaling Laws of Skills](https://arxiv.org/abs/2605.16508) · [Memory Transfer Learning](https://arxiv.org/abs/2604.14004) · [Do Agent Optimizers Compound?](https://arxiv.org/abs/2607.14004) · [EvolveR](https://arxiv.org/abs/2510.16079) · [Dynamic Cheatsheet](https://arxiv.org/abs/2504.07952) · [AutoManual](https://arxiv.org/abs/2405.16247) · [AgentOptimizer](https://arxiv.org/abs/2402.11359) · [CASCADE](https://arxiv.org/abs/2512.23880) · [SkillOps](https://arxiv.org/abs/2605.13716) · [TRACE](https://arxiv.org/abs/2310.06762) · [SEEKR](https://arxiv.org/abs/2411.06171) · [Task Conflict EMNLP 2022](https://aclanthology.org/2022.findings-emnlp.206/) · [Instruction Vector](https://arxiv.org/abs/2406.12227) · [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Anthropic tools](https://www.anthropic.com/engineering/writing-tools-for-agents) · [OpenAI sycophancy](https://openai.com/index/expanding-on-sycophancy/) · [Cognition Devin](https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges) · [Cognition multi-agents](https://cognition.com/blog/dont-build-multi-agents) · [Vercel tools](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) · [Vercel embeddings](https://vercel.com/blog/build-knowledge-agents-without-embeddings) · [Cursor semantic search](https://cursor.com/blog/semsearch) · [Claude Code Skills docs](https://code.claude.com/docs/en/skills) · [anthropics/skills#556](https://github.com/anthropics/skills/issues/556) · [anthropics/claude-code#36570](https://github.com/anthropics/claude-code/issues/36570) · [openai/codex#34321](https://github.com/openai/codex/issues/34321) · [Terminal-Bench](https://arxiv.org/abs/2601.11868)
