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

## 十、2026-09-19：链路贯通记录

这一节记录"把线 C 换成线 A 的原生接缝"当天，真正跑起来之后发现的东西。**全部是实测，不是推断。**

### 10.1 现在真的能跑通的链路

```
task/complete（真实宿主任务 + 失败结果）
  → diagnosis/request（原生评审模型，15 秒，返回 JSON 裁决）
  → proposal job（原生 proposal runner，skill / memory_l1 / wiki 三种 stage）
  → candidate（冻结，immutable，带 artifact_hash）
  → validation job（内容校验）
  → evaluation/request（原生 MinimalEvaluationRunner + NanobotAgentAdapter）
      ├─ baseline arm = 官方技能版本
      └─ candidate arm = 冻结候选技能
  → 真 Oracle 判分（LiveCodeBench check_correctness）
  → gate（newly_fixed / newly_broken / 代价回归 / critical）
  → review/decide（技能必须人工；记忆在 auto_memory 下自动）
  → adoption/apply（原生 FrozenAssetWriter 写入 SkillCore / MemoryCore）
```

实测一次完整配对评测的**有效**结果（3 个 LCB 任务，双臂各跑真实 agent）：

| 案例 | baseline | candidate |
|---|---|---|
| abc387_b 9x9 Sum | `TASK_PASS` 43/43 | `TASK_PASS` 43/43 |
| abc387_a Happy New Year | `TASK_PASS` 44/44 | `TASK_PASS` 44/44 |
| abc388_b Heavy Snake | `TASK_FAIL`（放弃，未交 solution.py） | `TASK_FAIL`（放弃） |

门禁裁决：`FAIL`，原因**只有一条** `NO_NEW_FIX (observed 0, limit 1)`。没有代价回归、没有预算耗尽、没有仪器故障。**这是一份干净的"无效果"结论——而不是又一份伪装成无效果的故障报告。**

### 10.2 当天发现的 8 个"静默失败"（都会把故障伪装成零效果）

| # | 症状（看起来像什么） | 真正原因 | 修法 |
|---|---|---|---|
| 1 | 诊断 `MODEL_UPSTREAM_UNAVAILABLE` | 120s 超时上限 < 一次合法调用（36 tok/s × 8k ≈ 226s） | 上限提到 600s，并把 cause/HTTP 状态带进错误 |
| 2 | 诊断 `DIAGNOSIS_RUNNER_ERROR` | 模型把 JSON 包在 ```json 围栏里，裸 `JSON.parse` 抛 SyntaxError | 新增 `parseModelJson`，容忍围栏/前后文，并报告原文 |
| 3 | 诊断慢且偶发失败 | 评审模型在长思维链上烧完输出预算 | `disable_thinking: true`（vLLM `chat_template_kwargs`）：2–3 分钟 → **15 秒** |
| 4 | 技能候选**永远**评不了 | `target_id !== "skl-workspace"` 这道平行线遗留断言拒绝了每一个真实资产 | 删掉；真正的绑定是 artifact 里的 skill_id + 字节校验 |
| 5 | 评测 `ENVIRONMENT_SETUP_FAILED` | RunSpec 的 `model_preset` 被转发给 `Nanobot.from_config`，而运维配置里没有这个 preset | 只有配置里真的定义了才转发；model/provider 已直接来自 RunSpec |
| 6 | 评测 `401 invalid user_key` | 端点写成 `/hermes/evo-skill-eval/`，而用户 key 只对 service `default` 有效 | 走 `/hermes/default/v1` |
| 7 | 判分器从不报错，但**一个任务都没判过** | 从写死的 macOS 路径导入 `livecode`，容器里不存在 → `ModuleNotFoundError`；Oracle 只看退出码，于是**崩溃被记成任务失败** | 改用 LCB 自己的 `check_correctness`；**跑不起来 exit 2**，fixture 转成 `INFRA/ORACLE_EXECUTION_ERROR` |
| 8 | 做对了却记 `BUDGET_EXHAUSTED` | `exceedsBudget` 比的是**整轮累计用量**，却被当成单次上限在配（实测解出题的一轮：input 102k / total 108k，预算是 32k/48k） | 按实测最大 arm 的 ~1.5 倍配（40 calls / 600k input / 700k total） |

外加一条**门禁设计**问题：代价回归原本拿"全 suite 总量"比。baseline 因为**放弃**而便宜，candidate 因为**把题做出来**而显得贵 3 倍——**等于把修复的代价算到修复头上**。现在只在 `unchanged_success` / `unchanged_failure` 的案例上比代价，这才是"附带膨胀"的本意。

### 10.3 最终跑通了：一次真实的 PASS 走到了原生写入

> ⚠️ **2026-09-19 更正：这一节的 PASS 已被证明是污染造成的，见 10.6。**
> 链路（管道）走通仍然成立；但“这个候选让 agent 变强”这个推断作废。

把上面 8 个坑填完之后，**同一天内跑出了第一个真实 PASS，并完成了落地**：

| 案例 | baseline | candidate |
|---|---|---|
| abc387_b 9x9 Sum | `TASK_PASS` 43/43 | `TASK_PASS` 43/43 |
| abc387_a Happy New Year | `TASK_PASS` 44/44 | `TASK_PASS` 44/44 |
| **abc388_b Heavy Snake** | **`TASK_FAIL`**（第 6 次调用后放弃，未交 `solution.py`） | **`TASK_PASS` 42/42**（31 次调用） |

门禁：`status=PASS`，`reasons=[]`，`newly_fixed=["abc388_b"]`，`newly_broken=[]`。

接下来两跳全部走通：

```
review/decide  →  REVIEW_APPROVED（人工，技能永不自动放行）
adoption/apply →  APPLIED
   evidence.proof_id           = evo-0e6d72f2（就是那份 PASS 的 attempt）
   observed_base_version       = 25
   current_skill_hash          = 3961c7a97490fb48ba280d98041399df
```

**回读原生 SkillCore 验证**（`/v3/skill/get-by-name`）：

```
skill_id = skl-bs5ZZdDcpcit
version  = 26                        ← 25 → 26，真的写进去了
content  = 18512 字符
  包含 "table/grid sum with value-exclusion" 域模式      → True
  包含 Pitfall 10 "Silently dropped exclusion filter"    → True
