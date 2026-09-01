# MemoryHub 自进化实施记录

状态：LOCAL_STANDALONE_DELIVERED；主 8125 已交付，真实 LLM 效果仍明确 BLOCKED。2026-09-01。

## Memory L1/L2/L3 运行闭环补验与主 Hub r2（2026-09-01 20:10）

最终完成审计发现，上一版 task-complete 运行路径只自动生成 L1，L2/L3 虽有隔离 proposal helper 和正式写屏障，却没有被同一运行任务调用。现已改为在正式 Memory 快照具备输入时，由同一个受预算 runner 构造 L1/L2/L3 payload，并在一个 SQLite transaction 中整批冻结或全部不冻结。L2 只消费运行开始时已有的正式 L1；L3 只消费已有正式 scene/index，避免同一轮候选互相喂入而绕过审查。

新隔离实例 `evolution-hub-20260901-r12` 使用三个独立 task-complete 回执证明顺序闭环：L1 自动采用并读回；第二个任务产生 L2，内容校验后人工采用并读回 scene；第三个任务产生 L3，人工采用并读回 persona。三层 adoption、Wiki adoption、Skill evaluator 阻塞和 v4 历史 FAIL 均在服务重启后保持。fixture 是确定性离线 OpenAI-compatible transport，只证明编排与控制，不代表真实模型效果。

主 8125 已在第二份停服备份后切换到冻结 runtime `memoryhub-main-20260901-r2`。重建初次遗漏原 Compose network alias，浏览器实际暴露 Team 列表 502；恢复 `memory-core` / `memory-hub` alias 后，六页、v4 FAIL、专用 Team、default-team 原 Memory 四层和顺序重启全部复验通过。主环境仍 `EVOLUTION_AUTOMATION_ADMITTED=0`，没有 review/evaluation binding，没有调用 vLLM，也没有测试写入正式资产。

最终回归为 Core 166 tests / 37 files、Panel 3 tests、Knowledge 11 tests；三项目相关构建、控制代码 strict 检查和脚本语法均通过。

## 主 8125 首次交付（2026-09-01 15:45）

现有本机 MemoryHub 已在一致性备份后更新。原 Core/Hub volumes、管理员登录、default-team 和 Chat Memory 均保留；TencentDB / Tea 原生侧边栏现在包含六个自进化页面。专用 `自进化历史 / TEST ONLY` Team 展示真实 v4 `FAIL / NO_NEW_FIX` 和只读 frozen Candidate，不能审查或采用。

主环境没有模型/评测 binding，且 `EVOLUTION_AUTOMATION_ADMITTED=0`，因此只能查看证据和关闭状态配置。浏览器明确显示未通过运行准入，不会把内容校验或离线 fixture 包装成 Agent 效果。Code Graph 及原资产页面未改变。

Docker Hub token endpoint 在交付时超时，无法构建新的可分发镜像。本机因此复用原镜像中的依赖，只读挂载经过测试并记录 hash 的 Core / Panel / Knowledge 冻结产物；这满足当前 standalone 交付，但不是云端或镜像发布验收。备份、重建和排障命令见 `docs/memoryhub-evolution-runbook.md`，完整证据矩阵见 `docs/memoryhub-evolution-acceptance-report.md`。

## 完整隔离端到端验收（2026-09-01 15:24）

