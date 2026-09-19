# Phase 4 预注册：复用 suite 上的 Memory 效果测量

状态：**待 Critical Review 放行**（执行前冻结）。本文件只含离线校验与推算，不含任何新的模型调用结果。

## 1. 这次要回答的问题

**自动生成的 Memory（逐题解法摘要）在未见过的任务上有没有迁移效果？**

- 投递链路已由 v12 正对照证明可用（`docs/evoagentbench-positive-control-report.md`），因此本轮结果**可归因**。
- **不回答**：Skill 的迁移效果（见 §3，本 suite 上 Skill 送达为 0，无法测）；也不回答任何 Promotion 相关问题。

## 2. Suite 身份与污染校验（已实测）

复用 `code-v2` 的 24 题 development suite（12 hard / 8 medium / 4 easy），artifact `f9c1e870693b0cda04547bc8887cced9e85b355fb2d8f95b68ad327966068441`。

**身份标注**：该 suite 曾被协议 v2 用作 development。它**不是**本轮候选的 fresh held-out，必须标注为 **recycled diagnostic suite**。

**对该候选仍满足"未见过"**（逐项实测，全部为空交集）：

| 校验项 | 结果 |
|---|---|
| code-v8 experience（候选生成来源）∩ v2dev | **∅** |
| code-v8 smoke ∩ v2dev | **∅** |
| code-v8 development ∩ v2dev | **∅** |
| 候选 Memory 的 `source_task_id` ∩ v2dev | **∅** |
| 候选 Skill 的 `support_task_ids` ∩ v2dev | **∅** |

即：被测量的候选（v8 composite r2：24 条 Memory + 1 条 Skill）在生成时从未接触过这 24 题，因此对它而言这是一次候选盲的评估。

## 3. 送达预测（决定了可测的臂）

离线（生产同款分派，对 24 个真实 prompt）预测：

| 臂 | 资产池 | 命中题数 | top-2 集中度 | 可用性 |
|---|---:|---:|---:|---|
| Memory | 24 | **24 / 24** | 0.458 | 可测 |
| Skill | 1 | **0 / 24** | — | **不可测** |

- **Skill 臂**：v6 适用性门禁在全部 24 题上正确弃权（该门禁的正确性已在 v11 验证：放宽它会重新引入 `2811`/`3613` 误召回）。按 `evidence_completeness` 的暴露门，0 送达 = `EFFECT_NOT_ATTRIBUTABLE`。**本轮不把它计入效果结论。**
  - 这说明真正卡住 Skill 的是**资产类型**（只有一条教科书式 procedure，适用范围极窄），而不是门禁阈值。改变这一点属于资产类型工作（把 FAIL 轨迹的护栏/边界知识纳入生成），需要另立协议。
- **Memory 臂**：24/24 全命中，但 top-2 占 45.8%（两条 memory 覆盖近半注入），属于**接近退化**但不违反上限门（≤0.5）。这一事实必须在解读时保留：若 Memory 无效，首先要怀疑的是"注入内容近恒定且逐题摘要不可迁移"，而不是"检索没送到"。

## 4. 设计

| 项 | 冻结值 |
|---|---|
| 臂 | `vanilla`、`memory`（Skill 臂本轮排除，理由见 §3） |
| 题量 | 24（复用 suite 全量） |
| 每臂 trials | 1（配对设计，24 对） |
| 候选 | v8 composite r2，`artifact_hash a3691813dec081caf9cef486d3aef6f10fbdfce2593a09c028c22fc39bf44a7c` |
| 检索算法 | `lexical-idf-v1`（Memory），top_k = 2 |
| runner policy | 继承 v9 起的限制：输出 16384、工具迭代 24、上下文 65536 |
| 隔离 | `/dsh/default/...` + `x-deepseek-harness-compact: 1`，bridge 必须记录 `evaluation_auxiliary`，缺失即 `INFRA_ERROR` |

