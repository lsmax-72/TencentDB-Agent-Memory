# Codex 全局观测接入报告

日期：2026-09-08

## 结论

本机 Codex 已通过用户级 Hooks 接入 8125 主 MemoryHub。新 Codex 会话结束一个 turn 时，会把脱敏后的 prompt、工具事件、最终输出和运行上下文写入 `Codex Observation` Team 的「运行轨迹」。当前为 **capture-only**：不召回 Memory，不触发诊断、候选、评测或正式资产写入。

## 实现

- 用户级 Hooks：`/Users/lsmax/.codex/hooks.json`
- 本机配置：`/Users/lsmax/.codex/tencentdb-observer.json`
- Hook：`scripts/codex-observation/observer.py`
- Hub API：`POST /api/v1/evolution/observation/ingest`
- Team：`Codex Observation`（`team-bwdexbwtus`）
- Agent：`codex-global`（`agt-bwdetwvtgu`，private）

`Stop` 仅映射为 `codex_turn_stopped / OBSERVED`，不冒充 `host_task_complete`。Core 也拒绝把 observation trace 提交给 diagnosis，避免把普通回合结束误判为业务任务完成。

## 安全与可靠性

- 只允许 loopback HTTP endpoint；
- user key 只从 0600 文件读取，不进入 Hooks 配置；
- 客户端与 Core 双层凭证模式脱敏；
- 本地状态和 outbox 使用 0600；Hub 不可达时保留待补传记录；
- 重复终止事件按 `session + turn + terminal event` 幂等；
- Hook 异常始终退出 0，不改变 Codex 任务结果；
- trace 为 private，且不绑定正式资产。

## 实测

1. 合成 Hook：prompt + 1 个工具事件 + Stop 成功写入，status `OBSERVED`，outbox 清空。
2. 真实 Codex CLI：`gpt-5.4-mini` 的真实 turn 触发 `SessionStart → UserPromptSubmit → Stop`，成功写入记录 `evo-2d113502-76ff-4291-946e-b259dcf4fecf`。
3. 主服务：`tdai-memory-core`、`tdai-memory-hub` 均 healthy。
4. 验证：Core 169 tests / 38 files、Panel 4 tests、Hook 4 tests、Core/Panel/Web build 均通过；control strict typecheck 0 个新增错误。

## 使用方式

新开的 Codex 会话会加载用户级 Hooks。首次使用若出现 Hook trust 提示，在 Codex 中检查并信任 `/Users/lsmax/.codex/hooks.json`；官方机制见 [Codex Hooks 文档](https://learn.chatgpt.com/zh-Hans/docs/hooks)。

登录 `http://127.0.0.1:8125`，切换到 `Codex Observation` Team，再打开「自进化 → 运行轨迹」即可查看。旧窗口需重新打开任务或重启 Codex 才能稳定加载新配置。

## 当前限制

- Codex Hooks 没有提供 token/model-call usage，未知字段保存为 `null`，不填 0；
- 当前只采集，不向 Codex 注入 TencentDB Memory；
- `Stop` 是回合结束，不是任务完成，因此自动复盘仍关闭；
- 主环境 `EVOLUTION_AUTOMATION_ADMITTED=0` 保持不变。