新冻结实例 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260901-r11` 已完成真实 Core / Panel / Knowledge 联合验收。它不连接 vLLM，独立端口为 Core 37920、Hub 37725；确定性离线模型 fixture 明确只验证控制流，不能作为真实模型效果证据。

- Memory：明确 task-complete 触发复盘和候选，低风险 L1 事实必须逐字来自 owner 输入；后台资格和授权通过后真实采用，正式读取可见。
- Wiki：从真实 Knowledge 页面快照构造冻结候选，内容校验后人工批准；正式应用冻结 bytes、索引、readback 全部成功，重复 apply 返回同一结果。
- Skill：内容校验正确要求效果证据。隔离 evaluator 故意无可执行配置，任务明确 `BLOCKED_EVALUATOR_CONFIGURATION`；审批、采用均被拒绝，正式 Skill 未变化。
- 可靠性：重复 task-complete 幂等；错误 key、跨 Team、冲突 replay 和任意 retry 路径被拒；三类状态及正式内容在顺序重启后读回；v4 历史仍为 `FAIL / NO_NEW_FIX`。

验收期间发现 standalone SkillCore 的资产同步 hook 错用固定 `default` metadata instance。修复后按当前 HTTP service ID 通过 AsyncLocalStorage 选择实例，并用并发测试证明请求上下文不串租户。Core 164 tests、Panel 3 tests、Knowledge 11 tests和全部相关构建通过。

此前 r5-r10 的失败目录和 receipt 均保留，不作为成功结果覆盖：它们分别暴露 Skill fixture 格式、tenant metadata、快速状态迁移轮询、Knowledge 运行产物挂载、Knowledge URL 拼接以及 Docker 同时重启内存压力问题。主 8125 尚未更新；下一步必须先备份再交付，初始 automation 仍关闭。

## 最新腾讯原生配置界面（2026-09-01 15:04）

8125 的目标界面继续沿用 TencentDB / Tea，而不是 MyUI。新增的 `profiles/options` 由 Core 按当前管理员、Agent 固定资产和写权限计算：前端只能选择真实绑定的 Skill、Chat Memory、LLM Wiki，Code Graph 不出现；review/evaluation 下拉只显示操作员受限配置的 ID，不把 endpoint、文件路径或 secret 发给浏览器。

启用治理不再只是保存预算草案。后台强制 admission、三项每日预算、独立复盘模型、每类固定目标和可用正式 writer；Skill 还要求固定评测配置。进入共享 mutation boundary 后再次核验绑定及权限，避免管理员或目标资产在排队期间发生变化。前端可配置三类范围、固定资产、Memory 低风险事实自动采用与 Wiki 机械引用维护，但后台规则仍是最终裁决者。

Core 163 tests、Panel 3 tests、Knowledge 11 tests及 Panel/Knowledge/前端构建通过；新增 control strict 检查无错误。Core 聚合 build 仍遇到仓库既有 `scripts/seed-v2/tsconfig.json` 缺失，plugin 构建本身通过。本节没有启用主 Hub、没有调用模型或正式采用资产；下一步是独立全流程 E2E。

## 最新 Skill 评测任务（2026-09-01 14:51）

Skill 候选已接入持久受限 evaluation job。配置仅来自操作员0600文件，绑定instance/team/agent；浏览器只能提交候选ID，不能指定命令、路径、模型或Suite。首版只允许冻结的 AC_REGRESSION_V1 和其目标 `skl-workspace`，其他Skill显示没有匹配Suite，绝不临时修改考试。

执行复用已有真实 nanobot adapter、MinimalEvaluationRunner、deterministic Oracle、Pair和Gate；Baseline精确读取正式base version，Candidate bytes/hash复核，每arm独立workspace/session。完整最大成本在执行前预留，INFRA或usage缺失保持保守计费。结果作为独立runtime Attempt保存，只有 Gate PASS、至少一项newly_fixed且零newly_broken才允许Skill人工审查；不自动Promotion。

Core161 tests、control strict零新增错误、Panel/web构建通过。本节未调用vLLM，生产evaluation binding仍未启用；需要隔离环境用明确offline/fake transport先验收状态机，再在服务恢复后才可产生真实效果证据。

## 最新 Wiki 运行接线（2026-09-01 14:42）

Wiki `wiki_gap` 已从持久 proposal job 接到固定 Core→Knowledge 私有 bridge。目标必须是 profile 中唯一、双方可读写的 `llm_wiki`；来源只能由 Knowledge 从该 Wiki 已登记的 `raw/sources/*` 派生，HTTP 不能指定任意来源路径。原生 extract+merge 在隔离副本完成，最终页面 bytes 冻结为统一候选，正式 Wiki 在采用前不变。

Core 在调用前为最多8个 Wiki 内部模型步骤预留整个 token/model-call ceiling；Knowledge 强制 temperature=0、无 SDK retry、逐次 context/output/call-count上限和完整usage。丢失usage不填0且保留保守预留。模型secret不进入记录；步骤记录只保存model/label/usage/hash。

Wiki 自动资格只限正文及其他metadata完全不变、来源无删除且来自现有导入材料的引用去重/补引用；所有新知识和正文/结论变化仍要求人工。此节157项Core与11项Knowledge测试及构建通过，传输和模型均为显式offline double；真实模型闭环仍未运行。

## 最新采用接线（2026-09-01 09:48）

三类冻结资产已连接真实受治理 writer。采用前后均重验身份、profile 授权、目标 ACL、来源链、冻结内容和 base version；写入与旧入口共享全局 mutation boundary。Memory L1/L2/L3、SkillCore 及 MemoryKnowledge Wiki 均以冻结 bytes 写入，Wiki 采用不会再次调用模型。持久操作意图、readback 核对、重启 reconciliation、双击幂等和过期拒绝已实现。

Skill 仍需真实 paired effect receipt 才能审批；Memory/Wiki 的 content validation 不会展示为能力提升。Memory 仅对 owner 输入中逐字出现的低风险 persona/work_fact L1 事实提供服务端 auto eligibility，且仍要求管理员预授权、预算、完整权限及正式 writer；模型自报置信度不起作用。自动采用失败不回退旧写。

Core155 tests、Knowledge9 tests及三项目构建通过。自动化仍默认关闭，8125 尚未更新；Wiki运行生成、受限 Skill evaluator、完整隔离E2E和主Hub浏览器交付继续作为未完成项。

## 最新运行接线（2026-09-01 03:04）

03:19补充：Memory实际来源快照、生成后自动内容校验job、版本过期/重复新增/伪造引用拒绝已接入。自然语言冲突不冒充已确定，保持人工审查、auto_eligible=false；界面单列内容校验并支持来源链与独立retry。Core141tests/Panel3tests及构建通过。新隔离r4（30920/30725）真实HTTP的validation/review/幂等/重启通过；候选为明确OFFLINE FIXTURE、零模型且不采用，不是业务效果证据。后续真实采用和8125交付仍未完成。

明确任务完成现已自动衔接诊断和持久proposal job；Memory L1用真实提取类在候选区冻结，Skill复用原Review。模型为独立binding，每次HTTP预留，候选数量在生成前预留且整批原子结算。失败通过`generation/retry`独立重试；已冻结的中断job仅核对恢复，不重复生成。

源/目标采用原生Metadata权限，候选、工具及模型evidence继承目标ACL并递归验证来源。新测试覆盖共享任务读取私有目标时不向其他管理员暴露衍生物，以及共享目标不能解除私有原轨迹限制。Core133tests、plugin build、Panel3tests/build通过；control类型检查0错误，传递依赖仍101条，不代表全仓strict通过。

以下旧节中的数字是阶段快照。当前仍待L2/L3运行接线、Wiki完整bridge、校验/采用/并发/8125交付；只有helper已完成不能替代端到端。所有模型响应仍为显式测试double，admission关闭，不调用vLLM。

## 2026-09-01 后端接线进展

- `task/complete` 在同一 metadata SQLite transaction 写入 trace 和诊断 job，响应后唤醒进程内串行 dispatcher；不新增服务或队列基础设施。重复完成上报不重跑模型。
- 复盘模型是操作员配置的独立 binding：通过 `EVOLUTION_REVIEW_MODELS_FILE` 指定绝对路径的0600 JSON文件，数组每项含 `id / instance_id / team_id / agent_id / config`。config 使用已有 `ReviewModelConfig`（provider/model/base_url/api_key/max_output_tokens/token_ceiling/timeout_ms/temperature=0/fallback=false）。Agent profile 可保存 `review_model_id`；目前 UI 保存草案会保留该字段，尚未提供完整绑定选择器。
- 配置文件只在服务端读取；HTTP 不能提交任意文件路径、endpoint 或 secret。记录仅包含绑定 fingerprint 与实际模型，不保存 API Key，不继承聊天配置。文件缺失、不安全权限、配置不完整均阻止调用；当前没有设置真实 binding，也未调用 vLLM。
- 执行前再次验证 Team/Agent/owner/admin grant、source读取权限、profile与binding hash；每次模型调用前使用原预算账本预留。失败独立保留，未知用量不记零；`diagnosis/retry` 用新 request_id 创建独立任务，不能改写原任务。
- 存储重开后 QUEUED 可执行，RUNNING 已有诊断结果则恢复完成，没有结果则要求核对，不自动重放。Gateway 在该 instance 首次请求时懒初始化恢复；完整启动发现和 metadata LRU 生命周期保护尚未完成，不据此宣称全部服务重启场景通过。
- Core100 tests/21 files，Panel3 tests，Core plugin/Panel/web builds PASS；control类型检查零新增错误。新增 `dispatcher.test.ts` 使用真实SQLite/服务入口加明确的离线模型 double，不是实际LLM效果证据。
- 新隔离 `evolution-hub-20260901-r1`（27920/27725）setup/verify/restart PASS；包括 host完成幂等、持久化blocked job、冲突与任意retry路径拒绝、正式资产不变和历史FAIL保留。测试回执明确未运行模型；未对新端口做浏览器登录。
- 已识别治理接线风险：metadata配置的instance与standalone默认Memory runner身份不总一致。下一步解决对应关系并覆盖旧入口，不能只检查默认库。

## 2026-09-01 旧入口写屏障与后台生命周期

- 已连接真正的Standalone SkillCore/SkillExtractor和Memory L1/L2/L3 pipeline，以及v2/v3的五类Memory修改入口。治理配置只读查所有本地metadata实例，避免Hub instance与default不一致导致漏拦截；省略owner参数按真实Skill head检查。未知/legacy身份不能绕过已有治理scope。
- 非治理Agent仍走旧行为；治理Agent旧自动任务被明确拒绝并保留L0/cursor，尚未完成诊断后候选接管，因此不是完整生成闭环。后续启用前仍需串行处理开关变化与在途旧写，不能把调用前check说成完整并发防护。
- 后台任务连接pin、防LRU关闭、并发open去重、本地启动发现/恢复、HTTP先排空后停止dispatcher已接线。测试包含1连接上限、两个持有者、重复release、活动库purge拒绝和关闭后不可重开。
- Core **113tests/23files PASS**；control新代码严格检查零错误；新HTTP回归扩大依赖范围，transitive diagnostics=101（不是全仓typecheck通过）。L3 legacy空scope错误已补修。
- 最新隔离输出 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260901-r3`：Core29920/Hub29725，setup/verify/governance/restart PASS。governance是操作员测试fixture：无模型配置，admission持续false，临时开启测试profile验证真实HTTP拒绝，随后恢复关闭，正式资产快照不变。没有登录该端口，也没有更新8125。

## 已锁定边界

候选执行器补充（2026-09-01）：独立binding已能构造受预算proposal runner；真实SDK+mock HTTP测试验证Skill Review与L2/L3影子工具、逐次usage/权限/禁retry和沙箱拒绝。尚未接诊断后的持久生成调度，候选数量slot/原子冻结和实际目标快照也仍待完成；不开放自动化，不宣称真实模型闭环。

- 主交付为现有 8125 Hub；沿用 TencentDB / Tea 界面，不使用 MyUI。
- Skill、Memory L1/L2/L3、Wiki 纳入候选治理；Code Graph 不变。
- Wiki 维护自动、正文审查；Skill 采用单独人工操作；Memory 只有可独立确认的低风险变动允许自动采用。
- 不调用或探测 vLLM；不生成 v5、不修改旧 Suite/Gate/预算或历史结果；v4 FAIL 保留。
- 不 push/PR/merge；用户 deployment 三个修改文件不碰。

## 已实现（源码，尚未部署）

- evolution_* 表复用现有 metadata SQLite 连接；记录去重、冻结 hash、版本 CAS、历史只读、预算预留及保守处理未知 usage。
- Core /v3/evolution 与 Panel /api/v1/evolution 鉴权路由；源资产权限过滤，无源资产绑定的证据仅所有者可见。
- Hub 六个导航页面、详情、基础/候选对照和审查操作；不是 MyUI。
- 自动化启用由 admission、固定资产、模型/评测绑定、预算和真实 writer 共同控制；主环境 admission 仍默认关闭，绝不提前放开。
- SkillReview 隔离候选生成 helper、L1 proposalSink（失败不回退写入）、Memory shadow storage、内容校验策略。
- 独立复盘模型配置与单次调用 adapter（transport mock 验证）：temperature=0、无 fallback / 隐藏重试，调用前检查上下文上界；未知 usage 保留预算，失败独立记录。
- 原有 L1/L2/L3 的隔离调用封装，L2 派生 index/navigation 与 L3 最终内容一起冻结；离线 runner doubles 验证，没有真实模型效果结论。
- Knowledge 原有 extractSource + commitCandidates 已经固定私有 bridge 在副本运行；最终页面冻结后精确应用和恢复核对，不在采用时重调模型。Wiki 内部调用全部计入调用前预留。
- 三类真实 writer 已接入：采用意图与候选状态持久化；双击不重复写；索引/登记/readback 未核验不置 APPLIED；reconcile 只核对、不盲目重复写。
- 历史 main.json / freeze.json 受控 CLI 导入，源文件不变，保留原结论、带前缀的 Phase4 hash、基础/候选 diff；历史来源不能采用。
- 轨迹凭证模式脱敏（保留原 hash），不是完整 DLP 保证；权限校验仍不可省略。

## 验证

- Core `npm test`：87 tests / 19 files PASS（包含原 Evaluation 回归）。Core `npm run build:plugin` PASS。
- `node scripts/evolution/typecheck.mjs`：新增 control 文件零类型错误；其导入的既有 Core 代码另有 35 diagnostics，不能当成全仓 strict typecheck PASS。
- Panel `npm run build` / `npm test`：PASS，3 tests。web `npm run build` PASS（既有重复依赖键、大 bundle 警告）。
- Knowledge `npm test`：8 tests / 3 files PASS；`npm run typecheck` PASS；`npm run build` PASS（包含日志中间件兼容修正）。
- Knowledge 新安装 Hono 的 cache 类型暴露旧代码 TS2322；去掉对内部 bodyCache 的手动赋值，使用原生 text() 自动缓存；两条下游 JSON / error-body 回归通过。Code Graph 算法、路由和存储不改。
- Core / Panel npm ci 使用现有锁文件；Knowledge 无锁文件，使用 `npm install --ignore-scripts --no-package-lock` 安装测试依赖，没有改 package.json 或新增锁文件。

## 隔离运行证据（不是主 Hub 交付）

- 输出目录：`/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260831-r4`；Core26920 / Hub26725；独立命名、loopback 端口、网络与存储，无生产 mount，无模型配置或凭证。
- 源码与 web/dist 在 setup 时复制并记录 hash，不在运行 Attempt 内热修改源码。
- r2（Core24920 / Hub24725）历史结果页 API / 重启验收 PASS。
- r4 增加历史候选 diff 导入：setup / verify / restart PASS。真实 v4 `FAIL / NO_NEW_FIX` 不变。
- r1：Docker internal network 不发布 Mac loopback 端口导致 setup INFRA，已停止自己创建的容器但保留文件/容器。
- r3：导入器误将 bare SHA 与 `sha256:` 比较，历史 main 导入成功、candidate 导入失败；失败记录保留，修复后独立 r4。没有修改历史内容或 hash。
- 用户明确授权后，临时账号在24725登录成功；六页导航、详情深链接/刷新、Playbook/审查子页、候选分类控件实测通过。console 没有 error/warn；真实 v4 `FAIL / NO_NEW_FIX`、5条 unchanged_success 与原成本一致，原始 trace 未导入也明确标注。
- 浏览器发现 Tea link 按钮的长实验名跨列；增加仅作用于自进化页面的换行样式，没有替换 TencentDB 主题。web build 和 Panel3 tests 再次 PASS。
- 独立冻结预览 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-browser-20260831-r1` 在同一已授权24725验证修复：按钮右边420.8px，小于单元格右边438.8px。六页再验通过，无 console error/warn。预览复用隔离 r2 Core，只读访问；暂时停止旧测试 Hub，但保留其容器与冻结文件，验完恢复。主8125未受影响。
- `scripts/evolution/browser-preview.mjs` 可复现同源前端预览及恢复，输出独立 build hashes；不覆盖旧 Attempt，不需要另一端口重新登录。r2与预览各有 `browser-acceptance.json` 和截图。
- 这是基础浏览器验收；r2候选/审查为空，不代表完整生成/审查/采用通过。r4历史候选diff仍仅API验收，本次未登录26725。

## 尚未完成

1. 三类生成、校验、审查、采用和失败恢复虽然均已接线并有离线单元/契约测试，仍需在一个全新隔离实例中作为完整 HTTP 流程联合验收。
2. Skill 真实效果评测仍受 vLLM 不可用影响；只能验收固定 runner 的失败/恢复状态，不能用离线 fixture 声称效果得到证明。
3. 需补齐隔离 E2E 的跨 Team、重复任务、超预算、恶意轨迹、旧写不回退、双击采用、并发基线变化、Wiki 索引失败及服务重启恢复证据。
4. 隔离 E2E 通过后，先备份现有服务和数据，再更新主 8125，并用专用 Team 在真实浏览器验证六页、配置、证据跳转和默认关闭状态。

目前未修改运行中的服务，不能告诉用户 8125 已有新功能；未证明真实模型自进化闭环或收益。
