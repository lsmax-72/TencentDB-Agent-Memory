# 错误实践记录

> 记录时间：2026-09-18
> 记录范围：Agent memory / skill（RSI）机制验证项目中已经发生、且已经确认是错误的做法
> 记录目的：不是复盘情绪，是留下可核对的证据链，避免同一个错误再犯第二次

**配套文档**

| 文档 | 内容 |
|---|---|
| `docs/flywheel-gap-analysis.md`（已入库） | ⭐ **先看这份**。以飞轮方法论为框架，四齿 × 四条数据通路 × 我们的缺口 |
| `docs/related-work.md`（已入库） | 相关工作调研。别人怎么做的，以及**文献对我们每条错误实践的直接判定** |
| `docs/reading-list.md`（已入库） | 阅读清单。飞轮方法论 + Hermes 解析 + 论文索引，每条标注对应哪个错误实践 |
| `reports/`（仅本地，未入库） | 三个调研 agent 的原始报告（13 份，含主源链接和"我没找到证据的部分"）。已在 `.gitignore` 中，需要时在本机看 |

**一句话版本**（详见 `docs/flywheel-gap-analysis.md`）：

> 不是 benchmark 选得不合适，也不是机制无效。
> **是我们的飞轮缺了"落地→生效"这个齿，所以无论跑多少实验，结论都停在抽屉里。**
> 而且我们在缺一个齿的情况下，还在给另一个齿加功率。

---

## 摘要

这个项目两周多没有正面结果，主因**不是** benchmark 选得不合适，**也不是**"记忆/技能机制本身无效"。

主因是我们的实现路线走偏了：**我们本该复用原生记忆能力、只加上"选择"这一层，结果沿着一条错误的分叉，重新实现了一整套记忆层，并且把自己实现的记忆层当成了被测对象。**

这个分叉的**根因是一个具体的技术选择**：把实验流量标成了 `auxiliary`。而 `auxiliary` 这条路径在原生代码里**设计上就会跳过注入**。跳过注入 → 被测臂拿不到任何记忆 → 为了让实验能跑，自己写注入就成了"必须"，而不是"选择"。

一旦自己写了注入，后面所有事情都会跟着自己写：自己检索、自己提炼、自己存储、自己度量。整套平行栈就是这样长出来的。

**最讽刺的一条结论**（2026-09-18 追加）：我们两周测出来的评测数字，**恰好就是原生 adoption 门唯一认的那个数字**（`newly_fixed ≥ 1 ∧ newly_broken === 0`）。门是现成的、测试是现成的、我们的数字也是对的——只是我们把证据 post 进了一个只写不读的抽屉，`promotion_allowed: false` 还是我们自己写上去的。所以修法不是重写，**第一步只是补三个字段**（详见第二节 2c 与第八节）。

下面按层次拆开记录。

---

## 一、根因：隔离模式选错，导致注入被跳过

### 错在哪

原生代码里有两套"实验隔离"机制：

| 机制 | 位置 | 行为 |
|---|---|---|
| **A. 评测隔离策略**（正确） | `MemoryProxy/src/injection/evaluation-context.ts` | 显式声明 `read_only_skill` / `memory_write: DISABLED` / `automatic_skill_extraction: DISABLED`；只放行 `evaluation-skill-override` 这一个注入器；通过 `EvaluationSkillSessionRegistry.bind(sessionId, artifact)` 绑定只读资产 |
| **B. `auxiliary` 路径**（我们选的） | `MemoryProxy/src/agent-adapters/dsh.ts:126` | 请求头带 `x-deepseek-harness-compact: 1` 即判定为 `auxiliary`，`handler.ts:703-705` 直接 `skip session-init/mem/injection/L0/skill` |

我们为了让 benchmark 流量不被真实记忆污染，把请求伪装成了 dsh 的上下文压缩请求（带 `x-deepseek-harness-compact: 1`）。

**结果是：隔离生效了，但注入也一起被跳过了。** 走 auxiliary 路径的请求，原生记忆层从头到尾不参与。于是"用原生能力"这件事在物理上就不可能了。

### 证据

- `MemoryProxy/src/injection/evaluation-context.ts` — `isEvaluationContext()` 要求四个条件同时成立；`shouldSuppressHookInEvaluation()` 对除 `evaluation-skill-override` 外的**所有** hook 返回 `true`
- `MemoryProxy/src/agent-adapters/dsh.ts:126` — `if (headers?.["x-deepseek-harness-compact"] === "1") return "auxiliary";`
- `MemoryProxy/src/handler.ts:703-705` — 日志明写 `→ auxiliary (skip session-init/mem/injection/L0/skill)`
- `EvaluationSkillSessionRegistry` 在本项目**从未被调用过**——原生留好的正确入口，我们一次都没用

### 后果（这是关键）

这个选择不是"少用了一个功能"，而是**改变了整个项目的性质**：

> 不选 A 就必须自己注入 → 自己注入就必须自己有资产 → 自己有资产就必须自己检索、自己存储 → 自己度量。

后面 5 条错误实践，全部是这一条的**下游**。修这一条，后面大部分会自然消解。

---

## 二、架构层面：把"选择层"做成了"平行栈"

