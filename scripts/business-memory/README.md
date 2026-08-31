# 独立表格业务与 Memory 迁移实验

这组脚本不进入正式启动流程，不修改 Phase 4–6 Evaluation、Candidate 或旧实例。

当前已实现：固定数据校验/分离、XLSX 检查、独立单元格判分、受限 Python 执行器、nanobot SDK 工具注册、配置/usage 校验及可重复离线 admission。

当前已新增并验证：`nanobot_business.py` + `acceptance.mjs` 的完整 Agent.run、新隔离 Core/Proxy/Hub、真实 LLM smoke 和审计。Attempt 与结果见 `docs/business-xlsx-smoke-report.md`。

Memory提取与三对迁移实验、四次Probe已完成；链路/隔离通过，但没有可接受收益，研究主状态INFRA_ERROR。见 `docs/business-memory-transfer-report.md`。不要将离线 `validation.json` 的 PASS 单独当作业务任务完成，也不要把记忆可用当成有收益。

## 运行

本机可用 Python：`/Users/lsmax/Coder/nanobot/.venv/bin/python`。依赖已存在：nanobot checkout、openpyxl 3.1.5、et_xmlfile、Docker。没有安装/升级依赖。

```bash
# 全部离线单测及真实容器负例，零模型调用。
BUSINESS_DOCKER_TESTS=1 /Users/lsmax/Coder/nanobot/.venv/bin/python -m unittest discover -s scripts/business-memory -p 'test_*.py' -v

# 以下两个命令的输出目录必须尚不存在。
/Users/lsmax/Coder/nanobot/.venv/bin/python scripts/business-memory/preflight.py <verified.tar.gz> <NEW_PREPARED_DIR>
/Users/lsmax/Coder/nanobot/.venv/bin/python scripts/business-memory/validate.py <PREPARED_DIR> <NEW_VALIDATION_DIR>
```

`preflight.py` 只接受已记录的 archive SHA-256，默认提取任务 `141-20`，可显式传 `--task-id`。初始文件和 golden 分开保存，后者绝不挂载给 Agent 工具。原始文件 `init.xlsx` / `golden.xlsx` 命名与旧上游 evaluation CLI 的 `input.xlsx` / `answer.xlsx` 不同；不要直接调用那个 CLI 的默认三 fixture 循环。

下载来源：固定 revision `49b73a94775fb489063f60ca1865e3a650079a79` 的 [官方 GitHub 数据](https://github.com/RUCKBReasoning/SpreadsheetBench/blob/49b73a94775fb489063f60ca1865e3a650079a79/data/spreadsheetbench_verified_400.tar.gz)。参考 [官方数据卡](https://huggingface.co/datasets/KAKA22/SpreadsheetBench) 的 CC-BY-SA-4.0 条款；原始数据不提交 Git。本项目只做独立开发样例，不宣称官方榜单/held-out 成绩。

## 工具与判分边界

- `spreadsheet_python(code)` 是通用 Python 表格工具，不内置对账答案/列号/匹配策略；不同调用共享 output 文件，不共享解释器变量。
- 固定现有 Python 镜像，非 root、无网、只读 root/input、受限 output/tmp、无宿主凭证/源码/golden/Docker socket。仅挂载 openpyxl 和 et_xmlfile 两个包，不挂整个 site-packages。
- stdout、单文件、累计 output、内存、进程和时间有限制。Docker `--rm` 或故障处理仅移除本次随机名称的短生命周期工具容器，不删除历史业务实例。
- 当前是开发级本地沙箱，不声明对所有恶意文件/资源攻击的生产安全保障。输出总量使用轮询限制，不是文件系统硬配额；依赖包使用本地只读挂载，正式 run 前仍需冻结其内容。
- `workbook_oracle.py` 保留上游数值归一化语义，按指定区域比较。额外全工作簿值审计单列，不暗改官方成功条件；不评分字体/颜色/格式。
- 如有公式，当前明确返回需要重算证据的 INFRA_ERROR；不把空缓存当正确、不擅自硬编码公式结果。当前所选样例无公式。
- 不让模型直接运行上游隐藏评分器。样例的 unchanged-copy 仅是负例，不是 Agent 已完成的对账文件。

## 恢复

先读 `PHASE_CHECKPOINT.md`、`docs/business-memory-transfer-report.md` 和执行计划。用户已授权代理自行决定独立测试配置；smoke和迁移实验已完成，不重复运行。旧服务、旧评测和全部失败继续保留。

## Memory transfer continuation

独立研究协议见 `docs/business-memory-transfer-protocol.md`。`study.mjs` 按 `init → formation → snapshot → transfer → probes → audit` 执行；后续 stage 使用 Attempt 内 frozen 副本。`init ROOT producer-v2` 只在新根目录建立新的形成端 revision，复用版本化真实 trace，不覆盖旧结果。`audit_study.mjs hub|post ROOT` 仅采集 API/usage/隔离证据，不运行 Agent 或重写成绩。

`BoundedProvider` 控制 nanobot 外层 retry 与实际模型调用计数，不修改官方源码；容器工具继续保持网络关闭、输入只读。旧 smoke 协议和旧 Skill Evaluation 不改变。

`study.mjs remaining ROOT`仅恢复不存在目录的主run，已完成跳过、partial拒绝覆盖；不得把INFRA自动当成待重跑。`summarize_study.mjs ROOT`只给本次r4生成追加式费用/证据索引，原结果不变。输出存在时所有collector拒绝覆盖，重新审计应使用独立文件名/revision。

新增诊断测试：`node --test scripts/business-memory/*-lib.test.mjs`。真实实验时使用Attempt内冻结runtime；仓库最新只读collector使用独立hash记录，不冒充冻结runner的一部分。

`memory_scope_audit.mjs ROOT`只读Memory快照与召回记录，生成固定列方法/背景缺失的启发式风险清单；零模型调用，不读取Oracle成绩，不改写或过滤Memory，不充当新的适用性Gate。

## vLLM不可用时的离线分支

`memory-context-policy.mjs`提供未接入生产的三条件renderer；`prepare_scope_study.py build NEW_ROOT`生成独立数据/协议/预览freeze，`validate ROOT`仅检查hash。当前r2设计见 `docs/business-memory-scope-policy-offline.md`，完整项目回顾见 `docs/project-state-and-discussion.md`。

这是DESIGN_FROZEN_NOT_EXECUTED，不含凭证、服务或真实Agent run。新的Proxy dispatch/runtime admission尚未实现；不要直接用旧`study.mjs transfer`运行新设计包。`node --test scripts/business-memory/memory-context-policy.test.mjs`是零模型的policy测试。