**主指标（配对，连续）**：`severity = verifier.passed / 套件规模`。套件规模**只由真正全过的 run 定义**（否则会把自己最好的失败成绩当分母，把失败算成满分）。本 suite 中 **19/24 题**满足该条件；其余 5 题（`3603`、`3613`、`abc342_e`、`abc370_d`、`abc380_f` —— 全部从未在任何 root 里全过）严重度未定义，按机械规则排除并单列。
**共同主指标（配对，二值）**：`reward == 1`（覆盖全部 24 题）。

## 5. 功效（已实测噪声）

σ 来自**零送达配对**（干预未送达，差值必为纯噪声）：v4 **0.218**（20 对）、v8 **0.133**（15 对）。

| 指标 | n=19（严重度可用题） | n=24 |
|---|---|---|
| 严重度，σ=0.133（v8 实测） | 8.5pp | **7.6pp** |
| 严重度，σ=0.180（保守中值） | 11.6pp | **10.3pp** |
| 严重度，σ=0.218（v4 实测） | 14.0pp | **12.5pp** |
| 二值 reward（对照） | — | 26.5pp |

**本轮以 σ=0.18 登记：n=19 的 MDE = 11.6pp，二值指标在 n=24 上为 26.5pp。** 另需按 §6 的排除规则折算有效配对数（历史退化率 4–19%）。

## 6. 排除与失败处理（预先声明，不事后挑选）

1. **未判分 run**（`verifier.total == 0`，即 `no_code_extracted`）：严重度无定义，**排除并单列**，不计入任何臂的均值。
2. **`INFRA_ERROR`**：按既有规则保留到 `superseded-attempts/` 并重跑；若最终仍有则整轮状态为 `INFRA_ERROR`，不给效果结论。
3. **退化签名**（单次调用、零工具、输出触顶）：即使不是 `INFRA_ERROR` 也单独计数并报告其占比；若整轮退化率 > 20%，结论降级为探索性并说明。
4. 不使用"最好一轮"或事后删题；所有排除都按上述机械规则。

## 7. 判据（执行前冻结）

| 结论 | 条件 |
|---|---|
| `MEMORY_GAIN_POSITIVE` | 配对严重度均值差 > 0，且 bootstrap 95% CI 下界 > 0，且二值净收益 ≥ 0 |
| `MEMORY_NO_DETECTABLE_GAIN` | 严重度差的 95% CI 包含 0 |
| `MEMORY_HARM` | 严重度差 < 0 且 CI 上界 < 0 |

**预先声明**：`MEMORY_NO_DETECTABLE_GAIN` **不等于**"Memory 无效"。在 n=24 下只有 ≥14.3pp 的效应可被检出；更小的效应与之不可区分。任何"无效"表述必须附上该 MDE。

## 8. 成本与运行时间

24 题 × 2 臂 = **48 个 run**。按历史均值（约 7.4 万 token、约 229s/run）：**约 3.5M token、约 3–4 小时 GPU**（本地自建 vLLM，无 API 费用）。中途若 Docker/服务掉线，harness 会按服务门停止并按 infra 规则重试，进度可续。

## 9. 边界

- 研究性结论，`promotion_allowed = false`；不写入正式资产；不改动任何冻结协议或历史 attempt。
- Skill 臂的 0 送达与 Memory 的近退化集中度必须写进最终报告，不能只报点估计。
- 本轮**不**触碰 `Skill` 资产类型改造、**不**触碰官方 test。
- 冻结本协议（`protocol-code-v13-*`）前需你放行；放行后本轮所有参数不再变动。

## 10. 本轮不建立的结论

- 不建立任何 Skill 效果结论（0 送达）。
- 不建立"Memory 有效/无效"的一般性结论：只测一个冻结候选、一个 suite、一个模型、一种检索算法与 top-2。
- 不建立业务价值：后端仍是本地 SQLite/FTS（`embeddingService: false`），不是云端 TencentDB。
