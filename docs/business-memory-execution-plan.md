# 业务任务与 Memory 收益验证：连续实施计划

最新执行入口（2026-08-31）：用户已授权独立实验配置自主决策，旧 R0 等待条目仅作历史。B0–B4实现与链路已验证，B5三对主run/四次Probe全部执行，但结果为INFRA_ERROR且无收益；B6实际Hub API与文件交付、B7隔离/总账审计完成。见[最终报告](business-memory-transfer-report.md)，不能将“执行完毕”写成“收益PASS”。

日期：2026-08-31。下文是原实施计划的历史设计依据，不是当前待审批清单；当前状态以上方真实报告和checkpoint为准。

执行更新：用户已要求开始执行并允许适配性换题，随后明确独立测试配置无需人工审查、由代理直接执行。执行证据包含[离线 admission](business-memory-offline-admission-report.md)、[真实 smoke](business-xlsx-smoke-report.md)及[Memory迁移结果](business-memory-transfer-report.md)。后续新条件需要独立revision；不篡改已冻结实验，不因用户授权自主配置就复用旧结果为正结论。

## 1. 目标、起点与授权

目标按顺序区分：交付正确的业务文件 → 证明历史经验实际进入新 session → 对照验证经验是否带来收益。一次任务成功不等于 Memory 有用，更不等于 Skill 自进化有效。

- 当前分支 `feat/evolution-candidate-refinement`，规划基线 HEAD `ff1f078d45e4699762292d092759fd5c24a24d5b`；执行前重新核对。
- 用户已人工验证基础记忆可用，截图可见学校/年级回答。接受此功能反馈，不再要求重复“记住学校”演示；截图不能单独定位实际 DB、注入方式或当前 nanobot 链路的跨 session 因果关系。
- 最近独立链路验收仍为 `phase6-secure-20260831-r2`：本地 SQLite/FTS、普通 L0、Evaluation 隔离和 Hub API 通过。不能把用户个人环境的反馈追认成这个冻结 Attempt 已开启 L1/L2。
- 用户已登录测试 Hub 并展示 evaluation 空 Memory 页面；旧“等待用户登录”的下一动作已过时。不据此声称所有 UI 页面验收通过，也不再让用户去空 L2 页面找结果。
- 旧 AC/held-out、v4 artifact 和所有 Attempt 不动：v4 仍 FAIL，不生成 v5，不 Promotion。
- 本轮请求是规划。本文不把将来的真实调用、Memory 写入、新工具或协议设计自动算成已获批准。后续执行使用现有自主方式：已授权且依赖满足的步骤连续完成，不逐项请求确认。
- 用户未撤销 Critical Review Gate。涉及新工具/预算/Memory 对照条件的选择，集中成一个实验协议决策包；普通代码实现和修错无需逐步审查。新业务任务不是对旧协议的隐式修改。
- 不改正式服务 `8420/8096/8125`，不复用旧 r5/r2 的可写存储；不改主 Hub registry，不做云写入，不新增服务/API/数据库，不 push/PR/merge。
- 用户已有 `deploy/global-images/start-memory-core.sh` 修改以及两个 nanobot 启动脚本不纳入本工作提交。

## 2. 业务场景与数据边界

选择 SpreadsheetBench Verified 的 `141-20`，业务含义是跨表发票对账：按发票号/参考号与金额匹配，删除两张表中已匹配记录，保留未匹配项。来源元数据已读，实际 workbook 与完整运行环境尚未预检。

