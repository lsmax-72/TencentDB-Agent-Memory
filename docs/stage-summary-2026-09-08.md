# TencentDB Agent Memory 阶段总结

日期：2026-09-08
仓库：`/Users/lsmax/Coder/TencentDB-Agent-Memory`
分支：`feat/evolution-candidate-refinement`
Codex 接入前 HEAD：`b6fcd2a`

## 1. 阶段结论

项目已经完成本地 standalone 范围内的 Agent 自进化治理底座：真实 nanobot 任务可以经过 MemoryProxy 和 MemoryCore，Skill、Memory、Wiki 可以进入隔离候选、校验、评测、审查和采用流程，相关记录可以在现有 8125 MemoryHub 中查看。

但当前不能宣称“自进化已经让 Agent 稳定变强”。真实 Skill 和 Memory 对照实验没有取得可接受的正向结果；主环境自动化仍关闭。Codex 日常任务已完成 capture-only 接入，但尚未积累足够真实数据，也未启用召回或自动复盘。

因此，当前状态应准确描述为：

> 工程底座已经完成并在本机交付；真实使用闭环和可迁移收益仍待验证。

## 2. 已完成的工程主线

| 阶段 | 已完成内容 | 当前结论 |
|---|---|---|
| Phase 0–4 | 能力审计、Candidate 隔离、artifact/hash、Evaluation contracts、Oracle、Pair、成本和 Gate | 评测与隔离机制成立 |
| Phase 5A–5B | 真实 nanobot + 真实 LLM 的 Baseline/Candidate 对照、Candidate v1–v4、Probe | v4 不具备 Promotion 资格 |
| Held-out Evaluation | 独立 8 题、Suite 版本化、冻结与稳定性 Probe | 没有新增修复，存在稳定回归 |
| Phase 6 | nanobot → MemoryProxy → MemoryCore、本地存储、鉴权、重启和 Evaluation 隔离 | 本地链路验收通过 |
| MemoryHub 自进化 | Skill/Memory/Wiki 统一治理和六个原生页面 | 本机 8125 已交付 |
| Codex 观测 | 用户级 Hooks、脱敏、幂等、离线 outbox、主 Hub 运行轨迹 | capture-only 已接通 |
| 真实业务实验 | SpreadsheetBench XLSX smoke、Memory 形成/召回/迁移对照 | 链路可用，但没有证明 Memory 带来净收益 |

## 3. MemoryHub 当前具备的能力

8125 MemoryHub 已沿用 TencentDB / Tea 原界面，增加：

- 进化概览；
- 运行轨迹；
- 诊断与经验；
- 候选资产；
- 评测中心；
- 人工审查。

后端已经实现：

- `skill | memory | wiki` 统一候选封装；
- 来源、目标、base version、diff、hash 和 revision 追踪；
- 冻结候选不可原地修改；
- Team、Agent、源资产和派生证据 ACL；
- token、model call 和 candidate 数量预算预留；
- 明确 `host_task_complete` 信号、幂等上报和冲突拒绝；
- Memory L1/L2/L3 顺序生成和治理；
- Wiki shadow 生成、冻结内容校验和原文采用；
- Skill Baseline/Candidate 评测任务；
- 审批、采用意图、readback、重启恢复和双击幂等；
- 历史 Attempt 只读导入，不覆盖失败结果；
- Code Graph 沿用原实现，不参与自进化。

主 8125 保留了原 `default-team`、Chat Memory 和已有资产，并增加 `自进化历史 / TEST ONLY` Team 展示 v4 历史证据。

## 4. 真实实验结果

### 4.1 Skill 演进

- Candidate v2 相比 v1：tokens 降低 27.16%，tool calls 减少 15，model calls 减少 8，但仍有回归。
- Candidate v4 在旧 AC-01～AC-05 上全部 PASS，但没有 `newly_fixed`，原 Gate 结论保持 `FAIL / NO_NEW_FIX`。
- Held-out 主评测没有 `newly_fixed`，HO-08 Probe 出现稳定 Candidate 回归。
- Candidate v4 未 Promotion，也没有继续生成 v5。

这说明旧 5 题已经更适合作为 Regression Suite，不能再用“全部通过”证明新增能力。

### 4.2 真实 nanobot 业务 Smoke

nanobot 使用 `qwen3.8-27b` 完成 SpreadsheetBench Verified `141-20` 发票对账：

| 指标 | 结果 |
|---|---:|
| Oracle | `TASK_PASS` |
| total tokens | 22,713 |
| model calls | 5 |
| tool calls | 4 |
| elapsed | 72,069 ms |

输出工作簿与冻结参考的指定区域和全 workbook 值一致。这证明 nanobot 能完成所选真实业务任务，但不证明 Memory 或 Skill 带来提升。

### 4.3 Memory 迁移实验