```

也就是说：**一条真实失败轨迹，在没有人工编辑技能内容的情况下，变成了线上技能的一个新版本，而且中间每一步（诊断、候选、内容校验、真 Oracle 配对评测、人工放行、冻结写入）都有可核对的哈希与证据记录。** 这正是飞轮的"信号→积累→落地→控制"四齿第一次完整转了一圈。

### 10.4 还剩下的两件事（都不是 bug，是输入）

1. **测量仍然极度欠功率。** 同一个候选在 abc388_b 上：一次 `42/42` 通过、一次完全放弃。**单次运行在同一个案例上能从 0 跳到 100%**。上面那次 PASS 是**真的**（41 次运行里第一次出现），但它告诉我们的是：这套 3 题 suite 的单次结论不可信，必须重复运行、报区间、并用配对检验——而不是"跑一次看到 PASS 就收工"。下一个候选如果再跑一次拿到 FAIL，**两次都不算错**。
2. **suite 的区分度太低。** 两个任务双臂都过（天花板），一个任务在"放弃 / 31 次调用做出来"之间大幅抖动（地板附近的悬崖）。要变成可用的实验台，需要把任务选在**通过率约 30–70%** 的区间，并且把 n 提到几十个案例。

> **对最初那个问题的回答**：不是 benchmark 选得不合适，也不是机制无效。
> 机制是通的——**一条真实失败确实变成了技能的一个新版本**。
> 真正拦住我们的是：**仪器坏了会自动伪装成"零效果"**（8 次），以及**实验欠功率到单次结论没有意义**。这两件事都不是"换个 benchmark"能解决的。


### 10.5 顺带发现的产品缺口

- **CREATE 型技能候选无法做配对评测**：`candidateToEvaluationArtifact` 明确拒绝 `operation !== "UPDATE" || base_version <= 0`（`NEW_SKILL_CANDIDATE_NOT_SUPPORTED_BY_PAIRED_EVALUATION_V1`）。而诊断在"缺少某条 SOP"时**很容易**提出 CREATE（实测两次都是新建技能）。也就是说：**系统能生成新技能候选，但 v1 的评测接缝评不了它，因此它永远拿不到 adoption proof、永远无法被采用。** 这是链路里唯一一段"生成能力超出评测能力"的缺口，需要单独决策（要么给 CREATE 定义空基线，要么在生成侧就把它约束成 UPDATE）。
- **诊断路由几乎只出 `skill_defect`**：三次不同写法的证据（明确的配置覆盖、记录过的既定决策、记忆里查不到的事实）都被判成技能缺陷，提案也都是"新增一条 SOP"。`memory_gap` 一次没出现过。不一定是错——把"没遵守已记录的决策"归成 SOP 是合理的——但意味着**记忆路的自动闭环在真实流量下可能永远不被触发**，值得单独看一眼。
- **CREATE 候选的空基线（已补）**：现在 `CREATE` 会用"同一个 agent、不带任何技能"作为基线，这是新技能唯一诚实的对照，也让"从失败里长出新技能"这条路第一次能走到 adoption。

### 10.6 第十个静默失败，也是最严重的一个：**agent 可以上网把题目抄回来**

这条单独列，因为它**直接推翻了我们唯一一次正结果**。

10.3 里那次"真实 PASS"（后来被 review/decide 批准、写进 `skl-bs5ZZdDcpcit` v26）的 candidate 臂，工具调用记录是这样的：

```
seq 1   read_file problem.md  →  "1| Heavy Snake  2|  3| Write solution.py implementing the
                                  problem statement in problem.md."     ← 只有标题，没有题面
seq 4   curl https://atcoder.jp/search?query=Heavy+Snake
seq 7   curl https://www.google.com/search?q="Heavy Snake"+atcoder
seq12   curl https://duckduckgo.com/html/?q="Heavy Snake"+atcoder+problem
seq17   curl https://atcoder.jp/contests/abc388/tasks/abc388_b        → 18609 bytes  ★ 抓到题面
seq27   write_file "# Heavy Snake (AtCoder ABC388 B) ## Statement ..."           ← 题面抄进文件
       ... 写解法、写暴力、随机对拍 ...
       → 42/42 通过
