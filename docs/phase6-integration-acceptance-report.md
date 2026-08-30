# Phase 6 — TencentDB Integration Acceptance

验收时间：2026-08-30 深夜至 2026-08-31（北京时间）。

## 结论

**本地 TencentDB Agent Memory 集成验收通过；不等于云端 TencentDB 验收通过。**

真实 nanobot → MemoryProxy → MemoryCore → standalone SQLite 已执行。普通 smoke 的 L0、Task、Agent 关联可从独立 MemoryHub API 回读；Evaluation 只记录脱敏 observability 元数据，没有写入 L0 或 Skill。两次 smoke 都执行了真实文件工具，不是模拟结果。本阶段不证明 Skill 效果，不产生 Promotion 资格。

## 部署与范围

- 分支：`feat/evolution-candidate-refinement`；开始 HEAD：`73dd5abc109aed952fa541750eff46e9c40be694`。
- 原服务 `8420 / 8096 / 8125` 未重启、未替换、未改配置；用户已有 deployment 工作区修改未纳入本次提交。
- 验收 Core / Proxy / Hub：`18420 / 18096 / 18125`，全部绑定 `127.0.0.1`，独立 Docker network、数据目录和实例 `phase6-acceptance`。
- 普通与 Evaluation 使用独立 Team / Agent / Task / Session / workspace；正式数据不挂入验收容器。
- 使用本机已有镜像的固定 image ID，不 pull latest：Core `9798254a8cc0…`、Proxy `c8de30142787…`、Hub `39548fd616f6…`。完整 ID 在 `preflight.json`。
- Proxy 挂载当前源码：原运行镜像不含 Phase 4 Evaluation guard，不能直接拿它证明隔离。生产启动入口没有引入验收代码。
- nanobot revision：`415df576b46464445121fe1bc68d24cd5b649635`；Python `3.13.11`；SDK 未修改。
- provider：`vllm`；model：`qwen3.8-27b`；temperature：`0`；fallback：空列表。4 次真实出站请求均逐项验证模型与温度。
- nanobot 临时配置只指向验收 Proxy；原 `~/.nanobot/config.json` 未改写。工具仅保留本地文件读写，无 shell、网络或云资源工具。

## 第一层：真实持久化

独立测试身份完成：

1. L0 conversation/add → query → search；读取与检索均命中唯一随机标记。
2. Task metadata create → update → get；精确检查更新后的值。
3. 删除本次 disposable session 与 Task；重新 query/list 验证消失。

L0 是不可变流水，不能声称做过 L0 update；`scenario/write` 只能更新已有 L2，不能当成 create。这里验证的是 **L0 持久化/FTS 检索和可变 metadata CRUD**，没有验证 L1/L2 提取或云向量库。

临时 CRUD 记录已清理；用于人工观察的 smoke 会话和脱敏摘要有意保留。没有删除历史实验。

## 第二层：真实 Agent 与 Hub

最终有效集成 Attempt：`phase6-integration-20260830-r5`。

| 模式 | 文件 Oracle | input tokens | output tokens | total tokens | 模型调用 | 工具调用 | 耗时 | Hub L0 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 普通 smoke | PASS | 7,530 | 225 | 7,755 | 2 | 1 | 8,721 ms | 3 条 |
| Evaluation smoke | PASS | 7,648 | 351 | 7,999 | 2 | 1 | 12,493 ms | 0 条 |

每次真实调用 `write_file`，输出文件与要求的内容严格相等，输入 fixture 未变，Agent 正常返回最终输出。这里不是 Baseline/Candidate 效果对比，不能用表内成本差推导 Skill 收益。

