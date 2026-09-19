# Negative Results & Failure Modes of Agent Memory, Self-Generated Skill Libraries, and Experience Extraction

**Evidence review, target window 2023–2026.** Every substantive claim carries a source URL; paper title and year are given. Numbers are quoted as printed, with the model/benchmark condition. Where I could not find evidence I write **NOT FOUND** rather than infer.

**Sourcing note.** Findings 1 and 2 were read from the full PDFs of the two requested papers (text-extracted, not summarized). Findings 3–7 draw on a parallel evidence sweep of arXiv/ACL/ICLR/AAAI/OpenReview plus first-party vendor pages and vendor-owned GitHub issues. Items sourced from secondary or AI-assisted analyses are labeled **[SEC]** and should be re-verified before publication. Items read off plotted figures rather than tables are labeled **[FIG]**.

---

## 1. Library Drift (arXiv:2605.19576) — the requested paper

**Paper:** [Library Drift: Diagnosing and Fixing a Silent Failure Mode in Self-Evolving LLM Skill Libraries](https://arxiv.org/abs/2605.19576) — Xing Zhang, Yanwei Cui, Guanghui Wang, Ziyuan Li, Wei Qiu, Bing Zhu, Peiyang He (2026, v3); accepted to the ICML 2026 Workshop on Failure Modes in Agentic AI (FAGEN). Full text: [arXiv HTML v3](https://arxiv.org/html/2605.19576v3). Affiliations: AWS Generative AI Innovation Center + HSBC Technology Center, China.

**1.1 The failure mode.** "Library drift": unbounded skill accumulation without outcome-driven lifecycle management causes retrieval degradation, false-positive injections, and performance stagnation. Operational definition: drift occurs when `E[pass@1 | S_t] < E[p_0]` (no-skill pass rate) for some `t > 0` — i.e. **the library makes the agent worse than having no library at all**. Three compounding stages: (a) accumulation without quality signal, (b) retrieval degradation (near-duplicate/stale skills crowd out useful ones, "degrading precision at constant recall"), (c) silent injection harm ("the solver simply fails more often, indistinguishable from inherent task difficulty"). Three sub-modes named: *stagnation*, *bloat*, *erosion*.

**1.2 The headline negative result the authors cite for the symptom.** "LLM-authored skills deliver +0.0pp gain while human-curated ones deliver +16.2pp (SkillsBench)." The primary source is [SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks](https://arxiv.org/abs/2602.12670) (Li et al., 2026), and the underlying numbers do corroborate the claim — see §5 below.

**1.3 Measured drift triggers (MBPP+ hard-100, Claude Opus 4.7, 100 rounds, 3 seeds).** Main results table, quoted directly:

| Condition | Baseline | Peak | Gain | Router engagement | Active skills @100 | Retired | Critic calls |
|---|---|---|---|---|---|---|---|
| **Default** (full governance) | 0.258 ± 0.047 | 0.658 ± 0.042 | **+0.328 ± 0.018** | 73% | 50 | 89 | 4299 |
| **A1 no injection** | 0.283 ± 0.031 | 0.375 ± 0.000 | **+0.002 ± 0.005** | **0%** | 42 | 15 | **0** |
| **A2 retrieval-only routing** | 0.242 ± 0.012 | 0.492 ± 0.042 | **+0.077 ± 0.065** | **98%** | 42 | 69 | 5740 |
| **A3 no meta-skill** | 0.200 ± 0.035 | 0.592 ± 0.047 | +0.187 ± 0.036 | 80% | 50 | 84 | 4676 |
| **A4 harsh retirement** | 0.300 ± 0.035 | 0.433 ± 0.042 | **−0.019 ± 0.010** | **19%** | **2** | 51 | 1090 |
| A5 no canonicalisation | 0.275 ± 0.020 | 0.708 ± 0.012 | +0.374 ± 0.023 | 80% | 50 | 76 | 4393 |
| A6 no cover-guard | 0.217 ± 0.024 | 0.700 ± 0.035 | +0.363 ± 0.033 | 70% | 50 | 94 | 3871 |
| A7 cap = 100 | 0.292 ± 0.042 | 0.650 ± 0.089 | +0.317 ± 0.110 | 75% | 100 | 55 | 4609 |
| A8 meta-skill refresh | 0.250 ± 0.035 | 0.725 ± 0.020 | +0.372 ± 0.017 | 74% | 50 | 131 | 4388 |

Source: Table 1, [arXiv HTML](https://arxiv.org/html/2605.19576v3).

**1.4 Two measurable negative results.**
- **Skills that are created but not injected buy nothing:** A1 = **+0.002 ± 0.005** (the no-skill floor). The paper states this "isolates the routing effect: skill creation alone, without injection, produces no gain."
- **Naive governance is worse than no governance:** A4 = **−0.019 ± 0.010**, *below* the no-skill baseline. Cause given: lowering the evidence floor `N_min` from 100 to 20 gives Hoeffding deviation `ε ≈ 0.44`, so skills with true contribution `c ∈ [−0.44, 0]` get retired on unlucky draws and the bank collapses to **2 active skills**. Consistent across all three seeds: **−0.005, −0.027, −0.025**. The authors call this "a cautionary negative result: governance is not uniformly beneficial."

**1.5 Numbers on retrieval "never firing" / router engagement.** This is the paper's most direct answer to that question:
- Healthy conditions maintain **70–80%** router engagement.
- The drifting condition (A4) drops to **19%** (text also prints 18.9%), because the bank has emptied.
- A1 forces engagement to **0%** and the critic makes **0 calls** ("no skill-attributed failures exist to judge").
- Counterintuitively, the *worst-quality* routing condition (A2, retrieval-only, no LLM gate) has the *highest* engagement at **98%** — so **high retrieval firing rate is not evidence of a healthy library**; the LLM gate's "ability to decline injection is itself a drift-prevention mechanism."
- A4's bank collapses to 2 active skills **by round 30**, yet aggregate pass@1 "declines only gradually because the router adaptively selects none on most tasks" — i.e. end-task metrics are a lagging indicator.

**1.6 Cost numbers.** Default uses **~14.5k LLM calls per 100 rounds** (10k solver + 4.3k critic + 152 synthesis), **43% more** than the no-skill baseline A1 (10k calls). Wall time **6.5 h vs A1's 2.3 h (2.8×)**. Solver dominates cost in all conditions (63–99% of calls). A8 (meta-skill refresh every 10 rounds) matches A5/A6 gains but costs **55% more wall time (10.1 h vs 6.5 h)** and is judged "not justified at this scale."

**1.7 What the paper claims *not* to need.** Explicit dedup ablations *slightly exceed* the default (A5 +0.374, A6 +0.363 vs Default +0.328) — the authors argue the meta-skill subsumes explicit dedup and that "the explicit filter's false positives discard more useful skills than duplicates it prevents."

**1.8 Verification and power caveats stated by the authors.** ~273 of 378 MBPP+ test tasks were discarded because Claude Opus 4.7 solves them on all 5 baseline seeds; remaining 100 split 60 train / 40 eval. Single model; single benchmark; diagnostic thresholds "empirically chosen." Per-seed table confirms A2 had one seed at **−0.010** (i.e. one of three seeds was negative) and A1 had one seed at **−0.005**.

---

## 2. When Self-Evolution Backfires (arXiv:2608.05810) — the requested paper

**Paper:** [When Self-Evolution Backfires: Pre-Commit Gating against Skill Contamination in LLM Agents](https://arxiv.org/abs/2608.05810) — Linfang Shang, Ming Xu, Yiding Sun, Tianle Xia, Lingxiang Hu, Lan Xu, Ning Zheng (2026, v2). Tencent. Full text: [arXiv HTML v2](https://arxiv.org/html/2608.05810v2).

**2.1 The failure mode.** Capability–contamination phase transition: past a critical pool size `k*`, added skills *degrade* performance. Three levels: **individual** (single skill has negative singleton gain), **combinatorial** (skills each individually harmless but jointly harmful — `g({s_a},τ) ≥ 0`, `g({s_b},τ) ≥ 0`, yet `g({s_a,s_b},τ) < 0`), **systemic** (the macroscopic inverted-U). Structural cause: distilled skills become reference context for later distillation, forming cross-round contamination chains.

**2.2 Main results table — ungated vs gated (Terminal-Bench 2, Event split, 50 tasks, k=3 rollouts, 5 rounds).** Quoted from Table 1:

| Round | Pass@1 | ΔSeed (pp) | Easy | Med | Hard | Pool | Tok/Trial (M) |
|---|---|---|---|---|---|---|---|
| **Seed** (static, no evolution) | 46% | — | 50% | 52% | 35% | **3** | **0.35** |
| *Ungated — no admission control* | | | | | | | |
| R1 | 48% | +2 | 100% | 48% | 41% | 35 | 1.07 |
| R2 | 60% | +14 | 100% | 65% | 53% | 68 | 1.20 |
| R3 | **62%** | +16 | 100% | 65% | 47% | **105** | **1.30** |
| R4 | 52% | +6 | 100% | 52% | 47% | 141 | 1.24 |
| R5 | **50%** | +4 | 100% | 55% | **35%** | **179** | 1.19 |
| *+ Post-hoc Rollback* | **52%** | **+6** | 100% | 58% | 35% | 171 | 1.15 |
| *VaG — pre-commit gated (ours)* | | | | | | | |
| R1 | 52% | +6 | 100% | 55% | 41% | 5 | 0.77 |
| R2 | 58% | +12 | 100% | 61% | 47% | 15 | 0.82 |
| R3 | 62% | +16 | 100% | 68% | 47% | 25 | 0.87 |
| R4 | 68% | +22 | 100% | 74% | 53% | 30 | 0.90 |
| R5 | **72%** | **+26** | 100% | 77% | **59%** | **37** | **0.94** |

**Key deltas:** ungated peaks at R3 (62%, pool 105) and gives back most of it by R5 (**50%, pool 179**), ending only **+4pp over Seed** and only **2pp above its own R1**. VaG rises monotonically to **72%** — **+22pp over ungated at R5**, and **+10pp over ungated's best round** (i.e. gating beats oracle early-stopping), with a Hot pool of 37 vs 179 (**~4.8× smaller**).

**2.3 Token-cost numbers (directly requested).** Per-trial token cost: Seed **0.35M**; Ungated **1.07 → 1.30M** (grows with pool); VaG **0.77 → 0.94M**. The authors' framing: "VaG's per-trial token cost stays low (0.77–0.94M) while Ungated's grows with its bloated pool (up to 1.30M) for worse accuracy — the gate buys accuracy and efficiency together." Stated gating cost: Gate 1's first two checks (schema, A-B replay) use **no LLM calls**; only the semantic critic costs one inference per candidate; Gate 2 adds at most `|W|−1 ≤ 14` joint replays per round, with `|W| ≤ 15` Gate-1 survivors per round.

**2.4 Ablation table (component ablations, Event-50 at R5).** Quoted from Table 2:

| Configuration | Pass@1 | Pool | ΔVaG (pp) |
|---|---|---|---|
| VaG (full) | 72% | 37 | — |
| − Schema validation | 70% | 37 | **−2** |
| − Holdout replay | **62%** | 45 | **−10** |
| − Semantic check | 68% | 40 | **−4** |
| − Marginal-gain gate | **64%** | **58** | **−8** |

The `−Marginal-gain gate` row is the direct evidence for combinatorial contamination: with every Gate-1 survivor promoted, the Hot pool **balloons from 37 to 58 skills yet pass@1 drops 8pp** — "skills which each clear the individual checks can still conflict once injected together." The three critics "fail on different skills — schema on malformed entries, replay on silently harmful ones, semantics on plausible-but-fabricated advice — so no single check substitutes for another."

**2.5 Post-hoc rollback recovery — the irreversibility result (directly requested).** Figure 4 decomposes the drop from the Ungated peak to R5:

- Ungated peak (R3): **62.3%**
- Ungated R5 (collapsed): **50.0%**
- Source-only rollback (removes the 8 harmful *source* skills, keeps descendants): **51.7%**
- Oracle full-lineage cleanup (requires provenance a real system lacks): **56.7%**
- VaG (R5): **72.0%**

Breakdown of the **12.3pp** peak-to-R5 drop: source removal recovers **1.7pp**, full lineage cleanup a further **5.0pp**, and **5.6pp is irrecoverable even under Oracle cleanup** — "nearly half the drop unrecovered." Concrete case: "a git-conflict skill distilled at R3 seeded two derived skills at R4 (merge and rebase workflows); after source-only rollback both remained and kept failing 4 of 7 git-related Test-25 tasks."

**⚠️ Discrepancy inside the paper (flag before citing):** the abstract and introduction state "Source-only rollback recovers only **17%** of the degradation." The figure-level numbers give 1.7 / 12.3 = **≈13.8%**. The paper also prints "removing the 8 harmful source skills from the collapsed R5 pool recovers only **2pp (50%→52%)**" in the text, while Table 1 and Figure 4 both show **50% → 51.7%/52%** i.e. 1.7–2pp. State the 1.7pp/12.3pp decomposition and note the 17% figure as the authors' rounded claim.

**2.6 Cross-model and cross-benchmark transfer (all positive, no negative transfer reported).** Cross-model, Test-25, frozen Hy3-evolved Hot pool: Hy3 32%→44% (**+12**), DeepSeek-V4-Pro 32%→40% (**+8**), GPT-5.4 44%→56% (**+12**), Claude Sonnet 4.5 48%→56% (**+8**), Qwen3.6-35B-A3B 36%→52% (**+16**). Cross-benchmark, InterCode NL2Bash (200 tasks): Seed 57.5%, Ungated R5 (pool 179) 65.5% (**+8.0**), VaG R5 (pool 37) 69.0% (**+11.5**). Note the authors' explanation for why Ungated stays net-positive here: "on these short tasks each trial invokes few skills and contamination chains stay shallow, so new skills still help — consistent with contamination biting hardest on long, multi-step tasks."

**2.7 Statistical power caveat stated by the authors.** "The 95% Wilson CI bands in Figure 3 (width **≈30pp, n=50, k=3**) overlap at intermediate rounds, so per-round point tests are underpowered. The claim rests on the qualitative divergence of trajectories." This is an honest limitation and should be repeated when citing the 62%→50% vs 52%→72% comparison.

**2.8 Scale context the authors give.** "Recent self-evolution systems reach 68.9 (ACE) to 77.0 (AHE) on the full TB2-89 suite with a stronger backbone and ten rounds" — so this paper's absolute numbers are not comparable to leaderboard numbers.

---

## 3. Context pollution: injecting retrieved memories/history degrades performance

**3.1 Position of relevant information: the U-curve (the canonical result).**
[Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) (Liu et al., TACL 2024). Multi-document QA, 20 documents, GPT-3.5-Turbo: **75.8%** when the answer document is first → **53.8%** when it is in the middle → 63.2% when last (**−22.0pp** for identical content, reordered). 30 documents: 73.4% (first) → 50.5% (middle) → 63.7% (last). The paper's own printed claim: "GPT-3.5-Turbo's multi-document QA performance can drop by more than 20%—in the worst case, performance in 20- and 30-document settings is **lower than performance without any input documents** (closed-book 56.1%)." Marginal value of more retrieval is tiny: going 20 → 50 documents adds only "~1.5% for GPT-3.5-Turbo and ~1% for Claude-1.3."

**3.2 Irrelevant retrieved context can make things worse than not retrieving.**
[Making Retrieval-Augmented Language Models Robust to Irrelevant Context](https://arxiv.org/abs/2310.01558) (Yoran et al., ICLR 2024). Llama-2-13B few-shot, Self-Ask, Google Search retriever — **none / top-1 / top-10 / random**:
- NQ: 29.6 / 41.0 / 30.2 / 28.2
- 2WikiMQA: 32.0 / 56.0 / 33.0 / 27.0
- **StrategyQA: 65.6 / 62.1 / 60.4 / 58.4** — retrieval hurts even with a strong top-1
- Bamboogle: 47.4 / 68.0 / 41.4 / 39.5
- **Fermi: 27.7 / 27.4 / 24.0 / 22.1** — retrieval hurts
Paper text: "even with a strong retriever (top-1 Google search) incorporating the retrieved context actually **hurts** model performance on two of the benchmarks" and "When retrieving random passages, the performance of the In-Context RALM drops by **more than 10 points on average**."

**3.3 The counter-intuitive counter-result — do not overstate "noise always hurts."**
[The Power of Noise: Redefining Retrieval for RAG Systems](https://arxiv.org/abs/2401.14887) (Cuconasu et al., SIGIR 2024) finds the opposite for *topically unrelated* documents: "adding irrelevant documents up until the context length is filled is almost always beneficial, with gains in terms of accuracy up to 0.07 (**+35%**) in the case of 4 retrieved documents." What *does* monotonically hurt is **related-but-answer-free** documents: Llama2 gold-only **0.5642** → 16 related docs **0.2413**. The paper's own framing: "related documents are more harmful than unrelated ones." Any claim that "retrieval noise hurts" must specify which kind of noise.

**3.4 Distractors in the prompt (GSM-IC).**
[Large Language Models Can Be Easily Distracted by Irrelevant Context](https://arxiv.org/abs/2302.00093) (Shi et al., ICML 2023). GSM-IC, code-davinci-002, macro accuracy on problems solvable with clean context: CoT **6.0**, LtM **18.0**, Program **5.0** (vs 94–95 micro accuracy on the clean subset). Headline: "among the original problems that can be solved by baseline prompts with greedy decoding, **no more than 18% of them can be consistently solved for all types of irrelevant information**." Benchmark = 58,052 examples.

**3.5 Context rot with longer inputs.**
[Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://research.trychroma.com/context-rot) (Hong, Troynikov, Huber — Chroma technical report, 2025). 18 models, 194,480 LLM calls. Printed findings: "Even a single distractor reduces performance relative to the baseline (needle only), and adding four distractors compounds this degradation further." And, notably: "Across all 18 models and needle-haystack configurations ... models perform better on **shuffled** haystacks than on logically structured ones" — coherent context *hurts*. **[FIG]** The report's LongMemEval subset (306 prompts, ~113k "Full" vs ~300-token "Focused" input) shows large drops, e.g. Claude Opus 4 **0.92 → 0.38**, Claude Sonnet 4 **0.89 → 0.38**, GPT-4.1 **0.87 → 0.62**, Qwen3-8B **0.59 → 0.26**. These are read off the report's bar labels (no printed table), so treat as approximate.

**3.6 Long history degrades vs short history — with the mechanism named.**
[LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813) (Wu et al., ICLR 2025). Abstract: "long-context LLMs show a **30%~60% performance drop on LongMemEval_S**." Table 3 (Oracle → S): GPT-4o **0.870 → 0.606** (30.3% ↓); Llama 3.1 70B **0.744 → 0.334** (55.1% ↓); Llama 3.1 8B 0.710 → 0.454; Phi-3 14B 0.702 → 0.380. Also: commercial memory systems on a *10× shorter* history score far below GPT-4o offline reading — Offline Reading GPT-4o **0.9184** vs Coze-on-GPT-4o **0.3299**, Coze-on-GPT-3.5 **0.2474**.

**3.7 Multi-target interference: the memory system is the bottleneck, and it underperforms plain baselines on hard domains.**
[MINTEval: Evaluating Memory under Multi-Target Interference in Long-Horizon Agent Systems](https://arxiv.org/abs/2605.18565) (Lee, Chen, Singh, Khan, Stengel-Eskin, Bansal — UNC/UT Austin, 2026). 15.6k QA pairs, contexts averaging **138.8k tokens** (up to 1.8M), avg 86 temporally ordered updates. **All systems average 27.9% accuracy; the best (MemAgent) reaches 33.4%.** Directly relevant deltas:
- "memory management systems perform strongly on bAbI ... achieving an average improvement of **+9.9%** over non-memory baselines. However, on other domains with longer contexts and evolving revisions, these systems often **underperform the same baselines, with an average 3.0% drop**."
- Question-type collapse: simple recall avg **47.5%**, long-range lookback avg **21.0%**, multi-target aggregation avg **26.5%**.
- Error decomposition: memory-construction failures account for a **41.7%** performance drop; the answering stage a further **25.2%**.
- Memory-operation bias: systems are "strongly biased toward **insertion-based operations (avg. 76.8%)** instead of deletion or update."
- Even the state-of-the-art memory system fails: SimpleMem + Gemini-3.1-Flash-Lite + Gemini-Embedding-001 reaches **12.7% overall on Wiki Revisions, 8.8% on HorizonBench**, 32.2% on Git Commits, 67.7% on bAbI. Source: [MINTEval §C.6, Table 7](https://arxiv.org/html/2605.18565v2).
- Temporal cues mitigate interference: the lookback-step performance drop falls from **13.22 → 5.48** (Full Context) and **31.43 → 10.45** (RAG) when dates/timestamps are added.

**3.8 Memory pollution that scores below no-memory.** [TEPA: Revoking Stale Memories for Conflict-Robust Language Agents](https://arxiv.org/abs/2608.07429) (2026). Controlled drift, 50 seeds: append-only memory **0.210**, last-write-wins **0.210**, **no memory 0.309**, TEPA 0.950. "Degradation caused by active memories that newer conflicting evidence has superseded" — the polluted memory is *worse than having none*. (This is the paper's own term "memory pollution.") Replicated under real file execution: append-only 0.203, no memory 0.298, TEPA 0.950.

**3.9 Distractor-type taxonomy with large measured drops.** [Lost in the Noise: How Reasoning Models Fail with Contextual Distractors](https://arxiv.org/abs/2601.07226) (2026). ND = no distractor, RD = random documents, RC = irrelevant chat history, HN = hard negatives; average score across 11 datasets:
- Gemini-2.5-Pro **77.8 → 70.8 → 62.5 → 48.0** (up to **−38.3%**)
- Gemini-2.5-Flash 70.6 → 65.2 → 56.9 → 45.6
- DeepSeek-R1-0528 72.4 → 54.1 → 59.4 → 47.6
- gpt-oss-120b 72.0 → 61.1 → 54.9 → 50.2
- Qwen3-4B-Thinking 58.4 → 45.2 → 46.5 → 32.7 (**−43.9%**)
The paper reports an "inverse scaling trend where increased test-time computation leads to worse performance in noisy settings," and that SFT on noisy data *backfires*: Qwen3-4B under RD goes None 35.7 → Prompting 34.8 → **SFT 21.2 (−40.6%)**.

**3.10 Irrelevant-session accumulation with fixed evidence.** [When Stored Evidence Stops Being Usable: Scale-Conditioned Evaluation of Agent Memory](https://arxiv.org/abs/2605.07313) (2026). Evidence held fixed; irrelevant sessions added (s0 = 0 → s4 = 400 added sessions, ≈1.03M tokens/query), Pass@B reliability: Qwen3-235B + HippoRAG **84.8% → 68.8%** (↓16.0pp); Qwen3-32B + HippoRAG 82.6% → 63.5% (↓19.1pp); Qwen3-8B + HippoRAG 78.2% → 58.2% (↓20.0pp).

**3.11 Distractor memories collapse precision even when recall looks fine.** [Selective Memory Retention for Long-Horizon LLM Agents](https://arxiv.org/abs/2606.29178) (2026). Under a 75%-synthetic-distractor write stress, Precision@5: unbounded memory **20.2% → 12.4%**, FIFO-K50 **15.8% → 3.8%**. The paper notes "unbounded memory has the highest mean similarity (0.87) but lowest precision, indicating failed distractors close to the query in embedding space" — a crisp statement of why similarity-based retrieval degrades as the pool grows.

**3.12 Cooperative behavior degrades with longer memory ("The Memory Curse").** [The Memory Curse: How Expanded Recall Erodes Cooperative Intent in LLM Agents](https://arxiv.org/abs/2605.08060) (2026). 7 LLMs × 4 games × 500 rounds: "expanding accessible history degrades cooperation in **18 of 28** model–game settings." Examples: GPT-OSS-20B Prisoner's Dilemma **99.1% → 20.6%** as history length goes 1 → 80; Gemma-3-12B symmetric **51.2% → 9.5%**. The authors state the trigger is memory *content*, not length: replacing history with synthetic cooperative records at fixed length restores cooperation (Gemma-3-12B **9.5 → 84.00**). Ablating CoT *reduces* collapse: Llama-3.3-70B Trust Game **100.0% (no reasoning) → 6.9% (CoT)**, a −93.1pp "deliberation penalty." (Note: this is not a task-accuracy result — it is a behavioral-economics result, so cite it as such.)

**3.13 Generative Agents (Park et al., UIST 2023) — a correction to a commonly repeated claim.**
[Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442). Retrieval score = `α_recency·recency + α_importance·importance + α_relevance·relevance`, **all α = 1**; recency is exponential decay with factor **0.995**; reflection triggers when summed importance exceeds **150**. **Correction:** the paper's ablation (§6.5, Figure 8) is over **memory types**, not over the retrieval score components. TrueSkill μ: Full architecture **29.89 ± 0.72**; no reflection 26.88; no reflection + no planning 25.64; human-authored 22.95; effectively **no memory 21.21 ± 0.70** (Cohen's d = 8.16). **The paper does NOT ablate recency, importance, and relevance individually, and does NOT test a "more memories than needed" condition.** Any claim that it did is **UNSUPPORTED**.

**3.14 Qualifying evidence — the positional effect may be weaker in realistic RAG pipelines.**
[Do RAG Systems Really Suffer From Positional Bias?](https://arxiv.org/abs/2505.15561) (2025): "over 60% of queries contain at least one highly distracting passage among the top-10 retrieved passages," and "the impact of the LLM positional bias ... is actually marginal in real scenarios"; strategies that reorder passages by LLM positional preference "do not perform better than random shuffling." So the dominant harm is distractor *presence*, not distractor *position*.

---

## 4. Negative transfer / interference across domains and skills

**4.1 ExpeL's transfer section — the requested check. Result: ExpeL reports positive transfer, and its negative results are elsewhere.**
[ExpeL: LLM Agents Are Experiential Learners](https://arxiv.org/abs/2308.10144) (Zhao et al., AAAI 2024). §5.4 transfers insights extracted from HotpotQA to FEVER: Act 58 ± 0.0, ReAct 63 ± 0.4, **ExpeL Transfer w/o Task Demos 65 ± 1.7**, **ExpeL Transfer 70 ± 0.7** (Table 1). **No negative or zero cross-domain transfer case is reported in ExpeL.** What ExpeL *does* report as negative:
- **Adding reflections to insight extraction HURTS:** HotpotQA success rate — **hand-crafted insights 32.0 ± 1.1 > insights-with-reflections 29.0 ± 0.4** (ReAct baseline 28.0; full ExpeL 39.0). Paper text: "using reflections in addition to success/failure pairs and lists of successes is **disadvantageous**, possibly due to **reflections sometimes outputting hallucinations**, therefore misleading the insight extraction stage."
- **Similarity-based selection beats random by a large margin, but reasoning-similarity is worse than task-similarity:** ALFWorld — ReAct 40.0, reasoning similarity 48.5 ± 2.1, **random sampled 42.5 ± 0.8** (near-baseline), ExpeL 59.0 ± 0.3.
- **Insights extracted from in-context few-shots alone give no advantage over ReAct** (Fig. 6).

**4.2 Voyager's "w/o skill library" ablation numbers — the requested check.**
[Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) (Wang et al., 2023). Ablation numbers are printed in the tech-tree and zero-shot tables:

| Method | Wooden | Stone | Iron | Diamond |
|---|---|---|---|---|
| AutoGPT | 92 ± 72 (3/3) | 94 ± 72 (3/3) | 135 ± 103 (3/3) | N/A (0/3) |
| **Voyager w/o Skill Library** | **7 ± 2 (3/3)** | **9 ± 4 (3/3)** | **29 ± 11 (3/3)** | **N/A (0/3)** |
| Voyager (full) | 6 ± 2 (3/3) | 11 ± 2 (3/3) | **21 ± 7 (3/3)** | **102 (1/3)** |

(Numbers = prompting iterations averaged over 3 trials; fewer is better. Source: [Table 1](https://arxiv.org/html/2305.16291v2).) Zero-shot generalization to unseen tasks: **Voyager w/o Skill Library fails Diamond Pickaxe (2/3, 36 iters vs 19 ± 3 for full)** and needs 30 ± 9 / 27 ± 9 / 26 ± 3 for the other three, vs 18 ± 7 / 21 ± 5 / 18 ± 2 for full. The textual ablation finding: "**Voyager w/o skill library exhibits a tendency to plateau in the later stages**" and, unlike full Voyager, **never unlocks the diamond tier in any run (0/3)**. For calibration, the paper's other ablations: random curriculum **−93%** discovered items; no self-verification **−73%**; GPT-3.5 instead of GPT-4 yields **5.7× fewer** unique items. **[FIG]** The exact item-count curve for "w/o skill library" is plotted in Fig. 9 and is not printed numerically; the paper's own summary is qualitative ("tendency to plateau").

**4.3 A direct systematic measurement of negative transfer in model-generated skills.**
[From Raw Experience to Skill Consumption: A Systematic Study of Model-Generated Agent Skills](https://arxiv.org/abs/2605.23899) (Huang, Xu, Yang, Gong, Yang, Tian, Wang, Lv, Gao, Dai, Liu, Qiu, Yang, Chen, Zheng, Luo — Fudan + Microsoft Research, 2026). Five domains, six target models, five extractor models.
- **"25% of entries have Δ < 0, meaning that applying extracted skills degrades the target's performance."** (75% of entries positive.)
- **Domain dependence:** SpreadsheetBench and SWE-bench-Verified have the lowest negative rates (**13%**); **ALFWorld is the most fragile domain (47%)**.
- **The same skill, different consumers, opposite signs.** ALFWorld: GPT-5.4 benefits from all five extractors (**TE = +4.93**), while **Gemini-3.1-Flash-Lite, Qwen3.5-35B, and Qwen3.5-9B all have negative TE**.
- Cross-model skill transfer, SpreadsheetBench, same skill text: the strong-pool skill ranges from **+1.8 (Gem-3.1-Pro) to +9.5 (Qwen3.5-35B)**; the weak-pool skill produces "clear negative transfer on some targets (**e.g. −2.0 on GPT-5.4**)."
- **"Better executor is not necessarily better extractor."** On SpreadsheetBench, lightweight Gemini-3.1-Flash-Lite achieves the highest extractor efficacy while GPT-5.4 ranks **last** despite the strongest baseline.
- **Textual plausibility anti-predicts utility:** a "plausibility rubric (7-dim)" **hurts most times** (e.g. ALFWorld −1.1, SpreadsheetBench −1.5), while a validated 3-dim rubric improves all cells.

**4.4 Skill-library interference in the SRA pipeline (2026).** [Skill Retrieval Augmentation for Agentic AI](https://arxiv.org/abs/2604.24594) (Su et al., Tsinghua + ByteDance). Full skill injection degrades as more skills are exposed: "as k continues to grow, its performance typically declines... additional full skill contents can introduce **inter-skill interference**, distract the model from the truly useful capabilities, and perturb downstream reasoning." Adding hard-negative distractors "consistently degrades end-task performance" **even when the gold skill is already in the candidate set**. Concrete regressions vs direct answering: Llama-3.1-8B on ToolQA Full-Skill Injection **13.6 vs LLM Direct 16.7**; overall average Full-Skill Injection **32.7 vs 29.8** direct but far below Oracle Skill 44.5.

**4.5 Self-evolution's own ablations show sub-modes that reduce performance.** (Already covered in §1–2.) Additional: [SkillsVote](https://arxiv.org/abs/2605.18401) (2026) explicitly titles a section "**Recommendation Controls Negative Transfer**," and its own main table shows the online setting *hurting* the hard tier: GPT-5.2 Terminal-Bench 2.0 Hard **40.7 → 34.0 (↓6.7pp)** with online skill accumulation, and GPT-5.4-mini Easy **75.0 → 65.0 (↓10.0pp)** in the offline library transfer.

**4.6 Retrieval itself can be worse than no retrieval (a retrieval-layer negative transfer).** [SE-GoS: Self-Evolving Graph-of-Skills for Skill Library at Scale](https://arxiv.org/abs/2609.08228) (Fu, Jiang, Qian, Wang, Hao, 2026), held-out SkillsBench 37-task split (n=74): **Vanilla 44.8 vs Vector retrieval 38.1** — vector skill retrieval scores **6.7 points *below* no-retrieval-at-all**.

**4.7 Cross-domain memory transfer produces measured negative deltas in coding agents.**
[Memory Transfer Learning: How Memories are Transferred Across Domains in Coding Agents](https://arxiv.org/abs/2604.14004) (2026). 6 coding benchmarks, 100 sampled tasks each, Pass@3, `gpt-5-mini`, mini-swe-agent, N=3 retrieved memories. Zero-shot → MTL (memory format T/W/S/I = Trajectory/Workflow/Summary/Insight):
- GPT-5-mini zero-shot values: LCB 0.910, Aider-Polyglot 0.470, SWE-bench-Verified 0.730, TerminalBench2 0.315, ReplicationBench 0.111, MLGym-Bench 0.667, **Avg 0.523**. **MTL (T)**: TerminalBench2 **0.315 → 0.270 (−4.5pp)**, MLGym-Bench **0.667 → 0.583 (−8.4pp)**. **MTL (W)**: MLGym-Bench 0.583 (**−8.4pp**). **MTL (S)**: Aider-Polyglot **0.470 → 0.460 (−1.0pp)**.
- DeepSeek V3.2 printed Δ row: `+1.0%, −1.0%, +6.0%, +5.6%, +1.1%, +8.3%, +2.6%` — **Aider-Polyglot negative**.
- Qwen3-Coder-480B printed Δ row: `+1.0%, +2.0%, +3.0%, +3.4%, 0.0%, 0.0%, +1.8%` — **two exact-zero-transfer cells** (ReplicationBench, MLGym-Bench).
- Table 4: task-specific Insights Avg **0.523** vs task-agnostic **0.534** (Δ +1.1%).
- Named failure modes (§4.4.1): "**Domain-mismatched anchoring**," "**False validation confidence**," "**Misapplied best-practice transfer**"; low-abstraction trajectory memories "act as a brittle anchor" and "induce negative transfer due to excessive specificity."

**4.8 A held-out continual benchmark where most memory methods lose to no memory.**
[PATH-Bench / Selective Experience Use](https://arxiv.org/abs/2608.01149) (2026). BigCodeBench + WildToolBench, probe intervals 6–12, 100 intervening tasks, 50 sequences × 5 runs, DeepSeek-V4-Flash. AP (%), with Forward Transfer (FWT) in pp:
- Memory-free baseline: **BCB 70.18 / 67.67**; **WTB 42.80 / 43.00**.
- **AWM: BCB 65.56 (FWT −4.67) / 61.95 (FWT −8.36)** — underperforms the memory-free baseline in **both** conditions.
- BGE-M3 RAG: BCB 69.97 / 67.37 (both below baseline); WTB 45.52 / 45.32.
- **HippoRAG-v2: WTB 41.70 (FWT −2.61) / 41.67 (FWT −0.54)** — both below baseline; BCB negative-dominant FGT **16.15pp**.
- Clin: BCB 68.92 / 67.11 (both below). SimpleMem: BCB 68.98 / 66.44; WTB FWT −0.62. **MemRL: BCB FWT −3.44 / −5.32. AutoSkill: WTB FWT −5.08 / −3.89. SkillClaw: BCB FWT −1.89 / −4.74, WTB −0.77 / −1.21.**
Paper's conclusion: "On BigCodeBench, BGE-M3 RAG, Clin, AWM, and SimpleMem underperform the baseline in both conditions; on WildToolBench, HippoRAG-v2, AutoSkill, and SkillClaw do so in both conditions... **the bottleneck is not the capacity to store experience but the ability to judge whether stored experience is useful.**"

**4.9 A measured scaling law: routing accuracy decays logarithmically with library size.**
[The Scaling Laws of Skills in LLM Agent Systems](https://arxiv.org/abs/2605.16508) (2026). 15 frontier LLMs, 1,141 real-world software-agent skills, >3M routing/execution decisions, N ∈ {10, 20, 50, 100, 200, 500}, n=500 tasks/condition. Fitted routing law **Acc(N) = a − b·ln N, with R² > 0.97 for every one of the 15 models** — adding skills to a library *logarithmically degrades routing accuracy*. Error progression: local skill competition → cross-family drift → capture by overly general "**black-hole skills**." Danger band of skill similarity **[0.55, 0.75)** shows the strongest negative correlation with accuracy. Tight dependency pairs "**lose over 15%**" when upstream state is wrong (loose pairs gain 2.8%). Law-guided repair moves held-out routing accuracy **71.3% → 91.7%** and in-library hijack **22.4% → 4.1%**; ClawBench 49.3% → 61.6%, ClawMark 28.4% → 34.5%.

**4.10 Optimizers and multi-skill injection that fail to compound.**
- [Do Agent Optimizers Compound? A Continual-Learning Evaluation on Terminal-Bench 2.0](https://arxiv.org/abs/2607.14004) (2026): GEPA scores **70.8%** on Phase 1 but transfers at **54.5%**, **below the 56.8% unoptimized baseline** — "GEPA transfers negatively." Its prompt grows 5 → 103 → 195 lines of per-task lessons. Meta Harness: "every candidate generated during the second optimization round performed worse than the existing agent" → 59.1% (vs 68.2% transfer).
- [From Procedural Skills to Strategy Genes](https://arxiv.org/abs/2604.15097) (2026), 4,590 controlled trials, 45 scientific-code scenarios: the compact "Gene" yields **+3.0pp** while the documentation-style "Skill" package incurs **−1.1pp**. Augmenting a Gene with API notes drops **54.0% → 51.5%**; adding examples **52.0%**. Multi-object interference: **two *complementary* Genes give the worst result, 44.9%** (below no-guidance and all other multi-Gene settings), while two *conflicting* Genes remain competitive at **53.2%** — "multiple partially relevant control objects may compete for attention and jointly blur the intended control signal, even when they are nominally compatible."
- [Trace2Skill](https://arxiv.org/abs/2603.25158) (2026): a 35B-authored skill gives a 122B model only **+0.009 ANLS** but **degrades the 35B source model by −0.062 ANLS (−6.2pp accuracy)**; the `+Success`/Deepening condition is "the only condition that drops below baseline (**−0.9pp**)."
- [EvolveR](https://arxiv.org/abs/2510.16079) (2025/2026), Qwen2.5: teacher-distilled (GPT-4o-mini) experiences **hurt at larger scale** — 3B Avg **0.382 (self-distill) → 0.370 (teacher-distill)**, with PopQA 0.434 → 0.359 and Bamboogle 0.328 → 0.288 (only 2wiki rises 0.381 → 0.437); 1.5B 0.358 → 0.352; at 0.5B teacher-distillation *helps* (0.150 → 0.220). Removing experience retrieval collapses 3B 0.382 → 0.340 and 1.5B 0.270 → 0.123.
- [AgentOptimizer / Offline Training of LM Agents with Functions as Learnable Weights](https://arxiv.org/abs/2402.11359) (ICML 2024): "The function updates suggested by the AgentOptimizer **may cause performance degradation**"; roll-back and early-stop are required. The "w/o Progressive Function Update" variant is "even exhibited **worse performance** than the origin GPT-4+ agent" on MATH Intermediate Algebra (28.8 vs 30.0) and Counting & Probability (70.0 vs 72.5); batch training drops test performance "by **7.8%**."
- [SkillOps](https://arxiv.org/abs/2605.13716) (2026), ALFWorld, 229 SkillsBench skills + degraded variants, library scales 200–2000, 3 seeds: drop-in maintenance Δ ranges from **ReAct +0.00pp** and **LLM Skill Planner +0.50pp** up to Hybrid Retrieval +2.90pp. Conflict finding: "maintenance benefits are method-conditional ... **self-repairing agents may conflict with external maintenance**" — SkillWeaver's task-time honing loop requests extra context when SkillOps has already removed degraded candidates (token usage **+0.50% at lib=1000, +0.48% at lib=2000**). Rule-based maintenance "can miss semantic redundancy or **complex skill conflicts** that require deeper reasoning."
- [Dynamic Cheatsheet](https://arxiv.org/abs/2504.07952) (2025): "GPT-4o-mini ... showed even smaller gains, with **some variants leading to slight declines** in performance. On AIME 2024, DC-∅ provided a 20.0% boost, but both **DC-Cu and DC-RS performed worse than baseline**." On GPQA-Diamond, GPT-4o-mini's performance "remained largely stagnant or slightly declined under memory-based adaptation." Transferring a strong model's memory to a weaker one: "if a smaller model lacks the generative capacity to interpret or refine those strategies correctly, its performance can **stall or degrade**."
- [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) (Wang et al. 2024), Mind2Web, gpt-4 (EA / AF1 / Step SR / task SR): **AWM offline cross-domain task SR 0.7 vs MindAct baseline 1.0**, and Action F1 below baseline in cross-website (**46.2 vs 51.1**) and cross-domain (**41.6 vs 52.8**). The paper: "AWM online induces workflows from model-predicted trajectories that are not always correct, thus can lead to incorrect workflows that **degrade** model performance." Text-format workflows raise EA/Step SR by 0.6/0.3 but **degrade task SR 4.8 → 3.6**.
- [ReasoningBank](https://arxiv.org/abs/2509.25140) (2025): on WebArena "Multi," "strong baselines such as **AWM fail to provide gains and even degrade**." Scaling rollouts *reduces* AWM (44.4 → 41.2); adding failure trajectories *reduces* AWM (44.4 → 42.2). Retrieved-experience count on WebArena-Shopping: no memory **39.0** → 1 experience **49.7** → 2 **46.0** → 3 **45.5** → 4 **44.4** ("excessive experiences may introduce conflicts or noise").
- [AutoManual](https://arxiv.org/abs/2405.16247) (ICLR 2024), ALFWorld, GPT-4-turbo: without the Skill & Reflection Libraries success drops **97.4% → 89.5%**, and "using plain experiences without inducing rules will lead to **Path Dependency**." Rule-attribute ablation: removing "Type" gives **86.2% → 74.6%** and **97.4% → 91.5%**.
- [CASCADE: Cumulative Agentic Skill Creation](https://arxiv.org/abs/2512.23880) (2026): "An exception is noted with **GPT-4.1**, which exhibits optimal performance in the **absence** of continuous learning ... the introduction of continuous learning tools and prompts may act as **extraneous interference**, hampering the agentic system's efficiency." A companion CASCADE paper notes baselines DC and ACE "can even lead to performance degradation when applied to weaker open-source backbone LLMs." (Exact cell values not recoverable — see GAPS.)

**4.11 Continual / multi-task fine-tuning shows the same interference at the weight level.**
- [TRACE: A Comprehensive Benchmark for Continual Learning in LLMs](https://arxiv.org/abs/2310.06762) (2023), Table 1, OP(BWT): LLaMA-2-7B-Chat ICL 38.9 → **LoRASeqFT 12.7 (−45.7%)**; LLaMA-2-13B **28.0 (−36.5%)**; Vicuna-7B **33.4 (−23.7%)**; Vicuna-13B **31.6 (−28.4%)**. General-ability forgetting: LLaMA-2-7B-Chat **GSM 26.08 → 3.49** under sequential FT (ΔR = −2.58), and **ΔR = −7.03** under LoraSeq. "Nearly all models display a negative General Ability Delta... **Larger models ... show a more pronounced forgetting.**"
- [SEEKR](https://arxiv.org/abs/2411.06171) (EMNLP 2024), SuperNI, LLaMA-2-7B, OP with (BWT) Order3/Order4: **O-LoRA 30.07 (−24.47) / 26.70 (−33.82)**; L2P 32.71 (−22.34); SeqFT 42.62 (−18.12); Replay 55.00 (−4.27). Multi-task upper bound 61.27.
- [Do Text-to-Text Multi-Task Learners Suffer from Task Conflict?](https://aclanthology.org/2022.findings-emnlp.206/) (Findings of EMNLP 2022), T5-Base, 3 seeds: GLUE canonical average **single-task 78.06 → multi-task 76.20 (−1.86)**, with **CoLA −5.93**, MNLI −2.13, MNLI-mm −2.28, QNLI −2.12; DecaNLP **Seq2SQL 60.28 → 57.25 (−3.03)**, IWSLT −1.78. Framing MTL as text-to-text does **not** remove negative transfer.
- [Decomposing the Basic Abilities of LLMs: Mitigating Cross-Task Interference in Multi-Task Instruct-Tuning](https://openreview.net/forum?id=FFAHL32Wok) (ICML 2026): "**cross-task interference, due to conflicting gradients over shared parameters** among different tasks"; "the cross-task interference **still exists for the existing solutions**" (SuperNI, 6 LLMs). Exact per-task deltas **NOT FOUND**.
- [Disentangling Task Interference within Neurons](https://arxiv.org/abs/2503.05320) (2025), T5-Large: retaining the orthogonal neuronal subspace (removing the parallel one) preserves **88.0% in-domain, 53.9% out-of-domain, avg 58.8%**; keeping the parallel subspace and removing the orthogonal one causes "a significant performance drop." Model-level averaging "often results in performance degradation."
- [Interpretable Catastrophic Forgetting of LLM Fine-tuning via Instruction Vector](https://arxiv.org/abs/2406.12227) (2024): continual instruction tuning decreases general-set **instruction accuracy by 10.24** while knowledge accuracy rises 1.93; recovering with ICL gives an average **decrease of 14.67** vs zero-shot; last-task Spanish accuracy **65% → 1%**; CommonsenseQA 0-shot/10-shot falls to **0.03 / 0.15**.

---

## 5. Skill libraries whose retrieval never fires / skills never reused — usage-rate numbers

This is the best-evidenced section. Multiple independent measurements agree that **low skill utilization, not low skill quality, is the dominant failure mode**.

**5.1 Agents fail to load skills even when they are handed the right ones.**
[How Well Do Agentic Skills Work in the Wild](https://arxiv.org/abs/2604.04323) (Liu, Ji, An, Jaakkola, Zhang, Chang — UCSB/MIT, 2026). 34,198 real-world skills; 84 SkillsBench tasks; agentic hybrid retrieval with Recall@5 = 65.5%, Recall@10 = 68.3%. Loading rates and pass rates:

| Condition | Claude Opus 4.6 pass / load | Kimi K2.5 pass / load | Qwen3.5-397B pass / load | No-skill baseline |
|---|---|---|---|---|
| Curated + **forced** load (upper bound) | **55.4%** | 38.5% | 41.2% | — |
| Curated, agent decides | 51.2% / **62.2%** | 38.9% / **86.1%** | 31.6% / 73.8% | 35.4 / 21.8 / 20.5 |
| Curated + distractors | 43.5% / **31%** | — | 33.7% | — |
| Retrieved (w/ curated) | 40.1% / 44.4% | 33.5% / 69.7% | 26.7% / 65.5% | — |
| **Retrieved (w/o curated)** | 38.4% / **16.3%** | **19.8% / 37.7%** | **19.7% / 54.8%** | 35.4 / 21.8 / 20.5 |

Key measured facts: **only 49% of Claude trajectories load all curated skills when they are directly available, falling to 31% with distractors**; under retrieval the loading rate drops to 44%, and to **16.3%** when curated skills are removed. **Two models fall *below* their own no-skill baseline** (Kimi 19.8% vs 21.8%; Qwen 19.7% vs 20.5%) — "irrelevant retrieved skills can actively mislead the agent." The paper's summary: "agents struggle to recognize relevant skills from their names and descriptions alone." Counter-example worth noting: Kimi loads skills at 86% but gains nothing (38.9% vs 38.5% force-loaded) — "skill utility involves not just loading skills but also effectively utilizing their content."

**5.2 A controlled measurement of skill-loading rate across 8 models / 6 datasets.**
[Skill Retrieval Augmentation for Agentic AI](https://arxiv.org/abs/2604.24594), Table 6 — "skill loading rate measures whether the agent successfully incorporates at least one valid skill before producing the final answer" (5,400 instances):

| Model | Overall skill-loading rate |
|---|---|
| Llama-3.1-8B | **72.1%** |
| Qwen3-235B | 54.1% |
| GLM-5.1 | 37.8% |
| GPT-5.4 | 31.2% |
| Mistral-24B | 28.3% |
| Qwen3-4B | **21.0%** |
| Qwen3-32B | 20.1% |
| Llama-3.3-70B | **11.1%** |

Per-dataset floors are far lower: ToolQA 0.6% (Qwen3-32B), 1.5% (Qwen3-235B); CHAMP 0.9% (Llama-70B), 1.8% (Qwen3-32B); BigCodeBench **0.0%** (Llama-70B). Two further findings: (a) loading is **not** relevance-aware — "for most open-source models, the presence of a gold skill in the retrieved candidate pool has only limited influence on whether the agent decides to load a skill," and models "still load skills at substantial rates even when no gold skill is present in the BM25 top-50," which the authors call "**skill-loading hallucination**"; (b) need-awareness is absent — partitioning by whether the model can solve the task without skills gives **overall ∆Load = +0.1pp** (36.9% vs 36.9%): models load skills at the same rate whether or not they need them. Llama-8B is *less* likely to load when it needs help (**−15.1pp**).

**5.3 Skills that have never been invoked — a first-party vendor feature and vendor bug reports.**
- Anthropic's own Claude Code Skills documentation tells users to audit this: "**Every skill in the skill listing adds to your context on every turn, whether or not Claude ever uses it.** Run `/skill-doctor` ... It **flags skills in the listing that have never been invoked**." Source: [https://code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills).
- [anthropics/skills#556](https://github.com/anthropics/skills/issues/556) (OPEN): "**no query ever triggers the skill — all should-trigger queries get 0/3 trigger rate**"; "Tested with 8 different skills (144 total queries ...). Every should-trigger query scored 0/3 triggers."
- [anthropics/claude-code#36570](https://github.com/anthropics/claude-code/issues/36570): "Skills are never triggered. Every should-trigger query returns rate=0/3" — **CLOSED as `not planned`**.
- [anthropics/skills#996](https://github.com/anthropics/skills/pull/996) (PR): "`run_eval.py` reported **0% recall for every query**, so `run_loop.py` was optimizing against a metric that was always zero."
- [openai/codex#34321](https://github.com/openai/codex/issues/34321) (OPEN, `bug`): "the plugin contributes **zero skills** to `<skills_instructions>` ... **Installed, enabled, and invisible — simultaneously.**"
- [anthropics/claude-plugins-official#3174](https://github.com/anthropics/claude-plugins-official/issues/3174): "recall = 0% / precision = 100% / accuracy = 50% ... the target skill is **never** detected as triggering."

**5.4 A store pre-seeded with the right answers produced zero reads.**
[Delivery-Not-Storage / decay-probe study](https://arxiv.org/abs/2607.20972) (2026): with a memory store **pre-seeded with task-relevant facts**, tools connected, and explicit guidance, the agent made "**zero memory calls in 114 turns**." In unseeded equipped runs, **0–1 voluntary writes across 5 runs** despite 32 mentions of memory guidance. The paper's framing: "**Knowledge present in a store contributes nothing by itself.**" Related measurement from the same paper: 10 facts held only in conversation → **106 of 108** continuation summaries carried **0/10** facts; every summary was all-or-nothing.

**5.5 Registry-scale skill reuse is mostly one-time copying.**
[From Registry to Repository: How AI Agent Skills Are Written, Adapted, and Maintained](https://arxiv.org/abs/2607.00911) (Gao, Lulla, Lin, Baltes, Treude, Zahedi, 2026). Mined **18,463 skills from skills.sh** and **23,199 personal-use skills from 5,876 GitHub repos**, identifying **3,709 reuse links**. "Reuse is largely a **one-time copy operation**: most reused skills remain near-verbatim, **53% are never modified after adoption**, and subsequent local maintenance is overwhelmingly additive." A stable behavioral contract "remains almost untouched." The paper also notes registries "now host tens of thousands of skills" and references prior work (Ling et al.) that "identified a **supply-demand imbalance**."

**5.6 Retrieval quality is necessary but not sufficient (the usage–utility gap, stated formally).**
[Skill Retrieval Augmentation for Agentic AI](https://arxiv.org/abs/2604.24594) §5.5: "**retrieval quality is a necessary but insufficient condition for strong SRA performance** ... Better retrieval should therefore be understood as increasing the likelihood of successful skill use, rather than guaranteeing it." And: "there is a substantial disconnect between retrieval success and effective utilization."

**5.7 Related: retrieval never fires in agent memory, measured on the storage side.**
[Forgetting Exactly What Matters](https://arxiv.org/abs/2606.29178) / [Delivery-Not-Storage](https://arxiv.org/abs/2607.20972) plus [TEPA](https://arxiv.org/abs/2608.07429) all report that the *store* grows while the *use* does not. TEPA's operational finding: memory-operation distributions are dominated by insertion (MINTEval reports **76.8%** insertion bias across memory systems), so stale entries are never revoked.

---

## 6. Benchmark saturation making effects unmeasurable, and gains that vanish on stronger models

### 6a. Memory/reflection gains that are exactly zero or negative on strong backbones

**6.1 Evo-Memory cross-backbone table — memory methods tie or trail the no-memory baseline.**
[Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory](https://arxiv.org/abs/2511.20857) (2025), Table 5, average across AIME24/AIME25/GPQA/MMLU-Pro/ToolBench:

| Backbone | Baseline | History | Mem0 | MemOS | AWM | ReMem | ExpRAG |
|---|---|---|---|---|---|---|---|
| Claude 3.5 | 0.38 | 0.38 | **0.38** | **0.38** | 0.37 | 0.41 | 0.41 |
| Claude 3.7 Sonnet | 0.54 | 0.55 | **0.55** | **0.55** | **0.48** | 0.58 | 0.59 |
| Gemini 2.5 Flash | 0.59 | **0.55** | **0.59** | **0.59** | 0.56 | 0.65 | 0.60 |
| Gemini 2.5 Flash-Lite | 0.58 | **0.49** | **0.58** | **0.58** | **0.44** | 0.61 | 0.61 |

Mem0/MemOS are **exactly equal to the no-memory baseline on three of four backbones**; AWM is *below* baseline on Claude 3.7 (0.48 vs 0.54) and Flash-Lite (0.44 vs 0.58); Gemini's own "History" baseline (0.55) is *below* its no-memory (0.59). The paper's own conclusion is that "smaller models benefit most" and gains correlate with intra-dataset task similarity (Pearson r = 0.717 Gemini Flash) — i.e. **gains are an artifact of low task diversity**.

**6.2 A matched-backend study whose effects are inside noise.**
[MemoryLake on MemoryArena: A Matched Study of Agent Memory Backends](https://arxiv.org/abs/2608.13883) (2026): same agent framework, gpt-5-mini. Web-shopping step match: long context **30.0%**, vector RAG **29.7%**, MemoryLake **29.6%**, Mem0 24.3% — "within **0.4 percentage points over 900 steps**, which this sample cannot resolve as a separation." Travel planning success rate = **0.0 for every system**. The authors state they "do not report paired significance tests" and "the evidence does not establish statistical significance ... or a causal effect of any single representation mechanism."

**6.3 Explicit null tables.** [MemDelta](https://arxiv.org/abs/2606.29914) (2026), LongMemEval-S, GPT-4o-mini, n=500: verifier-free verbatim RAG **47.2%** vs **full context 49.8%** → "+2.6pp gap that is **NOT statistically significant (p = 0.34)**." Same-instance 88-question comparison: Mem0 **72.7%** vs cloud-embedding verbatim RAG **73.9%** → "Mem0 loses by 1.2pp, **p = 1.0** (McNemar), 90% CI [−10.8, +8.4]pp" while costing "1,000+ LLM calls, ~120 min, $0.50+/instance vs 60s / 0 calls / $0.01." Negative per-category deltas in the same table: Knowledge-Update **Δ = 0.0**, SS-Assistant **−5.4**, SS-Preference **−10.0**.

**6.4 Mem0's own paper table contains the refutation.** [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) (Chhikara et al., 2025), Table 1 (LOCOMO, GPT-4o-mini). Three self-undercutting facts: (a) **Zep beats both Mem0 variants on Open-Domain** (76.60 vs 75.71/72.93); (b) **Mem0g graph memory is worse than base Mem0** on Single-Hop (65.71 vs 67.13) and Multi-Hop (47.19 vs 51.15); (c) the "26% over OpenAI" claim rests on OpenAI's Temporal score of **21.71** measured with no selective retrieval. Independent reproduction failures: [mem0#3944](https://github.com/mem0ai/mem0/issues/3944) (LoCoMo LLM score "**around 0.20**" on the official platform script), [#3943](https://github.com/mem0ai/mem0/issues/3943) ("between **30% and 50%**, far below the 60% reported in the paper"), [#2800](https://github.com/mem0ai/mem0/issues/2800). [MemoryAgentBench](https://proceedings.iclr.cc/paper_files/paper/2026/hash/fd1eff9dd295df50a41f2521942fa31d-Abstract-Conference.html) (ICLR 2026) overall: **GPT-5-mini long-context 60.6** > Sonnet-3.7 49.6 > GPT-4o 48.8 > HippoRAG-v2 41.6 > BM25 41.5 > MIRIX 37.7 > **Zep 24.0 > Mem0 21.1 > Cognee 20.6**. **[SEC]** The overall-J figures (Mem0 66.88 / Mem0g 68.44 / full-context 72.9) are from a third-party analysis, since the arXiv HTML is truncated; the direction is corroborated first-party by Zep's engineering blog: "Mem0's own results show their system being outperformed by a simple full-context baseline ... **~73%**, compared to Mem0's best score of **~68%**" ([Zep, 2025](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)). Mem0 disputes parts of Zep's analysis ([getzep/zep-papers#5](https://github.com/getzep/zep-papers/issues/5)); treat the Mem0↔Zep dispute as unresolved and symmetric.

**6.5 A-MEM: published numbers vs third-party re-run.** [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) (2025). **[SEC]** Published (LoCoMo, GPT-4o-mini): MultiHop F1 27.02, Temporal 45.85, OpenDomain 12.14, SingleHop 44.65. Third-party re-run at temperature 0 as printed in the Mem0 paper's Table 1 (a competitor, but a public printed table): Single-Hop **20.76**, Multi-Hop **9.22**, Open-Domain **33.34**, Temporal **35.40** — all below the published figures. **[SEC]** for the published figures; the re-run numbers are first-party printed in [arXiv HTML](https://arxiv.org/html/2504.19413v1).

**6.6 Memory turns on and accuracy goes *down* while sycophancy goes *up*.**
[MemSyco-Bench](https://arxiv.org/abs/2607.01071) (2026), Qwen3-8B, Objective Fact Judgment (No-Memory baseline 49.12):
- Full Dialog **30.62 (−18.50)**, sycophancy +17.24
- **Mem0 35.67 (−13.45)**, sycophancy **+18.58**
- LightMem 34.67 (−14.45), sycophancy +27.57
- **MemGPT 30.00 (−19.12)**, sycophancy **+33.24**
- MemoryBank 31.67 (−17.45), sycophancy +27.57
- A-Mem 36.00 (−13.12), sycophancy +17.04
- NaiveRAG 34.00 (−15.12), sycophancy +18.57

Contextual Scope Control collapses: **Mem0 13.34 (−56.66)**, LightMem 13.67 (−56.33). Adding a plausible-but-wrong memory snippet cuts accuracy for all three tested models, largest **DeepSeek-V4-Flash 56.1% → 40.2%**, with sycophancy **24.3% → 52.3%**. "Outdated Memory" rates get *worse* with memory: A-Mem **+8.69**, LightMem **+13.75**.

### 6b. Published critiques of Reflexion-style self-reflection (the requested cluster)

**6.7 "Large Language Models Cannot Self-Correct Reasoning Yet"** — [Huang et al., ICLR 2024, arXiv:2310.01798](https://arxiv.org/abs/2310.01798). Intrinsic self-correction **drops accuracy on every model and every benchmark** (Table 3/4):

| Model | Standard | round 1 | round 2 |
|---|---|---|---|
| GPT-3.5 — GSM8K | 75.9 | 75.1 | 74.7 |
| GPT-3.5 — **CommonSenseQA** | 75.8 | **38.1** | 41.8 |
| GPT-3.5 — HotpotQA | 26.0 | 25.0 | 25.0 |
| GPT-4 — GSM8K | 95.5 | 91.5 | 89.0 |
| GPT-4 — CommonSenseQA | 82.0 | 79.5 | 80.0 |
| GPT-4 — HotpotQA | 49.0 | 49.0 | **43.0** |
| GPT-4-Turbo — GSM8K | 91.5 | 88.0 | 90.0 |
| **Llama-2-70b — GSM8K** | 62.0 | **43.5** | **36.5** |
| **Llama-2-70b — CSQA** | 64.0 | **37.5** | **36.5** |

With **oracle** labels instead, everything improves (GPT-3.5 GSM8K 75.9 → 84.3; GPT-4 95.5 → 97.5), which is the paper's core claim: "the improvements in these studies result from using oracle labels ... and the improvements **vanish** when oracle labels are not available." Additional: on GSM8K, "74.7% of the time, GPT-3.5 retains its initial answer," and when it does change it is "more likely to modify a correct answer to an incorrect one than to revise an incorrect answer to a correct one." Multi-agent debate **underperforms plain self-consistency** at equal response count (GSM8K: debate r2 83.0 at 9 responses vs self-consistency 88.2 at 9).

**6.8 Self-Refine's real numbers and the systematic critique.**
[Self-Refine](https://arxiv.org/abs/2303.17651) (Madaan et al., NeurIPS 2023). Its *own* math-reasoning results are flat: GPT-3.5 64.1 → 64.1 (**0**), ChatGPT 74.8 → 75.0 (**+0.2**), GPT-4 92.9 → 93.1 (**+0.2**), with the paper noting "ChatGPT feedback for **94% instances is 'everything looks good'**."
[When Can LLMs Actually Correct Their Own Mistakes? A Critical Survey](https://aclanthology.org/2024.tacl-1.78/) (Kamoi et al., TACL 2024). Flags Self-Refine for "**unfairly weak or wrong instructions or few-shot demonstrations for initial response generation**," flags Reflexion for oracle use (exact match to gold answers) and RCI Prompting for oracle use, and concludes: "**no major work shows successful self-correction of responses from LLMs using feedback generated by prompting themselves under fair settings in general tasks.**" The bottleneck is **feedback generation**.
[Self-[In]Correct: LLMs Struggle with Refining Self-Generated Responses](https://arxiv.org/abs/2404.04298) (AAAI 2025): discrimination is not reliably better than generation; task-average difference GSM8K **−0.61**, TriviaQA **−1.67**, MT-Bench **−0.15**.
[Sample More, Reflect Less](https://arxiv.org/abs/2607.28576) (2026), equal generated-token budget vs self-consistency, 150 paired questions: "**0 are significantly better than self-consistency at matched token cost, 10 are significantly worse, and 26 are statistically indistinguishable**" (Holm-corrected). Self-Refine 7B/MATH-500 **66.7 vs SC 73.0 (−6.3pp)**; Reflexion (forced) 7B/MATH-500 **63.3 vs 73.5 (−10.1pp)**; best-of-N self-verify 3B/MATH-500 **52.0 vs 66.1 (−14.1pp)**. Mechanism finding: with the same eight samples, majority **counting** beats model-**choosing** "by between 5 and 17 percentage points." On Reflexion at 1.5B the self-assessment "**never fires**" — every instance was judged correct, so Reflexion "silently collapsed into one chain of thought."
[One Step Forward, Two Steps Back: Regression Errors and Cost Inefficiencies in LLM Iterative Refinement for Code Generation](https://iclr.cc/virtual/2026/10014641) (ICLR 2026 workshop): on LiveCodeBench the framework "**fails to reliably improve Pass@1 scores and often degrades them due to hallucination-induced regression errors**... Critics hallucinated flaws in functionally correct code, prompting the actor to introduce bugs into valid solutions." Qwen2.5-Coder 32B critic / 7B actor: 23.0 → 21.4 → 21.8 → **19.4 (−3.6)** with **18 regression errors**; cost 1.25–2.56× baseline.
[Honest Lying: Understanding Memory Confabulation in Reflexive Agents](https://arxiv.org/abs/2605.29463) (2026), auditing pre-existing Reflexion logs: "**16 frozen environments in ALFWorld, where 0 of 121 reflections mention the correct target object**"; "reflective memory can **reinforce false beliefs** rather than correct them"; reflection-repetition-rate correlates with trials-to-solve (r = 0.808); a mitigation solves only **3 of 16** frozen environments.

**6.9 Reflexion's own paper reports regressions.** [Reflexion: Language Agent with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) (Shinn et al., NeurIPS 2023). Table 2: **MBPP (Python) Base 0.80 → Reflexion 0.77 — a decrease.** Appendix A Table 4: starchat-beta HumanEval **0.26 → 0.26 (zero gain)** — "the ability to specify self-corrections is an emergent quality of stronger, larger models." Appendix B.1, WebShop: "**Reflexion fails to significantly outperform ReAct**"; runs terminated after 4 trials; "the agent does not generate helpful, intuitive self-reflections." **There is no dedicated replication paper reporting failure to reproduce the headline HumanEval 91.0** — the within-paper counterexamples are the verifiable evidence (**NOT FOUND** for a standalone replication).

**6.10 Olausson et al. on self-repair.** [Is Self-Repair a Silver Bullet for Code Generation?](https://arxiv.org/abs/2306.09896) (ICLR 2024). **The paper does NOT print a single pass@1 with/without self-repair table** — main results are pass-rate-vs-sample-budget curves (**NOT FOUND** as a table). What it does print: normalized self-repair gains "are often modest, vary a lot between subsets of the data, and are **sometimes not present at all**." Hyperparameter example (GPT-4, APPS): 10 initial samples + 1 repair each = **1.05×** pass@20; 2 initial + 10 repairs each = **0.97×** pass@22 — "increasing repairs ... does not appear to be worth the additional cost ... oftentimes even **decreasing** performance at lower budgets." **Feedback source, not self-reasoning, drives gains:** "self-repair is bottlenecked by the model's ability to provide feedback on its own code." Repair success rate (Table 2): APPS overall GPT-4 **10.8%**, CodeLlama **1.1%**; HumanEval GPT-4 **49.6%**, CodeLlama **9.1%**. GPT-4 feedback vs human feedback (Table 1): **33.30% vs 52.60%** overall; Competition-tier **3.67% vs 14.67%**; GPT-4 feedback was inaccurate in **32/80** cases vs 7/80 for humans.

**6.11 Self-evaluation bias undermines self-generated quality signals.**
[Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) (Zheng et al., NeurIPS 2023 D&B): position bias — GPT-4 swap consistency **65.0%**, Claude-v1 **23.8%**; verbosity bias — 91.3% failure rate for Claude-v1 and GPT-3.5 on a repetitive-list attack (GPT-4 8.7%). **Important correction:** the paper explicitly declines to establish self-enhancement bias — "Due to limited data and small differences, **our study cannot determine whether the models exhibit a self-enhancement bias**." Citations that attribute self-enhancement bias to Zheng et al. are unsupported by its own text.
[LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076) (Panickssery et al., 2024) is the paper that does show self-preference: GPT-4 distinguishes its own outputs at **73.5%** accuracy out of the box (>90% after 500 fine-tuning examples), and ordering bias causes GPT-4 / GPT-3.5 / Llama-2 to reverse pairwise preferences at **25% / 58% / 89%** rates.

### 6c. Benchmark saturation and contamination

**6.12 SWE-Bench Verified is both saturated and inflated.** [SWE-ABS: Adversarial Benchmark Strengthening Exposes Inflated Success Rates](https://arxiv.org/abs/2603.00520) (ICML 2026): "The SWE-Bench Verified leaderboard is approaching saturation, with the top system achieving **78.80%**." Of **11,041** passing patches from top-30 agents, **2,184 (19.78%)** are semantically incorrect but pass weak tests; the top agent drops **78.80% → 62.20% (−16.6pp) and 1st → 5th place**; average resolve-rate drop across systems **14.56pp**; **30 rank changes in the top 30**. SWE-ABS strengthens **251/500 = 50.2%** of instances.

**6.13 Memory shortcut rather than ability.** [Does SWE-Bench-Verified Test Agent Ability or Model Memory?](https://arxiv.org/abs/2512.10218) (2025): given only the issue ticket with no project context, Claude 3.5/3.7 localize *all* ground-truth files on **65% / 63.20%** of SWE-Bench-Verified issues vs **12.2% / 12%** (BeetleBox) and **12% / 8%** (SWE-rebench 09/2025). The abstract: models "performed **3 times better** on SWE-Bench-Verified ... **6 times better at finding edited files**, without any additional context" — "scores may reflect training recall, not issue-solving skill." Related: Zhou et al. report **10.6% data leakage in SWE-Bench Verified**; [SWE-Bench-Pro container leakage](https://arxiv.org/abs/2606.17454) (2026) "inflates measured pass@1 by **up to 6.9%**."

**6.14 Terminal-Bench 2.0 was NOT saturated at publication — contradicts a common claim.**
[Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces](https://arxiv.org/abs/2601.11868) (2026): 89 tasks; "frontier models and agents resolve **less than 65%** of tasks, with smaller models scoring around **15%**." The authors write that TB2.0 "**may become saturated within the next year**" — i.e. it was not, at publication. This matters because paper 2608's numbers (46–72% on a 50-task Event split) sit inside that distribution. By 2026 a leak-audit paper measures Terminal-Bench-2 at **75.05%** (GPT-5.3), 73.93% (Opus 4.6), 72.58% (GPT-5.4) under unconstrained settings. **A current Terminal-Bench 4.x saturation number is NOT FOUND** (the dynamic leaderboard returned no rows to automated fetch).

**6.15 A formalization of when memory gains are even measurable.** [Anatomy of Agentic Memory](https://arxiv.org/abs/2602.19320) (2026) defines `Δ = Score_MAG − Score_FullContext` and argues a benchmark "meaningfully evaluates agentic memory only when **Δ ≫ 0**." Its saturation ratings: HotpotQA (~1k tokens) **high risk**; **LoCoMo (~20k) moderate**; MemBench (~100k) high; LongMemEval-S (103k) borderline; LongMemEval-M (>1M) low. This is the cleanest published statement of the "the benchmark is too easy to show a memory effect" problem. It also notes that a crowded field of ≥8 RL/learned memory systems (MemAgent, MemSearcher, MemGen, TokMem, MEM1, Mem-α, MemRL, Memory-T1, AtomMem) "often fall short of their theoretical promise."

**6.16 Benchmarks measure retrieval, not memory use.** [MemSyco-Bench](https://arxiv.org/abs/2607.01071) error decomposition across LongMemEval/LoCoMo/STALE/PersonaMem: retrieval-failure-and-wrong answers account for **47.4%–66.1%** of samples; retrieval-OK-but-answer-wrong only **5.8%–13.7%**. **[SEC]** Memory benchmarks are therefore largely retrieval benchmarks.

**6.17 An 'illusory memory pressure' result.** [MemGym](https://arxiv.org/abs/2605.20833) (2026): "Settings that appear memory-intensive often admit strong performance without explicit memory management." On MemGym-DR, **without fictionalization frontier models score 0.70–0.85 by answering from pretraining alone**. A single-check verifier had a **62% false-positive rate**.

**6.18 LoCoMo itself is a partly broken instrument (independent audit).** [dial481/locomo-audit](https://github.com/dial481/locomo-audit): **99 of 1,540** non-adversarial questions (**6.4%**) have wrong gold answers, giving a **theoretical scoring ceiling of 93.57%**; the gpt-4o-mini judge accepts **62.81%** of vague-but-topically-wrong answers vs **10.61%** of specific-but-wrong ones (a **6× leniency gap**); category n ranges 96–841 so that **56% of adjacent-pair per-category comparisons are statistically indistinguishable**; **446 adversarial questions (22.5% of the dataset) are evaluated by no published system**. **[AUDIT]**

---

## 7. Vendor engineering admissions and context-engineering tradeoffs

**7.1 Skills add context cost whether or not they are ever used (Anthropic, first-party docs).**
"**Every skill in the skill listing adds to your context on every turn, whether or not Claude ever uses it.** Run `/skill-doctor` to see what each of your skills costs and how often it gets used... It **flags skills in the listing that have never been invoked** and says where to turn them off." Also on conflict resolution: "Enterprise over personal, and personal over project"; and on evaluation honesty: "**Seeing a skill trigger tells you Claude found it, not that it did what you intended.**" — [https://code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)

**7.2 Anthropic on context as a depleting resource and tool bloat as a top failure mode.**
"Studies on needle-in-a-haystack style benchmarking have uncovered the concept of **context rot**: as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases." "Context, therefore, must be treated as a **finite resource with diminishing marginal returns**." "One of the most common **failure modes** we see is **bloated tool sets** that cover too much functionality or lead to ambiguous decision points about which tool to use." On CLAUDE.md: "CLAUDE.md files are **naively dropped into context up front**, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time." — [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29)

**7.3 Anthropic on overlapping tools distracting agents, and a self-reported tool bug.**
"**More tools don't always lead to better outcomes.**" "Too many tools or **overlapping tools can also distract agents** from pursuing efficient strategies." "For Claude Code, we restrict tool responses to **25,000 tokens** by default." Self-reported product bug: "When we launched Claude's web search tool, we identified that Claude was needlessly appending 2025 to the tool's query parameter, **biasing search results and degrading performance**." — [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025-09-11)

**7.4 OpenAI names memory as a contributor to a shipped regression.**
"In the April 25th model update, we had candidate improvements to better incorporate user feedback, **memory**, and fresher data... each of these changes, which had looked beneficial individually, may have played a part in **tipping the scales on sycophancy** when combined." And: "We have also seen that in some cases, **user memory contributes to exacerbating the effects of sycophancy**, although we don't have evidence that it broadly increases it." OpenAI rolled back the GPT-4o update. — [Expanding on what we missed with sycophancy](https://openai.com/index/expanding-on-sycophancy/) (2025-05-02); [Sycophancy in GPT-4o](https://openai.com/index/sycophancy-in-gpt-4o/). ⚠️ **Access caveat:** `openai.com` returned HTTP 403 to this session's fetcher; the quotes were captured via verbatim third-party reproduction at [simonwillison.net](https://simonwillison.net/2025/May/2/what-we-missed-with-sycophancy/). **A standalone "we rolled back ChatGPT memory because it made the model worse" post is NOT FOUND.**

**7.5 Cognition: the model's own notes were worse than their memory system.**
"We found the summaries weren't comprehensive enough. For example, it would sometimes paraphrase the task, leaving out important details. **When we relied on the model's own notes without our compacting and summarization systems, we saw performance degradation and gaps in specific knowledge**: the model didn't know what it didn't know." "In some cases... we've seen the agent **spend more tokens writing summaries than actually solving the problem**." "This '**context anxiety**' can actually hurt performance: we found the model taking shortcuts or leaving tasks incomplete when it believed it was near the end of its window." — [Rebuilding Devin for Claude Sonnet 4.5](https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges) (2025-09-29)

**7.6 Cognition: context fragmentation in multi-agent designs.**
Multi-agent architectures are "**very fragile**"; "it is evident that in 2025, running multiple agents in collaboration only results in fragile systems. **The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough**." — [Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) (2025-06-12)

**7.7 Vercel: removing 80% of an agent's tools improved it.**
"We deleted most of it and stripped the agent down to a single tool: execute arbitrary bash commands... **The agent got simpler and better at the same time. 100% success rate instead of 80%.**" "We assumed it would get lost in complex schemas... So we built guardrails. We pre-filtered context, constrained its options, and wrapped every interaction in validation logic. **We were doing the model's thinking for it.**" Measured: avg execution time **274.8s → 77.4s (3.5×)**; success **4/5 (80%) → 5/5 (100%)**; avg tokens **~102k → ~61k (−37%)**; avg steps **~12 → ~7 (−42%)**. Caveat: "This only worked because our semantic layer was already good documentation." — [We removed 80% of our agent's tools](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) (2025-12-22)

**7.8 Vercel: replacing the vector pipeline with a filesystem cut cost ~4× and improved quality.**
"The failure mode is **silent**: the agent confidently returns the wrong chunk, and you can't trace the path from question to answer." "We replaced our vector pipeline with a filesystem and gave the agent `bash`. Our sales call summarization agent went from **~$1.00 to ~$0.25 per call, and the output quality improved**." — [Build knowledge agents without embeddings](https://vercel.com/blog/build-knowledge-agents-without-embeddings) (2026-03-19)

**7.9 Counter-evidence: Cursor says the opposite about embeddings.** A widely repeated claim that "Cursor removed embeddings because semantic search didn't help" is **NOT FOUND and is contradicted by Cursor's own posts**: "semantic search significantly improves agent performance, especially over large codebases: Achieving on average **12.5% higher accuracy** in answering questions" and "**Semantic search is one of the biggest drivers of agent performance**." — [Improving agent with semantic search](https://cursor.com/blog/semsearch) (2025-11-06); [Securely indexing large codebases](https://cursor.com/blog/secure-codebase-indexing) (2026-01-27). **Do not repeat the "Cursor removed embeddings" claim.**

**7.10 Windsurf (via LangChain): embedding search becomes unreliable at scale.** "**embedding search becomes unreliable as a retrieval heuristic as the size of the codebase grows**... we must rely on a combination of techniques like grep/file search, knowledge graph based retrieval, and... a re-ranking step." — quoted first-party by [LangChain, Context Engineering](https://www.langchain.com/blog/context-engineering-for-agents) (2025-07-02). The original Windsurf-hosted source is **NOT FOUND**; this is second-hand.

**7.11 LangChain names the failure modes and flags semantic search for code.**
"Cumulative... tokens... can exceed the size of the context window, balloon cost / latency, or **degrade agent performance**," with named modes Context Poisoning, Context Distraction, Context Confusion, Context Clash. And: "**semantic may be very poorly placed due to a lack of semantic information in the text**" for technical API reference and code files. On agent self-written memory: "This **hasn't been fully solved** and is still an emerging pattern." — [Context Engineering](https://www.langchain.com/blog/context-engineering-for-agents); [How agents can use filesystems for context engineering](https://www.langchain.com/blog/how-agents-can-use-filesystems-for-context-engineering) (2025-11-21). **No LangChain/LangSmith post reporting a memory or retrieval eval with no gain was found — NOT FOUND.**

**7.12 CLAUDE.md / memory rules are widely reported not to be followed.** Vendor-tracked issues: [anthropics/claude-code#2544](https://github.com/anthropics/claude-code/issues/2544) (OPEN, labeled `bug`/`has repro`/`memory`): "Claude Code is consistently ignoring mandatory rules... acts as if CLAUDE.md files don't exist or are optional suggestions... part of a broader **instruction-following regression**." [#33603](https://github.com/anthropics/claude-code/issues/33603) (OPEN): "loaded into context every session and are **consistently not followed**... The behavior is getting **measurably worse with each iteration**." [#81710](https://github.com/anthropics/claude-code/issues/81710): MEMORY.md has "a hard cap (**~24.4 KB / ~200 lines**). Past it, content is **dropped silently**... you lose your **newest** rules and findings first." Anthropic's own memory docs concede the mechanism: memory is "context, not enforced configuration"; "Longer files consume more context and **reduce adherence**"; "if two rules contradict each other, Claude may **pick one arbitrarily**." — [https://code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)

**7.13 A cluster of first-party repo issues reporting skills that never fire.** See §5.3 above (anthropics/skills#556, #996; anthropics/claude-plugins-official#3174; anthropics/claude-code#36570 — the last **closed "not planned"**; openai/codex#34321 and #11314). A literal "`use_count` always 0" in a *vendor-owned* repo was **NOT FOUND** (only community repos).

**7.14 The term "context rot" in a vendor's own mouth.** Anthropic's engineering post uses "context rot" explicitly (quoted in §7.2), citing needle-in-a-haystack work generally; the primary measured source is Chroma's technical report ([§3.5](#35-context-rot-with-longer-inputs)).

---

## 8. GAPS / NOT FOUND

Grouped by the numbered request. "NOT FOUND" means I could not locate evidence — it is not a claim of absence.

**Request 1 — Library Drift**
- No published breakdown of **why** the router declines injection in the Default condition (i.e. how often declines are correct vs errors). The paper reports aggregate engagement (73%) only.
- No **multi-step agent** validation. The authors state: "(i) One benchmark (MBPP+ hard-100)... (iv) We hypothesize that drift signals... become more sensitive in multi-step agents... empirical validation is future work."
- Per-seed table values for A5–A8 are partly truncated in the HTML render; only A1–A4 per-seed figures were recoverable.
- No independent replication of the paper.

**Request 2 — When Self-Evolution Backfires**
- **Internal numeric inconsistency on rollback recovery**: abstract/intro say "**17%**"; the Figure 4 decomposition gives **1.7 / 12.3 ≈ 13.8%**; the Table 1 "+ Post-hoc Rollback" row shows 50% → 52%. The paper does not reconcile these. Flag when citing.
- No full supplementary material is available in the v2 HTML; the "git-conflict skill" lineage chain and per-task breakdowns are referenced to Supplementary Material but **NOT FOUND** in the fetched version.
- No per-round per-tier breakdown for VaG's Easy tier beyond the printed 100% (the Event split has only 2 Easy tasks, so no signal there).
- No comparison to a **random-admission** or **admit-nothing** control; the baselines are Seed / Ungated / Post-hoc Rollback / VaG.
- No independent replication.

**Request 3 — Context pollution**
- Per-position key-value retrieval accuracies in Lost in the Middle are figure-only; only "worst-case 45.6%" is printed.
- Exact numeric deltas for Chroma's NIAH similarity / distractor / haystack-structure / repeated-words curves: plots only, no value labels. The LongMemEval focused-vs-full values used in §3.5 are **figure-read**.
- LongMemEval per-model **abstention** accuracy is not printed; the only abstention figures (0.97/0.90) are the human meta-evaluation of the GPT-4o judge.
- **A paper titled exactly "The Curse of Memory" was NOT FOUND.** The closest verified is "The Memory Curse" (arXiv:2605.08060), which is a cooperation/behavioral result, not a task-accuracy result.
- "Do LLM Agents Need Memory" — **NOT FOUND** as a title. [Rethinking Memory in LLM-based Agents](https://arxiv.org/abs/2505.00675) exists as a survey but I did not extract pollution deltas from it.
- "Failure-Gated Hierarchical Memory: Preventing Memory Pollution in Long-Horizon LLM Agents" (IEEE Xplore doc 11607496): paywalled, **NOT VERIFIED**.
- The Chroma replication repo (github.com/chroma-core/context-rot) was unreachable from this environment (network timeout), so raw result data was unavailable.
- Some Cuconasu Table 3/4 cells ("no-mid" and several truncated columns) were not recoverable from the HTML render.

**Request 4 — Negative transfer / interference**
- **ExpeL reports no negative or zero cross-domain transfer case.** Its transfer experiment (HotpotQA → FEVER) is strictly positive at every level (58 / 63 / 65 / 70). The negative results in ExpeL are about **reflections degrading insight quality** (32.0 → 29.0) and **random vs similarity selection** (42.5 vs 59.0), not cross-domain transfer. If the user expected a negative-transfer table in ExpeL, it is **NOT FOUND** — the paper's framing is uniformly that transfer works.
- **Voyager's "w/o skill library" item-count delta is not printed numerically** — only Fig. 9 plots it, and the paper's own description is qualitative ("tendency to plateau in the later stages"). The hard numbers are the tech-tree and zero-shot tables in §4.2. No per-round item counts for that ablation were recoverable.
- **No paper was found that proposes a formal metric or benchmark named "skill interference" or "skill conflict" as a first-class measure.** The closest are SRA-Bench's hard-negative distractor protocol ([arXiv:2604.24594](https://arxiv.org/abs/2604.24594)), paper 2608's combinatorial-contamination definition, and SkillOps' "complex skill conflicts" limitation ([arXiv:2605.13716](https://arxiv.org/abs/2605.13716)). A GitHub mirror named `lawrence3699/skill-conflict-benchmark` returned HTTP 405 (bot check) and could **not** be verified. **A dedicated, verified "skill conflict" benchmark is NOT FOUND.**
- **CASCADE (arXiv:2512.23880) exact GPT-4.1 ablation cell values** — the table columns could not be unambiguously aligned from the rendered page; only the qualitative "optimal performance in the absence of continuous learning / extraneous interference" claim is reliable.
- **BADIT (ICML 2026, OpenReview `FFAHL32Wok`) per-task interference deltas** — the program page confirms the phenomenon and the SuperNI/6-LLM setup but prints no numbers; the OpenReview PDF was behind a browser check.
- **SkillWeaver (arXiv:2504.07079) has no component ablation** of its skill library; only overall positive tables, the zero-transfer Car-website case, and Shopping underperformance. **Alita (arXiv:2505.20286)** has no measured interference numbers beyond a qualitative coding-capability dependence.
- **"Lingua"** (continual learning for LLMs) and **"OpenContinual"** could **not** be matched to a primary source: arXiv 2402.09318 is an unrelated music-audio paper and the apparent EMNLP "Lingua" link 404s; arXiv 2311.07226 is "Large Language Models for Robotics: A Survey", not OpenContinual. **Do not cite either** without re-verification.
- An OpenReview paper titled **"Negative transfer is real"** (`AIJsjIqfsp`) served a browser-verification wall — **unverified, do not cite**.

**Request 5 — Low usage rates / skills never reused**
- **SkillFlow-Bench**: I located a Hugging Face dataset named `KouShi2/skillflow-bench` ([link](https://huggingface.co/datasets/KouShi2/skillflow-bench)) but could not retrieve a paper, a usage-rate table, or any measured result. **NOT VERIFIED.**
- **SkillsVote** does not publish a skill-usage rate; its "negative transfer" section is qualitative plus the hard-tier deltas noted in §4.5. An explicit usage-rate number from SkillsVote is **NOT FOUND**.
- **An aggregate percentage of retrieved skills that are actually used/cited in the final answer** — the single most important number for this request — is **NOT FOUND**. Only proxies exist: 0 calls / 114 turns ([arXiv:2607.20972](https://arxiv.org/html/2607.20972v1)); loading rates 11.1%–72.1% ([arXiv:2604.24594](https://arxiv.org/abs/2604.24594)); 49%→31%→16.3% curated-skill loading ([arXiv:2604.04323](https://arxiv.org/abs/2604.04323)); and a Memory-R1 worked example where the "truly useful" set out of 60 retrieved memories is **1 item** (an anecdote, not an aggregate rate). One paper *did* claim 85–100% oracle-retrieval failure rates — [arXiv:2603.11513](https://arxiv.org/abs/2603.11513) — and **withdrew it in Aug 2026**, because the oracle selected passages by gold-answer string containment; corrected HotpotQA EM rises +39.2/+44.3/+50.0pp for Qwen2.5-1.5B/3B/7B. Do not cite the withdrawn claim.
- A **vendor-owned** repo issue containing a literal `use_count always 0` / `usage_count 0` for a *vendor's own* memory-skill feature: **NOT FOUND**. (Community forks of agent frameworks do discuss it.)

**Request 6 — Saturation / vanishing gains**
- A dedicated replication paper failing to reproduce **Reflexion's headline HumanEval 91.0**: **NOT FOUND**. The verifiable evidence is within Reflexion's own paper (MBPP 0.80 → 0.77; starchat-beta 0.26 → 0.26; WebShop "fails to significantly outperform ReAct").
- A paper titled "**Self-Refine does not work**": **NOT FOUND**. The critiques that exist are Huang et al. 2024, Kamoi et al. TACL 2024, Self-[In]Correct (AAAI 2025), Sample More Reflect Less (2026), and One Step Forward (ICLR 2026 workshop).
- **Olausson et al.'s exact pass@1 with/without self-repair**: does not exist as a table in the paper (**NOT FOUND**); results are pass-rate-vs-budget curves and normalized ratios.
- **A-MEM's own primary tables** (27.02 / 45.85 / 2,520; ablations 9.65 / 21.35) were obtained only via a secondary analysis (**[SEC]**) — re-verify against [arXiv:2502.12110](https://arxiv.org/abs/2502.12110) before publication.
- **Mem0's Table 2/3 primary rows** (66.88 / 68.44 / 72.9 overall J; p95 latencies; token counts) were obtained only via a secondary analysis (**[SEC]**); the arXiv HTML was truncated. Re-verify against [arXiv:2504.19413](https://arxiv.org/abs/2504.19413).
- **MINJA's exact per-agent injection/attack-success table rows** are **[SEC]**; only the 98.2% / 76.8% averages are the paper's own ([arXiv:2503.03704](https://arxiv.org/html/2503.03704v5)).
- **Any paper showing memory-augmented RL agents fail to beat non-memory baselines** — **NOT FOUND**. MemAgent's numbers were not retrieved; Memory-R1's ablation deltas were truncated (**NOT VERIFIED**).
- **A current Terminal-Bench 4.x saturation number** — **NOT FOUND** (dynamic leaderboard returned no rows).
- **OpenAI's "Why we no longer evaluate SWE-bench Verified"** — HTTP 403 / Cloudflare-blocked; no numbers extracted. Use SWE-ABS and the SWE-Bench-Pro-leak paper instead.
- **Generative Agents (arXiv:2304.03442) memory ablation with negative/null results** — **NOT FOUND**; and its retrieval components were never ablated individually (see §3.13).
- **ACL 2026 `2026.acl-long.27` numeric error-propagation rates** — **NOT VERIFIED** (PDF body not extractable).

**Request 7 — Vendor admissions**
- An Anthropic engineering post **admitting** that tools/memory/context additions measurably hurt a shipped product: **NOT FOUND**. Anthropic's material is honest-tradeoff (type B), plus doc-level and issue-level admissions about skills and memory.
- A dedicated Anthropic post on **skill failure modes / skill-conflict analytics**: **NOT FOUND**.
- A **standalone OpenAI post rolling back ChatGPT memory because it made the model worse**: **NOT FOUND**. OpenAI names memory as one combined contributor to sycophancy and rolled back the GPT-4o *update*.
- **OpenAI "A practical guide to building agents"** (PDF) and the **OpenAI cookbook on context engineering for personalization**: HTTP 403 / unfetchable — **NOT VERIFIED**.
- **OpenAI first-party long-context vs RAG tradeoff post**: **NOT FOUND**.
- **Cursor admitting it removed embeddings / that semantic search didn't help**: **NOT FOUND and actively contradicted** (§7.9).
- **Original Windsurf-hosted source** for the "embedding search becomes unreliable" quote: **NOT FOUND** (only LangChain's first-party relay).
- **Sourcegraph** engineering post admitting code search/indexing did not help or was removed: **NOT FOUND**.
- **GitHub Copilot** engineering post admitting retrieval/indexing did not help or was removed: **NOT FOUND**.
- **LangChain/LangSmith** post reporting a memory/retrieval eval with no gain or admitting a regression: **NOT FOUND**.
- A Vercel post literally titled "**We removed RAG**": **NOT FOUND**; the actual post is "Build knowledge agents without embeddings" (§7.8).

---

## 9. Bottom line — six best-evidenced measured claims

1. **Self-generated skills deliver approximately zero average benefit, and frequently negative benefit.** SkillsBench: self-generated **−1.3pp** average vs no-skill (Codex + GPT-5.2 **−5.6pp**, gNorm −8.1) while curated skills give **+16.2pp** ([arXiv:2602.12670](https://arxiv.org/abs/2602.12670)). A 2026 systematic study across 5 domains × 6 targets × 5 extractors finds **25% of extractor–target pairings exhibit negative transfer**, rising to **47% on ALFWorld** ([arXiv:2605.23899](https://arxiv.org/abs/2605.23899)).
2. **Unbounded self-evolution is non-monotone.** Ungated skill accumulation peaks at R3 (62%, pool 105) then falls to 50% at R5 (pool 179), ending only 2pp above its own R1; post-hoc rollback recovers only 1.7 of the 12.3pp lost, and 5.6pp is irrecoverable even with oracle lineage cleanup ([arXiv:2608.05810](https://arxiv.org/abs/2608.05810)).
3. **Adding a skill library can be worse than having none.** Library Drift's harsh-retirement ablation scores **−0.019** below the no-skill baseline, and its no-injection ablation scores **+0.002** — a skill library with no governance buys literally nothing ([arXiv:2605.19576](https://arxiv.org/abs/2605.19576)). TEPA measures polluted memory at **0.210 vs no memory at 0.309** ([arXiv:2608.07429](https://arxiv.org/abs/2608.07429)). And on a held-out continual benchmark, **AWM scores 65.56 / 61.95 against a 70.18 / 67.67 memory-free baseline** — below it in both conditions ([arXiv:2608.01149](https://arxiv.org/abs/2608.01149)).
4. **Skill and memory *usage* rates are low and partly decoupled from retrieval quality.** 49% → 31% → 16.3% of Claude trajectories load curated skills as conditions get realistic, and two models drop **below** their no-skill baseline ([arXiv:2604.04323](https://arxiv.org/abs/2604.04323)); loading rates span **11.1%–72.1%** across eight models with **no** need-awareness (∆Load +0.1pp) and demonstrable "skill-loading hallucination" ([arXiv:2604.24594](https://arxiv.org/abs/2604.24594)).
5. **Library size itself degrades retrieval, logarithmically and reproducibly.** Routing accuracy follows **Acc(N) = a − b·ln N with R² > 0.97 across all 15 frontier models tested** over 1,141 real skills and >3M decisions, with errors progressing to capture by "black-hole skills" ([arXiv:2605.16508](https://arxiv.org/abs/2605.16508)). SE-GoS independently measures vector skill retrieval **6.7 points below no retrieval at all** ([arXiv:2609.08228](https://arxiv.org/abs/2609.08228)).
6. **On strong backbones, memory methods tie or lose to no-memory.** Mem0 and MemOS are **exactly equal** to the no-memory baseline on 3 of 4 backbones (Gemini 2.5 Flash 0.59 = 0.59; Flash-Lite 0.58 = 0.58); AWM is below it ([arXiv:2511.20857](https://arxiv.org/abs/2511.20857)). Verbatim RAG vs full context is a **+2.6pp null (p = 0.34)** ([arXiv:2606.29914](https://arxiv.org/abs/2606.29914)). And the self-critique literature is unambiguous: intrinsic self-correction **drops** accuracy across every model and benchmark tested ([arXiv:2310.01798](https://arxiv.org/abs/2310.01798)).
