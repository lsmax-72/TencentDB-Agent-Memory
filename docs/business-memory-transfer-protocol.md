# 独立业务 Memory 迁移实验 v1

2026-08-31。用户授权代理自行决定独立测试配置并连续执行。此实验与旧 v4 / Regression / Held-out / Promotion Gate 分开。

## 研究问题与冻结

两个已完成工作任务的真实经验，经现有 MemoryCore L1 提取与跨 session 召回后，能否帮助三个不同的业务任务？不是测试“记得学校”或重新调 Skill。

使用既有 SpreadsheetBench Verified archive，SHA-256 `10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949`，来源 revision `49b73a94775fb489063f60ca1865e3a650079a79`。

| 用途 | ID | 任务维度 |
|---|---|---|
| 经验形成 | 343-20 | 重复记录抽取、排序、保留行对应关系 |
| 经验形成 | 379-36 | 金额条件驱动的文字更新与限定列清理 |
| 迁移 | 23-24 | 名单匹配后仅局部列删除、上移；其余列保留 |
| 迁移 | 477-45 | 多列关联的重复数据合并与汇总 |
| 迁移 | 91-34 | 身份复合键、员工例外约束下的选择性去重 |

选择仅参考公开题面与结构预检，不使用本实验模型输出或 golden 值反向设计；形成集不含迁移集。公式工作簿被预先排除，因为当前确定性 Oracle 不支持重新计算；无限列范围和矛盾排序题未选用。完整排除记录在 JSON 协议中。不是官方完整 benchmark，也不能排除公开数据曾进入模型预训练。

本轮独立预算：8 model calls / 8 tool calls / 4096 output tokens per call / 300 秒；工具每次 20 秒。固定 vllm / qwen3.8-27b / temperature 0 / fallback disabled。旧 smoke 的 6/6/240 不变。

完整 task / 数据 / 协议 / runner / Proxy / Oracle / 纯 Python 依赖在第一个真实 run 前复制并记录 hash，镜像按 immutable ID 记录；Agent 不挂载 reference、凭证或宿主目录。两条件共用 common hash，Memory arm 另有 snapshot/condition hash，不伪造旧 Skill fingerprint 相同。

## 经验形成与 Memory

1. 新隔离实例、测试 Team/Agent/Task，真实执行两项 formation task。
2. 仅题面、真实工具参数/结果、最终答复通过 `/v3/conversation/add` 写测试 L0。参考答案、Oracle 差异值与迁移题不进入输入。
3. 原有 L1 `code` 模式提取器自动运行，最多两次提取模型调用。提取输出不人工改写，不按迁移结果筛选。没有记忆则如实记录失败，不注入预编经验。
4. 全量 L1 API 回读、来源 task 白名单检查、冻结记录和来源 hash。正式评测前检查内容是否含迁移答案；不将路径字符串扫描视为完整无泄漏证明。
5. 迁移期间 Proxy 不捕获 L0、不触发 Skill；形成专用模型入口在 snapshot 存在后拒绝调用。召回只查隔离 team/user/agent，不带形成 task/session 过滤，避免把跨任务历史意外过滤掉。

本轮为 API 层逻辑只读快照：查询真实 SQLite/FTS 后与冻结行逐项比较；并非声称数据库已物理只读挂载。Agent 只有网络关闭的 XLSX 工具，没有 Memory 写工具/凭证。所有迁移 run 后重新审计记录集合和 L0=0；任何漂移使证据无效，不带病继续解释收益。

## 对照与证据

- `NO_HISTORY_MEMORY` 不召回、不注入历史；fresh session/workspace。
- `FROZEN_HISTORY_MEMORY` 每 session 首次查询固定业务词 `spreadsheet Excel openpyxl workbook rows columns`，top-5；后续请求重复同一个缓存块。不是随工具日志不断变动的检索。
- 使用专用业务 Proxy 注入历史块；不修改生产 injector 或旧 `EVALUATION_V1` guard。该研究入口不是生产默认召回策略性能验收。
- 每任务主 run 各一次，顺序交替。记录实际 DB 命中、文本/hash、注入字数、每请求 token usage、实际模型、工具事件、session 和输出工作簿。
- 双方结果不一致或任一调用预算达到 90% 时，各额外两次 Probe；所有主结果保留，不挑最好结果。INFRA_ERROR 不能当 task regression。
- 采用冻结的指定单元格值 Oracle；格式、非目标区域差异另外报告，不借此改写官方值评分。