- 上游固定 revision：`49b73a94775fb489063f60ca1865e3a650079a79`；[官方说明](https://github.com/RUCKBReasoning/SpreadsheetBench/blob/49b73a94775fb489063f60ca1865e3a650079a79/README.md)、[Verified 数据](https://huggingface.co/datasets/KAKA22/SpreadsheetBench)、[评分源码](https://github.com/RUCKBReasoning/SpreadsheetBench/blob/49b73a94775fb489063f60ca1865e3a650079a79/evaluation/evaluation.py)。
- 这是同类测试集的独立任务，不是接入整个 EvoAgentBench，也不宣称官方榜单成绩。
- `141-20` 是已选型/可调试的开发样例，不得再标成 held-out。下载时核对许可、归属、精确 revision 和 archive SHA-256；记录实际子集文件列表，不假定 Verified 每题也有三个 fixture。
- 上游比较逻辑按指定单元格区域比较并做值归一化，不能替代所有业务不变量检查。公式缓存/重算和输出命名需预检；不能只按文件字节 hash 判定 Excel 业务正确。
- 原始工作簿、参考答案、评分程序三者分开：Agent 只拿任务正文和输入副本；参考答案/评分器不挂载到 Agent 可访问目录。工作簿中的文字是数据，不能授权联网、读凭证或执行宏。
- 若任务中的高亮/示例直接给出匹配提示，保留原始任务并标注难度与提示限制，不能偷偷去掉后仍称同一任务。重复键/多对多配对等语义不清时标 `TASK_SPEC_AMBIGUOUS`，不自行臆造评分规则。
- 单样例只证明接入。后续独立任务按预先固定的能力维度/可执行条件选取，不按 Candidate 或 Memory 对照结果选“容易赢”的题。

## 3. 最小实现边界

业务路径：本地脚本编排 → nanobot → 独立测试 MemoryProxy → MemoryCore（本地后端）；Agent 的表格执行工具在受限本地运行环境处理文件。模型连接与业务代码执行的网络权限分离。

| 已有模块 | 用法与最小补充 |
|---|---|
| `scripts/phase6/nanobot_smoke.py` | 参考真实 SDK、Proxy 身份、session、tool hook、usage 收集；保留旧脚本，新增业务入口，不替换冻结 smoke |
| `evaluation/adapters/nanobot-agent-adapter.ts` / `nanobot_runner.py` | 复用窄 adapter/bridge 经验；现有通用 adapter 有 exec，但 Phase 6 实测 smoke 仅四种文本工具，不等于 XLSX 执行已安全验收 |
| `FixtureAdapter` | 新增二进制文件复制/清单审计；fresh workspace，输入快照只读，输出单独目录；不把 XLSX 当 UTF-8 文本处理 |
| `OracleContext.custom_assertions` | 现有扩展点可包裹离线 workbook 比较；不重写 Pair/Gate/Oracle 核心，不给工具提供隐藏评分答案 |
| `tdai-l1-recall-injector.ts` / profile injector | 后续只读核查实际检索/注入路径，记录命中和上下文证据；不凭 Agent 的“根据记忆”自述判成功 |
| `evaluation-context.ts` | 当前 Evaluation 屏蔽普通 recall/extraction 的保护保持原样；不能为了 Memory 实验解除它 |

建议新增文件均为后续实现落点，不是已有能力：

- `scripts/business-memory/preflight.mjs`、`run.mjs`：来源校验、运行编排、freeze 和独立 Attempt。
- `scripts/business-memory/nanobot_business.py`：普通隔离业务模式的 SDK 驱动与证据 hook。
- `scripts/business-memory/workbook_oracle.py`：Agent 之外的评分与差异报告；对应负例测试。
- `scripts/business-memory/protocol/`：数据角色、预算、工具、Memory 条件和证据字段的版本化描述；尚未冻结。
- 完整证据放仓库外 `phase6-artifacts/outputs/business-memory/<attempt-id>/`；Git 只保存代码、脱敏 manifest/报告。模型可见 workspace 不包含父目录证据、private 配置或 golden 文件。

不优先造通用 BenchmarkAdapter、Web UI 或新的服务。若复用代码必须修改默认路径，先证明有局部、opt-in 的方案并补回归测试。

## 4. 连续工作包与验收

步骤状态使用 `PLANNED / IN_PROGRESS / VERIFIED / FAILED / BLOCKED_EXTERNAL / REVIEW_REQUIRED`。计划完成不代表这些工作包已 VERIFIED。

| 包 | 工作、交付物与验收 | 下一步/失败分支 |
|---|---|---|
| B0 数据与环境预检 | 取得固定版本样例；审计文件结构、宏/外链/公式、重复键语义、评分区域和许可；核对已有 Python/nanobot/表格库/容器。输出来源 manifest、输入 hash、依赖差距与风险；零模型调用 | 数据不可达可做离线骨架；歧义不擅自消解。若样例不适用，先记录客观排除理由，再按相同能力标准选替代，不能用 Agent 成绩挑题 |
| B1 最小执行设计与安全负例 | 设计/实现独立业务入口、受限 Python 表格工具、fresh workspace、只读输入、证据 collector。先用合成小表测试，不接真实账户或对账系统；测试拒绝目录穿越、软链接越界、网络、凭证读取、超时和非法输出 | 普通 bug 自行修；不能把 restrictToWorkspace 当 OS 沙箱。受限执行无法成立则停真实 Agent 分支，不开放宿主任意 exec |
| B2 判分与冻结准备 | 用合成正确/错误输出测试：删错行、漏删、同号不同金额、保留非目标表、损坏/缺失文件、oracle 异常。分别输出上游比较结果和额外安全审计，不揉成“官方分数”。准备新协议 bundle | 只有与明确任务要求一致的断言可成为正式 task 评分；额外风控单列。实现异常记 INFRA，真实错误输出记 TASK_FAIL |
| R0 集中协议审查 | 一次给出新业务 toolset/sandbox、具体预算、数据分工、Memory 写/读边界、对照和停止规则。用户批准后记录决策 hash，再 freeze。审查前 B0 的只读工作可做；B1/B2 在本地开发范围获准后连续执行，不逐项重新申请。真实 runs 和 Memory 写入不自动解锁 | 用户授权后 B3–B7 连续做，不每包重问。若已有明确授权覆盖全部字段则引用原决策，不能虚构批准。当前尚无此批准 |
| B3 单任务真实交付 | 使用当前合法配置 `vllm/qwen3.8-27b`、temperature 0、fallback disabled，模型/SDK实际值核对；按批准预算一次完整 run。输出 workbook、最终答复、tool events、usage、session、oracle、输入保护审计 | 有效 TASK_FAIL 如实留存，不手工改结果冒充 Agent 产物。实现修复补测试另建 `IMPLEMENTATION_FIX_RETRY`；重复同因且无新证据不烧模型 |
| B4 独立测试 Memory 链路 | 只在获准测试 namespace，用开发 session 产生经验，沿已有提取路径生成记忆；只读冻结 Memory 内容、来源 session/trace 和 hash。新 session 查询，证明 DB 命中→实际上下文注入；测试跨身份拒绝 | 没命中或没注入先定位 query/身份/触发/时序；不得把人工写规则标成自动学习，不能为了命中注入当前题答案 |
| B5 受控迁移对照 | 在 B3/B4 成功和预先冻结的新任务上，对比无历史 Memory 与固定只读 Memory；模型、Skill、工具、输入、预算相同，fresh session/workspace；输出正确率/每题差异/成本和 recall 证据 | 双方成功只报告该样本无准确率增益；差异伴随未召回不得归因“记忆生效”。不挑最好 run、不调考试；触发已冻结 Probe 规则才重复 |
| B6 用户可见交付 | 本地结果工作簿与差异摘要可直接打开；已有 Hub 的独立测试 Team/Agent/Task 显示本次摘要和可回溯 session。截图/API由我核查，明确链接、筛选条件、预期条数与内容 | 凭证用途不明确仍不绕过；Hub 展示阻塞不影响本地文件交付。不能因“界面要有东西”写伪造 L1/L2，不改主 Hub |
| B7 审计与阶段收口 | 输出效果/成本/隔离结论、全部成功/失败/Probe、完整证据索引、复现命令和 checkpoint；源码与证据 hash 对齐，分批本地 commit，不夹带用户文件 | 可执行部分完成后一次集中汇报。若结果不支持 Memory 收益，同样交付可信否定结论，不无限调参，不启动 Skill 新 Candidate |

依赖：B0 → B1/B2 → R0 → B3 → B4 → B5 → B7；B6 的文件交付随 B3 完成，Hub 展示可与 B4/B5 独立推进。B4 失败不妨碍交付 B3，B3 失败不可冒充已有可用业务闭环。

## 5. 对照设计草案：只测一个变量

以下是 R0 的输入，不是已批准的新 Gate。

### 数据角色

- `141-20` 用于开发/调试；其他同源 variants 也算开发材料，不算独立 held-out。
- 建议小规模：两个独立任务用于经验形成，另三个不同任务用于迁移验证；实际数量、ID、来源、能力覆盖与互斥关系在模型 run 前冻结，若数据不足则说明，不能虚报 held-out。
- 先依据任务语义/fixture 特征预选并封存，禁止根据 v4/Memory 输出反向选题。若训练数据污染不可排除，称“本项目未用于调试的迁移任务”，不声称模型从未见过。
- Memory 只来自经验形成集；含当前验证题固定答案、目标路径、参考文件内容或 case-specific 规则的条目拒绝进入快照。对照开始后不更新同一快照。

### 两个条件与公平性

- `NO_HISTORY_MEMORY`：同一固定 Agent/Skill，禁用历史 Memory 输入。
- `FROZEN_HISTORY_MEMORY`：相同固定 Agent/Skill，只允许经授权的独立测试 Memory 快照检索/注入。
- 这是“Memory 有/无”的新研究对照，**不是**旧 Baseline/Candidate Skill pair；不用 v4 作为默认业务 Skill，不虚构 Candidate 或强求旧 execution_fingerprint 相同来绕过校验。
- 冻结公共执行条件 hash；Memory 干预另有 policy/snapshot hash。公共条件必须相同，完整实验条件应不同。单 run 的 usage/工具/Oracle证据可复用，但旧 Pair/Gate 不负责给本实验 Promotion PASS。
- 正式对照期间不提取新 Memory、不共享 session history、不访问个人正式资产；普通业务研究入口与 `EVALUATION_V1` 分开，旧模式维持禁写/禁普通 recall。
- B4 是唯一允许形成测试记忆的阶段，写入位置/材料白名单在 R0 批准；B5 必须关闭普通 L0 capture、后台抽取、自动 Skill 写入以及隐式跨 Agent 借入。对照只允许向本地实验证据/获准 Hub Task 观测字段写脱敏摘要，禁止写入任何可召回 Memory，不能把新测试题落库后影响后续题。
- B5 使用从冻结 Memory 导出的独立只读测试数据，不连仍可被业务修改的 live memory；每 run 前后校验快照 hash/记录集合。无历史条件也检查本地 nanobot history、文件记忆和 profile 注入均未旁路生效。只关闭一个 recall 开关不算完整消融。
- 进入 B5 前要求显式的正/负证据：记忆条件能读获准快照；无记忆条件不能读任何历史；两者不能写 Memory；跨 Team/Agent 不能借读。权限拒绝或快照漂移阻断本批次，不降级到正式服务继续。
- B4 快照还需通过来源白名单自动审计、受保护答案/路径片段扫描和开发侧内容复核；来源不明或含当前验证任务特定答案的条目不得入快照。冻结筛选规则和最终内容 hash，保留被拒条目及原因；扫描不是“绝无泄漏”的保证，无法可靠排除时阻断 B5，而非运行后按成绩过滤。
- 检索到哪些条目、拼装了哪些文本、模型请求中的位置与 hash、实际工具行为均记录；检索质量和使用效果分开。没有发生召回时保留该 run，不偷偷替换成直接注入成功。
- 同任务各条件一次主 run；执行次序按冻结的平衡次序安排，避免总是固定先无记忆再有记忆。真实调用顺序和时间保留。
- Probe 建议只用于不一致、预算临界或疑似模型随机性；触发阈值与“每条件最多三次、仅一次诊断批次”须在主 run 前确定。不替换主结果。

### 成本与结论

- 每 run：task/infra 状态、input/output/total tokens、model/tool calls、elapsed、检索数量/延时、注入 tokens（可取得时）。缺字段记缺失，不能用 0 伪装已测。
- Memory 形成成本单列：提取和归纳的 tokens/模型调用，以及准备时间；线上单次节约不能隐去前期成本。只能在实际处理任务数下报告累计/摊销成本，不外推未来收益。
- 分开回答：任务是否成功、经验是否召回、是否产生行为差异、收益是否稳定、成本是否值得。小样本只给方向性证据，不给统计显著或生产可用承诺。
- 预算的具体数字、Probe 阈值、成本容忍度及“继续研究”的标准在 R0 固定；没有这些字段不得启动正式对照。旧预算不复用为业务预算，也不按失败结果加大。

## 6. 安全、错误分类与证据

- 表格执行进程仅挂载输入副本（只读）与独立 output/tmp（可写），无宿主 HOME、凭证、Docker socket、项目源码和 golden；非特权、网络关闭、资源/进程时间限制。若使用容器，复用已有 Docker 能力，不建新常驻服务。
- B3 admission 必须在实际运行镜像上通过挂载/权限/网络拒绝与资源超限负例，并核对测试镜像与冻结镜像相同；任一能力不明或未通过即失效关闭，不发出真实 Agent 请求。
- 冻结预算需在调用前检查剩余额度，并约束单次模型输出、工具次数和子进程时间；计数从实际事件汇总。补“达到边界、刚好超限、超时仍有部分 telemetry”测试，不仅在运行结束后才发现超支。
- 首版优先串行执行并关闭可配置的 SDK/provider 自动重试，避免另造调度系统。若底层仍重试，实际请求必须计入同一预算；输入加最大输出在调用前预留，失败/流式中断也保留用量证据。工具子进程共用 run 的剩余时间/资源配额；出现并发则统一扣减，不能各自看到同一份剩余额度。无法获知实际消耗时记录 telemetry 缺失，不隐去失败请求成本。
- 与 provider/Proxy 通信仅由外层 Agent 驱动完成，不向其生成的 Python 代码传递 API key。尝试读越界文件/联网产生可记录的拒绝，不靠提示词实现隔离。
- 公式重算若确有需要，使用受限环境和固定版本；宏/外部数据连接不得执行。不能把工具缺依赖或 oracle 崩溃记成模型能力失败。
- 业务输入和输出完整本地保存；Hub 只写批准的测试身份和脱敏观测摘要。Memory 形成与 benchmark evaluation 资料分开，绝不导入旧 AC/held-out fixture/答案。
- Agent 生成损坏/缺失 workbook、改错行、超业务预算 → TASK_FAIL；provider不可达、准备环境失败、评分器无法执行、关键 telemetry缺失 → INFRA_ERROR。按现有错误语义映射，不一刀切。
- Attempt 采用独占创建；文件已存在即拒绝覆盖。成功、失败和 Probe 都保存，记录 parent/retry reason；修实现后重新冻结受影响代码，不能将不同源码伪装成同一次 Attempt。
- 输出目录最低包含：`manifest.json`、`freeze.json`、`events.jsonl`、`usage.json`、`oracle.json`、`audit.json`、`final-output.txt`、`outputs/`。Memory 对照另含私有 recall/injection evidence 和公开脱敏摘要。
- 冻结后若发现 task/oracle implementation bug，保留原结果，版本化并重试；若改变成功含义、任务要求或评价标准，回到 Critical Review，不借 implementation fix 名义调考试。

## 7. 自主执行规则与中断恢复

1. 以完整可验收工作包为单位推进。完成 B1 后若 B2 依赖具备就继续，不发“是否继续”问题。
2. 普通失败走证据→假设→最小验证→修复→测试；同因两次失败后换验证假设，不机械重跑。每次真实 retry 都有明确实现/环境变化依据。
3. 默认实现修复循环离线进行；真实 retry 建议每工作包最多两次（主 run之外，具体写入 R0）。达到上限先做离线归因；若继续需要增加已冻结运行配额，集中审查，不无限消耗。
4. provider/凭证不可用时做离线测试、数据核查、证据分析和文档。缺少凭证不切模型、不申请付费服务、不兑换额度；可执行工作做完才报告硬阻塞。
5. 测试启动/文件定位/单 bug 不报长进度；仅较大里程碑、影响方向的新证据、必要审查或硬阻塞做阶段汇报。长工具执行间的简短状态更新不构成停工/等待确认。
6. 不把“没有明确收益”当失败工程，也不无限调 Skill。结果高度随机/需求矛盾时，完成一次有限诊断后提交研究结论；未经新授权不恢复 Candidate refinement。
7. 使用 docs 计划及 checkpoint 作为恢复入口，不依赖聊天。写 branch/HEAD、工作包状态、协议批准引用、freeze、最近 valid/failed Attempt、测试、假设、下一动作。
8. 每个稳定代码阶段可本地提交；提交前核对用户 Git 身份，精准暂存自己的文件。本计划不要求为每个小步骤制造提交，也不创建后台调度。

只在以下事项暂停对应分支并集中提交决策包：新/冻结协议或 Promotion 标准改变；正式 Memory/Skill/Agent 资产写入；主 Hub/云配置变更；浏览器凭证用途需新许可；新增大型架构；push/PR/merge/部署。能独立推进的已授权安全工作不随之全部停下。

## 8. 本轮与下次入口

- 本轮完成项：实现路径、验收和失败分支规划；更新过时的恢复入口；文档审阅与 diff 校验。
- 本轮未做：下载 workbook 到项目、安装依赖、启动新实例、运行模型、写 Memory、设计并批准新 Gate、生成 Candidate。
- 下次执行第一动作：B0，固定来源样例/评分与环境的只读预检。无需再让用户选择业务场景、验证基础记忆、查看空页面。
- 全部阶段后的用户交付：可打开的结果 Excel、可定位的实验记录，以及“Memory 帮助了什么/没有帮助什么/成本如何”的有边界结论，不是只有一份计划。
