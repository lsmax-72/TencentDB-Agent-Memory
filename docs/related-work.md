# 相关工作调研

> 维护时间：2026-09-18（第 5、6 节待补：评测协议、生产架构两个调研还在进行）
> 用途：回答"别人是怎么做的"，并且**每一条都落到我们自己的错误实践上**（编号见 `notes/wrong-practices.md`）
> 原始报告：`reports/skill-extraction-literature-review.md`（369 行，逐条带原文链接）
> 论文索引与阅读优先级：`docs/reading-list.md`

---

## 0. 锚点：飞轮方法论与我们的缺口

**[一篇讲透 Agent 自进化飞轮怎么搭：评测→记忆→落地→控制](https://mp.weixin.qq.com/s/5VDN-T9K8Wr-DaQ15-I6CA)**（腾讯技术工程，2026-08-26）

这篇是**框架**，不是某个系统的实现介绍。它把自进化拆成四齿——**信号（评测）→ 积累（记忆）→ 落地（工程化）→ 控制（人机协作）**——核心是四齿怎么咬合。

> **拆开来做，每一块都能说"我做了"，但合在一起却不产生复利——因为环节之间的数据通路是断的。**

**→ 我们逐条的缺口分析在 `docs/flywheel-gap-analysis.md`。** 结论一句话：

> 不是 benchmark 选得不合适，也不是机制无效。
> **是我们的飞轮缺了"落地→生效"这个齿，所以无论跑多少实验，结论都停在抽屉里。**
> 而且我们在缺一个齿的情况下，还在给另一个齿加功率。

### 四条数据通路

| 通路 | 断了会怎样 | 我们 |
|---|---|---|
| 一：评测 → 记忆 | 做对了但不会记住 | ⚠️ 半断（**#4** 轨迹字段被砍） |
| 二：评测 → 落地 | 知道自己有问题但不会去改 | ✅ 通 |
| **三：落地 → 控制 → 生效** | "**修复方案生成了但永远停在'候选'状态，不会真正影响 Agent 行为**" | ❌ **完全断**（**#2c**） |
| 四：生效 → 下一轮评测（回流） | 进化是一次性的 | ❌ 断（**#6** 一次性冻结产物） |

### 一条"血泪教训"，逐字命中我们

> 如果某个场景**连续 3 轮失败率 80%+ 不下降**——**先停下来查工具实现层**（API 参数错误、服务端返回异常、数据根本没回来），而非继续在配置层打转。**配置层的进化解决不了工具层的 Bug**——实践中出现过 **20+ 轮无效迭代、最终发现根因在工具层而非配置层**的案例。

我们的根因在 `auxiliary` 隔离导致注入被整条跳过（**#1 根因**）。**而且它是最容易被误诊的一类**：工具层不报错，日志里正常写着 `→ auxiliary (skip ... injection ...)`——**它工作得很正常，只是不是我们以为的那种工作**。

### 落地路线：我们跳过了 Phase 1

| Phase | 周期 | 目标 |
|---|---|---|
| **Phase 1：最小闭环** | **1–2 周** | 验证"评测能发现问题 + 记忆能记住教训"。**手动跑一遍完整闭环**，人工占比 80% |
| Phase 2：半自动化 | 2–4 周 | 自动生成 + CI 评测门禁 + 版本管理 + 评测集三分法 |
| Phase 3：飞轮运转 | 1–2 月 | 灰度 + 回流 + 异步 Dreaming + 渐进放权 |

> "很多团队的错误是——**Phase 1 还没验证就开始搭 Phase 3 的基础设施，最后发现闭环本身就没跑通**。"

我们直接搭了 4 臂因子设计、配对 McNemar、功率预注册——**而 Phase 1 从来没跑通过**。

---

## 0b. 次锚点：Hermes Agent 系统解析（工程对照材料）

**[深度解析 Hermes Agent](https://mp.weixin.qq.com/s/2xFei8dMx99lc-iyrZZrww)**（飞樰，2026-04-24）

不是框架，是**一个具体系统的实现细节**。当工程对照表读。逐条对照见 `docs/reading-list.md` §0b。

**另外两个 Hermes 相关的发现（对我们的集成路线直接相关）：**

**（1）项目里已经有 `/hermes/<spaceId>` 原生适配器**

`MemoryProxy/src/handler.ts:60-63`：

```
spaceId（从请求路径 /{agent}/{spaceId}/... 提取）覆盖 config.tdai.serviceId，
使写入/召回被限定在该 space 内
```

这是**作用域隔离**，**而且不跳过注入**。而 `agents/hermes/README.md` 记录的标准接法是 `base_url: http://<proxy-host>:8096/hermes/<spaceId>`。

我们跑的是 `http://127.0.0.1:8096/dsh/default/v1/chat/completions` + `x-deepseek-harness-compact: 1`（→ `auxiliary` → 跳过注入）。

**隔离这件事根本不需要选 auxiliary。** 这直接回答了我之前列的待验证前提 #1。

**（2）项目已经发过一个 Hermes memory provider 插件**

`MemoryCore/hermes-plugin/memory/memory_tencentdb/`，把原生能力映射得很清楚：

| Hermes 钩子 | Gateway 端点 | 行为 |
|---|---|---|
| `prefetch(query)` | `POST /recall` | **同步。返回 `<memory-context>` 文本用于注入** |
| `sync_turn(user, assistant)` | `POST /capture` | 后台守护线程 fire-and-forget，最多 4 个在飞 |
| `on_session_end` | `POST /session/end` | 冲刷未完成的管线 |

这正是我们手搓的三件事（注入、提炼、收尾）。而且 `plugin.yaml` 里：

```yaml
hooks:
  - on_memory_write               # reserved; not yet mirrored to the Gateway
  - on_session_end
```

**`on_memory_write` 就是选择层该挂的地方，原生把接口留好了。**

---

## 1. 战略判断：我们的项目在文献里的位置

综述 [Self-Improving Agents in the Era of Experience](https://openreview.net/pdf?id=IUltZSgLMm)（清华 + FrontisAI，413 篇）的核心主张：

> **自我改进是一个 trace-to-capability 循环。**
> 一个部署的系统必须：捕获交互轨迹 → 编译成可用经验 → **指派到正确的更新面** → **验证它的价值** → 在系统变化中保持控制。

我们**捕获**了。错在 **assign**（自建了一个更新面）和 **verify**（仪器坏 + 功率不足）。

综述把 **longitudinal evaluation、transfer、verification、safety governance** 列为四大未解难题。**verification 是其中之一。**

### 最重要的一句判断

从全部调研里，只有一句结论值得写在墙上：

> **the gate, not the generation, is the product.**
> —— 生成技能不难，判断技能好不好才是产品。

证据链：

| 证据 | 数字 |
|---|---|
| SkillsBench：自己生成的技能 | **−1.3pp**（人工策展 +16.2pp） |
| SkillsBench：84 个任务里负收益的 | **16 个**，最差 −39.3pp |
| SWE-Skills-Bench：49 个技能里零收益的 | **39 个**（平均 +1.2%，token +10.5%） |
| SkillFlow：GPT 5.3 Codex | **−6.02pp** |
| **但** CoEvoSkills（带共同进化验证器） | **+40.5pp** |
| VaG：去掉行为 A/B 重放门 | **−10pp** |
| CoEvoSkills：去掉 surrogate verifier | **−30.0pp** |
| 我们的 `refine.py` 校验（schema 层） | 值 **2pp** |

**我们的立论是对的**（①执行 ②度量 ③选择），**我们只是造了错的那一半。** 而值 10pp 的行为 A/B 重放，**恰好就是我们的 `newly_fixed / newly_broken` 配对评测**——我们把它接进了一个只写不读的抽屉（见 `notes/wrong-practices.md` 2c）。

---

## 2. 提炼：从轨迹到技能，文献怎么做

### 2.1 主要系统对照

| 系统 | 提炼什么 | 存储 | 检索 | 对应我们的 |
|---|---|---|---|---|
| [Reflexion](https://ar5iv.labs.arxiv.org/html/2303.11366) 2023 | 失败试验的 NL 自反思 | 有界 episodic `mem`，**Ω=1–3** | 全部拼接，**无检索** | #6 无界积累 |
| [ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144v2) AAAI-24 | 跨任务洞察，ADD/EDIT/UPVOTE/DOWNVOTE + **重要度计数**（新=2，归零删除） | 洞察集 + Faiss 成功轨迹库 | 全部洞察拼接；成功轨迹按**任务相似度** top-k（all-mpnet-base-v2） | #5 #6 |
| [Voyager](https://ar5iv.labs.arxiv.org/html/2305.16291) 2023 | **可执行 JS 代码** | 向量库，**key = 描述 embedding** | 查询 = 自生成计划 + 环境反馈；top-5 | #2 我们存散文 |
| [AutoGuide](https://arxiv.org/html/2403.08978v2) NeurIPS'24 | `When <context>, you should <action>` | 字典 `G[context] → {guidelines}` | context 识别模块索引字典；LLM 选 top-k | #10 |
| [AWM](https://ar5iv.labs.arxiv.org/html/2409.07429) ICML'25 | 工作流 = NL 描述 + (状态, **推理**, 动作) | 追加到 system prompt | 离线全注入 / 在线累积；**无语义检索** | #4 丢掉推理 |
| [MetaClaw](https://ar5iv.labs.arxiv.org/html/2603.17187) 2026 | 失败轨迹 → 行为指令 | 按**技能代** `g` 版本化 | 句向量 top-k 余弦 | #5 #6 |
| [ReasoningBank](https://ar5iv.labs.arxiv.org/html/2509.25140) 2025 | (title, description, content) | 扁平 bank，**合并 = 简单追加** | embedding top-k | #5 |
| [Mem^p](https://arxiv.org/html/2508.06433v4) 2025 | 轨迹 **和** 脚本 **和** 两者结合 | 可编辑仓库，Add/Validation/Reflection/discard | 向量检索 | #4 |

### 2.2 成功 vs 失败 —— 直接 A/B 证据

**唯一干净的对照：[ReasoningBank Fig. 7](https://ar5iv.labs.arxiv.org/html/2509.25140)**（WebArena-Shopping，Gemini-2.5-flash）

| 记忆设计 | 只用成功 | 加入失败 | Δ |
|---|---|---|---|
| Synapse（原始轨迹） | 40.6 | 41.7 | +1.1 |
| **AWM（只用成功的工作流）** | 44.4 | 42.2 | **−2.2** |
| **ReasoningBank（按结果分别提炼）** | 46.5 | **49.7** | **+3.2** |

作者解读："不同于基线，ReasoningBank 能把失败**转化为建设性信号而不是噪声**。"

> **AWM 的 −2.2 是要害**：把失败派生物**朴素地追加进"只用成功"的管线，比完全不用失败更差。**

### 2.3 ExpeL 的消融被广泛误引 —— 一个更正

网上常有人说"ExpeL 做了只用成功/只用失败/都用的消融"。**那个表不存在。** 它做的是提炼上下文来源的消融（[§5.6 Table 3](https://ar5iv.labs.arxiv.org/html/2308.10144v2)）：

| 变体 | HotpotQA SR |
|---|---|
| ReAct 基线 | 28.0 ± 1.4 |
| 人工手写洞察 | 32.0 ± 1.1 |
| **洞察 + 反思文本** | **29.0 ± 0.4** |
| gpt-3.5 而非 GPT-4 提炼 | 32.0 ± 0.4 |
| **ExpeL 完整版** | **39.0 ± 1.7** |

- **加反思文本反而 −10pp**。原文归因："反思有时输出幻觉，从而误导提炼阶段。"
- **LLM 提炼打败人工手写**（39.0 vs 32.0）
- 另一个消融：只用 fewshot 提炼的 agent"相比 ReAct 没有优势"；**采集阶段不用 Reflexion 重试（⇒ 没有成功/失败配对）的 agent 更差**。所以**对比配对才是承重信号**

### 2.4 失败驱动是独立且有时更优的策略

| 系统 | 做法 | 数字 |
|---|---|---|
| **MetaClaw** | 整个技能库**只从失败建** | +32.2% 相对（弱 backbone）；技能集中在三类反复失败：时间格式、改前备份、命名约定 |
| **Ratchet** | **≥3 次同类失败**才诞生技能 | 失败簇触发 |
| **AgentHER** | 用 hindsight 重标注失败轨迹 | 比 success-only SFT **+7.1~11.7pp**，**2× 数据效率**，双 judge 一致把标签噪声 5.9%→2.3% |
| **AutoGuide** | 对比同任务高/低回报轨迹，**只在分歧的 timestep 提炼** | 外科手术式用失败，避免倾倒整条坏轨迹 |

### 2.5 失败派生物确实会伤害

- ExpeL 加反思 **−10.0pp**
- AWM 加失败 **−2.2pp**
- **Reflexion 自己的 Table 3**：最难的 50 道 HumanEval-Rust 上，*去掉测试生成但保留自反思* = **0.52 vs 基线 0.60**
- [Library Drift](https://arxiv.org/html/2605.19576)："技能从失败模式诞生但从不按结果验证。边缘或有害的技能每轮都在稀释检索池"
- [Self-Evolution Backfires](https://ar5iv.labs.arxiv.org/html/2608.05810)：跨轮污染源于失败"成为后续技能提炼的参考材料"
- SkillsBench 自生成条件：Codex+GPT-5.2 **−5.6pp**

### 2.6 实用结论（文献的，不是我的）

文献**不支持**"总是从两者都提炼"。它支持：

1. **对比配对**（同任务一成功一失败）—— ExpeL、AutoGuide。每 token 信号最强
2. **只用失败做行为护栏** —— MetaClaw、Ratchet 的 ≥3 失败簇。当产物是短指令时有效
3. **两者都用但 schema 分离** —— ReasoningBank 是唯一报告了干净正收益**并说出机制**的系统
4. **绝不**把失败派生的文本不加门控地拼进 success-only 管线 —— AWM −2.2 和 ExpeL −10.0 是警告

**对应**：我们的做法是第 4 条明令禁止的那种。#5 和 #6 不是"可以改进"，是"文献已经证明会变差"。

### 2.7 轨迹表示：全库最好的消融，和两个已确认的空白

> 源码级调研，完整报告：`reports/skill-extraction-addendum-trajectory-representation.md`

#### ⭐ AWM Table 8 —— 最好的观测表示消融

**Mind2Web cross-task，GPT-3.5：**

| 表示 | 元素准确率 | 步骤 SR | 任务 SR |
|---|---|---|---|
| 只用 NL 状态描述 | **39.0** | **34.6** | **2.8** |
| 只用过滤后的 HTML | 38.1 | 33.8 | 2.8 |
| **两者都给** | 37.1 | 32.9 | **2.0（更差）** |

原文："同时使用 NL 和过滤后的 HTML 会导致更差的结果……过滤后的 HTML 含有大量无关条目（**47% 的情况下完全漏掉正确元素**），因此可能与 NL 描述相矛盾。"

> **可执行结论：把观测总结成 NL，并且不要额外再附加 raw / 过滤后的 DOM。**

另外：AWM 在 WebArena 上的提炼提示词**只序列化 `<think>…</think><action>…</action>`——accessibility tree 根本到不了提炼器。**

#### 各系统的真实预算（修正了常见误传）

| 系统 | 源码级事实 |
|---|---|
| **ExpeL** | 喂给提炼的是**原始交织的 ReAct 文本串**，**不是 `(o,a,o',r)` 元组**（元组只是 Algorithm 1 的抽象记账）。**思考被保留**。默认 `truncate_strategy: null`。预算：`max_num_rules: 20`；**8 条成功**拼一次调用；对比配对严格 **1 成功 + 1 失败**。⭐ **唯一的硬截断在失败侧——>13000 token 丢掉恰好一条失败轨迹；成功侧不设上限**（失败更长更嘈杂） |
| **Voyager** | ⚠️ **不截断执行错误**（原样逐字拼接）——只有聊天日志被正则过滤。技能 = 代码 + **≤6 句单行**描述；检索嵌入**描述**但返回**代码**；**critic 拿状态快照，不是轨迹** |
| **Reflexion** | ⚠️ 上限是**计数窗口 3**，不是 token 预算；reflector 拿**原始 rollout**，提示词写着 **"Do not summarize your environment"**；**没有已发表的 1/3/5 消融** |

#### ⭐ 按结构做预算，不靠摘要（SWE-agent）

文件查看器 **≤100 行**；搜索 **≤50 条**（超限**什么都不显示**）；**最后 5 条观测逐字保留**，更早的压成一行占位符；除第一条错误外全部省略。

| 文件查看器窗口 | 解决率 |
|---|---|
| **100 行** | **18.0** |
| 30 行 | 14.3 |
| **整个文件** | **12.7** |

> **"读得更多严格地更差。"**

**[The Complexity Trap](https://arxiv.org/abs/2508.21433)**：观测遮蔽 **54.8% / $0.61** vs 原始 **53.4% / $1.29** —— **−52.7% 成本，+2.6% 解决率**。警告：**最优窗口是 agent-specific 的**；另有 **"Trajectory Elongation Effect"——摘要会让轨迹变长**。

**生产预算**：Claude Code `MEMORY.md` = 前 **200 行或 25 KB**；技能正文 **≤5,000 tok/技能、≤25,000 tok 总量、最老先丢**；工具输出 **>10,000 字符**卸载到文件。AWS AgentCore 的 episodic schema = situation/intent/assessment/justification/reflection，**按 intent 建索引**。**Cursor 根本不存在自动的轨迹→记忆抽取。**

**最明确的序列化契约**（[Skill-Evo4GUI](https://arxiv.org/abs/2609.04869)）：`{step, observed_state, action_taken, post_action_effect, notes}`，"**包含每一步，不做选择性省略**"，**禁止提炼器做判断**，**轨迹从不展示给技能作者**。4 个 OSWorld 域 +5.7–18.6pp，但记录了"**revision churn**"——**迭代压缩不是单调的**。

#### ⭐⭐ 两个已确认的文献空白——我们能填

不是"没找到"，是**被明确声明的空白**：

1. **没有任何受控实验在保持源经验不变的前提下只改变压缩程度。** 2026 年综述原文：*"A controlled experiment holding source experience constant while varying only compression level has not been conducted"*（[arXiv 2604.15877](https://arxiv.org/abs/2604.15877) §3.3）
2. **没有任何消融在同一个技能提炼系统内部隔离"先摘要再提炼" vs "直接喂原始给提炼器"。**

> **报告原话：我们的产品恰好拥有文献缺少的东西——来自同一任务分布的大量轨迹。所以我们可以保持源经验固定、只改变序列化。**
> **"That is a publishable experiment and a defensible internal benchmark."**

**为什么这条特别重要**：这个实验**不依赖飞轮修好**。它只需要同分布轨迹 + 两三种序列化 + 一个判分器。**而且它本身就是一次 Phase 1 级别的闭环验证。**

**我们已有的素材**：`phase4-memory-v1/frozen/refinement-r2/` 的 24 条源轨迹、LCB 池里 **131 道未用过的题**、现成的 `run-arms.py`。

**对应 #4**：我们的 `refine.py` 是"整段删掉观测只留 `name/success`"，AWM 是"给了 NL 又叠加 raw 反而更差"——**方向相反，但同一个教训：观测的表示方式是被测过的变量，不是审美选择。**

---

## 3. 门控：什么值得建，什么不值得

### 3.1 各系统的门

| 系统 | 准入门 | 去重/合并 | 正确性验证 |
|---|---|---|---|
| ExpeL | 重要度投票计数，**归零删除** | EDIT 就地改写 | 隐式——多轮提炼的共识 |
| Voyager | **自验证模块必须确认任务完成**才提交 | description embedding 去重 | 执行（程序无错）+ LLM 评审 |
| AWM | **神经评估器判定轨迹成功**才提炼 | 规则 + LM；按双空行分段 | 仅评估器判断 |
| ReasoningBank | LLM-as-judge 打成功/失败标签，**策略按标签不同** | **合并 = 简单追加**（刻意最小） | 仅 judge |
| **Ratchet** | **≥3 次同类失败簇**；**按结果淘汰**（`n(s) ≥ N_min=100` 且贡献 `ĉ(s) ≤ −τ`，τ=0.10）；**硬上限 C=50**；**元技能撰写先验** | 显式去重（测过，**发现不必要**） | 每技能贡献分 `ĉ(s) = (successes − failures)/trials` |
| **VaG** | **三个异构批判器全过**：`SchemaCritic` ∧ `ExecCritic`（单技能在 held-out 上的 A-B 重放）∧ `AgentCritic`（LLM 查虚构/矛盾/不安全建议）；再做**边际增益贪心子集选择** | Cold→Warm→Hot 信任分层 | **行为 A-B 重放是承重的那个** |
| CoEvoSkills | **共同进化的信息隔离 surrogate verifier** 生成测试断言和结构化失败诊断 | 最多 5 轮进化 | surrogate verifier，非 ground truth |
| AgentHER | **双 judge 一致**才接受 | — | 多 judge 验证 |

### 3.2 门的定价表（本次调研最有价值的一张）

[VaG 在 Terminal-Bench 2 上的消融](https://ar5iv.labs.arxiv.org/html/2608.05810)：

| 配置 | Pass@1 | 技能池 | Δ |
|---|---|---|---|
| VaG 完整 | **72%** | 37 | — |
| **− 行为 A/B 重放（holdout replay）** | **62%** | 45 | **−10pp** |
| − 联合增益门（marginal-gain） | 64% | 58 | −8pp |
| − 语义检查 | 68% | 40 | −4pp |
| **− schema 校验** | 70% | 37 | **−2pp** |

三条要害：

1. **行为重放是唯一值 10pp 的检查**，因为"**它是唯一一个经验性地检验行为的检查，而不是检验表面形式**"
2. **三个批判器互不可替代**——各自拦截基本不相交的有害技能类别
3. **去掉联合增益门，池子从 37 膨胀到 58，同时掉 8pp**——"单独无害但联合有害"的技能对逐项检查是隐形的

**其他门控的实测价值**：

| 系统 | 消融 | Δ |
|---|---|---|
| CoEvoSkills | 去掉 surrogate verifier | **−30.0pp**（71.1→41.1） |
| SkillWeaver | 去掉 "practice + verify" | **低于无技能库基线** |
| EvoSkill | Pareto 前沿选择 vs 贪心接受 | +7.3pp OfficeQA / +12.1pp SealQA |
| Trace2Skill | 流行度加权合并 | "**只有合并同时按 judge 分数过滤时才有效**" |

### 3.3 过度过滤也会伤害（我们最需要看的一条）

[Ratchet Table 1](https://arxiv.org/html/2605.19576)：

| 条件 | 基线 | 峰值 | 增益 | 路由命中率 | 活跃技能 |
|---|---|---|---|---|---|
| 默认（完整治理） | 0.258 | 0.658 | **+0.328** | 73% | 50 |
| A1 不注入 | 0.283 | 0.375 | **+0.002**（地板） | 0% | 42 |
| **A4 激进淘汰**（N_min 100→20, τ→0.0） | 0.300 | 0.433 | **−0.019**（低于地板） | 19% | **2** |
| A3 无元技能 | 0.200 | 0.592 | +0.187 | 80% | 50 |
| A5 无去重规范化 | 0.275 | 0.708 | +0.374 | 80% | 50 |
| A6 无覆盖保护 | 0.217 | 0.700 | +0.363 | 70% | 50 |
| A7 上限=100 | 0.292 | 0.650 | +0.317 | 75% | 100 |

- **在证据不足时做治理，比不做治理更糟。** A4 的 −0.019 **低于"完全没有技能库"的地板**，三个种子一致（−0.005、−0.027、−0.025）。原因：只有 20 次试验时 Hoeffding 偏差 ε≈0.44，**有用的技能会因为运气不好被淘汰**
- **显式去重是不必要的**（A5/A6 略**高于**默认）——有"元技能撰写先验"的前提下。如果要建昂贵的去重子系统，先投资**提取器的风格先验**
- **元技能先验是最有价值的单个组件**（去掉它损失默认增益的 43%）

**对应 #6**：我们的门槛（"≥2 条独立支持"）建立在 **22 成功 / 2 失败** 上。这是 A4 的同型错误——**在证据不足时做了治理**。

### 3.4 "N 条独立支持"文献怎么说

- **ExpeL**：没有 N 支持要求，但有**投票计数**，归零删除
- **Ratchet**：唯一显式的 N 支持阈值——**≥3 次同类失败**才诞生技能。但它自己的 A4 警告说证据地板太严会导致侵蚀
- **VaG**：每个联合效用估计做 **k=3** 次 held-out 重放；每轮 `|W| ≤ 15` 个候选以让贪心精确
- **AgentHER**：**多 judge 验证**（两个独立 judge 必须一致）——把管线精度从 94.1% 提到 97.7%，标签噪声 5.9%→2.3%。这是干净测过的"N 独立支持"类比
- **SkillGen**（2026）：按**净干预效应**选技能，同时计入修复的失败**和**引入的回归——最接近"带反事实对照的拒绝采样"

---

## 4. 已知的负面结果清单（完整版）

### 4.1 无门积累是非单调的

[When Self-Evolution Backfires](https://ar5iv.labs.arxiv.org/html/2608.05810)，Terminal-Bench 2 Event-50，5 轮，3 rollout/任务：

| 轮次 | 无门 Pass@1 | 池 | VaG Pass@1 | 池 |
|---|---|---|---|---|
| 种子（静态） | 46% | 3 | 46% | 3 |
| R1 | 48% | 35 | 52% | 5 |
| R2 | **60%** | 68 | 58% | 15 |
| R3 | **62%（峰值）** | 105 | 62% | 25 |
| R4 | 52% | 141 | 68% | 30 |
| R5 | **50%** | 179 | **72%** | 37 |
| + 事后回滚 | 52% | 171 | — | — |

- 无门版本 R5 只比自己 R1 高 **+2pp**，技能从 35 涨到 179
- **污染专门打击最难的任务**：无门版 Hard 层从 R2 的 53% 掉到 R5 的 **35%**；VaG 把 Hard 提到 **59%**（+24pp 边际）
- **门控打败 oracle 早停**：VaG 的 R5（72%）超过无门版本**最好的一轮**（62%）10pp，而且池子小 **~5×**
- Token 成本/试验：种子 0.35M，无门 1.07→1.30M，VaG 0.77→0.94M
- 三级污染分类：**个体**（单个技能降低成功率）、**组合**（各自无害、联合有害）、**系统**（倒 U 型）

**最刺痛的一条**：事后删掉 8 个有害源技能，**只恢复了 12pp 里的 2pp**。剩下 10pp 被"**派生技能血统**"锁死——因为技能是在**当时的技能池条件下**提炼的，坏的推理会传进后代技能。

> 原文："**仅回滚源技能只能挽回 17% 的退化。**"
> 结论：**准入是提交前的必需品，不是事后清理。**

### 4.2 Library drift —— 静默失效模式

[Library Drift](https://arxiv.org/html/2605.19576)（AWS + HSBC），MBPP+ hard-100，100 轮，Claude Opus 4.7，3 种子：

- **可操作定义**：`E[pass@1 | S_t] < E[p_0]` —— 技能库让 agent **比没有技能库更差**
- 三种子模式：**stagnation**（技能到不了求解器）、**bloat**（检索退化）、**erosion**（过度治理毁掉有用技能）
- **A1（不注入）：+0.002 ± 0.005** —— **造技能但不注入，字面意义上是零**
- **A2（只检索，无 LLM 门）：+0.077 ± 0.065，98% 路由命中率** —— 近乎最大注入 + 低质量门，只有默认的 ~1/4
- 健康条件维持 **70–80% 路由命中率**；漂移的 A4 掉到 **19%**

### 4.3 技能不泛化 / 负迁移

**[SkillFlow-Bench](https://arxiv.org/pdf/2604.17308v1)**（166 任务、20 族、终身协议、从空库开始）：

| 模型 | 变化 |
|---|---|
| Claude Opus 4.6 | 62.65 → 71.08（**+8.43**） |
| MiniMax M2.5 | +6.63 |
| Claude Sonnet 4.5 | +6.02 |
| GPT 5.4 | +3.62 |
| Claude Opus 4.5 | +2.41 |
| Kimi K2.5 | **+0.60**（技能使用率 **66.87%**） |
| **GPT 5.3 Codex** | **52.41 → 46.39（−6.02）** |
| Qwen-Coder-Next / Qwen3-Coder-480B / MiniMax M2.7 | 各 −0.60 |
| Claude Sonnet 4.6 | 不变（56.63%） |

- **"高技能使用率不等于高效用"**
- 失败机制："错误的早期技能会诱发**持续负迁移**，大幅降低后续表现"；弱模型受**认知过载**困扰
- **整合优于增殖**：更强的设置最终留下**更小**的技能库

**[SWE-Skills-Bench](https://arxiv.org/abs/2603.15401)**（49 个公开 SWE 技能 × ~565 实例，pytest 确定性验证）：

- **49 个技能里 39 个零收益**
- 平均 **+1.2%**（89.8→91.0），同时 token **+10.5%**
- token 开销从"少量节省"到 **+451%**，通过率不变
- 只有 **7 个专用技能**有明显增益（最多 +30%）；**3 个让性能下降**（最多 −10%），因为"版本不匹配的指导与项目上下文冲突"
- 生态背景：**136 天里创建了 84,192 个技能**

**[SkillsBench](https://ar5iv.labs.arxiv.org/html/2602.12670v1)**：

- 人工策展 **+16.2pp**，**自生成 −1.3pp**
- **16 / 84 个任务是负的**，例如 taxonomy-tree-merge **−39.3pp**、energy-ac-optimal-power-flow −14.3pp
- 域间 +4.5pp（SWE）到 +51.9pp（Healthcare）
- 自生成按模型：Opus 4.6 **+1.4** 到 Codex+GPT-5.2 **−5.6**

**其他**：

- Raw-Experience（2026，经[综述 §8](https://arxiv.org/html/2607.10113)）：模型生成的技能"平均有帮助但**可能负迁移**"，而且"**强提炼器未必是强消费者**"
- XSkill 的 Qwen 迁移警告：迁移可能提高 *Pass@4*（鼓励探索）同时**降低** *Average@4*
- **AutoGuide vs ExpeL 的实测污染**：ExpeL 每一步喂**全部** guideline，在同一个 WebArena 任务上"误关注第二条 guideline '确保指明物品编号和位置…'，导致错误推理和动作"。AutoGuide 的上下文条件化选择：WebArena-Reddit **47.1%** vs ExpeL 21.8% vs ReAct 8.0%

### 4.4 检索退化与"检索从不触发"

- **扁平检索崩塌**（文献中无反例）：16–32 技能 **96–98%**；64 → **92%**；128 → **78%**；**256 → 64%**。缓解手段（层级、图检索、全文重排）"把失效点向右推…但没有显示出普遍的消除"
- 注册表规模佐证：Wild-Skills 在 **34K 池**干扰下压测检索；SkillRouter 在 **80K 池**需要全文检索加重排；SRA 分解 **26,262 个技能**语料，发现"纳入"和"按需加载"仍是两个独立瓶颈
- **检索从不触发是可测的真实结局**：Ratchet A1 路由命中率 **0%**，增益 **+0.002**
- **维护是承重的**：AutoRefine 的 TravelPlanner 消融——去掉周期性剪枝与合并，最终通过率 **35.6% → 31.1%**，仓库膨胀 **4.5×**，**利用率 0.71 → 0.08**。SkillOps 去掉库时维护，ALFWorld 掉到 **71.9%** vs 完整系统 79.5%

### 4.5 饱和与 backbone 强度

- **MetaClaw 直接报告了 headroom 效应**："更强的模型获益更少，更弱的模型获益更多"。GPT-5.2 **+2.9pp**（41.1→44.0）vs Kimi-K2.5 **+6.9pp**（21.4→28.3）
- **SkillsBench 域间饱和**：SWE +4.5pp vs Healthcare +51.9pp，"预训练覆盖强的领域从外部程序性指导获益更少"
- **SkillFlow**：Claude Sonnet 4.6 "两种设置下都保持不变"
- 综述把"弱 backbone 相对增益更大"只评为 **grade C**（趋同证据，非受控），并提醒"罕见的专用技能可能反转这个模式"

**对应 #8**：这就是我们那四个 75–100% 饱和池子的辩护材料。

### 4.6 轨迹摘要本身可能有害

[State Design Matters](https://arxiv.org/html/2602.15858) 是"压缩轨迹会伤害"最干净的实测：用滚动 **≤25 token** 摘要替换完整历史，对多数中大型模型改善汉诺塔（Qwen2.5VL-7B 0.08→0.39；DeepSeek-R1-14B 0.46→0.70；Llama3.3-70B 0.66→1.00），但**让 Messenger 退化**（Qwen3-VL-32B-Instruct 0.09→**0.00**；Llama3.3-70B 0.28→0.22），也伤害了最小的模型（LLaVA-Phi3-3.8B 0.16→0.08）。

诊断原因：摘要"陈述泛泛的观察"，而不是保留**决策相关的上下文**（如相对距离、子目标进度）。

**对应 #4**：这正是我们 `refine.py` 问题的另一面——不是"摘要得不够好"，是"摘要丢了决策相关的细节"。

### 4.7 ⭐⭐ 反直觉的实测结果（本次调研最强的一批）

> 完整报告：`reports/skill-extraction-addendum-negative-results.md`
> **这一批里有几条直接改变我们的参数和话术。**

#### ① 看似合理**反**预测有用性——最可执行的一条

**From Raw Experience to Skill Consumption**（[2605.23899](https://arxiv.org/abs/2605.23899)，复旦 + MSR），**5 个域 × 6 个 target × 5 个 extractor**：

| 指标 | 结果 |
|---|---|
| 抽取出的条目里 **Δ<0** 的比例 | **25%**（ALFWorld **47%**） |
| **用"合理性 rubric"打分筛选** | **−0.59pp 平均，9 个格子里 6 个更差** |
| 用**经过验证的 rubric**筛选 | **+1.55pp** |
| "更好的执行者不一定是更好的提炼者" | Gemini-3.1-Flash-Lite 在 SpreadsheetBench 最好，而 **GPT-5.4 排最后** |

> **不要按"听起来好不好"来排名或门控洞察。**

**对我们的意义**：`refine.py` 的校验（"≥2 支持 / 40–400 字符引用 / ≥2 概念 token"）**就是一种合理性 rubric**；线 B 的人工复核也是。**这条说这类筛选用错了方向**——文献里它平均是负的。
（注意与 SkillsBench 的"人工策展 +16.2pp"**不矛盾**：那是有领域专长的人**写**技能；这里是给**抽取出的条目**打合理性分。）

#### ② 检索基本不触发，有时还不如没有

**How Well Do Agentic Skills Work in the Wild**（[2604.04323](https://arxiv.org/abs/2604.04323)），**34,198 个技能**：

| 场景 | 加载率 |
|---|---|
| 精心策划的技能**直接可用**时，Claude 轨迹全部加载的比例 | **49%** |
| 加入干扰项 | **31%** |
| **没有精心策划的技能时** | **16.3%** |

- **两个模型掉到自己"无技能基线"以下**：Kimi 19.8 vs 21.8；Qwen 19.7 vs 20.5
- 反例：**Kimi 加载率 86%，增益为零**
- **技能加载幻觉**：即使 BM25 top-50 里根本没有 gold 技能，模型仍以可观比例"加载"了技能；**Llama-8B 在它需要帮助时反而更不可能加载（−15.1pp）**
- 一个**预置好、连通、显式引导**的记忆库在 **114 轮里得到零次记忆调用**
- 厂商 issue：anthropics/skills#556 —— **144 条"应该触发"的查询，触发率 0/3**；claude-code#36570 被**以 `not planned` 关闭**

> **我们的 skill 臂投递率 10% 不是异常，是常态。** 而且"应该在需要时加载"这个假设在野外是被证伪的。

#### ③ ⭐ 检索峰值是 k=1

**ReasoningBank 自己的 retrieved-count 曲线**：

| 注入条数 | WebArena-Shopping |
|---|---|
| 0 条 | 39.0 |
| **1 条** | **49.7（峰值）** |
| 2 条 | 46.0 |
| 3 条 | 45.5 |
| 4 条 | 44.4 |

**k=1 之后严格变差。** 佐证：[Evo-Memory](https://arxiv.org/abs/2511.20857) 里 **Mem0 和 MemOS 在 4 个 backbone 中的 3 个上与"无记忆"完全相等**；AWM 在两个上**低于**基线（0.48 vs 0.54；0.44 vs 0.58）；Gemini 自己的 History 基线也低于它的无记忆。

> ⚠️ **我们用的是 `TOP_K = 2`**（`/tmp/lcb14b/run-arms.py:34`，且 `retrieval.py` 把上限写死为 2）。**按这条应该改成 1。**

#### ④ 记忆开着 → 准确率**降**、谄媚**升**

**MemSyco-Bench**（[2607.01071](https://arxiv.org/abs/2607.01071)），**Qwen3-8B**：

| 配置 | 准确率 | 谄媚度变化 |
|---|---|---|
| 无记忆 | 49.12 | — |
| **Mem0** | **35.67（−13.45）** | **+18.58** |
| **MemGPT** | **30.00（−19.12）** | **+33.24** |
| Mem0 + Contextual Scope Control | **13.34（−56.66）** | — |

佐证 TEPA（[2608.07429](https://arxiv.org/abs/2608.07429)）：**被污染的记忆 0.210 vs 无记忆 0.309**——陈旧冲突的记忆**低于完全没有记忆**。

> ⚠️ **我们用的正是 Qwen3 系列**（14B / 27B）。这条是在我们的模型族上测出来的。

#### ⑤ 自我反思被实测为净负，不只是"有风险"

**Huang et al. ICLR 2024**（[2310.01798](https://arxiv.org/abs/2310.01798)）：内在自我纠正在**每个**模型/benchmark 上都**降低**准确率——

| 模型 / 任务 | 变化 |
|---|---|
| GPT-3.5 CommonSenseQA | **75.8 → 38.1** |
| GPT-4 GSM8K | 95.5 → 89.0 |
| Llama-2-70b GSM8K | **62.0 → 36.5** |

给了 oracle 标签则全部改善——所以"**提升在没有 oracle 标签时就消失了**"。

**Sample More, Reflect Less**（[2607.28576](https://arxiv.org/abs/2607.28576)）在**匹配 token 成本**下：**"0 个显著优于 self-consistency，10 个显著更差，26 个无法区分。"**

**Reflexion 自己的论文**：MBPP **0.80 → 0.77（下降）**；starchat HumanEval 0.26 → 0.26；WebShop"未能显著超过 ReAct"。而且**在一个冻结集合的 121 条 ALFWorld 反思中，0 条提到了正确的目标物体。**

#### ⑥ 记忆真正失败在哪：**构建期**，不是回答期

**MINTEval**（[2605.18565](https://arxiv.org/abs/2605.18565)）：

| 失败阶段 | 占比 |
|---|---|
| **记忆构建失败** | **41.7%** |
| 回答阶段失败 | 25.2% |

而且**插入偏差 76.8%**——系统倾向于**新增**而不是更新/删除。

> 报告的评语：**"This is *your* layer."**
> 我们的 `refine.py` 正是**只增不改不删**（#6 无淘汰机制）。

#### ⑦ 短上下文任务**测不出**记忆

**Anatomy of Agentic Memory**（[2602.19320](https://arxiv.org/abs/2602.19320)）：一个 benchmark 只有在 **Δ = Score_MAG − Score_FullContext ≫ 0** 时才真正在评估记忆。

| benchmark | 上下文长度 | 风险 |
|---|---|---|
| HotpotQA | ~1k token | **高风险** |
| LoCoMo | ~20k token | 中等 |

**MemGym**：前沿模型在"记忆密集"设置上**仅凭预训练就得 0.70–0.85**。

**SWE-bench 的记忆捷径**：**只给 issue ticket，gold 文件定位率 65% vs 12%**——**没有任何存储上下文的 3–6 倍。**

> ⚠️ **我们的 LCB 套件中位 9,098 字符 ≈ 2.6k token——正落在"高风险"区。**
> 这可能是"测不出效果"的又一个结构性原因：**任务太短，记忆没有发挥空间**（和 #8 饱和是同一个病的两个面）。
> SWE-bench 上 100%/75% 的基线，也正好被"只给 ticket 就能定位 65%"解释了。

#### ⑧ 模型规模两头都咬

**EvolveR**：教师蒸馏的经验在 **0.5B 上有帮助（0.150→0.220），但在 3B 上反而有害（0.382→0.370）**。

> **"如果你在小模型上调，你会高估自己这一层的价值。"**

⚠️ **我们为了做能力阶梯实验，专门部署了更弱的模型层（14B）。** 这意味着 14B 上的结果**会高估**记忆/技能层的价值——解读时必须带上这个 caveat。

#### ⑨ 污染：危险的是"擦边"，不是"无关"

**Lost in the Middle**（[2307.03172](https://arxiv.org/abs/2307.03172)）：**内容完全相同**，只换顺序 → **75.8% → 53.8% → 63.2%（−22.0pp）**，最差情况低于闭卷。

**但不要声称"噪声总是有害"**——**Power of Noise**（[2401.14887](https://arxiv.org/abs/2401.14887)）：**无关**文档常常**有帮助**（填充上下文时 +35%），而**相关但不含答案**的文档把 Llama2 从 **0.5642 打到 0.2413**。

> **擦边的那一类才是危险的。**

配套：**Scaling Laws of Skills**（[2605.16508](https://arxiv.org/abs/2605.16508)）给出**技能相似度危险区 [0.55, 0.75)**，以及 `Acc(N) = a − b·ln N`，**跨 15 个前沿模型 R² > 0.97**。

#### ⑩ 技能冲突的反直觉结果

**Strategy Genes**（[2604.15097](https://arxiv.org/abs/2604.15097)），**4,590 次试验**：

| 组合 | 结果 |
|---|---|
| 两个**互补**的 Gene | **44.9%（低于无指导）** |
| 两个**冲突**的 Gene | 53.2% |

原文："**多个部分相关的控制对象可能争抢注意力……即使它们在名义上是兼容的。**"

#### ⑪ 厂商承认（此前报告误判为"没找到"）

| 厂商 | 原话 |
|---|---|
| **OpenAI** | 把 **memory** 列为已上线谄媚问题的成因之一（"user memory contributes to exacerbating the effects of sycophancy"），**回滚了 GPT-4o** |
| **Cognition** | "**当我们依赖模型自己写的笔记、而没有我们的压缩和摘要系统时，我们看到了性能退化。**" |
| **Vercel** | 砍掉 80% 工具 → **成功率 100% vs 80%**，token −37%，步数 −42%；而且他们向量管线的失效模式是"**静默的**" |
| **Anthropic** | "**context rot**"；上下文是"**一种边际收益递减的有限资源**"；"最常见的失效模式之一是**臃肿的工具集**"；CLAUDE.md 超过约 200 行后"**被静默丢弃……你会先丢失最新的规则**" |

> **这组承认的分量**：Vercel 的"砍掉 80% 工具反而 100% 成功"、Anthropic 的"臃肿工具集是最常见失效模式"、Cognition 的"依赖模型自己的笔记会退化"——**三个独立来源都指向"少即是多"，而且失效是静默的**。

### 4.8 本节的净建议（按优先级）

1. **按实测的干预效应门控，绝不按合理性**——合理性 rubric 平均是负的
2. **检索偏向 k=1**——我们的 `TOP_K=2` 应该改
3. **把"加载率"和"有用性"分开埋点，并假设检索不会触发，除非被强制**
4. **把"拒绝路径"当成与"生成路径"同等重要**
5. **绝不在短上下文任务上做基准**——LCB 的 2.6k token 落在高风险区

---

## 5. 评测协议：仪器确实是嫌疑对象

> 完整报告：`reports/measuring-skill-memory-transfer-report.md`（311 行）
> 附属简报：`reports/subagent-briefs/binary-vs-graded-agent-metrics-brief.md`、`reports/subagent-briefs/evaluator-validation-brief.md`

### 5.1 头条结论

2025–2026 的测量学论文反复发现**仪器本身失效**：坏测试、饱和套件、单次运行 2.2–6.0pp 噪声、重复的排行榜条目、未经校验的 judge。

> **所以"是 benchmark 选得不合适，还是别的原因"这个问题的答案是：两者都是，而且仪器问题是可量化的那一半。**

### 5.2 噪声底比我们声称的效应还大（这条直接解释我们的零结果）

[On Randomness in Agentic Evals](https://ar5iv.labs.arxiv.org/html/2602.07150)（KTH，**60,000 条轨迹**，3 模型 × 2 scaffold × 10 次运行，25.58B tokens，1.88M 次工具调用）：

| 发现 | 数字 |
|---|---|
| 单次运行 pass@1 波动 | **2.2–6.0pp** |
| 标准差（**Temperature 0**） | **>1.5pp** |
| temp-0 方差有时**更高** | Qwen3-32B 0.7% → 1.2% |
| 举例 | DeepSWE/nano 31.4%±1.0（28.8–32.4） |
| 轨迹分歧点 | 中位数 **token 5**（temp 1.0）/ token 56（temp 0） |

> 原文：**"2–3 pp 的改进可能只是评测噪声。"**

**我们的数字：`2 fixes / 0 breaks`，配对 n=21，p=0.5000。** 在 σ≈1.5pp 的噪声底上，这个量级**不可测量**。这不是"没有效应"，是"仪器分辨率不够"。

### 5.3 统计功率：我们差了一个数量级

| 要做的事 | 需要多少 |
|---|---|
| σ=1.5% 时检出 **2%** 效应 | **9 次运行**（80% power）/ **15 次**（95%） |
| 检出 **3%** 绝对效应（80% power, α=.05, ω²=1/9） | **n ≈ 969** 个独立问题 |
| n=198 固定时，把 K 从 1 提到 10 | 最小可检测效应从 13.2% 降到 **7.5%** |

公式：`n ≥ 2((Zα/2 + Zβ)/(Δ/σ))²`

**我们的做法：每个任务每个臂只跑 1 次，69 个任务。** 按上表，我们既没有足够的**运行次数**，也没有足够的**任务数**。

**部分运行也能用**（[arXiv 2607.12338](https://arxiv.org/abs/2607.12338)，KDD 2026 workshop）——要匹配完整 benchmark 的配对决策（0pp 严格阈值）：AppWorld 只需 **15%** 任务、τ-bench **25%**、**SWE-bench Verified 90%**、SWE-bench Lite 到 95% 都不收敛。

**小 N 不能用中心极限定理**（[arXiv 2503.01747](https://ar5iv.labs.arxiv.org/html/2503.01747)）：N=100 时 95% CLT 区间实际覆盖率只有 **92.5%**；**N=20 时区间会跑出 [0,1] 或直接塌缩**。该用 **Wilson 或 Beta-Bernoulli**。

> 我们的配对 n=21 —— 正好落在这个区间。

### 5.4 配对设计是形式化结果（这点我们做对了）

[Miller, arXiv 2411.00640](https://arxiv.org/html/2411.00640v1)：

- 配对标准误 `SE = sqrt(Var(s_A − s_B)/n)`
- **评分相关系数 r=0.5 时，配对把估计量方差相对降低 1/3**（1/6 → 1/9）
- 原文："**Use the paired version wherever practicable.**"

**跨任务设计把这部分白白扔掉。我们的配对是对的。**

但还有一个我们没做的：**聚类标准误**。当任务共享仓库/技能族时，朴素 SE 可能**小 3 倍以上**（DROP 实例 1.34 vs 0.44）。Miller 建议报告**配对差值、配对 SE 和评分相关系数**三者。

### 5.5 饱和是可以量化的（对应 #8）

**[Coding Agents Have Converged](https://arxiv.org/html/2609.17394v1)**（2026-09-15，审计 254 个公开 SWE-bench 提交，**不运行模型**）：

| 指标 | 数值 |
|---|---|
| Verified 上领先者各自解决 | 396/500 |
| 前十名**共享**的成功 | **285** |
| 前十名**共享**的失败 | **51** |
| ⇒ 真正有区分度的实例 | **只有 164 个** |
| `n_eff / n` | **0.33** |
| 精确配对 McNemar 能分开的相邻 top-30 对 | **0 / 29**（最小相邻 p=0.545） |

**[Growing Pains of Frontier Models](https://arxiv.org/html/2605.18840v1)**：top-5 SWE 差距压缩到 **1.3pp**，而 GPQA 保持 9.1pp；定义饱和比 `σ = spread(old)/spread(new)`，**σ<0.2 表示该轴已失去区分力**。

**SWE-bench Verified 的来历**：93 名专业开发者，随机抽 1,699 个实例，每个标 3 次，**68.3% 被过滤掉** → 500 个。GPT-4o 从 16% → 33.2%。

**但策展修复的是"欠规定"，不是泄漏**（[SWE-bench+](https://arxiv.org/html/2410.06992v1)）：手工筛查补丁后发现 **32.67% 的解法泄漏**、**31.08% 来自弱测试的可疑通过**；过滤后 resolve 从 12.47% 掉到 **3.97%**；**37/112 个通过 Verified 的实例（33.04%）在 issue 文本或评论里含有直接解法**。

**OpenAI 已于 2026 年 2–4 月弃用 SWE-bench Verified**：审计了 27.6% 的失败任务，**≥59.4% 的测试有缺陷，会拒绝功能正确的答案**；建议改用 SWE-bench Pro。*（OpenAI 原文对所有自动抓取返回 403，此条为二手报道 + ABA 独立佐证）*

**LiveCodeBench 的做法值得抄**：511 题、**带日期标记**、只评估 cutoff 之后的问题；难度分层 Easy 182 / Medium 206 / **Hard 123**；**显式剪掉混合难度的题**，因为平均"人为地最小化了模型间差异"。

**大家实际在用的手段**：策展子集（Verified/Lite）、无污染滚动切分（LiveCodeBench、SWE-rebench、SWE-bench Pro 的 12 个 held-out + 18 个专有仓库）、**baseline-first**（τ-bench 上一个"空响应"的平凡 agent 得 **38%**，**打败 GPT-4o**）、自动化审计（ABA：168 个 benchmark / 34,285 任务，**25.7% 有重大问题**；过滤后 Verified +9.9%、Terminal-Bench 2 +9.6%）。

> **τ-bench 那个空响应 agent 得 38%** —— 这条对我们有额外意义：我们的空响应失败占了 30–40% 的任务损失，而它居然是能拿分的。

### 5.6 仪器验证是**行业规范**，而且是硬门的（对应 #9）

这一节是我们最该看的。**我们没做的那件事，是有公开规范、有参考实现的。**

| 系统 | 门 |
|---|---|
| **SWE-bench** | 文档化了 gold-patch 校验（`swebench eval verified --gold`）；对 `None` patch / 空状态映射 **fail closed**；有一个针对"**从未启动的测试套件**"的显式护栏——**没有它，FAIL_ONLY 逻辑会把每个 F2P 测试都算作 resolved** |
| **Terminal-Bench** | "Solvability" = **oracle 通过所有测试** **AND** **no-op 假 agent 必须失败** |
| **Terminal-Bench-Science** | CONTRIBUTING：**oracle reward 必须 1.0，nop 必须恰好 0** |
| **Microsoft Vally** | 有专门的 `oracle` 动词，以及 `--no-golden-input` **负对照**，会标记"**平凡通过**"的判分器（exit 1） |
| **ABC 清单** | 条目 T.9 要求自动 oracle solver |

**而且这些规范是被真实事故逼出来的**：SWE-bench issue #26 "gold_patch cannot pass the test"；issue #393 发现 **42/61 个排行榜提交修改了评测测试文件**。

**反例**：τ-bench / AppWorld / OSWorld / WebArena / GAIA **都没有发布 golden-run 门**。

> **"从未启动的测试套件"这个护栏，几乎就是在描述我们的空响应失败**：如果套件根本没跑起来，一个写得不严的判分器会把失败静默地算成"通过"。我们观察到的 `passed=0/total=0` 正是这个形状。

### 5.7 判分器坏掉的量化

**LLM judge 的可靠性（JudgeBench）**：vanilla GPT-4o **50.86%** vs **50% 随机基线**；GPT-4o-mini **50.00%**；Claude-3-Haiku **33.14%**；**PandaLM 13.14%——低于随机**；o1-preview 75.43%。

**坏 judge 的检测信号**：

| 检测 | 数字 |
|---|---|
| 位置互换一致性 | GPT-4 **65.0%** / GPT-3.5 **46.2%** / Claude-v1 **23.8%** |
| 冗长攻击胜率 | 弱 judge **91.3%** vs GPT-4 **8.7%** |
| 自我识别 / 自我偏好 | 73.5%（τ=0.41 偏向自偏好），自我偏好偏差 **0.520** |
| 谄媚 | **86.0%** vs 56.5% 采纳率 |
| 同义改写导致判定翻转 | GPT-4o **8.5%** / gemini-2.5-flash **61.3%** |

**未校验 judge 的实际代价**：WebArena 用了未校验的 LLM judge，**高估 1.4–5.2%**。

**[Measurement Without Validity](https://arxiv.org/html/2608.00794)** 给出一个值得记住的不等式：**`V_total ≤ V1×V2×V3`**（三个环节各 70% ⇒ 总效度 **≤34%**）；在被调查的 55 篇 agentic-eval 论文里，**约 82% 使用了不匹配/不完整/缺失的评分者间信度**。

### 5.8 污染的量级与检测手段

| 数字 | 来源 |
|---|---|
| 成功补丁中 **32.67%** 解法泄漏 | SWE-bench+ |
| **31.08%** 通过来自弱测试 | SWE-bench+ |
| 测试不足：Lite **7.7%** / Verified **5.2%**；345 个错误补丁被误标 | UTBoost |
| 排行榜顺序变化 **40.9% / 24.4%** | UTBoost |
| 仅凭 issue 文本猜文件路径的准确率 **最高 76%**（Verified）vs 最高 53%（外部仓库） | SWE-Bench Illusion |
| DeepSeek-V3-0324：Verified **39.7%** vs 新任务 **21.3%** | SWE-rebench |

**检测机制（都有名字、可复用）**：LiveCodeBench 的时间窗/cutoff 过滤；SWE-rebench 的差分测试（对抗一个持续刷新的等价 benchmark）；SWE-Bench Illusion 的文件路径 ID 探针（带"过滤后准确率"对照 + 5-gram 函数复现准确率）；SWE-bench+ 的手工补丁 vs PR 筛查；ABA 的自动化审计（静态 + 轨迹两种模式）；以及收敛审计里的**证伪检验**（PR 年份 vs 解决率 `r=−0.069`，95% CI `[−0.148, +0.012]` ⇒ 无可检测的年龄效应）。

**train-only  disciplina 的三种具体形式**（不是同一个名字下的一个东西）：

1. **AFTER 的 train(evolution)/val/test 切分语义**——test 在每个 role+skill 单元格上都未见过
2. **SkillsBench 的 CI 泄漏审计**——禁止任务特定的文件名/路径/标识符、精确求解命令、来自任务规格的常量/魔数、测试用例/输出引用
3. **物理 held-out 数据**——SWE-bench 的不相交仓库、SWE-bench Pro 的 12 held-out + 18 专有仓库、SWE-rebench 的日期门控新任务

AFTER 还命名了失效模式：**"source-context overfitting"**——从狭窄经验演化出的技能**提升特异性同时降低泛化性**。

### 5.9 binary vs graded：**一个真正的开放问题**

> **没有**任何受控研究，用同一批 agent 轨迹同时按 binary 和 partial-credit 两种口径打分，并报告方差/功率/效应量。**这是本领域最大的空白。**

现有的、方向相反的证据：

**支持 graded（部分分）**：

- TDAG/ItineraryBench §5.4：binary 在低完成度任务上"**无法有效区分不同方法**"，细粒度评分把方法拉开到 42.85–49.08
- Parallel WebBench：完成率 50.7%→96.0%，而元素级 F1 只有 0.2489→0.4529
- AFTER **刻意同时报告** M1（通过测试的比例）和 M2（全部通过）
- **信噪比的最强证据来自选择题 benchmark，不是 agent**：连续指标的信噪比远高——HumanEval **6.79→124.08**、MMLU 52.45→347.57、COPA 38.63→662.41、Hellaswag 608.23→1921.15

**反对朴素 graded**：

- graded 评测器**可被路径攻击**：PartHackBench 平均 Δhack **0.252**；回滚检测 0/14（历史）vs 14/14（当前状态）
- rubric judge 可被 reward hack，而 gold judge 只掉 3 分（HealthBench-Hard）/ 22 分（ResearchQA）
- 评分量程本身会改变一致性，**0–5 最好**
- 假通过率（0.115 vs 0.173）被认为比一致性更贴近部署

**步级给分是有争议的**：Agent-as-a-Judge 和 AgentProcessBench（8,509 个标注步骤，89.1% 标注者间一致）支持它；但 [Credit Without Ground Truth](https://arxiv.org/html/2608.19760) 发现**没有任何步级信号能打败一个边际匹配的乱序对照**，而且 7 臂预注册实验里**没有任何一臂打败未训练策略**。

**对应 #10**：我们之前在"LCB 用 binary、SWE-bench 用 graded"上的取舍是**基于直觉的**。文献层面这仍是一个开放问题，但方向性证据更偏向"连续指标信噪比更高"，同时警告 graded 可能被攻击。**诚实的说法是：我们不知道，而且没人知道。**

### 5.10 报告给出的 10 项仪器检查（最实用的一节）

按对"零结果是否可信"的重要性排序：

1. **先测你的噪声底**：把 no-skill 臂跑 **5–10 次**；如果 delta < ~2σ，它**不可测量**（单次波动 2.2–6.0pp，temp 0 时 σ>1.5pp）
2. **σ=1.5% 时，2% 效应需要 9 次运行**（80% power）/ 15 次（95%）
3. **在同一批任务上配对**（r=0.5 时方差降 1/3），任务共享仓库/技能族时**用聚类 SE**（可能修正 3 倍以上）
4. **任务数低于几百时用 Wilson / Beta-Bernoulli 区间，不要用 CLT**（N=100 实际覆盖率 92.5%）
5. **在两臂之前先验判分器**：gold=1.0、no-op=0.0；**"如果判分器从没见过一个已知正确的补丁，零结果是不可解释的"**
6. **跑 headroom 检查**：验证两个刻意不同的条件在你的套件上能分开；SWE-bench Verified 的 top-30 在 n=500 下可以**0 个相邻可分**
7. **审计测试，不只审计 agent**（SWE-bench 有 5.2–7.7% 实例测试不足；31.08% 的通过补丁可疑）
8. **机器审计技能的泄漏**；在设计上**把技能质量和检索质量分开**
9. **测污染解释，而不是假设它**（用年龄效应回归那个模板）
10. **如果换了受校验的判分器、配对设计、足够运行次数和 headroom 之后零结果仍然持续，此时机制主张才成为可证伪的——在那之前它不是。**

> **最后一条是对我们两周实验的裁决：机制主张从来没有可证伪过。**

### 5.11 报告明确**没找到**的（不要当成已知）

1. **没有**任何受控研究用同一条轨迹同时按 binary 和 partial-credit 打分并报告方差/功率/效应量——**核心空白**
2. 没有方法论论文把 McNemar 命名为领域标准（它在用、有实现，且可从 Miller 的配对建议推出）
3. 没有一个统一命名的 "train-only" 纪律
4. **没有**任何会议/资助方强制要求评测器校验——**NeurIPS 论文清单里没有这一项**
5. 没有把 "verifier validation" 作为命名研究方法；没有 "AI Agent Benchmark Cookbook"；没有 SWE-bench Verified 的"通过率 vs 测试覆盖率"配对指标
6. **没有**证据表明 graded 指标会**压缩**信号（更低离散度/功率）并给出数字
7. OpenAI 原文对所有自动抓取 403（EN、de-DE、curl、urllib、Wayback 均超时）——相关声明均为二手 + ABA 独立佐证
8. SkillsBench 及多数 2026 年 arXiv 条目是**未经评审的预印本**；agentic skills 的 SoK（arXiv 2602.20867）自己就警告 SkillsBench 的发现需要独立复现


---

## 6. 生产架构：谁是真正的选择机制

> 完整报告：`reports/agent-memory-production-survey.md`（1003 行，140 KB，103 个引用 URL，每条结论附源码路径）

### 6.1 三层框架（比"选择 vs 堆积"更准）

> 完整报告：`reports/agent-memory-production-survey.md`（1003 行，103 个引用 URL）

之前我把它简化成"选择 vs 堆积"两类。**这个二分太粗**——中间那一层才是关键，**它是很多团队以为自己有门、其实没有的原因**：

| 层 | 定义 | 能不能说"不" |
|---|---|---|
| **Tier A — ACCUMULATE** | 没有任何东西被拒绝/降级/合并/矛盾消解。检索排序是唯一的过滤器，**且在接收之后才生效**。精确去重是身份去重，不是判断 | ❌ |
| **Tier B — ELIGIBILITY GATE** | 必须满足某些**环境条件**（空闲、迭代够多、无密钥、体积在预算内、会话类型对）。降低的是**量**和**风险** | ❌ **对内容没有任何意见——一个错但像样的事实和一个对的事实通过得一样容易** |
| **Tier C — QUALITY GATE** | 有东西评估**内容或其证据**，并且能说不 | ✅ |
| ├ C1 | 确定性分数 + 阈值（可审计，说不服不了它改主意） | |
| ├ C2 | LLM judge（灵活，继承模型失效模式，除非决策带证据落日志，否则不可审计） | |
| └ C3 | 证据记账 / 人工复核（从计数支持得出数值置信度，或 approve/decline 队列——**唯一能推翻先前决策的形式**） | |

**判定结果：**

| 层 | 系统 |
|---|---|
| **Tier C（真门）** | OpenClaw memory（C1+C2+C3-lite）、OpenClaw skills（C3 opt-in veto）、**Hermes Curator（C1+C2，但只管陈旧与重复）**、**Hermes self-evolution（最强——回归门 + holdout）**、Mem0 **v1**（C2）、Zep（C2）、Supermemory（C3 人工复核）、Hindsight（C3 数值） |
| **Tier B（只有资格）** | Hermes memory、Claude Code auto memory、Codex Memories |
| **Tier A（堆积）** | **Hermes 的后台审查本身**（而且它偏向写入）、**Mem0 v3**、Letta/MemGPT、Gemini CLI `save_memory`、Cline、AGENTS.md、Cursor rules、OpenHands、LangMem |
| Hybrid | Honcho——写入路径是 Tier A，Dreamer 按计划是 Tier C，所以错误事实会存活数小时 |

### 6.2 ⭐ 最有用的发现：生产里的门几乎从不判断"好不好"

> **Tier-C gates in production almost always act on EVIDENCE ABOUT USAGE OR CONTRADICTION, never on judgment about usefulness.**
> **Nobody has a reliable automatic answer to "is this lesson actually good?"**
> The principled systems sidestep it by gating on measurable **fitness proxies** — retrieval demand, recurrence, test suites, benchmark regression — not on quality per se.
> **If your team is asked to build a "quality gate", the honest framing is a *fitness* gate.**

**这条对我们是最重要的。** 它说的三件事：

1. **没有人能自动回答"这条经验好不好"。** 所以不要把它当成产品目标
2. **有原则的系统都绕开它，转而门控可测量的适应度代理**——检索需求、复现次数、测试套件、benchmark 回归
3. **诚实的说法是 "fitness gate"（适应度门），不是 "quality gate"（质量门）**

→ **我们的 `newly_fixed ≥ 1 ∧ newly_broken === 0` 正是 fitness gate**（benchmark 回归）。**这条给了我们项目的正确定位。**

### 6.3 生产里只存在四种选择范式

| # | 范式 | 信号 | 洞见 | 弱点 |
|---|---|---|---|---|
| 1 | **需求驱动的晋升**（OpenClaw） | 检索需求 | "一条没人检索的记忆，无论真假都不值得晋升" | 流行 ≠ 有用；一个真正重要但尚未被需要的事实无法晋升 |
| 2 | **遥测驱动的生命周期策展**（Hermes curator） | 使用次数随时间变化 + 从未使用的宽限地板 + fail-closed 护栏 + 审计账本 | 可审计 | **纯粹是陈旧度选择——一个错但流行的技能永远不会被质疑** |
| 3 | **写时 LLM 冲突消解**（Mem0 v1、Zep） | 矛盾 | **唯一直接攻击"矛盾"的范式**。三条经验：① 先把最近邻检索进判断上下文 ② **必须给 judge 一个显式的 NOOP 分支**，否则它会为了显得有产出而编造写入 ③ **优先 INVALIDATE 而非 DELETE**，这样时间查询仍然可答 | 不可审计；而且——**Mem0 v3 证明了——厂商在延迟压力下会悄悄砍掉整个机制** |
| 4 | **证据记账 / 人工复核**（Hindsight、Supermemory） | 计数支持 | **唯一让学到的条目拥有显式、可检视、随时间变化的质量状态的范式**——这正是存储可调试的原因 | 成本；低置信度条目仍然可检索 |

**注意：这四种里没有一种是"用行为适应度门控"。** 最接近的是 Hermes self-evolution（回归门 + holdout）和 OpenClaw 的 `skill_proposal_evaluate`。**所以我们的 paired A/B fitness gate 在这个谱系里是稀有的那一头。**

### 6.4 九条工程经验（我会立刻采纳的几条）

| 经验 | 具体 | 对我们 |
|---|---|---|
| **把 PRODUCER 和 SELECTOR 分成两个不同权限的组件** | Hermes 是最干净的案例：**一个急切的、无门的生产者** 配 **一个保守的、有门的、默认关闭的选择器**。Codex / Claude Code / Letta 把两个角色融在一起，结果**一个门都没有**。"如果只从这份调研里建一样东西，就把它们建成两个组件" | ⚠️ 我们的 `refine.py` 生成和校验**在同一个脚本里**——是融合的形态 |
| **让门 fail closed，并在代码里证明** | "**Prompt 不执行策略；拒绝才执行策略。**" Hermes 两个护栏都带着促使它诞生的 issue 号（#29912、#67140）——这个习惯值得抄 | ✅ 线 A 的 `adoption.ts` 有这个精神；❌ `refine.py` 没有 |
| ⭐ **预算不是判断** | "每个系统都有体积上限；**它们对正确性都没有帮助**。**不要让体积护栏在内部被汇报成质量门。**" | ❌ **这正是我们犯的错**——`refine.py` 的"≥2 支持 / 40–400 字符 / ≥2 概念 token"是体积与模式护栏，我们把它当质量门汇报了。文献侧同一条：VaG 的 `SchemaCritic` 只值 **−2pp** |
| **维护一张负面清单** | Hermes 的 DO-NOT-CAPTURE 清单：环境相关的失败、**对工具的负面断言**（"这些会硬化成 agent 引用数月、而问题早已修好的拒绝"）、已解决的瞬时错误、一次性叙述。**这是生产里最接近"以散文表达的拒绝策略"的东西，而且很便宜** | ❌ 我们没有 |
| ⭐ **绝不要从系统自己的输出里学习** | OpenClaw 在摄入前**剥离被召回的上下文**（"这样被召回的片段不会作为新记忆被再学一遍"）；Hermes 传 `skip_memory=True` 防止 harness prompt 泄漏进 Honcho/Mem0 | ❓ **要查**：我们 `refine.py` 的源轨迹里如果带过注入内容，就是一个自污染回路 |
| **记录拒绝，包括按类别计数的拒绝** | OpenClaw 的 deep 阶段明确这么做。"**一个说不清自己为什么拒绝的存储，没法调优**" | ❌ 我们的 `infra` 类失败被静默丢弃（**#3**） |
| **把人工确认做成"选择题"** | Hermes 的 `skills.write_approval`（默认 false）→ 暂存 `~/.hermes/pending/skills/` → `/skills pending\|diff\|approve\|reject`；memory 同构 | 呼应飞轮博客的"让人做选择题而非填空题" |
| **门要分层且有成本梯度** | Hermes self-evolution 的 `PLAN.md` 门梯：`pytest 100%`(GATE 1) → TBLite 快子集 20 题/~20 分钟(GATE 2) → 任务特定评估(适应度) → top 3 → TBLite 全量 100 题(GATE 3) → YC-Bench fast_test(GATE 4) → 最佳候选 → PR | ❌ 我们只有一层 |
| **区分"门"与"适应度函数"** | 原文：**"Benchmarks are GATES, not fitness functions. 一个把技能质量提升 20% 但让 TBLite 掉 5% 的变体是要被拒绝的。"** 且 "任何约束失败的变体都被丢弃——**GEPA/MIPROv2 永远看不到它们被当作成功**" | ⭐ 这个区分我们没做 |

### 6.5 重要更正：Mem0 已经变了

我上一条说"Mem0 有真正的逐事实选择（ADD/UPDATE/DELETE/NOOP）"——**那是论文，不是现在的代码。**

| | 论文（[2504.19413](https://arxiv.org/abs/2504.19413)，Algorithm 1） | 现在的 v3（`mem0/configs/prompts.py` on `main`） |
|---|---|---|
| 操作 | LLM 工具调用返回 ADD / UPDATE / DELETE / NOOP；UPDATE 仅当 `InformationContent(f) > InformationContent(m_i)`；DELETE 跑 `FindContradictedMemory`；**NOOP 是真实的拒绝分支** | `ADDITIVE_EXTRACTION_PROMPT` = **"Your sole operation is ADD…"**；写入路径 = batch embed → MD5 去重 → insert |
| 冲突 | 写时解决 | **移到检索时** |

文档的 memory-types 页面**仍然描述 ADD/UPDATE/DELETE**——已核实的自相矛盾，**视为过时**。

> 教训值得抄进我们的流程：**"Verify the current code path, not the paper."**
> 一个厂商在延迟压力下会悄悄砍掉整个机制。

### 6.6 Hermes 的补充细节（源码级）

- **两个循环，别混为一谈**：`agent/background_review.py` 是**生产者**（急切、无门）；`agent/curator.py` + `tools/skill_usage.py` + `tools/skill_ledger.py` 是**选择器**
- **触发是两个计数器，单位不同，默认都是 10**：memory 按**用户轮次**（`_turns_since_memory`）；skill 按**工具迭代**（`_iters_since_skill`）。所以技能审查**比文档说的频繁得多**
- **真实盲点**：`_delegate_depth > 0` **阻止自动审查** → **在子 agent 里做的工作永远不会被学习**，除非显式调用 `/refine`
- **生产者的提示词是"偏向写入"的**：`_SKILL_REVIEW_PROMPT` 原文 "**Be ACTIVE — most sessions produce at least one skill update... A pass that does nothing is a missed learning opportunity, not a neutral outcome**"
- **轨迹分离是一个布尔值的纯函数**：`save_trajectory(..., completed)` → `trajectory_samples.jsonl` 或 `failed_trajectories.jsonl`。**没有语义分类、没有排序、没有过滤**
- **`agent/error_classifier.py` 不是自进化组件**（我之前的猜测错了）——它只处理 API/传输层错误的 failover，不分类任务成功、不喂学习
- **离线轨迹压缩的确切默认值**：tokenizer `moonshotai/Kimi-K2-Thinking`；`target_max_tokens=15250`；`summary_target_tokens=750`；保护**每一类**（system/human/gpt/tool）的**首次出现**；`protect_last_n_turns=4`；摘要模型 `google/gemini-3-flash-preview`；temp 0.3
  - ⚠️ **注意**：这是**离线数据集工具**，不是运行时策略。运行时压缩是另一个大得多的子系统（`agent/conversation_compression.py`，~229 KB）。**不要把 15250/4 读成运行时行为**
- **issue #337**（2026-03-03 开，2026-05-16 关）：Imbue Darwinian Evolver + 5 个组件（种群 + sigmoid 适应度 × 新颖度、**失败驱动变异**、学习日志、变异后验证、25% 交叉）。它精确命名了缺口：**没有种群管理、没有技能适应度打分、没有变异循环、没有 A/B 测试**。它自己列的首要风险："**评估很难……坏评估 → 坏进化。这是关键的挑战。**" 最终落到 DSPy + GEPA，GEPA 用 "Actionable Side Information"（读轨迹学**为什么**），比 RL 高 6% 且**少 35 倍 rollout**


### 6.7 Hermes：选择存在，但在**技能生命周期**层，不在**记忆**层

除了博客里讲的"后台审查 Agent"（那个**确实是无门的**——LLM 自己决定然后写），Hermes 还有 `agent/curator.py`，一套完整的生命周期 + 审计系统：

**（1）确定性的、不用 LLM 的状态迁移**，基于使用遥测 `~/.hermes/skills/.usage.json`（`use_count` / `view_count` / `patch_count` / `last_activity`）：

```
active → stale → archived
```

默认值 `stale_after_days=14`、`archive_after_days=30`。（注意：文档里另一处写的是 30d/90d，**文档自相矛盾**；以配置默认值为准。）

**（2）可选加入的 LLM 合并 pass（默认关闭）**，其 prompt 是一个**真正的选择策略**，必须四选一：

- `KEEP` / `PATCH` / `CONSOLIDATE`（并入伞形技能）/ `ARCHIVE`
- 硬规则："**只有当一个技能已经是类级别伞形技能时，KEEP 才是合法的**"
- 每次删除**必须**给出 `absorbed_into=<伞形技能>` 转发目标
- 显式指令："**如果你最后归档的少于 10 个，说明你停得太早了**"

**（3）fail-closed 的代码护栏**（这几条最值得抄）：

| 护栏 | 拒绝条件 |
|---|---|
| `_curator_consolidation_delete_guard` | **拒绝**任何没有已验证吸收目标的归档 |
| `_background_review_read_before_write_guard` | **拒绝**写入，除非同一次审查回合已经通过 `skill_view` 读过那个确切文件 |
| `_background_review_write_guard` | **拒绝**任何非 curator 管理的技能（`created_by: "agent"`） |

**（4）append-only 变更账本** `~/.hermes/skills/.curator_ledger.jsonl`：每个文件的 `{path, sha256}` 前后清单、内容寻址的 blob、整树快照 + 单条目回滚。

> 它自己的一句话定位：**"The ledger is telemetry, never a gate."**
> 账本是遥测，**永远不是门**。

**关键区分**：Hermes 的选择在**技能生命周期**层。**记忆层没有判断门**——`MEMORY.md` / `USER.md` 只有预算门、精确重复拒绝、内容扫描，但**没有判断门**，负责审查的 LLM 自己决定。

### 6.8 OpenClaw：本次调研找到的**最强门**

（已直接对 `docs.openclaw.ai/concepts/dreaming` 核实，非二手）

一个 "dreaming" 定时扫描（cron `0 3 * * *`，light→REM→deep）：候选**必须同时**通过

- 确定性加权分数 ≥ `minScore`
- ≥ `minRecallCount`
- ≥ `minUniqueQueries`

权重表：`relevance .30 / frequency .24 / query diversity .15 / recency .15 / consolidation .10 / conceptual richness .06`

三条设计比分数本身更重要：

1. **结构性污染门**：来源标注为 `untrusted` 或 `system` 的候选，**在 prompt 构建之前就被结构性移除**——原文定位是"**a structural taint gate, not a score penalty**"
2. **接受改写必须保留**：先前条目丢失比例 ≤ `maxPriorEntryLossFraction: 0.25`；每个被提升的候选必须保留 `Source: path#Lx-Ly`；必须解析成结构化输出——**否则回退到 append-only**
3. **这是一条拒绝路径，不只是一个分数**

**对应我们的错误实践 #3**：这就是"可观测的、来自被测系统的隔离"的正确形态。我们做的是自我声明的常量；OpenClaw 做的是**在 prompt 构建前结构性移除**。同理，这也优于我们选 `auxiliary` 那种"整条链路跳过"的粗暴做法。

### 6.9 Mem0 的更正（原文保留作对照）

**我最早写的是**：Mem0 有真正的逐事实选择（ADD/UPDATE/DELETE/NOOP），`UPDATE` 仅当 `InformationContent(f) > InformationContent(m_i)`。

**这来自论文的 Algorithm 1，已经被证伪为当前行为**。现在的 v3 是 **ADD-only**。详见 §6.5。

**保留这条的原因**：它是一个**流程教训**——我读了论文就下结论，没有去读 `main` 分支的代码。最终报告的原话值得贴在墙上：

> **"Verify the current code path, not the paper."**

**对我们的意义**：这条直接适用于我们自己的项目。`wrong-practices.md` 2c 里那几个字段（`attempt_type`、`parent_id`、`candidate_hash`、`newly_fixed` 的层级）**也是我读代码得出的，不是猜的**——但流程上，任何"我读了文档所以它是这样"的结论，都应该用一次运行来证实。

### 6.10 ⭐ transfer 问题在 benchmark 上**接近未被测量**

架构调研的结论里有一句直接命中我们的项目定位：

> **The transfer question in benchmarks is separately near-unmeasured.**

翻译过来：**"一个在任务 A 上学到的记忆/skill，能不能帮到任务 B"——这个问题，现有的 benchmark 基本没测。**

这就是我们的位置。不是"我们再做一个记忆层"，而是：

| 已有 | 缺 |
|---|---|
| (a) 类系统会**门控**（OpenClaw / Mem0 / Hermes curator） | 但它们的门是**基于内部信号**（使用次数、信息量、加权分数） |
| 大量 benchmark 测**召回率/准确率** | 几乎没有测**迁移**（held-out gain） |
| 综述把 longitudinal evaluation、transfer、verification 列为四大未解难题 | 我们的 ①②③ 资产恰好对着这三个 |

**所以我们的项目不是"重复造轮子"，是补一个文献承认的空缺。** 前提是——把门（配对行为评测）真正接进选择链路，而不是自建一个平行记忆层。

#### 6.10.1 现有记忆 benchmark 测的是什么（最终报告核实了每一个 arXiv ID）

**召回和"更新/冲突"覆盖得很好；迁移几乎没人测。**

- **LongMemEval**（[2410.10813](https://arxiv.org/abs/2410.10813)，ICLR'25）——5 项能力 / 500 题：抽取、多会话推理、知识更新、时序推理、**弃答**。LLM judge 与人类一致率 >97%。长上下文 LLM 掉 30–60%。作者**2025-09 重新清洗了历史**"以防止对答案正确性的干扰"——等于默认承认了污染
- **LoCoMo**（[2402.17753](https://arxiv.org/abs/2402.17753)）——⚠️ **不可靠，不要用它给系统排名**：
  - 独立审计发现 **99/1540（6.4%）标注答案错误**（天花板 93.57%）
  - **62.81% 的"错但切题"的答案被 judge 接受**
  - 446 道对抗性问题（22.5%）实际未被评估
  - EverMemOS 自称 92.32% vs 第三方 **38.38%**
  - **Mem0 自己的 full-context 基线（72.9%）打败了它的两个变体（66.88 / 68.44）**
  - 另一个更正：LoCoMo 的 QA 指标是 **F1**，不是 BLEU/ROUGE；"J-score" 是 **Mem0 加的**，不是 LoCoMo 的
- **MemoryAgentBench**（[2507.05257](https://arxiv.org/abs/2507.05257)）——**核心方法论值得我们抄：把输入切块、增量喂入**，因为静态长上下文数据集"不直接适用于评估记忆 agent"。而且：**所有方法都在"冲突消解"上失败（多跳 ≤6%）**，弃答也差。第 4 项能力在 camera-ready 版从 "Conflict Resolution" 改名为 **"Selective Forgetting"**
- **真的测了迁移的（少数）**：[AWM](https://ar5iv.labs.arxiv.org/html/2409.07429)、[ExpeL](https://ar5iv.labs.arxiv.org/html/2308.10144)、**[Managing Procedural Memory in LLM Agents](https://arxiv.org/html/2606.23127)**（382 个企业任务 / 6 角色 / 22 技能，显式区分 local-improvement / cross-task / cross-role / cross-model，跨模型 73.1%）、**[AgentCL 2606.02461](https://arxiv.org/abs/2606.02461)**、**[2604.27003](https://arxiv.org/abs/2604.27003)**
- **[2604.27003](https://arxiv.org/abs/2604.27003)（ALFWorld/BabyAI）三条结论**：**抽象程序性记忆比详细轨迹迁移得更可靠**；**负迁移最伤难题**；**强正向迁移可以诱发严重遗忘**

> ⚠️ 注意这里和 §4 的"faithfulness"论文表面上有张力：那边说 agent 依赖 **raw** 而忽视 condensed；这边说**抽象**比详细轨迹迁移得更好。**它们测的不是同一件事**——一个是"agent 会不会用"，一个是"用了能不能迁移"。**两个都要读，不要只引一个。**

#### 6.10.2 benchmark 层面的三条硬事实

1. **COULD NOT VERIFY：Anthropic / OpenAI / Google 没有任何严格的公开记忆 benchmark。** 没有 primary harness、没有数据集、没有结果表。**所有厂商的记忆 benchmark 声明（包括 Supermemory 和 Hindsight 的）都应按未验证处理**
2. **LLM judge 的宽松度要预算**：LoCoMo 上测得 **~63% 宽松**
3. **GAIA / τ-bench / SWE-bench 都没有跨 episode 的迁移协议**

#### 6.10.3 harness 设计建议（直接可执行）

- **把正向迁移、保持（retention）、负向迁移当成三个独立的 delta 来instrument**——**它们会互相 trade off**，只看一个会误判
- **报告一个 memory-isolated 分数**（MemGym 的做法），**或者在完全相同的 held-out 任务上跑显式的 no-memory 消融**——否则你测的是你的 reader model
- **刻意构造可复用性**，否则迁移增益和噪声无法区分。AgentCL 的原话："**naive streams offer limited ability to distinguish memory designs, whereas controlled streams more clearly distinguish their plasticity**"
- **增量喂上下文**
- **从"没人及格的两项能力"入手**——冲突消解多跳（≤6%）和弃答。**"这是一个新设计仍然能显示出真实结果的地方"**

### 6.11 关于 Hermes 生态的更正（最终报告已确认）

网上那个 `o2alexanderfedin/hermes-agent-self-evolution` **不是社区扩展，是一个 fork**（GitHub API：`"fork": true`，上游 `NousResearch/hermes-agent-self-evolution`，5,366 stars，创建于 2026-03-09；该 fork 只有 2 stars）。

另外 `NousResearch/hermes-forge`（在 issue #337 评论里被称作 Phase-1 仓库）返回 404，而 self-evolution 仓库创建时间与那条评论**完全吻合**，所以几乎可以确定是重命名。**标记为未验证但可能性很高。**

（这条更正来自我在调研简报里引用错了来源，已修正。）

### 6.12 Who Maintains Agent Skills —— 落到线 B

**[Who Maintains Agent Skills?](https://arxiv.org/abs/2609.05677)**（873 提交 / 143 技能文件 / 254 次实质编辑，2025-10 ~ 2026-06）：

- **每一次实质编辑都经过具名人类账号**，62% 带 AI 共同作者标记，仓库间差异很大
- 编辑是真正的策展：多数改变技能内容，编码后的操作以**新增和修正**为主
- 一个**预注册的轴（rule-likeness）没通过信度门**——被如实报告为"从提交产物可靠编码 rule-likeness 仍是一个开放的测量问题"
- 结论原文："对自进化 agent 而言，公开的技能维护目前**更像是一个人类治理、AI 辅助的循环，而不是自主管线**"
- 它释放了语料、编码手册、挖掘脚本，以及**一个给自动技能策展器的回放协议**

**这条直接支持我们的线 B。** 加上 SkillsBench 的"人工策展 +16.2pp vs 自生成 −1.3pp"，两条独立证据指向同一个结论：**人在回路里不是过渡方案，它本身就是价值来源。**


---

## 7. 待验证前提的更新

`notes/wrong-practices.md` 第七节列的前提，调研后有变化：

| # | 前提 | 状态 |
|---|---|---|
| 1 | 基于 space 的隔离是否等价于 auxiliary？ | **已答**：`/hermes/<spaceId>` 或任意 `/{agent}/{spaceId}/` 是原生作用域隔离，**且不跳过注入**。见 §0 |
| 2 | 原生对话驱动提炼能否批量接收历史轨迹？ | 未答，属"提炼"环节，**不阻断第一次闭环** |
| 3 | `evaluation-skill-override` 是否只支持 skill 不支持 memory？ | 未答，同上 |
| 4 | 线 C 轨迹能否喂进 `extractL1Memories`？ | **已澄清为非阻断点**。见 `notes/wrong-practices.md` 七 |
| 5 | 空响应失败（30–40% 任务损失） | 未修，**必须先修**，否则任何结论都不可信 |

---

## 附：本次调研的方法说明

- 每条实质结论都带主源链接（原文/源码/论文），二手评论单独标注
- 报告末尾有 **"What I could NOT find"** 一节，列了 7 个没找到证据的点，**没有猜**
- **重要的跨论文警告**：不同论文的 backbone、harness、上下文预算、评估器、任务流全都在变，**跨论文数字不是可比的效应量**。把**同一论文内部**的消融当强证据，跨论文的差值只当方向性
- `Dynamic Agent Skills` 综述自己也这么说，并据此给证据分了级
