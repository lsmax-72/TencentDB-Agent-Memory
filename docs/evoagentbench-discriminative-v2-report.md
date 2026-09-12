# EvoAgentBench Discriminative Development v2 Report

日期：2026-09-12
状态：**FAIL — 未证明 Memory 或 Skill 带来正向迁移**

## 1. 实验目的

v1 development 的修正结果中 Vanilla 与 Skill r3 均为 12/12，无法证明新增能力。因此本轮保留 v1 作为 regression evidence，新增独立、未污染、难度分层的 development suite，只回答 frozen r3 能否迁移到未参与 refinement 的新任务。

## 2. 冻结边界

- 协议：`tdai-evoagentbench-code-v2-discriminative`
- protocol hash：`fd10899a108751baed606ae293770f813d12c8bd2ecab9ddb1a7d85ca867509d`
- 选题：官方 train 剩余池中固定选择 24 题，12 hard / 8 medium / 4 easy
- Candidate：原 frozen Skill r3，artifact `789d040f5fbaba0b2561e05a9070a9ec2a1d32ed10c786e8a397cbe68fe5e181`
- 模型：`vllm / qwen3.8-27b`，temperature 0，fallback disabled
- 官方 verifier、budget、toolset、top-k 和三组注入路径均未改变
- Candidate 在 Suite freeze 后没有运行前修改，也没有依据结果生成新 revision

完整 4.49 GB source 的 SHA 为 `7ae239c4b25f59e0331b83725ab566a53568ea19d93fcbc5f647bec5caeb55db`；24 题 immutable phase cache artifact 为 `f9c1e870693b0cda04547bc8887cced9e85b355fb2d8f95b68ad327966068441`。

## 3. 真实结果

72 个 arm 全部完成，0 `INFRA_ERROR`。

| Arm | Pass@1 | Newly fixed | Newly broken | Unchanged success | Unchanged failure | Transfer gain | 95% CI | Tokens | Model calls | Tool calls |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| Vanilla | 0.7500 | — | — | — | — | — | — | 1,160,365 | 90 | 68 |
| Memory | 0.7500 | 1 | 1 | 17 | 5 | 0.0000 | [-0.125, 0.125] | 1,263,795 | 93 | 73 |
| Skill r3 | 0.7083 | 0 | 1 | 17 | 6 | -0.0417 | [-0.125, 0] | 1,257,321 | 94 | 73 |

Memory 在 `abc388_e` 将 Vanilla FAIL 改为 PASS，但在 `3223` 将 Vanilla PASS 改为 FAIL，净收益为 0。Skill 没有修复任何题，并在 `3223` 新增回归。

Memory tokens 较 Vanilla 增加 8.91%，Skill 增加 8.36%。两者没有超过 25% 成本上限，但成本合格不能替代效果收益。

## 4. Gate 与 regression evidence

Gate 为 **FAIL**：

- `SKILL_TRANSFER_GAIN_NOT_POSITIVE`
- `NEWLY_FIXED_LT_NEWLY_BROKEN`

旧 v1 corrected Attempt 保持 Skill 12/12、0 newly_broken，说明 r3 在旧 regression suite 未新增回归；新 v2 则提供了独立反证：冻结 Skill 没有迁移收益并出现 1 个新回归。因此不得打开 official test，也不得 Promotion。

## 5. 观察到的机制问题

多个失败 arm 在首轮输出达到 8192 tokens 且没有工具调用，表明模型会在复杂题上把预算消耗在过长推理，而不是尽早写入和验证代码。`3223` 的 Skill 即为这种失败；Memory 则循环到 12 次模型、14 次工具调用仍失败，属于另一种无效探索。

在 `abc388_e`，Skill 检索到了只适合小规模数组的暴力枚举策略，但题目规模为 `N ≤ 5×10^5`。该证据说明当前 lexical retrieval 和资产 trigger 条件无法可靠排除语义相关但约束不适用的 Skill。

这两点是机制诊断，不改变本 Attempt 的官方 verifier 结果，也不说明只需改一句 Skill 就能解决。

## 6. Hub 与历史保留

- 主结果：`discriminative-v2-r3-main`，本地文件保留；首次导入因 Core 只接受 v1 protocol ID 返回 400。
- 实现修复只扩充已知协议 allow-list，不放宽任意 protocol；72 个 arm 未重跑。
- 独立导入重试：`discriminative-v2-r3-implementation-fix-retry-1`
- Hub record：`evo-a0dd67d1-6685-48e5-8a2a-71196186c8b8`
- 两个 Attempt source hash 相同：`8221835721a986757e7a966f142977b7e009c8ecfcd595a4d2402938d3dcf02f`

8125 浏览器已确认 FAIL 状态、24 个 Skill pair、Memory/Skill 指标、三组成本和 evidence limitations 可见。正式资产、历史 v1/v4 结论和 Candidate 均未修改。

## 7. 结论与下一步

更有区分度的真实任务已经跑出效果差异，但差异是：Memory 净收益为零，Skill 为负迁移。当前不能声称自进化有效。

下一研究动作应在 train/development-only 范围内分别验证：

1. 增加资产适用条件过滤，能否避免不匹配 Skill 被注入；
2. 限制首轮无工具的超长推理，能否减少 8192-token 截断。

两者应作为实现机制实验独立版本化，不能修改本轮冻结 Suite/Gate，也不能根据结果挑题。官方 test 继续保持关闭。
