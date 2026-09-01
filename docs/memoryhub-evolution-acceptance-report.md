# MemoryHub Skill / Memory / Wiki 自进化验收报告

日期：2026-09-01  
分支：`feat/evolution-candidate-refinement`  
结论：统一治理工程已在独立实例完整验收并交付本机 8125；真实 LLM 效果未验证且保持阻塞，不能宣称 Agent 已通过自进化获得收益。

## 1. 控制、存储和隔离

- Core 使用现有 metadata SQLite 持久保存 record、job、budget allocation、audit、adoption intent 和 recovery 状态。
- Candidate 统一封装 `skill | memory | wiki`，保存来源、目标、base version、diff 和 hash；冻结后修改会生成新 revision。
- 所有读取和衍生记录递归校验来源 ACL；跨 Team、错误 key、共享目标解除私有来源等路径有负例测试。
- 模型调用和候选数量在调用前预留；未知 usage 不写 0，失败不归还未知成本。

证据：Core 166 tests / 37 files；`node scripts/evolution/typecheck.mjs` 新增控制代码 0 错误。

## 2. 任务结束、诊断和候选生成

- 只有明确 `host_task_complete` 才建立 trace 和诊断 job；重复回执幂等，冲突 replay 拒绝。
- reviewer binding 独立于聊天模型，只能来自操作员 0600 配置；HTTP 不能传 endpoint、secret、命令或路径。
- 诊断必须引用证据并分流到 Skill、Memory、Wiki、工程问题或无法归因。
- Skill 复用现有 Review Agent/CandidateSkillWorkspace；Memory 复用 L1/L2/L3 提取；Wiki 复用 Knowledge extract/merge，但均在候选区运行。
- Memory 的三层不是仅有 helper：任务完成时 L1 与当次正式快照可触发的 L2/L3 在同一个 candidate allocation 中生成，并且整批原子冻结；L2 只读取已采用的正式 L1，L3 只读取已采用的正式场景文件，候选不能暗中成为下层输入。

证据：`evolution-hub-20260901-r12/full-*.json` 的 duplicate task receipt、L1/L2/L3 candidate/adoption 和三类状态。

## 3. 旧入口治理

- 已开启治理的 Agent，其 Skill create/update/patch/delete/file write 和 Memory L1/L2/L3/v2/v3 写入口在共享 mutation boundary 受控。
- 治理失败、超预算或候选生成失败不回退直接正式写；未开启 Agent 保持旧行为。
- standalone metadata instance 通过请求级 AsyncLocalStorage 绑定，非 default tenant 的 Skill 资产登记不会串库；并发隔离有回归测试。

## 4. Wiki 冻结和采用

- 来源只来自已登记 raw materials / 可信任务证据；模型回答本身不能作为事实来源。
- extract/merge 在 shadow copy 内完成，所有内部模型步骤计入预留；最终页面 bytes 冻结后再校验。
- 采用精确写冻结内容，不再次调用模型；base/source 变化、锁定页面、索引失败和 readback 不一致不会标记 APPLIED。
- 只有不改变正文含义的引用去重/补引用可获得机械维护资格，正文变化仍人工。

隔离 r12：真实 Knowledge snapshot → VALIDATED → REVIEW_APPROVED → APPLIED → index/readback PASS；重复采用返回同一结果。

## 5. Skill 评测、Memory/Wiki 校验和采用

- Skill 继续使用既有 EvaluationCase/Runner/Oracle/Pair/Gate，不修改历史协议；每 arm fresh session/workspace。
- 评测配置只能来自受限 binding，浏览器不能提供 Python/nanobot/model/toolset/suite。
- Skill 只有 Gate PASS、至少一项 newly_fixed、零 newly_broken才可进入人工审查，永不自动 Promotion。
- Memory/Wiki 将内容校验与效果证明分开；低风险 Memory 自动资格由服务端逐字来源/类型/长度/指令特征规则决定。
- 三类采用都在操作前重验 grant、ACL、profile、hash、base version，并保存 intent 和 readback；重复点击幂等，重启 reconciliation 不盲写。