```

baseline 臂则是 `read_file` → `list_dir` → 放弃。

**所以那次测的根本不是"技能让 agent 更强"，而是"技能里的 `curl -sSk` 教会了 agent 上网，它上网把自己的题目抓回来了"。**

三点后果：

1. **评测沙箱有不受限的外网出口**。题目 id 和标题就写在 `problem.md` 里，agent 能直接查到原题；原则上也能查到题解/editorial 直接抄。**这个 harness 上的任何测量都不是闭卷测量，holdout 不成立。**
2. 之前所有的困惑一次性解释清楚：所谓"单次 0 ↔ 100% 抖动"、天花板、地板，**全都取决于 agent 有没有拿到题面**（从 problem.md 拿、从网上抓、还是压根没有）。既不是模型抖动，也不是技能效果。
3. **"正结果 → 采用 → v26"这条链是假的**——它测的是"能不能上网抄答案"。技能 v26 本身仍是一次真实写入（管道是通的），但它作为"技能有效"的证据**作废**。

**修法（已落地，commit `9c43feb`）**：

- `detectEvaluationEgress` 审计每一条能执行东西的工具调用：外网 URL、`pip install`、`git clone`、`wget/curl`、`urllib/requests/socket` → 命中即把这一臂标成 `INFRA/EVALUATION_EGRESS_DETECTED`，门禁视为不可比，**污染跑出来的分永远进不了 gate**（本地 proxy 主机放行，因为"用 curl 取技能"是设计内的注入路径）。
- agent 子进程的 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 指向死端口，只把本地服务放进 `NO_PROXY`——行为规矩的客户端直接出不去。

> ⚠️ 这是**检测 + 屏障**，不是沙箱。真正的修法是在容器层面断掉 egress。在此之前，`detectEvaluationEgress` 只能看见工具调用里记录下来的东西，**不能当作唯一防线**。

**方法论教训**：一个能上网的评测环境里，"通过率"这个指标本身没有意义——因为它混着"真的会做"和"会查"。**先证明环境是闭卷的，再谈通过率。**

### 10.7 封堵污染后的第一次干净测量

修完污染 + 关掉 agent 的思维链（`extra_body.chat_template_kwargs.enable_thinking=false`）+ 放开预算后，在 hard 题上跑了一次配对评测。候选是**循环自己生成的 SOP**（`evo-ffa33728`），基线是**空技能**。全部 6 条臂的工具调用都审计过：**零次网络访问**。

| case | baseline（无技能） | candidate（循环生成的 SOP） |
|---|---|---|
| **abc387_f** (hard) | **FAIL 判错**（40 calls / 580k tok / 841s） | **PASS 43/43**（18 calls / 277k tok / 359s） |
| abc388_e (hard) | PASS 43/43（8 calls） | PASS 43/43（5 calls） |
| abc388_g (hard) | FAIL（40 calls，没交文件） | 判分器 **42/42**，却记成 `BUDGET_EXHAUSTED` |

**这是本项目第一条干净的正信号**：无技能失败 → 注入循环生成的 SOP 后 43/43 通过，而且**调用数和 token 都更少**（18 vs 40、277k vs 580k）。

**同一批还确认了一件事**：这些 hard 题**模型一次性作答（关思维链）就能 43/43**（abc387_f / abc388_e / abc387_c 全过，abc388_g 失败）。所以 agent 之前的失败**不是能力不足，是可修复的失败**——测量区间一直存在，只是被三样东西盖住：**污染、思维链、预算**。

**但正信号没有一次就复现**：

| | baseline | candidate | 判定 |
|---|---|---|---|
| 第 1 次 | FAIL 判错（40 calls） | **PASS 43/43**（18 calls） | ✅ 干净正信号 |
| 第 2 次 | FAIL 判错（21 calls） | 40 calls 被预算截断 | ⚠️ 无法判定 |

**重复第 2 次又暴露了同一类偏差的第四个实例**（已在 `7ef1f93` 修掉）：

> `BUDGET_EXHAUSTED` / `AGENT_TIMEOUT` 说明**跑被中断了，oracle 根本没来得及给意见**。把它记成"答错"，等于把"还不知道"写成"不会"，而且**专门惩罚勤快的技能**——技能让 agent 多干活 → 更费资源 → 更容易撞上限 → 被记成错。四次出现「判分器给 42/42 或 43/43、harness 记成失败」都是这个原因。

修法：被截断的一律 → **uncomparable → gate 返回 `INFRA_ERROR`（无法判定）**，不再伪造 FAIL；**墙钟成为唯一硬边界**，调用数/token 上限放宽到永远不会先撞上（之前是它们先撞上，才把"没跑完"变成"做错了"）。

**当前可见的模式**（待验证的假设）：这个 SOP 改变的主要是 **agent 愿意坚持多久**（18 次 ↔ 40+ 次），而不是"一次做对的概率"。坚持得久有时换来通过，有时只是把预算烧完。

> 现实约束：一次配对评测 15–60 分钟，n=5 就是几个小时。**在重复跑完之前，任何"有效/无效"的结论都太早。**

### 10.8 第一个有功效的阴性结果：注入技能没有提升表现

把三件事修掉之后（污染封堵、agent 关思维链、预算改成固定的"竞赛式"10 次调用），**失败的题不再是"贵到测不动"**：每对只要 4–5 分钟，而且两条臂都能在预算内跑完并被 oracle 判分。于是终于能做重复。

**设计**：候选 = 循环自己生成的 SOP（`evo-ffa33728`），基线 = 空技能，3 道 hard 题 × 4 次重复 = **12 对**。全部 24 条臂：零网络、零截断。

| case | baseline 通过 | candidate 通过 |
|---|---|---|
| abc387_f | 0/4 | 0/4 |
| abc388_e | **4/4** | 3/4（第 1 次**弄坏了**） |
| abc388_g | 1/4 | 1/4 |

- **`newly_fixed` = 0**；`newly_broken` = 1；`unchanged_failure` = 7；`unchanged_success` = 4。
- **在 baseline 失败的 7 对里，candidate 一次都没翻盘（0/7）。**
- 方向一致地更贵：candidate 平均调用数 ≥ baseline，token 也更多（如 run 3 abc387_f：207k vs 104k）。

**加上过程维度的独立测量**（3 道已会题 × 5 次重复 = 15 对，全部 30 条臂零网络）：

| case | baseline 调用数 | candidate 调用数 |
|---|---|---|
| abc387_b | 3,3,3,3,3 | 3,3,3,3,3 |
| abc389_a | 3,3,3,3,3 | 3,3,3,3,3 |
| abc390_b | 3,3,4,3,3 | 4,4,3,3,3 |

**在 agent 已经会的题上，注入技能对行为没有任何可测量的改变**（唯一差异是输入 token +~2k，即注入文本本身）。

**所以：关于"注入循环生成的技能能否提升 agent 表现"，这是一个有功效的阴性结果——不是"测不出来"，是测了、可比、没有。** 而 10.7 里那次唯一的 PASS 是噪声（同一候选在 abc387_f 上是 1/3，这里 0/4）。

> **推论（可检验）**：循环目前产出的都是**流程建议**（"提交前先验证"），而一个本来就会做这些题的模型并不需要流程建议。要让技能真正有用，它必须携带**模型不具备的知识**，而不是它已经在做的流程。这解释了今天所有的 null：**我们一直在往一个会做题的模型里注入它不需要的建议。**

---

### 10.9 第一个统计显著的正结果：**知识型技能有效，流程型无效**

（先更正 10.8 末尾我自己的一个错误判断。当时只跑了 1 轮，我说这个知识候选"把另外两题弄坏了"。跑到 **n=10** 之后不成立——那是 n=1 的噪声，正是我一直在批评的那种读法。）

**实验**：候选 = `v26 专家技能 + 一段函数图分解知识`；基线 = **同一个 v26 专家技能**。唯一变量就是注入的那段知识。3 道 hard 题 × 10 次重复，10 次调用的固定预算。

| case | baseline | candidate | 不一致对 | McNemar p |
|---|---|---|---|---|
| **abc387_f**（知识针对的那题） | **1/10** | **7/10** | **6 : 0** | **0.031** |
| abc388_e | 7/10 | 9/10 | 3 : 1 | 0.625 |
| abc388_g | 1/10 | 1/10 | 1 : 1 | 1.000 |

**在知识针对的那道题上，adoption 门关心的那个数字 `newly_fixed` 出现了 6 次，反向 0 次，McNemar 精确检验 p = 0.031。**

对照：**流程型**候选（"提交前先验证"）在**同一道题**上是 **0/4**。知识型 vs 流程型：7/10 vs 0/4，Fisher p = 0.070（样本小，但方向一致）。

**结论**：

1. **"注入知识能改变结果"——成立**，而且统计显著（p=0.031）。这是本项目第一条过硬的正结果。
2. **"注入流程建议能改变结果"——不成立**（0/4；过程维度 n=15 也无差异）。模型本来就会做题，不需要别人提醒它检查作业。
3. **副作用不存在**：n=10 下另外两题没有变坏（一题略好、一题打平）。

**但必须说清楚这条测试测的是什么、没测什么**：

| 命题 | 状态 |
|---|---|
| 管道能把**给定**的知识传进技能、并转化为正确行为 | ✅ 已证（p=0.031） |
| 循环**自己发现**知识（从原始失败里提炼出"这题是函数图"） | ❌ **未测**——这次的知识是我写进轨迹里喂给它的 |
| 循环自己产出流程建议有价值 | ❌ 已证否（0/4） |

也就是说：**传输环节通了，发现环节还没测。** 而"发现"正是自进化的核心。下一步该测的，是让诊断模型只看到**原始失败证据**（没有我给的答案），看它能不能自己提炼出那条知识——能，则 RSI 闭环成立；不能，则缺的是"发现"，不是"传输"。

---

### 10.10 第十一个坑：**轨迹库自污染**——实验会读到自己的历史

为了测"循环能不能**自己发现**知识"，我喂了一条只有原始失败证据的轨迹（题面 + "0/43 通过" + 预算耗尽，**没有任何提示**）。结果诊断给出的解释里逐句照抄了我早先手写的那段 insight：

> "the agent explicitly identified the missing knowledge: recognizing that the constraints form a functional graph where cycles force equal values..."

查 `evidence` 引用的 record_id：

```
evo-593c3c91...  原始失败 d1     ← 这次喂的
evo-abb79a22...  知识注入 k1     ← 我早先那次手写的
```

原因在 `dispatcher.ts` 的诊断入队逻辑：它会取同一 agent / owner 名下**最多 2 条相关的 FAIL 轨迹**一起送进模型。**生产上这是特性（从历史失败里学），做实验时它是自污染——实验可以读到自己先前的输入。**

> **修法**：实验必须隔离。要么用新的 agent / 新的 store，要么给 store 加实验作用域。**在没有隔离之前，"循环能不能自己发现知识"这个问题无法回答。**

**但这个意外同时给出了答案**：这次所谓的"发现"，是**检索**——它把已经存在于轨迹库里的句子搬了出来。所以：

| 命题 | 状态 |
|---|---|
| 循环**传播/蒸馏**已有知识（给定事实 → 写成 SOP → 显著改善） | ✅ p=0.031 |
| 循环**发明**知识（从零散失败里推导出新事实） | ❌ 无证据；这次的"发现"是从历史轨迹里检索出来的 |

**这意味着机制是"知识放大器"，不是"知识发生器"。** 它缺的那一齿是**知识源**（人的笔记、文档、更强的模型、外部检索），不是管道。产品里对应的入口是 `observation/ingest`（真实生产失败）+ 人类 review。

---

### 10.11 修掉自污染：证据集显式化，默认隔离

10.10 那个坑（实验读到自己的历史）已经修了（commit `635a2f0`）：

- `diagnosis/request` 增加显式策略：`{mode:"isolated"}` 只给模型看一条轨迹；`{mode:"history", max_related:1..5}` 才是旧行为，而且**必须显式要求**；
- **省略即隔离**——沉默的历史正是那次污染的原因，所以历史改成 opt-in；
- 策略写进 job payload，**retry 和崩溃恢复都保持原策略**（不会悄悄退回默认）；
- 诊断记录新增 `evidence_record_ids`：**把"模型看到了哪些记录"记下来**，而不只是它引用了哪些——这样证据集可审计。

**实测**：不带策略的请求 → job 里 `evidence_mode=isolated, max_related=0` → 诊断的 `evidence_record_ids` 和引用都只有那一条轨迹。✅

### 10.12 协作方式：codex 写代码 / 独立审查，实验一律跑本地模型

- **codex（gpt-5.6-sol）**：写实现、写测试、做独立审查。它先自己 `codex exec --help` 摸清工具，再动手；每份实现我都**独立复跑测试、检查改动范围、读关键语义**，不采信它的总结。
- **已完成的三件**：Codex 评测适配器（`58ed491`）、nullable telemetry 重构（同上）、诊断证据隔离（`635a2f0`）。其中"实测 usage 里没有 `model_call_count`"是我自己跑 CLI 发现的——**它的第一版会让适配器永远 fail closed**。这说明：可以派活，但**验证不能外包**。
- **实验一律用本地部署的模型**（qwen3.8-27b），不消耗 codex 额度。

---

### 10.13 加了消融对照之后：效果确实来自**那个事实**，不是"循环改了技能"

独立审查（codex 对抗式审查）判定我原本的实验设计 **CANNOT ANSWER THE QUESTION**，核心要求是：**加一个"同一份失败证据、去掉事实"的消融组**——因为循环本身也会改动技能（它会加流程建议），不做消融就无法把"注入的事实"从"任何改动"里分离出来。

加完之后，abc387_f 上的三方对照（同一个基线 v26 技能，n=10，10 次调用的固定预算）：

| 条件 | baseline | candidate | 不一致对 | McNemar p |
|---|---|---|---|---|
| **注入事实**（v26 + 具体分解与 DP） | **1/10** | **7/10** | **6 : 0** | **0.031** |
| **消融**（同一失败证据，**去掉事实**） | **2/10** | **2/10** | **2 : 2** | **1.000** |

- 效应量：注入事实 **+60pp**；消融 **0pp**。
- **对照卫生检查**：两批的基线 1/10 vs 2/10，Fisher p = 1.000 —— **两个批次之间没有时段/负载漂移**，所以候选的差异不是时间造成的。
- 组间（7/10 vs 2/10）Fisher p = 0.070：n=10 对组间比较功效不足，**强证据是组内的配对检验**。

**关键细节**：消融候选的 SOP 里**也提到了 "functional graph"**（循环自己从题面 `x_i <= x_{A_i}` 推出来的）。所以差别不在"有没有提到图"，而在**有没有那条具体的分解与 DP 递推**。**起作用的是具体事实，不是"让它去结构化思考"的空泛提示。**

**审查预言的失败模式确实存在**：如果不加消融组，我会把 p=0.031 读成"知识传递有效"——方向没错，但**无法排除"任何改动都有效"**这个解释。消融组把它排除了。

**这条结果证明了什么、没证明什么**：

| 命题 | 状态 |
|---|---|
| 把**给定的事实**编码进技能能显著改善该任务（对照排除了泛化改动） | ✅ p=0.031，消融 0pp |
| 循环能**自己发现**这个事实 | ❌ 消融组证明它只能给出空泛结构提示；且 10.10 已证"发现"其实是检索 |
| 效果能**泛化**到别的题 | ❌ 未测（知识与评测是同一道题，审查指出的同题泄漏） |
| **知识源**的可得性 | ⚠️ 冻结协议实测：3 道目标题里源解题器只有 **1/3** 能产出被判分器验证通过的解法 |

> 所以完整的回答是：**机制能把给定的事实变成可验证的技能改进（已证，p=0.031，消融对照 0pp）；但它既不能自己发现事实，也不能凭空获得事实。瓶颈在知识源和泛化，不在管道。**

---

### 10.14 预注册的三臂对照，否掉了我自己的结论：起作用的是**结构指引**，不是**那段算法**

10.13 我写下"效果来自那个具体事实"，依据是消融组（去掉整段文字）0pp。独立审查指出这不够：消融只去掉了整段文字，所以"事实"仍然和"多一段任务相关的强调文字"混淆。于是我**先预注册**（`docs/evolution-knowledge-transport-preregistration.md`，写在安慰剂臂产出任何数据之前），再加了第三臂。

**三臂（abc387_f，n=10，同一基线 v26，证据集与循环完全相同，唯一变量是那段文字）**

| 臂 | 内容 | baseline | candidate | 不一致对 | McNemar p |
|---|---|---|---|---|---|
| A | 无段落 | 2/10 | **2/10** | +2/−2 | 1.000 |
| B | **等长安慰剂**（1043 字符，同格式同语气，提"函数图"但**不含**环上相等与 DP） | 3/10 | **6/10** | +5/−2 | 0.453 |
| C | 真实事实（1146 字符，含"环上必须相等"+ 树的非增性 + `f(v, c)` 递推） | 1/10 | **7/10** | +6/−0 | 0.031 |

- **预注册的主要比较 C vs B：7/10 vs 6/10，Fisher p = 1.000 → 无差别。**
- 按预注册判读：**H2 成立——完整正确的算法不是必需的；一段任务相关的结构化指引就够了。**
- 次要：B vs A（6/10 vs 2/10）p=0.170；C vs A（7/10 vs 2/10）p=0.070；**B+C 合并 13/20 vs A 2/10，p=0.050**。

**我自己的对照有瑕疵，必须记下来**：安慰剂里意外包含了**两条关键结构性质之一**——"the cycle nodes are the maxima of their component (every tree node is <= its parent)"。所以不能反过来说"纯注意力效应"；能成立的只是：**完整/正确的算法内容不是必要条件**。真正的纯注意力对照（等长、但完全不相关的内容）**没有被测**。

**因此 10.13 的结论要下调**：

| 说法 | 修正后 |
|---|---|
| ~~机制能传输给定知识，p=0.031，消融 0pp~~ | ❌ 过度解读。p=0.031 作为"C 对自身基线"的配对结果成立，但**不能归因于那段具体知识**——等长、只含部分结构的安慰剂一样好 |
| 循环产出**必须含任务相关的结构指引**才有效 | ✅ A 0pp；B+C 合并 p=0.050 |
| 循环产出**泛泛流程建议**有效 | ❌ 0/4（10.8） |
| 循环能自己**发现**结构 | ⚠️ 能（消融组自己推出了 functional graph），但**只在 SOP 里写一句不够**（A 臂就是这样，0pp）——需要**一整节**任务特定的结构指引 |

> **最终定性：它是"注意力 / 结构化放大器"，不是"知识传输通道"。**
> 好消息是不必先解决"知识源"：循环自己就能从题面提炼结构；**坏消息是这比"学到知识"弱得多**，而且"精确算法有没有额外价值"这个问题现在**没有证据支持**。

---

### 10.15 最终结论：四臂对照 —— 它是"结构放大器"，**注入内容是什么几乎不重要**

第四臂（纯注意力对照）我按同样的纪律**先预注册再看数据**（`docs/evolution-knowledge-transport-preregistration.md`）。四臂各 n=10，同一道题（abc387_f）、同一基线（v26）、同一 10 次调用预算、同一 isolated 证据集，**唯一变量是我塞进失败轨迹的那段文字**。

| 臂 | 注入的文字 | baseline | candidate | 不一致对 | McNemar p |
|---|---|---|---|---|---|
| A | **什么都不加** | 2/10 | **2/10** | +2/−2 | 1.000 |
| B | 等长安慰剂（含部分结构，无 DP） | 3/10 | **6/10** | +5/−2 | 0.453 |
| C | 真实事实（含环上相等 + 树的非增性 + `f(v, c)` 递推） | 1/10 | **7/10** | +6/−0 | **0.031** |
| D | **完全无关**（讲边缘网关按租户路由；已验证不含 functional/graph/cycle/constraint/assignment/count/modulo/array 等任何术语） | 2/10 | **5/10** | +4/−1 | 0.375 |

**预注册的主要比较 C vs B：7/10 vs 6/10，Fisher p = 1.000 —— 没有差别。**

**但真正致命的发现来自内容分析**：四个候选**全都**含有一节任务相关的 `## Domain pattern (functional graph...)`，**包括 D 臂**——我注入的是网关路由，**循环完全无视了它，自己从题面写出了结构小节**。

