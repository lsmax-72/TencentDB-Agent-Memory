# Source-scoped Memory Policy：离线准备报告

2026-08-31。用户要求避开当前 vLLM，并在完成后总结讨论。本轮 **没有探测 endpoint、没有真实模型调用、没有启动新的服务或修改生产路径**。

## 已完成与未完成

- 已完成：独立纯函数 renderer、确定性/负例测试、6个未运行任务的结构预检和Oracle正负控制、独立设计包冻结、r4历史hash核验。
- 未完成：新policy接入真实research Proxy、新Attempt的身份/session/runtime物化和冻结、模型执行及收益判定。当前不是“可直接宣称成功的新系统”，也不把设计freeze冒充EvaluationAttempt。
- 状态：`DESIGN_FROZEN_NOT_EXECUTED / REAL_RUN_DEFERRED_VLLM_AVOIDED`。vLLM是否真的不可达未在本轮验证；仅遵照用户要求避开。

## 为什么做这一步

r4已经证明自动L1可以形成、检索并进入真实Agent上下文，但没有证明收益。只读诊断发现：两个 `work_method` 包含固定源任务列约束；召回的五条内容都在content-only拼接时丢失background。继续调旧Skill或扩大平台不能回答这个问题。

本次先构建一个候选干预：**从“给模型一组旧内容”变成“给模型有来源、受条件限制的历史方法”**。它是待验证假设，不声称能机械判定适用性，也不宣称抽取出的method天然正确。

## 三组条件

| 条件 | 内容 | 本次离线预览 |
|---|---|---|
| NONE | 无历史块 | 0条、0字符 |
| CONTENT_ONLY_V1 | 完全复现r4五条content-only内容 | 5条、665字符；hash与五次历史召回均精确一致 |
| SOURCE_SCOPED_METHODS_V2 | 只呈现有source task/background的work_method；保留来源背景；源任务列/路径/值不自动变成当前指令 | 2条、1,030字符；其余3条排除理由逐条保存 |

renderer不读当前题目、Case ID、Oracle、golden或模型结果；不手工修改任何source memory。v2对存储内容做XML转义以免内容关闭分隔符；缺来源的method显式不注入，不杜撰scope。

**代价**：条目少不等于token少。v2多了来源与边界说明，字符比v1增加365；实际token与行为收益必须等真实模型验证。v2同时改变类型选择与呈现，是组合干预，不能把未来差异归因到其中单个组件。

## 新任务及冻结停止规则

| 角色 | ID | 能力维度 | Oracle目标单元格 |
|---|---|---|---:|
| diagnostic | 28-7 | 带起止标记/空行的区间删除 | 78 |
| diagnostic | 269-43 | 双列条件决定整行删除 | 63 |
| diagnostic | 177-6 | 同键跨行数据合并到目标表 | 144 |
| diagnostic | 250-20 | 复合键分组求和并去重 | 200 |
| reserved confirmation | 109-21 | 分组最大值、并列与单人成员例外 | 39 |
| reserved confirmation | 160-6 | 指定表空行压缩、保护其他区域 | 72 |

每题input/reference都无公式；6次reference自比为PASS，6次原样input控制为FAIL。这只证明Oracle接线/任务确需改动，不是模型得分。原表中的示例/Desired outcome等内容未删改，因此这些公开任务不构成无提示的真实业务全集或模型未见数据。

24-23被原尺寸上限拒绝，66-24需要公式重算；没有扩检查范围或绕过公式限制。146-49/80-42作为结构审查后的未选reserve，不因模型成绩取舍。全部选择发生在新任务第一次模型run之前。

新研究协议 `business-memory-scope-policy-v1` 与旧Skill Gate独立：

1. 先按冻结顺序运行4 diagnostic × 3 arms，共12 runs，各一次。
2. 只有全部可比较、v2不比任何control新增回归、对v1有新增修复或至少10% token节省、且token/tool/model各自不超过两个control的1.2倍时，才执行2 reserved × 3 arms。
3. 不达标即停止真实调用并报告；不补跑挑最好，不执行本revision之外的Probe。
4. 所有arm沿用8model/8tool、每call4096 output tokens、300s whole-run、20s tool，以及qwen3.8-27b/temp0/no fallback。旧r4结果、预算和policy不动。
5. 即使出现暂时正信号，也不是Skill Promotion、生产部署或新增能力的通用证明。

## 冻结与历史

当前包：[business-memory-scope-design-20260831-r2](/Users/lsmax/Coder/phase6-artifacts/outputs/business-memory-scope-design-20260831-r2/offline-freeze.json)。

```text
bundle          04a6541bf1ae14f2a5bdcc780bf01b91a6be65c25400170ad9db3a192628c388
protocol        9405bddf010b400c6480ca1a52ff71cf2801e3f15845329c1804d3189db39f58
renderer        d64ef7eeb4efe3241d6d89d987df53c816a39c3b606dd8aa1864942f0e9c1191
source memory   c4e564dee12df5747eea335edd157399c7d758260648535fe90fbf67d1dea6b1
recall selection 14502366b54df27c9a546a6160122568786f948d0648f7ad4b078acfc73407b9
v1 block        61b7cff7f581ba12f026275548bfe4caad6555a961c3753bdea198bfa94c1ced
v2 block        3d616215b63149bcefe405bb84a7fb0cbe58f4b634632b2d1c791c1837ba23a8
```

r1设计包 `d77845aa384eb930fe8529cb573c2b6418f5400a324e898fa86d9e9c97f087d2`保留。它使用旧preflight默认development角色，与protocol的reserved confirmation标签不一致；r2仅修正调用传入的数据角色并重新freeze，任务/工作簿/Oracle/预算/policy不变。两版均未运行模型，不改写任何历史实验成绩。

## 验证

- Python：31 tests PASS，含真实Docker沙箱与真实SDK+mock provider。
- Node：17 tests PASS（13业务diagnostics/policy + 4 Phase6 helpers）。
- 6组Oracle正负控制通过；旧r4十个result与全部已索引证据hash未变，v1历史块精确复现。
- bundle validate、Node syntax、git diff check通过。
- 不通过联网测试来猜vLLM恢复，不更换model，不读取/输出凭证。

离线恢复命令（不会调用模型）：

```bash
/Users/lsmax/Coder/nanobot/.venv/bin/python scripts/business-memory/prepare_scope_study.py validate /Users/lsmax/Coder/phase6-artifacts/outputs/business-memory-scope-design-20260831-r2
node --test scripts/business-memory/memory-context-policy.test.mjs
```

## 服务恢复后的工程顺序

先完成research Proxy的显式policy dispatch与新runtime/session/identity物化，做mock admission和冻结检查；得到用户恢复模型分支的指示后，再只读检查原provider/model，然后按冻结顺序执行。没有该runtime准入时，不能直接拿设计包冒充可运行Attempt。新policy不得接入默认生产Proxy，也不得覆盖r4。

当前按用户要求暂停在本次离线交付之后，先共同总结/讨论下一研究重点，不自行进入新的真实实验。
