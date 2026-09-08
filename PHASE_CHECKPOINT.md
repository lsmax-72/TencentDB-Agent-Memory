# Autonomous Evolution Checkpoint

## 2026-09-08 Codex 全局 capture-only 接入完成

- 本机用户级 Codex Hooks 已接到主 8125：所有新 Codex 会话采集 `SessionStart / UserPromptSubmit / PostToolUse / Stop / Interrupt / SessionEnd`，写入独立 private `Codex Observation` Team/`codex-global` Agent。
- 新 Core `observation/ingest` 仅生成 `OBSERVED / INTERRUPTED` trace。`Stop` 不映射为 `host_task_complete`，Core 明确拒绝将 observation trace 送入 diagnosis；未启用 Memory 召回、候选、评测、采用或 Promotion。
- 客户端和 Core 双层脱敏、0600 state/outbox、loopback-only endpoint、幂等 event id 已实现。主 Hub 短暂不可用时只保留 outbox，不影响 Codex。
- 主服务更新前已做停服备份：`/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260908-pre-codex-observation`。Core/Hub 当前 healthy，原 volumes、历史 Attempt 和 v4 FAIL 均保留。
- 合成 Hook 和真实 `gpt-5.4-mini` Codex turn 均成功进入 8125；真实记录 `evo-2d113502-76ff-4291-946e-b259dcf4fecf`。Core 169/38、Panel 4、Hook 4 tests，以及相关 build/typecheck 均通过。
- 下一步不是立即自动进化：先收集约 10–20 个真实任务，审计脱敏和证据质量；再设计明确 task-complete 信号并有限启用诊断。详见 `docs/codex-observation-integration-report.md`。

## 2026-09-01 20:10 完成审计：Memory 三层闭环和主 8125 r2

- 最终审计发现并补齐一个真实缺口：先前 runtime task-complete 只生成 L1。提交 `8b0c865` 现把 L1/L2/L3 payload 放在同一候选额度与原子冻结批次内；正式 snapshot 不成熟时不提前运行高层，候选不能作为同轮下一层输入。候选额度不足以覆盖已触发层时在 proposal model 前阻止，不留下半批结果。
- 新独立实例 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260901-r12`（Core 38920 / Hub 38725）setup/verify/full/restart PASS。三个独立 host task-complete 依次证明 L1、L2、L3 真实候选冻结、校验/人工分流、采用、正式 bytes 读回和重启 adoption 读回；Wiki 仍精确应用冻结页面，Skill 仍 `BLOCKED_EVALUATOR_CONFIGURATION`，v4 历史仍 FAIL。
- 回归：Core **166 tests / 37 files PASS**、plugin build PASS、control strict 0 新错误（101 既有传递 diagnostics）；Panel **3 tests**、backend/web build PASS；Knowledge **11 tests / 4 files**、build PASS；脚本语法和 `git diff --check` PASS。没有调用或探测 vLLM。
- 主 Hub 在第二份停服备份 `/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-2005-pre-r2` 后更新到冻结 runtime `/Users/lsmax/Coder/phase6-artifacts/runtime/memoryhub-main-20260901-r2`。原 volumes 没替换，8125/8420/8424 healthy。
- 容器第一次重建遗漏原网络别名，真实浏览器发现 Team 列表 502；恢复 `memory-core` / `memory-hub` alias 后通过。浏览器重启后看到六个自进化页面、专用 Team、v4 FAIL，并确认 default-team 原 Chat Memory 的 L0/L1/L2/L3 仍可读。主证据在 `/Users/lsmax/Coder/phase6-artifacts/outputs/memoryhub-main-20260901-r2`。
- 主环境 automation admission 仍关闭且无 review/evaluation binding；没有 profile 启用、模型运行、测试写入正式资产或 Promotion。浏览器留在 `http://localhost:8125/#/evolution/overview`。
- 当前工程目标已达到本机 standalone 范围；真实 LLM 自进化效果、云 TencentDB、正式 Skill Promotion、push/PR/merge 都未执行，并作为下一阶段或人工 Gate，而不是本次完成项。

## 2026-09-01 15:45 本机 8125 交付完成

- 主 MemoryCore / MemoryHub 已在原 named volumes 上更新并恢复健康：`http://localhost:8125`、8420、8424 均可用。现有 `default-team`、admin 登录及正式 Chat Memory 保留；Code Graph、Skill、Wiki 原页面通过浏览器回归。
- 一致性备份位于 `/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-1535`，包含停服状态下的 Core/Hub volume 压缩包、校验和、原容器 inspect、Core 配置和私有重建 env。运行冻结快照位于 `/Users/lsmax/Coder/phase6-artifacts/runtime/memoryhub-main-20260901-r1`。
- Docker Hub token endpoint 超时使本地镜像重建不可用；本次未覆盖 `latest`，而是复用原镜像依赖并只读挂载已测试的 Core / Panel / Knowledge 冻结产物。容器重建及再次顺序重启均成功，数据与历史读回通过。此运行方式是当前 standalone 本机交付，不是可分发镜像或云部署。
- 8125 新建隔离 Team `自进化历史 / TEST ONLY`（`team-yys3k7rtoj`），只读导入原 v4 Attempt 和 frozen Candidate。评测中心实际显示 `FAIL / NO_NEW_FIX`、原 tokens/tool/model/case 结果及 hashes；候选页显示 `HISTORICAL_FROZEN / 历史证据·只读`；采用 API 返回 `LIVE_CANDIDATE_REQUIRED`，没有生成 v5 或修改历史。
- 主环境没有 review/evaluation binding，`EVOLUTION_AUTOMATION_ADMITTED=0`；浏览器显示“自动闭环尚未通过运行准入”，0 adoption。未调用或探测 vLLM，没有真实模型效果声明。
- 浏览器在真正 `localhost:8125` 验证六页、详情、Team 切换、旧页面、重启读回，console 0 error/warn。主验收证据位于 `/Users/lsmax/Coder/phase6-artifacts/outputs/memoryhub-main-20260901-r1`。
- 完整运行恢复见 `docs/memoryhub-evolution-runbook.md`，逐项验收见 `docs/memoryhub-evolution-acceptance-report.md`。仍保留用户 deployment 三个改动，不 push/PR/merge。

## 2026-09-01 15:24 续跑：完整三资产隔离验收通过

- 新独立实例 `evolution-hub-20260901-r11`（Core `37920` / Hub `37725`）完整通过。它使用独立网络、loopback 端口、存储和冻结 runtime，不挂载正式数据；vLLM 未连接或探测。
- 明确的 host task-complete 重复上报保持同一 receipt。确定性离线 OpenAI-compatible fixture 只用于检验编排：Memory 低风险 L1 候选经来源逐字核验后自动授权、真实采用并读回；Wiki 候选从真实 Knowledge 快照冻结，经内容校验、人工批准、正式写入、索引和读回，第二次采用幂等。
- Skill 候选内容校验后进入 `NEEDS_EVIDENCE`；因受限 evaluator 路径故意未配置，评测任务为 `BLOCKED_EVALUATOR_CONFIGURATION`，审查和采用均被拒绝，正式 Skill version/content 不变。此结果不宣称真实 LLM 效果成立。
- 顺序重启 model fixture、Hub、Core 后，Memory/Wiki 的 `APPLIED` 状态及读回内容仍在；v4 历史 Attempt 仍为 `FAIL / NO_NEW_FIX`，Code Graph 未修改。r5-r10 的 setup/implementation/infra 失败均保留，未覆盖；r10 在重启前成功的业务步骤也保留为失败 Attempt 的诊断证据。
- 隔离验收暴露并修复 standalone Skill 资产同步错误：全局 SkillCore hook 过去固定写 `default` metadata instance，非 default service 创建 Skill 时资产登记失败。现在通过 AsyncLocalStorage 绑定当前 HTTP tenant，并新增并发隔离回归测试；HTTP 外调用仍保留原 fallback。
- 回归：Core **164 tests / 37 files PASS**、plugin build PASS、control strict **0** 新错误（101 条既有传递 diagnostics）；Panel **3 tests PASS**、backend/web build PASS；Knowledge **11 tests / 4 files PASS**、build PASS；验收脚本语法和 `git diff --check` PASS。前端构建仍只有既有重复依赖键和 bundle size 警告。
- 下一步：先固化本节本地提交，然后只读检查主 `8125` 容器、挂载和配置，完整备份后以自动化默认关闭方式更新。必须保留现有用户、Team、Memory/Wiki/Skill 数据，并在真实 8125 浏览器验证六页与原有 Code Graph；尚未完成前不能宣称主 Hub 已交付。