研究正向信号要求至少一项 newly_fixed、零 newly_broken，三题合计 token / tool / model 成本各不超过无记忆的 1.20 倍；形成和提取成本单列。Probe 只用于说明方向稳定性。即便满足，也只是小样本研究信号，不是 Promotion。

## 操作与恢复

`scripts/business-memory/study.mjs` 提供 `init / formation / snapshot / transfer / probes / audit`；后五步使用 Attempt 内已冻结副本。每个 run 都使用独占写入，遇已有输出拒绝覆盖。先读取 checkpoint 和 `runs/*/result.json` 再恢复，禁止重复跑已完成主结果。

本轮 r1：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r1`，独立端口 20920 / 20696 / 20725 / 20924。历史 r1 smoke、Phase6 r5/r2 和主 8420/8096/8125 不改动。

当前文档是冻结协议说明，实际成绩以独立结果报告为准，不把协议完成当实验完成。

## Producer revision 与失败保留（追加，不覆盖 v1）

- r1：nanobot 外层标准重试导致 actual upstream calls 超过 iteration hook 计数；343-20 超时、成本证据不完整，整体保留 INFRA_ERROR。379-36 PASS，L1 最终有10条；未用于迁移。
- r2：项目侧 `BoundedProvider` 使用 SDK 的公开构造扩展，禁隐式重试、在实际模型调用处计数；SDK源码不修改。343-20 仍超时；379-36 PASS。L1两次生成均达到4096tokens，JSON截断，0条记忆；保留 INFRA_ERROR，不把空快照当作有记忆对照。
- 对 r2 晚到 response 独立核账：形成任务真实 wire 成本72,271tokens /11model calls /8tool calls。原 run 的失败状态不变，不能事后恢复为 TASK_PASS。
- 用33tokens独立格式诊断确认本机实际 vLLM0.19.0支持请求级 `enable_thinking:false` 和 JSON Schema。对应[官方推理配置](https://docs.vllm.ai/en/v0.19.0/features/reasoning_outputs/)与[结构化输出接口](https://docs.vllm.ai/en/v0.19.0/features/structured_outputs/)。这不修改服务器或正式模型默认值。
- r3是 `MEMORY_PRODUCER_REVISION`，不是声称 v1 无变化的 retry。只变形成端输出配置，复用 r2 完整原始形成 trace（含失败）；不重跑形成 Agent，不筛选 trace。原 code-mode prompt/parser、提取模型与4096预算、两次上限不变。实际迁移 Agent 的 thinking/model/temperature/tools/budget 不变。
- 自动提取7条，共18,200tokens /2model calls，正常 stop；全量 snapshot SHA `c4e564dee12df5747eea335edd157399c7d758260648535fe90fbf67d1dea6b1`。所有生成失败计入工程成本，不宣称从第一轮就稳定。
- r3全资产 freeze `f584f655741854e2ff6f5497424f8c183b6c45b64bb9c94957c2fb79d4b1e972`，独立端口22920/22696/22725/22924。首个迁移 run 在上述freeze和来源审计后发生。
- 源审计发现 task-specific 清H列被提取成宽泛 work_method，保留并记录风险，未按预想收益手工修记忆。迁移结果必须结合非目标区域审计解释，不能把历史事实直接当通用 Skill。

因此本实验最多说明“这一个冻结形成 corpus 经 producer-v2 得到的 Memory，在这三个首次运行任务中的条件性效果”。不能宣称形成过程整体稳定或普遍改善，更不构成旧 v4 Promotion 证据。
