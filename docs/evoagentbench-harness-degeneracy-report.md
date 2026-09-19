# EvoAgentBench harness 退化与基础设施缺陷报告

日期：2026-09-14。范围：只读审计 + v9 runner-policy 正对照的准备过程。本报告不含任何新的效果结论。

## 1. 摘要

历史 attempt 中相当一部分"失败"并非模型能力失败，而是 **run 从未产出解题尝试**。本报告量化该退化签名、把两类互不相同的 harness 限制分开归因，并记录两个在准备正对照时暴露出的基础设施缺陷。

## 2. 退化签名（已量化）

判据（三者同时成立）：

- `model_call_count == 1`
- `tool_call_count == 0`
- `output_tokens` 正好等于协议声明的 `max_output_tokens_per_call`（8192）

此时的 `final_output` 是 nanobot 的工作区脚手架文本：

```text
Created HEARTBEAT.md / USER.md / SOUL.md / AGENTS.md / TOOLS.md / memory/MEMORY.md / memory/HISTORY.md
🐈 nanobot | I've completed processing but have no response to give.
```

官方 runner 的日志与之一致：`No code extracted from response`、`avg turns: 0.0`、`avg tokens: 0`。

### 跨 root 统计

| root | run 总数 | 退化 run | 退化率 | 占该 root 全部失败的比例 |
|---|---:|---:|---:|---:|
| code-v1 | 62 | 1 | 2% | — |
| code-v2 | 72 | 14 | 19% | **73.7%** |
| code-v3 | 48 | 5 | 10% | — |
| code-v4-semantic | 72 | 10 | 14% | **76.9%** |
| code-v5-factorial | 24 | 1 | 4% | — |
| code-v8-factorial-composite | 72 | 3 | 4% | 25.0% |
| **合计** | **350** | **34** | **10%** | — |

**结论：code-v2 与 code-v4 的失败里，约四分之三从未尝试过题目。** 这些 run 不携带能力信号，不能计入能力失败，也不能算作有效配对观测。

## 3. 两类限制被分开归因

在 276 个有 proxy-events 的 run 中，37 个（13%）至少有**一次调用触顶**，但每次调用的完成 token 中位数只有 **1,738** —— 分布是双峰的：多数调用很短，少数调用把整个预算烧在长文本上。

两个机制可被机器区分：

| 机制 | 判据 | 实例 |
|---|---|---|
| **输出截断** | `completion_tokens >= cap` | 34 个退化 run；`abc342_e`、`abc326_d` 等 |
| **迭代耗尽** | `model_call_count >= max_tool_iterations` | `abc388_e`：12 次调用 / 13 次工具，但 max completion 仅 6,220 → **不是**截断 |

上下文窗口**不是**瓶颈：单次 prompt 最大 **18,779** token，声明 65,536，无 run 接近。

### 已实现的检测

`adapter.parse_proxy_events(path, output_token_cap=...)` 现在输出 `max_completion_tokens`、`truncated_call_ids`、`truncated_call_count`，`driver` 从协议传入上限，evidence 记录这三个字段。这样"截断"与"答错"在证据层就分开了，不再靠推断。

## 4. v9 runner-policy 的改动与依据

| 旋钮 | v8 | v9 | 依据 |
|---|---|---|---|
| `max_output_tokens_per_call` | 8192 | 16384 | 13% 的 run 触顶；中位调用 1,738 |
| `max_tool_iterations` | 12 | 24 | `abc388_e` 自测时耗尽 12 次 |
| `context_window_tokens` | 65536 | **不变** | 无一 run 接近，无证据支持改动 |

两个旋钮同时改的理由已写入协议：它们各自对应一个**已诊断且互不相同**的签名。**未**把 thinking 开关捆绑进来 —— 那是行为变更，应作为独立因子。

## 5. 基础设施缺陷（本次准备过程中实测）

### 5.1 `run_id` 未按协议/root 隔离 → MemoryCore 409

`run_id` 形如 `development-3000-vanilla-trial-1`，**不含 protocol 或 root 标识**，而 MemoryCore 的 ingest 以 `run_id` 为键。于是同一 run_id 在不同协议下重复执行时：

```
api("/v3/evolution/benchmark/run/ingest", ...) -> HTTP 409 Conflict
```

实测：`development-3000-vanilla-trial-1` 同时存在于 `code-v8-factorial-composite` 与 `positive-control-v1` 两个 root，后者 ingest 失败。

**影响**：跨协议复用 run_id 时 Hub 记录会冲突，且不同 runner policy 的实验会被混为一谈。

**当前缓解**：`positive_control.collect` 把"evidence 已写入但 Hub 同步失败"识别为 **Hub 副作用**而非测量丢失 —— 因为 driver 先写不可变 evidence、后调 ingest。失败会记录进 `hub_ingest_errors`，不静默吞掉。

**建议修复**（未实施，需评审）：ingest 键加入 `protocol_hash`（evidence 里已有该字段），使 run 记录按协议作用域隔离。

### 5.2 无 evidence 的残留 run 目录会阻断重试

`driver.run_trial` 在**校验 phase cache 之前**就创建 `runs/<run_id>/`，因此一次前置校验失败会留下空目录；而"目录已存在但无 evidence"被正确判定为 `POSITIVE_CONTROL_RUN_INCOMPLETE`，从而阻断重试。

