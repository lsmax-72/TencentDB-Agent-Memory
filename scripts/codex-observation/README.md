# Codex 全局观测接入

`observer.py` 接收 Codex 用户级 Hooks 的 JSON stdin，在本地聚合一个 turn 的 prompt、工具结果和最终回复，并发送到主 MemoryHub 的 `observation/ingest`。

- 只处理 loopback HTTP endpoint；
- 凭证只从 0600 文件读取，不写入 Hooks 配置；
- 工具输入输出先做凭证字段脱敏和长度限制；
- Hub 不可用时留下 0600 outbox，下次终止事件再补传；
- `Stop` 只记录 `codex_turn_stopped`，不冒充 `host_task_complete`，不触发诊断或候选。

当前接入是 capture-only。它不代理 Codex 模型请求，不启用 Memory 召回，也不启用自动进化。
