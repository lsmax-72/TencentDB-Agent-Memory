# EvoAgentBench Trace2Skill Generation v2 Report

## 结论

24 题、三组、共 72 个真实 development arm 全部完成，0 `INFRA_ERROR`。冻结 Pilot Gate 的机械结果为 `PASS`，但 Skill 检索覆盖率为 **0%**：24 个 Skill arm 都没有注入 Candidate。因此本轮不能证明 Skill 带来收益，不打开 official test，也不 Promotion。

## 冻结协议与资产

- Suite 沿用未打开过的 v3 development 24 题；题目、官方 verifier、模型、temperature、budget、toolset、Gate 均未修改。
- generation-only protocol：`tdai-evoagentbench-code-v3-suite-generation-v2`，hash `1727f27e8fd248106ba172ac3ac4ce17e0786218bed3b434fe6784a6eb6045f7`。
- 48 条 experience：41 PASS / 7 TASK_FAIL / 0 INFRA_ERROR。
- 48 条 Memory r1：artifact `8d7b87efe775288d42bb0d4e4de68c3ef1bc450d4e7edeb244856d5024815803`。
- exact-key patch clustering 的原 Attempt 得到 0 cluster，完整保留。新的 train-only mutual-best TF-IDF revision 只形成 1 个双证据 cluster。
- Skill r2：1 个“动态 distinct-count 维护”模块，artifact `bfd247aa3eaf6b100ad317d5e3e9b1978cdc5043b586296c9fe4242884ffdb4b`，没有 development/test 特征，`effect_proven=false / promotion_allowed=false`。

## 真实 Development 结果

| Arm | PASS | newly_fixed | newly_broken | transfer gain | 95% CI | tokens | model calls | tool calls | retrieval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vanilla | 19/24 | - | - | - | - | 1,347,344 | 101 | 88 | - |
| Memory | 19/24 | 2 | 2 | 0 | [-0.1667, 0.1667] | 1,292,776 (-4.05%) | 93 | 79 | 100% |
| Skill | 21/24 | 2 | 0 | 0.0833 | [0, 0.2083] | 1,393,360 (+3.42%) | 106 | 91 | **0%** |

Attempt `trace2skill-semantic-v2-r2-main` 已只读导入 8125，record `evo-4087e37a-7f36-4475-8810-5f5e187b42e2`，artifact `1faa4373684398604ff14d33e970d6ea295ae2778567f2fe23a2952c9fbae0fb`。

## 为什么不能宣称 Skill 有效

Skill arm 保留了 frozen Candidate revision/hash，但适用性检索对 24 题全部正确弃权，实际上下文没有 Skill 内容。两道 `newly_fixed` 只能说明 fresh session 下仍有模型运行差异，不能归因于 Candidate。冻结 Gate 没有把“treatment exposure > 0”作为条件，所以其 `PASS` 是机械结果，不是可信的效果结论。

这不是通过改报告把 PASS 改成 FAIL：历史 Attempt 继续保留 `PASS`。研究结论单独标记为 `EFFECT_NOT_ATTRIBUTABLE`。若要继续，需要版本化 Evaluation Protocol，使 held-out improvement tasks 对已生成能力具有非零、候选盲的覆盖，或把最小 retrieval exposure 纳入证据充分性条件；两者都会改变已冻结协议，需 Critical Review。

## 隔离与实现修复

- 正式 Skill / Memory / Wiki / Code Graph 数量前后完全一致（1 / 1 / 0 / 0）。
- Candidate 未进入正式资产或生产检索路径。
- Skill 检索弃权的 trace 首次导入被 Core 错误拒绝；实现已修复为“evolved arm 可零命中，但必须绑定 Candidate revision/hash”，原模型 run 未重跑，历史证据未覆盖。
- 主 Core runtime 更新为 `/Users/lsmax/Coder/phase6-artifacts/runtime/memoryhub-main-20260913-r9`，旧 `tdai-memory-core-pre-r9` 保留。

## 验证

- EvoAgentBench Python：50 tests PASS。
- MemoryCore benchmark ingest：5 tests PASS。
- MemoryCore plugin build：PASS。
- Protocol v4 freeze check、candidate contamination check、`git diff --check`：PASS。
- 8125、8420、8096：healthy。
