# 真实表格业务：Memory 迁移对照报告

日期：2026-08-31。状态：**COMPLETE_WITH_NEGATIVE_OR_INCONCLUSIVE_OUTCOME**；6个主run、4个Probe、完整费用与隔离审计已完成。研究对象是历史业务 Memory，不是 Candidate v4，也不是旧 Skill Evaluation。

## 1. 当前结论

真实 nanobot → 独立 MemoryProxy → 本地 MemoryCore 的经验提取、跨任务召回、上下文注入和 XLSX 交付均取得实际证据，**没有证明本次历史 Memory 带来了可接受的业务收益**。主实验三对中，1 对不可比较、1 对双方成功、1 对有记忆预算失败；研究主状态 **INFRA_ERROR**，隔离/证据后审计 **PASS**。两者不是同一个结论，不能将正确工作簿、Probe 成功或晚到 usage 用来改写主实验结果。

这是一项三题小规模迁移实验，不是官方 Benchmark 分数、模型未见测试、云端 TencentDB 验收或 Promotion 证据。旧 v4 FAIL 保持不变。

## 2. 协议与数据冻结

- 协议：[business-memory-transfer-v1](../scripts/business-memory/protocol-transfer-v1.json)，SHA-256 `3694ed9294f82ffcc92a9864de44600bbbe7c9ffd11cf981641d2075124b6d8b`。
- 数据：SpreadsheetBench Verified，来源 revision `49b73a94775fb489063f60ca1865e3a650079a79`，archive SHA `10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949`。选题依据是任务正文与输入结构，不用模型输出/参考答案挑题；公式/范围不支持的排除发生在运行前。来源和许可见[预检/执行说明](../scripts/business-memory/README.md)。
- 形成集：343-20（重复引用提取、排序与对齐）、379-36（条件税务文本清理）。迁移集：23-24（局部列删除压缩）、477-45（复合键合并求和）、91-34（保留 Employee 例外的人员去重）。不是旧 AC 换文件名，也不生成 Skill 候选。
- Agent：真实 nanobot revision `415df576b46464445121fe1bc68d24cd5b649635`，Python 3.13.11；vllm / qwen3.8-27b，temperature 0，fallback disabled。
- 两 arm 相同：8 次实际模型调用、8 次工具调用、每次最多4096 output tokens、整次300s。工具仅 `spreadsheet_python`，20s/次、无网络 Docker，输入只读；golden/评分器/凭证不挂载到工具。
- 唯一干预：是否在用户任务前附加从固定 L1 快照召回的历史块。固定 query、top5、每 session 检索一次并缓存；新 session/匿名 workspace，不共享历史。业务 research Proxy 与原 `EVALUATION_V1` 入口分开，原隔离保护未解除。
- 判分：冻结 workbook Oracle 指定区域值比较；全 workbook 值比较单列，格式不属于该 Oracle。预算耗尽仍失败，不因文件正确就自动完成。
- 主实验每 arm 一次。有效 pair 不一致或调用预算达到90%才增加两次/arm Probe，Probe 不替换主结果；不对 INFRA pair 挑选性补跑。

## 3. Attempt 与修复历史（全部保留）

目录统一在 `/Users/lsmax/Coder/phase6-artifacts/outputs/`。

| Attempt | 真实情况 | 处理与可用范围 |
|---|---|---|
| business-xlsx-memory-20260831-r1 | 343-20 超时；SDK 外层隐式 retry 导致原计数不完整；379-36成功；自动形成10条 L1 | INFRA_ERROR 保留；未做迁移。项目侧 BoundedProvider 禁隐藏 retry、按真实调用计数 |
| r2 | 343-20仍超时；379-36成功；两次 L1 输出均4096 tokens 截断，0条记忆 | INFRA_ERROR 保留；不人工补写。晚到 wire usage 只用于核账 |
| r3 | 形成端独立 producer-v2 重用 r2 全部 trace（含失败），自动提取7条；迁移首次发现 workspace 名称把 arm 标签带入 SDK system prompt | MEMORY_PRODUCER_REVISION；该次迁移 INVALID_FAIRNESS 保留，停止后续调度。已通过/中断样本均不用于收益推断 |
| r4 | 只修匿名 workspace 与完整请求上下文采集，复用同一7条 Memory；重新运行三对及预定 Probe | IMPLEMENTATION_FIX_RETRY；这是本报告主实验。没有扩预算/换模型/换题/重抽记忆 |

