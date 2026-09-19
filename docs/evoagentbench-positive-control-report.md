# EvoAgentBench 正对照报告：投递链路对干预有响应

日期：2026-09-14。协议：`tdai-evoagentbench-code-v12-positive-control`（`protocol_hash 0776c1711f5e5dff43d428eab12188a628f069292f17fe63e01767bf7757190a`）。状态：**RESPONSIVE**。

## 1. 结论

在锚点任务 `3763` 上，把一个**已用官方判分器在本地验证过必定有效**的资产无条件注入后：

| 臂 | 通过 | 判分器结果 | 注入 |
|---|---:|---|---|
| vanilla | **0 / 5** | 全部 `1/2` | 无 |
| forced | **5 / 5** | 全部 **`42/42`** | 5/5 送达 |

冻结判据（`forced ≥3 且比 vanilla 多 ≥2 且 vanilla ≤1 且无 infra`）全部满足，正式判决
`RESPONSIVE` / `FORCED_INJECTION_CHANGED_OUTCOMES`，`forced_runs_without_injection = 0`。

**回答的问题**：这套「检索 → 注入 → agent 上下文 → 工具循环 → 官方判分」的链路**能够**让一条干预改变任务结果。此前所有 attempt 观察到的"无效果"，因此不是"机制不可能生效"，而是那些实验本身失效（送达率 0–6%、题目无余地、对照组被污染、资产不可判定）。

**没有回答的问题**：这不证明任何**自动生成**的技能/记忆有迁移价值，也不构成 Promotion 依据。它只证明投递链路可用，从而让后续的效果实验**可归因**。

## 2. 走到这里的路径（每一步都在否定上一步的假设）

| 步骤 | 协议 | 结果 | 学到的 |
|---|---|---|---|
| v9 | 锚点 `3000` | `ANCHOR_UNRELIABLE`（vanilla 3/5 通过） | 锚点必须由筛查产生，不能凭单次证据挑 |
| v10 | vanilla-only 筛查 4 个候选 | `recommended_anchor = 3763`（vanilla 5/5 失败、真实尝试、0 infra） | `abc333_d` 在 v9 策略下竟 5/5 通过；策略改动会改变难度 |
| v11 | 锚点 `3763` + 手写"边界/精度"资产 | `NOT_RESPONSIVE`（两臂各 0/5，全部 `1/2`） | 投递已证实（文本进入 prompt、提交代码改变），但仍无效果 → 资产不 decisive |
| 本地重判 | `regrade_session` | 发现判分器要求**打印值恰为 5 位小数**的字面量 | 定位到唯一缺失的规则 |
| v12 | 同一锚点 + "返回四舍五入到 5 位小数"资产 | **`RESPONSIVE`** | 机制可用 |

v11 的 `NOT_RESPONSIVE` 与 v12 的 `RESPONSIVE` 只差**资产内容**，其余全部冻结不变。这正是正对照应有的判别力：资产决定性由本地重判保证，因此 v12 的失败才可能归因于投递。

## 3. 关键机制发现：判分器比较打印字符串，且首次失败即停止

用官方判分器重判一份**数学上正确**的解：

```text
输入:     [[[0, 0, 2], [1, 1, 1]]]          (题面 Example 2)
期望:     "1.16667"
实际输出: "1.1666666666666667"              (精确值 7/6)
判定:     Wrong Answer
```

题面写"误差 1e-5 以内接受"，但判分实际比较**打印表示的 5 位小数字面量**。因此任何返回精确浮点数的解都必然失败。

同一份**模型自己写的**提交：

| 提交 | 结果 |
|---|---|
| 原样 | `passed=1`（在格式用例上停止） |
| 仅把返回值改为 `round(value, 5)` | **`passed=42, total=42`** |

两条推论：

1. 锚点 `3763` 唯一缺失的规则就是"返回 5 位小数"；该规则**单独**即可把 1 个通过变成 42 个全通过（决定性由构造保证，已本地验证）。
2. **判分器首次失败即短路**：历史记录中的 `passed/total`（如 `7/8`、`1/2`）不是"N 个用例错 k 个"，而是"在第 k 个用例上停止，后续未执行"。所有基于 `passed/total` 的历史解读与样本量推算都必须照此重新校准（见 `docs/evoagentbench-power-preregistration.md`）。

## 4. 对后续阶段的含义

- **资产质量是当前真正的瓶颈**，而不是检索算法或门禁阈值。v6 的严格弃权在 v11 中被证明是**正确行为**（放宽它只会重新引入 `2811`/`3613` 那类误召回），而 v12 说明：只有当资产本身携带任务确实缺失的规则时，注入才产生效果。
- **效果实验现在具备可归因性**：投递已验证，因此后续任何 `NOT_RESPONSIVE` 结果都可以诚实地归因于资产而非链路。
- **样本量预算**需按 §3 第 2 点重算：短路行为会系统性低估 `passed/total` 的信息量，也让"一次失败"的含义比原先假设的更严重。
- 运行策略（v9 起的 `max_output_tokens_per_call=16384`、`max_tool_iterations=24`）在本轮中被证明必要：v11 曾出现 17 次工具调用的 run，在旧的 12 次上限下会被直接截断。

## 5. 复现方式

```bash
# 冻结候选与协议
python3 -m scripts.evoagentbench.positive_control --anchor 3763-rounding \
  --root <new-root> --protocol-out scripts/evoagentbench/protocol-code-v12-positive-control.json
TDAI_EVO_PROTOCOL_FILE=$PWD/scripts/evoagentbench/protocol-code-v12-positive-control.json \
  python3 -m scripts.evoagentbench.driver setup --root <new-root>
python3 -m scripts.evoagentbench.positive_control --anchor 3763-rounding --root <new-root> --candidate-only
TDAI_EVO_PROTOCOL_FILE=... python3 -m scripts.evoagentbench.subset_cache --root <new-root> --phase development
TDAI_EVO_PROTOCOL_FILE=... python3 -m scripts.evoagentbench.positive_control \
  --anchor 3763-rounding --root <new-root> --run --trials 5
# 仅按已有证据重判（不再花钱）
TDAI_EVO_PROTOCOL_FILE=... python3 -m scripts.evoagentbench.positive_control \
  --anchor 3763-rounding --root <new-root> --run --trials 5 --score-only --verdict-id a2
# 本地用官方判分器复验资产决定性
TDAI_EVO_PROTOCOL_FILE=... python3 -m scripts.evoagentbench.regrade_session --run-dir <run-dir>
```

产物：`<root>/positive-control-verdict.json`（首轮，含 infra）、`positive-control-verdict-a2.json`（干净正式判决）。

## 6. 边界

- 研究性结论，`promotion_allowed = false`；未写入任何正式资产，未改动任何冻结协议或历史 attempt。
- 本报告不宣称自动生成的技能/记忆具备迁移价值；它只宣称投递链路对干预有响应。
- v11 的两条 infra trial 与 v12 首轮的两条 infra trial 均**保留**在各自的 `superseded-attempts/`，未删除、未改判。