### 错误实践 1：重新实现了记忆层，而不是复用

原生的能力分工是清楚的：

```
L0 对话 → L1 原子记忆 → L2 场景 → L3 画像
         ↓
     混合检索（keyword + embedding）：atomic/search、conversation/search
         ↓
     技能记忆：创建 / 版本 / 资源 / 检索 / 路由 / 对话驱动提炼
         ↓
     POST /v3/skill/extract、POST /v3/skill/conversation/add
```

我们实现了一整套**平行的**：

| 原生能力 | 我们的替代品 | 文件 |
|---|---|---|
| `POST /v3/skill/conversation/add`（核心自己决定归档+提炼时机） | `refine.py` 里的 `MEMORY_SYSTEM` / `SKILL_SYSTEM` 提示词 + LLM 直接产出 | `scripts/evoagentbench/refine.py` |
| 混合检索（keyword + embedding） | `lexical-idf-v1` / `lexical-idf-applicability-v6` / `forced-injection-v1` | `scripts/evoagentbench/retrieval.py` |
| 原生注入管线（`SkillInjector`、`tdai-l1-recall`、`tdai-profile-memory` 等） | 把注入文本**拼进 `--message` 参数** | `scripts/evoagentbench/nanobot_cli_compat.py` |
| `CandidateArtifact` + `SkillCore`（带 hash、版本、操作类型、来源） | 本地 `frozen/*.json` | `phase4-memory-v1/frozen/refinement-r2/` |

**为什么这是错的**：源项目的记忆很强，我们做的任何替代品只会更弱。我们在"记忆质量"这个维度上跟源项目竞争，是必输的；而我们真正该做的"选择"这一层，反而没做。

### 错误实践 2：正确的集成点已经存在，却把它接成了一个只写不读的池子

这一条有三个层次，从"写在哪个文件里"一直深到"证据到底进不进得去选择链路"。

#### 2a. 实现体写在了项目外的 Python 里

原项目是纯 TS 的（`src/` 下一个 Python 文件都没有）：

| 包 | TS 文件 | TS 行数 |
|---|---|---|
| MemoryCore | 360 | 98,021 |
| MemoryProxy | 180 | 46,915 |
| MemoryKnowledge | 63 | 11,782 |
| MemoryPanel | 49 | 7,529 |
| **合计** | **652** | **~164,000** |

原有的 9 个 Python 全在 `hermes-plugin/`（一个 Python 插件）和几个一次性脚本里，不在任何 `src/` 下。

而 Codex 产出的代码是**两种语言接近 1:1**：

```
TS     11,858 行
PY     10,772 行
JSON    4,377 行
MD      3,021 行
```

落点却完全错开：

| | 语言 | 位置 | 规模 | 性质 |
|---|---|---|---|---|
| 线 A | **TS** | `MemoryCore/src/evolution/` | 79 文件 / 8,210 行 | 项目内部，正常架构 |
| 线 C | **Python** | `scripts/evoagentbench/` | 63 文件 / 13,193 行 | 项目外面，自成一套 |

**不是"先写 TS 后写 Python"，是同一次提交里两种都写。** `4585c5f`（2026-09-09，`feat(evolution): add pinned EvoAgentBench adapter`）一次提交动了：

- **8 个 `.py`** — `adapter.py`(284) `driver.py`(347) `protocol.py`(142) `proxy_bridge.py`(141) `report.py`(125) `metrics.py`(93) `test_protocol.py`(123) `__init__.py`
- **3 个 `.ts`** — `evolution/control/service.ts`(+50)、`benchmark-ingest.test.ts`(+46)、`panel/http/routes/evolution.ts`
- **1 个 `.tsx`** — `EvolutionPage/EvaluationEvidence.tsx`

也就是说：Codex **清楚地知道**正确的挂接点在 TS 侧（它确实改了 `service.ts`、加了 UI 路由、写了测试），但它把**实现体全部写成了 Python**。TS 侧只留了一个 50 行的接收口。

#### 2b. 那个接收口是只写不读的

`MemoryCore/src/evolution/control/service.ts:319` 的注释是 Codex 自己写的：

```ts
// Benchmark evidence is research-only. It is not an adoption proof and never dispatches diagnosis.
```

payload 里也自己打了标签：

```ts
research_only: true, promotion_allowed: false, test_traces_candidate_eligible: false,
```

核实结果：**全仓库唯一读这个记录的地方是 UI**（`MemoryPanel/web/src/pages/EvolutionPage/EvaluationEvidence.tsx:17`，只是把它渲染出来给人看）。选择链路一次都没碰过它。

#### 2c. 门是现成的，只是接线错了

原生真正的评测证据（`MemoryCore/src/evolution/control/skill-evaluation-executor.ts:102-114`）长这样：

```ts
payload: {
  attempt_type: "skill_effect_evaluation",      // 我们的是 "benchmark_transfer_evaluation"
  candidate_hash: candidate.artifact_hash,       // 我们的是 null
  parent_id: candidate.id,                       // 我们没写 parent_id
  gate_result, newly_fixed, newly_broken, ...
}
```

而 `MemoryCore/src/evolution/control/adoption-proof.ts:16` 认的门是：

