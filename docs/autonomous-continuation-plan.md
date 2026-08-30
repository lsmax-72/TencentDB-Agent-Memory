# TencentDB Agent Memory 自主续跑计划

创建：2026-08-31，北京时间。目的：减少逐步人工确认，按真实证据推进 Phase 6 收尾，而非自动扩展研究范围。

## 1. 当前基线与完成边界

- 仓库：`/Users/lsmax/Coder/TencentDB-Agent-Memory`；规划时分支 `feat/evolution-candidate-refinement`，HEAD `ea1080392cddca44bf4bb16b1ca6c75f7c3af8fc`。续跑必须重新检查 Git，不假定 HEAD 不变。
- Phase 6 有效证据：`/Users/lsmax/Coder/phase6-artifacts/outputs/phase6-integration-20260830-r5`；报告：`docs/phase6-integration-acceptance-report.md`。
- 已证明：真实 nanobot → MemoryProxy → MemoryCore → 本地 SQLite/FTS；普通 L0 和 Evaluation 脱敏摘要可经 Hub API 回读；r5 隔离审计通过。
- 尚未证明：登录后 Hub 页面操作、非空 gateway 鉴权兼容、重启后的绑定/隔离、云端 TencentDB、L1/L2 提取及跨 session 召回。不能合并为一个“全部接通”的结论。
- v4 和旧研究全部冻结：旧 Suite Gate FAIL (NO_NEW_FIX)，held-out promotion evidence FAIL；不生成 v5，不恢复措辞调参，不 Promotion。
- 原服务 `8420/8096/8125` 不改。旧测试服务 `18420/18096/18125` 和 r1–r5 证据保留；故障实验不能覆写为成功。
- 用户已有 deployment 修改不纳入提交。仅提交自己的已验证改动；不 push、PR、merge。

**本次完成条件**：下表 01–09 的已授权项有可核验结果；等待权限/外部条件的项逐项记为 BLOCKED/REVIEW_REQUIRED，不能算通过。计划写好不等于工程完成；完成可执行部分后停止，不自动进入后备阶段。

## 2. 一次性定时续跑

- 时间：2026-08-31 03:00，Asia/Shanghai；自动化 ID `tencentdb`，绑定当前任务，运行一次。
- 先读最新对话、`PHASE_CHECKPOINT.md`、本计划及 Git/报告；用户更新的指令优先。
- 判断具体工程验收是否已完成，而不是只判断上一条回复是否结束。
- 若完成，只确认；未完成，从首个已授权未完成项继续。需要登录许可的 UI 项可以暂挂，其他独立项继续。
- 不创建额外调度、不购买或兑换额度、不保证额度届时恢复。服务不可用时先完成离线检查，不循环消耗真实模型。

## 3. 可自主执行的工作队列

这里的“可自主”仅指当前 Phase 6 范围内的本地代码、测试和隔离验收。计划不是对新阶段或正式系统写入的授权。