## 2026-09-01 15:04 续跑：腾讯原生治理配置

- 从 `51bf18f` 继续。Core 新增管理员只读 `profiles/options`：只返回指定 Agent 已固定绑定、当前管理员仍可写且属于 Skill / Chat Memory / LLM Wiki 的资产；Code Graph 不进入自进化。可选复盘模型和 Skill 评测配置来自服务端受限文件，只暴露绑定 ID，不暴露 endpoint、路径或 secret。
- 启用 profile 现在必须同时满足 admission、每日 token/model-call/candidate 预算、独立 review binding、每类至少一个固定目标、三类真实 adoption handler；Skill 还必须有受限 evaluation binding。保存前与进入 mutation boundary 后均复查固定绑定及写权限，不能用失效/跨 Team 资产获得治理授权。
- MemoryPanel 使用现有 TencentDB / Tea 组件提供 Agent、资产类型、固定资产、模型/评测绑定、有限 Memory/Wiki 自动采用和启用开关；未满足后台 admission 时只能保存关闭草案，不使用 MyUI。
- 验证：Core **163 tests / 36 files PASS**；control strict **0** 新错误（101 条既有传递 diagnostics）；Panel **3 tests PASS**、backend/web build PASS；Knowledge **11 tests PASS**、build PASS。Core 聚合 `npm run build` 仍被仓库既有缺失 `scripts/seed-v2/tsconfig.json` 阻断，plugin 产物已成功构建，本节未新增该问题。
- 下一步：创建全新隔离实例，覆盖任务完成幂等、预算、三类候选/校验/审查/采用、权限、重启恢复及历史只读；通过后才备份并升级主 8125。仍不调用 vLLM、不更改 v4 FAIL/历史 Attempt。

## 2026-09-01 14:51 续跑：受限 Skill 对照评测任务

- 从 `2b640b9` 继续。新增持久 `evaluation` job：Skill 候选详情可请求 Baseline/Candidate 对照；重复请求幂等，retry建立独立任务，RUNNING重启时已有Attempt只核对完成、无结果标记RECONCILE_REQUIRED而不盲重跑。
- 评测配置来自0600操作员文件并绑定instance/team/agent/profile；HTTP不能传suite、命令、Python、nanobot路径、模型或配置文件。当前只允许冻结的 `AC_REGRESSION_V1`，且仅目标`skl-workspace`，没有匹配Suite的Skill明确阻止，不会临时造考试。
- 运行复用原 `MinimalEvaluationRunner / Oracle / Pair / Gate / NanobotAgentAdapter`，Baseline从正式Skill精确base_version读回，Candidate artifact/content/hash再次核验；每arm fresh session/workspace。执行前预留全套5case双arm最大token/model-call预算，INFRA/usage不完整保留保守预留。
- 完整EvaluationAttempt作为只读runtime receipt保存，含每case、fingerprint、tool/usage、cost、classification与Gate。只有`Gate PASS + newly_fixed>=1 + newly_broken=0`才成为Skill审查证据；不会自动采用或Promotion。v4历史FAIL/旧Oracle/Pair/Gate均未修改。
- 原生页面增加“运行 Baseline / Candidate 对照评测”和独立retry；Core161 tests/35files、plugin build、control strict 0新增错误（101既有传递diagnostics）；Panel3tests/build、web build PASS。
- 当前vLLM规避中，生产评测配置未启用、未执行真实model run；下一步完成可操作配置UI与隔离三类E2E。

## 2026-09-01 14:42 续跑：Wiki 隔离生成与预算闭环

- 从 `9a3b657` 继续。Wiki proposal job 现可选择唯一显式 `llm_wiki` 目标，经固定 Core→Knowledge 私有 bridge 从服务端注册的 `raw/sources/*` 读取可信材料；请求不能提供来源路径、endpoint之外的命令或文件系统能力。
- Knowledge 复用原 extract+merge 流程，但全部运行在 shadow copy；生成/合并后冻结最终页面 bytes。Core 在请求前一次性预留最多8个模型调用及其完整 token ceiling，Knowledge 禁用 SDK 隐藏重试、逐次限制 temperature=0/context/output/call-count并返回非空 usage；丢失响应/usage保留全额预留，不填0。
- reviewer API key 只存在服务端闭包和内部请求，不能被 JSON/string inspection 或 evolution record 序列化。每个真实 Wiki 模型步骤落独立非敏感 usage 记录；授权和目标快照在冻结前再次核验。
- Wiki 内容分流新增严格 mechanical maintenance 判定：仅正文和其他metadata逐字不变、来源列表无删除且只引用已注册材料的去重/补引用可标记自动资格；新页面、正文或结论变化仍人工。是否自动采用还需 profile 的 `auto_wiki_maintenance` 和后台完整授权重验。
- 验证：Core **157 tests / 33 files PASS**、plugin build PASS；Knowledge **11 tests / 4 files PASS**、typecheck/build PASS。全部为离线/mock transport契约验证，没有调用vLLM，也不宣称真实Wiki质量效果。
- 下一步：接受限 nanobot Skill evaluation job 和 effect receipt；随后完整隔离 E2E 与8125交付。

## 2026-09-01 09:48 续跑：三类冻结资产的受治理采用

- 从 `6ac85a3` 继续。Core 已接入统一受治理 writer：每次采用重新核验管理员/授权人、Team/Agent/目标写权限、递归来源读取权限、profile 范围、冻结 hash 与目标 base version；写入仅在全局 mutation boundary 内取得正式 permit，避免与旧 Skill/Memory 写入口并发穿透。
- Memory L1 只追加确定记录；L2/L3 按冻结文件 bundle 精确写入并核对。Skill 按冻结 Candidate artifact 精确 create/update。Wiki 通过固定私有 Knowledge bridge 做 snapshot/validate/apply/verify，浏览器不能传任意 URL/路径/命令；采用阶段不再次调用模型生成内容。
- 采用操作先持久化意图，写后必须 readback 核验才显示 APPLIED；重启 reconciliation 只核对，不盲目重复写。Skill 必须关联原 paired effect PASS（至少一项 newly_fixed、零 newly_broken）；Memory/Wiki 内容校验不冒充效果提升。
- 新增极窄 Memory 自动采用资格：只允许 owner task input 中逐字出现、长度不超过300、类型为 persona/work_fact、无指令/凭证特征的 L1 事实。资格由服务端规则决定，不使用模型置信度；auto_memory/profile/grant/权限任一不满足即转人工或阻止。自动采用失败不回退旧正式写。
- 原生 TencentDB/Tea 页面增加采用与只读恢复核对动作，仍未部署8125。自动化 admission 默认关闭；Skill 不自动采用，Wiki 语义变化仍人工。
- 验证：Core **155 tests / 32 files PASS**、plugin build PASS；Knowledge **9 tests / 4 files PASS**、typecheck/build PASS；Panel 3 tests/build、web build PASS（保留既有依赖和 bundle 警告）。
- **仍未完成**：Wiki 从真实来源到隔离候选的运行生成 bridge、受限 Skill 评测执行任务、完整三类生成/评测/审查/采用隔离 E2E、主8125备份更新与浏览器验收。下一步继续，不把本节点当完整交付。

