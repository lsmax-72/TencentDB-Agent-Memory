# 真实 nanobot 发票对账 smoke 报告

日期：2026-08-31。Attempt：`business-xlsx-20260831-r1`。

## 结论

**真实 nanobot + qwen3.8-27b 已通过独立 Proxy/Core 链路完成 SpreadsheetBench Verified `141-20` 发票对账任务，并由冻结的确定性 Oracle 判定 TASK_PASS。** 这证明所选业务任务可由当前 host 执行，不需要换题；不证明 Memory 带来收益、Skill 自进化有效或云端 TencentDB 已接入。

## 冻结配置与环境

- 用户明确授权独立测试配置由代理自主决定。协议：`business-xlsx-smoke-v1`；`vllm/qwen3.8-27b`、temperature 0、fallback disabled、最多 6 model calls / 6 tool calls、单次输出 4096、总超时 240 秒。
- 新实例：`business-xlsx-20260831-r1-{core,proxy,hub}`；loopback 端口 Core 19920、Proxy 19696、Hub 19725、Knowledge 19924。旧 r5/r2 和正式 8420/8096/8125 未修改。
- Core 是独立本地 SQLite/FTS；capture/extraction/Skill 均关闭。Proxy memory/injection/extraction 均关闭，仅做身份鉴权、模型转发和脱敏请求证据。Hub 仅注册该测试实例和 Task 观测。
- nanobot revision `415df576b46464445121fe1bc68d24cd5b649635`；Agent 只看到输入副本和 `spreadsheet_python`，看不到 golden、宿主配置或正式资产。
- 冻结数据：archive SHA-256 `10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949`；输入 SHA-256 `422af403dcf91bf0e6e0a58d2856dd0f3e6f27245410c00594e3333fd20f02e4`。

## 真实运行结果

| 项目 | 结果 |
|---|---:|
| Agent status | COMPLETED |
| Oracle | TASK_PASS |
| actual model | qwen3.8-27b |
| input tokens | 20,462 |
| output tokens | 2,251 |
| total tokens | 22,713 |
| model calls | 5 |
| tool calls | 4 |
| elapsed | 72,069 ms |
| output SHA-256 | `e58016e6dfb9a220b5fa4242c1933296a3899c5db970cc8c6d9337f94c3b88ce` |

工具行为顺序：检查 workbook/sheets → 检查匹配数据 → 执行组合键匹配和双表删行并保存 → 重新打开输出验证。四次均 SUCCEEDED。完整 code/arguments/result 只留私有 evidence，不导入 Hub 或文档。

Oracle 比较了指定区域 38 个单元格，差异 0；额外全 workbook 值审计也与 golden 完全一致。输入运行前后 hash 一致。输出无公式，因此无需 LibreOffice 重算；结构检查未发现宏或外部 workbook link。

结果文件：[result.xlsx](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-20260831-r1/run/outputs/result.xlsx)。这是实际 Agent 产物，不是手工修改或 unchanged-copy 负例。

## Admission、隔离与 Hub

- 错 user/team/agent/task/session/path 共六类请求全部 403，admission 阶段模型调用 0。
- 实际 5 个 Proxy request 均为 model qwen3.8-27b、temperature 0；5 个 response 均 HTTP 200 且 model 一致。SDK 聚合 usage 与真实响应一致。
- 业务 Core L0=0、Skill assets=0；本次没有写可召回 Memory 或 Skill。Hub Task 可回读，metadata 仅含 status、usage、模型、工具名和 hashes。
- 正式 Core 文件 snapshot 前后完全一致。Core/Proxy/Hub 的高熵 gateway/user/provider key 日志扫描无命中。
- 独立 Hub：`http://127.0.0.1:19725`。本次有效可见内容是 Task/participation 摘要；Memory 空是协议预期，不要求用户去 Memory 页寻找业务结果。

## 保留失败

1. 数据获取：普通 Node/curl/direct IPv4 和 HF 超时；使用 Mac 已配置的本地代理后完成，不改系统网络配置。详见离线报告。
2. 离线负例：unchanged-copy 被 Oracle 判 TASK_FAIL，证明仅生成 XLSX 不会误过；不是 LLM Attempt。
3. 首次 audit 命令：四字符 provider test key 与 Core 日志 `10000` 中的子串偶然匹配，审计误报。证据 `audit-failure-r1.json` 保留；没有真实 key 泄漏。按原 Phase 6 规则仅扫描长度至少 12 的高熵凭证，`IMPLEMENTATION_FIX_RETRY` audit PASS；未重跑或替换主 Agent run。
4. Proxy 日志显示 `CREDIT_REPORT Invalid URL`，尽管 creditReport 被置空；真实模型转发、usage/Oracle/Hub 均不受影响。当前记为 host 日志噪声，不修改产品默认路径，也不声称 credit reporting 通过。

## 测试与证据

- 新测试：18 PASS，包括 5 个真实 Docker sandbox 方法。
- Phase 6 helper：4 PASS。
- `node --check scripts/business-memory/acceptance.mjs`、`git diff --check`：PASS。
- Attempt 根目录：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-20260831-r1`。
- 关键文件：`preflight.json`、`runtime-freeze.json`、`admission.json`、`run/agent-run.json`、`oracle.json`、`safe-observation.json`、`audit-failure-r1.json`、`audit.json`。

## 下一步

保留该任务作为业务 smoke，不把三行小样例用于证明泛化。后续在不使用本次输出选题的前提下，先冻结经验形成/迁移任务与 Memory 快照规则，再做 `NO_HISTORY_MEMORY` vs `FROZEN_HISTORY_MEMORY` 对照；不生成 Candidate v5，不改旧 Suite/Gate。