| 步骤 | 工作与完成证据 | 失败后下一步 | 初始状态 |
|---|---|---|---|
| 01 恢复与只读体检 | 核对 Git、freeze、服务端口/镜像/挂载、现有 namespace 和数据目录；只读请求模型 `/v1/models`，核对原 provider/model/temperature/fallback；记录不含 secret 的快照 | 服务不通则区分路由、端口、鉴权、provider；不改网关或模型，不重跑全部实验；转 03/04/07 的离线工作 | TODO |
| 02 Hub 可见性收尾 | 复用测试身份核对 Team→Agent→Task→Session、普通 L0 和 evaluation 摘要；已有 API 结果只读复核。登录后 UI 另记截图/页面路径，不能用 API PASS 代替 UI PASS | 未获凭证输入许可时保持 UI BLOCKED，禁止自动填私有文件里的 key、改浏览器存储绕过；继续其他项 | API 已有证据；UI 待许可 |
| 03 鉴权最小修复 | 查清 Proxy→Core 的 Bearer 与 User Key 职责；在本地代码和全新隔离验收实例验证非空 gateway key；正确身份通过，空/错 key 和跨 Team/Agent/Session 拒绝；缺失 secret 时启动失败或拒绝请求 | 给准确失败分支补测试；不靠关闭鉴权、共用正式 key 或改生产默认配置通过 | TODO |
| 04 重启与失效关闭 | 先离线测试，再对本轮新建测试实例做受控重启；普通历史可回读，未绑定/丢失 evaluation binding 的请求明确拒绝，不能降级成普通记忆写入；重新显式合法绑定后再验证 | 若绑定丢失导致写入，修实现并独立 IMPLEMENTATION_FIX_RETRY；不为恢复绑定引入数据库或服务 | TODO |
| 05 脱敏证据可追溯 | 对齐 run/session/task、实际 model、usage、tool events 和摘要 hash；完整正文只留私有本地证据，Hub 只收白名单摘要；明确哪些由 SDK、Proxy、验收采集器产生 | 丢字段时定位采集环节，补缺失/多行/异常测试；不以 0 或成功状态填空，不把原始 fixture 导入 Hub | TODO |
| 06 新的集成复验 | 03/04/05 单测通过且 provider 可用后，新建 revision/源码 freeze 与独立目录；普通/evaluation 各一次真实 smoke，分别新 session/workspace；沿用 Phase 6 任务与 Oracle，保留模型/工具条件 | 任一失败先分析，不自动跑旧 5/held-out Suite；实现修复另建 retry。若要改变 smoke 任务定义或验收标准，先记录并进入协议审查 | TODO |
| 07 隔离与持久化复审 | 审计跨身份拒绝、Eval L0/Skill 零新增、无正式 Memory recall、日志/Core/WAL 无 canary；核对正式业务数据前后，区分运行态文件变化；新测试实例重启前后数据一致 | 发现污染停止后续真实写入并保留证据；不能清理污染后声称从未发生。仅操作准确列出的自建测试实例 | TODO |
| 08 固定版本与操作说明 | 固定实际 image ID/revision，整理启动前校验、健康检查、输出定位、恢复和有限清理说明；凭证走私有文件/环境，不能进入 Git；不自动拉 latest，不重启 Docker 全局服务 | 环境依赖不足先输出明确缺口，不换 runtime 或绕过安全约束 | TODO |
| 09 交付与收口 | 更新独立报告/证据索引/checkpoint；列命令与结果、失败 retry、已证实能力/未证实能力和必要决策；本地小步提交，检查未夹带用户改动 | 不以旧的 54 条 TypeScript 基线错误冒充全仓 build PASS；修复导致的新诊断必须处理 | TODO |

依赖顺序：01 → 02（可暂挂）→ 03 → 04 → 05 → 06 → 07 → 08 → 09。07 的离线审计、08 的文档可在模型不可达时提前。不能因为某一分支阻塞而跳进未授权的新业务阶段。

## 4. 执行约束与结果分支

### 保持实验可信

- 旧 Baseline/Candidate/Suite/Oracle/Gate/budget/model/temperature/toolset/hash/Attempt 不动；本轮集成测试不是新 Skill 效果实验。
- 新源码必须在新 Attempt 前冻结；不向 r5 追加执行输出、不改旧 source-freeze。复用旧证据时只读引用。
- 不直接在旧 r5 实例实施鉴权/重启改动。新实例需唯一名称、loopback 端口、独立网络和存储；先确认目标，不覆盖冲突容器，不碰正式挂载。
- 修实现允许自主，但不得改变请求的任务目标或“什么算成功”。实现修复后补回归测试并标记新 retry。
- 真实复验以最小完整链路为单位；同一失败无新证据不反复调用模型。冻结的预算不能因超时自动增加。
- Evaluation 仍禁止学习/写正式 Skill、Memory、Agent/Candidate 资产；只允许专用测试 namespace 的必要身份和脱敏 observability。fixture 原文不入 Hub。

### 减少人工打断

