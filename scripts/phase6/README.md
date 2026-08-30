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
