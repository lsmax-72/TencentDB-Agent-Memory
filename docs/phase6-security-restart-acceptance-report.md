# Phase 6 本地鉴权与重启隔离验收

日期：2026-08-31，北京时间。续跑起始 HEAD：`8276e8a02caff0b5c6131988204ae3c128c00978`；分支：`feat/evolution-candidate-refinement`。

验证后代码本地 commit：`e9db7389ad3058270874af23007fd969ddc5217c`，未 push。报告与操作说明单独提交；运行使用的确切源码以 Attempt 中冻结快照为准。

## 结论

**本地隔离实例的非空 gateway 鉴权、重启持久化、Evaluation 失效关闭及真实 nanobot 链路验收通过。Hub API 通过，登录后 UI 仍未验收。**

这是 Phase 6 底座验收，不是 Skill 效果实验，也不是云端 TencentDB/生产部署验收。v4 的 FAIL、历史 Suite 和全部旧 Attempt 不变；未生成 v5、未 Promotion。

## 源码事实与最小修复

| EXPECTED | ACTUAL | IMPACT | MINIMAL FIX |
|---|---|---|---|
| Core 开启 gateway Bearer 后仍能验证用户 key | Proxy `auth/verify` 请求没有 Authorization | 开启 Core 鉴权后合法用户也会被拒绝 | 增加可选 `auth.apiKey`，只作为服务 Bearer；用户 key 仍在请求 body |
| 显式开启 auth 时配置错误不能降级为开放 | 空 auth URL 原先静默关闭验证 | 配置错误可能导致 passthrough | 缺 URL 时拒绝启动；auth 默认 disabled 的行为不变 |
| 已声明 Evaluation 的请求不能在绑定丢失时变普通请求 | 原验收入口只有身份白名单，未检查 registry 存活 | 丢失绑定存在进入普通 capture 路径的风险 | 验收入口同时要求可信声明与进程内绑定；缺绑定返回 403 |
| Attempt 重启使用同一份已冻结代码 | 旧验收 Proxy 直接挂工作区源码 | 后续编辑可能改变重启行为 | 新 Attempt 复制源码到独立 `runtime/`，记录所有文件 hash；容器只读挂载快照 |

生产源码变更仅涉及 `MemoryProxy/src/auth.ts`、`config.ts`、`types.ts` 和 auth 回归测试；丢绑定故障注入、入口白名单、实例编排均限于 `scripts/phase6`，没有接入默认生产启动。

未改变 Evaluation contracts、Pair、Oracle、Gate、Case、预算、工具、模型或 Candidate。只在新隔离实例运行，不更新正式镜像/配置。

## 新 Attempt 与环境

- 有效 Attempt：`phase6-secure-20260831-r2`，种类 `IMPLEMENTATION_FIX_RETRY`，父 Attempt 为本轮 `phase6-secure-20260831-r1`。
- 根目录：`/Users/lsmax/Coder/phase6-artifacts/outputs/phase6-secure-20260831-r2`。
- Core/Proxy/Hub：`phase6-secure-20260831-r2-{core,proxy,hub}`；新 network 与数据目录独立；仅 loopback 端口 `19420/19096/19125/19424`。
- 旧 r5 服务 `18420/18096/18125` 未重启、未覆盖；正式 `8420/8096/8125` 未改。用户已有 deployment diff 保留。
- 固定镜像与 Phase 6 r5 同一 image ID：Core `9798254a8cc06276b7c5b3c19df49f136fae25d579564e1f01f9c4b9b8cd2d11`；Proxy `c8de30142787a5df7937c02c167f2ee37f00505b79036357653a6ce78a29fba5`；Hub `39548fd616f6f211ad2288e33fe5e93870b705cffe0468047520cd786408e657`。未 pull latest。
- 后端仍为 standalone SQLite/FTS，embedding none；无 L1/L2 提取、无云端数据库验证。
- 真实模型仍为 `vllm / qwen3.8-27b`，temperature `0`，fallback `[]`；SDK 单次输出上限 `4096`、工具迭代上限 `6`、外层超时 `240s` 均沿用原 Phase 6 smoke。
- Core 使用独立非空 gateway key；gateway key、用户 key、provider key 分开，不写入报告。私有配置和证据在权限受限目录，不入 Git。

## 实测结果

### 存储、鉴权与重启

- L0 add/query/search、metadata Task create/update/read、指定临时记录 delete/cleanup 全部通过；不声称 L0 支持 update。
- Core gateway key 缺失/空/错误均 HTTP 401；正确服务 key + 用户 key 验证成功；错误用户 key 返回 `valid=false`。
- Proxy 错误用户 key、session、Team、Agent、Task 或相冲突 session alias 均 HTTP 403；上述 negative probes 共 11 项，零模型调用。
- 重启本轮 Core/Proxy/Hub 后，正常测试 L0 随机标记仍能回读，验证完只清理该临时 session。
- 同一冻结源码的独立 fault Proxy 跳过 Evaluation 绑定；重启前后对合法 Evaluation 身份请求均 403。两次拒绝零模型调用、Eval L0=0、资产列表不变。
- 主 Proxy 在重启时从可信本地 settings 显式重绑；之后真实 Evaluation smoke 确认 Skill 注入成功。没有新增在线绑定管理 API。