```ts
["paired_evaluation", "skill_effect_evaluation"].includes(String(type))
  && record.status === "PASS" && gate === "PASS"
  && Number(record.payload.newly_fixed) >= 1 && Number(record.payload.newly_broken) === 0
```

**`newly_fixed` / `newly_broken` 正是我们两周测出来的那个数字，也正是原生 adoption 门唯一认的数字。** 我们甚至实测出 `2 fixes / 0 breaks`——按这个门它是 **PASS**。

但我们的接入方式（`benchmark_transfer_evaluation` + 缺 `parent_id` + `candidate_hash: null`）让它三重失配：

1. `adoptionProof` 的 `children()` 过滤条件是 `payload.candidate_hash === candidate.artifact_hash` → `null` 直接匹配不上
2. `attempt_type` 不在白名单 `["paired_evaluation", "skill_effect_evaluation"]` 里
3. 即使前两条过了，数字是嵌在 `comparison_summary.skill.counts` 里的，不在顶层 `payload.newly_fixed`

> **形状全对了，接法全错了。**

#### 2d. 线 A 当时已经准备好了正确的接口

线 A（`MemoryCore/src/evolution/`，2026-08-30，25 个提交）里**已经存在**为这件事准备好的接口：

```ts
// MemoryCore/src/evolution/control/skill-evaluation-executor.ts
interface SkillEvaluationBinding {
  id: string;
  fingerprint: string;
  execute(candidate, job, profile): Promise<EvaluationAttempt>;
}
type ResolveSkillEvaluation = (profile) => SkillEvaluationBinding | null;
```

线 A 还**已经在复用原生提炼器**：

- `control/memory-proposals.ts` 引入 `extractL1Memories`（来自 `core/record/l1-extractor.js`）
- 同文件引入 `SceneExtractor`（来自 `core/scene/scene-extractor.js`）

也就是说：**正确的路线当时已经写好了。** 线 C（`scripts/evoagentbench/`，2026-09-09/10）本该是实现一个 `SkillEvaluationBinding`，结果长成了一整套并行栈。

配置里 `suite_kind` 目前被写死成 `z.literal("AC_REGRESSION_V1")`——我们真正该做的是**扩展这个枚举**，而不是在它旁边另起一个项目。

**正确的形态**应该是：

```
线 C 降级为一个 SkillEvaluationBinding，注册进线 A
  suite_kind 从 AC_REGRESSION_V1 扩展出 benchmark 类
  每个 benchmark 的 driver 保持很薄：加载任务 / 准备环境 / 判分
  提炼、检索、注入、存储 → 全部走原生
  线 A 的选择逻辑（proposals → runner → gate → adoption）→ 复用
```

**好消息：修法是接线，不是重写。** 见第八节的接线图。

### 错误实践 3：隔离证据是"自我声明"，不是"观测确认"

`scripts/evoagentbench/proxy_bridge.py` 在自己的请求事件里**硬编码**了一句：

```python
"isolation_mode": "evaluation_auxiliary"
```

这是我们的**声明**，不是从 Proxy 响应里**观测**到的确认。（事实上因为 Proxy 确实认那个 header，结论是对的；但证据链有缺口——如果哪天 header 语义变了，这个字段不会变，我们会带着错误的信心继续跑。）

另一个例子：`refine.py` 依赖的 `_experience_runs` 只接受 `status in {"TASK_PASS", "TASK_FAIL"}`，但 `infra` 类失败被静默丢弃后，我们自己并不知道丢了哪些、丢了多少。

**原则**：实验隔离的每一个断言，都应该有一个来自被测系统的、可失败的观测点，而不是由我们这边写常量。

---

## 三、资产生产层面：轨迹被严重浪费

### 错误实践 4：喂给提炼的轨迹被砍掉了关键字段

`evidence.json` 里**存着**完整信息：`tool_events` 含 `arguments`、`result`、`failure_class`、`failure_reason`。

但 `refine.py` 在构造提示词时：

```python
tool_events = [{"name": ..., "success": ...}]      # 只保留两个字段
task_prompt = task_prompt[:24_000]                 # 截断
final_output = final_output[:12_000]               # 截断
```

丢掉的恰恰是最有学习价值的部分：

- **`arguments`** — 模型实际怎么调用工具、参数错在哪
- **`result`** — 环境返回了什么（报错信息就在这里）
- **`failure_class` / `failure_reason`** — 我们**自己已经算出来的**失败归因，一次都没传进提炼

结果：提炼器看到的是一串"某工具成功了/失败了"，看不到**为什么**。它只能生产泛泛而谈的经验，生产不出可操作的知识。

### 错误实践 5：成功和失败用同一套提示词，不做区分

`MEMORY_SYSTEM` / `SKILL_SYSTEM` 对成功轨迹和失败轨迹用**同一个模板**，仅在提示词里加了一句"诚实地描述失败"之类的软约束。

问题在于：

- 成功轨迹该提炼的是"**为什么这样能work**"——可复用的策略、关键决策点
- 失败轨迹该提炼的是"**为什么不行、下次怎么避开**"——反模式、边界条件、坑

