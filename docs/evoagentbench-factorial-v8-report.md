# EvoAgentBench 四组实验 v8 收尾报告

## 结论

`factorial-frozen-composite-r2-main` 的历史结果继续保持 `FAIL (SKILL_TRANSFER_GAIN_NOT_POSITIVE)`，但本次审计发现正式 Skill/Memory 可能经 MemoryProxy 注入所有 arm，因此该 Attempt 不能再用于归因 Candidate 效果。它不会被删除、覆盖、解释为 PASS 或用于 Promotion，也不会立即完整重跑。

## 原主实验

- 协议：`tdai-evoagentbench-code-v5-factorial-frozen-composite-v1`
- protocol hash：`f03469049f6114cc85d902ad34c893d0494f6e9c1f1b4738afdf957b95bef755`
- Candidate revision：`2`
- Candidate hash：`a3691813dec081caf9cef486d3aef6f10fbdfce2593a09c028c22fc39bf44a7c`
- Attempt：`/Users/lsmax/Coder/evoagentbench-artifacts/code-v8-factorial-composite/attempts/factorial-frozen-composite-r2-main.json`

| Arm | PASS | newly fixed | newly broken | Tokens | Model calls | Tool calls |
|---|---:|---:|---:|---:|---:|---:|
| Vanilla | 12/12 | — | — | 944,116 | 70 | 63 |
| Memory | 10/12 | 0 | 2 | 729,418 | 53 | 44 |
| Skill | 12/12 | 0 | 0 | 874,307 | 66 | 62 |
| Memory + Skill | 10/12 | 0 | 2 | 788,622 | 57 | 53 |

Candidate Skill 的实际检索覆盖只有 `1/12`，Memory 为 `12/12`。即使不考虑隔离缺陷，Skill 也没有产生新增修复，Memory 及组合组均出现两项回归。

## Stability Probe

主 Attempt 之外的 24 次诊断运行已保留。校正后的只读派生报告位于：

`/Users/lsmax/Coder/evoagentbench-artifacts/code-v8-factorial-composite/probes/factorial-frozen-composite-r2-stability-1-implementation-fix.json`

- artifact hash：`21973a6916ba2d7c3880bc872c108c3593593c2dd3d1afe4afed171a3b4ba8ee`
- 只从 run ID 恢复 outer trial 编号，共校正 24 个标签；没有改写任何原 evidence，也没有重新调用模型。
- 相同题目、相同显式注入内容仍出现明显不同结果；部分所谓 Skill 组实际没有检索到 Candidate，因此不能把波动归因于 Skill。
- Probe 成本为 1,960,359 tokens、136 model calls、120 tool calls。它证明继续用重复运行碰运气的投入产出很差。

## 归因污染

Benchmark Team/Agent 本身已有正式 Skill `competitive-programming-verification` 和正式 Chat Memory。旧 bridge 请求使用 `/proxy/default/...`，被 Proxy 识别为普通主请求；主实验 48 个 arm 中至少 30 个 session 明确出现该正式 Skill 名称，其中 Vanilla 为 7/12。因而旧 Vanilla 不是严格的“无资产”对照组。

修复采用现有 Proxy 能力，不新增旁路：

- bridge 改走 `/dsh/default/v1/chat/completions`；
- 每次请求带现有 `x-deepseek-harness-compact: 1`，由 dsh adapter 分类为 `auxiliary`；
- auxiliary 继续经过真实 Proxy/provider 并记录 usage，但跳过 session-init、正式 Memory/Skill 注入及 L0/Skill 写入；
- bridge event 和 trial evidence 必须记录 `evaluation_auxiliary`，缺失即 `INFRA_ERROR`；
- development 主报告只接纳明确的 trial 1，Stability Probe 不再混入主 Attempt。

## 决策

不为 v8 再花费一次 48-arm 重跑。下一次任何真实 benchmark 调用前，先用一个 smoke 证明隔离标记、实际注入资产和正式资产快照均符合预期。旧结果仅保留为失败和接入缺陷证据。
