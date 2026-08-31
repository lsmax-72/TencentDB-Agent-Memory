# TencentDB Agent Memory：到目前为止做了什么

整理于2026-08-31，依据现有代码/checkpoint和实际报告；本轮未重跑历史实验，也未检查vLLM在线状态。

## 一句话

**我们已经把“可隔离、可评测、可追溯的Agent记忆/Skill实验底座”做出来并跑过真实任务；但还没有证明一个可以放心推广的、稳定的自进化收益。**

## 工作主线与真实结论

| 主线 | 已经做到 | 结论边界 |
|---|---|---|
| Phase0–4设计与MVP | Candidate隔离、artifact/hash、fresh session/workspace、deterministic Oracle、Pair/成本/Gate、模拟验收 | 评测与控制机制成立，不是实际Agent能力变强 |
| Phase5A–5B真实Skill评测 | nanobot+真实LLM；v1→v2→v3→v4的Diagnosis、冻结、复评及Probe | v2比v1成本下降27.16%，但仍有回归；v4旧suite全PASS也只能FAIL(NO_NEW_FIX) |
| Held-out / discriminative | 独立8题、版本化修复、不覆盖无效Attempt；真实主评测和Probe | 无主newly_fixed，HO-08出现稳定回归；v4仍不能Promotion，不生成v5 |
| Phase6本地底座 | nanobot→Proxy→Core→本地SQLite/FTS；CRUD/检索、鉴权、重启、Evaluation隔离、Hub API | 本地链路通过，不等于云TencentDB通过；主Hub未自动被接入测试数据 |
| 真实表格业务smoke | 在受限Docker内执行openpyxl，输出真实发票对账XLSX，Oracle通过 | 证明nanobot能做这个业务，不证明Memory有收益 |
| 自动Memory迁移 | 真实形成trace→Core自动L1→冻结快照→跨任务检索/注入→三对实验与四次Probe | 自动记忆确实可用，但本轮没有可接受收益；主研究INFRA_ERROR，成本和执行波动上升 |
| 当前离线分支 | source-scoped renderer、负例测试、4诊断+2预留确认新任务、协议与数据freeze | 零模型调用；仅设计/离线准备完成，效果未知，尚未接入新真实runtime |

## 我们实际发现了什么

1. **正确文件不等于Agent成功完成。** Agent可能已经得到正确结果，却在额外探索、重复验证或自身错误断言中耗尽预算。
2. **temperature=0不等于完全确定。** Probe能发现执行路径波动，不能靠挑一次成功证明改进。
3. **记住事实不等于学会方法。** 自动L1可能把某次任务的“清空H列”写成通用work_method；跨任务使用还需要来源和适用条件。
4. **更多上下文不必然更好。** r4主实验有记忆tokens增加约51.44%，没有newly_fixed；新scope-aware文本甚至比旧块更长，是否值得必须实测。
5. **好评测会给出否定结论。** 保留FAIL/INFRA、冻结协议、独立retry、核对真实tool/usage，是防止“自进化看起来成功”的必要能力，而不是多余流程。

## 现在拥有的工程资产

- 一套可复用的framework-neutral Evaluation与nanobot窄adapter。
- Candidate与正式Skill/Memory隔离、不可覆盖Attempt与hash追溯。
- 本地Proxy/Core/Hub集成及安全/重启验收脚本。
- 真实表格工具沙箱、二进制fixture/Oracle、模型与工具证据collector。
- 费用核账、source scope诊断及明确区分“设计完成/链路通过/收益成立”的报告。

## 仍然没有做到的事

- 稳定、可迁移且无新增回归的Skill/Memory收益证据。
- 云端TencentDB真实链路验收与正式生产部署。
- 自动Promotion、自动生产闭环、大型Evolution平台；这些本来就没有授权执行。
- 当前新policy的真实三组对照；vLLM本轮被明确避开。

## 接下来值得讨论什么

我的建议是暂不扩平台，把研究问题收窄为：**经验如何从一次性事实变成有来源、可判断适用范围的行为指导，并在新任务上证明净收益？**

可以先讨论三点：

1. 项目近期主要交付是“工程底座可信接通”，还是“自进化方法的实验结论”？前者已积累较完整资产，后者仍需一个清晰可证伪的机制。
2. 下一轮scope policy是安全/效率改进实验，不是新增能力实验；是否把“降低错误迁移和无效探索”作为近期主问题。
3. 在模型服务恢复前，是否先完善证据故事和系统边界；恢复后再做已经冻结的小实验，而不是继续加更多组件。

这段经历最值得掌握的Agent工程能力是：把任务结果、host行为、记忆来源、预算和实验归因拆开验证。它能支撑KnowHub这类真实项目与后续研究，而不只是包装一条“自动进化”演示链。

详细证据：[Skill refinement](../MemoryCore/scripts/evolution/refinement/REPORT.md)、[Held-out](../MemoryCore/scripts/evolution/heldout/REPORT.md)、[本地集成](phase6-integration-acceptance-report.md)、[安全重启](phase6-security-restart-acceptance-report.md)、[表格smoke](business-xlsx-smoke-report.md)、[Memory迁移](business-memory-transfer-report.md)、[当前离线准备](business-memory-scope-policy-offline.md)。