这两者的**输出结构应该不一样**。我们的 schema 里没有为"失败教训"留专门字段，导致失败轨迹即使被喂进去，也只能被压成一句模糊的警告。

### 错误实践 6：经验池被自己饿死

具体数字：`phase4-memory-v1/frozen/refinement-r2/` 的源轨迹是 **22 PASS / 2 FAIL**，共 24 条。

而 `refine.py` 的技能合成要求：

- **≥2 条**独立支持的记忆
- 40–400 字符的**逐字**依据引用
- **≥2 个**共享概念 token

在 22 条几乎全成功的轨迹里找"反复出现的问题模式"——找不出。最终只产出 **1 个技能**（`skill-r3-01` "Brute-Force Pair Enumeration for Small Constraints"）。

同时 `skill` 臂的投递率只有 **2/20 = 10%**，因为 applicability 校验 `lexical-idf-applicability-v6` 拦掉了（`CONSTRAINT_NOT_OBSERVED:n`）。

**这是一个循环论证的陷阱**：用一个高通过率（87%+）的模型跑一个已经饱和的任务集，拿到的"经验"自然是"顺利完成任务"，提炼不出技能，然后我们得出"技能机制没用"。

**根因不是机制，是我们产出的资产天生贫瘠。** 而且我们只把最早的 2 条失败当经验输入，后面**几百条**失败轨迹一次都没回流。

---

## 四、实验方法层面

### 错误实践 7：反复欠功率的实验，却把零结果当结论

反复跑 n≈20–24 的实验，在 14% MDE 下得到"不显著"，然后在下一轮对话里把它当成"机制无效"的证据。

这是**把"我没测出来"当成"它不存在"**。在 n=21 配对、2 次翻正 0 次翻负的场景下，p = 0.5000 是**完全无信息**的结果，不是阴性结果。

预注册的判据其实已经写清楚了（≥6 次单方向翻转 ⇒ p ≈ 0.031），但每轮都在**换仪器**，而不是**把已有仪器加功率**。换仪器带来的方差，把本就稀缺的样本又稀释了一遍。

**调研后的量化（2026-09-18 补充）**——我们现在能算出当初该跑多少：

