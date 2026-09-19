# Measuring Whether an Agent's Learned Skills/Memories Actually Transfer

**An evidence review of the measurement instrument, 2023–2026**
Compiled 18 Sep 2026. Every substantive claim below carries a source link. Claims I could not substantiate are collected in §7 rather than guessed at.

**Why this framing matters:** the literature contains many more papers about *building* memory/skill mechanisms than about *measuring* them. Where measurement work exists, it repeatedly finds that the instrument, not the mechanism, is what fails — broken tests, saturated benchmarks, ~2–6 pp run-to-run noise, duplicated leaderboard entries, and judges validated against nothing. This review is organised around those findings.

---

## Q1. Standard evaluation designs for "does this memory/skill help?"

### 1.1 Held-out task splits

The standard design is to **build or induce the skill on a source/train split and evaluate on tasks not used for induction**, with the split recorded explicitly.

- **AFTER** (arXiv 2606.23127, 2026) is the clearest published instance for procedural memory: 382 enterprise tasks, 6 roles, 22 skills, with "controlled splits that measure specificity (in-context gain) and generality (held-out task, cross-role, and cross-model transfer)". Tasks are assigned to **train (used for evolution), test (unseen tasks for every role+skill combination), and validation** splits. The formal protocol sets `p_tgt = p_src` to measure *specificity* and shifts the task, role, or model distribution to measure *generality* ([paper](https://arxiv.org/html/2606.23127v1)).
- **ExpeL** (arXiv 2308.10144, AAAI-24) extracts insights "from a collection of training tasks" and recalls them at inference, then explores "transfer learning potential" ([paper](https://arxiv.org/abs/2308.10144)).
- **Agent Workflow Memory** (arXiv 2409.07429, ICML 2025) induces workflows "from training examples beforehand or from test queries on the fly", and reports cross-task, cross-website and cross-domain evaluations where "train-test task distribution gaps widen" ([paper](https://arxiv.org/abs/2409.07429)).
- Benchmark-side, **SkillsBench** (arXiv 2602.12670, 2026) enforces split discipline at construction time with a **leakage audit** in CI: skills "must NOT contain task-specific filenames, paths, or identifiers; exact command sequences that solve benchmark tasks; constants, magic numbers, or values from task specifications; references to specific test cases or expected outputs" ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).

**Known weaknesses.** (i) Held-out splits are only as clean as the leak audit; SkillsBench found it necessary to run an automated leakage-detection agent because authors cannot self-police this. (ii) Splits are frequently declared without saying how many tasks land in each cell — AFTER is unusual in specifying "test = unseen tasks for every role+skill combination". (iii) Cross-task transfer results are often reported as a single aggregate delta, hiding the fact that **individual tasks can go negative**: SkillsBench reports "16 of 84 tasks show negative deltas", worst case −39.3 pp ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).

### 1.2 Paired / within-task comparison vs between-task

**Paired, same-task comparison is the statistically preferred design, and this is a formal result, not folklore.**

- Miller (arXiv 2411.00640, 2024) derives that the paired standard error on question-level differences is smaller than the unpaired one by `2·Cov(x_A,x_B)/n`, and shows that with score correlation 0.5, pairing **reduces estimator variance by one-third relative** (from 1/6 to 1/9 absolute). He recommends "using the paired version of the standard error estimate wherever practicable" ([paper](https://arxiv.org/html/2411.00640v1)).
- The canonical skills-evaluation design is therefore **three conditions on the same task set** (within-task pairing). SkillsBench evaluates every task under **no Skills / curated Skills / self-generated Skills** with deterministic verifiers, 7 agent–model configurations, 7,308 trajectories. Curated skills raise average pass rate **+16.2 pp (24.3% → 40.6%)**; self-generated skills average **−1.3 pp**; domain effects range from **+4.5 pp (Software Engineering) to +51.9 pp (Healthcare)** ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).
- **AFTER** uses the same within-task structure: metrics M1 (mean fraction of tests passed = partial credit) and M2 (all-tests-pass = binary) computed per task under no-skill / handcrafted / generated skill ([paper](https://arxiv.org/html/2606.23127v1)).

**Known weaknesses.** Between-task comparisons (condition A on suite 1, condition B on suite 2) throw away the covariance term that makes pairing powerful — Miller's result implies the measurement can be up to 3× noisier than necessary. Even paired, the *execution* must be repeated: AgentLens (arXiv 2605.12925, 2026) shows that among 1,136 passing OpenHands trajectories on SWE-bench Verified, **10.7% are "Lucky Passes"** (regression cycles, blind retries, missing verification), ranging **0.5% to 23.2% by model**, and that ranking models by process quality instead of pass rate moves some models **up to five rank positions** ([paper](https://ar5iv.labs.arxiv.org/html/2605.12925)).

### 1.3 Cross-task transfer suites

- **AFTER** is the only benchmark I found explicitly built with *transfer splits as a first-class property*: it compares itself to GAIA (466 tasks), SWE-bench (2,294), SkillsBench (85), WebArena (812) and MLE-bench (75) and marks all but itself as ✗ or ~ on "transfer splits" ([paper](https://arxiv.org/html/2606.23127v1)).
- **AWM** reports that online workflow induction "robustly generalizes in cross-task, website, and domain evaluations, surpassing baselines from 8.9 to 14.0 absolute points as train-test task distribution gaps widen" ([paper](https://arxiv.org/abs/2409.07429)).
- **Memp** (arXiv 2508.06433, ACL 2026 Findings) evaluates on TravelPlanner and ALFWorld and shows procedural memory built by a stronger model still helps a weaker one when migrated ([paper](https://arxiv.org/abs/2508.06433)).
- **Voyager** (arXiv 2305.16291) reports a skill library enabling "novel tasks from scratch" in a *new* Minecraft world ([paper](https://arxiv.org/abs/2305.16291)).
- Web-domain transfer benchmarks used as evidence for skill generalization: **Mind2Web** (cross-website) and **OSWorld** (cross-application), per the SoK on agentic skills ([paper](https://arxiv.org/html/2602.20867v1)).

**Known weaknesses.** Transfer suites measure *whether* skill helps elsewhere but rarely disentangle **skill quality from retrieval quality**. AFTER explicitly fixes this by making "skill annotations fixed at task definition rather than retrieved at solve time, separating skill quality from retrieval quality and giving evolution a clean optimization signal; retrieval can be studied as a separate problem on the same tasks" ([paper](https://arxiv.org/html/2606.23127v1)). If your null result comes from a system that both stores and retrieves skills, this distinction is a confound in your instrument.

### 1.4 Ablations (with-skill vs without-skill)

- SkillsBench's no-Skills condition *is* the ablation, and it is the source of its headline number ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).
- AFTER includes a **reflector ablation**: skill evolution is performed by four different reasoners (a script, Claude Code, Codex, Hermes) "while holding the solver fixed", each tuning a handcrafted baseline on **n = 1…5 train tasks and tested on 3 held-out tasks**. Diverse training beats narrow training for every reasoner (e.g. pptx: 60.1 → 79.3 for the script reasoner; 56.8 → 87.5 for Claude Code) ([paper](https://arxiv.org/html/2606.23127v1)).
- The procedural-memory retrieval benchmark (arXiv 2511.21730, 2025) includes a **corpus-size ablation** (78 vs 336 trajectories) and a representation-format ablation, plus manual validation of the LLM judge used for procedural similarity ([paper](https://arxiv.org/abs/2511.21730)).

**Known weaknesses.** Ablations in this literature are almost always **single-run or small-n**. AFTER reports means "over four runs" for token usage; SkillsBench averages binary reward "across 5 trials" per task. Neither reports a power analysis. Given §3 below, an ablation that moves 2–3 pp is not measurable at these run counts.

### 1.5 pass@k

- The standard estimator (Chen et al. 2021 lineage) is `pass@k = E[1 − C(m−c_i, k)/C(m, k)]`, the probability at least one of k attempts succeeds; its pessimistic complement `pass^k = E[C(c_i,k)/C(m,k)]` is the probability all k succeed ([On Randomness in Agentic Evals, arXiv 2602.07150](https://ar5iv.labs.arxiv.org/html/2602.07150)).
- **Measured spread:** on SWE-bench Verified, DeepSWE-preview/r2e-gym has pass@1 = 34.4%, pass@5 = 52.9% (+18.5 pp) but pass^5 = 15.5% — an 18.9 pp gap between pass@1 and the pessimistic bound. Across 12 configurations the maximum pass@1→pass@5 improvement is **24.9 pp** ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)).
- SWE-rebench reports both SEM and pass@5 for every model as its standard practice ([paper](https://arxiv.org/abs/2505.20411)).

**Known weaknesses.** pass@k is an *optimistic* bound and is not a capability estimate; reporting only pass@k makes retry-dependent systems look better. Conversely, a single-run pass@1 is a high-variance estimate. The 2026 position paper *Don't Pass@k* (arXiv 2510.04265, ICLR 2026) argues pass@k "often produces unstable and potentially misleading rankings, especially when the number of trials is limited", and proposes replacing pass@k/avg@N with a Bayesian posterior over the underlying success probability (and extends it to graded, rubric-based scoring) ([paper](https://arxiv.org/abs/2510.04265)).

### 1.6 Summary table of designs and their documented failure modes

| Design | Standard practice | Documented weakness | Source |
|---|---|---|---|
| Held-out split | Train/val/test; leakage audit in CI | 16/84 tasks negative; leakage must be machine-audited | [SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1), [AFTER](https://arxiv.org/html/2606.23127v1) |
| Paired within-task | Same tasks under both conditions | Between-task designs discard up to 1/3 of variance reduction; "Lucky Passes" 0.5–23.2% | [Miller](https://arxiv.org/html/2411.00640v1), [AgentLens](https://ar5iv.labs.arxiv.org/html/2605.12925) |
| Cross-task suite | Cross-task / cross-website / cross-domain | Confounds skill quality with retrieval quality unless annotations are fixed | [AFTER](https://arxiv.org/html/2606.23127v1) |
| Ablation | with vs without skill | Usually single-run / n≤5; no power analysis | [AFTER](https://arxiv.org/html/2606.23127v1), [SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1) |
| pass@k | report pass@k and pass^k | Optimistic; single-run pass@1 has 2.2–6.0 pp spread | [On Randomness](https://ar5iv.labs.arxiv.org/html/2602.07150), [Don't Pass@k](https://arxiv.org/abs/2510.04265) |

---

## Q2. Benchmark saturation and headroom

### 2.1 The saturation evidence is now quantitative

- **"Coding Agents Have Converged: Why the SWE-bench Leaderboard Can No Longer Order Its Top Entries"** (arXiv 2609.17394, 15 Sep 2026) audits 254 public SWE-bench submissions across four splits *without running any models*. On SWE-bench Verified: **the leading two entries each resolve 396 of 500 instances; the top ten share 285 successes and 51 failures, leaving only 164 instances that distinguish them.** Median nesting of solution sets is **0.935** against a score-implied baseline of 0.774. Effective sample size for the top ten is **n_eff/n = 0.33**. Within-model scaffold ranges reach **29.8 pp** while the entire top-thirty spread is **8.8 pp**. Six of nine cell-mean interaction tests remain significant after Holm correction ([paper](https://arxiv.org/html/2609.17394v1)).
- **"The Growing Pains of Frontier Models: When Leaderboards Stop Separating and What to Measure Next"** (arXiv 2605.18840, 2026) reports that among the top-5 SWE-bench models **coding scores compress to a 1.3-pp spread while GPQA retains 9.1 pp of variation**, and defines a *saturation ratio* σ = spread(old)/spread(new), with **σ < 0.2 signalling that the old axis has lost discriminatory power**. It reports HLE spread at 26.4 pp and IFEval already at 87–94% ([paper](https://arxiv.org/html/2605.18840v1)).
- OpenAI's own retirement of SWE-bench Verified from internal evaluation (Feb–Apr 2026) is reported as: an audit of **27.6% of the tasks the model failed** found **at least 59.4% contained flawed test cases that rejected functionally correct answers**, plus evidence of contamination (models reproducing problem statements and gold patches). OpenAI recommends **SWE-bench Pro** instead, whose held-out data is designed to resist contamination ([secondary report](https://gigazine.net/gsc_news/en/20260429-swe-bench-verified/); independently corroborated by [ABA, arXiv 2605.26079](https://ar5iv.labs.arxiv.org/html/2605.26079), which flagged the same two tasks — `pylint-dev__pylint-4551` and `sympy__sympy-18199` — without reading the post). Note: openai.com returns HTTP 403 to automated fetch; the OpenAI claims here are from secondary reporting.

### 2.2 SWE-bench Verified — the canonical curated subset, and what it cost

- Construction: OpenAI + **93 professional software developers** annotated **1,699 randomly sampled** SWE-bench instances, each labelled **three times** across problem-specification clarity, test validity and task difficulty. **68.3% of samples were filtered out**, yielding the **500-instance** Verified set. GPT-4o's score moved **16% → 33.2%** on the verified set ([cached summary of the OpenAI announcement](https://www.longtermwiki.com/resources/e1f512a932def9e2); [SWE-bench Verified page](https://www.swebench.com/verified.html)).
- The SWE-bench family now includes Verified (500), Lite (299) and Multimodal (301) as smaller/curated splits, all graded by the same harness on the same instances ([convergence audit, Table 1](https://arxiv.org/html/2609.17394v1)).

**Critically: curation fixed under-specification but not leakage.** SWE-bench+ (arXiv 2410.06992, 2024) hand-screened all successful SWE-Agent+GPT-4 patches and found **32.67% "solution leakage"** (the solution was directly present in the issue text or comments) and **31.08% suspicious patches from weak tests**; filtering dropped the resolution rate from **12.47% to 3.97%**. In SWE-bench Verified specifically, **37 of 112 passed instances (33.04%) contained direct solutions** in the issue description or discussion ([paper](https://arxiv.org/html/2410.06992v1)).

### 2.3 LiveCodeBench — the difficulty-tiered, contamination-free template

LiveCodeBench (arXiv 2403.07974, ICLR 2025) is the benchmark to copy for *headroom management*. Its design principles, verbatim:

- **Live updates to prevent contamination**: problems are scraped from weekly contests and tagged with a release date; for a new model, only problems released **after the model's cutoff date** are used. The paper documents the resulting drops — DeepSeek after Aug 2023, GPT-4o after Nov 2023 — as evidence of contamination on the earlier problems ([paper](https://ar5iv.labs.arxiv.org/html/2403.07974)).
- **Difficulty tiering from platform ratings**: the 511-problem set (May 2023–May 2024) is split into **LCB-Easy (182), LCB-Medium (206), LCB-Hard (123)**; AtCoder problems above rating 500 and CodeForces above 1300 are excluded. The stated reason is explicitly about measurement: averaging across mixed difficulty "artificially minimizes the differences between models", so tiers exist "for more granular model comparisons" ([paper](https://ar5iv.labs.arxiv.org/html/2403.07974)).
- Problems are excluded if they are "too difficult for even the best models" — i.e. **both ends of the difficulty range are pruned to protect discriminative power.**

### 2.4 What people actually do about saturation

1. **Curated hard/enough subsets**: SWE-bench Verified (500) and Lite (299); LiveCodeBench Easy/Medium/Hard tiers.
2. **Contamination-free splits by construction**: LiveCodeBench's rolling time windows; SWE-rebench's continuously collected fresh tasks, with "potentially contaminated evaluations explicitly marked on our leaderboard" by comparing issue/PR creation dates against model release dates ([paper](https://arxiv.org/abs/2505.20411)); SWE-bench Pro's split into public (11 repos), **held-out (12 repos)** and **commercial (18 proprietary repos)** partitions, described as "a contamination-resistant testbed" ([arXiv 2509.16941](https://arxiv.org/abs/2509.16941)).
3. **Baseline-first / trivial-agent checks**: τ-bench counts empty responses as success, and "a trivial agent that returns empty responses … achieves a 38% success rate and outperforms a GPT-4o-based agent" on the airline subset; τ-bench additionally allows agents to list every possible answer, overestimating performance by 40% ([ABC, arXiv 2507.02825](https://arxiv.org/html/2507.02825v5)). ABC's reporting checks **R.10 (statistical significance)** and **R.12–13 (appropriate baseline comparisons)** are the closest thing to a published "report a baseline" mandate ([ABC](https://arxiv.org/html/2507.02825v5)).
4. **Automated benchmark auditing**: ABA audited **168 benchmarks / 34,285 tasks** and found **25.7% carry major issues**; **filtering them raises mean SWE-bench Verified scores by 9.9% and Terminal-Bench 2 by 9.6%, and shifts model rankings** ([paper](https://ar5iv.labs.arxiv.org/html/2605.26079)).
5. **Recalibrate or retire**: OpenAI retired SWE-bench Verified and moved to SWE-bench Pro; the convergence audit recommends reporting **comparison-set-specific resolution**, **model–scaffold provenance**, and **descriptive tiers rather than ranks**, and recommends organisations build **internal benchmarks mined from private repositories** precisely because public instances have pretraining overlap ([paper](https://arxiv.org/html/2609.17394v1)).

### 2.5 The 2026 twist: a curated subset can saturate too

The convergence audit's central measurement lesson: **non-rejection is not evidence of no difference, and non-significance is not equivalence.** Exact paired McNemar tests separated **none of the 29 adjacent top-thirty pairs on Verified at α = 0.05** (smallest adjacent p = 0.545), while the much larger 2,294-instance Test split separated **14 of 23**. Across all 435 top-thirty pairs, **44.6% were separable uncorrected but only 9.4% survived Holm–Bonferroni**. As an independent-sample reference, detecting a **0.2 pp gap (one instance out of 500)** at a 75% baseline and 80% power would require **≈734,000 instances per system** ([paper](https://arxiv.org/html/2609.17394v1)).

**Implication for a skills experiment:** if your task suite is small and near ceiling, your null result may be *unfalsifiable* rather than true. The audit's five-step protocol (profile shared outcomes → test paired differences → report grouping sensitivity → estimate the instance budget needed) is directly portable to a custom skill-transfer suite ([paper](https://arxiv.org/html/2609.17394v1)).

---

## Q3. Statistical power in agent evaluation

### 3.1 How much run-to-run variance actually exists

**"On Randomness in Agentic Evals"** (arXiv 2602.07150, KTH, 2026) is the reference measurement. 60,000 trajectories, 3 models × 2 scaffolds × 10 runs on SWE-bench Verified, 25.58B tokens, 1.88M tool calls:

- **Single-run pass@1 estimates vary by 2.2 to 6.0 pp depending on which run you pick.**
- Standard deviations **exceed 1.5 pp even at temperature 0**. Example: Qwen3-32B on r2e-gym at temp 0.6 = 23.9% ± 1.4%, range 21.4%–26.4%; at temp 0.0 = 22.3% ± 1.8%, range 19.8%–25.2%. "Counter-intuitively, the variance never decreases and sometimes increases with temperature zero."
- Trajectories diverge at the **first few tokens**: median first divergence at token 5 for DeepSWE-preview at temp 1.0, rising only to token 56 at temp 0. A documented case (django__django-9296) has two temp-0 runs identical for 93 tokens, then diverging to opposite outcomes.
- Conclusion: "reported improvements of 2–3 percentage points may reflect evaluation noise rather than genuine algorithmic progress" ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)).

### 3.2 How many runs do you need? Concrete numbers

**Per-condition run count (On Randomness, Appendix A).** Using `n ≥ 2((Z_{α/2} + Z_β)/(Δ/σ))²` at p < 0.05:

- At the **median observed variance σ = 1.5%**, detecting a **2% improvement at 80% power requires 9 runs per agent**; at **95% power, 15 runs**.
- Required runs scale as an exponential function of effect size; the paper publishes curves for 1%, 2%, 5%, 10% improvements under σ = 0.7% and σ = 1.8% ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)).
- They verify normality with Shapiro–Wilk: **11 of 12 configurations pass** at p ≥ 0.05 with n = 10 runs, supporting the normal approximation for power analysis ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)).

**Task count, independent-sample design (Miller 2024).** With `n = (z_{α/2}+z_β)²(ω² + σ_A²/K_A + σ_B²/K_B)/δ²`, detecting a **3% absolute difference at 80% power and α = 0.05 with ω² = 1/9** requires **n ≈ 969 ≈ 1,000 independent questions** ("new evals should contain at least 1,000 questions in order to have good signaling ability"). If the question count is fixed at n = 198, increasing the per-question sample count K from 1 to 10 reduces the **minimum detectable effect from 13.2% to 7.5%** ([paper](https://arxiv.org/html/2411.00640v1)).

**Task fraction for a partial run (arXiv 2607.12338, KDD 2026 workshop).** Replaying completed public task-level records: at the strict 0-pp threshold on a 5-pp budget grid, AppWorld first meets all targets at **15% of tasks**, τ-bench at **25%**, **SWE-bench Verified at 90%**, and SWE-bench Lite does **not** converge by 95% ([paper](https://arxiv.org/abs/2607.12338)).

**Independent-sample vs paired.** The convergence audit computes that a 0.2-pp gap needs ~734,000 instances per system *unpaired*, and explicitly notes this "is not the paired McNemar requirement" ([paper](https://arxiv.org/html/2609.17394v1)). Pairing is the difference between an impossible and a feasible experiment.

**Small-n caveat: do not use the CLT.** *Position: Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints* (arXiv 2503.01747, ICML) shows that with N = 100 the 95% CLT interval achieves only **92.5% coverage**, that intervals can extend outside [0,1] or collapse to zero at N ≈ 20 (documented on a LangChain tool-use benchmark with N = 20), and recommends **Wilson score or Bayesian Beta-Bernoulli intervals** instead. Specialised agent benchmarks are exactly the small-N regime: the paper lists **SWE-bench Verified (500 samples across 4 difficulty levels), AIME (15 problems), MLE-bench (75), LiveBench (~55 per task), FrontierMath (~300, some categories <3 samples)** ([paper](https://ar5iv.labs.arxiv.org/html/2503.01747)).

**Also report clustered standard errors when tasks come in groups.** Miller shows clustered SEs can be **over 3× larger** than naive SEs (DROP: 1.34 vs 0.44, ratio 3.05; MGSM 1.88×), meaning unclustered error bars are anti-conservative. Reusable tasks/skills make this very likely in a memory experiment ([paper](https://arxiv.org/html/2411.00640v1)).

### 3.3 Paired binary comparison — McNemar

- **The recommended statistic for two systems evaluated on the same task set with binary outcomes is the paired-difference test; for binary outcomes that is McNemar's exact test.** Miller's framework derives paired inference on question-level differences and recommends it "wherever practicable", with the variance reduction `2·Cov(x_A,x_B)/n` ([paper](https://arxiv.org/html/2411.00640v1)).
- The **abeval** package (Zenodo DOI 10.5281/zenodo.21807422, Aug 2026) explicitly implements the standard toolkit for this setting: "paired comparison of two runs (**sign-flip permutation, paired t, exact McNemar**), power analysis for paired designs, and one-way random-effects ICC for judge noise", alongside Wilson/t/bootstrap/cluster-robust confidence intervals ([software record](https://zenodo.org/records/21807422)).
- Worked uses: the convergence audit applies **exact paired McNemar** to 29 adjacent leaderboard pairs and to 435 top-thirty pairs ([paper](https://arxiv.org/html/2609.17394v1)); *Inducing Reward-Free Judging Rubrics that Reduce Over-Crediting in Agent Evaluation* (arXiv 2608.13564, 2026) uses McNemar for binary judge comparison ([paper](https://arxiv.org/abs/2608.13564)).

**What I could not find:** a paper that *argues* McNemar is the field standard for agent evaluation. It is used (2609.17394, 2608.13564) and implemented (abeval), and it follows from the paired-analysis recommendation (Miller), but I found no methodological paper that names it as *the* standard. Flagged in §7.

### 3.4 Seeds, nondeterminism, and reporting

- **Temperature 0 is not deterministic.** On Randomness attributes residual variance to "floating-point precision, parallelization, hardware-specific optimizations, and batching strategies" ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)). Miller additionally warns against lowering temperature for variance reduction: in a worked example it "tripled the minimum variance in the score data from 1/12 to 1/4", or can bias the estimator ([paper](https://arxiv.org/html/2411.00640v1)).
- **Seed variance is a separate axis.** *Quantifying Variance in Evaluation Benchmarks* (arXiv 2406.10229, 2024) trained ten 7B models differing only in initialisation seed and measured benchmark-level seed variance: e.g. **COPA ±2.15 (95% CI 8.30), HumanEval ±1.11 (95% CI 3.98), MMLU ±0.57 (95% CI 0.72), Hellaswag ±0.21 (95% CI 0.93), GSM8k ±0.41 (95% CI 0.87)**. Generally seed variance sits **below** the 95% CI, but benchmarks with few test examples (COPA n=100, HumanEval n=164) show high variance on both ([paper](https://arxiv.org/html/2406.10229v1)).
- **Standard reporting practice that exists today:** SWE-rebench runs each model **five times** on the full benchmark and reports **SEM and pass@5** ([paper](https://arxiv.org/abs/2505.20411)). SkillsBench averages binary reward across **5 trials** and normalises by a fixed denominator of 84 tasks ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)). On Randomness criticises the field directly: "pass@1 is reported as the only metric; too often based on a single run; too rarely, the number of runs used to estimate it is reported" ([paper](https://ar5iv.labs.arxiv.org/html/2602.07150)).

---

## Q4. Contamination and training/eval leakage

### 4.1 What leakage actually looks like in agent benchmarks (with magnitudes)

| Leak type | Mechanism | Measured effect | Source |
|---|---|---|---|
| Solution leakage | The fix is pasted in the issue text/comments | 32.67% of successful SWE-Agent+GPT-4 patches; **33.04% of passed SWE-bench Verified instances (37/112)** | [SWE-bench+](https://arxiv.org/html/2410.06992v1) |
| Weak tests | Patches pass without fixing the issue | 31.08% of passed patches suspicious; resolve 12.47% → 3.97% after filtering | [SWE-bench+](https://arxiv.org/html/2410.06992v1) |
| Insufficient tests | Test suite rejects valid / accepts invalid | **7.7% of SWE-bench-Lite and 5.2% of Verified** have insufficient tests; 345 erroneous patches labelled pass; leaderboard ordering changes for **40.9% (Lite)** and **24.4% (Verified)** of entries | [UTBoost, arXiv 2506.09289](https://arxiv.org/abs/2506.09289) |
| Pretraining contamination | Training on the benchmark | File-path identification from issue text alone: **up to 76% on SWE-Bench-Verified vs up to 53% on external-repo tasks** | [SWE-Bench Illusion, arXiv 2506.12286](https://arxiv.org/html/2506.12286v2) |
| Raw leakage from public repos | Score inflation on a public benchmark | DeepSeek-V3-0324: **39.7% on SWE-bench Verified vs 21.3% on fresh SWE-rebench tasks**; DeepSeek-V3-1226: 35.2% vs 21.9%; LLaMA-3.3-70B: 18.1% vs 11.2% | [SWE-rebench](https://arxiv.org/abs/2505.20411) |
| Ground-truth exposure in the environment | Agent can read the answer | SWE-Lancer: agents "score 100% without solving tasks"; KernelBench: ground truth left in GPU memory | [ABC](https://arxiv.org/html/2507.02825v5) |

### 4.2 Detection mechanisms (named, reproducible)

1. **Time-window / cutoff-date filtering.** LiveCodeBench tags every problem with a contest release date and evaluates a model only on problems released after its cutoff; the *detection signal* is the performance discontinuity across months (DeepSeek drops after Aug 2023; GPT-4o after Nov 2023) ([paper](https://ar5iv.labs.arxiv.org/html/2403.07974)).
2. **Differential testing against a fresh equivalent benchmark.** SWE-rebench uses a continuous supply of newly collected tasks and compares per-model scores to SWE-bench Verified; static benchmarks "quickly become outdated due to contamination issues" and models' performance "might be inflated" ([paper](https://arxiv.org/abs/2505.20411)).
3. **Contamination-proxy probe tasks.** The SWE-Bench Illusion introduces two diagnostics: (a) **file path identification from the issue description alone**, with **filtered accuracy (F-Acc.)** as a control that removes instances whose descriptions contain path-like strings or imports; (b) **ground-truth function reproduction** scored by **5-gram consecutive accuracy**. Performance gaps between the target benchmark and same-repo-fresh / external-repo / SWE-Bench-C# / RefactorBench controls are the contamination evidence ([paper](https://arxiv.org/html/2506.12286v2)).
4. **Manual patch-vs-PR screening.** SWE-bench+ hand-compared model patches to gold PRs to classify leakage, incorrect fixes, incomplete fixes and different-files changes ([paper](https://arxiv.org/html/2410.06992v1)).
5. **Automated benchmark auditing.** ABA runs an evidence-collector agent + auditor agent (static and trajectory modes) over 168 benchmarks and validates findings against upstream fix PRs, expert review and independent reports ([paper](https://ar5iv.labs.arxiv.org/html/2605.26079)).
6. **Explicit contamination flags on a leaderboard.** SWE-rebench "precisely track[s] the creation dates of the issues and their corresponding pull requests against model release dates" and marks potentially contaminated evaluations on its leaderboard ([paper](https://arxiv.org/abs/2505.20411)).
7. **Negative age-effect test as a falsification check.** The convergence audit tested the contamination hypothesis by correlating PR year with top-ten solve rate: **r = −0.069, 95% bootstrap CI [−0.148, +0.012]** — no detectable age effect — and used this to argue the degeneracy is not primarily contamination ([paper](https://arxiv.org/html/2609.17394v1)). This is a good template for testing a contamination explanation rather than asserting one.

### 4.3 What SWE-bench itself does

- **Construction-level:** Stage III execution-based filtering retains an instance only if at least one test changes from fail to pass; `FAIL_TO_PASS` and `PASS_TO_PASS` are computed by running the test suite **before and after** the gold patch, and the task is "solved" only if **all** FAIL_TO_PASS **and** PASS_TO_PASS tests pass ([SWE-bench paper](https://arxiv.org/html/2310.06770v2)).
- **Train/eval repo disjointness for its own released model:** the SWE-bench-train set (19,000 issue–PR pairs from 37 repositories) is drawn from repositories **disjoint from the evaluation benchmark** specifically "to eliminate the risk of data contamination" ([SWE-bench paper](https://arxiv.org/html/2310.06770v2)).
- **Refreshability as the long-run answer:** SWE-bench describes its collection process as "continually updatable" so that issues created after a model's training date can be used ([SWE-bench paper](https://arxiv.org/html/2310.06770v2)).
- **What it does not do:** Verified does not address solution leakage — SWE-bench+ found 37/112 passed Verified instances containing direct solutions ([paper](https://arxiv.org/html/2410.06992v1)) — and OpenAI's 2026 audit found both flawed tests and memorisation in Verified ([secondary report](https://gigazine.net/gsc_news/en/20260429-swe-bench-verified/)).

### 4.4 The "train-only" discipline for building skills

I found the discipline expressed in three concrete forms, but **not as a single named rule** (flagged in §7):

1. **Explicit split semantics with per-cell coverage.** AFTER: "Tasks are assigned to three splits: train (used for evolution), test (unseen tasks for every role+skill combination), and validation" ([paper](https://arxiv.org/html/2606.23127v1)).
2. **Machine-checked leakage prevention at authoring time.** SkillsBench runs "a Claude Code Agent SDK-based validation agent … in CI to detect potential Skill-solution leakage; failed tasks are rejected", forbidding task-specific filenames, paths, identifiers, exact solving command sequences, constants/magic numbers from the task spec, and references to test cases or expected outputs ([paper](https://ar5iv.labs.arxiv.org/html/2602.12670v1)).
3. **Held-out repositories/data as a physical barrier.** SWE-bench's train/eval repo disjointness ([paper](https://arxiv.org/html/2310.06770v2)); SWE-bench Pro's 12 held-out + 18 proprietary repositories ([arXiv 2509.16941](https://arxiv.org/abs/2509.16941)); SWE-rebench's date-gated fresh tasks ([paper](https://arxiv.org/abs/2505.20411)).

**Why this matters for a null result:** skills built from *test-split* trajectories can inflate the with-skill arm through leakage rather than transfer, and AFTER's "source-context overfitting" finding is the inverse failure — "Skills evolved from narrow experience often exhibit source-context overfitting: they improve specificity while degrading generality." It explicitly contrasts this with "Skills evolved from diverse experience move toward the desired high-specificity, high-generality regime" ([paper](https://arxiv.org/html/2606.23127v1)). A skill built from a *single* source context will look good in-context and null out-of-context; that is a predicted measurement outcome, not necessarily a mechanism failure.

---

## Q5. Instrument validation practice

### 5.1 Programmatic graders — the norm is real and sometimes mandated

- **SWE-bench** ships gold-patch validation as its documented install check (`swebench eval verified --gold -i sympy__sympy-20590`) and a "Verifying Gold Patches" harness section using `--predictions_path gold` ([SWE-bench README](https://raw.githubusercontent.com/SWE-bench/SWE-bench/main/README.md), [harness docs](https://raw.githubusercontent.com/SWE-bench/SWE-bench/main/docs/reference/harness.md)).
- **SWE-bench's grader fails closed**: it flags `APPLY_PATCH_FAIL`, `RESET_FAILED`, `TESTS_ERROR`, `TESTS_TIMEOUT`; returns not-resolved for a `None` patch or empty status map; and has an explicit guard for "a suite that never started", with the code comment that under `FAIL_ONLY` "an absent test counts as success" — the exact bug that would silently convert a broken harness into 100% resolve ([grading.py](https://raw.githubusercontent.com/SWE-bench/SWE-bench/main/swebench/harness/grading.py)).
- **SWE-bench leaderboard rules**: pass@1 required; PASS_TO_PASS / FAIL_TO_PASS / hints forbidden; `swebench submit verify` re-derives every verdict from recorded logs; a "verified" checkmark requires independent rerun on a random subset ([experiments README](https://raw.githubusercontent.com/SWE-bench/experiments/main/README.md), [checklist](https://raw.githubusercontent.com/SWE-bench/experiments/main/checklist.md)).
- **Terminal-Bench** defines *Solvability* as the oracle solution passing all tests, and on submission "an automated workflow ran the task's oracle solution … other checks verified the absence of common failure modes (e.g., a **no-op 'dummy' agent should fail the task**)", plus three human reviewers and an adversarial exploit agent ([arXiv 2601.11868](https://arxiv.org/abs/2601.11868)).
- **Terminal-Bench-Science** makes it a hard CI gate: `harbor run … -a oracle` must reach **100% reward (reward = 1.0)** and `nop` must score **exactly 0** ([CONTRIBUTING.md](https://raw.githubusercontent.com/harbor-framework/terminal-bench-science/v0.1.0/CONTRIBUTING.md)).
- **Microsoft Vally** is the most explicit codification found: a dedicated `oracle` verb grades the golden patch/trajectory ("If a grader doesn't pass on the correct answer, the grader is wrong"), and `--no-golden-input` is a **negative control where graders should fail** — any grader that still passes is flagged "trivially passing" and exits 1 ([Vally CLI reference](https://microsoft.github.io/vally/reference/cli/oracle/)).
- **Agentic Benchmark Checklist item T.9**: "Providing an automatic oracle solver can help demonstrate the correctness of the task configuration." ABC also requires manually verifying test-case correctness (**O.d.1**) and backing it with objective metrics such as coverage and cyclomatic complexity (**O.d.2**) ([ABC](https://arxiv.org/html/2507.02825v5)).
- **Driven by real failures**: SWE-bench issue #26 reports "sometimes gold_patch cannot pass the test"; issue #393 found **42 of 61 leaderboard submissions had at least one patch editing the evaluation test file** (17 with >10 edits) and asked for "a sanity check on the predicted_patch … (e.g. through a patch dry run)" ([issue #26](https://github.com/SWE-bench/SWE-bench/issues/26), [issue #393](https://github.com/SWE-bench/SWE-bench/issues/393)).

**Benchmarks with no published golden-run gate:** τ-bench (end-state DB vs annotated goal state), AppWorld (state-based unit tests), OSWorld (initial-state config + per-task script), WebArena (functional correctness), GAIA (human-verified unique answers) ([GAIA](https://arxiv.org/abs/2311.12983), [τ-bench](https://arxiv.org/abs/2406.12045), [AppWorld](https://arxiv.org/abs/2407.18901), [OSWorld](https://arxiv.org/abs/2404.07972), [WebArena](https://arxiv.org/abs/2307.13854)).

### 5.2 LLM-as-judge validation

- **MT-Bench** (arXiv 2306.05685): GPT-4 judge agreement with human experts **>80%** (85% with ties excluded), roughly matching human–human agreement (81%) — and simultaneously documents position, verbosity and self-enhancement bias ([paper](https://arxiv.org/html/2306.05685v4)).
- **JudgeBench** (arXiv 2410.12784): on objective-correctness pairs, **vanilla GPT-4o scores 50.86% and GPT-4o-mini 50.00% against a 50% random baseline**; Claude-3-Haiku 33.14%; PandaLM 13.14% (below chance); o1-preview 75.43% ([paper](https://arxiv.org/html/2410.12784v2)).
- **Terminal-Bench** calibrates its judges against human labels: **93% Cohen's κ** on a 20-trial calibration subset; GPT-5 judge **90% agreement (92% precision / 90% recall)** against 120 human-labelled traces; command-level **92.4%** agreement with a 3-annotator majority ([arXiv 2601.11868](https://arxiv.org/abs/2601.11868)).
- **ABC item O.c.1** requires pilot experiments to assess an LLM judge's **accuracy and self-consistency** before use. ABC's audit found **WebArena uses an LLM-as-a-Judge "without validating its accuracy or consistency"**, producing a **1.4–5.2% performance overestimate** ([ABC](https://arxiv.org/html/2507.02825v5)).
- Other correlation-with-human practice: G-Eval Spearman 0.514 on summarisation; Prometheus 2 reporting highest human/GPT-4 correlation among open evaluators; the LLM-as-a-Judge survey treats reliability as needing careful design ([G-Eval](https://arxiv.org/abs/2303.16634), [Prometheus 2](https://arxiv.org/abs/2405.01535), [survey](https://arxiv.org/abs/2411.15594)).

### 5.3 Detecting a broken judge — measured failure modes

- **Position bias:** order-swap consistency **GPT-4 65.0%, GPT-3.5 46.2%, Claude-v1 23.8%**; "biased toward first" 30.0/50.0/75.0%; independently, swap-induced conflict rate 46.3% (GPT-4) and 82.5% (ChatGPT), with a Vicuna win rate moving from 2.5% to 82.5% by position alone ([MT-Bench](https://arxiv.org/html/2306.05685v4), [arXiv 2305.17926](https://arxiv.org/html/2305.17926v2)).
- **Verbosity bias:** the "repetitive list" attack wins **91.3%** for Claude-v1 and GPT-3.5 but only **8.7%** for GPT-4; reference-guided judging reduces math-grading failures from 14/20 to 3/20 ([MT-Bench](https://arxiv.org/html/2306.05685v4)).
- **Self-preference:** GPT-4 self-recognition 73.5%, Kendall τ = 0.41 between self-recognition and self-preference (0.74 after fine-tuning); a separate estimate puts GPT-4 self-preference bias at **0.520**, traced to perplexity rather than authorship ([arXiv 2404.13076](https://arxiv.org/html/2404.13076v1), [arXiv 2410.21819](https://arxiv.org/html/2410.21819v2)).
- **Sycophancy:** identical counterarguments are more persuasive as a user rebuttal than as a judge prompt — Llama-3.3-70B adopts it **86.0% vs 56.5%** and flips its own correct answer **80.3% vs 43.4%** ([arXiv 2509.16533](https://ar5iv.labs.arxiv.org/html/2509.16533)).
- **Prompt/format sensitivity:** paraphrase-equivalent prompts flip GPT-4o on **8.5%** of pairs vs **61.3%** for gemini-2.5-flash, with negative Cohen's κ (systematic disagreement) ([arXiv 2604.23478](https://arxiv.org/html/2604.23478v2)).
- **Detection tooling:** *Judging the Judges* measures Repetition Stability / Position Consistency / Preference Fairness over >100k instances (GPT-4 RS 0.97, PC 0.82); **LLMBar** provides 419 curated adversarial pairs where deceptive style misleads judges ([arXiv 2406.07791](https://ar5iv.labs.arxiv.org/html/2406.07791), [arXiv 2310.07641](https://arxiv.org/abs/2310.07641)).
- **Verifier reward-hacking:** an audit of five public terminal-agent benchmarks found **>15% of tasks demonstrably reward-hackable** (331 environments, 3,632 exploit trajectories); LLM-judge detection degrades when chain-of-thought is stripped (AUC 0.97 → 0.92) ([Terminal Wrench, arXiv 2604.17596](https://arxiv.org/abs/2604.17596), [arXiv 2604.28093](https://ar5iv.labs.arxiv.org/html/2604.28093)).

### 5.4 Verifier / reward-model validation

- **Overoptimisation is measurable:** proxy reward rises while gold reward is hump-shaped in optimisation distance (BoN `d(α−βd)`, RL `d(α−β log d)`); reward models near chance below ~2,000 comparisons; uncertainty-weighted ensembling "practically eliminates" overoptimisation ([arXiv 2210.10760](https://arxiv.org/abs/2210.10760), [arXiv 2310.02743](https://arxiv.org/abs/2310.02743), [arXiv 2406.15753](https://arxiv.org/abs/2406.15753)).
- **Process verifiers fail out-of-distribution:** ProcessBench (3,400 human-annotated step-error cases) finds existing PRMs do not generalise beyond GSM8K/MATH and underperform a PRM plainly fine-tuned on PRM800K ([arXiv 2412.06559](https://arxiv.org/abs/2412.06559)).
- **Graders that never discriminate:** *Measurement Without Validity* (arXiv 2608.00794, 2026) reports that **~82% of 55 surveyed agentic-evaluation papers use mismatched, incomplete or absent inter-rater reliability statistics**, and proposes thresholds **ICC ≥ 0.70, Krippendorff α ≥ 0.67/0.70/0.80** ([paper](https://arxiv.org/abs/2608.00794)).
- **Judge calibration is drift-prone:** *Reward-Free Judging Rubrics* reports false-pass rates of **0.115 vs 0.173** between rubric and baseline judges, with the rubric's agreement edge not significant (McNemar p = 0.248) ([arXiv 2608.13564](https://arxiv.org/abs/2608.13564)).

### 5.5 Published checklists (the closest things to a standard)

- **Agentic Benchmark Checklist (ABC)** — task validity T.1–T.10, outcome validity O.a–O.i, reporting R.1–R.13, including **T.9 (oracle solver)**, **O.c.1 (validate the LLM judge)**, **O.d.1–2 (verify test quality; report coverage/complexity)** and **R.10/R.12–13 (statistical significance; baseline comparisons)**. Measured payoff: ABC reduced CVE-Bench overestimation by **33%**; 7/10 benchmarks violated task validity, 7/10 outcome validity, 10/10 reporting ([paper](https://arxiv.org/html/2507.02825v5)).
- **BetterBench** (NeurIPS 2024 Datasets & Benchmarks, arXiv 2411.12990) — 46 lifecycle criteria; the **implementation stage is weakest: 17/24 benchmarks lacked a script that reproduces reported results, 14/24 reported no multi-run variance** ([paper](https://ar5iv.labs.arxiv.org/html/2411.12990v1)).
- **Terminal-Bench** publishes Specificity/Solvability/Integrity criteria plus a contributor checklist, an LLM check tool and an adversarial exploit agent ([arXiv 2601.11868](https://arxiv.org/abs/2601.11868)).
- **The NeurIPS Paper Checklist has no item requiring validation of the evaluator/harness itself** — reproducibility, code, statistical significance and assets, but not grader validation ([NeurIPS checklist](https://neurips.cc/public/guides/PaperChecklist)).

---

## Q6. Metric choice: binary resolve-rate vs graded/partial credit

### 6.1 Evidence for partial credit (binary loses signal)

- **TDAG / ItineraryBench** (arXiv 2402.10178, 2024) §5.4 is the cleanest same-benchmark comparison I have: binary scoring "fails to distinguish between different methods effectively" on low-completion tasks, while fine-grained scoring spreads methods across **42.85–49.08** ([paper](https://arxiv.org/abs/2402.10178)). *Caveat:* the exact binary values are only in Fig. 3 and were not verified by me.
- **Coarse success and partial correctness diverge** (arXiv 2606.20724, 2026, *When Web Agents Finish but Still Fail*): completion rises **50.7% → 96.0%** while element-wise F1 rises only **0.2489 → 0.4529** ([paper](https://arxiv.org/abs/2606.20724)).
- **Partial progress is the norm, not the exception**, in staged agent tasks: DeepRed CTF checkpoint partial credit shows the best of 10 LLMs reaching only **35% average checkpoint completion** ([AIware 2026 paper](https://2026.aiwareconf.org/details/aiware-2026-benchmark---dataset-track/5/Do-Agents-Dream-of-Root-Shells-Partial-Credit-Evaluation-of-LLM-Agents-in-Capture-th)).
- **AFTER deliberately reports both**: M1 = mean fraction of tests passed (partial), M2 = all-tests-pass (binary). The paper's static results are reported as M2, and its own comparison table shows per-cell deltas that are sometimes negative (e.g. GPT 5.4 Mini, Infra: −11.3) ([paper](https://arxiv.org/html/2606.23127v1)).
- **A synthesis that unifies both**: *Don't Pass@k* (arXiv 2510.04265, ICLR 2026) models outcomes as **categorical (not just 0/1) with a Dirichlet prior**, giving closed-form posteriors "for any weighted rubric" and "naturally extend[ing] to graded, rubric-based evaluations" ([paper](https://arxiv.org/abs/2510.04265)).

### 6.2 Evidence against naive graded scoring

- **Graded evaluators are path-hackable.** PartHackBench (GitHub `HongyeYangGT/PartHackBench`) reports a **mean Δhack of 0.252**, attack success **10/15**, and rollback detection **0/14 for historical evaluators vs 14/14 for current-state evaluators** ([repo](https://github.com/HongyeYangGT/PartHackBench)). *Flagged: practitioner artifact, not peer-reviewed.*
- **Graded judges can be trained-hacked while looking fine.** Rubric Dropout (arXiv 2608.11669, 2026) reports the training judge climbing while the gold judge falls **3 points (HealthBench-Hard)** and **22 points (ResearchQA)** ([paper](https://arxiv.org/abs/2608.11669)).
- **Scale choice itself moves results.** Grading Scale Impact on LLM-as-a-Judge (arXiv 2601.03444, 2026) finds **0–5 gives the best human–LLM alignment**, and that scale choice shifts agreement even at high panel reliability ([paper](https://arxiv.org/abs/2601.03444)).
- **False-pass rate may matter more than agreement.** *Inducing Reward-Free Judging Rubrics* (arXiv 2608.13564) argues the deployment-relevant number is false-pass rate (**0.115 vs 0.173**), not judge–human agreement ([paper](https://arxiv.org/abs/2608.13564)).
- **Step-level credit is contested.** For: Agent-as-a-Judge (arXiv 2410.10934) and AgentProcessBench (arXiv 2603.14465; 1,000 trajectories, 8,509 labelled steps, **89.1% inter-annotator agreement**). Against: *Credit Without Ground Truth* (arXiv 2608.19760, 2026) finds **no step-level credit signal shows reliable incremental fidelity beyond its marginal-matched shuffled control**, with implicit credit echoing fluency (rank corr +0.75), and no arm of a 7-arm pre-registered experiment beating the untrained policy ([Agent-as-a-Judge](https://arxiv.org/abs/2410.10934), [AgentProcessBench](https://arxiv.org/abs/2603.14465), [Credit Without Ground Truth](https://arxiv.org/abs/2608.19760)).

### 6.3 The direct signal-quality comparison

The strongest quantitative statement I found on graded vs binary *as measurement instruments* comes from a different literature (choice benchmarks, not agents), but it is directly relevant to the metric-granularity question:

*Quantifying Variance in Evaluation Benchmarks* (arXiv 2406.10229, 2024) compares discrete and continuous metrics for the same benchmarks across 10 training seeds and reports **signal-to-noise ratios (SNR)**. Continuous metrics have dramatically higher SNR in every case: **HumanEval 6.79 → 124.08; MMLU 52.45 → 347.57; COPA 38.63 → 662.41; Hellaswag 608.23 → 1921.15; SIQA 91.87 → 387.11**, and monotonicity during training is higher for continuous metrics in almost all cases. The paper concludes the SNR is "considerably higher for continuous metrics for all benchmarks, suggesting that they may be better when comparing models in the sense that they are less confounded by noise" ([paper](https://arxiv.org/html/2406.10229v1)).

**Bottom line for Q6:** graded/partial credit is well-supported for *increasing discriminative power and reducing noise* on low-completion tasks, and binary is well-supported as the *deployment-relevant commitment* metric — but these are supported by different bodies of evidence. **No controlled study scores the same agent trajectories under both metric types and reports variance, power, or effect sizes.** That is the central gap (see §7).

---

## 7. Explicitly NOT FOUND (do not treat as established)

I searched for these and could not substantiate them; they should not be assumed:

1. **No controlled head-to-head study** scoring the *same* agent trajectories under both binary and partial-credit variants and reporting variance, power, sample-size savings, or effect sizes. Closest approximations: TDAG §5.4, AFTER's M1/M2 pair, and the variance paper's discrete-vs-continuous SNR table (non-agent).
2. **No paper I found argues McNemar is *the* field standard** for paired binary agent comparison. It is used ([2609.17394](https://arxiv.org/html/2609.17394v1), [2608.13564](https://arxiv.org/abs/2608.13564)) and implemented ([abeval](https://zenodo.org/records/21807422)), and follows from Miller's paired-analysis recommendation, but I found no methodological paper naming it as standard.
3. **No single named "train-only discipline" rule** for skill construction. The practice exists in three forms (AFTER's split semantics, SkillsBench's CI leakage audit, SWE-bench/SWE-bench Pro held-out repos) but is not codified under one name.
4. **No venue- or funder-level mandate** requiring evaluator validation. The NeurIPS Paper Checklist has no evaluator-validation item; the norm is strong for programmatic graders (SWE-bench, Terminal-Bench, Vally) and recommended-but-unenforced for LLM judges.
5. **No "verifier validation" as a named research method** (score gold = 1, no-op = 0). Nearest equivalents: ABC T.9, Vally's `--no-golden-input`, Inspect's oracle solver.
6. **No "AI Agent Benchmark Cookbook"** publication exists under that title; do not cite it.
7. **No official SWE-bench Verified "pass rate vs test coverage" metric pair.** No formally proposed/validated "% of FAIL_TO_PASS passed" metric — only accuracy critiques (SWE-bench+, UTBoost).
8. **No evidence that graded metrics *compress* discriminative signal** (lower spread or power) with numbers. The graded-metric failure modes documented are over-crediting, reward hacking, calibration drift and training-dose confounds — not compression.
9. **OpenAI primary sources are unreachable** (HTTP 403 on both `introducing-swe-bench-verified` and `why-we-no-longer-evaluate-swe-bench-verified`, including the de-DE locale and via curl/urllib). All OpenAI claims above are from secondary reporting plus independent corroboration, and are marked as such.
10. **SkillsBench is not peer-reviewed** (arXiv preprint). The SoK on agentic skills itself cautions: "the quantitative findings in this subsection derive primarily from a single, non-peer-reviewed benchmark … independent replication across additional benchmarks is needed" ([SoK](https://arxiv.org/html/2602.20867v1)).
11. **Several 2026 preprints cited here are unrefereed** (2602.07150, 2605.12925, 2605.26079, 2606.23127, 2609.17394, 2605.18840, 2608.13564, 2608.00794, etc.). The R2E / SWE-smith / SWE-Gym lines do **not** propose graded metrics — they are environment/data/training work.

---

## 8. Diagnostic implications for a skills/memory experiment returning nulls

Each item is tied to a specific cited failure mode; these are instrument checks, not general advice.

1. **Compute your own noise floor before interpreting any effect.** Run the no-skill arm 5–10 times and measure the SD of the pass rate. If your observed with-skill delta is < ~2σ, it is not measurable: single-run pass@1 varies 2.2–6.0 pp and σ > 1.5 pp even at temperature 0 ([On Randomness](https://ar5iv.labs.arxiv.org/html/2602.07150)). At σ = 1.5%, 2% improvements need **9 runs at 80% power / 15 at 95%**.
2. **Check whether your task suite can separate *anything*.** Run the boundary case: two deliberately different conditions. If they do not separate, the suite has no headroom for the effect you are testing — the SWE-bench Verified top-thirty floor can be as low as 0 adjacent separations at n = 500 ([convergence audit](https://arxiv.org/html/2609.17394v1)). Use the audit's instance-budget inversion to price the suite you actually need.
3. **Validate the grader with a gold and a no-op before trusting either arm.** Gold must score 1.0, no-op must score 0.0; Vally flags "trivially passing" graders via `--no-golden-input`, and SWE-bench's grader needed an explicit "a suite that never started" guard to avoid silently scoring 100% ([Vally](https://microsoft.github.io/vally/reference/cli/oracle/), [grading.py](https://raw.githubusercontent.com/SWE-bench/SWE-bench/main/swebench/harness/grading.py), [ABC T.9](https://arxiv.org/html/2507.02825v5)). If your grader has never been handed a known-good patch, a null result is uninterpretable.
4. **Audit the test suite, not just the agent.** Insufficient/weak tests both reject correct patches and accept wrong ones: 5.2–7.7% of SWE-bench instances ([UTBoost](https://arxiv.org/abs/2506.09289)), 31.08% of passed patches suspicious ([SWE-bench+](https://arxiv.org/html/2410.06992v1)), and ≤59.4% of OpenAI's sampled failures flagged as flawed tests ([secondary report](https://gigazine.net/gsc_news/en/20260429-swe-bench-verified/)). A grader that rejects valid alternative solutions will null out a real skill effect.
5. **Check for leakage in the skill itself.** Run a machine audit for task-specific filenames, paths, constants and test references before measuring ([SkillsBench CI audit](https://ar5iv.labs.arxiv.org/html/2602.12670v1)). If skills were induced from the evaluation split, the with-skill arm is contaminated; if induced from a *single* source context, expect source-context overfitting that degrades generality by construction ([AFTER](https://arxiv.org/html/2606.23127v1)).
6. **Separate skill quality from retrieval quality.** Fix skill annotations at task definition and study retrieval separately, as AFTER does — otherwise a null aggregates two independent failure modes ([AFTER](https://arxiv.org/html/2606.23127v1)).
7. **Pair, and cluster.** Use same-task paired comparisons (a one-third variance reduction at correlation 0.5, more if higher) and clustered standard errors if tasks share repositories or skill families (naive SEs can be >3× too small) ([Miller](https://arxiv.org/html/2411.00640v1)). Use exact McNemar for paired binary outcomes, and Wilson or Beta-Bernoulli intervals rather than CLT intervals below a few hundred tasks ([abeval](https://zenodo.org/records/21807422), [Don't Use the CLT](https://ar5iv.labs.arxiv.org/html/2503.01747)).
8. **If you are using an LLM judge, calibrate it or expect a broken instrument.** JudgeBench puts vanilla GPT-4o at 50.86% against a 50% random baseline; WebArena's unvalidated judge produced a 1.4–5.2% overestimate; ~82% of surveyed agentic-eval papers report no adequate inter-rater reliability ([JudgeBench](https://arxiv.org/html/2410.12784v2), [ABC](https://arxiv.org/html/2507.02825v5), [Measurement Without Validity](https://arxiv.org/abs/2608.00794)).
9. **Consider reporting partial credit alongside binary resolve-rate** — but do not assume it is a free win. Graded metrics raise SNR substantially in the analogous choice-benchmark setting (HumanEval 6.79 → 124.08) and are the only way to see staged progress ([variance paper](https://arxiv.org/html/2406.10229v1), [AFTER M1/M2](https://arxiv.org/html/2606.23127v1)), yet graded evaluators are path-hackable and can drift under training ([PartHackBench](https://github.com/HongyeYangGT/PartHackBench), [Rubric Dropout](https://arxiv.org/abs/2608.11669)). Report both, plus the false-pass rate.
10. **Test the contamination explanation rather than assuming it.** The convergence audit's age-effect test (PR year vs solve rate, **r = −0.069, 95% CI [−0.148, +0.012]**) is a reusable falsification check ([paper](https://arxiv.org/html/2609.17394v1)).

---

### Companion files in this workspace
- `binary-vs-graded-agent-metrics-brief.md` — detailed brief on Q6, with its own NOT FOUND section.
- `evaluator-validation-brief.md` — detailed brief on Q5, including SWE-bench/Vally/Terminal-Bench harness citations.