## 2026-09-01 03:19 续跑：来源快照、内容校验与 Hub 操作

- 从 `829effc` 继续。Standalone Memory快照读取真实Team/Agent/user的L1及对应profile目录，不回退global；拒绝链接、错误scope、过大内容。L1生成前持久化源快照，模型前后复查变化。
- 生成完成自动排内容校验job；校验源引用、目标权限/范围、快照hash、L1来源及L2/L3整包路径/基础bytes。结果/候选状态/job完成同一transaction；过期STALE要求新candidate，重复新增DUPLICATE_NO_CHANGE不碰旧记忆。
- 内容PASS仅表示格式/来源引用/CAS合格；任意自然语言事实真伪/冲突仍HUMAN_REVIEW_REQUIRED、auto_eligible=false、demonstrates_improvement=false。Skill仍要求原paired效果评测；Wiki缺bridge明确待证据，不伪造PASS。
- 原生Tea页面新增来源/后续记录跳转、内容校验说明、独立retry按钮和运行中自动刷新；源快照不提供任务诊断按钮。没有MyUI。仅审查不执行采用。
- Core **141tests/27files PASS**、plugin build PASS；control严格0错误（101既有传递诊断）。Panel3tests/build、web build PASS；保留既有bundle/dependency警告。
- 新冻结隔离 `evolution-hub-20260901-r4`（Core30920/Hub30725）：setup/verify/validation/restart PASS。validation使用明确标题OFFLINE FIXTURE的操作员候选，真实HTTP后台校验+重复请求+审查双击409+历史FAIL+正式asset不变，零模型/采用。未登录此端口。快照后的源码仅补offline标签继承，不修改r4冻结运行。
- 当前仍未完成三类真实采用、Wiki接線、Memory高层运行续接及旧写并发治理；8125未更新。下一步先补旧写/配置切换的完整临界区与clear入口，避免只做调用前检查的race，再接实际采用。

## 2026-09-01 03:04 续跑：诊断到冻结候选的真实后台接线

- 起点 `993b2ee`，继续执行而非等待确认。明确task-complete→持久诊断→proposal job→真实L1 extractor已自动串起；Skill route接原Skill Review及只读过滤后的正式Skill视图。每次生成前预留candidate slots，每个模型/工具步骤预算与权限复查，批次原子冻结。
- 实际源/目标均查原MetadataService权限；目标快照变化拒绝继续。候选、生成job、模型/tool evidence继承目标ACL，并沿所有来源/父记录复查；共享任务不能暴露私有目标，绑定共享资产不能解除原私有轨迹限制。
- 新 `generation/retry` 只对终态失败建立独立receipt，不重跑诊断，不覆盖失败；未知费用/候选slot仍保守占用。重启遇已冻结batch仅恢复COMPLETED，不再调模型；未知在途改为RECONCILE_REQUIRED。
- Core **133tests/26files PASS**、plugin build PASS；新control严格类型检查零错误（101条既有传递依赖diagnostics）。Panel3tests/build PASS；diff check PASS。测试使用真实SQLite/权限/dispatcher/提取SDK加明确mock响应，不访问vLLM。
- 首轮私有权限负例误用不可更改owner的updateAsset，改为创建时设置私有owner；真实权限实现无绕过。首轮typecheck发现测试把原生llm_wiki类型误写wiki，已修fixture类型，没有改metadata契约。
- **仍未全量完成**：运行时Memory L2/L3后续生成、Wiki bridge、内容/效果receipt、三类真实采用、旧写在途并发及8125交付。Wiki job明确BLOCKED_GENERATION，不伪造候选。admission继续关闭、未改主8125或历史实验。

## 2026-09-01 02:46 续跑：候选额度与整批冻结

- 上一稳定提交 `6ad4e59`：候选独立模型执行器（Core123tests通过）。本节新增真正的候选slot预留：RUNNING proposal job先在SQLite预留daily_candidates剩余额度，runner每次模型/工具前验证allocation仍有效。
- Skill/L1/L2/L3生成封装现在必须持有效allocation；整批candidate和quota结算同一transaction，超额/内容不合法/中途SQL失败不留半批候选。已结算allocation不能重用；未知/中断保留预留，不假定免费，成功仅归还未使用slot。
- Core全量 **127tests/25files PASS**；control严格检查零错误（仍101条transitive依赖diagnostics）；diff check PASS。测试基于隔离SQLite、真实提取类和mock HTTP，没有vLLM调用。
- 尚未完成诊断→generation jobs自动续接、实际源资产ACL快照、Wiki接线和采用/完整Hub交付。下一步接generation dispatcher及目标解析；保持admission关闭，不能把封装测试当全链路。

## 2026-09-01 02:40 续跑：候选专用受预算执行器

- 前一稳定提交 `b2f6871`：旧入口写屏障+后台生命周期；本节继续实现，没有等待用户下一步。
- 新增 `proposal-runner.ts`，由独立私有review binding构造；复用现有AI SDK和Skill Review/L2/L3工具形态，但不复用聊天模型和默认文件系统工具。只有真实ShadowStorageBackend或固定Skill候选工具名单可运行，任意shell/缺shadow拒绝。
- 在实际HTTP请求前逐次预留token/model-call预算，包含工具后续轮次；SDK maxRetries=0，model/temperature/endpoint受核验，usage缺失不填0、5xx不重试，返回错模型/截断拒绝。每个模型step和工具result入持久记录，调用前及工具执行前复查授权/profile。
- 10项新增离线测试通过：真实AI SDK消费mock HTTP responses，调用真实Skill Review生成隔离candidate，以及L2/L3真实后处理生成冻结文件；预算第2轮阻断、缺usage、5xx、授权撤销、路径逃逸和任意工具拒绝。零真实provider访问，不等于真实模型效果成立。
- 首轮6项失败因旧jobTransition只接受diagnosis；扩为固定内部任务类型并复测。另1项测试误读event字段payload，按真实document结构修正断言。没有改冻结Oracle/Gate或模型协议。
- **尚未将诊断job接到三类生成job。** 下一步先补候选数量的调用前slot预留+冻结原子提交，再接持久generation dispatcher、ACL过滤的实际目标/源快照、Wiki服务侧隔离调用。当前helper不能代替完整接线，admission继续关闭。

## 2026-09-01 02:32 续跑：旧入口写屏障与生命周期