- 普通 session：`phase6-normal-db64865afba5d4fb`；task：`task-vla9o0cesn`。
- Evaluation session：`phase6-evaluation-8e74cb1aeb544c53`；task：`task-vla9opwb7i`。
- Hub 的 `/meta/task/get`、`/meta/participation-log/list` 与 `/chat-memory/layer` 均实际回读成功；L0 数量与 Core 一致。
- SDK tool hook 保存完整 arguments/result；Proxy 对出站调用记录 session、模型、usage、哈希。SDK usage 与真实响应 usage 聚合一致，不以 0 填补缺失项。
- 安全摘要写入现有 participation log 与 Task metadata，包含 session、tokens、tool/model counts、tool names、oracle 状态与 evidence hash。**这是验收侧采集器写入，不是声称 Proxy 原生捕获了所有本地工具执行。**
- 完整 trace/output/fixture 留在私有本地证据目录，不作为 Memory/Skill 导入 Hub。

### 如何查看

验收 Hub：<http://127.0.0.1:18125>，实例显示 `Phase 6 / TEST ONLY`。

本次测试 User Key 独立保存于：
`/Users/lsmax/Coder/phase6-artifacts/outputs/phase6-integration-20260830-r5/private/hub-user-key.txt`

它不是正式 User Key，不在报告或日志中打印。登录后选择 `PHASE6 TEST ONLY / normal` 或 `PHASE6 TEST ONLY / evaluation` 团队。

浏览器已确认登录页和实例名称；尚未代填凭证，**登录后的 UI 点击验收未完成**。上述记录可见性已通过 Hub 实际后端 API 验证。旧 `8125` Hub 不会自动显示另一个实例，未改它的 registry。

## 第三层：隔离

- Evaluation Skill 使用独立的无业务答案 canary，不使用或修改 Candidate v4；通过现有 process-local registry 绑定，走 `<evaluation_skill>` 注入。
- 两次 Evaluation 模型请求均在实际出站 body 中检测到完整多行 Skill；普通请求没有该内容。
- Evaluation 前后 asset 列表完全相同。建测试 Agent 时系统预置的空 `chat_memory` 资产仍存在，但 Evaluation 未增建资产；Skill 资产始终为 0。
- Evaluation L0 为 0；Core 数据文件及 WAL 未发现 Skill/fixture canary；Core/Proxy/Hub 的 stdout 和 stderr 均通过 canary 扫描。
- 正式 Core 数据目录 28 个文件在有效 Attempt 前后内容哈希完全一致。
- 跨 r1 到 r5 的整个排查窗口，`.metadata/checkpoint.json` 与 `vectors.db-shm` 两个运行态文件曾变化；其余 26 个文件（含 metadata.db、vectors.db、WAL、Skill buffer 与业务内容）一致。不能把“有效 Attempt 窗口内全量一致”扩大为整个晚上所有运行态字节不变。
- 真实 HTTP negative probes：错误实例、未绑定请求、Skill bridge 路径返回 403；单元测试进一步覆盖身份不一致与 session header 别名冲突。
- Evaluation 不读取正式 Memory；隔离配置关闭普通 recall、Skill 提取和第三方 raw telemetry exporter。Core 无 LLM 提取凭证，自动抽取关闭。

本次还修复 OpenAI Proxy 路径的 Evaluation 日志泄漏：禁止 session raw-tail、注入正文 preview、完整 body dump。普通模式行为不变。生产镜像没有被重新部署；这些修复仅在本地源码和验收实例生效。

## 保留的失败与修正

| Attempt | 真实结果 / 原因 | 处理 |
|---|---|---|
| r1 | Docker bind 启动停在 Created，未跑模型 | 保留原输出及未启动容器；换独立输出位置继续，没有重启 Docker |
| r2 | 复制 read_file 显示文本时模型纠结空格、反复验证；240 秒超时；SDK 耗尽迭代后还有额外 finalization 请求 | 保留完整日志、workspace、Core；将集成 smoke 独立修订为明确文本写文件，不修改 Evaluation Suite |
| r3 | 新加日志保护引用局部动态 import，触发 TDZ；工具已执行但下一轮 Proxy 返回 500 | 修复为静态 import；保留 error RunResult 与日志，不归咎 provider |
| r4 | 两种 smoke 都完成；审计记录器把 JSON 转义后的字符串与多行原文比较，错误记录注入不存在 | 保留原记录；增加多行/引号回归测试，独立 IMPLEMENTATION_FIX_RETRY 为 r5 |
| r5 | 两种真实 smoke、出站证据、Hub API、隔离审计全部通过 | 保留为有效集成结果 |