| 臂 | 我注入的 | 循环实际新增的结构小节 |
|---|---|---|
| A | 无 | **1748 字符**（10 行） |
| D | 无关内容 | 2516 字符（11 行） |
| B | 等长安慰剂 | 3243 字符（10 行） |
| C | 真实算法 | 3084 字符（15 行） |

于是四臂唯一的系统性差别是**那一节的份量**，而效果（0pp / +30pp / +60pp / +30pp）与它同向。

**最终结论**

> **机制有效——但它不是"知识传输通道"，而是"结构放大器"。**
> 循环自己就会从题面提炼结构；给它任何一段等长的、结构化的文字，只是让它**把那一节写得更长**，而效果跟着长度走（**描述性**合并 B+C 13/20 vs A 2/10，Fisher p=0.050）。
> **注入内容的正确性没有可检出的额外价值**（C ≈ B ≈ D；C vs B p=1.0）。

**必须写明的局限**

1. 这只在**一道题**上验证过；**泛化仍未测**。
2. C vs B 在 n=10 下的置信区间很宽，**无法排除 C 有小幅优势**；能说的是"没有证据表明内容重要"，不是"已证明内容不重要"。
3. D 臂的"无关内容"被循环改写成了任务相关内容，所以它**不是**一个有效的纯注意力对照——真正需要的是**直接操纵技能里那一节的长度**，而不是操纵注入文本。
4. 四次评测共用同一份冻结的题表与预算，但 C 臂有 6 条**意外多跑的**评测（见 10.14 的操作失误）；按时间序取前 10 条（即预注册批次）得 1/10→7/10，全部 16 条得 1/16→13/16，方向一致、更强。