- 从 `e209649` 接续，仍未完成全量目标，未更新主8125。用户三个deployment改动保持原样。
- standalone 旧入口读取真实本地 metadata 实例目录中的治理配置（只读SQLite/WAL），不再仅查询default库；缺少身份/legacy placeholder无法绕过已开启scope，损坏或链接目录fail-closed。此目录只用于阻止旧写，不跨instance选择授权或搬运证据。
- Skill Review 在预检索/模型调用前被阻止；SkillCore create/update/patch/delete/writeFiles/removeFiles 按真实head owner阻止写入，读时资产自愈也受屏障约束。Memory L1/L2/L3 pipeline 在生成/缓存写前检查；v2/v3 Atomic update/delete、Scenario write/rm、Core write 同样检查。旧任务失败保留L0和游标，不退回直接写。**目前是拒绝旧直接写，候选生成接管尚未完成，不能宣称已完整转入候选。**
- L3 legacy默认scope原本可能undefined，新增负例暴露后做最小空scope修复。关闭治理的Skill Review走旧backend测试通过。
- metadata pool新增长期任务pin与并发open去重；活动任务库不可purge，LRU不关闭持有中的库。Gateway启动发现已有本地库并恢复任务，关闭先排空HTTP再停止dispatcher。无结果RUNNING仍不盲重放。
- Core全量 **113 tests / 23 files PASS**；plugin build PASS；control严格检查零错误。新HTTP回归引入更多旧路由依赖，当前transitive diagnostics=101，未声称全仓strict typecheck PASS。git diff --check PASS。
- 新独立 `evolution-hub-20260901-r2`（28920/28725）setup/verify/restart PASS，保留其冻结版本。最新 `evolution-hub-20260901-r3`（29920/29725）setup/verify/governance/restart PASS；隔离操作员种子临时打开测试profile以验证真实HTTP写屏障，始终无模型配置且admission=false，验后恢复disabled，审计历史保留；不是生产开关/真实模型运行。旧FAIL和正式资产快照不变。
- 当前仍不开放准入：需完成诊断→三类候选持久化接管、每步模型预算、配置切换与在途旧写的串行屏障、采用writer/权限/CAS/索引恢复、Wiki实际服务接线、评测执行器及完整UI交付。
- 下一步：接独立reviewer的受预算工具执行（仅候选/影子Storage工具），再续接诊断后的候选任务；不可用聊天模型runner或直接正式工具作fallback。继续避开vLLM，不重复定时任务。

## 2026-09-01 02:00 续跑：任务派发已接线，完整目标未完成

- 凌晨一次性 heartbeat 已触发并接续；未重复创建定时任务。Goal 最近宿主查询显示 `usageLimited`，本轮不兑换额度、不修改 Goal 状态，按已授权任务继续实际工程。
- 从 `395194d` 开始，接通 `task/complete → 原子 trace + job → 进程内 dispatcher → 独立 reviewer binding → diagnosis`；`diagnosis/retry` 明确生成独立、幂等的新任务，原失败保留。并非只新增 helper：Core HTTP/Gateway 生命周期已接线。
- 复盘配置从操作员指定的私有文件 `EVOLUTION_REVIEW_MODELS_FILE` 解析，绑定 instance/team/agent，独立于聊天模型；HTTP 不接受 endpoint/API Key。缺配置/关闭/准入不足不调用模型，预算调用前预留，权限与配置在执行前复查。
- SQLite reopen 测试证明 QUEUED 可继续、已有结果可恢复，RUNNING 无结果则 `RECONCILE_REQUIRED`，不盲重放、未知 usage 保留预留。当前 Gateway lazy instance 初始化时恢复；开机发现所有已有 instance、连接池驱逐/停止调度竞态仍需完善后才能开放准入。
- Core **100 tests/21 files PASS**，新增控制模块 strict typecheck 零错误（35既有依赖 diagnostics）；Core plugin build、Panel build/3tests、web build PASS。首次新增测试因种子用户省略底层要求的 auth_provider/external_id 失败，补全真实存储输入后通过；未改用户存储实现来迁就测试。
- 独立证据 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260901-r1`，Core27920/Hub27725，setup/verify/restart PASS；验证正式资产快照不变、历史v4 FAIL不变、显式host回执重复幂等/冲突拒绝、关闭状态持久化job、任意retry路径拒绝。测试回执明确 `NOT_RUN_OFFLINE_ACCEPTANCE`，不是模型运行。没有登录新端口。
- 准入仍关闭：三类候选生成续接、全部旧入口治理、正式writer与采用恢复、完整浏览器业务流程及8125交付仍未完成。不要将本节接通诊断称为完整自进化。
- 下一步已发现：Hub metadata 按 instance 分库，但 standalone Memory 部分调用仅持 default instance；治理必须能正确解析 Agent 的真实配置作用域，缺身份时 fail-closed，不能只在默认库查开关。继续核查 pipeline-factory/TdaiCore/SkillExtractor 与 metadata pool，再接治理。

## 2026-08-31 持续目标已启用（优先执行约定）

- 用户明确要求创建持续 Goal，把已批准的 MemoryHub Skill/Memory/Wiki 统一方案全部实现，不再每完成小步骤就停止等待“继续”。已通过应用 Goal 工具创建，状态 active；未设置额外 token budget。目标以应用当前 Goal 和最新用户指令为准。
- 完成定义是全部工程接线、旧写入口治理、安全/预算/冻结/恢复/审查/采用、完整隔离端到端验收，以及备份后的本机8125交付；不是计划写好、helper/test完成或六页显示。真实模型效果仍受“不调用/探测vLLM”约束，未验则保留阻塞，不伪报收益。
- 在当前任务创建一次性 heartbeat `memoryhub`：北京时间 **2026-09-01 02:00** 检查是否完成，未完成从首个未完成项继续；已完成不重复工作。不自行增加下一次定时任务。
- 定时任务与持续 Goal 不扩大操作权限。普通bug/测试失败自主修复；需凭证或人工决定的独立分支记录后先推进其他安全工作。不得push/PR/merge、正式资产Promotion、改旧实验协议或破坏用户deployment修改。
- 当前恢复点 `f83b01a`：原生六页与基础浏览器已验，运行编排、旧入口治理、三类真实采用接线、全链路验收与8125部署尚未完成。下一步直接做这些工程实现，不重新请求逐步授权或重复仅检查空页面。

## 2026-08-31 MemoryHub 自进化实施中（最新入口）

- 用户已批准完整 Skill/Memory/Wiki 统一方案并要求实施；最新补充：前端以 TencentDB 为主，不用 MyUI。
- branch `feat/evolution-candidate-refinement`；起始 HEAD `16b640c46a287cc33c0833df91188ce388827a3b`；本节随本轮基础实现小步提交，准确 HEAD 用 `git rev-parse HEAD` 读取。
- 新增 Core 控制记录/预算/权限、Panel 代理及 Hub 六页源码（沿用 Tea）。Core 全部87 tests、Panel3 tests、Knowledge8 tests PASS；Core/Panel/web build、Knowledge typecheck PASS。新增 control strict typecheck 零错误，既有 Core 依赖35 diagnostics 单列。
- Skill Review / Memory L1/L2/L3 / Wiki extract+merge 均已有隔离候选封装与离线测试；采用 coordinator 持久意图/核验/恢复只读测试通过。仍未完成旧入口治理和实际正式 writer 接线，不允许提前开启自动化。
- 本轮独立实例 r2 API+重启 PASS；最新 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260831-r4` Core26920 / Hub26725，真实历史 v4 FAIL + 冻结 diff 已导入，setup/verify PASS；重启结果见输出。r1/r3 失败保留（端口发布 / SHA前缀兼容），自己的失败容器停止但没删除。
- 用户本轮明确许可后，仅用临时测试账号登录24725；六页导航、历史详情/刷新、Playbook/审查子页和分类控件浏览器验收通过，console 无 error/warn。r2 的空候选/审查页不等于完整闭环通过；原始 trace 未导入明确显示。
- 浏览器发现实验长标题跨列，已用局部 Tea 按钮换行修复；独立 `evolution-browser-20260831-r1` 冻结预览在同一已授权24725验证：1280×720 下标题完全在单元格内，六页和 v4 FAIL 正常。预览仅复用隔离 r2 Core；不改旧运行文件，验完恢复原测试 Hub。截图与 JSON 在相应输出目录。
- 当前自动化明确 fail-closed：尚未完成所有旧写入口治理与采用恢复，不允许通过 profiles/save 开启。不是已完成真实闭环。
- 不调用/探测 vLLM；没有部署/重启主服务；8125 尚未更新。保留历史 v4 FAIL 和所有 Attempt。
- 用户 `deploy/global-images/start-memory-core.sh` 修改及两个 nanobot 未跟踪脚本保持原样。
- 详见 `docs/memoryhub-evolution-implementation.md` 已实现/待完成清单；继续完成普通工程工作，不因一个测试失败等待用户。

