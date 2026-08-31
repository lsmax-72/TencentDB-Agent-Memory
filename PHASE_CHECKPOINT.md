# Autonomous Evolution Checkpoint

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