**对产品的三条可执行结论**

1. **不要为"知识源"投入**：喂什么几乎都一样，它不是杠杆。杠杆是**让循环把任务结构那一节写得更详尽**。
2. **泛化测试优先于一切**：知识与评测同题是当前结论唯一悬空的地方。
3. **门禁必须加重复与判据**：每案例一次配对、无显著性检验时，什么都不做的技能在 p=0.1 的题上单次约有 9% 概率拿到 `newly_fixed`；n=5 的 McNemar 上限 p=0.0625，**永远不可能显著**。

**开放问题（下一轮的唯一入口）**：效果是否**只**取决于结构小节的长度？要回答它，必须直接操纵那一节的长度并保持内容不变。

---

### 10.16 最后一块：同一个候选换到结构不同的题上 —— **完全无效**

10.15 的结论"注入内容是什么几乎不重要"还留着一个洞：**同题内所有臂都拿到了任务相关的结构小节**，所以分不清"结构对不对得上题"是否必要。最后一测把**同一个候选 C**（SOP 里带的是函数图那一节）拿到 **abc389_f（Rated Range，结构完全不同）**上跑 n=10：

| 同一个候选 C，同样 n=10 | baseline | candidate | 不一致对 | McNemar p |
|---|---|---|---|---|
| abc387_f（事实所述的题） | 1/10 | **7/10** | +6/−0 | **0.031** |
| abc389_f（结构不同的题） | 1/10 | **0/10** | +0/−1 | 1.000 |