| 事实 | 数字 | 来源 |
|---|---|---|
| 单次运行 pass@1 波动 | **2.2–6.0pp** | [On Randomness in Agentic Evals](https://ar5iv.labs.arxiv.org/html/2602.07150)，60,000 条轨迹 |
| 标准差（**Temperature 0**） | **>1.5pp** | 同上 |
| 原文结论 | **"2–3 pp 的改进可能只是评测噪声"** | 同上 |
| σ=1.5% 检出 **2%** 效应 | **9 次运行**（80% power）/ **15 次**（95%） | 同上 |
| 检出 **3%** 绝对效应（80% power） | **n ≈ 969** 个独立问题 | [Miller 2024](https://arxiv.org/html/2411.00640v1) |
| N=100 时 95% CLT 区间实际覆盖率 | 只有 **92.5%**；**N=20 时区间跑出 [0,1] 或塌缩** | [arXiv 2503.01747](https://ar5iv.labs.arxiv.org/html/2503.01747) |

我们的 `2 fixes / 0 breaks`（配对 n=21）**落在噪声底以下**，而配对 n=21 恰好是"CLT 失效"的区间。

**我们做对的一件事**：用了**配对**设计。这是形式化结果——配对 SE `= sqrt(Var(s_A−s_B)/n)`，r=0.5 时**方差降低 1/3**，原文"**Use the paired version wherever practicable**"。但即使配对做对了，运行次数和任务数都差一个数量级。

**差的两件事**：

1. **每个任务每个臂只跑 1 次**——需要 9–15 次
2. **没有聚类标准误**——任务共享仓库/技能族时，朴素 SE 可能**小 3 倍以上**（DROP 实例 1.34 vs 0.44）

> **裁决**：换了受校验的判分器、配对设计、足够运行次数和 headroom 之后如果零结果仍持续，机制主张才成为**可证伪的**。
> **在那之前它不是。我们两周测出来的东西，从来没有可证伪过。**

### 错误实践 8：把任务池饱和误读成机制无效

四个任务池的实测基线（qwen3.8-27b）：

| 池 | 表现 | 结论 |
|---|---|---|
| 自有 code 域 | 87% | 饱和 |
| LiveCodeBench 24 题套件 | 75% binary / 0.874 graded | 接近饱和 |
| SWE-bench official train | 100%（下界 72%） | 饱和 |
| SWE-bench hard tier | ≈75% | 接近饱和 |
| **LCB hard tier（10 题探针）** | **20% binary / 0.746 graded** | **唯一有余量** |

只有 LCB hard tier 有 headroom。在 75–100% 饱和的池子上，机制即使有效也**表现为零**——因为没有空间让改进显现。

我们把"池子没有余量"读成了"机制无效"，重复了很多次。

### 错误实践 9：没有先验证仪器就下结论

两个 benchmark 的判分器都有严重缺陷，而且**都是在我们已经据此下过结论之后**才发现的：

**ContinualSkillBench**（详见 `docs/continualskillbench-instrument-audit.md`）：

1. judge 只被注入到 `*_seq` 类 agent → 其余 agent 的 reward **恒为 0**
2. office 域数值容差最大到 **1e6**（等于不判分）
3. judge 用朴素的 `_norm` 字符串比较 → 它实际在测 **LaTeX 还原度**，不是数学正确性
4. feedback turn 用的是 `idx` 而不是 `judge_task_id`，路径对不上
5. `math_equiv.py` 里 `sympify(transformations=)` 是**死代码 bug**

**SWE-bench**（详见 `docs/swebench-instrument-audit.md`）：

1. log parser 的 key/value 写反 → **8/87 = 9.2%** 的训练任务**永远判 0**
2. 容器内 proxy 地址写错
3. `git add/commit` 把 patch 弄丢
4. 模型空响应
5. 并行度 × `agent_timeout` 耦合

**教训**：跑任何 benchmark 前，必须先用已知答案（gold patch / 空 patch）验证判分器能分别给出满分和零分。这一步我们每次都跳过了。

**第三次犯（2026-09-19，就在把原生链路接通的当天）**：新建的原生配对评测（`benchmark_code_grader.py`）判分器**一次都没跑起来过**。

- 它从**写死的 macOS 路径**（`/Users/lsmax/Coder/EvoAgentBench`）导入 `livecode` 模块。评测跑在容器里，那个路径不存在 → 每个被判分的 arm 都是 `ModuleNotFoundError: No module named 'benchmark'`。
- Oracle 只断言"退出码 = 0"，于是**判分器崩溃被记成"任务失败"**。第一次真实配对评测的输出是 `newly_fixed=0, newly_broken=0, gate=FAIL`——**看起来完全像一个"技能没效果"的零结果**，实际上**一个任务都没有被判过分**。
- 同一轮里还有两个同源问题：一个 arm 把全部 300s 墙钟花在**单次模型调用**上（模型 36 tok/s × 8k 输出上限 ≈ 226s，再叠加上下文预填充就超了 300s），最终没写出 `solution.py`；这两个也都以"任务失败"的形式进了统计。

**修法（已落地）**：判分器改用 LiveCodeBench 自己的 `check_correctness`（EvoAgentBench 的 `_verify_code` 本来也只是它的薄包装），仓库路径按 `--lcb-repo` → `LCB_REPO` → 搜索路径解析；**跑不起来就 exit 2**。`exit 2` 是"仪器故障"契约：fixture 把它转成 `INFRA/ORACLE_EXECUTION_ERROR`，**仪器故障永远不会被读成零效果**。`exit 1` 才是判分失败，`exit 0` 才是全过。同时把输出上限压到 4096 token（最坏 ~115s），并加了一条单测证明 exit 2 变成 INFRA 而不是 TASK_FAIL。

> 这一条是错误实践 9 的**教科书级复现**：不是"我们忘了验证仪器"，而是**仪器坏了会自动伪装成零结果**，而且伪装得比真零结果还像。所以护栏不能是"记得去验证"，必须是**架构上的**——判分器无法运行时必须走一条**物理上不可能**被记成任务失败的出口。

**同一个 bug 家族的第三个成员：预算单位搞错，也会把"已经做对"记成"做错"。**

修完判分器后重跑，两个 arm 的提交都拿到了 `{"passed": 43, "total": 43, "reward": 1.0}`——**任务其实做对了**——但 arm 状态仍是 `TASK_FAIL`，原因写着 `BUDGET_EXHAUSTED`。因为 `exceedsBudget` 用的是**整条 arm 的累计用量**，而我们把 `max_input_tokens=32_000` / `max_total_tokens=48_000` 当成了"单次调用的上限"在配。实测一条 9 次调用、**解出了题目**的 arm：input **102,008** / output 6,648 / total **108,656**——比预算超了一倍多。

> 于是产生了一个极其荒谬的输出：**判分器说满分，运行记录说失败，门禁读到的是"没效果"。** 三个环节各自都"按设计工作"，合起来是一句谎话。

**修法**：这些字段是**整轮累计量**，按实测的 ~3 倍余量配置（300k input / 48k output / 400k total）。同时每日预算要能容纳**最坏情况预留**（`max_total_tokens × cases × arms`），否则会 `EVOLUTION_BUDGET_EXHAUSTED` 而根本没跑——这也是同一类错误：**把"没跑"读成"没效果"**。

**调研后的补充：这不是"常识"，这是一条有公开参考实现的行业规范。**（2026-09-18）

| 系统 | 硬门 |
|---|---|
| **SWE-bench** | `--gold` 校验；`None` patch / 空状态映射 **fail closed**；有一条针对"**从未启动的测试套件**"的显式护栏——**没有它，FAIL_ONLY 逻辑会把每个 F2P 测试都算作 resolved** |
| **Terminal-Bench** | "Solvability" = **oracle 通过所有测试** **AND** **no-op 假 agent 必须失败** |
| **Terminal-Bench-Science** | CONTRIBUTING：**oracle reward 必须 1.0，nop 必须恰好 0** |
| **Microsoft Vally** | 专门的 `oracle` 动词 + `--no-golden-input` 负对照，会标记"**平凡通过**"的判分器（exit 1） |
| **ABC 清单** | 条目 T.9 要求自动 oracle solver |

**这些规范是被真实事故逼出来的**：SWE-bench issue #26 "gold_patch cannot pass the test"；issue #393 发现 **42/61 个排行榜提交修改了评测测试文件**。

**反例**：τ-bench / AppWorld / OSWorld / WebArena / GAIA **都没有发布 golden-run 门**。而 WebArena 用了未校验的 LLM judge，**高估 1.4–5.2%**。

> **"从未启动的测试套件"这个护栏，几乎就是在描述我们的空响应失败。** 我们看到的 `passed=0/total=0` 正是"套件根本没跑起来"的形状——如果判分器不够严，这种情况会被静默地算成某种结果，而不是被拒绝。

**判分器坏掉的量级**（说明这不是洁癖）：JudgeBench 上 vanilla GPT-4o **50.86%** vs **50% 随机基线**，GPT-4o-mini 50.00%，**PandaLM 13.14%（低于随机）**。位置互换一致性 GPT-4 65.0% / GPT-3.5 46.2% / Claude-v1 23.8%。同义改写导致的判定翻转 GPT-4o 8.5% / gemini-2.5-flash **61.3%**。

> 一句值得记住的不等式（[Measurement Without Validity](https://arxiv.org/html/2608.00794)）：**`V_total ≤ V1×V2×V3`**——三个环节各 70% ⇒ 总效度 **≤34%**。

### 错误实践 10：度量口径是凭直觉选的，而这件事在文献上**根本没有答案**

我们当时的说法是：

- LCB hard tier 的失败都是**接近正确**（near-miss）→ 因为 graded 会把一堆 near-miss 都压到 0.75 附近、把差异抹平，所以该用 binary
- SWE-bench 的 binary 会撞**环境天花板** → 该用 graded `passed/total`

**调研后的更正**：这个论证方向是合理的，但**我们把它说成了"验证过的选择"，它没有被验证。**

**没有任何受控研究**用同一批 agent 轨迹同时按 binary 和 partial-credit 两种口径打分，并报告方差 / 功率 / 效应量。**这是评测文献里最大的空白。**

现有证据方向相反：

| 支持 graded | 反对朴素 graded |
|---|---|
| 连续指标信噪比远高：HumanEval **6.79→124.08**、MMLU 52.45→347.57、COPA 38.63→662.41 | graded 评测器可被**路径攻击**：PartHackBench 平均 Δhack **0.252** |
| AFTER **刻意同时报告** M1（通过比例）和 M2（全通过） | rubric judge 被 hack 时 gold judge 只掉 3 分（HealthBench-Hard）/ 22 分（ResearchQA） |
| TDAG/ItineraryBench：binary 在低完成度任务上"**无法有效区分不同方法**" | 假通过率（0.115 vs 0.173）被认为比一致性更贴近部署 |
| Parallel WebBench：完成率 50.7%→96.0%，元素级 F1 只有 0.2489→0.4529 | 步级给分有争议：**没有步级信号能打败边际匹配的乱序对照** |

**正确的表述**：度量口径取决于失败结构这个判断本身没错，但"哪种口径更好"**在文献上没有定论**——诚实的说法是**我们不知道，而且没人知道**。

**可操作的部分**：与其争论口径，不如**同时报告两个**（AFTER 的做法），并让它们互相校验。如果两个口径给出相反的结论，那说明效应量本身就小于口径敏感度——这比任何单一数字都更有信息量。

> 另外，这一条在优先级上**远低于 #7**。在 σ≈1.5pp 的噪声底上讨论 binary 还是 graded，是在讨论一把刻度尺的读数精度，而尺子本身没校准。

---

## 五、代码质量层面的次要问题

- **两个 driver 重复约 40 行管道代码**：`driver.py`（code_implementation / LiveCodeBench）和 `ir_driver.py`（information_retrieval / BrowseComp-Plus）各自复制了一份 bridge 启动 + nanobot 配置，连变量名都不一致（`client_token`/`port` vs `agent_token`/`agent_port`）
- **共享层其实是共享的**：`proxy_bridge.py`、`nanobot_cli_compat.py`、`retrieval.py` 是一份，不是 N 份——所以修复是集中的，改造量比看起来小
- **四臂实验的严重 bug**：`vanilla` 和 `memory` 两臂共用了同一个 `--job` 名 → 落到同一个 `<task>__trial_1` 目录 → **互相覆盖 `details.json`**。是靠交叉核对两份 arm 日志发现的（19 个任务里 12 个结果不一致，例如 `3744` vanilla 42/42 vs memory 2/3）。修复：job 名加 arm 后缀
- **`proxy_bridge.py` 的硬编码常量**（见错误实践 3）

---

## 六、对照：正确的做法是什么

### 职责划分（这是整个项目的立论基础）

| 归属 | 内容 |
|---|---|
| **产品（源项目）** | ④ 记忆本身：L0–L3、技能记忆、检索、注入、版本 |
| **我们** | ① 执行、② 度量、③ 选择 |

`MemoryCore` 自己的 README 写着：*"MemoryCore does not host, schedule, or execute the Agent itself."*

它不能执行 → 它拿不到 fitness signal → 它只能**堆积**，不能**选择**。

> **所以"选择"这一层，是我们唯一真正不可替代的贡献。**
> 我们两周的资产里，属于 ①②③ 的部分（协议、冻结、hash、配对运行、正控制、功率分析、噪声底）是真资产，必须保留。

### 一个重要的时机窗口

原生的技能评审提示词在 2026-08-10 有一次**哲学反转**（`MemoryCore/src/core/skill/prompts/skill-review-prompt.ts`）：

- **v1**：5 类分类门 + 5 条件最小门 + 4 维评分 ≥72 → 只覆盖了 **18/39 (46%)** 的反复出现的 SOP
- **v2**：**删掉所有门控**，"拿不准就记下来"，三类（SOP / Background / Preference）

也就是说：**原生现在完全没有质量信号**。

我们的实证配对度量，是原生缺失的、且**只有我们能提供**的信号。这不是"跟源项目竞争"，这是"补源项目的空缺"。

### 正确的集成形态

```
线 A（MemoryCore/src/evolution/）—— 保留，这是骨架
  ├─ 复用原生：extractL1Memories、SceneExtractor、CandidateArtifact、SkillCore
  ├─ 选择逻辑：proposals → proposal-runner → evaluate-gate → adoption
  └─ SkillEvaluationBinding  ← 线 C 应该从这里接入

线 C（scripts/evoagentbench/）—— 降级改造
  ├─ 只保留：加载任务 / 准备环境 / 运行 / 判分
  ├─ 删除：自己检索、自己提炼、自己注入、自己存储
  └─ suite_kind：从 AC_REGRESSION_V1 扩展，不是另起枚举
```

### 隔离应该怎么选

**不要**用 `auxiliary`（它设计上就跳过注入）。

**要**用 `evaluationPolicy` + `EvaluationSkillSessionRegistry.bind(sessionId, artifact)`：

- 它按设计放行 `evaluation-skill-override` 这一个只读注入器
- 它显式关掉 `memory_write` 和 `automatic_skill_extraction`
- 它带来的隔离是**可观测的**，不是我们声明的

---

## 七、待验证的三个前提（重新集成前必须回答）

1. 基于 space 的隔离（`/dsh/:spaceId/...`）是否等价于 auxiliary 隔离？如果不等价，能不能用它替代？
2. 原生的对话驱动提炼（`POST /v3/skill/conversation/add`）能不能**批量**接收历史轨迹？
3. `evaluation-skill-override` 是否只支持 skill，**不支持 memory**？如果不支持 memory，memory 臂该怎么办？

还有两个悬而未决的技术问题：

4. ~~线 C 的轨迹能不能喂进线 A 的生成入口（`extractL1Memories`）？——这是重新集成的唯一未知阻断点~~
   **已澄清（2026-09-18）**：这条是给"**提炼**"用的，不是阻断点。看 `adoption-proof.ts` 后确认，真正卡住的是"评测证据能否进 adoption 门"，而这条已经有确定答案：**能，只要把 `attempt_type` 和 `parent_id` 接对**。所以重集成不必等这个问题的答案，可以先接线、后补提炼。
5. 14B（和 27B）的**空响应失败**：`session.jsonl` 里 `assistant=0`，`details.json` 里 `passed=0/total=0`，没有 `solution.py`，agent 收尾说 "I've completed processing but have no response to give."。根因在 `nanobot/providers/custom_provider.py` 返回 `content=null` + `tool_calls: []` 但 reasoning 有内容。**占 30–40% 的任务损失**，必须修到 30% 以下再下任何结论。

---

## 八、接线图：修法比想象的小

发现 2c 之后，重集成从"大改造"缩成了"接线"。不需要重写、不需要新接口——门是现成的，而且已经被 `skill-evaluation-control.test.ts` 覆盖过。

### 现状：证据进不去

```
scripts/evoagentbench/*.py  ──HTTP──▶  service.ts:319
                                       benchmark/attempt/ingest
                                            │
                                            ▼
                                     attempt 记录
                                     attempt_type: "benchmark_transfer_evaluation"
                                     candidate_hash: null
                                     parent_id: （无）
                                            │
                                     ┌──────┴──────┐
                                     ▼             ▼
                             EvaluationEvidence   （无人读）
                             .tsx 只渲染

   adoptionProof()  ← 永远匹配不到这个记录
```

### 目标：两条路，都很短

**路 A —— 让 Python 侧直接产原生形状的证据**

在现有的 ingest 通道上补齐三个字段，不改协议、不改 runner：

| 字段 | 现状 | 需要 |
|---|---|---|
| `attempt_type` | `"benchmark_transfer_evaluation"` | 评测类证据走 `"skill_effect_evaluation"`（或扩白名单，见下） |
| `parent_id` | 无 | `candidate.id` |
| `candidate_hash` | `null` | `candidate.artifact_hash` |
| `newly_fixed` / `newly_broken` | 嵌在 `comparison_summary.skill.counts` | 同时提到顶层 |
| `gate_result` | 无顶层字段 | `attempt.result.gate.status` |

补齐后 `adoptionProof`（`adoption-proof.ts:16`）即可命中：

```
attempt_type ∈ ["paired_evaluation", "skill_effect_evaluation"]
  ∧ status === "PASS"
  ∧ gate === "PASS"
  ∧ newly_fixed >= 1
  ∧ newly_broken === 0
```

**路 B —— 把线 C 做成真正的 `SkillEvaluationBinding`**

走 `persistSkillEvaluation`（`skill-evaluation-executor.ts:102-114`）落库，由它自动产出上表所有字段。代价是要扩 `suite_kind`：

```ts
// 现在
suite_kind: z.literal("AC_REGRESSION_V1")
// 需要
suite_kind: z.enum(["AC_REGRESSION_V1", "EVOAGENTBENCH_CODE_V1", ...])
```

### 两条路的取舍

| | 路 A | 路 B |
|---|---|---|
| 改动量 | 小（补字段） | 中（扩枚举 + 实现 binding） |
| 复用原生程度 | 只复用了 adoption 门 | 复用整条选择链路 |
| 风险 | `promotion_allowed: false` 这个自设的锁要一起摘掉 | `suite_kind` 变成枚举后，`configSchema` 的 `.strict()` 校验要同步放宽 |
| 是否解决了"记忆层重写" | **否** | 部分（评测链路归位，提炼/检索仍是自造） |

**建议顺序**：先走路 A 把闭环打通（验证"配对证据 → adoption"这条链路真的能跑通），再走路 B 把线 C 收编。因为路 A 的产出就是路 B 需要的输入，先做 A 能立刻拿到一个可观测的结论。

### 还剩什么没解决

接线只解决"**评测证据进选择门**"。以下仍然是自己造的，要单独处理：

- `refine.py` 的提炼（该换成原生 `conversation/add`）
- `retrieval.py` 的检索（该换成原生混合检索）
- `nanobot_cli_compat.py` 的注入（该换成 `evaluation-skill-override`）
- `frozen/*.json` 的存储（该换成 `CandidateArtifact`）

但这些都**不阻断**第一次闭环验证——它们只影响"候选资产的质量"，不影响"证据能不能驱动 adoption"。

---

## 九、一句话总结

> 我们没有输在 benchmark 上，也没有输在机制上。
> 我们输在：**为了绕开一个技术障碍（auxiliary 跳过注入），重写了本该复用的东西，然后把自己写的东西当成了被测对象。**

更精确地说，最后这一层是**最讽刺的**：

> 我们花两周测出来的 `newly_fixed` / `newly_broken`，**恰好就是原生 adoption 门唯一认的那个数字**。
> 门是现成的，测试是现成的，形状我们也凑对了。
> 只是我们把证据 post 进了一个抽屉，门上写着 `promotion_allowed: false`——还是我们自己写上去的。

修法不是换 benchmark，是**把线 C 降级成线 A 的一个 binding**；而且第一步只是补三个字段。

---

## 附：证据索引

| 结论 | 文件 |
|---|---|
| 原生评测隔离策略 | `MemoryProxy/src/injection/evaluation-context.ts` |
| 只读技能覆盖注入器 | `MemoryProxy/src/injection/injectors/evaluation-skill-override.ts` |
| auxiliary 判定 | `MemoryProxy/src/agent-adapters/dsh.ts:126` |
| auxiliary 跳过注入 | `MemoryProxy/src/handler.ts:703-705` |
| 线 A 的评测接缝 | `MemoryCore/src/evolution/control/skill-evaluation-executor.ts` |
| 原生评测证据的正确形状 | `MemoryCore/src/evolution/control/skill-evaluation-executor.ts:102-114` |
| **adoption 门控条件** | `MemoryCore/src/evolution/control/adoption-proof.ts:16` |
| 只写不读的证据池 | `MemoryCore/src/evolution/control/service.ts:314-334` |
| 证据池的自我声明 | `service.ts:332`（`research_only / promotion_allowed: false`） |
| 唯一消费者（仅 UI 渲染） | `MemoryPanel/web/src/pages/EvolutionPage/EvaluationEvidence.tsx:17` |
| 两语言分叉的那次提交 | `4585c5f`（8 `.py` + 3 `.ts` + 1 `.tsx`） |
| 线 A 复用原生提炼器 | `MemoryCore/src/evolution/control/memory-proposals.ts` |
| 线 A 的冻结写入/adoption | `MemoryCore/src/evolution/control/adoption.ts` |
| 原生评审哲学反转 | `MemoryCore/src/core/skill/prompts/skill-review-prompt.ts` |
| 候选资产类型 | `MemoryCore/src/core/skill/candidate-types.ts` |
| 提炼器丢字段 | `scripts/evoagentbench/refine.py` |
| 自造检索 | `scripts/evoagentbench/retrieval.py` |
| 注入是拼字符串 | `scripts/evoagentbench/nanobot_cli_compat.py` |
| 硬编码隔离声明 | `scripts/evoagentbench/proxy_bridge.py` |
| ContinualSkillBench 缺陷 | `docs/continualskillbench-instrument-audit.md` |
| SWE-bench 缺陷 | `docs/swebench-instrument-audit.md` |