冻结 bundle hashes：

```text
r1 d0cf9c0ba4afac27ed68dcbd642642a527550dcd0b3145bfb798b7563f72f913
r2 8d5aae5b64a1fe4dbf0bb27e2fad1f23b21959e958d2a4ae60a96000f0ab6007
r3 f584f655741854e2ff6f5497424f8c183b6c45b64bb9c94957c2fb79d4b1e972
r4 1fd417412dc56a378124b6a32be17fbc9c93dda3cd1abf94d18bbfcfdeac02a3
```

producer-v2 只给 Core 的独立提取请求增加 non-thinking 和 JSON Schema，原任务 Agent 的生成配置不变。修正有一次33-token独立格式诊断支持，不把诊断算业务成绩；不冒充原 producer-v1 已成功。

## 4. Memory 形成与召回质量

- 7条 L1 来自真实形成任务的题面、工具结果、最终输出；不是手工编写的方法库，没有注入迁移题/golden/旧 Evaluation 的答案。
- 快照 SHA `c4e564dee12df5747eea335edd157399c7d758260648535fe90fbf67d1dea6b1`；r3→r4原字节不变。
- 实际命中5条，历史块 SHA `61b7cff7f581ba12f026275548bfe4caad6555a961c3753bdea198bfa94c1ced`。无记忆 arm 不检索、不注入；有记忆 arm 每次模型请求复用相同块。
- **质量缺口**：抽取器把某次税务任务的“清空 H 列”概括成 Excel 清洗方法；另有重复提取任务的固定列/排序约束、旧交付事实。它们可以记录来源任务，但不能自动视为适用于新表格的通用经验。
- 此风险在 r3 迁移前已记录，快照未手工修订。当前框架明确提示“历史观察、仅相关时使用、当前任务优先”，但仍由模型判断适用性。
- 只读源码核查：Core 的 code-mode prompt 已区分工作事实/任务/方法并建议 scope；实际返回字段包含 background，但本次窄 research Proxy 只拼接 content，丢掉了可见背景。这是一个待验证的形成/选择/呈现边界假设，**不是已经证明某条记忆导致回归**。
- 迄今已完成的工作簿未出现按历史指令清空迁移任务 H 列的值污染；不得把“潜在风险”说成已发生的数据损坏。

## 5. 主实验结果

tokens 采用已完成响应的实际 wire 总量，包含截止后到达的计费响应；不改变原 run status。M/T 为模型/工具次数。

| 任务 | 无记忆 run / workbook Oracle | 有记忆 run / workbook Oracle | 分类 | 无记忆 tokens / M / T | 有记忆 tokens / M / T |
|---|---|---|---|---:|---:|
| 23-24 局部列压缩 | INFRA_ERROR / FAIL（无输出） | INFRA_ERROR / PASS | incomparable | 35,700 / 5 / 3 | 52,550 / 7 / 5 |
| 477-45 合并求和 | TASK_PASS / PASS | TASK_PASS / PASS | unchanged_success | 25,793 / 5 / 4 | 26,325 / 5 / 4 |
| 91-34 例外去重 | TASK_PASS / PASS | TASK_FAIL / PASS | newly_broken | 42,960 / 6 / 5 | 79,306 / 8 / 8 |

- newly_fixed 0，newly_broken 1，unchanged_success 1，unchanged_failure 0，incomparable 1。
- 23-24 双方在300s截止时仍有模型请求在途，原 collector 明确记 EVIDENCE_AUDIT（5请求/4响应；7/6），因此都是 INFRA_ERROR；晚到完整费用可补充，但不追认预算内完成。有记忆的正确文件不是 newly_fixed。
- 477-45 双方都是5 model/4 tool；有记忆 tokens 增532（约2.06%），未产生准确率收益。
- 91-34 有记忆 stop_reason=max_iterations，最后工具已验证正确文件，但没有完成正常收尾；按照冻结契约是预算失败，不手动提升。
- 主实验 wire 总计：无记忆104,453 tokens /16 model /12 tool；有记忆158,181 /20 /17，即 tokens +51.44%、model +25%、tool +41.67%。不能用含 INFRA 的成本差异宣称净收益。冻结报告内截止时已观测 tokens 是94,867/148,414；`supplementary-audit.json`补充晚到费用，不覆盖原报告。