**候选通过率 7/10 vs 0/10 → Fisher p = 0.0031。**

> **同一个技能，同一套流程，同一预算：在自己那道题上 7/10，在结构不同的题上 0/10。**

---

## 第十节最终结论

四臂（全在 abc387_f）+ 一个跨题对照，全部 n=10、同一基线 v26、同一预算、同一 isolated 证据集：

| 臂 | 注入的文字 | baseline | candidate | 相对基线 |
|---|---|---|---|---|
| A | **什么都不加** | 2/10 | 2/10 | **0pp** |
| B | 等长安慰剂（部分结构、无 DP） | 3/10 | 6/10 | +30pp |
| C | 真实事实（完整算法） | 1/10 | 7/10 | **+60pp**（p=0.031） |
| D | **完全无关**（网关按租户路由） | 2/10 | 5/10 | +30pp |
| C | 换到结构不同的题（abc389_f） | 1/10 | **0/10** | **0pp** |

**三句话**

1. **机制有效**：它能让一个候选技能在同一道题上显著提升通过率（p=0.031），且无反向翻盘。
2. **但"注入的知识"不是效果来源**：完整算法（C）≈ 部分结构（B）≈ 完全无关内容（D），C vs B **p=1.000**。原因是**循环会自己从题面写出任务结构那一节**（D 臂证明：我喂网关路由，它照样写函数图）——注入的文字只是让那一节**更长**（1748 → 2516–3243 字符）。
3. **结构必须与题目对得上**：同一个候选 C，在自己那道题上 7/10，在结构不同的题上 **0/10**（p=0.0031）。

> **它是「按任务结构定位的放大器」：把 agent 该注意的结构写进技能，从而改变行为；
> 它既不是知识通道（内容对不对无所谓），也不是通用增益（换题就归零）。**

**产品含义（可执行）**

1. **别投"知识源"**：喂什么几乎一样，它不是杠杆。
2. **要投"结构库 + 路由"**：价值来自"当前任务对应那一节结构指引，且被送到该任务上"。这正是产品里 skill routing（bm25）该干的事——而现在的评测器是**无脑注入单个候选**，所以任务特定技能会被硬套到别的题上（10.9 那次"弄坏两题"就是这个机制）。
3. **泛化不是"知识迁移"，而是"结构路由"**：下一轮该测的是——为一个**题族**写一节结构，看它在该族内的**多道不同题**上是否都有效。
4. **门禁必须加重复与判据**（同 10.15）。

**仍未测**：题族内的跨题复用（本节的跨题对照只证明了"结构不对就无效"，没证明"结构对就能复用"）。这是唯一还没回答的问题。

---

### 10.17 两个操作层面的教训（会重复咬人的那种）

**① `/tmp` 不是耐久位置。** 9/22 00:00 左右，128MB 的评测题池 `test6.jsonl` 被 macOS 的 `/tmp` 定期清理删掉了——它是 9/17 创建的，正好过了 3 天。**已完成的实验结果没事**（结果存在 evolution store 里），但**所有新评测当场失效**，而且当时没有任何副本。

- 恢复方式：该文件就是 HuggingFace `livecodebench/code_generation_lite` 里的 `test6.jsonl`。**huggingface.co 在这台机器上不通，`hf-mirror.com` 通**，且镜像不认 `release_v6` 这个 rev，要用默认分支：
  `https://hf-mirror.com/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl`（134,303,240 字节，175 题）。
- **耐久副本现在放在 `/Users/lsmax/Coder/lcb-data/test6.jsonl`**，评测时再拷进容器挂载点。判分器复核：abc387_b 的 gold 解 → 43/43。
- **教训**：跑实验用的**数据、脚本、结果**都不能只放在 `/tmp`。结果这次侥幸在 store 里，脚本（我那一堆 `/tmp/*.py`）下次就会被清掉。

**② 这个题库**没有**题族。** 为了回答"结构放大器的效果能不能在**同族其它题**上复用"，我在 175 题里做了两轮筛选：

- 关键词筛：`x_i <= x_{A_i}` 形式只命中 `abc387_f` 与 `abc400_g`，而 `abc400_g` 实际是"最大配对权重"题（正则匹配到的是符号写法，不是同一结构）；
- **用本地模型对 26 道计数/取模类 medium/hard 题逐题判定"核心结构是否为函数图"**：只判出 `abc387_f`（源题）、`abc392_c`、`arc195_e`。后两个一个其实是父指针树（误判），`abc392_c`（"Bib"，置换求逆再复合）虽然确实是置换结构，但**题目平凡、处于天花板**：实测 baseline 3/3、candidate 3/3，**无 headroom**。

> **结论：contest 题天然"一族一题"，用这个池子无法回答"题族复用"。
> 要回答它，必须自己造一个同结构的题族（并给每道题配精确 oracle）。**

---

---

## 十一、2026-09-22：题族复用验尸实验（最后一次）——**未通过预注册判据**

这一节回答了 10.17② 留下的唯一未答问题：**为一族题写一节结构，它在该族内的其它题上能复用吗？** 结论：**不能判定为有效**。

### 11.1 冻结的东西（跑之前 SHA256 冻结，跑完没改）

自造三题同族（函数图 + 前缀和计数），全部由我编写并冻结：