另外，早期 CRUD 调用缺少数据面的 Bearer header，以及把 update-only L2 当作 create 的错误均已修正；没有因此放宽 Oracle 或修改旧实验协议。

## 测试与源码边界

- `node --test scripts/phase6/acceptance-lib.test.mjs`：3 PASS。
- `MemoryProxy/node_modules/.bin/vitest run src/injection/injectors/__tests__/evaluation-skill-override.test.ts`：4 PASS，包括真实 pipeline 不打印 Evaluation 文本、既有写入 guard 和中立注入模板。
- `node --check scripts/phase6/acceptance.mjs`、Python AST 解析、`git diff --check`：PASS。
- 实际 `setup / storage / services / normal / evaluation / audit / hub-check`：r5 全部 PASS。
- 全仓 TypeScript **不通过**：在相同固定镜像依赖下，HEAD baseline 和修改后各 54 条诊断，去除行号后完全相同；没有新增诊断。没有把它写成 build PASS。
- 生产源码只改 OpenAI handler 的 Evaluation 原文日志条件和 injection pipeline 的正文预览条件；其余均为独立验收脚本、测试、checkpoint 和报告。Pair/Gate/Oracle/旧 Suite/旧 Candidate 未改。

## 证据位置

根目录：`/Users/lsmax/Coder/phase6-artifacts/outputs/phase6-integration-20260830-r5`。

- `preflight.json`：镜像、正式存储 hash、模型条件。
- `source-freeze.json`：真实运行源码 SHA-256 与 nanobot revision；普通/Evaluation run 前一致性检查。
- `normal/run.json`、`evaluation/run.json`：输出、usage、工具事件、文件 Oracle。
- 两个目录的 `trace.jsonl`、`workspace/`：本地完整证据。
- `proxy-events.jsonl`：4 个真实请求与 4 个响应的脱敏事件。
- `normal-visibility.json`、`evaluation-visibility.json`、`hub-layers.json`：Hub 与 Core 回读。
- `audit.json`：隔离 PASS、零 canary 命中、正式数据未变。
- `typecheck/comparison.json`：54/54 既有诊断对比。

r2–r4 在同级目录，r1 在原 Documents 输出目录。失败容器已停止并改名保留；有效验收三件套保持运行供观察。

## 真实限制与下一步

1. 本地 SQLite/FTS，不是云端 TencentDB/vector backend；没有证明云实例 connect/写入/检索。
2. 仅当前 OpenAI-compatible 非流式 nanobot 路径；没有证明所有 Proxy 协议或 streaming 的隔离。
3. 为兼容现有 Proxy auth client，隔离 Core 沿用空 gateway Bearer gate；数据面有非空 Bearer 格式要求，metadata 使用测试 User Key。仅用于 loopback 验收，**不能据此部署到正式网络**。正式鉴权还需单独处理。
4. 无 L1/L2/L3 语义提取或 Skill 生成。本阶段正常落下的是 L0；Evaluation 留的是 metadata observability，不是知识。
5. 没有新增专用 Evaluation Dashboard；完整工具 trace 仍在本地，Hub 通过现有 Task/participation metadata 承载摘要。

建议下一步先人工查看独立 Hub 的测试记录，再决定是否把该隔离实例以只读观察入口接入常用 Hub；正式接入前补齐网关鉴权与持久化部署测试。不要开始新 Candidate、Promotion 或新效果实验。
