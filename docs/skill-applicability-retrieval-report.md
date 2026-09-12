# Skill Applicability & Retrieval 离线验证报告

日期：2026-09-12

## 结论

旧 `lexical-idf-v1` 会因为通用词重合而在全部 24 个 development task 中注入唯一 Skill。新增的 `lexical-idf-applicability-v6` 能保留两条真实来源任务，同时在这 24 个未参与生成的任务上全部弃权，包括已确认的 `abc388_e` 错召回。

这证明“适用条件过滤”修复了一个真实检索缺陷，但不证明 Skill 带来能力提升。由于 development 上没有任何 Skill 注入，当前不应花费模型调用重复跑同一套题。

## 实现

- 旧算法仍是默认值，冻结协议可继续复放。
- 新协议可为 Skill arm 显式选择适用性算法。
- Skill profile 包含任务族、使用条件、禁止条件、规模约束、复杂度、证据引用和任务信号。
- 选择顺序为：同句目标/实体信号、任务族、显式规模约束、lexical-IDF。
- 任一硬条件缺失或不匹配时弃权；不再强制 top-k。
- receipt 保存每个 Skill 的选择、拒绝原因和匹配证据。

## 真实离线复放

| 数据 | v1 召回 | v6 召回 | 说明 |
|---|---:|---:|---|
| r3 支持任务 | 2/2 | 2/2 | `3193`、`3446` 均保留 |
| code-v2 development | 24/24 | 0/24 | 24 题均不符合唯一 pair-enumeration Skill |
| `abc388_e` | 1 | 0 | `N <= 5×10^5` 超过 Skill 的 `n <= 100` |
| `2811`、`3613` | 1/2 | 0/2 | 仅偶然出现 pair，不是“对 pair 求最大/最小/计数” |

最终 code-v2 profile artifact：`f5482a9664ee6952b6cb19a754709aa600b7f44f9aec5788611b5fdecc74244b`。

最终 development audit：`2f7b15c781b2212f988e1c5ab96e7a0d7b5f6ea717d1a7e3eb10eef761b5bccd`。

## 保留的失败诊断

- v2：能处理普通数值约束，但任务族过滤不足。
- v3：任务族过滤过严，无法识别组合变量和 `.length`。
- v4：修复约束写法后，仍把偶然出现的 `pair` 当成任务族。
- v5：增加同句目标/实体信号，但不能统一 `count`、`number`、`total`。
- v6：加入目标同义词归一化，得到当前保守结果。

这些只属于离线检索诊断，不是 EvaluationAttempt，不能用于宣称能力提升。

## 下一步

现有 r3 只有一个 pair-enumeration Skill，覆盖面过窄。下一步应从 train-only 轨迹逐条形成局部 patch，再按共同机制和独立证据聚类，生成模块化 Candidate。Candidate 冻结后使用新的、未参与生成的 development revision 评测；不能根据结果修改同一套题。

模型首次调用耗尽 8192 tokens 且没有工具调用的问题不属于检索，应使用对两组完全一致的新 runner-policy 协议单独研究。