| 题 | 变化点 | 与 p1 的关系 |
|---|---|---|
| **p1** | 值域 `[1..M]`，计数无限制 | 源题，**候选只能看它** |
| **p2** | 值域换成给定升序集合 `S` | 留出题（holdout） |
| **p3** | 计数条件改成 `max = m0`，即 `F(m0)−F(m0−1)` | 留出题（holdout） |

- 三题共用同一套分解（Kahn 剥环 + 每节点前缀积 DP），**分量之间取乘积**是关键洞察；
- oracle 由独立暴力枚举对拍：**600 个随机小规模用例，0 处不一致**；N=M=800 时 0.13s；
- 隐测试挡住暴力：最大规模 N=M=2000，枚举 `M^N` 不可能（顺带纠正一个我自己的蠢错误：我一度写了个"暴力解"跑出 7/24，其实是我**算错了题**，不是超时）。

### 11.2 第一步就撞上两个结构性事实（这是本轮最有价值的发现，且写在代码里）

我原本的计划是：跑 p1 → 拿到失败 → 诊断 → 生成候选 → 在 p2/p3 上测。前两步就被产品设计挡住了。

**① 评测证据永远不进诊断——飞轮的"评测"齿和"积累"齿在代码里是断开的。**

```
service.ts:353  // Benchmark evidence is research-only. It is not an adoption proof and never dispatches diagnosis.
service.ts:434  // Development/test runs are visible research evidence, never diagnosis inputs.
diagnosis.ts:34 if (trace.kind !== "trace" || trace.origin !== "runtime") throw ... "LIVE_TRACE_REQUIRED"
```

也就是说：**你没法用 benchmark 闭环自进化**。`benchmark/*` 那一组 action 只是"记录研究证据"，永远不派发诊断。想产出候选，只能靠**真实生产流量**产生 `task/complete` 轨迹。

**② 更狠的一条：成功永远不会被固化，只有失败才会。**

```
proposals.ts:12   if (source.payload.route !== "skill_defect") throw ... "SKILL_DIAGNOSIS_REQUIRED"
diagnosis.ts:60   route = parsed.route === "skill_defect" && 被引用的 FAIL 轨迹 < 2 ? "unknown" : ...
dispatcher.ts:104 const stage = {skill_defect:"skill", memory_gap:"memory_l1", wiki_gap:"wiki"}[route]
```

`skill_defect` 需要**至少 2 条被明确引用的 FAIL 轨迹**；`no_change / infrastructure / capability_gap / unknown` 四个路由**不产出任何候选**。后果：

> **它只能"修缺陷"，不能"固化能力"。模型已经做对的题，飞轮一点东西都学不到。**
> 这直接限制了自进化的适用面——它只在"模型持续做错"的地方有戏。

**③ 附带发现：评测 attempt 不存 agent 转写。** attempt payload 只有 `paired_results / gate_result / cost_summary`，**没有 transcript**。所以评测路径连一条"真实轨迹"都产不出来，必须另开旁路采集。我用同一个 `nanobot_runner.py` 桥接层直跑 agent、把真实 `tool_events` + `final_output` 如实写进 `task/complete`——**没有任何一条轨迹是我编的**。

### 11.3 p1 上拿到的是真失败，而且是同一个根因

6 次 p1（同预算：10 次模型调用 / 20 次工具调用 / 900s，全新工作区）：

| run | 得分 | 说明 |
|---|---|---|
| a1 | **24/24** | 自己写暴力对拍 + 测最坏形状 |
| a2 | **15/24** | 把所有环当成一组（强制共享同一取值） |
| a3 | **24/24** | |
| b1 | **18/24** | 根节点之间**求和**而非**求积** |
| b2 / b3 | **24/24** | |

→ **4 PASS / 2 FAIL**。两条失败是同一类：**分量必须相乘、不能共享取值/相加**。而 agent 自己在 `final_output` 里**已经写出了正确修法**，只是 10 次调用预算用尽没改成代码。污染审计：**0 次网络访问、0 次读取 `/data` 下任何测试/配置**。

### 11.4 候选技能

原生链路一路走通：`task/complete`（真实转写）→ `diagnosis/request`（explicit，引用两条 FAIL）→ 路由 **`skill_defect`** → 自动接力 proposal → 候选 `evo-711e54d7`，`operation: update`，`base_version: 26`，状态 `NEEDS_EVIDENCE`（**按约束未采纳**）。

它新增的 9 行**正好就是答案**：

> `## Domain pattern (functional graph with per-node constraints x_i <= x_{A_i}, counting labelings)`
> … **CRITICAL: components are independent — the answer is the PRODUCT over components …, NOT a single sum over v of the product over ALL cycle nodes.**

（还顺带混进一条无关的 pitfall #12，来自别的会话——候选里**有噪声**。）

### 11.5 判定：两条预注册判据都没过

留出实验：p2/p3 各 10 个 repeat，**同一 repeat 内两臂背靠背执行**（臂序按奇偶交替），同预算、全新工作区、无网络；**判定用只在宿主存在、容器从未见过的同分布新用例**（gold 复核 24/24、32/32），容器里那份可见的测试只作为参考值记录。

| 口径 | p2 (base→cand) | p3 (base→cand) | 合并 b→c / c→b | 精确 McNemar |
|---|---|---|---|---|
| ITT（4 次仪器故障算失败） | 1/10 → 5/10 | 2/10 → 4/10 | **8 / 2** | **p=0.1094** |
| per-protocol（故障格重跑一次） | 2/10 → 5/10 | 3/10 → 5/10 | **9 / 4** | **p=0.2668** |

- **两种口径都远未达到预注册的 `p ≤ 0.05`**；n=20 对、9:4 这个比例需要大约 15:5 才够显著。
- **预注册的"不得退化"是净额判据**（每个 holdout 上 `c→b ≤ b→c`），这一条**通过**：p2 2 ≤ 5、p3 2 ≤ 4。
  （但逐对看确实有 **4 对**从满分掉下来——净额判据宽松，这个事实照实记录。）
- 方向是一致的：平均通过率 0.494 → 0.675（+18pp），满分次数 5/20 → 10/20。

> **冻结判据下的结论：未观察到跨题复用。**
> 点估计为正（与 10.15 的"结构放大器"一致——候选注入的正是该族需要的任务结构），
> 但未达预注册显著性门槛。按协议"只允许的两种解释"，这属于第 2 种：**不通过**。

