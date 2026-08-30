# Phase 6 本地集成验收

这是独立 integration harness，不是 Evaluation Suite，不修改 Pair/Gate/Oracle。

前提：本机已有运行的 `tdai-memory-core / tdai-proxy / tdai-memory-hub` 镜像，nanobot 位于 `/Users/lsmax/Coder/nanobot`，vLLM endpoint 可达。本脚本不会启动、替换或写入这些正式容器；只读获取镜像 ID 与数据 hash。

测试容器名为 `phase6-core / phase6-proxy / phase6-hub`。若名称存在，setup 拒绝覆盖；先明确保留/停止原测试实例，不能清理正式容器。

## 顺序

在仓库根目录执行，下面路径必须是新的专用输出目录：

```sh
node --test scripts/phase6/acceptance-lib.test.mjs
node scripts/phase6/acceptance.mjs setup /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs storage /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs services /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs normal /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs evaluation /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs audit /ABS/outputs/phase6-NEW
node scripts/phase6/acceptance.mjs hub-check /ABS/outputs/phase6-NEW
node scripts/phase6/typecheck-comparison.mjs /ABS/outputs/phase6-NEW
```

每个 run 的目录与证据拒绝覆盖。失败要保留并建立独立 retry，不修改原结果；不得用这些 smoke 替代科学 Evaluation。源码 freeze 不包含鉴权 secret。

## 安全边界

- 数据目录、Team/Agent/Task/Session、workspace 均隔离；host 端口仅 loopback。
- Evaluation session 必须进程内预绑定；普通 HTTP header 不能自行把任意会话声明成 Evaluation。
- Proxy 验收入口只接受指定实例及预声明身份；相冲突的 session aliases 拒绝。
- 测试 Skill/fixture 原文仅保留私有本地 run evidence；Hub 只收 counters、tool names、hash 和状态。
- 普通 smoke 有意允许 L0 写入，Evaluation 使用现有 guard 禁止 L0/Skill 写入。
- 不启用正式提取服务/生产凭证/第三方 raw telemetry。独立 Core 的空 Bearer gate 仅是本地兼容配置，不是正式安全配置。
- 只删除本次生成的 disposable CRUD session/Task；保留 smoke 记录供观察，不提供批量删除全部数据命令。

有效结果、失败记录及限制见 [Phase 6 报告](../../docs/phase6-integration-acceptance-report.md)。

## 非空鉴权与重启验收（2026-08-31）

这是本地隔离加固验收，不部署到正式服务。最新结果见 [加固报告](../../docs/phase6-security-restart-acceptance-report.md)。

使用新的专用输出目录，setup 末尾加 `--secure`：

```sh
node scripts/phase6/acceptance.mjs setup /ABS/outputs/phase6-secure-NEW --secure
node scripts/phase6/typecheck-comparison.mjs /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs storage /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs services /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs security /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs restart /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs normal /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs evaluation /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs audit /ABS/outputs/phase6-secure-NEW
node scripts/phase6/acceptance.mjs hub-check /ABS/outputs/phase6-secure-NEW
```

- 输出 basename 只接受小写字母、数字、连字符；上述 `NEW` 为占位符，实际替换为小写唯一标识。
- Core/Proxy/Hub/network 以输出目录名命名，loopback 端口固定为 19420/19096/19125/19424。先只读确认端口空闲；冲突时停止，不自动覆盖旧容器或改正式服务。
- secure 配置生成独立 gateway key 与 User Key，前者同时配置 Core、Proxy auth/tdai/coreSkill client 和 Hub 后端。不得把用户 key 当服务 Bearer，不关闭 Core 鉴权来解决兼容问题。
- 新 `auth.apiKey` 是可选 gateway 凭证；`auth.enabled: false` 默认不变；显式启用却缺 URL 会启动失败。所有 key 留在私有文件，日志不要打印 settings/config 全文。
- services 将源码复制到 `runtime/` 并冻结；Proxy 使用只读快照。真实 smoke 前检查工作区源码与快照相同；修改源码必须新建 Attempt，不覆写已有 runtime/source-freeze。
- `security` / `restart` 必须在两次真实 smoke 前运行，以便证明负例零模型调用。restart 只操作本轮 secure 命名实例，创建并停止独立 `-unbound` 故障容器（19097），保留它供审计，不删除数据。
- 重启时主 Proxy 从可信私有声明重新绑定 Evaluation；故障实例刻意省略绑定，必须 403。没有使用 HTTP header 自报 Evaluation，也没有新建在线绑定管理接口。
- `typecheck-comparison` 比较本次 auth 修复与 preflight Git revision；54 个旧错误不能记为 build PASS。该比较器针对本次修复文件清单，不是全仓通用差分系统。

### 查看与恢复

最新已验证实例：`phase6-secure-20260831-r2-{core,proxy,hub}`，Hub `http://127.0.0.1:19125`；测试凭证位于对应 Attempt 的 `private/hub-user-key.txt`。UI 需用户登录或明确允许代填后再验收。

保留 r1 失败实例、r2 fault 实例及旧 r5；本说明不提供批量删除指令。对故障先检查指定容器状态、挂载和 health，只在确认属于本轮测试范围后恢复。普通重启不会自动重跑 LLM；已产生 run.json 的主 smoke 不可覆盖。读取日志前先防止输出凭证或 fixture 原文，优先看脱敏 evidence。

正式服务 8420/8096/8125 及其配置始终不在这些操作范围内。
