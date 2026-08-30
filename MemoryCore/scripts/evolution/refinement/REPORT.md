# Phase 5B — Evaluation-Signal-Driven Candidate Refinement Report

## 1. Conclusion

Phase 5B 已完成一次有效的真实 Baseline vs Candidate v2 复评：新 INFRASTRUCTURE_RETRY 的 Gate 为 FAIL，而不是 INFRA_ERROR。AC-01 真实修复；AC-05 发生预算耗尽回归。因此停止在 Phase 5B，不生成 Candidate v3，也不进入下一阶段。

## 2. Phase 5A Freeze

| 项目 | 值 |
|---|---|
| Phase 5A commit | 29a347dd535f516b5f9c0510edd923462d81a0e4 |
| Phase 4 commit | 6c6dd1de6be11649c00b498f2af7e6ec53c6e676 |
| Phase 5A attempt | f22eb499-3654-448e-ab33-bff096523967 |
| Candidate v2 artifact | sha256:f68e291b45feb03065e2371b8b2adc1601cfd0082e96e72cb2113b7da1b751ea |

Baseline、Candidate v2、AC-01 至 AC-05、fixture、Oracle、critical、GatePolicy、budget、model、toolset 与 runner 均保持冻结。

## 3. Historical Infrastructure Attempt

历史 Attempt 8d23ae0a-d6bf-4311-ae68-86f988a53656 完整保留为 INFRA_ERROR：10/10 arm 为 MODEL_UPSTREAM_UNAVAILABLE，main.json SHA-256 为 sha256:f2256f05ce1562e4e5572c73e52b5f7a4c9a8f21e93adfe13a3cb7d245c40efd。本次没有覆盖、删除或改写它。

## 4. Retry Environment and Fairness

| 项目 | 值 |
|---|---|
| Attempt kind | INFRASTRUCTURE_RETRY |
| retry attempt | 9f6d88f0-e3fe-402b-b9a0-7ee44426aeeb |
| retry of | 8d23ae0a-d6bf-4311-ae68-86f988a53656 |
| endpoint preflight | /v1/models HTTP 200 |
| provider / model | vllm / qwen3.8-27b |
| temperature / fallback | 0 / DISABLED |
| budget | model 8; tools 12; input 40,000; output 8,000; total 48,000; timeout 180,000 ms |
| Gate policy hash | sha256:4be8d8a7c105a7981058398fafc23e958dd129351bb7ffcc198884423028b575 |

冻结配置、v2 和受控源文件哈希均匹配。5/5 pair 的 observed-conditions hash 相同；审计 valid=true、config_unchanged=true、source_unchanged=true。

## 5. Real 5-Case Results

| Case | Baseline | Candidate v2 | Classification | Baseline tokens / tools / model | v2 tokens / tools / model |
|---|---|---|---|---:|---:|
| AC-01 | FAIL (BUDGET_EXHAUSTED) | PASS | newly_fixed | 44,352 / 9 / 7 | 31,393 / 4 / 5 |
| AC-02 | PASS | PASS | unchanged_success | 37,380 / 7 / 6 | 30,996 / 4 / 5 |
| AC-03 | PASS | PASS | unchanged_success | 24,898 / 3 / 4 | 25,401 / 3 / 4 |
| AC-04 | PASS | PASS | unchanged_success | 24,116 / 3 / 4 | 24,605 / 3 / 4 |
| AC-05 | PASS | FAIL (BUDGET_EXHAUSTED) | newly_broken | 40,349 / 8 / 6 | 55,264 / 9 / 8 |

汇总：newly_fixed=1（AC-01），newly_broken=1（AC-05），unchanged_success=3，unchanged_failure=0，uncomparable=0。

## 6. Candidate v1 vs v2

| Candidate | Total tokens | Tool calls | Model calls | 分类汇总 |
|---|---:|---:|---:|---|
| v1（Phase 5A） | 230,172 | 38 | 34 | 0 fixed / 3 broken / 1 unchanged success / 1 unchanged failure |
| v2（本次 retry） | 167,659 | 23 | 26 | 1 fixed / 1 broken / 3 unchanged success |

v2 比 v1 少 62,513 total tokens（-27.16%）、15 次 tool call、8 次 model call；比本次 Baseline 少 3,436 tokens（-2.01%）、7 次 tool call、1 次 model call。这是独立真实 Attempt 的观测比较，不能夸大为确定性因果结论。

## 7. Behavior Evidence

- manifest 冗余减少：v1 AC-03 读取不存在的 .task/targets.json 并插入 list_dir/read_file，破坏 state 工具序列；v2 直接 state_read → state_apply → state_verify 并通过 Oracle。v1 AC-05 同样先读缺失 manifest；v2 无此调用。
- verification 减少：v2 工具数相对 v1 分别为 AC-01 4 vs 7、AC-02 4 vs 6、AC-03 3 vs 6、AC-04 3 vs 7、AC-05 9 vs 12。
- stop condition：AC-01、AC-02、AC-03、AC-04 都在必要验证或 state_verify 后结束，未重现 v1 的额外 Git/探索。AC-05 已完成 Oracle 所需状态但累积 8 次 model call、55,264 total tokens，仍被预算判 FAIL；不能宣称 stop condition 对所有 case 已充分生效。

## 8. Gate

FAIL。

- NEW_REGRESSION：AC-05，限制 0、观测 1。
- CANDIDATE_BUDGET_EXHAUSTED：AC-05。