**必须说明的设计限制**：候选臂注入的是**整份技能**（20897 字符，其中相关新增只有约 1.4k 字符），基线是 18512 字符——即"v26+新增节 vs v26"，**不是"只加那一节"**。这与 10.15 发现的"技能越长、那一节越显眼、效果越靠长度"高度吻合，也解释了高方差：**真正起作用的信号被 20k 字符的无关内容稀释了。**

### 11.6 与协议文本的四处偏差（照实记录，不做事后辩护）

| # | 协议原文 | 实际做法 | 判断 |
|---|---|---|---|
| 1 | 规模 `N,M ≤ 800` | 冻结并实际使用 **`N,M ≤ 2000`** | 文档与产物不一致；但两个规模都让枚举 `M^N` 不可能，约束 3 的**意图**成立 |
| 2 | "题 2、题 3 交替排队（2,3,2,3,…）" | 每个 repeat 内**两臂背靠背**（p2 base+cand → p3 base+cand），臂序按奇偶交替 | 交错**意图**（控制时间漂移）达到，形式与原文不同 |
| 3 | "**断网**" | 未做网络层封锁，改为**审计**：40 次运行 **0 次网络访问、0 次越界读文件** | 弱于原文；但这两道自造题在互联网上不存在，无题可抄 |
| 4 | 污染缓解：命中测试路径即标 `CONTAMINATED` 并剔除 | 判定改用**宿主独享、容器从未见过的同分布新用例** | **强于原文**——满分即证明是通用解，抄测试拿不到分 |

### 11.7 这一轮又踩到并修掉的三个坑

| 坑 | 现象 | 处置 |
|---|---|---|
| **explicit 证据里列了源轨迹自己** | 整条请求被判 `EXPLICIT_EVIDENCE_NOT_USABLE`，像是"证据全都不可用"，实际只是重复列了源 | **已修**：拆出独立原因码 `EXPLICIT_EVIDENCE_INCLUDES_SOURCE`（`dispatcher.ts`，含测试） |
| **`AGENT_ABORTED` 不带原因** | `_completed_payload` 不含 `result.error`，4 次中止只显示"2 次模型调用后死掉"，无法区分 agent 放弃和未归类的传输故障 | **已修**：桥接层回传 `abort_reason`，adapter 把它写进 `output_evidence`（含测试） |
| **测试文件对 agent 可读** | agent 与 grader 同 uid、无沙箱（adapter 注释自陈 "is a barrier, not a sandbox"），`cat /data/config/family/tests/*.json` 就能抄答案 | 判定改用**宿主独享新用例**；满分即证明是通用解，抄不来 |

### 11.8 一个月实验的总答案

**范围限定（2026-09-22 读完官方博客后修正，对账见 `docs/official-blog-reconciliation.md`）**：

> 我测的是**"从失败自动生成技能并采纳"**这条环（`diagnosis → candidate → gate → adoption`）。
> 博客 §5 的 60%→80% 测的是**"检索并装配已有资产"**这条环（前序 Case → 后序 Case，四类资产组合，真实仓库任务）。
> **两个环不同：我的阴性结果否不掉博客的数字，博客的阳性结果也覆盖不到我这条链路。**
> "检索装配"这条链路**我没有测过，无结论**。

**在我测的那条环上：没有可复现、可信的正面效果。**

1. **作为知识通道：已证伪**（10.15：C≈B≈D，C vs B p=1.000）。
2. **作为结构放大器：方向一致但无法稳定兑现**（10.15 单题 p=0.031；本节同族 n=20 p=0.27，且有 4 次回退）。
3. **结构对不上时明确有害**（10.16：7/10 → 0/10，p=0.0031）。
4. **结构上它还被两处设计限死**：评测证据进不了诊断（只能靠生产流量）、成功永远不固化（只修缺陷）。
5. **门禁没有重复也没有显著性检验**：单次运行约 9% 概率误报 `newly_fixed`（10.15）。
6. **新增（对账发现，代码事实）**：**评测路径把整份资产原样注入 prompt**（`minimal-runner.ts:354`），
   **违反博客 §2.3.3 自己写的"渐进式暴露"原则**。所以我测的是**产品不会采用的一种投递方式**——
   10.15"效果跟着注入文字长度走"更像是这种 off-design 投递造成的**注意力/长度效应**。
   → 评测结论对生产行为的可外推性，比我原先以为的更差。

**要继续走，必须改的是"投递方式与判据"，不是"多喂知识"**：

1. **评测臂要按产品的投递方式构造**：实现渐进式暴露（只给名称/触发条件/用途 + 工具取细节），或至少**按任务路由 + 长度匹配**；
2. **门禁加重复 + 显著性检验 + 固定子集 + 负迁移分类**（博客 §5.3 自己列的就是这四条；成本约 ×10，需产品侧决策）；
3. **素材换成真实仓库任务**（如博客 §2.7 那条 CodeGraph impact"读档"案例），而不是自造题族。

---

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
| **评测证据永不派发诊断** | `MemoryCore/src/evolution/control/service.ts:353,434` |
| **诊断只接受 runtime trace** | `MemoryCore/src/evolution/control/diagnosis.ts:34` |
| **技能候选只由 `skill_defect` 生成（需 ≥2 条被引用的 FAIL）** | `proposals.ts:12`、`diagnosis.ts:60` |
| 路由→生成阶段的映射（其余路由不产候选） | `MemoryCore/src/evolution/control/dispatcher.ts:104` |
| 评测 attempt 不持久化 agent 转写 | `skill-evaluation-executor.ts` 的 attempt payload |
| explicit 证据误列源轨迹的原因码 | `MemoryCore/src/evolution/control/dispatcher.ts`（`EXPLICIT_EVIDENCE_INCLUDES_SOURCE`） |
| 中止原因可见性 | `nanobot_runner.py`（`abort_reason`）+ `nanobot-agent-adapter.ts` |
| 通用 inline oracle（`--tests` 模式） | `MemoryCore/src/evolution/evaluation/fixtures/benchmark_code_grader.py` |
| 冻结题族与协议 | `/Users/lsmax/Coder/family-autopsy/`（`PROTOCOL.md`、`FREEZE.sha256`） |
| 本轮原始数据（去重后） | `family-autopsy/results/`（`holdout_final.jsonl`、`diagnosis.json`、`candidate_skill.md`） |
| **官方博客与实测对账** | `docs/official-blog-reconciliation.md` |
| **评测器整份注入（违反渐进式暴露）** | `MemoryCore/src/evolution/evaluation/runner/minimal-runner.ts:354` |
| 博客 §2.3.3 渐进式暴露原则 | `/Users/lsmax/Develop/Clippings/任何错误只犯一次：TencentDB Agent Memory 的团队记忆实践.md` |