r12 的 Skill evaluator 故意不可用，结果为 `BLOCKED_EVALUATOR_CONFIGURATION`；审批和采用被拒，正式 Skill version/content 不变。这是正确的 fail-closed 行为，不是效果 PASS。

## 6. 腾讯原生 Hub 和历史

- MemoryPanel 使用原 TencentDB / Tea 导航、表格、表单和权限体系，没有 MyUI。
- 页面：进化概览、运行轨迹、诊断与经验、候选资产、评测中心、人工审查。
- Code Graph 保持原实现，不进入候选治理。
- 历史导入是 operator-only CLI；主 8125 的专用 TEST ONLY Team 显示 v4 `FAIL / NO_NEW_FIX`、五个 unchanged_success、成本和 hashes，并显示 frozen Candidate 的只读 diff。
- 历史 Candidate 采用请求在主环境返回 `409 LIVE_CANDIDATE_REQUIRED`。

浏览器证据：`/Users/lsmax/Coder/phase6-artifacts/outputs/memoryhub-main-20260901-r1/browser-acceptance.json`。

## 7. 测试和隔离端到端

最终验证：

```text
MemoryCore npm test                 166 tests / 37 files PASS
MemoryCore npm run build:plugin     PASS
evolution strict control check      0 errors; 101 existing transitive diagnostics
MemoryPanel npm test                3 tests PASS
MemoryPanel backend build           PASS
MemoryPanel web build               PASS
MemoryKnowledge npm test            11 tests / 4 files PASS
MemoryKnowledge build               PASS
isolated r12 setup/verify/full/restart PASS
git diff --check                    PASS
```

r12 在 r11 的三资产覆盖上新增了真正由 task-complete 触发的 L1 → L2 → L3 顺序闭环：每层先冻结，L2/L3 经人工批准后采用，正式 bytes 与 adoption receipt 在重启后读回。它同时覆盖错误 key、跨 Team、任务幂等/冲突、任意 retry 路径、正式资产隔离、Wiki 人工采用/双击、Skill 证据不足阻塞、历史 FAIL 保留和 runtime hash 不变。r5-r11 的历史结果都独立保留，没有被 r12 覆盖。

## 8. 主 8125 交付

- 初始一致性备份：`/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-1535`
- r2 更新前备份：`/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-2005-pre-r2`
- 冻结 runtime：`/Users/lsmax/Coder/phase6-artifacts/runtime/memoryhub-main-20260901-r2`
- 主验收：`/Users/lsmax/Coder/phase6-artifacts/outputs/memoryhub-main-20260901-r2`
- 主 Core/Hub 原 volume 保留；替换及再次顺序重启后均 healthy。
- default-team 原 Chat Memory 及 L0/L1/L2/L3 均可见；六页和历史详情在重启后可见。重建时遗漏的原 Docker network alias 曾导致一次 Team 列表 502，恢复 `memory-core` / `memory-hub` alias 后复验通过；该诊断未修改数据。
- 主环境 automation admission 为 false，profile 数量 0、adoption 数量 0；未调用 vLLM。

## 9. 未冒充完成的部分

- 真实复盘模型、真实 nanobot Skill 效果评测仍未运行；当前只能证明治理工程和 fail-closed 行为。
- 本轮 Docker Hub token endpoint 超时，未生成可分发的新镜像；使用原镜像依赖加冻结只读 runtime 完成本机 standalone 交付。
- Core 聚合 build 仍受仓库既有缺失 `scripts/seed-v2/tsconfig.json` 影响；plugin build 和实际运行入口已通过。
- 未部署或写入云 TencentDB，没有进行正式 Skill Promotion。
- 主 standalone 沿用原容器的对外端口与 Core 鉴权姿态；隔离验收已覆盖 ACL/错误 key，但本阶段没有擅自改变用户现有网络暴露策略。

这些限制均在 8125 界面显式呈现，不影响本阶段“本机底座、治理闭环和 Hub 可见性”的验收结论。
