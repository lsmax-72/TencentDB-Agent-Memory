# 表格业务接入：离线 admission 报告

日期：2026-08-31。结论：**nanobot SDK 工具层可以处理所选 XLSX 样例，不需要因工具能力不足换题；真实 Agent + LLM 是否完成任务尚未验证。**

> 后续状态：用户授权代理自主决定独立测试配置后，真实 Agent smoke 已完成并 PASS。见 [真实 smoke 报告](business-xlsx-smoke-report.md)。本报告保留此前离线 admission 时点，不重写历史结论。

## 已执行

- 从上游固定 revision 下载 SpreadsheetBench Verified archive，SHA-256 `10ef893dd29cb13ab97143ea787e68cdc9574a13873ab9a54e50b31dc03fc949`，与已记录数据指纹一致。
- 仅提取开发任务 `141-20`。输入有两张表、分别 2/3 行（含标题），仅三个数据行，存在原始黄色匹配提示，无公式/宏/外部 workbook link；不是有区分度的收益实验。
- 输入 SHA-256 `422af403dcf91bf0e6e0a58d2856dd0f3e6f27245410c00594e3333fd20f02e4`；golden `4bf2a97e511e65564e569015324008439dd0274ce3cfb68c29f63c17a275dd5e`。Agent 工具看不到 golden。
- 基于现有 nanobot ToolRegistry 注册唯一 `spreadsheet_python`，使用真实网络隔离容器读写真实输入副本；这次直接调用 SDK tool，没有调用 Agent.run 或模型。
- 原输入 hash 不变。unchanged-copy 经本地上游语义比较器判 TASK_FAIL，证明“写出了 XLSX”不等于完成业务任务；这是预期的离线负例，不是一次失败的真实 LLM Attempt。
- 真正的模型连通性只读检查 HTTP 200，模型仍 `qwen3.8-27b`。本机 nanobot 默认 config 已是 `auto / anthropic/claude-opus-4-5 / 0.1`；新配置映射显式固定 vllm/qwen/0，不修改用户默认 config。

## 环境与实现

- 起始分支 `feat/evolution-candidate-refinement`，HEAD `ff1f078d45e4699762292d092759fd5c24a24d5b`。
- nanobot revision `415df576b46464445121fe1bc68d24cd5b649635`，Python 3.13.11，openpyxl 3.1.5。
- 工具容器 Python 3.12.13，使用本机已有 image `sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf`，未 pull 新镜像。
- 新代码仅在 `scripts/business-memory/`：preflight、workbook oracle、sandbox、SDK tool、纯 runner contract、tests、validation 和未批准 protocol draft。
- 保留工作簿模板，不加任务答案规则；复用现有 SDK 接口，不修改 nanobot 或 Evaluation 核心。未新增业务服务/数据库/API。

## 验证与证据

完整本地证据：`/Users/lsmax/Coder/phase6-artifacts/outputs/business-preflight-uo9rAx68/`。

- `prepared-r1/manifest.json`：来源、输入/golden 清单与结构；仅开发材料，不是 held-out。
- `validation-r1/validation.json`：`OFFLINE_ADMISSION=PASS`，`model_calls=0`、`agent_run=false`、`real_agent_smoke=NOT_RUN_REVIEW_REQUIRED`。
- `validation-r1/sdk-tool-event.json`：真实 SDK tool 参数、容器返回值、文件 hashes。
- `validation-r1/negative-control-oracle.json`：未修改副本的预期失败。
- `validation-r1/freeze.json`：本次测试脚本/配置草案和 SDK/image/input 指纹；该文件 hash `690d29bbeb31c8bd1d8b0e09ad9246510b80baaf822a8d86eb988e1fcf5475c3`。这是离线代码快照，不是批准后的真实实验协议。

| 命令 | 结果 |
|---|---|
| `BUSINESS_DOCKER_TESTS=1 /Users/lsmax/Coder/nanobot/.venv/bin/python -m unittest discover -s scripts/business-memory -p 'test_*.py' -v` | 18 PASS，含 5 项真实 Docker 测试方法 |
| `node --test scripts/phase6/acceptance-lib.test.mjs` | 4 PASS |
| `.../python scripts/business-memory/validate.py <prepared-r1> <NEW_VALIDATION_DIR>` | PASS：上述测试、真实样例 SDK 工具调用和负例判分 |
| `git diff --check` | PASS |

测试覆盖：正确/错误/缺失/损坏工作簿、隐藏参考异常、引用区域语法、数值/日期归一化、公式未重算拒绝、额外行/非目标表审计、archive checksum、输出目录不可覆写、SDK tool 注册/错误映射、旧 Proxy/配置漂移拒绝、usage 缺失拒绝、容器禁网/只读/权限/超时/大输出/符号链接/内存限制。

## 失败与限制

- Node 直连 archive 超时；普通 curl 和 direct IPv4 超时；HF 连接超时。只读查询发现 Mac 已配置 `127.0.0.1:7897` 代理，显式使用该既有代理后下载成功。没有改路由、系统代理或 endpoint。
- 预期负例已保存，未将 unchanged-copy 作为业务成果。测试创建的短生命周期 Docker 容器已自动清理，旧 r5/r2 与正式实例未操作。
- 尝试 nanobot venv 的 `ruff`，可执行文件不存在；不声称 lint PASS，未为此安装依赖。未运行全仓 build。
- 当前未实现完整真实 run 编排和独立 Proxy/Core/Hub 启动，没有 Memory/Skill/Agent 正式资产写入，也没有业务成果可在 Hub 展示。
- 沙箱依赖包挂载正式冻结、完整实际模型/请求/预算审计仍需在真实 runner 阶段落实；离线测试不是完整 Agent 安全验收。

## 当前边界

用户已授权开始实现与适配性换题。当前任务工具层可行，保留它用于首次 smoke；不因它容易/难而选择性替换结果。

到达原计划 R0：已发送一次集中配置确认，草案为 `scripts/business-memory/protocol-smoke.draft.json`（6 model calls / 6 tool calls / 240s / 4096 单次输出，原 vllm/qwen/0/no fallback，只在新测试实例，不写正式资产）。尚未收到决定，不将其标为批准。

确认后的下一动作：实现完整 SDK runner 与新隔离链路，冻结配置与运行代码，执行一次真实 smoke，保存成功或失败及工作簿。Memory 收益对照另需完成来源隔离和协议，不能从本次离线 PASS 推导收益。