## 6. 行为差异与 Probe

91-34主实验前两次工具完全相同。第3次开始：

| 步骤 | 无记忆 | 有记忆 |
|---|---|---|
| 第3次工具 | 格式检查输出587字符 | 扩大到多行多列样式，输出7,080字符 |
| 下一步 | 第4次执行/保存 | 第4、5次读取 openpyxl delete_rows / move cell 源码，第6次才保存 |
| 保存后 | 第5次验证，然后最终答复 | 第7次断言误写 max_row==40（实际39）失败；第8次改成39通过，然后耗尽预算 |

总工具输出字符12,983→25,838；model6→8、tool5→8。直接注入在前三个相同历史请求上增加296 prompt tokens/次，但后续成本主要伴随更大的格式输出、源码检查和错误自检循环，不只是记忆块固定长度。

合理推断是记忆内容/格式保护要求与模型随机性共同影响执行路径；目前不足以断言某条记忆单独造成额外循环。不能把模型自写断言错误当 Oracle 实现错误。

Probe 已按冻结规则全部完成，仅91-34，各追加2次：

| 重复 | 无记忆状态 / wire tokens / M / T | 有记忆状态 / wire tokens / M / T |
|---|---|---|
| 主实验 | PASS / 42,960 / 6 / 5 | budget FAIL / 79,306 / 8 / 8 |
| Probe1 | PASS / 44,319 / 6 / 5 | PASS / 48,203 / 6 / 5 |
| Probe2 | PASS / 46,506 / 6 / 5 | INFRA_ERROR / 49,068 / 6 / 4 |

无记忆3/3通过；有记忆1 PASS、1预算FAIL、1 INFRA，不能把INFRA混算有效业务失败率。所有有记忆工作簿值都正确，但不代表在预算内可靠完成。

Probe1不再读取库源码，正常验证并停止。Probe2第3次输出34,732字符的完整样式对象，随后一次模型响应 finish_reason=length（4096 output tokens），保存文件后在下一模型请求期间达到300s；该请求晚到费用10,054tokens仅补充核账。主实验的特定“源码→错误行数断言”没有在Probe稳定复现；观察到执行长度/输出波动，不能以 n=3 宣称稳定因果或统计显著性。

## 7. 成本分账

形成任务真实 wire 72,271 tokens /11 model /8 tool（r2，含失败与晚到响应）；成功 producer-v2 提取18,200 tokens /2 model。二者只记一次，r3/r4复用不会重复算“学习成本”。

工程失败单列：r1 task78,860 + extraction24,437；r2失败提取25,100；r3无效公平性迁移89,966；格式诊断33 tokens。这些不能藏在主实验之外后宣称低总成本。

| 成本类别 | tokens | model calls | tool calls |
|---|---:|---:|---:|
| r4主实验 | 262,634 | 36 | 29 |
| r4四次Probe | 188,096 | 24 | 19 |
| r4合计 | 450,730 | 60 | 48 |

整个Memory研究r1–r4与格式诊断实际累计 **759,597 tokens、101次模型请求**（包含6次提取、1次格式诊断）。这是供应端 usage，不是 Codex 自身用量，也不是美元账单；不含早先独立XLSX smoke的22,713tokens。所有wire响应已收齐，重用形成trace未重复收费。逐Attempt总账和原文件hash见 `evidence-index.json`。

## 8. 隔离、Hub 与交付