所有 10 个 arm 均获得真实 final output、tool events、usage、workspace/Oracle evidence、session 与 trace ref；不存在 INFRA_ERROR。

## 9. Stability Probe

未运行，符合冻结规则。AC-01 v2 使用 input 30,870/40,000（77.2%）、output 523/8,000、total 31,393/48,000、model 5/8、tools 4/12；未到任一 90% 阈值，也未预算耗尽。

## 10. Isolation and Evidence

每个 arm 使用 fresh session 与同一 fixture 快照的 fresh workspace。正式 Skill / Memory 数据未接入或写入；无 Promotion、无 Candidate DB、无 Candidate v3。

infrastructure-retry-1.json 与 infrastructure-retry-1-evidence/ 保存 10 个真实 arm 的 output、tool event、usage、Oracle/workspace evidence、session/trace 和 run 前后快照。

## 11. Tests

| Command | Result |
|---|---|
| curl --noproxy '*' http://10.195.214.152:8100/v1/models | HTTP 200，qwen3.8-27b |
| run-candidate-refinement.ts retry | 完成 10 个真实 arm，生成独立 retry Attempt |
| npm test -- --run src/evolution/evaluation __tests__/evolution/candidate-refinement.test.ts | 7 files / 35 tests passed（Phase 5B 实现验证） |
| npm run build:plugin | PASS，仅既有 dynamic import warning |
| npm test -- --run（MemoryProxy） | 2 files / 11 tests passed |

## 12. Git State

Branch：feat/evolution-candidate-refinement。HEAD：29a347dd535f516b5f9c0510edd923462d81a0e4。Phase 5B 未 commit、未 push、未创建 PR。

主 evidence 目录：/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/phase-5b/

## 13. Known Limitations

temperature=0 不能保证 hosted model 完全确定。AC-04 本次两 arm 都通过，而 5A 有 host presentation 导致的失败；本次没有改 host、fixture 或 Oracle，说明该 case 仍会变化。AC-05 表明 v2 的泛化控制不足：tool 数下降但仍超 token/model budget。

## 14. Next Recommendation

停止在 Phase 5B。保留冻结 v2、历史 INFRA_ERROR 与本次 Gate FAIL；不要调考试、改预算或生成 v3。是否针对 AC-05 回归与 AC-04 不稳定性展开新设计，应由人工在下一阶段单独决定。
+
## 15. Autonomous Continuation — AC-05 Diagnosis

v2 的 AC-05 主结果加三次独立 diagnostic probe 中，Candidate 均完成四项 Oracle、均以 BUDGET_EXHAUSTED 失败：8 次 model call，total tokens 为 55,264、55,250、56,753、57,216。Baseline 为 3/4 PASS、1/4 budget FAIL，说明 Case 有预算敏感性，但 v2 的失败不是单次偶然。

sidecar 显示 v2 通常串行执行 root/service discovery、reference search、rename/update、repeat search 和 JSON parse；Baseline 通常 grep-first 并在 6 次 model call 内完成。sidecar 不含逐轮 token 分解，故只形成额外模型回合假设，不声称精确因果。

## 16. Candidate v3 and v4

| Candidate | 主评测 attempt | 主结果 | AC-05 Candidate | Gate |
|---|---|---|---|---|
| v3 | c68882a4-ed90-4481-a335-fe561c899b76 | 1 newly_fixed / 1 newly_broken / 3 unchanged success | all Oracle PASS，但 44,374 input、7 model calls、BUDGET_EXHAUSTED | FAIL |
| v4 | f5855171-9e8b-4526-b1e1-0e1087420fb1 | 5 unchanged success | PASS，39,691 input、6 model calls | FAIL (NO_NEW_FIX) |

v3 暴露了通用资源解析错误：任务已有可搜索字面标识符时，模型仍先读取不存在的 task mapping。v4 明确优先级为路径直接使用、重命名/引用替换的字面标识符先搜索、仅两者均不存在才解析 logical alias。没有写入 Case ID、fixture path、固定答案或预算数字。

## 17. v4 AC-05 Stability

v4 主运行与三个独立 probe 均保留在 phase-5b-candidate-v4。Baseline 为 4/4 PASS；Candidate v4 为 3/4 PASS、1/4 BUDGET_EXHAUSTED。

| Run | Baseline | Candidate v4 | Baseline total/model | Candidate total/model |
|---|---|---|---:|---:|
| main | PASS | PASS | 40,684 / 6 | 41,283 / 6 |
| probe 1 | PASS | PASS | 39,058 / 6 | 38,437 / 6 |
| probe 2 | PASS | PASS | 39,146 / 6 | 38,568 / 6 |
| probe 3 | PASS | FAIL (budget) | 40,399 / 6 | 41,632 / 6 |

每个 probe 都独立 labelled，不替换主评测，且 observed-conditions、config/source isolation 审计均通过。

## 18. Critical Review Boundary

v4 以通用规则将 AC-05 从 v2 的 0/4 Candidate PASS 改善为 3/4，但未满足 Gate：v4 主 paired attempt 没有 newly_fixed，因为 Baseline 也全部 PASS；另有 1/3 probe 越过 input budget。

因此停止生成 v5。进一步通过措辞调参追求 Gate PASS 已缺乏新 Diagnosis。若继续，需要人工决定是否保持现有 Gate 并接受降低回归但无 newly_fixed 不能 Promotion，或另行评审独立、未污染的区分性任务设计。后者会修改 Evaluation Protocol，本轮未执行。
