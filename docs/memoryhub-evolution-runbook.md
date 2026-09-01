# MemoryHub 自进化本机运行与恢复

本文只描述 2026-09-01 已交付的本机 standalone 8125。不要据此修改云 TencentDB、正式 Promotion 或历史评测协议。

## 当前运行形态

- MemoryHub：`http://localhost:8125`
- MemoryCore：`http://localhost:8420`
- MemoryKnowledge：`http://localhost:8424`
- 容器：`tdai-memory-core`、`tdai-memory-hub`
- 数据卷：`tdai-memory-core-data`、`tdai-panel-data`
- 冻结代码：`/Users/lsmax/Coder/phase6-artifacts/runtime/memoryhub-main-20260901-r1`
- 一致性备份：`/Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-1535`
- 验收记录：`/Users/lsmax/Coder/phase6-artifacts/outputs/memoryhub-main-20260901-r1`

主环境保持 `EVOLUTION_AUTOMATION_ADMITTED=0`，未配置 review model 或 Skill evaluator。缺少这些配置时只允许查看历史和保存关闭状态，不调用模型或写正式候选。

## 日常启动与健康检查

容器沿用原部署的手动启动策略。Mac / Docker Desktop 重启后执行：

```bash
docker start tdai-memory-core
curl -fsS http://127.0.0.1:8420/health

docker start tdai-memory-hub
curl -fsS http://127.0.0.1:8125/health
curl -fsS http://127.0.0.1:8424/health
```

状态检查：

```bash
docker ps --filter name=tdai-memory --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs --tail 100 tdai-memory-core
docker logs --tail 100 tdai-memory-hub
```

不要同时重启大量隔离容器；Docker Desktop 内存压力曾导致 exit 137。主服务按 Core → Hub 顺序启动或重启。

## 现有备份怎样核验

```bash
cd /Users/lsmax/Coder/phase6-artifacts/backups/memoryhub-main-20260901-1535
shasum -a 256 -c volume-archives.sha256
shasum -a 256 -c runtime-sha256.txt
```

`private/` 包含原容器 inspect 和环境文件，权限为 0600。不要上传、提交到 Git 或复制其内容到日志。

## 容器丢失但数据卷正常

不要恢复 volume archive。先确认两个 named volume 仍存在：

```bash
docker volume inspect tdai-memory-core-data tdai-panel-data
```

然后用备份 `private/*.inspect.json`、`private/core.env`、`private/hub.env` 和冻结 runtime 重建容器。重建必须继续挂载：

- Core：原 gateway YAML、`tdai-memory-core-data`、冻结 `core-src`；
- Hub：`tdai-panel-data`、冻结 `panel-dist`、`web-dist`、`knowledge-dist`；
- 两者：原 `tdai-memory-stack` 网络和备份 env 文件。

重建前先用 `docker inspect` 对照端口、network alias 和 image digest；不得临时改成 `latest` 或重新生成 admin key。

## 数据恢复

只有确认 named volume 内容损坏时才恢复 archive。先停止 Core/Hub，并创建新的 recovery volume 验证归档，不要直接覆盖现有卷：

```bash
docker stop tdai-memory-hub tdai-memory-core
docker volume create tdai-memory-core-data-recovery-20260901
docker volume create tdai-panel-data-recovery-20260901
```

分别把 `tdai-memory-core-data.tar.gz`、`tdai-panel-data.tar.gz` 解压到 recovery volumes，再以不同容器名和 loopback 测试端口启动验证。确认用户、Team、Memory、Wiki 和历史 hash 后，才决定是否切换正式容器。这个最终切换会改变当前数据来源，应单独人工确认。

## 8125 验收入口

登录后切换 Team：

- `default-team`：原有正式本地资产；
- `自进化历史 / TEST ONLY`：只读 v4 历史，不运行模型。

在后者的「评测中心」应看到 `FAIL / NO_NEW_FIX`，在「候选资产」应看到 `HISTORICAL_FROZEN / 历史证据·只读`；「进化概览」应显示 0 adoption 和运行准入关闭。若这些条件不一致，先停止自动化配置操作并检查 Core/Panel 日志。

## 当前明确限制

- 未运行真实复盘模型；离线 fixture 只证明工程控制流。
- Skill evaluator 未配置，因此 Skill Candidate 必须保持阻塞。
- Docker Hub 网络超时使本轮没有产出新的可分发镜像；当前容器依赖只读冻结 runtime。
- 未验收云 TencentDB 或生产部署。