## 2026-08-31 避开vLLM的离线交付完成（最新入口）

- 用户最新要求：继续离线执行，完成后先总结并讨论；当前不调用/探测vLLM，不启动新的真实实验。
- branch `feat/evolution-candidate-refinement`；本轮起始HEAD `57c900f`。旧v4 FAIL、旧r4主INFRA/全部Probe保持原样，无Promotion/v5/生产写入。
- 已实现纯函数 `memory-context-policy.mjs`：NONE、精确legacy CONTENT_ONLY、SOURCE_SCOPED_METHODS_V2。v2只呈现有来源背景的work_method，并限制源任务固定细节；不读当前题/Oracle、不重写源Memory、不改默认Proxy。
- 当前有效离线设计包：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-memory-scope-design-20260831-r2`；bundle `04a6541bf1ae14f2a5bdcc780bf01b91a6be65c25400170ad9db3a192628c388`；DESIGN_FROZEN_NOT_EXECUTED，model_calls=0。
- 4 diagnostic：28-7/269-43/177-6/250-20；2 reserved confirmation：109-21/160-6；与旧训练/迁移任务互斥。6组Oracle正负控制通过；原fixture示例不修改；24-23尺寸不支持、66-24有公式，未放宽限制。
- 冻结三arm顺序/预算/判据；诊断全部可比且有改善/成本合格才运行预留确认；否则停止，不追加选择性Probe。此为新研究层，不修改旧Gate。
- v1块665字符/5条，v2块1030字符/2条，不能宣称更省tokens或已有效。source Memory hash与r4相同，十个旧result及索引证据hash均核验未变。
- r1设计包保留（bundle d77845aa...）：preflight默认development标签与reserved角色不一致；r2仅修正元数据角色再freeze，任务/Oracle/预算/policy不变，两版都未跑模型。
- 测试：31Python（含真实Docker、SDK mock）+17Node PASS；bundle validate、syntax/diff PASS。用户deployment修改和两个未跟踪脚本不碰。
- 报告 `docs/business-memory-scope-policy-offline.md`；项目回顾/讨论 `docs/project-state-and-discussion.md`。
- 未完成且不伪装完成：新research Proxy policy dispatch、运行身份/session/runtime物化与admission、真实模型对照。下一次先讨论；若恢复模型分支，先补runtime准入并freeze，再按协议执行，不把当前设计包当成已运行Attempt。

## 2026-08-31 业务 Memory 研究已执行与封存（最新恢复入口）

- 分支 `feat/evolution-candidate-refinement`，收口前HEAD `83ab635`；本节随本地收口提交。旧candidate v4仍FAIL，不生成v5、不Promotion、不改旧Suite/Gate。
- 最后有效实验记录（包含如实失败）：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4`，freeze `1fd417412dc56a378124b6a32be17fbc9c93dda3cd1abf94d18bbfcfdeac02a3`；6主run+4Probe完成，没有未运行待续的本协议run。
- 主研究状态 **INFRA_ERROR**：23-24双INFRA/incomparable；477-45双PASS/unchanged_success；91-34无记忆PASS/有记忆budgetFAIL/newly_broken。0fixed/1broken/1unchanged_success/1incomparable，不追认为PASS。
- 91-34主+Probe：none3PASS；memory1PASS、1budgetFAIL、1INFRA。所有有记忆workbook值正确，但不能证明可靠完成；额外格式输出、库源码检查、错误自检和单次length截断是观察到的成本路径，尚不能归因为某条Memory稳定触发。
- 主wire成本 none104,453tokens/16model/12tool；memory158,181/20/17（tokens+51.44%）；四Probe188,096tokens。整个r1–r4研究含失败/提取/诊断759,597tokens/101model，无重复计入复用形成trace。
- r4完整wire与隔离后审计PASS；三对主+两对Probe初始请求除随机workspace完全一致；Memory7条/hash不变；迁移L0=0、Skill=0、正式存储快照不变、已知高熵凭证日志扫描无命中。所有原INFRA/FAIL和晚到usage分开保存。
- 报告 `docs/business-memory-transfer-report.md`；证据 `study-report.json`、`supplementary-audit.json`、`evidence-index.json`、`hub-memory-visibility.json`。Hub22725实际L0=13/L1=7/L2=0/L3=0（形成任务）；不要求用户去旧19125空L2。
- 后续安全工作也已执行：只读Memory来源/scope诊断，2条method有固定列约束、5条召回content-only丢background；`memory-scope-diagnostic.json`，零新增模型，不修改快照/准入/生产。
- 测试27Python（含真实Docker）+8Node诊断+4Phase6 helper PASS，syntax/diff PASS。用户deployment修改/未跟踪脚本保留。
- 失败保留：r1计数/隐藏retry，r2抽取截断，r3arm标签泄漏INVALID_FAIRNESS，r4上述主/Probe失败；r1/r2容器和r3旧Proxy停止但可恢复，文件未删除。当前r3Core22920/Hub22725+r4Proxy23696保留。
- 下一自主研究候选：来源/适用条件保留与跨任务检索选择；若执行必须新revision并在模型前冻结，本次迁移题已见只能作诊断/回归，不再称新held-out。不要自动重跑当前已完成Attempt、追加Probe或为PASS扩预算；不动正式Hub/DB，不push/PR/merge。

## 2026-08-31 r4 主实验完成，Probe 收尾（最新入口）

- branch `feat/evolution-candidate-refinement`；HEAD `83ab635`（待审计收口本地提交）；current Candidate 仍 v4 FAIL，不生成新 Candidate。
- r4三对主结果已全部保留：23-24双INFRA/incomparable；477-45双PASS/unchanged_success；91-34 none PASS、memory budget FAIL/Oracle PASS/newly_broken。
- 当前冻结规则触发91-34两次/arm Probe，后台顺序执行。已完成memory-p1 PASS48,203tokens，none-p1 PASS44,319，none-p2 PASS46,506；memory-p2进行中。不要重复已有run或用Probe覆盖主结果。
- 91-34主Memory第3次扩大格式输出，第4/5次看库源码，第7次错写行数断言，第8次修正后到达预算；当前Probe未稳定复现这个链条，不轻率归因。
- 下一自主动作：确认最后Probe结果 → frozen study.mjs audit → workspace audit_study.mjs post → 完善 `docs/business-memory-transfer-report.md`，成本/公平性/隔离审计并本地commit。
- Hub22725鉴权API实查L0=13/L1=7/L2=0/L3=0；形成记忆而非迁移trace。不要让用户再看旧19125空L2。
- 测试：27Python（含真实Docker）+4独立audit helper+4Phase6 helper PASS；用户deployment三文件不碰。源码只增加只读证据分析，不修改冻结runtime/协议。

## 2026-08-31 Memory 迁移对照（进行中，优先恢复入口）