真实任务形成 7 条 L1，随后在三组新任务中进行无 Memory / 冻结 Memory 对照：

| 分类 | 数量 |
|---|---:|
| newly_fixed | 0 |
| newly_broken | 1 |
| unchanged_success | 1 |
| incomparable | 1 |

主实验中 Memory arm 相比无 Memory：

- tokens 增加约 51.44%；
- model calls 增加 25%；
- tool calls 增加约 41.67%。

部分输出文件虽然正确，但 Agent 因额外探索、重复验证或预算耗尽没有正常结束。当前结果为负向或不可归因，不能包装成 Memory 收益。

## 5. 已验证的可靠性边界

隔离实例已经验证：

- 重复 task-complete 不重复生成；
- 错误 key、跨 Team/Agent/Session 请求被拒绝；
- Evaluation 不写正式 L0、Skill 或 Candidate；
- Candidate 不进入正式检索路径；
- 超预算或候选失败不退回旧正式写入口；
- Wiki 采用阶段不重新调用模型；
- base version/hash 变化会阻止过期采用；
- 服务重启后 adoption receipt 和正式内容可读；
- 历史 v4 FAIL 及失败 Attempt 保持不变。

历史完整验证结果：Core 166 tests / 37 files、Panel 3 tests、Knowledge 11 tests / 4 files，以及隔离 r12 full/restart E2E 均 PASS。以上是 2026-09-01 的冻结验收结果，本总结没有在 2026-09-08 重跑全套测试。

## 6. 当前运行与 Git 状态

2026-09-08 Codex 接入后检查结果：

- `tdai-memory-core`：healthy；
- `tdai-memory-hub`：healthy；
- `http://localhost:8125` 可访问；
- Core `8420/health` 返回正常；
- 主环境 `EVOLUTION_AUTOMATION_ADMITTED=0`；
- 没有启用治理 profile、真实 reviewer/evaluator binding 或 adoption。
- 用户级 Codex Hooks 已指向主 8125；真实 Codex smoke 已在 `Codex Observation` Team 形成 `OBSERVED` trace。

工作区还有 3 个未提交的本地部署辅助变更：

- `deploy/global-images/start-memory-core.sh` 的一处日志变量格式修正；
- `deploy/global-images/configure-nanobot-memory-default.sh`；
- `deploy/global-images/run-nanobot-with-memory.sh`。

这些变更没有混入已验收提交，也没有 push。

## 7. 当前仍未完成

1. Codex 接入刚完成，尚未积累 10–20 个真实日常任务用于数据质量分析。
2. nanobot 真实实验数据尚未形成主 8125 的持续数据源。
3. 主环境真实复盘模型和 Skill evaluator 尚未配置。
4. 真实自动闭环仍关闭，没有实际 Candidate 自动生成或采用。
5. 尚无稳定、可迁移且无新增回归的 Skill/Memory 收益证据。
6. 尚未验收云端 TencentDB；当前结论仅适用于本地 SQLite/FTS standalone。
7. 未执行正式 Skill Promotion、生产部署、push、PR 或 merge。

当前已有两条 Codex 接入验证记录。后续新开的 Codex 会话结束 turn 后会继续增加 `OBSERVED` 轨迹；这些记录不是 `host_task_complete`，不会自动生成候选。

## 8. 下一阶段建议

下一阶段建议定义为：

> Phase 7 — Codex Real Usage Observation + Nanobot Controlled Evaluation

按以下顺序推进：

1. 连续收集约 10–20 个真实 Codex 开发任务，检查脱敏、权限和数据质量。
2. 补充 Codex 明确的 task-complete 语义；在此之前只把 `Stop` 当作回合观测。
3. 只启用诊断，区分工程故障、一次性经验、Memory、Skill 和 Wiki 机会。
4. 从真实轨迹中抽象少量可复现任务，交给 nanobot 在固定模型、工具、预算和 workspace 下进行对照实验。
5. 只有出现稳定正向证据后，再讨论有限启用 Memory 自动采用；Skill 继续要求评测和人工 Promotion。

Codex 适合作为真实日常数据源，nanobot 适合作为可冻结变量的实验执行器。两者配合比只选择其中一个更符合当前项目目标。

## 9. 相关证据

- [MemoryHub 自进化验收报告](memoryhub-evolution-acceptance-report.md)
- [MemoryHub 实现记录](memoryhub-evolution-implementation.md)
- [Phase 6 集成验收](phase6-integration-acceptance-report.md)
- [Phase 6 鉴权与重启验收](phase6-security-restart-acceptance-report.md)
- [真实 XLSX Smoke](business-xlsx-smoke-report.md)
- [Memory 迁移实验](business-memory-transfer-report.md)
- [项目状态讨论稿](project-state-and-discussion.md)
- [Codex 全局观测接入报告](codex-observation-integration-report.md)
- [恢复 Checkpoint](../PHASE_CHECKPOINT.md)
