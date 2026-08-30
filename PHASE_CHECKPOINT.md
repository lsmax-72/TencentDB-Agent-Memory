# Autonomous Evolution Checkpoint

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