- **当前实际运行是 r4（替代下面 r3 进行状态）**：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4`；freeze `1fd417412dc56a378124b6a32be17fbc9c93dda3cd1abf94d18bbfcfdeac02a3`，独立 Proxy23696。
- r3发现SDK会将含none/memory的workspace路径放进system prompt，判为 `INVALID_FAIRNESS`。23-24-none已PASS但不用于收益推断；23-24-memory在途时停止调度进程，保留部分证据/输出；其余未启动。不会把被中断样本当成TASK_FAIL。
- r4为 `IMPLEMENTATION_FIX_RETRY`，只修workspace匿名化与完整pre-Proxy请求上下文采集。所有workspace位于`root/workspaces/<random hex>`，不含case/arm标签；真实runner+mock provider回归已验证实际system context不含条件标签。
- r4复用r3相同冻结7条Memory（hash不变），不重提取、不换题、不改模型/预算；仅新增Proxy接原隔离r3 Core22920/Hub22725。新session/新workspace；逻辑只读Memory、测试Task观测隔离。
- r4主transfer批次正在运行；完成后执行 frozen study.mjs probes/audit；新版源码 audit_study.mjs post 检查匿名化、晚到usage、非目标区域、泄漏扫描。当前没有可信最终收益结论。
- r4已完成23-24两arm：均300s，原status INFRA_ERROR；Memory工作簿Oracle PASS，无Memory未生成有效结果。不得将该pair算newly_fixed。477-45双方TASK_PASS，none25,793tokens vs memory26,325，各5model/4tool；最后91-34正在执行。
- 若运行中断：先检查是否仍有相同root的Python进程，再检查runs目录；只对没有目录的剩余run用新版源码 `study.mjs remaining ROOT` 恢复（内部仍运行冻结的Python/Oracle）。已有完整result跳过，partial目录仍拒绝覆盖。不能把已失败的INFRA当成待自动重试任务。

- **当前正在运行 r3 首次迁移对照**：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r3`，freeze `f584f655741854e2ff6f5497424f8c183b6c45b64bb9c94957c2fb79d4b1e972`，端口 22920/22696/22725/22924。
- r2 在修正计数后，343-20 仍 300s 超时，379-36 PASS；两个 L1 输出均4096tokens截断JSON、0条记忆。`attempt-status.json` 保留 INFRA_ERROR；迁移题尚未运行，未调题或扩预算。
- 最小格式诊断 HTTP200/33tokens，验证 vLLM0.19.0 支持 request-level non-thinking + JSON Schema。新增独立 `memory-producer-v2`，仅修改形成端序列化；实际任务 Agent thinking/model/budget 均未改变。
- r3 不重跑形成 Agent，冻结复用 r2 的完整原 trace（含失败），经原 Core L1 code prompt/parser 自动重提取7条。两次正常 stop，共18,200tokens。所有旧运行/快照未改；不是把 r2 改成成功。
- 当前 Memory SHA `c4e564dee12df5747eea335edd157399c7d758260648535fe90fbf67d1dea6b1`。来源预审完成，发现清空H列被过度概括成方法的质量风险；不手工修记忆，严格按新任务优先的历史块注入，另查非目标区域。
- 形成 trace 的晚到 upstream responses 已完整核账：72,271tokens /11model/8tool；r2原 INFRA_ERROR 不改写。后续报告单列形成、提取和实际迁移成本。
- 下一动作：检查 r3 `runs/*/result.json`，等待当前 `transfer` 完成后执行 frozen `study.mjs probes`、`audit` 和附加隔离/成本审计；不能重复主 run。r1/r2不用再运行。

- **最新实现 retry：r2** `/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r2`；freeze `8d5aae5b64a1fe4dbf0bb27e2fad1f23b21959e958d2a4ae60a96000f0ab6007`；端口 21920/21696/21725/21924。正在重新运行 formation。
- r1 保留 `INFRA_ERROR`：343-20 300s 超时，nanobot 外层 120s 隐式重试使模型调用/usage 与 iteration hook 不一致；379-36 TASK_PASS，41,011 tokens / 6 model / 5 tool。原 L1 自动提取 10 条成功，但未做迁移，不拿不完整形成成本作为有效收益证据。
- `BoundedProvider` 是项目侧 SDK 扩展，实际 provider 调用处计数、禁隐式 retry，transport timeout 与原 300s 对齐，Proxy 二次限流；题目/模型/预算/Oracle/检索/判断标准不变。25 tests PASS，包含真实 SDK composition + mock provider 的重试反例。
- r1 `attempt-status.json` 与 r2 `attempt-lineage.json` 记录因果，不覆盖历史。本地设计实现 commit `65aaeaa`；修复待小步提交。

