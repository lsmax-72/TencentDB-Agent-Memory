# Benchmarks for Evaluating Agent Memory

**Audience:** engineers building an agent memory layer.
**Question we answer:** what is actually measurable today, and does *any* benchmark measure **transfer** (a memory/skill learned on task A improving task B) rather than recall?

**Sourcing convention used throughout.** Claims tagged **[primary]** were taken from the paper's own arXiv abstract/HTML, the project's own README, or the project site, which I fetched directly. Claims tagged **[secondhand]** come from third-party write-ups, audits, or leaderboards. Every arXiv ID below was confirmed by fetching its `arxiv.org/abs/...` page; where an ID did not resolve to the expected paper I say so explicitly.

---

## 1. LongMemEval

- **Who/when:** Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu (UCLA + Tencent AI Lab Seattle). Submitted 14 Oct 2024, revised 4 Mar 2025; **ICLR 2025**. **[primary]**
- **Paper:** [arXiv:2410.10813](https://arxiv.org/abs/2410.10813) · **Repo:** [github.com/xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval) · **Data:** [HF `xiaowu0162/longmemeval-cleaned`](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)

**What it measures.** Five core long-term memory abilities, evaluated with **500 questions**: information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and abstention. **[primary]** These map onto seven concrete question types: `single-session-user`, `single-session-assistant`, `single-session-preference`, `multi-session`, `knowledge-update`, `temporal-reasoning`, and abstention (flagged by an `_abs` question-id suffix). **[primary]** — [LongMemEval README](https://raw.githubusercontent.com/xiaowu0162/LongMemEval/main/README.md)

**Design.** Questions were curated from an ontology of **164 user attributes** in five categories (lifestyle, belongings, life events, situation context, demographics); an LLM proposed seed Q/A pairs which **human experts then filtered and rewrote**, decomposing each answer into evidence statements with optional timestamps. Each evidence statement was embedded into a task-oriented "evidence session" via self-chat, with the user conveying the fact *indirectly* (e.g. asking about car insurance rather than announcing a purchase), then human-screened and edited. **[primary]** — [paper §3.2](https://arxiv.org/html/2410.10813v2)

The **"needle" design**: following the needle-in-a-haystack idea but harder, the harness samples unrelated sessions (self-chat on non-conflicting attributes, plus ShareGPT and UltraChat), inserts the evidence sessions in the middle, and assigns plausible timestamps. Histories are **freely scalable**; two standard settings are published — **LongMemEval_S ≈ 115k tokens, ~40 sessions**, and **LongMemEval_M ≈ 500 sessions (~1.5M tokens)**. There is also an *oracle* variant containing only evidence sessions. **[primary]**

**Retrieval-vs-long-context setup.** The paper frames memory as three stages — **indexing, retrieval, reading** — with four control points (value, key, query, reading strategy). Findings: **round**-level granularity beats session-level; compressing to individual facts improves multi-session reasoning but hurts overall; key expansion with extracted user facts improves recall@k by **9.4%** and QA accuracy by **5.4%**; time-aware query expansion improves temporal-reasoning recall by **6.8–11.3%**; Chain-of-Note plus structured formatting improves QA by up to **10 absolute points**. **[primary]**

**Judging and metrics.** QA is scored by an **LLM judge** (`gpt-4o-2024-08-06`) with **>97% agreement with human experts** in the authors' meta-evaluation. Because answer-location labels are annotated, intermediate **Recall@k and NDCG@k** are also computed, and abstention instances are skipped for retrieval metrics. **[primary]** — [README](https://raw.githubusercontent.com/xiaowu0162/LongMemEval/main/README.md)

**Headline results.** Long-context LLMs show a **30–60% performance drop** on LongMemEval_S; a human pilot on commercial systems found ChatGPT+GPT-4o at **0.5773** and GPT-4o-mini at **0.7113** versus **0.9184** for offline reading with the full history. **[primary]**

**Does it separate memory-system quality from model quality?** Partially. The harness fixes the reader and varies the memory pipeline, and it reports retrieval metrics separately from end-to-end QA, which is the right structure. But end-to-end accuracy still confounds reader strength with memory quality, and the LLM judge is a moving part.

**Limitations / criticism.** MemoryAgentBench criticizes LongMemEval for **"limited topical diversity and less realistic interaction patterns"** **[primary]** — [arXiv:2507.05257](https://arxiv.org/html/2507.05257v4). The authors themselves **re-cleaned the histories in Sept 2025 "to prevent interference on answer correctness"**, which is a tacit admission of earlier contamination in the haystack. **[primary]** — [README](https://raw.githubusercontent.com/xiaowu0162/LongMemEval/main/README.md)

**Successor:** **LongMemEval-V2** ([arXiv:2605.12493](https://arxiv.org/abs/2605.12493), May 2026) — see §4.

---

## 2. LoCoMo

- **Who/when:** Adyasha Maharana, Dong-Ho Lee, Sergey Tulyakov, Mohit Bansal, Francesco Barbieri, Yuwei Fang (UNC / USC / **Snap Inc.**). 27 Feb 2024. **[primary]**
- **Paper:** [arXiv:2402.17753](https://arxiv.org/abs/2402.17753) · **Site:** [snap-research.github.io/locomo](https://snap-research.github.io/locomo/) · **Repo:** [github.com/snap-research/locomo](https://github.com/snap-research/locomo)

**What it measures.** Memory over **very long-term multi-session dialogue**. It is a *recall + long-range coherence* benchmark: question answering, event-graph summarization, and multi-modal dialogue generation. **[primary]**

**Design.** A machine–human pipeline: two LLM agents are seeded with personas and **temporal event graphs** (up to 25 causally-linked events over 6–12 months), converse with a reflect-and-respond memory module, and can share/react to images. Human annotators then fixed long-range consistency (editing **~15% of turns**, removing/substituting **~19% of images**). Result: **50 conversations**, averaging **304.9 turns**, **19.3 sessions**, and **9,209.2 tokens**, spanning months. **[primary]** — [paper §3, Table 1](https://ar5iv.labs.arxiv.org/html/2402.17753)

**Question types and metrics (important correction).** The five QA reasoning types are **single-hop, multi-hop, temporal, open-domain (commonsense/world knowledge), and adversarial**. The original **QA metric is F1** ("F1 partial match", per category and overall). **[primary]** However, the common claim that LoCoMo is scored with "F1, BLEU, ROUGE" is **not accurate for the original paper**: for event summarization the authors explicitly reject BLEU and ROUGE — *"focus on lexical similarity … not meeting our needs"* — and instead use **FactScore**, reporting precision/recall/F1 over atomic facts. The multimodal dialogue task uses **MMRelevance** "in addition to other NLG metrics". **[primary]** BLEU/ROUGE do appear in *downstream* reimplementations. Human ceiling on QA is **87.9 overall** (F1). **[primary]**

**How Mem0 and Zep reported on it.**
- **Mem0** ([arXiv:2504.19413](https://arxiv.org/abs/2504.19413), Apr 2025) evaluated on **LOCOMO only**, replacing F1 with an **LLM-as-a-Judge "J" score** (GPT-4o). Its abstract claims **26% relative improvement in the LLM-as-a-Judge metric over OpenAI**, ~**2% higher overall** for graph memory vs. base, **91% lower p95 latency** and **>90% token cost savings** versus full-context. **[primary]** Published table values (Mem0 **66.88%**, Mem0g **68.44%**, full-context **72.9%**, OpenAI **52.90%**) are reported by a third-party analysis of the paper and are **[secondhand]**; note the *full-context baseline beat both Mem0 variants*.
- **Zep** ([arXiv:2501.13956](https://arxiv.org/abs/2501.13956), Jan 2025) reports **DMR 94.8% vs MemGPT 93.4%** and, on **LongMemEval**, accuracy improvements **up to 18.5%** with **90% lower latency** — explicitly arguing LongMemEval is the better benchmark. **[primary]**
- Zep then published a critique titled *"Is Mem0 Really SOTA in Agent Memory?"* **[secondhand]** — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) ([mirror](https://raw.githubusercontent.com/lhl/agentic-memory/refs/heads/main/benchmarks/sources/zep-blog-lies-damn-lies.md)) — alleging a mis-implemented Zep baseline, a full-context baseline that beats Mem0's best, missing knowledge-update questions, and data-quality issues. Zep's corrected score was **75.14% ± 0.17** over 10 runs.

**Criticism, contamination and reproducibility (this is the big one).** An independent audit repo, **[dial481/locomo-audit](https://github.com/dial481/locomo-audit)**, reports **[secondhand]**:
- **99 of 1,540 questions (6.4%) have wrong gold answers**, implying a **theoretical ceiling of 93.57%**;
- **62.81% of intentionally wrong "vague-but-topical" answers are accepted by the LLM judge** (judge leniency);
- **Category-5 (adversarial) questions — 446 items, 22.5% of the dataset — are effectively unevaluated**; the original multiple-choice formatter is broken on 444/446 of them;
- EverMemOS claimed **92.32%** but a third party reproduced **38.38%** ([EverMemOS#73](https://github.com/EverMind-AI/EverMemOS/issues/73));
- multiple **Mem0 reproducibility failures** ([mem0ai/mem0#3944](https://github.com/mem0ai/mem0/issues/3944), [#2800](https://github.com/mem0ai/mem0/issues/2800), [#4003](https://github.com/mem0ai/mem0/issues/4003));
- Zep acknowledged and corrected a **Category-5 scoring bug** that had inflated its score ([getzep/zep-papers#5](https://github.com/getzep/zep-papers/issues/5)).

Also **[secondhand]**: per-category sample sizes are badly unbalanced (96–841), so most adjacent-pair category comparisons are statistically indistinguishable at 95% CI, and only Mem0 documents a multi-run methodology. **Bottom line for your team: LoCoMo is cheap, widely reported, and currently not a reliable ranking instrument.**

---

## 3. MemoryAgentBench

- **Who/when:** Yuanzhe Hu, Yu Wang, Julian McAuley (UC San Diego). v1 Jul 2025, **v4 Jun 2026; ICLR 2026**. **[primary]**
- **Paper:** [arXiv:2507.05257](https://arxiv.org/abs/2507.05257) · **Repo:** [github.com/HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) · **Data:** [HF `ai-hyz/MemoryAgentBench`](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench)

**Exact title (your "or similar" was over-cautious):** *"Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions."* The ID **2507.05257 is correct**. **[primary]**

**The four competencies — and a version discrepancy you should know about.** The **v4 paper** enumerates: **accurate retrieval, test-time learning, long-range understanding, and selective forgetting** **[primary]** — [v4 HTML](https://arxiv.org/html/2507.05257v4). But the **earlier ar5iv version and the current repo README both say "conflict resolution"** instead of selective forgetting **[primary]** — [ar5iv](https://ar5iv.labs.arxiv.org/html/2507.05257), [README](https://raw.githubusercontent.com/HUST-AI-HYZ/MemoryAgentBench/main/README.md). So your guessed "conflict resolution" matches the preprint and the code; the camera-ready renamed it. The underlying dataset (`FactConsolidation`) is unchanged, and the repo's metric table still labels the category "Conflict Resolution".

**Datasets bundled.** 2,071 questions total across: **RULER-QA, RULER-NIAH-MQ, ∞Bench-QA, LongMemEval (S\*)** and the new **EventQA** for accurate retrieval; **BANKING77, CLINC150, NLU, TREC-Coarse/Fine, REDIAL movie recommendation** for test-time learning; **∞Bench-Sum** for long-range understanding; and the new **FactConsolidation-SH/MH** for conflict resolution/selective forgetting. Context depths run **103K–1.44M tokens**. **[primary]**

**Key design finding (incremental vs static).** The paper's premise is that static long-context datasets "are not directly applicable to evaluating memory agents," because memory is a *compressed, distilled* representation and agents "process context incrementally." So they **segment long-context datasets into chunks and feed them one at a time**, then query. They also adopt "inject once, query multiple times" for efficiency. **[primary]**

**Results.** The results table shows a clean division of labour: RAG agents win accurate retrieval; **long-context models win test-time learning and long-range understanding**; **all methods fail conflict resolution** (multi-hop accuracy **at most 6%**); and commercial memory agents do poorly — e.g. **Mem0 scores 28.0 on RULER-QA, 4.8 on NIAH-MQ, 3.4 on MCC, 0.8 on ∞Bench-Sum**. The authors attribute this to fact-extraction discarding content and single-pass retrieval. **[primary]** — [Table 2](https://ar5iv.labs.arxiv.org/html/2507.05257)

**Separation of memory vs model quality.** Reasonably good: all RAG and commercial agents share a **GPT-4o-mini** backbone and the long-context rows provide a same-family reference, so the harness is more controlled than most. It is still not a pure memory-score decomposition.

---

## 4. The 2025–2026 wave

All IDs below were verified by fetching their abs pages unless marked otherwise.

| Benchmark | ID / URL | Measures | Notes |
|---|---|---|---|
| **HaluMem** | [2511.03506](https://arxiv.org/abs/2511.03506) | **Operation-level hallucination**: memory extraction, memory updating, memory QA | ~15k memory points, ~3.5k questions, 1.5k–2.6k turns/user, >1M tokens. Finds hallucinations *accumulate during extraction/update* and propagate to QA. **[primary]** |
| **MemBench** | [2506.21605](https://arxiv.org/abs/2506.21605) | Factual vs **reflective** memory; participation vs observation scenarios; effectiveness, efficiency, capacity | ACL 2025 Findings. **[primary]** |
| **MemoryBench** | [2510.17281](https://arxiv.org/abs/2510.17281) | **Continual learning from accumulated user feedback** across domains/languages/tasks | Explicitly targets learning from *feedback in service time*, not homogeneous long-form reading. **[primary]** |
| **PersonaMem** | [2504.14225](https://arxiv.org/abs/2504.14225) | Dynamic user profiling + personalized response; profile evolution | COLM 2025; 180+ profiles, up to 60 sessions; frontier models ~**50%**. **[primary]** |
| **PersonaMem-v2** | [2512.06688](https://arxiv.org/abs/2512.06688) | Implicit persona learning; agentic memory | 1,000 interactions, 300+ scenarios, 20k+ preferences; frontier LLMs **37–48%**; agentic memory **55%** with 16× fewer tokens. **[primary]** |
| **PrefEval** | [2502.09597](https://arxiv.org/abs/2502.09597) | Infer, memorize, adhere to user preferences | ICLR 2025 oral; 3,000 pairs, 20 topics, contexts to **100k tokens**. ⚠️ **The ID you suggested (2505.15347) is wrong** — that is *FlowKV*. **[primary]** |
| **StructMemEval** | [2602.11243](https://arxiv.org/abs/2602.11243) | **Memory organization**, not recall: ledgers, to-do lists, trees | Finds RAG LLMs struggle; memory agents succeed *only when prompted how to organize*. **[primary]** |
| **MemoryArena** | [2602.16313](https://arxiv.org/abs/2602.16313) | Memory **used to guide action** in interdependent multi-session agentic tasks | ICML 2026. Web navigation, preference-constrained planning, progressive search, formal reasoning. Agents near-saturated on LoCoMo perform poorly here. **[primary]** — [site](https://memoryarena.github.io/) |
| **MemGym** | [2605.20833](https://arxiv.org/abs/2605.20833) | Agentic memory across tool-use dialogue (τ²-bench), deep research, coding (SWE-Gym), computer use (WebArena) | Explicitly reports **"memory-isolated scores that decouple memory performance from reasoning, retrieval, and tool-use ability."** **[primary]** |
| **LongMemEval-V2** | [2605.12493](https://arxiv.org/abs/2605.12493) | 5 abilities for **web agents**: static state recall, dynamic state tracking, **workflow knowledge**, **environment gotchas**, premise awareness | 451 questions, up to 500 trajectories / **115M tokens**. AgentRunbook-C **72.5%** vs best RAG **48.5%**; leaderboard scores an accuracy–latency frontier. **[primary]** |
| **MemGAS** | [2505.19549](https://arxiv.org/abs/2505.19549) | Multi-granularity memory association/selection (a *method*, evaluated on 4 memory benchmarks, incl. LoCoMo) | Not a benchmark itself — I list it because it is commonly miscited as one. **[primary]** |
| **MemAgent** | [2507.02259](https://arxiv.org/abs/2507.02259) | RL-trained segmented reading with overwrite memory; long-context extrapolation | ICLR 2026 oral. 8K→3.5M QA with <5% loss; 95%+ on 512K RULER. **[primary]** |
| **Memory-R1** | [2508.19828](https://arxiv.org/abs/2508.19828) | RL-trained ADD/UPDATE/DELETE/NOOP memory manager + answer agent | 152 training QA pairs; evaluated on **LoCoMo, MSC, LongMemEval**; 3B–14B. **[primary]** |
| **AgentMemoryBench** | [OpenReview MSXbrNExax](https://iclr.cc/virtual/2026/10012519) (ICLR 2026 Lifelong Agents workshop) | Five modes: **improvement, retention, forgetting, generalization, knowledge-conflict resolution** | Unifies system + personal memory; code-centric tool use, embodied, web, long-horizon dialogue; interleaved task streams. **[primary]** (venue page; OpenReview full text behind a browser check) |

**Caveat on "MemoryBench"/"MemBench".** These are **two different papers** (2510.17281 and 2506.21605). Conflating them is a common error in secondary write-ups.

**Vendor (Anthropic / OpenAI / Google) memory evals.** I could **not verify any rigorous, published memory benchmark authored by these vendors** from primary sources. What exists publicly is product documentation and third-party benchmarking of vendor features rather than a vendor-run benchmark with released data and methodology. Secondary sources reference "OpenAI Codex Memories" and Anthropic memory/context-management tooling, but I found no primary evaluation harness, dataset, or results table I can cite. Treat any "vendor X reports Y on memory" claim as unverified until you can open the harness. **[unverified]**

**Non-memory benchmarks you listed, for completeness (verified).** **GAIA** ([arXiv:2311.12983](https://arxiv.org/abs/2311.12983)) is a general assistant benchmark — 466 questions requiring reasoning, multi-modality, browsing and tool use; humans 92% vs GPT-4+plugins 15%. **τ-bench** ([arXiv:2406.12045](https://arxiv.org/abs/2406.12045)) tests tool-agent-user interaction against domain policies, scored by final database state, with a **pass^k** reliability metric. **SWE-bench** ([arXiv:2310.06770](https://arxiv.org/abs/2310.06770)) is 2,294 real GitHub issues across 12 Python repos, solved by patching the repo so hidden tests pass. **None of the three is a memory benchmark, and none has a cross-episode memory-transfer protocol** — each task is solved in isolation. **[primary]** I could **not verify** claims about SWE-bench Verified's exact size, "SWE-bench Illusion", or SWE-bench+ contamination critiques from primary sources, so I make no claims about them.

---

## 5. The benchmarks that actually test transfer

Five lines of work go beyond recall. These are the ones to read.

**AWM — Agent Workflow Memory** ([arXiv:2409.07429](https://arxiv.org/abs/2409.07429), Wang, Mao, Fried, Neubig, Sep 2024). **[primary]** This is the clearest *transfer harness* predating the memory wave. AWM induces **reusable workflows** ("commonly reused routines") from training examples offline, or from test queries on the fly, and selectively injects workflows to guide generation. The protocol is explicitly transfer-shaped: **"online AWM robustly generalizes in cross-task, website, and domain evaluations, surpassing baselines from 8.9 to 14.0 absolute points as train-test task distribution gaps widen."** Evaluated on **Mind2Web and WebArena** (1,000+ tasks, 200+ domains), improving relative success rate by **24.6%** and **51.1%**. This measures exactly category (c): a procedure learned on task A improves task B.

**ExpeL — LLM Agents Are Experiential Learners** ([arXiv:2308.10144](https://arxiv.org/abs/2308.10144), Zhao et al., **AAAI-24**). **[primary]** ExpeL "autonomously gathers experiences and extracts knowledge using natural language from a collection of training tasks," then **recalls extracted insights and past experiences at inference**. The abstract reports "a consistent enhancement in its performance as it accumulates experiences" and explicitly "explore[s] the emerging capabilities and **transfer learning potential**." The transfer protocol is train-tasks → held-out test-tasks, with insights operating as a natural-language skill/lesson library. ⚠️ I could **not verify the exact task-domain list** from the abstract alone; treat specific domain claims in secondary sources with care. I also could not verify a numeric transfer-gain figure from primary text.

**AFTER — Managing Procedural Memory in LLM Agents** ([arXiv:2606.23127](https://arxiv.org/abs/2606.23127), Jun 2026). **[primary]** The most explicit transfer benchmark to date, and the single most useful reference for your question. **382 realistic enterprise tasks, six professional roles, 22 procedural skills**, with **controlled evaluation settings for local improvement, cross-task transfer, cross-role transfer, and cross-model generalization**. Findings: one refinement round improves aggregate performance **3.7–6.7 points**; skills evolved from **diverse multi-model traces hit 73.1% cross-model test accuracy**, beating all single-model trace sources; and **some skills transfer broadly while others become specialized to role-specific workflows and lose effectiveness under transfer**.

**AgentCL — Toward Rigorous Evaluation of Continual Learning in Language Agents** ([arXiv:2606.02461](https://arxiv.org/abs/2606.02461), Jun 2026). **[primary]** AgentCL builds **"compositional streams where earlier sub-solutions, evidence, or workflows are intentionally reusable in later tasks,"** contrasted against **naive streams where reusability is not guaranteed**, and defines **metrics for transfer gains**. Its companion method **MemProbe** stores "interactions, insights, and skills" while filtering unreliable experiences. The critical result for benchmark designers: **"naive streams offer limited ability to distinguish memory designs, whereas controlled streams more clearly distinguish their plasticity,"** and **"naive and held-out settings often yield limited gains and can expose memory-induced degradation."** In other words, if you evaluate transfer without deliberately constructing reusable structure, you will mostly measure noise.

**AgentMemoryBench** ([ICLR 2026 Lifelong Agents workshop](https://iclr.cc/virtual/2026/10012519), Ma et al.). **[primary]** Standardizes **five modes — improvement, retention, forgetting, generalization, and knowledge-conflict resolution** — over interleaved task streams spanning code-centric tool use, embodied tasks, web interaction, and long-horizon dialogue, unifying system and personal memory. "Generalization" is the transfer-adjacent axis. Note this is a **workshop paper**; the OpenReview full text is behind a browser check, so I verified only the venue abstract page.

**Two supporting studies worth knowing.**
- **"When Continual Learning Moves to Memory"** ([arXiv:2604.27003](https://arxiv.org/abs/2604.27003), Apr 2026). **[primary]** Sequential-task experiments in **ALFWorld and BabyAI** with a (key, value) framework disentangling representation from retrieval organization. Findings: **abstract procedural memories transfer more reliably than detailed trajectories**; **negative transfer disproportionately harms hard cases**; and **finer-grained organization is not universally beneficial — designs with strong forward transfer can simultaneously induce severe forgetting**.
- **MemoryArena** ([arXiv:2602.16313](https://arxiv.org/abs/2602.16313), Feb 2026). **[primary]** Human-crafted tasks with **explicitly interdependent subtasks**, where "agents must learn from earlier actions and feedback by distilling experiences into memory, and subsequently use that memory to guide later actions." Shows agents near-saturated on LoCoMo perform poorly here.

---

## 6. Do any measure transfer?

**Short answer: yes — but only a handful, they are recent, and almost none of the popular memory benchmarks do.**

The three categories you asked me to distinguish:

**(a) Recall of stored information.** LongMemEval (information extraction, multi-session, temporal), LoCoMo (single-hop, multi-hop, temporal, open-domain), MemBench, PersonaMem/PersonaMem-v2, PrefEval, HaluMem's QA stage, MemoryBench, and MemoryAgentBench's Accurate Retrieval and Long-Range Understanding tracks. These ask "can you find and use what was stored?" Category (a). Even where they are hard, they are still retrieval + reading-comprehension problems — MemoryAgentBench's own results show RAG agents win this category **[primary]**.

**(b) Update / conflict handling.** LongMemEval knowledge-update; MemoryAgentBench's FactConsolidation (labelled conflict resolution in the repo/earlier versions, selective forgetting in v4); HaluMem's extraction/updating stages; Mem0's ADD/UPDATE/DELETE/NOOP; Memory-R1's learned memory manager. These ask "do you correctly overwrite stale facts?" Category (b). Note the failure is severe and well-documented: **"all methods fail on the multi-hop situation (with achieving at most 6% accuracy)"** **[primary]** — [MemoryAgentBench Table 2](https://ar5iv.labs.arxiv.org/html/2507.05257).

**(c) Does a learned procedure/skill/memory from task A transfer to task B?** This is genuinely measured only by: **AFTER** (cross-task, cross-role, cross-model transfer of 22 procedural skills) **[primary]**; **AgentCL** (compositional streams with explicit transfer-gain metrics) **[primary]**; **AgentMemoryBench** (generalization mode) **[primary]**; **AWM** (cross-task/website/domain, with gains growing as the distribution gap widens) **[primary]**; **ExpeL** (insights from train tasks applied to held-out tasks) **[primary]**; plus the diagnostic studies **2604.27003** (forward/negative transfer in ALFWorld/BabyAI) and **MemoryArena**, and — partially, because it tests recurring-task *knowledge* rather than behavioural transfer — **LongMemEval-V2's "workflow knowledge" and "environment gotchas"** abilities **[primary]**.

**Flag explicitly:** the flagship benchmarks your team is most likely to be asked about — **LongMemEval, LoCoMo, MemBench/MemoryBench, PersonaMem, PrefEval, HaluMem** — are **category (a)/(b) and measure essentially zero transfer.** They are strong on recall, and LoCoMo is currently unreliable. The only widely-cited pre-2025 transfer evidence is **AWM and ExpeL**, which are *methods papers with transfer ablations*, not benchmarks with leaderboards. The purpose-built transfer benchmarks are all **2026**: AFTER, AgentCL, AgentMemoryBench.

**Two design lessons** worth carrying into your own harness, both from primary sources: (1) AgentCL shows **naive task streams cannot distinguish memory designs — you must construct reusability deliberately**; (2) 2604.27003 shows **transfer is not monotonic** — more organization can buy forward transfer at the cost of catastrophic forgetting, and negative transfer hurts hardest on the hard cases. So a transfer metric must report **forward transfer, retention, and negative-transfer deltas separately**, ideally against a no-memory ablation on identical held-out tasks.

---

## Summary table

| Benchmark | Year | Measures | Metrics | Transfer? | Repo |
|---|---|---|---|---|---|
| [LongMemEval](https://arxiv.org/abs/2410.10813) | 2024 (ICLR'25) | Recall: extraction, multi-session, temporal, **knowledge update**, abstention | LLM-judge accuracy (>97% human agreement), Recall@k, NDCG@k | ❌ (a) + (b) updates | [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval) |
| [LoCoMo](https://arxiv.org/abs/2402.17753) | 2024 | Very-long dialogue recall; event-graph summarization; multimodal dialogue | QA **F1**; summarization **FactScore** P/R/F1; **MMRelevance**; downstream **J** (LLM-judge) | ❌ (a) | [snap-research/locomo](https://github.com/snap-research/locomo) |
| [MemoryAgentBench](https://arxiv.org/abs/2507.05257) | 2025 (ICLR'26) | Accurate retrieval, **test-time learning**, long-range understanding, **conflict resolution / selective forgetting** | Per-task accuracy, substring/exact match, Recall@5, LLM-judge, F1 | ⚠️ partial — **TTL is skill acquisition; no A→B held-out protocol** | [HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) |
| [HaluMem](https://arxiv.org/abs/2511.03506) | 2025 | Operation-level hallucination: extraction, update, QA | Stage-wise hallucination/accuracy | ❌ (a)/(b) | — |
| [MemBench](https://arxiv.org/abs/2506.21605) | 2025 (ACL Findings) | Factual + reflective memory, participation/observation | Effectiveness, efficiency, capacity | ❌ (a) | [import-myself/Membench](https://github.com/import-myself/Membench) |
| [MemoryBench](https://arxiv.org/abs/2510.17281) | 2025 | Continual learning from user feedback | Task metrics across domains/languages | ⚠️ continual learning, not A→B skill transfer | [THUIR/MemoryBench](https://github.com/THUIR/MemoryBench) |
| [PersonaMem](https://arxiv.org/abs/2504.14225) / [v2](https://arxiv.org/abs/2512.06688) | 2025 | Dynamic profiling, implicit personalization | Accuracy (frontier ~50%; v2 37–48%) | ❌ (a) | [bowen-upenn/PersonaMem](https://github.com/bowen-upenn/PersonaMem) |
| [PrefEval](https://arxiv.org/abs/2502.09597) | 2025 (ICLR'25 oral) | Infer/memorize/adhere to preferences | Gen + classification; **<10% @10 turns zero-shot** | ❌ (a) | [prefeval.github.io](https://prefeval.github.io/) |
| [StructMemEval](https://arxiv.org/abs/2602.11243) | 2026 | **Memory organization** (ledgers, lists, trees) | Task accuracy | ❌ (structure, not transfer) | — |
| [MemoryArena](https://arxiv.org/abs/2602.16313) | 2026 (ICML) | Memory guiding action in interdependent multi-session tasks | Task success | ✅ (c) — action-level reuse | [ZexueHe/MemoryArena](https://github.com/ZexueHe/MemoryArena) |
| [MemGym](https://arxiv.org/abs/2605.20833) | 2026 | Agentic memory across τ²-bench, deep research, coding, computer use | **Memory-isolated scores** decoupled from reasoning/tool use | ⚠️ isolates memory quality; not framed as A→B transfer | — |
| [LongMemEval-V2](https://arxiv.org/abs/2605.12493) | 2026 | Static/dynamic state, **workflow knowledge**, **environment gotchas**, premise awareness | Accuracy + latency (LAFS frontier); 72.5% best | ⚠️ partial (c) — recurring-task knowledge | [xiaowu0162/LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2) |
| [Memory-R1](https://arxiv.org/abs/2508.19828) | 2025 | RL memory manager (ADD/UPDATE/DELETE/NOOP) | On LoCoMo, MSC, LongMemEval | ❌ (b) | — |
| [MemAgent](https://arxiv.org/abs/2507.02259) | 2025 (ICLR'26 oral) | RL segmented reading w/ overwrite memory | RULER, 3.5M-token QA | ❌ (long-context, not transfer) | — |
| [AgentMemoryBench](https://iclr.cc/virtual/2026/10012519) | 2026 (workshop) | Improvement, retention, forgetting, **generalization**, conflict | Five modes over interleaved streams | ✅ (c) — generalization mode | anonymous.4open.science |
| [AFTER](https://arxiv.org/abs/2606.23127) | 2026 | **Procedural skills: local improvement, cross-task, cross-role, cross-model** | +3.7–6.7 pts; 73.1% cross-model | ✅ **(c) — most explicit** | — |
| [AgentCL](https://arxiv.org/abs/2606.02461) | 2026 | Continual learning, **transfer gains on compositional streams** | Transfer-gain metrics; MemProbe | ✅ **(c) — explicit metrics** | — |
| [AWM](https://arxiv.org/abs/2409.07429) | 2024 | **Workflow induction + reuse** on web navigation | Success rate; +8.9–14.0 pts as gap widens | ✅ (c) | — |
| [ExpeL](https://arxiv.org/abs/2308.10144) | 2023 (AAAI'24) | **Insight/experience extraction + transfer** | Task performance vs. training volume | ✅ (c) | — |
| [GAIA](https://arxiv.org/abs/2311.12983) / [τ-bench](https://arxiv.org/abs/2406.12045) / [SWE-bench](https://arxiv.org/abs/2310.06770) | 2023–24 | Assistant tool use / tool-agent-user / repo issue fixing | Accuracy; pass^k; % resolved | ❌ not memory benchmarks | — |

---

## Bottom line for your team

1. **Recall and update are well covered; transfer is barely covered.** If you want to demonstrate that your memory layer *makes an agent better over time*, LongMemEval and LoCoMo will not show it, and LoCoMo will actively mislead you.
2. **Instrument the three axes separately** — forward transfer, retention/forgetting, and negative transfer — following AgentCL's compositional-stream design and 2604.27003's finding that they trade off.
3. **Use a memory-isolated score** (MemGym's approach) or an explicit no-memory ablation on identical held-out tasks, otherwise you are measuring your reader model.
4. **Prefer round/turn-level granularity and human-curated questions** (LongMemEval's design) over automated haystacks, and budget for an LLM-judge leniency check — LoCoMo's audit shows a judge accepting ~63% of wrong-but-topical answers.