**边界**：跨身份拒绝证明的是隔离验收 Proxy 的白名单约束；不能据此声称 Core 管理级 Bearer 自带所有用户行级 ACL。进程 registry 本身仍是易失的，重启安全依赖可信声明、入口 guard 与启动重绑，不是持久化 registry。

### 真实 Agent 与 Hub

| 模式 | 文件 Oracle | input tokens | output tokens | total tokens | model calls | tool calls | elapsed ms | Hub L0 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Normal | PASS | 7,515 | 220 | 7,735 | 2 | 1 | 8,483 | 3 |
| Evaluation | PASS | 7,637 | 244 | 7,881 | 2 | 1 | 8,896 | 0 |

两次均真实执行一次 `write_file`，文件内容与输入 fixture 保护条件通过原 Oracle，返回正常完成。不是 Baseline/Candidate 对照，成本差不能解释为 Skill 收益。

四个真实请求/响应逐项对应：actual model 与 temperature 符合冻结配置；SDK 与 provider token 聚合一致；Evaluation 的两次请求均存在真实多行 Skill 注入，普通请求没有。

工具 arguments/result、最终输出、workspace、trace/session refs 在本地 evidence；Hub Task/participation 仅白名单摘要（usage、次数、工具名、状态、hash）。完整工具结果来自 SDK hook，不冒称 Proxy 原生捕获。

新 Hub：`http://127.0.0.1:19125`。Task、participation、memory asset 与 L0 layer 已经 API 回读；测试 User Key 在根目录 `private/hub-user-key.txt`，没有在日志/报告展示。**本次没有代填浏览器凭证，也没有验证登录后的 UI 点击。**

### 隔离审计

- Evaluation L0=0、Skill assets=0，evaluation 前后资产列表完全一致。
- Core 所有数据页/WAL 未命中 Evaluation Skill/fixture canary。
- Core/Proxy/Hub 及停止的 fault Proxy stdout/stderr 均未命中测试 canary、gateway key 或用户 key；provider key 若长度足够也参与扫描。
- 正式 Core 在本轮 preflight 与 audit 间 **30 个文件全部 hash 相同**。这是本轮窗口的实测值，不能用旧 r5 的 28 个文件计数替代，也不能外推至其他时间。
- recallL1/injectL2L3 未开启；Core 抽取未开启；没有正式 Memory/Skill 写入，没有 Evaluation 文本回流。

## 保留的失败

1. 本轮 secure r1：存储、gateway、重启检查均通过，但同镜像类型检查从 54 增至 55 条；缺失 `RawYamlConfig.auth.apiKey` 声明。没有运行 LLM。修复后新建 r2，r1 原记录和容器全部保留，服务已停止。
2. 首次 auth 单测真实复现两个失败：缺 Bearer、空 URL 静默关闭；修复后通过。
3. 本机轻量依赖缺 `js-yaml`，新增 YAML 配置测试无法加载；改用既有固定 Proxy 镜像中的完整依赖运行，未安装/升级依赖、未把该环境错误当作产品失败。

旧 Phase 6 r1–r5、Phase 5/held-out 全部保留。不选择性删除失败，不覆写成功结论。

## 验证命令

| 命令 | 结果 |
|---|---|
| `node --test scripts/phase6/acceptance-lib.test.mjs` | 4 PASS |
| 固定 Proxy 镜像执行 `node_modules/vitest/vitest.mjs run src/__tests__/auth.test.ts src/injection/injectors/__tests__/evaluation-skill-override.test.ts` | 9 PASS（auth 5 + override 4） |
| `node scripts/phase6/typecheck-comparison.mjs <r2>` | baseline/current 同为 54 条既有错误，NO_NEW_DIAGNOSTICS；全仓 typecheck 仍 FAIL |
| `node scripts/phase6/acceptance.mjs <stage> <r2>`，stage 为 storage/services/security/restart/normal/evaluation/audit/hub-check；setup 带 `--secure` | 全部 PASS |
| `node --check scripts/phase6/acceptance.mjs`、`git diff --check` | PASS |

所有修改均按最小实现修复处理。没有以增加预算、关闭鉴权或放宽 Oracle 换取成功。

## 证据 hash

下列文件位于 r2 根目录；完整 runtime 与模型配置的私有快照留在同目录。

| 文件 | SHA-256 |
|---|---|
| source-freeze.json | `3e666a9708900e91adf649fd2b9f1b784bbfc787176216a4d993da8a0ce5dfb7` |
| runtime-freeze.json | `9277ba98e5ecbc1a7890a5018de08e8223c06337ade846544a5634dbcf28e9d3` |
| audit.json | `36e411dac322afda5429247be73e9444e4883e3eb055f65819aac23e03433222` |
| security.json | `a0106fceb93ff111ad325441c3f2e23f177feba54d398bd57fa0be5569019f0f` |
| restart.json | `ad4c96d8007c02dbfb6b02531ebc39df08751e2605a7afc23d8e130ee0f6ad11` |

## 剩余边界与下一步

本计划 01、03–09 已完成；02 的 API 部分完成，UI 因登录许可未确认保持 BLOCKED。需要用户登录隔离 Hub 或明确允许使用测试 key 完成 UI 验收。

主 Hub registry、云端 TencentDB、L1/L2 提取与跨 session 召回仍未执行；不自动进入新阶段。加固只验证当前非流式 OpenAI-compatible nanobot 路径，不代表全协议生产安全。