- 用户授权“有下一步就继续”，本轮独立实验不再等待配置审批；旧 Candidate v4 / Gate / Suite 不变。
- branch `feat/evolution-candidate-refinement`，起始 HEAD `6119a8015047aa15cb1fd0e21906dee551e7f92a`；用户 deployment 修改保留。
- 新 Attempt：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r1`，全资产 freeze hash `d0cf9c0ba4afac27ed68dcbd642642a527550dcd0b3145bfb798b7563f72f913`；独立端口 20920/20696/20725/20924。
- 已冻结经验任务 `343-20`、`379-36`；迁移任务 `23-24`、`477-45`、`91-34`。选题依据仅题面/输入结构和 Oracle 可支持范围，不使用新模型结果或 golden 值反向选题。
- 新协议 `protocol-transfer-v1.json`：8 model / 8 tool / 4096 output per call / 300s；双方一致；旧 smoke 6/6/240 不变。新研究不冒用旧 Skill fingerprint / Gate。
- 正在执行两项真实 formation task。之后只将其题面、真实工具和 final output 经 L0 API 交给原有 L1 code-mode extractor；禁止向 Memory 写迁移题 trace 或参考答案。
- 提取上限两次；全量 L1 冻结后经独立业务 Proxy 跨任务只读召回，对照无历史记忆。空提取不人工补写；旧 Evaluation 隔离不解除。
- 23 项 Python 单元/真实 Docker tests + 4 项 Phase6 helper tests PASS；syntax/diff PASS。新增 sandbox 异常解锁回归。
- 下一恢复动作：检查 r1 的 `runs/*/result.json` 和 `proxy-events.jsonl`，不要重跑/覆盖已有 formation；按 frozen `study.mjs` 的 snapshot → transfer → probes → audit 顺序继续。尚未取得迁移收益结论。

## 2026-08-31 真实表格业务 smoke

- 用户明确回复“这个问题不需要我审查，你直接做就是了”，独立测试配置改为代理自主决定；协议 `business-xlsx-smoke-v1` 已冻结并执行。
- 本地 commit 前有效 Attempt：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-20260831-r1`。新实例端口 19920/19696/19725/19924，正式和旧实例不变。
- 真实 nanobot + qwen3.8-27b 完成 `141-20`：TASK_PASS，20,462 input / 2,251 output / 22,713 total tokens，5 model calls，4 tool calls，72,069 ms；输出 SHA-256 `e58016e6dfb9a220b5fa4242c1933296a3899c5db970cc8c6d9337f94c3b88ce`。
- 输出：[result.xlsx](/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-20260831-r1/run/outputs/result.xlsx)。Oracle 38 cells 零差异，全 workbook 值审计一致；输入 hash 不变。
- Admission 负例、模型/usage/tool evidence、Hub Task、正式存储不变、L0=0、Skill=0、日志高熵凭证扫描均通过。本轮刻意禁用 Memory；不证明 Memory/Skill 收益。
- 首次 audit 因 4 字符 provider key 与日志数字子串误匹配而 FAILED；`audit-failure-r1.json` 保留。仅修审计规则，IMPLEMENTATION_FIX_RETRY PASS，没有重跑主 Agent。
- 报告：[真实业务 smoke](docs/business-xlsx-smoke-report.md)。旧 v4 FAIL、Suite/Gate/Attempt 不变；不生成 v5、不 Promotion。
- 下一自主问题是 B4/B5：冻结经验形成/迁移任务和 Memory 来源/快照规则，再做 Memory 有/无对照。不能用本次三行小样例证明泛化，不能根据本次输出选题。

## 当前恢复入口（2026-08-31 业务场景规划）

### 历史快照：业务离线 admission（已被上方真实 smoke 状态替代）

- 用户授权“规划完开始执行”，并允许在 nanobot 不适用时自行换合适任务；已执行 B0 和 B1/B2 的离线部分，不只是写计划。
- 固定 `141-20` archive/输入与 reference，真实样例无公式；SDK ToolRegistry + 真实容器 XLSX 读写/隔离通过，暂无换题依据。该样例只有三个数据行并有高亮提示，仅作开发 smoke。
- 最近业务证据：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-preflight-uo9rAx68/validation-r1`，OFFLINE_ADMISSION PASS；18 项新增测试 + 4 项 Phase 6 helper 回归 PASS。model_calls=0，不是 Agent.run 或真实业务完成。
- 实现和差异见 [离线 admission 报告](docs/business-memory-offline-admission-report.md) 与 `scripts/business-memory/README.md`。unchanged-copy 是被 Oracle 拒绝的预期负例，不能当对账成果展示。
- 模型只读检查可达。nanobot 全局默认已变成 auto/Claude/0.1，新配置映射显式固定 vllm/qwen3.8-27b/0，不继承、不改默认；正式真实 run 仍需观测核对。
- 当时 R0 为 REVIEW_REQUIRED：曾提交 `protocol-smoke.draft.json`，尚未实现 B3。用户后续授权及真实结果以上方最新状态为准；B4/B5 Memory 对照仍未启动。
- 下一动作：若收到 R0 决定，记录批准引用，继续真实 runner/独立链路实现、测试、freeze 和 smoke；否则保留当前离线交付。不要重复下载或覆盖 validation-r1。
- 失败保留：下载直连/HF 超时，经既有 Mac 代理解决；ruff 不存在，未声称 lint PASS。原 v4 FAIL/旧 Attempt/生产数据不变，用户 deployment diff 保留。

- 当前实查 branch `feat/evolution-candidate-refinement`，HEAD `ff1f078d45e4699762292d092759fd5c24a24d5b`；旧结论/Attempt/候选不变。恢复时以本节为当前入口；下面旧阶段的“待登录/下一步”等条目是历史快照，不是重复执行的待办。
- 用户已登录测试 Hub，并人工验证基础记忆可用。不再将“等待登录/再验证学校信息”作为首要动作；这不替代特定实验的 recall/injection trace 验收，不重写 Phase 6 r2 的历史报告。
- 当前业务场景：SpreadsheetBench Verified `141-20`，跨表发票对账，选型/开发样例而非 held-out；workbook 未预检，未运行模型。
- 已完成本轮实现规划：[业务 Memory 连续实施计划](docs/business-memory-execution-plan.md)。B0–B7 是待实施队列，不是已完成工程。
- 下一动作：B0 固定来源/输入/评分/依赖只读预检；之后按授权连续执行，不逐步询问。新业务 toolset、预算与 Memory 对照条件集中 R0 审查，当前尚未批准。
- 当前假设：现有窄 adapter、fixture/custom oracle 和 SDK hooks 能局部复用；Phase 6 文本 smoke 不能直接证明 XLSX 工具可用，旧 Evaluation 禁止普通 recall 的隔离不能解除。
- 最近有效链路证据仍为 `phase6-secure-20260831-r2`；最近失败仍为 secure r1；本轮没有新的 Attempt。基础记忆反馈不证明业务收益、云端 TencentDB 或 v4 可 Promotion。
- 本轮只改规划文档/checkpoint。用户 deployment 修改及两个未跟踪脚本保留，不暂存、不修改；不创建新的自动化。

- Branch: feat/evolution-candidate-refinement
- Current candidate: phase5b-candidate-v4 (sha256:28537763d10ace8648ef8631801dac68962a68a11e56890c60869b709f62a075)
- Held-out v2 is preserved but invalid due to the HO-07 unsupported tool enum. Valid held-out v3 suite hash: sha256:03510146cf5726a8b9e44aa02b3e4a64a942c323ac72950a86bc8bc54f8831d2.
- v3 main had 0 newly_fixed and 0 newly_broken; required probes show a stable HO-08 Candidate regression (0/3 vs Baseline 2/3 pass).
- Conclusion: promotion_evidence_v2 FAIL. Do not generate v5 or promote v4.
- Completed: held-out fixtures, freeze guards, real v2/v3 attempts and probes, evidence report. All raw evidence is in outputs/heldout-protocol-v2 and outputs/heldout-protocol-v3.
- Held-out work remains stopped; no v5 or protocol changes. User authorized a separate Phase 6 integration acceptance on 2026-08-30.

## Phase 6 integration acceptance (local backend complete)

- Starting HEAD: 73dd5abc109aed952fa541750eff46e9c40be694.
- Scope: storage CRUD/search/cleanup, real nanobot → MemoryProxy → MemoryCore, Hub visibility and evaluation isolation. No cloud TencentDB claim: running backend is standalone SQLite, embedding none.
- Production containers/ports 8420/8096/8125 are untouched. Existing user deployment edits must not be staged.
- Isolated test containers: phase6-core / phase6-proxy / phase6-hub; localhost ports 18420 / 18096 / 18125.
- Scripts: scripts/phase6/. No imports into default production startup; source-mounted Proxy includes existing Phase 4 guards.
- First setup retained at /Users/lsmax/Documents/Codex/2026-08-29/n/outputs/phase6-integration-20260830-r1. Docker bind startup remained Created; no model run. Renamed container phase6-core-incomplete-r1, retained its files.
- Valid attempt: /Users/lsmax/Coder/phase6-artifacts/outputs/phase6-integration-20260830-r5. Source hashes and nanobot revision are in source-freeze.json.
- Real normal smoke: PASS, 7755 tokens, 2 model calls, 1 tool call, Hub L0=3.
- Real evaluation smoke: PASS, 7999 tokens, 2 model calls, 1 tool call, actual Skill injection on both requests, Hub L0=0, Skill assets=0.
- Audit: Core files/WAL and service logs contain no evaluation canary; production Core 28 file hashes unchanged; wrong namespace/unbound requests/bridge writes rejected.
- Failures retained: r2 copy/whitespace loop timed out; r3 local TDZ implementation bug; r4 multiline injection evidence checker bug. r2–r4 containers stopped and renamed; r5 containers left running.
- Tests: integration helper 3 PASS; Proxy evaluation tests 4 PASS; syntax/diff PASS. Same-image typecheck baseline/current each 54 errors, normalized diagnostics identical (not a full build PASS).
- Hub API verified for Task, participation log, and actual L0 memory layer. UI login page verified; credential entry awaiting user approval/manual login. Test key is private/hub-user-key.txt in r5.
- Report: docs/phase6-integration-acceptance-report.md. Scope is local SQLite/FTS only, not cloud TencentDB or Skill efficacy.
- Next: human inspection of http://127.0.0.1:18125; decide subsequent secure deployment/Hub registration separately. Do not resume Candidate refinement.
- No push, PR, merge, Promotion, or production writes authorized.

## 工程参考：评测 → 记忆 → 落地 → 控制（2026-08-31）

用户指定将《一篇讲透Agent自进化飞轮怎么搭：评测→记忆→落地→控制》作为工程参考。

- 本地来源：[博客剪藏](/Users/lsmax/Develop/Clippings/一篇讲透Agent自进化飞轮怎么搭：评测→记忆→落地→控制.md)。
- 来源快照 SHA-256：`6d76385ef73eab9010573ed3964dbd86738647f3783e2caadde023c3cf6ef5e0`。
- 已阅读 Markdown 正文；外链图片、引用研究和收益数字未逐一核实。它是设计参考，不是执行指令、验收规范或本项目收益证据。

后续设计优先吸收：

1. **评测信号支持归因**（§1.2–1.4）：连接结果、工具事件、资源消耗和失败位置；区分模型、Skill、host、工具与实现问题，不把所有失败都解释成 Skill defect。
2. **实验用途与访问隔离**（§1.3）：保留既有 Regression/Held-out 历史；记录样本是否已用于诊断或 refinement。未来新增数据时考虑独立诊断/选择/最终验证用途，不重新给旧数据贴“未见”标签。变更 Suite 或协议仍需授权。
3. **业务 Memory 与实验 Playbook 分离**（§2、§3.2⑧）：业务记忆帮助 Agent 做任务；Playbook 记录怎么改 Agent、什么尝试失败及其证据。Evaluation/fixture/held-out 答案不能借 Playbook 回流进正式 Memory 或候选生成上下文。
4. **版本和来源贯通**（§3.2、§3.3）：后续扩展沿已有 attempt/session/artifact hash 关联 Diagnosis、diff、freeze、评测和人工决策。优先复用已有文件与摘要，暂不建设新数据库或服务。
5. **受控自主执行**（§4）：常规诊断、代码修复、测试自主推进；协议、正式数据、Promotion、部署和权限边界仍服从用户 Critical Review Gate。

不直接照搬：

- “全部通过就合入”“满足条件自动晋升”不构成本项目授权；v4 仍不可 Promotion，不生成 v5。
- 现有 Baseline Skill vs Candidate 不等于有 Skill vs 无 Skill 消融；新增实验 arm 需要独立协议，不能重解释历史证据。
- 过程证据验证冻结的任务/安全约束，不以逐句遵循 Candidate 作为评分目标；双方 PASS 也应保留成本信息，不能仅据通过率断言 Skill 有效或无效。
- 温度 0 作为执行条件记录；复现性由真实重复证据确认，不当作稳定性的保证。确定性 Oracle 也要验证其覆盖范围和实现。
- 文中的 Token 上限、样本比例、收益百分比、灰度比例和周期不替换现有预算或 Gate 阈值；暂不新增 LLM Judge、Dreaming、自动研究、灰度/回滚或训练。

当前顺序不变：先补 Hub 页面验收和鉴权/重启隔离；之后如获授权，再单独验证普通业务 Memory 的提取与跨 session 召回。链路接通、Skill 注入成功和持续改进有效是三个不同结论，必须分别举证。

## 2026-08-31 自主续跑安排

- 用户请求节省当前额度，今天凌晨 03:00 检查本任务，未完成则继续；一次性 heartbeat `tencentdb` 已创建，时区 Asia/Shanghai。
- 续跑入口：[自主任务计划](docs/autonomous-continuation-plan.md)。01–09 是 Phase 6 本地隔离验收收尾；10–15 只是后备规划，不能自动越过授权边界。
- 规划基线 HEAD：`ea1080392cddca44bf4bb16b1ca6c75f7c3af8fc`；恢复时重新查询当前 HEAD/Git 状态。
- 当前假设：API 已有链路证据，但 UI、非空 gateway 鉴权和重启失效关闭仍有缺口；先查证再最小修复。
- 本轮只完成调度和计划，不新增真实实验。最近有效证据仍为 r5；历史失败不变。
- 下一可自主动作：计划 01 只读体检，再查 03/04；UI 凭证未许可不阻断其他独立步骤。不新建 Candidate，不改研究协议，不改生产部署。
- 续跑停止条件：完成已授权部分，或 Critical Review/外部硬阻塞；分项报告未验证内容，不将计划完成冒充工程完成。

## 2026-08-31 03:00 实际续跑（本地可执行部分完成）

- 起始 HEAD：`8276e8a02caff0b5c6131988204ae3c128c00978`，分支不变。仅本地 Phase 6 隔离验收收尾。
- 已核查：provider 可达，模型仍 qwen3.8-27b；修改前 r5 冻结源码 hash 一致；旧 Hub 两个 Task API 回读 HTTP 200。
- 实现缺口：auth/verify 缺 gateway Bearer；显式启用鉴权缺 URL 会静默关闭；验收 admission 未检查 Evaluation 绑定存活。
- 已最小修复，helper 4 tests PASS，固定 Proxy 镜像 auth/override 9 tests PASS；首次 auth 回归测试曾 2 FAIL，修复后通过。本机 js-yaml 缺失，未安装依赖，使用固定镜像验证。
- 最近失败：secure r1，RawYamlConfig 漏声明导致类型检查 55 vs 54；无 LLM run，保留证据和停止的容器。
- 最近有效 Attempt：`/Users/lsmax/Coder/phase6-artifacts/outputs/phase6-secure-20260831-r2`，IMPLEMENTATION_FIX_RETRY。新实例独立命名，端口 19420/19096/19125/19424；不覆盖旧 r5。
- storage/services/security/restart/normal/evaluation/audit/Hub API 均 PASS；normal 7735 tokens、evaluation 7881 tokens，各 2 model calls/1 tool call；Hub L0 分别 3/0；Skill 零新增；正式 30 文件 hash 不变。
- 非空 gateway 拒绝与无绑定重启拒绝均通过；运行源码已复制冻结，主 Proxy 可信重绑后真实 Skill 注入通过。全仓类型检查仍 54 个既有错误，无新增。
- 报告：[鉴权与重启隔离验收](docs/phase6-security-restart-acceptance-report.md)。本地可执行工作已完成，02 UI 待许可，不把 API PASS 写成 UI PASS。
- 下一步：用户登录独立 Hub 19125 或明确允许测试 key 的 UI 使用后验收；不自行进入后备阶段。故障容器已停止并保留，r2 三件套保留运行。
- UI 仍待登录许可；v4/研究协议/正式服务不变，用户 deployment 修改保留。
- 已验证代码本地 commit：`e9db7389ad3058270874af23007fd969ddc5217c`。报告与操作说明随后单独提交；未 push。
- 一次性 `tencentdb` heartbeat 已于本轮检查/续跑后删除（工具确认 deleted），不创建后续调度；待权限项不会被自动反复尝试。

## 2026-09-01 MemoryHub 自进化治理并发边界

- 分支仍为 `feat/evolution-candidate-refinement`；本节基线 HEAD `f96ced7`。用户 deployment 脚本改动仍排除在本轮提交之外。
- standalone Core 的原生 Skill、Skill Review、L1/L2/L3、Memory 删除及元数据归档写路径已接入同一进程内的可重入 mutation boundary；开启治理配置会等待已开始的旧写入结束，之后的新旧直写由 profile 拦截。
- 正式采用使用与持久化 operation id、冻结 candidate hash、Team/Agent/layer 精确匹配的短期 permit；permit 只在共享边界内生效，不能关闭治理或扩大作用域。
- 批量清空在首个删除前预检全部目标；异步版本清理和 Skill 资产钩子纳入同一 lease，避免配置切换后尾部任务越过治理。
- 限制：这是当前本地 standalone 的单进程边界，不是云端/多副本分布式锁；不能据此宣称生产部署完成。
- 验证：MemoryCore 28 files / 146 tests PASS，plugin build PASS，新增并发与正式 permit 定向测试 15 PASS；`git diff --check` PASS。
- 下一自主动作：小步提交本边界；继续实现三类冻结候选的生产采用 port、运行时授权/基线/hash/校验证据核验、幂等写入与只读恢复，然后再做独立实例和 8125 主 Hub 验收。自动化仍默认关闭；没有调用 vLLM、没有采用正式资产。