- 当前有效研究路径：r4 Proxy `23696` → r3隔离 Core `22920` / Hub `22725`；r4只复用冻结历史源，使用全新 session/workspace。不是正式服务 `8420/8096/8125`。
- Hub 已经由鉴权 API 实查：`http://127.0.0.1:22725/#/memory`，team `team-wjvki1fax5`，agent `agt-wjvk32mmmh`，Memory asset `chat_memory-team-wjvki1fax5-agt-wjvk32mmmh`，**L0=13、L1=7、L2=0、L3=0**。不是浏览器视觉验收，也不要求用户再次登录空 L2 页面。
- 这里13条 L0/7条 L1只来自形成任务；迁移 run 摘要进入隔离 Task participation evidence，不进入可召回 Memory。
- r1/r2失败实例及r3旧Proxy已停止，容器/存储/文件完整保留，可恢复；没有删除历史 Attempt。r3 Core/Hub与r4Proxy保留。
- 可直接查看正确交付：[合并求和 result.xlsx](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/runs/477-45-memory/outputs/result.xlsx)、[无记忆例外去重 result.xlsx](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/runs/91-34-none/outputs/result.xlsx)。文件正确不等于有记忆更好。
- 最终隔离审计 **PASS**：十个run输入hash不变；主实验三对及Probe两对的pre-Proxy初始请求在仅归一化随机workspace后完全一致；每个有记忆session实际命中/注入5条，无记忆零注入；冻结Memory集合/版本/hash不变，迁移L0=0，Skill=0，正式存储快照不变，服务日志无测试高熵凭证泄漏。
- 十个run的真实wire调用均核对模型/temp0/完整usage；九份实际输出全workbook值与reference一致，一次缺失输出保留。格式未完整评分；日志扫描是已知凭证检测，不是任意隐私泄漏证明。
- 主要证据：[冻结主报告](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/study-report.json)、[后审计](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/supplementary-audit.json)、[完整索引与总账](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/evidence-index.json)。各 `runs/<key>/` 下保留原请求/工具/output/Oracle/run结果，private文件不公开。

## 9. 测试与实现范围

本次新增均是 `scripts/business-memory/` 的 opt-in 本地脚本、测试及文档；未改变 TencentDB 默认生命周期或旧 Evaluation核心。`audit-lib`只分析保存证据，不重打分；恢复入口只执行尚不存在的 run，partial目录拒绝覆盖。

```bash
BUSINESS_DOCKER_TESTS=1 /Users/lsmax/Coder/nanobot/.venv/bin/python -m unittest discover -s scripts/business-memory -p 'test_*.py' -q
# 27 PASS，含真实 Docker 和真实 SDK + mock provider，不把 mock 当真实 LLM
node --test scripts/business-memory/*-lib.test.mjs
# 8 PASS（wire/context/tool诊断4项 + Memory scope诊断4项）
node --test scripts/phase6/acceptance-lib.test.mjs
# 4 PASS
node --check scripts/business-memory/study.mjs
node --check scripts/business-memory/audit_study.mjs
node --check scripts/business-memory/summarize_study.mjs
git diff --check
# PASS
```

## 10. 限制与下一步边界

本轮先交付真实但可能否定的证据，不以调预算、清理记忆后重算同一实验、改题或挑最好 Probe 获得 PASS。当前最值得进一步验证的是**任务特定事实与可迁移方法的区分、检索适用范围以及上下文背景保留**，不是再训练/措辞修改 v4。

研究结论不能外推到所有 Memory：这里只测试一个固定自动快照、固定宽泛 query/top5 和一组工具/模型。公开测试集存在预训练污染可能；只有3道迁移题；值 Oracle不覆盖所有格式与业务语义；300s截止导致不完整主pair；后端仍是本地SQLite/FTS而非云TencentDB。

后续若实施新的记忆选择/呈现条件，必须另立 revision、保留本次失败并在新运行前冻结；这些已见迁移任务只能继续作诊断/回归材料，不能再宣称未用于优化的held-out。任何正式写入、Promotion、push/PR/merge仍不执行。

本轮已继续到预定证据收口，不再追加模型重复以获取正结果。并且已经完成下一项零模型成本的[离线来源/适用范围诊断](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4/memory-scope-diagnostic.json)：7条记录中2条method带固定列约束，实际暴露的5条均被本次content-only renderer省略background。诊断由 `memory_scope_audit.mjs` 及4个测试生成，不读Oracle成绩、不重写记忆、不新增准入Gate。固定列正则只是风险线索，不能宣称所有此类方法无效，也不能推断底层存储一定没有scope。

下一研究的具体假设已缩小为“保留来源/适用条件是否改善跨任务使用”，而不是修改当前题目、增加预算或生成v5。新对照需要独立revision；本次协议到此封存，所有主结果/Probe/失败不变。费用索引脚本曾因诊断文件usage字段位于response内而报错，修正后首次成功输出索引；未产生实验重跑或覆盖证据。