**当前缓解**：把这类残留目录移出 `runs/` 到 `superseded-attempts/`（保留，不删除），因为它们**没有产生任何模型调用**（0 token），不构成测量数据。

**建议修复**（未实施）：把 `run_dir.mkdir` 移到所有前置校验之后，或让 driver 在自身前置失败时清理自己刚创建的空目录。

### 5.3 环境解释器缺陷：`zip(strict=)` 在 3.9 下崩溃，伪装成模型失败

**症状**：某条 memory run 只用了 **0.2 秒、0 token** 就记录为失败，`official.log` 显示 `avg turns: 0.0`，看起来像模型没有响应。

**实际**：兼容层脚本 `nanobot_cli_compat.py` 崩在 `retrieval.py` 的 `zip(assets, documents, strict=True)`，报 `TypeError: zip() takes no keyword arguments`。

**根因**：该脚本的 shebang 是 `#!/usr/bin/env python3`，而本机环境 `python3` 是 **3.9.6**；`zip(strict=)` 需要 3.10+。这个脚本是**由 benchmark runner 通过 agent command 直接执行**的（`driver.py` 与 `ir_driver.py` 写入 `command: <wrapper>` 到 agent YAML），因此决定解释器的是 shebang，而不是调用方。pipeline 其余部分都由显式解释器（`str(PYTHON)` / `sys.executable`）启动，所以只有这一处暴露。

**为什么长期潜伏**：v9/v11/v12 的正对照用的是 `forced-injection-v1`，不经过 `zip(strict=)`；第一次用 legacy 路径注入 Memory 才触发。

**已修**：

1. shebang 固定为 benchmark 解释器（`/Users/lsmax/Coder/EvoAgentBench/.venv-tdai/bin/python`），与仓库既有的 `PYTHON` / `REAL_NANOBOT` 绝对路径固定风格一致。
2. 新增 `interpreter.py`：导入时即校验 `sys.version_info >= (3, 10)`，否则抛出**可操作**的错误（指明所需版本、当前版本与应使用的解释器路径）。`retrieval.py` 与 `metrics.py` 导入它，因此任何入口点到这两个模块都会得到清晰报错，而不是深处的一个裸 `TypeError`。
3. 测试覆盖：shebang 不得指向 `env python3`、守卫拒绝 3.9、需保护的模块确实导入守卫。

**教训**：被"环境解释器"执行的脚本必须自带守卫。否则一个解释器版本问题会以"0.2 秒的模型失败"形式出现，与真实的 benchmark 失败无法区分 —— 这正是本项目一直在处理的同一类问题（把 harness 故障误读成能力失败）。

### 5.4 phase cache 的 manifest 绑定 protocol hash

`subset_cache.validate` 要求 `manifest["protocol_hash"] == protocol["protocol_hash"]`。任何协议哈希变更（例如修正候选资产的 `content_hash`）都会使既有 cache 失效，必须重建（缓存内容不变，仅 manifest 绑定改变）。这是**正确**的 fail-closed 行为，但重建成本约数分钟（源文件 4.5GB），规划时需要预留。

## 6. 对结论的影响

- 历史"失败率"被显著高估；`max_possible_transfer_gain` 一类读数在含退化 run 的 suite 上偏乐观，必须与 `harness_degeneracy` 一起解读。
- 退化的**间歇性**（同题部分 run 命中）意味着它同时贡献**假失败**与**额外方差**，因此样本量预算需按 `n × (1 − 退化率)` 折算（见 `docs/evoagentbench-power-preregistration.md`）。
- v9 的预算改动**预期**降低退化率，但该预期必须由 v9 自身的 run 实测确认，不得沿用历史数字。

## 7. 复现方式

```bash
python3 -m scripts.evoagentbench.exposure_audit \
  --root <artifact-root> --audit-id <id> --candidate-revision <n> --no-write
python3 -m unittest scripts.evoagentbench.test_exposure_audit
```

## 7.1 跑批前的磁盘体检（每次开跑前做一次）

早期失败的 attempt 会把整个 HuggingFace 数据集下载进自己的临时 HOME，单个 run 可达 8 GB。这类目录没有任何测量价值（只是公开数据集的重复拷贝），但会一路累积。跑批前先看一眼：

```bash
du -sh /Users/lsmax/Coder/evoagentbench-artifacts
du -sh /Users/lsmax/Coder/evoagentbench-artifacts/*/runs/*/private/home 2>/dev/null | sort -rh | head
```

若某个 `private/home` 明显偏大（通常来自 `INFRA_ERROR` 的 attempt），可只删该目录，保留同 run 的
`evidence.json`、`official/`、日志与配置：

```bash
rm -rf <root>/runs/<run-id>/private/home
```

核对方式：删除后该 run 的 `evidence.json`（若有）与 `private/*.yaml`、`private/*.log` 应当仍在。
实测两个这样的目录合计回收 **14.6 GB**，artifact 树从 15 GB 降到 483 MB，失败记录一条未丢。

## 8. 边界

- 本报告只描述 harness 与证据层；不含效果结论，不改写任何历史 attempt 或 Gate。
- 5.1/5.2 的建议修复**尚未实施**，需在你放行后进入评审。
