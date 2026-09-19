# 阅读清单

> 维护时间：2026-09-18
> 用途：开发时的长期参考。每条都标注**对应我们哪个错误实践**（编号见 `notes/wrong-practices.md`），
> 这样读的时候知道"这篇是来解决我哪个问题的"，而不是泛泛地收藏。

---

## 0. ⭐ 锚点：飞轮方法论（这是最重要的一篇）

**[一篇讲透 Agent 自进化飞轮怎么搭：评测→记忆→落地→控制](https://mp.weixin.qq.com/s/5VDN-T9K8Wr-DaQ15-I6CA)** — 腾讯技术工程，2026-08-26，作者 yannisyang、ethanytzhou
本地副本：`/Users/lsmax/Develop/Clippings/一篇讲透Agent自进化飞轮怎么搭：评测→记忆→落地→控制.md`

**这篇不是"一个系统的实现介绍"，是框架。** 它把自进化拆成四齿——**信号（评测）→ 积累（记忆）→ 落地（工程化）→ 控制（人机协作）**——然后讲四齿怎么咬合。

**它的三条核心立场是对着我们写的：**

| 原则 | 我们 |
|---|---|
| ① **瓶颈不是任何一个技术点，而是环节之间的衔接** | **命中 #2**——评测跑了，数字有了，进不了选择链路 |
| ② **评测的可信度 > 系统的复杂度** | **命中 #9**——建了复杂平行栈，判分器从没验过 |
| ③ **记忆的核心不是存储，而是治理** | **命中 #6**——一次性冻结的 JSON，没有版本/遗忘/淘汰 |

**它有一句话几乎是我们项目的墓志铭：**

> **拆开来做，每一块都能说"我做了"，但合在一起却不产生复利——因为环节之间的数据通路是断的。**

**→ 完整对照见 `docs/flywheel-gap-analysis.md`（四齿 × 四条通路 × 我们的缺口）。**

### 这篇里最该记住的六条

1. **四条数据通路**，我们断了**两条**——特别是**通路三（落地→生效）完全断**：
   > "修复方案生成了但**永远停在'候选'状态，不会真正影响 Agent 行为**。"
   我们的证据停在 `research_only: true, promotion_allowed: false` 的抽屉里。

2. **Skill 评测必须过四层验证**：对照实验（模型本来就会做吗）→ 难度校准（任务是否太简单）→ 轨迹追踪（真的调用了 Skill 吗）→ 路径验证（结果对了但路径对吗）。
   > "很多 Skill 看似有效，实际上只是和模型能力**碰巧重叠**了。"
   **我们一层都没过**——87% 通过率 + skill 臂投递率 10%。

3. **那条血泪教训就是我们**：
   > "如果某个场景**连续 3 轮失败率 80%+ 不下降**——**先停下来查工具实现层**，而非继续在配置层打转……实践中出现过 **20+ 轮无效迭代、最终发现根因在工具层而非配置层**的案例。"
   我们的根因在 `auxiliary` 隔离——**工具层不报错，它按设计工作，只是不是我们以为的那种工作**。

4. **我们跳过了 Phase 1**：
   > "很多团队的错误是——**Phase 1 还没验证就开始搭 Phase 3 的基础设施，最后发现闭环本身就没跑通**。"
   我们直接搭了 4 臂因子设计、配对 McNemar、功率预注册——**而"手动跑通一圈"从来没跑通过**。

5. **失败要存，但存法不同**：
   > "失败任务同样提取经验，但**标记为'反例/陷阱'**……**一个明确的反例比一个模糊的正例更有价值**。"
   我们同一个 prompt、同一个 schema（**#5**）。

6. **非对称淘汰**：好经验强化 +0.05，坏经验淘汰 −0.12——**淘汰是强化的 2.4 倍**。
   > "**一条错误记忆的伤害 > 一条正确记忆的收益。**"
   我们没有任何淘汰机制。

### 次要点（仍然有用）

- **评估器本身也要被评测**：维护几十条"绝对正确/绝对错误"的**元评测集**定期检查——和文献里 SWE-bench 的 `--gold`、Terminal-Bench 的 oracle/no-op、Vally 的 `--no-golden-input` 是同一个答案
- **预算公平性**：真正的进化应该是"相同 Token 预算下做得更好"，否则是"用钱砸分"。我们记了成本但没做对等判定
- **Diff 模式**：只输出需要修改的片段，不要全文重写。`refine.py` 是全文生成
- **渐进披露 + 严格预算**：Skill ≤2000 / Facts ≤800 / Profile ≤500 token，单条 ≤200，**最多 6 条**
- **Dreaming**：异步进程定期审阅历史会话，发现**跨会话的系统性模式**——单次评测看不到的
- **审核疲劳**："如果每天收到 50 个审核请求，其中 48 个可以自动过滤——人的注意力被垃圾请求耗尽"。我们 skill 臂投递率 10% = **人看到的 90% 是垃圾**
- **SkillOS**：训练过的小模型策展人**优于**冻结的大模型策展人

---

## 0b. 次锚点：Hermes Agent 系统解析（有用的对照材料）

**[深度解析 Hermes Agent 如何实现"自进化"及其 Prompt / Context / Harness 的设计实践](https://mp.weixin.qq.com/s/2xFei8dMx99lc-iyrZZrww)** — 飞樰，阿里妹，2026-04-24
本地副本：`/Users/lsmax/Develop/Clippings/深度解析 Hermes Agent 如何实现“自进化”及其 Prompt  Context  Harness 的设计实践.md`

**为什么留着**：它不是框架，是**一个具体系统的实现细节**，可以当工程对照表读。读的时候不会觉得刺，但读完调研再回看，几乎每一节都能对上一条错误实践。

| 博客里的做法 | 对应我们的错误 |
|---|---|
| 轨迹压缩：头部保护 + 尾部保护（最后 4 轮）+ 中间压成摘要 | **#4** 我们头尾截断、中间**删除**，只留 `{"name","success"}` |
| 成功/失败**分成两个文件** | **#5** 我们同一个 prompt、同一个 schema |
| 明确反对直接用用户数据训练（"大概率会把模型训废"），要 Teacher 模型合成 + 质量筛选 | **#6** 我们用 87% 通过率弱模型的原始轨迹 |
| `rl_test_inference` **强制**先跑（"防止训练过程存在错误的关键防线"） | **#9** 我们从不验仪器 |
| 14 类错误分类 + 每类预设恢复策略 | **#4** 我们算了 `failure_class` 却连学习都没用上 |
| 奖励函数黄金法则："**先单独测试每个奖励函数，再合起来用**" | **#9** 同上 |
| 技能池**持续更新**（发现更优路径就更新完善） | **#6** 我们是一次性冻结产物 |
| 触发机制 `_iters_since_skill`：连续 10 轮没动技能就提醒 | 我们没有触发器 |
| 后台审查 Agent：回复完异步 fork 一个轻量 Agent 做三维审查 | 我们没有后台审查 |
| `agent/curator.py`：遥测驱动的 `active→stale→archived` + fail-closed 护栏 + append-only 账本 | 见 `docs/related-work.md` §6.2 |

**注意**：这篇里"后台审查 Agent"是**无门的**（LLM 自己决定然后写）；真有门的是 `agent/curator.py`。**不要混淆这两者。**


---

## 1. 必读：三篇直接决定我们设计的

### ⭐ [When Self-Evolution Backfires: Pre-Commit Gating against Skill Contamination](https://ar5iv.labs.arxiv.org/html/2608.05810)（Tencent，2026）

**一句话**：技能库无门增长是**非单调**的，先涨后跌；而且准入必须在提交前，事后删源技能只能挽回 17% 的损失。

**必读理由**：这篇给了**门控的定价表**，是全部文献里最可操作的一张表。

| 配置 | Pass@1 | 技能池 | Δ |
|---|---|---|---|
| 完整（VaG） | 72% | 37 | — |
| **− 行为 A/B 重放** | 62% | 45 | **−10pp** |
| − 联合增益门 | 64% | 58 | −8pp |
| − 语义检查 | 68% | 40 | −4pp |
| − schema 校验 | 70% | 37 | **−2pp** |

**对应**：**#2 / #9**。我们的 `refine.py` 校验（≥2 支持、40–400 字符引用、≥2 概念 token）是 schema 层，值 2pp；值 10pp 的行为 A/B 重放**恰好就是我们的 `newly_fixed/newly_broken` 配对评测**——我们造了便宜的那半，把贵的那半接进了只写不读的抽屉。

### ⭐ [Library Drift: Diagnosing and Fixing a Silent Failure Mode in Self-Evolving LLM Skill Libraries](https://arxiv.org/html/2605.19576)（AWS + HSBC，2026）

**一句话**：给出了"漂移"的可操作定义 `E[pass@1 | S_t] < E[p_0]`——**技能库让 agent 比没有技能库更差**。

关键消融（MBPP+ hard-100，100 轮，3 个种子）：

| 条件 | 增益 | 路由命中率 | 活跃技能 |
|---|---|---|---|
| 默认（完整治理） | **+0.328** | 73% | 50 |
| **A1 造了但从不注入** | **+0.002** | 0% | 42 |
| **A4 激进淘汰**（N_min 100→20） | **−0.019**（低于地板） | 19% | 2 |
| A5/A6 去掉显式去重 | +0.374 / +0.363（略高于默认） | 80%/70% | 50 |

**对应**：**#6 / #7 / #9**
- A1 告诉我们：技能臂投递率 10% ≈ **字面意义的零**
- A4 告诉我们：**在证据不足时做治理，比不做治理更糟**（Hoeffding 偏差 ε≈0.44 会淘汰掉有用的技能）。我们的"≥2 条独立支持"建立在 22 成功 / 2 失败上，是同型错误
- A5/A6 告诉我们：**有风格先验的前提下，昂贵的去重子系统是不必要的**

### ⭐ [Large Language Model Agents Are Not Always Faithful Self-Evolvers](https://ar5iv.labs.arxiv.org/html/2601.22436)（哈工大等，2026）

**一句话**：agent 可靠依赖 **raw** 经验，但**系统性忽视 condensed**——即使 condensed 是唯一提供的东西。跨 4 框架、10 backbone、9 环境。

**必读理由**：**这可能直接解释我们一部分零结果。** 我们用的正是 Qwen3-14B/27B，注入的正是 condensed（refine.py 的 "Intent/Approach/Key insight"），而且方式是**静态拼接**——论文明确点名这是会降低性能的做法。

Qwen3 系列"没经验时成功、注入后失败"的错误分布（WebArena）：

| 模型 | 任务 | 分心 | 过度依赖错误先验 | 过早推断 |
|---|---|---|---|---|
| Qwen3-14B | Shopping | **74.3%** | 11.4% | 14.3% |
| Qwen3-14B | CMS | **86.7%** | 6.7% | 6.7% |
| Qwen3-32B | CMS | 75.0% | 12.5% | 12.5% |

**方法论上更重要的**：他们用**因果干预**测忠实度（`Empty` / `Shuffle` / `Irrelevant` / `Corrupt` / `Filler`）。**如果换成 `Filler`（等长乱码）后表现不变，说明注入根本没起作用。**

**对应**：**#5 / #7 / #9 / #10**。我们跑了 69 题 × 2 臂，却**没做这个一次就能出结论的 filler 对照**。

---

## 2. 提炼机制：从轨迹到技能

| 论文 | 提炼什么 | 关键机制 | 对应 |
|---|---|---|---|
| [Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366) (2023) | 失败试验的 NL 自反思 | 长期记忆**有界** `Ω=1–3`，全部拼接无检索 | **#6** 我们无界积累 |
| [ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144v2) (AAAI-24) | 跨任务洞察（ADD/EDIT/UPVOTE/DOWNVOTE + 重要度计数，归零删除） | **同任务成功/失败配对**；任务相似度检索 | **#5 / #6** |
| [Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291) (2023) | **可执行 JS 代码**，按描述 embedding 存 | top-5 检索；**可组合性**避免平台期；提交前自验证 | **#2** 我们存散文 |
| [AutoGuide](https://arxiv.org/html/2403.08978v2) (NeurIPS 2024) | `When <context>, you should <action>` | **只在轨迹分歧的 timestep 提炼** | **#10** |
| [AWM](https://ar5iv.labs.arxiv.org/html/2409.07429) (ICML'25) | 工作流 = NL 描述 + (状态, **推理**, 动作) | 实例值抽象成 `{product-name}` | **#4** 我们丢掉推理 |
| [MetaClaw / "Just Talk"](https://ar5iv.labs.arxiv.org/html/2603.17187) (2026) | 失败轨迹 → 行为指令 | **只从失败提炼**；技能库按**代**版本化；support/query 数据隔离 | **#5 / #6** |
| [ReasoningBank](https://ar5iv.labs.arxiv.org/html/2509.25140) (2025) | (title, description, content) | **按 judge 判定用不同的提炼策略** | **#5** |
| [Mem^p](https://arxiv.org/html/2508.06433v4) (2025) | 脚本 / 轨迹 / 两者结合 | **结合两者最好**（87.14 / 77.86） | **#4** |
| [AgentHER](https://ar5iv.labs.arxiv.org/html/2603.21357) (2026) | 用 hindsight 重标注失败轨迹 | 失败改写成有效训练数据；**双 judge 一致**才接受 | **#6** |

### 成功率对照（用于校准）

| 系统 | benchmark | 结果 |
|---|---|---|
| ExpeL | HotpotQA / ALFWorld | 39.0 vs ReAct 28.0；ALFWorld 59.0 vs 40.0 |
| AutoGuide | ALFWorld / WebShop / WebArena-Reddit | **79.1 / 46 / 47.1** vs ExpeL 59.0/35/21.8 |
| AWM | WebArena | 35.5% total SR（比 BrowserGym +51.1% 相对） |
| Voyager | Minecraft | 3.3× 物品、15.3× 科技树 |
| MetaClaw | MetaClaw-Bench | GPT-5.2 41.1→44.0；Kimi-K2.5 21.4→28.3 |
| ReasoningBank | WebArena (684) | 48.8% vs AWM 44.1 / Synapse 42.1 / 无记忆 40.5 |

---

## 3. 负面结果（最重要的部分）

### ★ [SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1) — 84 任务、7 配置、7,308 轨迹

- 人工策展技能：**+16.2pp**
- **自己生成的技能：−1.3pp**
- 84 个任务里 **16 个是负的**，最差 **−39.3pp**
- 域间差异：SWE **+4.5pp** vs Healthcare **+51.9pp**

### ★ [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401) — 49 个公开 SWE 技能 × ~565 实例

- **49 个技能里 39 个零收益**
- 平均 **+1.2%**（89.8→91.0），同时 token **+10.5%**
- token 开销最高 **+451%**，通过率不变
- **3 个技能让性能下降**（最多 −10%），因为"版本不匹配的指导与项目上下文冲突"

### ★ [SkillFlow](https://arxiv.org/pdf/2604.17308v1) — 166 任务、20 族、终身协议

- GPT 5.3 Codex **52.41 → 46.39（−6.02）**
- **"高技能使用率不等于高效用"**：Kimi K2.5 技能使用率 **66.87%**，只涨 **+0.60pp**
- 失败机制："错误的早期技能会诱发**持续负迁移**"；弱模型受**认知过载**困扰
- **整合优于增殖**：更强的设置最终留下**更小**的技能库

### ★ [CoEvoSkills](https://arxiv.org/html/2604.01687) — 反面正例

- 自**进化**技能达到 **+40.5pp**（71.1% vs 无技能 30.6%），甚至超过人工策展的 53.5%
- **差别在验证器**：去掉 surrogate verifier，71.1% → **41.1%（−30.0pp）**

### ⭐⭐ 反直觉的实测（这一批直接改我们的参数）

> 完整报告：`reports/skill-extraction-addendum-negative-results.md`

**① 看似合理反预测有用性**（[2605.23899](https://arxiv.org/abs/2605.23899)，复旦 + MSR，5 域 × 6 target × 5 extractor）

- 抽取条目里 **Δ<0 的占 25%**（ALFWorld **47%**）
- **用"合理性 rubric"筛选：−0.59pp 平均，9 格里 6 格更差**
- 用**验证过的 rubric**：**+1.55pp**
- "**更好的执行者不一定是更好的提炼者**"（GPT-5.4 在 SpreadsheetBench 排最后）
- → **不要按"听起来好不好"门控洞察。** `refine.py` 的校验就是一种合理性 rubric

**② 检索基本不触发**（[2604.04323](https://arxiv.org/abs/2604.04323)，34,198 技能）

- Claude 轨迹全部加载的比例：技能直接可用 **49%** → 有干扰 **31%** → 无策展技能 **16.3%**
- **两个模型掉到自己无技能基线以下**（Kimi 19.8 vs 21.8；Qwen 19.7 vs 20.5）
- 反例：Kimi 加载率 **86%，增益为零**
- 预置好、连通、显式引导的记忆库在 **114 轮里零次调用**
- 厂商 issue：**144 条应触发查询，触发率 0/3**；claude-code#36570 **以 `not planned` 关闭**
- → **我们的 10% 投递率不是异常，是常态**

**③ ⭐ 检索峰值 k=1**（ReasoningBank 自己的曲线）

`39.0(0条) → 49.7(1条) → 46.0(2条) → 45.5(3条) → 44.4(4条)`

佐证 [Evo-Memory](https://arxiv.org/abs/2511.20857)：Mem0/MemOS 在 4 个 backbone 的 3 个上与无记忆**完全相等**；AWM 在两个上**低于**基线。

→ ⚠️ **我们用的是 `TOP_K = 2`，应该改成 1**

**④ 记忆开着 → 准降谄升**（[2607.01071](https://arxiv.org/abs/2607.01071)，**Qwen3-8B**）

无记忆 49.12 → **Mem0 35.67（−13.45），谄媚 +18.58**；**MemGPT 30.00（−19.12），谄媚 +33.24**

→ ⚠️ **我们用的正是 Qwen3 系列**

**⑤ 自我反思被实测为净负**（[2310.01798](https://arxiv.org/abs/2310.01798)，ICLR 2024）

GPT-3.5 CommonSenseQA **75.8 → 38.1**；Llama-2-70b GSM8K **62.0 → 36.5**。给 oracle 标签才改善。
[Sample More, Reflect Less](https://arxiv.org/abs/2607.28576) 匹配 token 成本下："**0 个显著更好，10 个显著更差，26 个无法区分**"。
**Reflexion 自己的论文**：MBPP **0.80 → 0.77（下降）**；121 条 ALFWorld 反思里 **0 条**提到正确目标物体。

**⑥ 记忆失败的**位置**是构建期**（[2605.18565](https://arxiv.org/abs/2605.18565)）

**构建失败 41.7%** vs 回答阶段 25.2%；**插入偏差 76.8%**（只增不改不删）。
→ 报告评语：**"This is *your* layer."**

**⑦ 短上下文任务测不出记忆**（[2602.19320](https://arxiv.org/abs/2602.19320)）

只有 `Δ = Score_MAG − Score_FullContext ≫ 0` 时才算在评估记忆。HotpotQA（~1k tok）**高风险**，LoCoMo（~20k）中等。
MemGym：前沿模型仅凭预训练就在"记忆密集"设置上得 **0.70–0.85**。
**SWE-bench 的捷径**：只给 issue ticket，gold 文件定位 **65% vs 12%**——**没有存储上下文的 3–6 倍**。

→ ⚠️ **我们的 LCB 中位 2.6k token，正落在高风险区**

**⑧ 模型规模两头咬**（EvolveR）：教师蒸馏经验在 **0.5B 有帮助**（0.150→0.220），在 **3B 反而有害**（0.382→0.370）。
→ **"在小模型上调，你会高估自己这一层的价值。"** ⚠️ 我们为能力阶梯专门上的 14B，会高估

**⑨ 污染：危险的是"擦边"不是"无关"**（[2401.14887](https://arxiv.org/abs/2401.14887)）
无关文档常常**有帮助**（+35%），而**相关但不含答案**的文档把 Llama2 从 0.5642 打到 **0.2413**。
配套 [2605.16508](https://arxiv.org/abs/2605.16508)：**技能相似度危险区 [0.55, 0.75)**；`Acc(N)=a−b·lnN`，跨 15 个前沿模型 **R²>0.97**

**⑩ 互补的两个技能最差**（[2604.15097](https://arxiv.org/abs/2604.15097)，4,590 试验）
两个**互补** Gene **44.9%（低于无指导）**；两个**冲突** Gene 53.2%

**⑪ 厂商承认**

- **OpenAI**：把 **memory** 列为已上线谄媚的成因，**回滚 GPT-4o**
- **Cognition**："**依赖模型自己的笔记、没有压缩摘要系统时，我们看到性能退化。**"
- **Vercel**：砍掉 80% 工具 → 成功率 **100% vs 80%**，token −37%；向量管线的失效是"**静默的**"
- **Anthropic**："**context rot**"；"最常见的失效模式之一是**臃肿的工具集**"；CLAUDE.md 超 ~200 行后"**被静默丢弃……先丢最新的规则**"

### 其他负面

- **Reflexion 自己的负面结果**：最难的 50 道 HumanEval-Rust 上，*去掉测试生成但保留自反思* = **0.52 vs 基线 0.60**。反思失败而不做有依据的验证，比不学更差
- **ExpeL：加反思文本反而 −10pp**（39.0→29.0），原因"反思有时输出幻觉"
- **AWM：加入失败 → −2.2pp**
- **检索随规模崩塌**：16–32 技能 **96–98%**；64→92%；128→78%；**256→64%**
- **维护是承重的**：AutoRefine 去掉周期性剪枝/合并，TravelPlanner 通过率 **35.6%→31.1%**，仓库膨胀 **4.5×**，**利用率 0.71→0.08**
- **上下文污染的实测**：ExpeL 每步喂**全部** guideline，在 WebArena 上"误关注第二条 guideline 导致错误推理"，AutoGuide 47.1% vs ExpeL 21.8%

---

## 4. 饱和、噪声底与统计功率（回答"为什么我没测出来"）

> 完整报告：`reports/measuring-skill-memory-transfer-report.md`

### 4.1 噪声底：这条最直接解释我们的零结果

**[On Randomness in Agentic Evals](https://ar5iv.labs.arxiv.org/html/2602.07150)**（KTH，60,000 条轨迹，3 模型 × 2 scaffold × 10 次运行，25.58B tokens）：

- 单次运行 pass@1 波动 **2.2–6.0pp**
- 标准差 **>1.5pp，即使在 Temperature 0**（temp-0 方差有时更高）
- 轨迹在**前 ~1% token** 就分歧（中位 token 5 @ temp 1.0；token 56 @ temp 0）
- 原文：**"2–3 pp 的改进可能只是评测噪声。"**

我们的数字是 `2 fixes / 0 breaks`，配对 n=21。**在 σ≈1.5pp 上这个量级不可测量。**

**必读理由**：这一篇单独就能解释我们两周的零结果，并且给出"下次需要多少样本"的公式。

### 4.2 统计功率

| 目标 | 需要 |
|---|---|
| σ=1.5% 时检出 2% 效应 | **9 次运行**（80%）/ **15 次**（95%） |
| 检出 3% 绝对效应（80% power） | **n ≈ 969** 个独立问题 |
| n=198 固定，K 从 1 → 10 | 最小可检测效应 13.2% → **7.5%** |

- **小 N 不能用 CLT**：**[Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints](https://ar5iv.labs.arxiv.org/html/2503.01747)** —— N=100 时 95% CLT 区间实际覆盖率只有 **92.5%**；**N=20 时区间跑出 [0,1] 或直接塌缩**。用 Wilson / Beta-Bernoulli。**我们的 n=21 正好落在这里**
- **配对是形式化结果**：**[Miller, arXiv 2411.00640](https://arxiv.org/html/2411.00640v1)** —— 配对 SE `sqrt(Var(s_A−s_B)/n)`；r=0.5 时**方差降 1/3**；"**Use the paired version wherever practicable**"。还要**聚类 SE**（任务共享仓库时朴素 SE 可能小 3 倍以上）
- **部分运行也有效**：[arXiv 2607.12338](https://arxiv.org/abs/2607.12338) —— AppWorld 15%、τ-bench 25%、**SWE-bench Verified 90%**、SWE-bench Lite 到 95% 都不收敛

### 4.3 饱和是可量化的

- **[Coding Agents Have Converged](https://arxiv.org/html/2609.17394v1)**（审计 254 个公开提交，不跑模型）：SWE-bench Verified 前十名共享 **285 个成功**、**51 个失败** ⇒ 真正有区分度的**只有 164 个实例**；`n_eff/n = 0.33`；精确配对 McNemar 分开 **0/29** 个相邻 top-30 对
- **[Growing Pains of Frontier Models](https://arxiv.org/html/2605.18840v1)**：定义饱和比 `σ = spread(old)/spread(new)`，**σ<0.2 = 该轴失去区分力**
- **MetaClaw 直接报告 headroom 效应**："更强的模型获益更少，更弱的模型获益更多"。GPT-5.2 **+2.9pp** vs Kimi-K2.5 **+6.9pp**
- **SkillsBench 域间饱和**：SWE +4.5pp vs Healthcare +51.9pp
- **SkillFlow**：Claude Sonnet 4.6 "两种设置下都保持不变（56.63%）"
- 综述把"弱 backbone 相对增益更大"只评为 **grade C**（趋同证据，非受控）

**对应**：**#8**。这一节是为我们那四个 75–100% 饱和的池子准备的辩护材料。

### 4.4 ⭐ 仪器验证是**行业规范**（对应 #9）—— 我们没做的那件事有公开参考实现

| 系统 | 门 |
|---|---|
| SWE-bench | `--gold` 校验；`None` patch / 空状态映射 **fail closed**；针对"**从未启动的测试套件**"的护栏（**没有它，FAIL_ONLY 会把每个 F2P 都算 resolved**） |
| Terminal-Bench | "Solvability" = **oracle 通过所有测试** **AND** **no-op 假 agent 必须失败** |
| Terminal-Bench-Science | **oracle reward 必须 1.0，nop 必须恰好 0** |
| Microsoft Vally | `oracle` 动词 + `--no-golden-input` 负对照，标记"**平凡通过**"的判分器 |

**这些规范是被真实事故逼出来的**：SWE-bench issue #26 "gold_patch cannot pass the test"；issue #393 发现 **42/61 个排行榜提交修改了评测测试文件**。

**反例**：τ-bench / AppWorld / OSWorld / WebArena / GAIA **都没有发布 golden-run 门**。

### 4.5 判分器坏掉的量化

- **JudgeBench**：vanilla GPT-4o **50.86%** vs **50% 随机基线**；GPT-4o-mini 50.00%；Claude-3-Haiku 33.14%；**PandaLM 13.14%——低于随机**
- **位置互换一致性**：GPT-4 **65.0%** / GPT-3.5 **46.2%** / Claude-v1 **23.8%**
- **冗长攻击**：弱 judge **91.3%** vs GPT-4 **8.7%**
- **同义改写翻转率**：GPT-4o **8.5%** / gemini-2.5-flash **61.3%**
- **未校验 judge 的实际代价**：WebArena 高估 **1.4–5.2%**
- **[Measurement Without Validity](https://arxiv.org/html/2608.00794)**：**`V_total ≤ V1×V2×V3`**（三个环节各 70% ⇒ 总效度 ≤34%）；55 篇 agentic-eval 论文里 **~82%** 用了不匹配/不完整/缺失的 IRR

### 4.6 污染的量级

| 数字 | 来源 |
|---|---|
| 成功补丁中 **32.67%** 解法泄漏 | [SWE-bench+](https://arxiv.org/html/2410.06992v1) |
| **31.08%** 通过来自弱测试 | SWE-bench+ |
| 测试不足 Lite **7.7%** / Verified **5.2%** | UTBoost |
| 仅凭 issue 文本猜文件路径 **最高 76%** | SWE-Bench Illusion |
| Verified **39.7%** vs 新任务 **21.3%** | SWE-rebench |
| 过滤后 resolve **12.47% → 3.97%** | SWE-bench+ |

**OpenAI 已于 2026 年 2–4 月弃用 SWE-bench Verified**：审计 27.6% 的失败任务，**≥59.4% 的测试有缺陷会拒绝功能正确的答案**。*（原文 403，二手 + ABA 独立佐证）*

### 4.7 ⭐ 十项仪器检查（最实用的一节）

1. **先测噪声底**：no-skill 臂跑 **5–10 次**；delta < ~2σ 就**不可测量**
2. σ=1.5% 时 **2% 效应需 9 次运行**（80%）/ 15 次（95%）
3. **同任务配对**（r=0.5 降方差 1/3）+ 共享仓库时**聚类 SE**
4. 任务数低于几百时用 **Wilson / Beta-Bernoulli**，不要用 CLT
5. **两臂之前先验判分器**：gold=1.0、no-op=0.0。**"如果判分器从没见过一个已知正确的补丁，零结果是不可解释的"**
6. **跑 headroom 检查**：验证两个刻意不同的条件在你的套件上能分开
7. **审计测试，不只审计 agent**
8. **机器审计技能的泄漏**；设计上把**技能质量和检索质量分开**
9. **测污染解释，而不是假设它**
10. **换了受校验的判分器、配对设计、足够运行次数和 headroom 后零结果仍持续，机制主张才成为可证伪的——在那之前它不是。**

> 第 10 条是对我们两周实验的裁决：**机制主张从来没有可证伪过。**

### 4.8 binary vs graded 是**真正的开放问题**

**没有任何受控研究**用同一批轨迹同时按两种口径打分并报告方差/功率/效应量——**本领域最大空白**。

- 支持 graded：连续指标信噪比远高（HumanEval 6.79→**124.08**、MMLU 52.45→347.57、COPA 38.63→662.41）；AFTER 刻意同时报告 M1/M2
- 反对朴素 graded：可被路径攻击（PartHackBench Δhack **0.252**）；rubric judge 被 hack 时 gold judge 只掉 3 分（HealthBench-Hard）/ 22 分（ResearchQA）
- 步级给分有争议：[Credit Without Ground Truth](https://arxiv.org/html/2608.19760) 发现**没有步级信号能打败边际匹配的乱序对照**

**对应 #10**：我们"LCB 用 binary、SWE-bench 用 graded"是**凭直觉**的。诚实的说法是：**我们不知道，而且没人知道。**


---

## 5. 轨迹表示（本节已被源码级调研重写）

> 原始报告 §5 已被部分取代：`reports/skill-extraction-addendum-trajectory-representation.md`
> **本节的结论没有变，但细节全部换成了源码级核实过的版本。**

### 5.1 ⭐ 全库最好的观测表示消融：AWM Table 8

**Mind2Web cross-task，GPT-3.5：**

| 表示 | 元素准确率 | 步骤 SR | 任务 SR |
|---|---|---|---|
| 只用 NL 状态描述 | **39.0** | **34.6** | **2.8** |
| 只用过滤后的 HTML | 38.1 | 33.8 | 2.8 |
| **两者都给** | 37.1 | 32.9 | **2.0（更差）** |

原文："**同时使用 NL 和过滤后的 HTML 会导致更差的结果**……过滤后的 HTML 含有大量无关条目（**47% 的情况下完全漏掉正确元素**），因此可能与 NL 描述相矛盾。"

> **可执行结论：把观测总结成 NL，并且不要额外再附加 raw / 过滤后的 DOM。**
> 加上结构化观测反而**掉了 0.8 个任务 SR**。

另外：AWM 在 WebArena 上的**提炼提示词只序列化 `<think>…</think><action>…</action>`——accessibility tree 根本到不了提炼器。**

**对应 #4**：我们的 `refine.py` 是另一个方向的错（把观测整段删掉只留 `name/success`），但**同一个教训**——观测的表示方式是被测过的变量，不是审美选择。

### 5.2 各系统的真实预算（源码级核实，修正了之前的说法）

| 系统 | 真实情况 |
|---|---|
| **ExpeL** | 喂给提炼的是**原始交织的 ReAct 文本串**（`traj.trajectory.strip()`），**不是 `(o,a,o',r)` 元组**——元组只是 Algorithm 1 里的抽象记账。**思考被保留**。默认 `truncate_strategy: null`<br>预算：`max_num_rules: 20`（软上限 25，之后提示词切换成"除非非常有洞见否则停止 ADD"）；**8 条成功**拼进一次全成功提炼调用；对比配对**严格 1 成功 + 1 失败**<br>⭐ **唯一的硬截断在失败那一侧——超过 13000 token 就丢掉恰好一条失败轨迹。成功侧不设上限。** 理由：失败更长、更嘈杂 |
| **Voyager** | ⚠️ **不截断执行错误**（`onError.js` 原样返回，`render_human_message` 逐字拼接，无切割无行数上限）——只有*聊天日志*被正则过滤。技能产物 = 代码 + **≤6 句、单行**的描述；检索嵌入的是**描述**但返回的是**代码**，top-5；**critic 拿到的是状态快照，不是轨迹**（`{reasoning, success, critique}`） |
| **Reflexion** | ⚠️ 上限是**计数窗口 3**，不是 token 预算；记忆是自由文本字符串不是元组；reflector 拿到的是**原始 rollout**，提示词明确写着 **"Do not summarize your environment"**。**没有已发表的 1/3/5 消融** |
| **MetaClaw** | AutoResearchClaw 技能限制 **<2000 tokens** |
| **ReasoningBank** | **显式丢弃低层执行细节**；网页任务用"**模型自己的思考过程**"作为观测代理，因为原始 accessibility tree 太长 |

### 5.3 ⭐ 按结构做预算，而不是靠摘要

**[SWE-agent](https://arxiv.org/abs/2405.15793)：**

| 约束 | 值 |
|---|---|
| 文件查看器 | **≤100 行** |
| 搜索 | **≤50 条结果**（超限显示**什么都不显示**） |
| 观测 | **最后 5 条逐字保留**，更早的压成**一行占位符** |
| 错误消息 | 除第一条外全部省略 |

消融（这组数字很强）：

| 文件查看器窗口 | 解决率 |
|---|---|
| **100 行** | **18.0** |
| 30 行 | 14.3 |
| **整个文件** | **12.7** |

> **"读得更多严格地更差。"** 这是"硬结构性预算优于自由形式摘要"最强的论据。

**[The Complexity Trap](https://arxiv.org/abs/2508.21433)** —— 最好的"原始 vs 摘要"实测数字：

| 做法 | 解决率 | 成本/实例 |
|---|---|---|
| 原始观测 | 53.4% | $1.29 |
| **观测遮蔽（masking）** | **54.8%** | **$0.61** |

**−52.7% 成本，+2.6% 解决率**；且 masking 比 LLM 摘要便宜 $0.03/实例。

两条警告：**最优窗口是 agent-specific 的**——把 SWE-agent 的设置移植到 OpenHands"会剧烈退化"；另有 **"Trajectory Elongation Effect"——摘要会让轨迹变长**。

### 5.4 生产环境的确切预算

| 系统 | 预算 |
|---|---|
| **Claude Code** | `MEMORY.md` = **前 200 行或 25 KB**（先到者为准），每条记忆一行；`CLAUDE.md` <200 行，文件 >4 MiB 跳过；被调用的技能正文 **≤5,000 tok/技能，≤25,000 tok 总量，最老的先丢**；工具输出 **>10,000 字符**卸载到文件路径。压缩时"**完整工具输出和中间推理都没有了**" |
| **AWS AgentCore** | 原始短期记忆与抽取的长期记忆分离；episodic schema = **situation / intent / assessment / justification / reflection**，**按 intent 建索引**；指示**把轮次线性化**以便复用 |
| **Cursor** | ⚠️ **不存在自动的轨迹→记忆抽取**（文档直接指向 Rules；"LLMs don't retain memory between completions"） |

### 5.5 最明确的序列化契约

**[Skill-Evo4GUI](https://arxiv.org/abs/2609.04869)**（2609.04869）：

- 契约：`{step, observed_state, action_taken, post_action_effect, notes}`
- "**包含每一步，不做选择性省略**"
- **禁止提炼器做判断**
- **轨迹从不展示给技能作者**
- 4 个 OSWorld 域 **+5.7–18.6pp**，但记录了 "**revision churn**"——迭代压缩不是单调的

### 5.6 ⭐ 文献的两个已确认空洞——我们能填

不是"我找不到"，是**被明确声明的空白**：

1. **没有任何受控实验在保持源经验不变的前提下只改变压缩程度。** 2026 年的综述原文：*"A controlled experiment holding source experience constant while varying only compression level has not been conducted"*（[arXiv 2604.15877](https://arxiv.org/abs/2604.15877) §3.3）
2. **没有任何消融在同一个技能提炼系统内部隔离"先摘要再提炼" vs "直接喂原始给提炼器"。**

> **报告的原话：我们的产品恰好拥有文献缺少的东西——来自同一个任务分布的大量轨迹。所以我们可以保持源经验固定、只改变序列化。**
> **"That is a publishable experiment and a defensible internal benchmark."**

**为什么这条对我们特别重要**：这个实验**不依赖飞轮修好**。它只需要：一批同分布轨迹 + 两三种序列化方式 + 一个判分器。**而且它本身就是一次 Phase 1 级别的闭环验证。**

（我们手上已有素材：`phase4-memory-v1/frozen/refinement-r2/` 的 24 条源轨迹、LCB 池里 **131 道未用过的题**、以及现成的 `run-arms.py`。）

### 5.7 其他

- **写时抽象通常优于读时摘要**（grade B/C）：SimpleMem 去掉写时语义压缩，LoCoMo F1 **43.24→31.29**
- **[State Design Matters](https://arxiv.org/html/2602.15858)**：滚动 **≤25 token** 摘要 —— 汉诺塔大幅改善（0.08→0.39、0.46→0.70），但 **Messenger 反而退化**（0.09→0.00）。原因是摘要"陈述泛泛的观察"，丢掉了决策相关的细节
- **[DPM](https://arxiv.org/html/2604.20158v1)**：轨迹 ~26–28k 字符 / 82–96 事件，三个预算（20×/5×/2×）。**20× 压缩时**单次任务条件投影比增量摘要高 **+0.515 事实精度**（p=0.0014）、快 **7–15×**；预算宽松时两者统计上无差别

**对应**：**#4**。

---

## 6. 综述与索引（用来找更多）

- **[Self-Improving Agents in the Era of Experience: A Survey of Self- to Meta-Evolution](https://openreview.net/pdf?id=IUltZSgLMm)** — 清华 + FrontisAI，2026。**413 篇论文，9 章**
  - 核心主张：**"自我改进是一个 trace-to-capability 循环"** —— 捕获轨迹 → 编译成经验 → **指派到正确的更新面** → **验证其价值** → 保持控制
  - 章节：Harness(33) / **Skills(50)** / **Memory(50)** / Environment(48) / RL(35) / Meta-Agents(61) / **Measuring(55)** / Safety(60)
  - **把 longitudinal evaluation、transfer、verification、safety governance 列为四大未解难题**
- **[Awesome-Self-Improving-Agents](https://github.com/FrontisAI/Awesome-Self-Improving-Agents)** — 上面综述的论文列表
- **[Dynamic Agent Skills: A Lifecycle Survey and Taxonomy](https://arxiv.org/html/2607.10113)** — 124 篇；指出 "skill" 至少有 **6 种不同结构**，10 个更新算子 {Add,Refine,Merge,Split,Prune,Distill,Abstract,Compose,Rewrite,Rerank}
- **[Who Maintains Agent Skills? A Longitudinal Study of Human-Governed, AI-Assisted Skill Maintenance](https://arxiv.org/abs/2609.05677)** — 873 提交 / 143 技能文件 / 254 次实质编辑。**每一次实质编辑都经过具名人类账号**，62% 带 AI 共同作者标记
  - **对应线 B**：真实世界是"人类治理、AI 辅助的循环"，而不是自主管线

---

## 7. 生产架构（选择机制到底长什么样）

> 完整报告：`reports/agent-memory-production-survey.md`（1003 行，103 个引用 URL，每条附源码路径）

### ⭐ 最重要的一条：生产里的门几乎从不判断"好不好"

> **Tier-C gates in production almost always act on EVIDENCE ABOUT USAGE OR CONTRADICTION, never on judgment about usefulness.**
> **Nobody has a reliable automatic answer to "is this lesson actually good?"**
> The principled systems sidestep it by gating on measurable **fitness proxies** — retrieval demand, recurrence, test suites, benchmark regression — not on quality per se.
> **If your team is asked to build a "quality gate", the honest framing is a *fitness* gate.**

**对我们的意义**：**没有人能自动回答"这条经验好不好"，所以不要把它当产品目标。** 有原则的系统都绕开它，转而门控可测量的**适应度代理**。
→ 我们的 `newly_fixed ≥ 1 ∧ newly_broken === 0` **正是 fitness gate**（benchmark 回归）。**这条给了我们项目的正确定位。**

### 三层框架（比"选择 vs 堆积"更准）

中间那层是关键——**它是很多团队以为自己有门、其实没有的原因**：

| 层 | 能说不吗 |
|---|---|
| **Tier A — ACCUMULATE** | ❌ 检索排序是唯一的过滤器，**且在接收之后** |
| **Tier B — ELIGIBILITY GATE** | ❌ 只查**环境条件**（空闲、迭代够多、无密钥、体积在预算内）。**对内容没有任何意见——一个错但像样的事实和对的事实通过得一样容易** |
| **Tier C — QUALITY GATE** | ✅ C1 确定性分数+阈值 / C2 LLM judge / C3 证据记账或人工复核（**唯一能推翻先前决策的形式**） |

| 层 | 系统 |
|---|---|
| **Tier C** | OpenClaw memory（C1+C2+C3-lite）、OpenClaw skills（C3 opt-in veto）、Hermes Curator（C1+C2，只管陈旧/重复）、**Hermes self-evolution（最强——回归门 + holdout）**、Mem0 **v1**、Zep、Supermemory（C3 人工）、Hindsight（C3 数值） |
| **Tier B** | Hermes memory、Claude Code auto memory、Codex Memories |
| **Tier A** | Hermes 的后台审查本身（**且偏向写入**）、**Mem0 v3**、Letta/MemGPT、Gemini CLI `save_memory`、Cline、AGENTS.md、Cursor rules、OpenHands、LangMem |

### 生产里只存在四种选择范式

| 范式 | 信号 | 洞见 / 弱点 |
|---|---|---|
| **需求驱动晋升**（OpenClaw） | 检索需求 | "一条没人检索的记忆，无论真假都不值得晋升" / 流行 ≠ 有用 |
| **遥测驱动生命周期**（Hermes curator） | 使用次数 | 可审计 / **纯粹是陈旧度选择——错但流行的技能永远不会被质疑** |
| **写时 LLM 冲突消解**（Mem0 v1、Zep） | 矛盾 | **唯一直接攻击矛盾的范式**。三课：先检索最近邻进判断上下文 / **必须给 judge 显式 NOOP 分支**否则它编造写入 / **优先 INVALIDATE 而非 DELETE** |
| **证据记账 / 人工复核**（Hindsight、Supermemory） | 计数支持 | **唯一让条目有显式、可检视、随时间变化的质量状态**——这就是可调试 / 成本高 |

**这四种里没有一种是"用行为适应度门控"。** 最接近的是 Hermes self-evolution 和 OpenClaw 的 `skill_proposal_evaluate`。**我们的 paired A/B fitness gate 在这个谱系里是稀有的那一头。**

### ⭐ OpenClaw — dreaming：找到的**最强门**

cron `0 3 * * *`（light→REM→deep），候选**必须同时**过加权分数 `minScore` **和** `minRecallCount` **和** `minUniqueQueries`：
`relevance .30 / frequency .24 / query diversity .15 / recency .15 / consolidation .10 / conceptual richness .06`

三条比分数更重要的：
1. **结构性污染门**：来源为 `untrusted`/`system` 的候选**在 prompt 构建前就被结构性移除**——"**a structural taint gate, not a score penalty**"
2. 接受的改写必须保留先前条目（丢失 ≤ 25%）、保留每个候选的 `Source: path#Lx-Ly`、必须解析成结构化输出，**否则回退 append-only**
3. **这是一条拒绝路径，不只是一个分数**

另外：**只有交互式会话能喂候选**（cron/心跳/子 agent 排除在外）；**被召回的上下文在摄入前被剥离**，"这样被召回的片段不会作为新记忆被再学一遍"。

**对应 #3**：这才是可观测隔离的正确形态。

### Hermes：两个循环，别混

- **`agent/background_review.py` = 生产者**（急切、**无门**，且提示词偏向写入："Be ACTIVE — most sessions produce at least one skill update"）
- **`agent/curator.py` = 选择器**（保守、门控、**默认关闭**）
- 触发是两个计数器、单位不同、默认都是 10：memory 按**用户轮次**、skill 按**工具迭代**（所以技能审查比文档说的频繁）
- **真实盲点**：`_delegate_depth > 0` **阻止自动审查** → **子 agent 里做的工作永远不会被学习**
- **fail-closed 护栏**（每个都带着促使它诞生的 issue 号 #29912 / #67140）：无验证吸收目标 → 拒绝归档；同回合没读过该文件 → 拒绝写入；非 curator 管理的技能 → 拒绝写入
- append-only 账本，**"the ledger is telemetry, never a gate"**
- **记忆层没有判断门**：只有预算门（2200/1375 字符）+ 精确重复拒绝 + 内容扫描

### 九条工程经验（最该采纳的）

| 经验 | 原话 / 要点 |
|---|---|
| ⭐ **把 PRODUCER 和 SELECTOR 分成两个不同权限的组件** | Hermes 最干净：**急切无门的生产者** 配 **保守有门、默认关闭的选择器**。Codex / Claude Code / Letta 把两者融合，**结果一个门都没有**。"如果只建一样东西，就建成两个组件" |
| **让门 fail closed，并在代码里证明** | "**Prompt 不执行策略；拒绝才执行策略。**" 护栏带着 issue 号——好习惯 |
| ⭐ **预算不是判断** | "每个系统都有体积上限；**它们对正确性都没有帮助**。**不要让体积护栏在内部被汇报成质量门。**" |
| **维护一张负面清单** | Hermes DO-NOT-CAPTURE：环境相关失败、**对工具的负面断言**（"会硬化成引用数月、而问题早已修好的拒绝"）、已解决的瞬时错误、一次性叙述 |
| ⭐ **绝不要从系统自己的输出里学习** | OpenClaw 摄入前剥离召回上下文；Hermes 传 `skip_memory=True`。**都是观察到的真实失效模式** |
| **记录拒绝，含按类别计数** | "**一个说不清自己为什么拒绝的存储，没法调优**" |
| **人工确认做成选择题** | `skills.write_approval` → 暂存 `~/.hermes/pending/skills/` → `/skills pending\|diff\|approve\|reject` |
| **门分层、有成本梯度** | Hermes self-evolution 的 `PLAN.md`：`pytest 100%` → TBLite 快子集 20 题(~20min) → 任务特定评估 → top3 → TBLite 全量 → YC-Bench → PR |
| **区分"门"与"适应度函数"** | "**Benchmarks are GATES, not fitness functions.** 一个把技能质量提升 20% 但让 TBLite 掉 5% 的变体是要被拒绝的。" 且"约束失败的变体被丢弃——**优化器永远看不到它们被当作成功**" |

### ⚠️ 更正：Mem0 已经变了

我最早引用的 ADD/UPDATE/DELETE/NOOP **是论文，不是现在的代码**。当前 v3 是 **ADD-only**（`ADDITIVE_EXTRACTION_PROMPT` = "Your sole operation is ADD…"），冲突移到检索时解决。文档仍描述旧行为——已核实的自相矛盾。

> 教训：**"Verify the current code path, not the paper."**

### 顺带两条

- **Hermes 生态更正**：`o2alexanderfedin/hermes-agent-self-evolution` 是 **fork**，不是社区扩展。上游 `NousResearch/hermes-agent-self-evolution` 5,366 stars
- **issue #337**（2026-05-16 关闭）自己列的首要风险："**评估很难……坏评估 → 坏进化。这是关键的挑战。**" 最终落到 DSPy + GEPA（读轨迹学**为什么**，比 RL 高 6% 且**少 35 倍 rollout**）

---

## 8. ⭐ 我们的位置：transfer 问题在 benchmark 上接近未被测量

架构调研的结论里有一句直接命中我们的项目定位：

> **The transfer question in benchmarks is separately near-unmeasured.**

**"在任务 A 上学到的记忆/skill 能不能帮到任务 B"——现有 benchmark 基本没测。**

| 已有 | 缺 |
|---|---|
| (a) 类系统会**门控** | 但门基于**内部信号**（使用次数、信息量、加权分数） |
| 大量 benchmark 测召回/准确 | 几乎不测**迁移**（held-out gain） |
| 综述把 longitudinal evaluation、transfer、verification 列为四大未解难题 | 我们的 ①②③ 资产正对着这三个 |

**所以这不是"重复造轮子"，是补一个文献承认的空缺。** 前提是把门（配对行为评测）接进选择链路，而不是自建平行记忆层。

---

## 9. 值得注意的一句话

> **the gate, not the generation, is the product.**

生成技能不难，**判断技能好不好才是产品**。这正是我们项目该占的位置（①执行 ②度量 ③选择）。