- 每项执行：证据 → 假设 → 最小验证 → 修复 → 测试 → 结论；普通 bug 自行处理。
- Terra 默认组织执行；明确的搜索/抽取/文档检查可按可用授权交给 Luna；复杂因果/架构矛盾才考虑 Sol，不因重要就全程高成本模型。
- 仅在较大里程碑、关键风险、Critical Review/Hard Stop 汇报；工具等待期间保持简短状态更新。
- 模型不可用：离线检查照常做，真实 run 标 BLOCKED，不伪造成功。缺浏览器权限：API 继续，UI 标 BLOCKED。
- 不能自主解决的权限和方向选择集中为一次决策包，包含事实、方案、影响、建议；不重复询问同一个问题。

### 必须人工决定

- 冻结协议/Promotion 标准调整；恢复 Candidate refinement；正式 Promotion。
- 生产部署或写入、主 Hub `8125` registry/配置修改、正式凭证用途变更、push/PR/merge。
- 新数据库/服务/API/大型基础设施，以及 EvoAgentBench/SRE/KnowHub/Memory self-evolution 等扩展。
- 浏览器凭证输入仍以已有明确许可为准；本计划不会把待许可状态改成已授权。

## 5. 后备任务路线：可以先准备，不自动执行

以下用于多步规划。可以只读核查已有实现、列方案和验收标准；运行、写数据和配置变更须后续明确授权，不因前一步 PASS 自动解锁。

| 顺序 | 下一研究/工程问题 | 准备内容与未来验收 |
|---|---|---|
| 10 常用 Hub 观察入口 | 为什么常用 Hub 看不到隔离实例？ | 核查 registry/权限模型；优先独立观察链接或现有能力，不先造 Dashboard。真正只读能力未经验证不能声称“只读接入”；修改主 Hub 配置前提交一次方案 |
| 11 普通业务 Memory 提取 | L0 能否通过已有路径形成 L1？ | 只读核查 extractor、触发条件、provider 和存储要求；设计合成业务样本的独立集成验收，不用 AC/held-out 内容，不改变 Evaluation 学习关闭策略；缺 extractor/provider 就报告缺口 |
| 12 新 session 召回 | 记忆是否真的出现在后续模型上下文？ | 设计 session A 存储→抽取→新 session B 检索/注入的证据链；区分 DB 命中、上下文注入和行为效果；增加跨 Team/Agent 不可读负例；不得把工具可见当作自动 recall 成功 |
| 13 业务 Memory 治理 | 如何防止过期、冲突和实验泄漏？ | 先清点已有来源/version/删除能力，再设计少量负例；不建设自进化或 Dreaming，不把 Playbook/失败 trace 全文直接做可召回记忆 |
| 14 云端 TencentDB 验收 | 是否需要且能够验证真实云实例？ | 核对用户提供的明确测试 endpoint/backend/namespace/费用与凭证范围；未来独立 connect→write→read/search→update→delete→cleanup，不沿用 SQLite 结论。未确认目标不做云写入 |
| 15 研究方向复盘 | 可靠底座是否足够支持下一次 Skill 研究？ | 汇总能力矩阵、成本、隔离、v4 失败与泛化证据；提出下一实验问题交人工决定。可以结论为继续 refinement 无意义，不强行 Gate PASS |

## 6. Checkpoint 与最终汇报格式

每个可恢复里程碑记录：branch、起始/最近已提交 HEAD、当前步骤、最近有效 Attempt、源码/配置 freeze、假设、完成项、保留失败、测试命令/结果、阻塞/审查点、下一可自主动作。Git 提交后 hash 以 `git rev-parse HEAD` 为准，不在同一提交中制造自引用 hash。

中断前优先写 checkpoint；恢复不重做已经完整验证且环境未变的工作。最近 valid evidence 与最近 failed attempt 分开记录。

最终仅报告：已完成 / 未验证 / 明确失败 / 需要决策；附可定位证据和本地 commit。不能把“全部可执行工作做完”写成所有目标都 PASS。
