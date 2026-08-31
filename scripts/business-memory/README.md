# 独立表格业务接入（当前为离线 admission）

这组脚本不进入正式启动流程，不修改 Phase 4–6 Evaluation、Candidate 或旧实例。

当前已实现：固定数据校验/分离、XLSX 检查、独立单元格判分、受限 Python 执行器、nanobot SDK 工具注册、配置/usage 校验及可重复离线 admission。

当前已新增并验证：`nanobot_business.py` + `acceptance.mjs` 的完整 Agent.run、新隔离 Core/Proxy/Hub、真实 LLM smoke 和审计。Attempt 与结果见 `docs/business-xlsx-smoke-report.md`。

当前**未实现/未执行**：Memory 提取/迁移对照。`runner_contract.py` 仍是纯输入/证据校验；不要将离线 `validation.json` 的 PASS 单独当作业务任务完成。

## 运行

本机可用 Python：`/Users/lsmax/Coder/nanobot/.venv/bin/python`。依赖已存在：nanobot checkout、openpyxl 3.1.5、et_xmlfile、Docker。没有安装/升级依赖。

```bash
# 全部离线单测及真实容器负例，零模型调用。
BUSINESS_DOCKER_TESTS=1 /Users/lsmax/Coder/nanobot/.venv/bin/python -m unittest discover -s scripts/business-memory -p 'test_*.py' -v

# 以下两个命令的输出目录必须尚不存在。
/Users/lsmax/Coder/nanobot/.venv/bin/python scripts/business-memory/preflight.py <verified.tar.gz> <NEW_PREPARED_DIR>
/Users/lsmax/Coder/nanobot/.venv/bin/python scripts/business-memory/validate.py <PREPARED_DIR> <NEW_VALIDATION_DIR>
```

`preflight.py` 只接受已记录的 archive SHA-256，并提取任务 `141-20`。初始文件和 golden 分开保存，后者绝不挂载给 Agent 工具。原始文件 `init.xlsx` / `golden.xlsx` 命名与旧上游 evaluation CLI 的 `input.xlsx` / `answer.xlsx` 不同；不要直接调用那个 CLI 的默认三 fixture 循环。

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

先读 `PHASE_CHECKPOINT.md`、`docs/business-memory-execution-plan.md` 和真实 smoke 报告。用户已授权代理自行决定这类独立测试配置，冻结协议是 `protocol-smoke-v1.json`。首次 smoke 已完成，不重复运行；下一步是新的 Memory 收益协议与任务冻结，旧服务、旧评测和全部失败继续保留。
