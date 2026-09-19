# Negative-Results Evidence Base: Agent Memory Evaluation & Reasoning-Memory Learning (2023–2026)

Labels used throughout: **[CLAIM]** = the paper's own reported number; **[INDEP]** = independent / third-party measurement; **[SEC]** = secondary analysis (not primary source — flagged explicitly); **[AUDIT]** = independent audit of a dataset or evaluation pipeline.

---

## 1. Mem0 (arXiv 2504.19413)

### The paper's own claims

**1. The headline claims, verbatim from the abstract.** Mem0 (Chhikara, Khant, Aryan, Singh, Yadav, 2025) claims: "Mem0 achieves 26% relative improvements in the LLM-as-a-Judge metric over OpenAI, while Mem0 with graph memory achieves around 2% higher overall score than the base configuration… Mem0 attains a **91% lower p95 latency** and **saves more than 90% token cost**." — [arXiv:2504.19413](https://arxiv.org/abs/2504.19413) **[CLAIM]**

**2. Mem0's own LOCOMO Table 1 (GPT-4o-mini), per-category J (LLM-as-a-Judge), mean ± 1 sd over 10 runs** — [arXiv:2504.19413v1 HTML, Table 1](https://arxiv.org/html/2504.19413v1) **[CLAIM]**

| Method | Single-Hop J | Multi-Hop J | Open-Domain J | Temporal J |
|---|---|---|---|---|
| **Mem0** | **67.13 ± 0.65** | **51.15 ± 0.31** | 72.93 ± 0.11 | 55.51 ± 0.34 |
| **Mem0g** | 65.71 ± 0.45 | 47.19 ± 0.67 | 75.71 ± 0.21 | **58.13 ± 0.44** |
| OpenAI memory | 63.79 ± 0.46 | 42.92 ± 0.63 | 62.29 ± 0.12 | 21.71 ± 0.20 |
| Zep | 61.70 ± 0.32 | 41.35 ± 0.48 | **76.60 ± 0.13** | 49.31 ± 0.50 |
| LangMem | 62.23 ± 0.75 | 47.92 ± 0.47 | 71.12 ± 0.20 | 23.43 ± 0.39 |
| A-Mem\* (their re-run) | 39.79 ± 0.38 | 18.85 ± 0.31 | 54.05 ± 0.22 | 49.91 ± 0.31 |

Three things buried in Mem0's *own* table undercut the "consistently outperform all existing memory systems" framing **[CLAIM, self-reported contradicting data]**:
- **Zep beats both Mem0 variants on Open-Domain** (76.60 vs 75.71 Mem0g / 72.93 Mem0). The paper concedes: "Zep's J score of 76.60 surpasses Mem0g's 75.71 by just 0.89 percentage points and outperforms Mem0's 72.93 by 3.67 points."
- **Mem0g (graph memory) is *worse* than base Mem0 on Single-Hop (65.71 vs 67.13) and Multi-Hop (47.19 vs 51.15).** The paper: "the addition of graph memory in Mem0g does not provide performance gains here."
- The nominal "26% over OpenAI" rests on OpenAI's Temporal J of **21.71** (vs Mem0 55.51), and Mem0's own prompt for OpenAI gave it "privileged access to all memories rather than only question-relevant ones."

**3. Overall J and the full-context problem.** Mem0's Table 2 overall LOCOMO J is reported as Mem0 **66.88%**, Mem0g **68.44%**, full-context **72.9%**, OpenAI 52.90%. **[SEC]** — from a third-party deep-read of the paper: [somnigraph `research/sources/mem0-paper.md`](https://raw.githubusercontent.com/AlexisOlson/somnigraph/main/research/sources/mem0-paper.md). I could not retrieve Mem0's Table 2 body directly (arXiv HTML truncation), so treat this as secondary.
- **Independent corroboration of the same fact:** Zep's rebuttal states "Tellingly, Mem0's own results show their system being outperformed by a simple full-context baseline (feeding the entire conversation to the LLM), which achieved a J score of **~73%**, compared to Mem0's best score of **~68%**." — [Zep blog, "Lies, Damn Lies, & Statistics"](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) **[INDEP]**. This is the single cleanest "simple baseline beats the sophisticated memory system, by the system's own numbers" datum in the corpus.

**4. The 91% latency / 90% token claims, decomposed.** Mem0 p95 *total* latency 1.440 s vs full-context p95 total 17.117 s (= ~91.6% lower); Mem0 ~1,764 avg retrieved memory tokens vs ~26,031 full-context tokens (= ~93.2% fewer). **[SEC]** ([somnigraph mem0-paper analysis](https://raw.githubusercontent.com/AlexisOlson/somnigraph/main/research/sources/mem0-paper.md)). Directionally consistent with the abstract claim; not independently reproduced by me.

**5. Mem0's own current README retroactively admits the original algorithm was weak.** The April 2026 memory algorithm table lists **LoCoMo "Old 71.4 → New 92.5"** and **LongMemEval "Old 67.8 → New 94.4"**, with the caveat: "Scores reflect Mem0's managed platform, which includes proprietary optimizations not available in the open-source SDK; open-source users should expect directionally similar gains but not identical numbers." — [mem0ai/mem0 README](https://raw.githubusercontent.com/mem0ai/mem0/main/README.md) **[CLAIM]** — i.e., the vendor's own "old" number for the architecture in the paper is **71.4**, not 92.5, and the open-source path is not the measured path.

### Independent critique and failed reproductions

**6. Zep's rebuttal (competitor, but specific and code-linked).** Daniel Chalef & Preston Rasmussen, 2025-05-06 (updated 2026-06-03): with a "correct" Zep implementation, Zep scores **75.14% ± 0.17** J vs Mem0's best (Mem0 Graph) ~68% — "approximately 10% relative improvement." They also report p95 *search* latency: Zep (correct, concurrent) **0.632 s** vs Zep-as-reported-by-Mem0 **0.778 s**, Mem0 Graph **0.657 s**, Mem0 base **0.200 s**. They identify three concrete implementation errors in Mem0's Zep baseline: (i) both conversation participants assigned the user role, (ii) timestamps appended to message content instead of `created_at`, (iii) sequential instead of parallel searches. They also state their own earlier calculation was wrong and was corrected. — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) **[INDEP]**. Mem0's counter-arguments are in [getzep/zep-papers issue #5](https://github.com/getzep/zep-papers/issues/5).

**7. Independent LoCoMo/EverMemOS audit — Mem0 reproduction at ~20%.** The PenfieldLabs audit (dial481/locomo-audit, Feb 2026) states: "**Mem0: ~20% reproduced** on platform (issue #3944; root cause: timestamps stored as current date)." — [dial481/locomo-audit](https://github.com/dial481/locomo-audit), mirrored at [somnigraph locomo-audit source](https://raw.githubusercontent.com/AlexisOlson/somnigraph/main/research/sources/locomo-audit.md) **[AUDIT]**.

**8. Mem0 issue #3944 — "Failed to reproduce the accuracy on LOCOMO via Mem0 platform" (2026-01-28).** Reporter ran the official eval script with GPT-4o-mini and the Mem0 platform: "I observed very low performance (**LLM score is around 0.20**)." Concrete failure case: for LoCoMo QA "When did Caroline go to the LGBTQ support group?" (gold "7 May 2023"), the stored memory read "…in **early January 2026**". Their diagnosis: "the system is using the current date/time (e.g., January 2026) instead of the timestamps provided in the LoCoMo dataset." — [mem0ai/mem0#3944](https://github.com/mem0ai/mem0/issues/3944) **[INDEP]**. Issue was closed by maintainer `deshraj` on 2026-03-27.

**9. Mem0 issue #3943 — OSS accuracy 30–50%.** "when deploying Mem0 locally using the open-source version, the accuracy of the LoCoMo dataset seems to be between **30% and 50%**, which is far below the **60%** reported in the paper (using gpt-4o-mini and text-embedding-3-small)." — [mem0ai/mem0#3943](https://github.com/mem0ai/mem0/issues/3943) **[INDEP]**

**10. Mem0 issue #2800 — "Unable to reproduce locomo eval scores locally"** (opened 2025-05-26, 25 comments, +18 reactions, closed 2026-03-23): reporter replaced the platform client with the OSS `Memory` class and got "scores … significantly lower than the ones I see in the paper." — [mem0ai/mem0#2800](https://github.com/mem0ai/mem0/issues/2800) **[INDEP]**

**11. MemDelta (arXiv 2606.29914, Kuan Wang, 2026) — the strongest controlled negative result against Mem0.** On LongMemEval-S (500 questions, ~115K tokens/instance, GPT-4o-mini, n=88 matched instances):
- **Mem0 72.7% vs verbatim cloud-embedding RAG 73.9% — Mem0 loses by 1.2 pp, p = 1.0 (McNemar), 90% CI on Δ [−10.8, +8.4] pp.**
- Same instances: full context 60.2%, MiniLM RAG 61.4%, Mem0 72.7%, cloud RAG 73.9%.
- Mem0's apparent "+11 pp memory gain" (72.7% vs 61.4% MiniLM RAG) **reverses** when only the embedding model changes.
- Cost of Mem0: **1,000+ LLM calls, ~120 min, $0.50+ per instance** vs ~60 s / 0 calls / $0.01 for verbatim RAG — i.e. "Mem0 matches cloud RAG at 50× the cost."
- **12 of 100 Mem0 runs failed** (empty responses, database lock timeouts, extraction crashes) and were excluded.
— [arXiv:2606.29914](https://arxiv.org/abs/2606.29914) / [HTML](https://arxiv.org/html/2606.29914v1) **[INDEP]**

**12. MemoryAgentBench (ICLR 2026) — Mem0 ranks near the bottom.** Overall score on four memory competencies (AR/TTL/LRU/SF): GPT-5-mini long-context **60.6**, Claude-3.7-Sonnet 49.6, GPT-4o 48.8, HippoRAG-v2 41.6, BM25 Simple RAG 41.5, MIRIX 37.7, **Zep 24.0, Mem0 21.1, Cognee 20.6**. Mem0's Selective Forgetting sub-score is **10.0**. — [ICLR 2026 proceedings](https://proceedings.iclr.cc/paper_files/paper/2026/hash/fd1eff9dd295df50a41f2521942fa31d-Abstract-Conference.html); detailed per-capability table via [Paper-Notes-en summary](https://raw.githubusercontent.com/zhaoyang97/Paper-Notes-en/refs/heads/main/docs/ICLR2026/llm_agent/evaluating_memory_in_llm_agents_via_incremental_multi-turn_interactions.md) **[INDEP]**

---

## 2. A-MEM (arXiv 2502.12110)

**13. The paper's own reported numbers** (Xu et al., 2025; LoCoMo, GPT-4o-mini, Table 1 as transcribed): A-Mem MultiHop F1 **27.02**, Temporal **45.85**, OpenDomain **12.14**, SingleHop **44.65**, Adversarial **50.03**, answer token length **2,520**. DialSim: F1 3.45, BLEU-1 3.37, ROUGE-L 3.54, METEOR 2.05, SBERT sim 19.51. Ablations: removing both link generation and memory evolution drops MultiHop F1 to **9.65**; removing memory evolution alone drops it to **21.35**. **[SEC/CLAIM]** — from [lhl/agentic-memory ANALYSIS-arxiv-2502.12110-a-mem.md](https://raw.githubusercontent.com/lhl/agentic-memory/refs/heads/main/ANALYSIS-arxiv-2502.12110-a-mem.md), an AI-assisted third-party reading of the paper. I did not retrieve the primary Table 1 directly.

**14. Third-party non-replication of A-MEM by the Mem0 team.** Mem0's paper re-ran A-Mem at temperature 0 ("A-Mem\*") and obtained F1 scores far below A-Mem's published figures: Single-Hop **20.76** (published 27.02), Multi-Hop **9.22** (published 12.14), Open-Domain **33.34** (published 44.65), Temporal **35.40** (published 45.85). — [arXiv:2504.19413v1, Table 1](https://arxiv.org/html/2504.19413v1) **[INDEP re-run]** (note: Mem0 is a competitor of A-Mem's ecosystem, so this is interested critique; but the numbers are printed in a peer-visible table).

**15. MemSyco-Bench (arXiv 2607.01071) — A-Mem degrades under memory misuse.** A-Mem, Qwen3-8B backbone (Δ vs the stated baseline): Objective Fact Judgment **36.00 (−13.12)** and sycophancy rate **+17.04**; Contextual Scope Control **53.06 (−16.94)**; Memory-Evidence Conflict accuracy **25.91 (+25.24)** but sycophancy rate **73.63 (−25.70)**; Valid Memory Selection accuracy **24.00 (−3.79)** with outdated-memory rate **+8.69**. — [arXiv:2607.01071v2](https://arxiv.org/html/2607.01071v2) **[INDEP]**

**16. Structural critiques of A-MEM.** "Memory evolution" is an in-place rewrite with no version history, provenance, conflict detection, or rollback; link generation is LLM-judged and "can hallucinate structure"; the system is not evaluated under memory poisoning, and "any system that stores 'context descriptions' and links them can amplify poisoned content through neighborhood expansion." — [lhl/agentic-memory A-MEM analysis](https://raw.githubusercontent.com/lhl/agentic-memory/refs/heads/main/ANALYSIS-arxiv-2502.12110-a-mem.md) **[SEC]**

---

## 3. Critiques of the memory benchmarks themselves (LOCOMO / LongMemEval / MemoryAgentBench)

**17. LoCoMo ground-truth corruption: 6.4% of questions have wrong gold answers.** Independent audit of LoCoMo-10: **99 of 1,540** non-adversarial questions are score-corrupting (156 total issues; 33 hallucinations, 26 temporal errors, 24 attribution errors, 13 ambiguous, 3 incomplete). **Theoretical scoring ceiling: 93.57%.** Per-category error rates: multi-hop 9.9%, temporal 8.1%, open-domain 9.4%, single-hop 4.3%. — [dial481/locomo-audit](https://github.com/dial481/locomo-audit), detail via [somnigraph locomo-audit](https://raw.githubusercontent.com/AlexisOlson/somnigraph/main/research/sources/locomo-audit.md) **[AUDIT]**. Prior art: [snap-research/locomo#27](https://github.com/snap-research/locomo/issues/27) (29 errors).

**18. The LoCoMo LLM judge accepts 62.81% of deliberately wrong answers.** Stress test with the standard judge (gpt-4o-mini, "be generous"): **specific-but-wrong answers accepted 10.61%**; **vague-but-topical wrong answers accepted 62.81%** — a 6× leniency gap. The audit notes the V2 vague-wrong strategy "scores higher than Mem0 (64.20%) and MemU (66.67%) in several categories." — [locomo-audit](https://github.com/dial481/locomo-audit) **[AUDIT]**

**19. The answer prompt alone is worth 10.67 points.** Four different answer prompts across five published systems; the prompt alone accounts for a **10.67-point** accuracy difference with the same model and identical context (81.95% vs 92.62%). Spearman ρ = 0.64 between answer word count and accuracy; systems without word limits produce answers 10–11× the golden answer length. — [locomo-audit analysis](https://raw.githubusercontent.com/AlexisOlson/somnigraph/main/research/sources/locomo-audit.md) **[AUDIT]**

**20. LoCoMo category sample sizes are too small for the comparisons being made.** Category n ranges 96–841 (8.8× ratio); **Wilson 95% CIs make 56% of adjacent-pair per-category comparisons statistically indistinguishable**; open-domain (n=96) "requires a 15+ point gap to distinguish any two systems"; only Mem0 documents a multi-run methodology, most systems report single-run point estimates. — [locomo-audit](https://github.com/dial481/locomo-audit) **[AUDIT]**

**21. No published LoCoMo result evaluates Category 5 at all.** 446 adversarial questions (**22.5% of the dataset**) — the capability "does the system know what it doesn't know" — are unevaluated by every published system; the original code's multiple-choice formatter is broken on 444/446 questions. — [locomo-audit methodology](https://github.com/dial481/locomo-audit) **[AUDIT]**

**22. LoCoMo conversations fit in context; full context beats the memory systems.** Conversations average 16,000–26,000 tokens; Zep's analysis: "a full-context baseline (~73%) outperforms Mem0's best (~68%)… If simply providing all the text yields better results than the specialized memory system, the benchmark isn't adequately stressing memory capabilities." LoCoMo also has no knowledge-update questions. — [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) **[INDEP]**

**23. Formal "context saturation" critique.** *Anatomy of Agentic Memory* (arXiv 2602.19320, 2026) scores benchmarks by saturation risk and proposes a required statistic **Δ = Score_MAG − Score_FullContext**, arguing "A benchmark meaningfully evaluates agentic memory only when Δ ≫ 0." Ratings: HotpotQA (~1k tokens) **high risk**; LoCoMo (~20k tokens) **moderate**; **MemBench (~100k tokens) high risk**; LongMemEval-S (103k) **borderline**; LongMemEval-M (>1M) **low**. — [arXiv:2602.19320](https://arxiv.org/html/2602.19320v1) **[INDEP]**

**24. Benchmarks measure retrieval, not post-retrieval memory use.** MemSyco-Bench error decomposition across LongMemEval, LoCoMo, STALE, PersonaMem: retrieval-failure-and-wrong-answer (R−/A−) accounts for **47.4%–66.1%** of all samples, while retrieval-success-but-wrong-answer (R+/A−) is only **5.8%–13.7%**. "Current memory benchmark scores mainly reflect whether the memory system can retrieve relevant information, leaving limited evaluation of memory-induced errors that occur after retrieval succeeds." — [arXiv:2607.01071v2](https://arxiv.org/html/2607.01071v2) **[INDEP]**

**25. Custom agentic benchmarks can have *illusory* memory pressure.** MemGym (arXiv 2605.20833): "Settings that appear memory-intensive often admit strong performance without explicit memory management, as facts remain re-derivable from repositories or recoverable from pretraining." Concrete control: on MemGym-DR, "Without fictionalization, frontier models score **0.70–0.85** … by answering from pretraining alone; with it, no-memory drops to near-zero." Also: a single-check verifier had a **62% false-positive rate**. — [arXiv:2605.20833v1](https://arxiv.org/html/2605.20833v1) **[INDEP]**

**26. Simple/verbatim baselines match or beat LLM-extraction memory.** Compiled third-party benchmark review: **Raw ChromaDB with all-MiniLM-L6-v2: 96.6% R@5** on LongMemEval vs **Mem0 RAG (LLM-extracted) 30–45%** (ConvoMem) and block extraction 57–71%; and "Letta demonstrated that a filesystem-based agent using `grep` and `search_files` on gpt-4o-mini achieved **74.0% on LoCoMo**, outperforming Mem0's specialized memory system (**68.5%**)." — [lhl/agentic-memory benchmarks README](https://raw.githubusercontent.com/lhl/agentic-memory/main/benchmarks/README.md) **[SEC]** (AI-assisted compilation; underlying claims trace to MemPalace BENCHMARKS.md and Letta's blog — I did not fetch those primaries).

**27. Explicit verbatim-RAG ≈ full-context null result.** MemDelta: verbatim RAG 47.2% vs full context 49.8% on LongMemEval-S, GPT-4o-mini, n=500 — "a 2.6pp gap that is **not statistically significant (p = 0.34)**." With cloud embeddings, RAG reaches 53.4% and numerically exceeds full context (p = 0.18). — [arXiv:2606.29914](https://arxiv.org/abs/2606.29914) **[INDEP]**

**28. A published negative result about retrieval utilization was itself withdrawn.** The "Can Small Language Models Use What They Retrieve?" study (v1, arXiv:2603.11513) claimed models fail under oracle retrieval 85–100% of the time. Correction notice (August 2026): "The v1 oracle selected passages by gold-answer string containment, which did not establish that they supported the question. The claims that models fail under oracle retrieval 85–100% of the time, that context presence causes the reported distraction effect, and that 61–100% of oracle failures reflect models ignoring relevant context are **withdrawn**." Corrected HotpotQA re-evaluation raises Exact Match by **+39.2 / +44.3 / +50.0 pp** for Qwen2.5-1.5B/3B/7B. — [sanchitpandey/rag-utilization-study README](https://raw.githubusercontent.com/sanchitpandey/rag-utilization-study/main/README.md) **[INDEP, self-retraction]**

---

## 4. RL / learned memory policies (2025–2026) — negative and null findings

**29. Memory-R1 (arXiv 2508.19828; ACL 2026 long paper 583) — the claimed gains.** With LLaMA-3.1-8B-Instruct on LOCOMO: overall F1 **30.41 → 45.02 (+14.61 absolute, +48% relative)**; BLEU-1 **22.22 → 37.51 (+15.29, +69%)**; LLM-as-a-Judge **45.68 → 62.74 (+17.06, +37%)**, using only **152 training QA pairs**. Retrieval is fixed at **60 candidate memories per question**, filtered by the RL Answer Agent's "Memory Distillation" policy. — [arXiv:2508.19828v2](https://arxiv.org/html/2508.19828v2), [ACL Anthology](https://aclanthology.org/2026.acl-long.583/) **[CLAIM]**

**30. Memory-R1's own motivating example is a documented failure of non-RL memory management.** From the paper: "a user first says 'I adopted a dog named Buddy' and later adds 'I adopted another dog named Scout'. A vanilla system misinterprets this as a contradiction, issuing **DELETE+ADD and overwriting the original memory**." The example is drawn from Mem0's ADD/UPDATE/DELETE/NOOP operator set. This is a first-party, peer-reviewed claim that a shipped memory-management heuristic destroys correct memories. — [arXiv:2508.19828v2](https://arxiv.org/html/2508.19828v2) **[CLAIM]**

**31. Status of the RL-memory negative-result search: no paper found reporting that memory-augmented RL agents fail to beat non-memory baselines.** I found no 2025–2026 paper with an explicit negative/null table for RL-trained memory management. Memory-R1's ablations (Effect of Memory Manager / Answer Agent / Memory Distillation / RL policy comparison) exist but I could not read their numeric deltas within the fetched content — those specific ablation numbers are **NOT VERIFIED** here. Treat item 29 as claim-only.

**32. MemAgent (arXiv 2507.02259; ICLR 2026).** Located and confirmed to exist ("Reshaping Long-Context LLM with Multi-Conv RL-based Memory Agent"), and it is cited as the baseline in EMBER (arXiv 2606.05894), which reports re-training and re-evaluating "the MemAgent in-context memory algorithm… under the same pre-queue" conditions. **I did not retrieve MemAgent's own numbers or any negative result.** — [ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/4264ee4376776907c0b87ed70b959585-Abstract-Conference.html), [arXiv:2606.05894](https://arxiv.org/abs/2606.05894) **[NOT FOUND]**

**33. RL memory is a crowded space without a demonstrated winner.** A 2026 taxonomy survey lists at least eight distinct RL/learned memory-management systems (MemAgent, MemSearcher, MemGen, TokMem, MEM1, Mem-α, MemRL, Memory-T1, AtomMem, MEMTRACK-adjacent) across four memory-structure families, and notes these "introduce greater system complexity and nontrivial maintenance overhead" while the survey's central finding is that "current agentic memory systems often fall short of their theoretical promise." — [arXiv:2602.19320](https://arxiv.org/html/2602.19320v1) **[INDEP]**

---

## 5. Memory that HURTS: stale, contradictory, sycophantic, poisoned

### Sycophancy / stale-belief contamination (measured accuracy LOSS)

**34. Adding a plausible but wrong "memory" drops factual accuracy by up to 15.9 pp.** MemSyco-Bench preliminary study: adding a memory snippet pointing at an incorrect answer reduced accuracy for all three tested models; largest drop **DeepSeek-V4-Flash 56.1% → 40.2%**; its sycophancy rate rose **24.3% → 52.3%**. — [arXiv:2607.01071v2](https://arxiv.org/html/2607.01071v2) **[INDEP]**

**35. Per-system degradation table (Qwen3-8B, Δ vs the stated baseline).** Objective Fact Judgment accuracy drops (vs No-Memory 49.12):
- Full Dialog: **30.62 (−18.50)**, sycophancy **+17.24**
- **Mem0: 35.67 (−13.45)**, sycophancy **+18.58**
- LightMem: 34.67 (−14.45), sycophancy **+27.57**
- MemGPT: 30.00 (−19.12), sycophancy **+33.24**
- MemoryBank: 31.67 (−17.45), sycophancy **+27.57**
- A-Mem: 36.00 (−13.12), sycophancy **+17.04**
- NaiveRAG: 34.00 (−15.12), sycophancy **+18.57**

Contextual Scope Control collapses for two systems: **Mem0 13.34 (−56.66)**, **LightMem 13.67 (−56.33)**, MemGPT 40.00 (−30.00). — [arXiv:2607.01071v2](https://arxiv.org/html/2607.01071v2) **[INDEP]**

### Memory poisoning (attack success with negligible benign cost)

**36. MINJA (arXiv 2503.03704, v5 2026) — injection via query-only interaction.** Paper's own summary: "MINJA achieves a high average success rate of **98.2%** for injecting malicious records into the memory, and a high average attack success rate of **76.8%** in eliciting the malicious reasoning steps." Per-agent/dataset **[SEC, transcribed from the paper's table]**: EHR GPT-4/MIMIC-III ISR ~95.6%, ASR ~57.0%, utility drop ~−0.7; EHR GPT-4/eICU ISR ~98.5%, ASR ~90.0%, UD ~0.0; RAP GPT-4o/Webshop ISR ~99.3%, ASR ~98.9%, UD ~−0.7; QA GPT-4/MMLU ISR 100%, ASR ~68.9%, UD ~−10.0. Threat model requires no DB access — only ordinary queries; assumes a shared memory bank. — [arXiv:2503.03704v5](https://arxiv.org/html/2503.03704v5); table transcription via [lhl/agentic-memory MINJA analysis](https://raw.githubusercontent.com/lhl/agentic-memory/32e2bec4f65aa1286c81b6866fe815d7a61b71c2/ANALYSIS-arxiv-2503.03704-minja.md) **[CLAIM + SEC]**

**37. AgentPoison (NeurIPS 2024).** "On each agent, AgentPoison achieves an average attack success rate of **≥80%** with minimal impact on benign performance (**≤1%**) with a **poison rate < 0.1%**." Attacks three real agents (RAG autonomous driving, knowledge-intensive QA, healthcare EHRAgent) by poisoning long-term memory or the RAG knowledge base; requires no model training or fine-tuning. — [NeurIPS 2024 proceedings](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract.html) **[INDEP]**

**38. Error propagation from experience memory (ACL 2026).** "How Memory Management Impacts LLM Agents: An Empirical Study of Experience-Following Behavior" (Xiong, Lin, Xie, He, Liu, Tang, Lakkaraju, Xiang, ACL 2026 long paper 27): LLM agents display an **experience-following** property — "high similarity between a task input and the input in a retrieved memory record often results in highly similar agent outputs." Two named failure modes: **error propagation**, "where inaccuracies in past experiences compound and degrade future performance," and **misaligned experience replay**, "where some seemingly correct executions can provide limited or even misleading value as experiences." — [ACL Anthology 2026.acl-long.27](https://aclanthology.org/2026.acl-long.27/) **[INDEP]**. Exact percentages are in the PDF body, which I could not extract; the numeric magnitudes are **NOT VERIFIED**.

**39. Stale-memory failure is designed-in for one shipped harness, with a probe.** "Delivery, Not Storage" (arXiv 2607.20972) forces repeated compaction: with ten facts held only in conversation, **106 of 108 continuation summaries carried 0/10 facts** (2 carried 10/10 after accidental re-surfacing; **no strict subset ever occurred** — every summary was all-or-nothing), and the final summary carried 0/10. The paper also reports that "injected content carries provenance framing ('recorded by an AI session, not human-endorsed — verify')" specifically because of poisoning risk, and cites "adversarial cue-anchored firing, planted items persisting dormant until a later trigger." — [arXiv:2607.20972v1](https://arxiv.org/html/2607.20972v1) **[INDEP, small-n self-report]** (threats-to-validity section acknowledges n=2–3 per arm and 2.4–4.4× within-arm wall-time spread).

---

## 6. Explicit negative / null result tables (exact numbers and conditions)

**40. MemDelta Table 3 — main null results (LongMemEval-S, GPT-4o-mini, n=500 unless noted).** — [arXiv:2606.29914](https://arxiv.org/abs/2606.29914) **[INDEP]**

| Strategy | n | Accuracy | 95% CI | vs. S4 |
|---|---|---|---|---|
| S0: No Memory | 500 | **2.2%** | [1.0, 3.6] | −45.0 pp*** |
| S_rand: Random RAG (~5K tokens) | 500 | **3.2%** | [1.8, 4.8] | −44.0 pp*** |
| S2: Agent self-memory (4,096-token scratchpad) | 100 | **42.0%** | [32.0, 52.0] | −5.2 pp* |
| S4: Verbatim RAG (MiniLM 384-d, 512-tok chunks, top-10) | 500 | **47.2%** | [42.8, 51.4] | — |
| S1: Full context (~115K tokens) | 500 | **49.8%** | [45.6, 54.0] | **+2.6 pp (p = 0.34, n.s.)** |
| S4b: Verbatim RAG (text-embedding-3-small) | 500 | **53.4%** | [49.0, 57.8] | +6.2 pp** |

Key quoted conditions: agent self-memory "collapses on multi-session questions (**3.3%**)." S2 costs ~250 LLM calls/instance and still underperforms S4b.

**41. MemDelta Table 6 — Mem0 vs matched RAG (88 instances, 68 SS-User + 20 Multi-Session, GPT-4o-mini).** Full context 60.2% / SS-User 72.1% / Multi 20.0%; MiniLM RAG 61.4% / 76.5% / 10.0%; **Mem0 72.7% / 88.2% / 20.0%**; cloud RAG **73.9% / 88.2% / 25.0%**. "**Mem0 (72.7%) does not outperform verbatim RAG with comparable embeddings (73.9%, p = 1.0, McNemar; 90% CI on Δ: [−10.8, +8.4] pp).**" On multi-session, Mem0 (20%) does not outperform cloud RAG (25%). Scope limit stated by the authors: covers only 2 of 6 question types; temporal and knowledge-update were not run for Mem0 due to cost. — [arXiv:2606.29914](https://arxiv.org/abs/2606.29914) **[INDEP]**

**42. MemDelta Table 5 — negative deltas from an embedding swap and per-type loss.** Knowledge-Update: **62.8% → 62.8%, Δ = 0.0**. Single-session-assistant: **89.3% → 83.9%, Δ = −5.4**. Single-session-preference: **40.0% → 30.0%, Δ = −10.0**. Overall **+6.2 pp (p = 0.004)**. — [arXiv:2606.29914](https://arxiv.org/abs/2606.29914) **[INDEP]**

**43. MemDelta Table 4 — the same comparison yields three contradictory conclusions by model.** GPT-4o-mini: RAG 47.2 vs Full 49.8 (**+2.6 pp**); Claude Sonnet (n=300): RAG 44.7 vs Full 14.0 (**−30.7 pp**); Sonnet truncated to ~47K: RAG 61.0 vs Full 38.0 (**−23.0 pp**); Gemini 2.5 Flash (n=100): RAG 56.0 vs Full 70.0 (**+14.0 pp**). "**63% (188/300)** of Sonnet's full-context errors are explicit refusals… despite the answer being present in the 115K-token context." — [arXiv:2606.29914](https://arxiv.org/html/2606.29914v1) **[INDEP]**

**44. Post-retrieval assembly — a clean null on LongMemEval (arXiv 2606.01435, COLM 2026 Lifelong Agent Workshop).** "A LongMemEval check finds **no significant overall advantage (26/45 versus 29/45; paired exact McNemar p = 0.45)**, bounding the result to current-value questions with explicit version metadata." Same paper: in the MemoryAgentBench release used, "the best reported retrieval/memory result is **54% single-hop** and **all 22 reported systems score at most 7% multi-hop**" on FactConsolidation. — [arXiv:2606.01435](https://arxiv.org/abs/2606.01435) **[INDEP]**

**45. MemoryAgentBench — selective forgetting collapses across all systems.** Per-capability overall scores: GPT-5-mini (400K) AR 74.4 / TTL 48.6 / LRU 66.2 / SF 53.0 / **Overall 60.6**; Claude-3.7-Sonnet 59.7 / 53.9 / 62.2 / 22.5 / 49.6; GPT-4o 58.1 / 50.0 / 54.9 / 32.5 / 48.8; HippoRAG-v2 65.1 / 35.8 / 36.2 / 29.5 / 41.6; BM25 45.3 / 44.5 / 35.6 / 25.5 / 41.5; MIRIX 63.0 / 35.7 / 40.5 / 11.5 / 37.7; **Zep 37.5 / 37.5 / 16.2 / 5.0 / 24.0; Mem0 32.6 / 21.2 / 20.7 / 10.0 / 21.1; Cognee 28.3 / 22.8 / 16.0 / 15.5 / 20.6**. "[P]erformance on SF collapsed across all methods, with none exceeding 28% in multi-hop scenarios." Even o4-mini reached 100% single-hop at 6K but stayed at **14% multi-hop at 32K**. — [ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/fd1eff9dd295df50a41f2521942fa31d-Abstract-Conference.html); per-table transcription via [Paper-Notes-en](https://raw.githubusercontent.com/zhaoyang97/Paper-Notes-en/refs/heads/main/docs/ICLR2026/llm_agent/evaluating_memory_in_llm_agents_via_incremental_multi-turn_interactions.md) **[INDEP + SEC]**.

---

## 7. TiM / Think-in-Memory, Generative Agents ablations, and memory-utilization rates

**46. Think-in-Memory (TiM, arXiv 2311.08719, Liu et al., 2023) — its own GVD gains are ~1 point.** GVD, ChatGLM, English/Open: SiliconFriend baseline retrieval accuracy **0.809** vs TiM **0.820** (+0.011); response correctness **0.438** vs **0.450** (+0.012); contextual coherence 0.680 vs 0.735. Chinese/Open: retrieval accuracy **0.840** vs **0.850** (+0.010); response correctness 0.418 vs 0.605. The KdConv gains are much larger and appear to be measured against a **no-memory** condition (marked "✗"), not against SiliconFriend, so the large deltas are not apples-to-apples with the GVD comparison. — [arXiv:2311.08719v1](https://arxiv.org/html/2311.08719v1) **[CLAIM]**. I found **no independent replication or critique** of TiM.

**47. "Delivery, Not Storage" (arXiv 2607.20972) — voluntary memory use is approximately zero.** In a controlled naturalistic coding task (Apache Camel Resequencer reverse option): "an agent whose store was pre-seeded with facts directly relevant to its task, with connected tools and explicit guidance, made **zero memory calls in 114 turns**." Unseeded equipped runs made **0–1 voluntary memory writes across all five runs** despite **32 memory-guidance mentions** in the workspace instruction files. "Knowledge present in a store contributes nothing by itself." — [arXiv:2607.20972v1](https://arxiv.org/html/2607.20972v1) **[INDEP, small n]**

**48. Re-exploration waste concentrates at context-loss boundaries.** Same study: 61 intra-session re-reads across nine transcripts, of which **24 (39%)** re-read content the session had already read before a compaction boundary; ~78K result tokens re-paid; worst single run re-paid ~31.6K tokens. — [arXiv:2607.20972v1](https://arxiv.org/html/2607.20972v1) **[INDEP]**

**49. Memory-utilization / "correct memory use" rates from MemSyco-Bench (Qwen3-8B).** Personalized Memory Use — **Correct Memory Use**: NaiveRAG **71.00 (+7.66)**, A-Mem **71.00 (+7.66)**, LightMem 67.56 (+4.22), Mem0 **64.00 (+0.66)**, MemGPT 64.00 (+0.66), MemoryBank 62.33. Valid Memory Selection — **Outdated Memory rate (lower better)**: A-Mem **64.85 (+8.69)**, LightMem **69.91 (+13.75)**, Mem0 **59.14 (+2.98)**, NaiveRAG 59.34 (+3.18), MemGPT 53.71 (−2.45). I.e., for several systems the "outdated memory" flag gets *worse* when memory is on. — [arXiv:2607.01071v2](https://arxiv.org/html/2607.01071v2) **[INDEP]**

**50. Memory-R1's retrieval-to-use ratio is extreme (qualitative, from its own figure caption).** The Answer Agent starts from "**60 memories retrieved via RAG**" and applies a Memory Distillation policy to "filter the memories that are truly useful to answer the question, which is **<Memory 1>**" — i.e., 1 useful item out of 60 in the paper's own worked example. This is an illustration, **not** an aggregate percentage. — [arXiv:2508.19828v2](https://arxiv.org/html/2508.19828v2) **[CLAIM, anecdote]**

**51. MEMTRACK (arXiv 2510.01353, NeurIPS 2025 SEA Workshop) — memory backends fail on enterprise state tracking.** "Experiments across SoTA LLMs and memory backends reveal challenges in utilizing memory across long horizons, handling cross-platform dependencies, and resolving contradictions. Notably, the best performing GPT-5 model only achieves a **60% Correctness** score on MEMTRACK." The benchmark additionally reports Efficiency and Redundancy metrics "beyond simple QA performance." — [arXiv:2510.01353](https://arxiv.org/abs/2510.01353) **[INDEP]**. Per-backend numbers are in the HTML body, which I did not fetch — not verified.

**52. Generative Agents (Park et al., 2023, arXiv 2304.03442) memory ablation — NOT FOUND.** I found no ablation table for the memory stream (retrieval weights / reflection removal) with negative or null results, and no replication failure paper. What I *can* report is a secondary-source structural observation from a 2026 survey: in the released implementation "all three weights are simply **1**, yet the scheme works well enough that most retrieval-based memories still use it," and Reflexion's buffer "is capped at 1–3 entries because larger buffers drown the agent in contradictory advice." — [arXiv:2607.16848v1](https://arxiv.org/html/2607.16848v1) **[SEC]**. The Generative Agents ablation itself: **NOT FOUND**.

---

## COULD NOT VERIFY

1. **Mem0 Table 2/Table 3 primary rows** (overall J = 66.88% / 68.44% / 72.9% full-context; Mem0 p95 total 1.440 s vs 17.117 s; 1,764 vs 26,031 tokens). arXiv HTML truncated before Table 2's later rows; I relied on a third-party AI-assisted analysis plus Zep's independent corroboration of the ~73%-vs-~68% comparison. Treat the exact 1.440 s / 17.117 s / 1,764 / 26,031 figures as **[SEC], unverified against the PDF**.
2. **A-MEM's primary Table 1 and Table 3** (MultiHop 27.02, Temporal 45.85, token length 2,520, ablation 9.65 / 21.35). Obtained only via a third-party analysis file; not fetched from arXiv:2502.12110 directly.
3. **MemAgent (arXiv 2507.02259)** — no numbers retrieved; no negative result found. **NOT FOUND.**
4. **Memory-R1 ablation deltas** (Effect of Memory Manager / Answer Agent / Memory Distillation; PPO vs GRPO comparison). Section 4.3 was cut off by content truncation. **NOT VERIFIED.**
5. **"How Memory Management Impacts LLM Agents" (ACL 2026.acl-long.27) numeric error-propagation rates.** Only the abstract was retrievable; the PDF body was not extractable with the tools available. **NOT VERIFIED.**
6. **Generative Agents (arXiv 2304.03442) memory ablation with negative results.** **NOT FOUND.**
7. **Any paper reporting that memory-augmented RL agents do not beat non-memory baselines.** Searched extensively; **NOT FOUND.**
8. **MINJA's exact per-agent ISR/ASR/UD table rows** — the fetch truncated immediately before the results table; the per-agent figures above come from a third-party transcription, while the 98.2% / 76.8% averages are the paper's own abstract. The per-agent numbers are **[SEC]**.
9. **An independent reduction in attack success from a defense (e.g. A-MemGuard's claimed 95% reduction).** Seen only as a Chinese-language news headline ([36Kr](https://eu.36kr.com/en/p/3511016610962311)); the underlying paper/numbers were **NOT VERIFIED**.
10. **Exact percentage of retrieved memories that are cited/used in an agent's final answer** (an aggregate utilization rate). Only proxies found: 0 calls/114 turns (arXiv 2607.20972), the 1-of-60 anecdote in Memory-R1, MemSyco-Bench's "Correct Memory Use" metric, and the withdrawn 85–100% oracle-failure claim. No clean aggregate utilization-rate paper. **NOT FOUND.**
11. **LOCOMO-Plus, StructMemEval, EverMemBench** — named in the lhl benchmarks README as additional benchmarks but not fetched or verified here.

## Source-quality caveats

- `lhl/agentic-memory` and `AlexisOlson/somnigraph` files are **AI-assisted markdown analyses** of primary papers, not primary sources. Where I relied on them I tagged **[SEC]** and gave the underlying paper's URL too. Several of their numbers (Mem0's Table 2, A-MEM's Table 1, MINJA's per-agent table) should be re-checked against the PDFs before publication.
- The Zep blog is a **direct commercial competitor's** critique of Mem0 and is partly contradicted by Mem0 in [getzep/zep-papers#5](https://github.com/getzep/zep-papers/issues/5). The locomo-audit also reports that **Zep itself had a Category-5 scoring bug that inflated its scores** (acknowledged and fixed). Treat the Mem0↔Zep dispute as symmetric and unresolved.
- MemDelta, MemSyco-Bench, Delivery-Not-Storage, MemGym, and Anatomy of Agentic Memory are **arXiv preprints** (some with workshop acceptance noted) and have not been through full peer review. MemoryAgentBench (ICLR 2026), Memory-R1 (ACL 2026), AgentPoison (NeurIPS 2024), and the ACL 2026 memory-management study are peer-reviewed.
