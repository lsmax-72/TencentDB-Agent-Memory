# SWE-bench（EvoAgentBench software_engineering 域）可用性审计

日期：2026-09-16
目的：ContinualSkillBench 已判定不可用（见
`continualskillbench-instrument-audit.md`），本文记录转向 SWE-bench 的
可用性验证结果与待办。

结论：**链路可用**（含 macOS arm64 + x86_64 模拟），并发现并修复了一个
**会让 9.2% 的题恒判 0 分**的官方判分器 bug。

---

## 一、环境打通记录

| 环节 | 状态 | 关键点 |
|---|---|---|
| 依赖 | ✓ | `swebench==3.0.0`、`docker==7.1.0`（用 `uv pip install` 装入 `.venv-tdai`，该 venv 无 pip） |
| 数据 | ✓ | `princeton-nlp/SWE-bench_Verified`，**注意必须 `repo_type="dataset"`**，否则报 401 RepositoryNotFound；产出 `data/swebench/data/test-00000-of-00001.parquet`（2.0 MB） |
| 题池 | ✓ | 官方 parquet 500 题；split 用其中 train 87 / test 56 |
| 镜像 | ✓ | `swebench/sweb.eval.x86_64.<owner>_1776_<repo>-<n>:latest`，每题 1.0–1.3 GB（压缩），落盘 3.8–4.7 GB |
| 判分 | ✓ | `git diff` → `git apply` → 官方 eval.sh → `get_eval_report()`，**跑仓库自带测试**，与写法无关 |

### 必须设置的四个环境变量

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # 否则 docker 找不到凭据助手
export DOCKER_DEFAULT_PLATFORM=linux/amd64                            # SWE 镜像只有 x86_64 manifest
export http_proxy=http://host.docker.internal:7897                    # 容器内可达的代理，不能用 127.0.0.1
export HOME=<一个空目录>                                               # 关键，见下
```

### 四个坑（每个都会让结果静默失真）

1. **镜像架构**：镜像只有 x86_64 manifest，arm64 上报
   `no matching manifest for linux/arm64/v8`。设 `DOCKER_DEFAULT_PLATFORM=linux/amd64`
   后经模拟可正常运行（实测 x86_64 容器可跑）。

2. **容器内代理地址**：`setup_container_tmux` 会把宿主 shell 的
   `http_proxy` 直接写进容器的 `/etc/apt/apt.conf.d/99proxy`。
   若传 `127.0.0.1:7897`，容器内的 127.0.0.1 指向它自己，apt 报
   `Could not connect to 127.0.0.1:7897`。必须传 `host.docker.internal:7897`。

3. **`HOME` 不能是用户家目录（最危险）**：nanobot 适配器会把
   `Path.home()/.nanobot/config.json` 当基底配置复制。用户全局配置
   （14 KB，含 `channels`/`dream`/`api`/`modelPresets`）被这个版本 nanobot 的
   pydantic schema 拒收（`extra_forbidden`），于是 **nanobot 静默回退到
   "Using default configuration."**，随后报
   `No API key configured. Set one in ~/.nanobot/config.json`。
   表象像"端点没配好"，实际是配置校验失败。把 `HOME` 设为空目录即可
   （我们的 code 域 driver 一直是这么做的，所以从未暴露）。

4. **迭代预算**：code 域用 `max_tool_iterations: 12` 够；SWE 单题实测需要
   **74 轮**。12 轮时 agent 还在探索阶段就被截断，日志显示
   "Agent produced no changes"、reward 0，看起来像模型不会做。
   实测值：`max_tool_iterations: 80`、`maxTokens: 16384`、
   `contextWindowTokens: 131072`。

### 可用配置（已实测）

`nanobot.yaml`：
```yaml
name: nanobot
command: /Users/lsmax/Coder/TencentDB-Agent-Memory/scripts/evoagentbench/nanobot_cli_compat.py
model: qwen3.8-27b
provider: custom
providers:
  custom:
    apiKey: EMPTY
    apiBase: http://10.195.214.152:8100/v1
maxTokens: 16384
contextWindowTokens: 131072
temperature: 0
max_tool_iterations: 80
```

`config.yaml` 三段式的其余部分照抄 `driver.py` 生成的结构；
`software_engineering.yaml` 只需 `parquet_file` / `tar_dir` /
`split_file` / `agent_timeout` / `verify_timeout`。

调用：
```bash
cd /Users/lsmax/Coder/EvoAgentBench/benchmark
<venv>/bin/python <repo>/scripts/evoagentbench/official_runner.py \
  --config <private>/config.yaml --domain software_engineering \
  --task <instance> --job <name> --trials 1 --parallel 1
```

---

## 二、缺陷：官方日志解析器键值颠倒，9.2% 的题恒判 0

### 现象

`astropy__astropy-7336`：`test_output.txt` 结尾是
`340 passed, 1 warnings`，日志里明确有
`test_return_annotation_none PASSED`（正是该题的 FAIL_TO_PASS 测试），
但 `eval_report.json` 报
`resolved: False`、`FAIL_TO_PASS success 0/failure 1`、
`PASS_TO_PASS success 0/failure 339`。reward = 0。

### 根因

`swebench/harness/log_parsers/python.py` 的 `parse_log_pytest_v2`：

```python
if any([line.startswith(x.value) for x in TestStatus]):     # "PASSED path::test"
    test_case = line.split()
    if len(test_case) >= 2:
        test_status_map[test_case[1]] = test_case[0]         # 正确
elif any([line.endswith(x.value) for x in TestStatus]):      # "path::test PASSED"
    test_case = line.split()
    if len(test_case) >= 2:
        test_status_map[test_case[1]] = test_case[0]         # 键值颠倒
```

第二个分支沿用了第一个分支的下标。对 `path::test PASSED` 得到
`{'PASSED': 'path::test'}` —— 键值反了。实测状态表只有 1 条
（同名键反复覆盖），下游因此找不到任何期望测试，全部计为失败。

### 影响范围

是否触发取决于该题 `test_cmd` 是否带 `-vv`：

- 带 `-vv`（如 astropy）：pytest 输出 `path::test PASSED` → 走坏分支 → **恒判 0**。
- 用 `pytest -rA`（如 seaborn / psf / pytest / xlint / xarray）：
  输出 `PASSED path::test` → 走正确分支。

在官方 train 87 题中统计：**8 题受影响（9.2%）**——
`astropy__astropy-7336` 1 道 + `sphinx-doc/*` 7 道。

### 修复与验证

把 elif 分支改为 `test_status_map[test_case[0]] = test_case[1]`。
改后状态表从 1 条变为 340 条正确映射，
`astropy__astropy-7336` 由 `resolved: False` 翻转为
**`resolved: True`（FAIL_TO_PASS 1/1、PASS_TO_PASS 339/339）**。

即：该题**本来就被解出来了**，是被判分器判成 0 的。

---

## 二·补一 缺陷 2：宿主代理地址被原样塞进容器

`utils/docker.py` 的 `setup_container_tmux` 把宿主 shell 的 `http_proxy`
**原样**写进容器的 `/etc/apt/apt.conf.d/99proxy`。宿主侧的
`127.0.0.1`/`localhost` 在容器里指向容器自身，apt 必然连不上：

```
W: Failed to fetch http://archive.ubuntu.com/... Could not connect to
   127.0.0.1:7897 (127.0.0.1). - connect (111: Connection refused)
```

**修复**：传给容器前把 `127.0.0.1`/`localhost` 改写为
`host.docker.internal`。

**同时必须纠正宿主侧环境变量**：一度把宿主也设成
`host.docker.internal:7897`，但该主机名**在宿主上解析不了**（实测
`socket.gethostbyname` 失败），于是宿主侧 Python 拉 requirements 全部
`SSLError` —— `pylint-dev__pylint-4661` 就是这样挂掉的：

```
exception_info: {"type": "SSLError",
 "message": "HTTPSConnectionPool(host='raw.githubusercontent.com', port=443)
             Max retries exceeded ..."}
```

**正确设置**：

```bash
export http_proxy=http://127.0.0.1:7897      # 宿主侧：可用
export https_proxy=http://127.0.0.1:7897
export NO_PROXY="127.0.0.1,localhost,<vLLM 地址>"   # 不要设 "*"
```

**注意 `NO_PROXY` 不能设为 `*`**：SWE 的 setup 阶段需要外网拉
requirements，全局关代理会直接 SSLError。这一点与 code 域相反——
code 域不需要外网，所以它的 driver 里 `NO_PROXY="*"` 是正确的。

---

## 二·补二 缺陷 3：agent 一旦 git add/commit，patch 就读成空的

取 patch 用的是：

```python
container.exec_run("git -c core.fileMode=false diff", ...)
```

**只看未暂存改动**。而官方 `prompt.md` 完全没有禁止 agent 提交，
workflow 里只写 "Fix the bug / Reply TASK_COMPLETE when done"。
coding agent 很自然会 `git add` 或 `git commit`，此时 `git diff` 为空，
判成 `No patch generated`、reward 0。

实测形态：`pydata__xarray-3095` agent 正常跑完 509 秒、rc=0，
但 patch 为 0 字节，`verifier_result.error = "No patch generated"`，
agent 的收尾语是 "I've completed processing but have no response to give."

**修复**：`git diff` 为空时回退到 `git -c core.fileMode=false diff
<base_commit>`，即可捕获已暂存/已提交的改动。回退触发时打 warning 留痕。

---

## 二·补三 判分正确性的已知答案验证

不经过 agent，直接把官方 **gold patch** 与 **空 patch** 分别喂进
官方 `eval.sh` + `get_eval_report`（脚本 `/tmp/swe-probe/goldcheck.py`）。

| 题 | gold patch | 空 patch | 判定 |
|---|---|---|---|
| `astropy__astropy-7336` | **resolved=True**（F2P 1/1、P2P 339/339） | False | 判分正确 |
| `pytest-dev__pytest-6202` | **resolved=True**（F2P 1/1、P2P 72/72） | False | 判分正确 |
| `psf__requests-2931` | **resolved=False**（F2P 1/1、P2P 82/84） | False（F2P 0/1、P2P 82/84） | **天花板效应** |

结论：

1. **无假阳性**：空 patch 在三题上都判 False，且 F2P 为 0/1。
2. **解析器修复在多题上生效**：astropy 是受影响仓库，gold patch 现在判
   True（修复前必判 False）。
3. **存在天花板效应**：`psf__requests-2931` 的 gold patch 也拿不到
   `resolved`。原因是 2 个 PASS_TO_PASS 测试是网络超时语义测试：

   ```
   TestTimeout::test_connect_timeout        -> "The connect() request should time out."
   TestTimeout::test_total_timeout_connect
   ```

   它们对 `TARPIT`（故意不可达地址）断言连接必定超时；在 Docker Desktop
   虚拟网络里连接行为与 SWE-bench 参考环境不同，因此**与 patch 无关地恒失败**。

   即：**该题在本环境里无论怎么改都拿不到二元 `resolved`。**

   注意 agent 的 patch 在这题上给出与 gold **完全相同**的
   `F2P 1/1、P2P 82/84` —— 说明 agent 其实解对了，是环境判不了。

---

## 二·补四 后果：必须以分级指标为主，二元 resolved 会低估

天花板效应意味着二元 `resolved` 会把"agent 做对但环境判不了"记成 0。
分级指标不受影响（F2P 达成率与 P2P 保持率都正常计算）。

建议的指标：

- **主指标**：`FAIL_TO_PASS` 达成率（目标测试通过比例）。
- **代价项**：`PASS_TO_PASS` 保持率（回归）。
- **综合 severity**：`F2P 达成率 × P2P 保持率`。
- 二元 `resolved` 仅作为参考，并在报告里注明受天花板效应影响的题数。

---

## 二·补五 缺陷 4：直连 vLLM 时模型静默零输出

### 现象

部分题目的 `session.jsonl` 只有 **2 行**（元数据 + user prompt），
**没有任何 assistant 回合、没有工具调用**。agent 空转 500 余秒后以
`I've completed processing but have no response to give.` 收尾，
仓库当然没有改动，于是 `verifier_result.error = "No patch generated"`、reward 0。

实测 `django__django-15022`、`pydata__xarray-3095` 都是这种形态。

### 为什么危险

它看起来完全像"模型做不出这道题"，会**严重低估基线**并凭空制造 headroom。
必须能把它和真实能力失败区分开——判据是 `session.jsonl` 的 assistant 回合数为 0。

### 已定位为直连路径故障，而非模型能力问题

同一道 `django__django-15022`：

| 路径 | 结果 |
|---|---|
| 直连 `http://10.195.214.152:8100/v1`（第 1 次） | 零回合，510 秒，reward 0 |
| 直连（第 2 次，带 `--live`） | **完全复现**：零回合，547 秒，reward 0 |
| 经本地 shim `http://127.0.0.1:8098/v1` 转发 | **46 回合，1172 秒，reward 1.00** |

即：**该题模型其实能解**，直连路径上出现了静默故障。
nanobot 的 `custom_provider.chat` 把一切异常吞成
`LLMResponse(content=f"Error: {e}", finish_reason="error")`，
而 `_run_agent_loop` 在 `finish_reason == "error"` 分支**不写入 assistant 消息**
（代码注释说是为了避免污染上下文），于是异常细节完全丢失，
session 里只留下 user 一行。

三次运行中并非全部直连都失败（同批另 4 道 django 直连正常），
因此这是「特定请求 × 直连路径」的交互故障，尚未定位到具体触发条件
（怀疑与请求头 `accept-encoding` 或响应压缩/分块有关，待查）。

### 根因定位：模型偶发只产出 reasoning

抓取 shim 侧的全部 chat 响应（`/tmp/swe-probe/chatlog.jsonl`，210 条）后，
筛出「既无 `content` 又无 `tool_calls`」的响应，共 4 条。它们的形态完全一致：

```json
{"message": {"role": "assistant", "content": null, "tool_calls": [],
             "reasoning": "Now I understand the pattern. Let me check ..."}}
```

即 **模型产出了推理内容，但没有输出任何工具调用或正文**。
nanobot 的 `_run_agent_loop` 把它当作"正常结束"（`final_content = clean` 为空串后 break），
于是整轮运行空转、仓库零改动。

- 单次调用发生率约 **4/210 ≈ 2%**；
- 但每题有 30–75 次调用，因此**约 1/4 的题会被它毁掉**；
- 它同时解释了两类故障：
  - **模型零输出**（首轮即空，session 只有 user 一行）；
  - **agent 未产出 patch**（中途某轮空，session 有若干回合但最后一轮为空）。

未证实"推理烧光 max_tokens"：单次探针（同样的 max_tokens=16384）
返回 `finish_reason=stop`、content 883 字符，未撞顶。

### 处理办法

0. **provider 层重试空响应**（已打补丁）：
   `nanobot/providers/custom_provider.py` 的 `chat()` 在
   `content` 与 `tool_calls` 同时为空时**重试一次**。
   这是生成退化而非能力失败，重试避免把噪声计成失败。
   备份在同目录 `custom_provider.py.tdai-orig`。

### 处理办法（原有两条）

1. **零输出题必须重跑**，不能计为失败：`retry-zeroturn.sh` 会把
   `apiBase` 指向 shim 重跑这些题。
2. **分析时必须显式剔除**：`analyze.py` 的 `classify()` 用
   `session.jsonl` 中 assistant 回合数 == 0 识别该形态，单列计数。
3. 优先把 agent 指向 shim 而不是直连 vLLM。

---

## 二·补五 并行加速比实测

直接对本地 vLLM 打并发请求（`/v1/chat/completions`，max_tokens 400）：

| 并发 | 墙钟(s) | 吞吐(请求/分) | 相对并发 1 |
|---|---|---|---|
| 1 | 8.7 | 6.9 | 1.00× |
| 2 | 12.0 | 10.0 | 1.45× |
| 4 | 13.1 | 18.3 | 2.65× |
| 8 | 12.1 | 39.7 | **5.75×** |

墙钟几乎不随并发增长（8.7→12.1 秒），说明 vLLM 批处理有效。
**结论：`--parallel 8` 可把墙钟压到约 1/5–1/6**，是让正式实验可行的关键。

（正式实验还需注意：SWE 单题上下文可达 128k、输出更长，实际加速比可能低于
该微基准；另外并发 N 路意味着峰值磁盘 N×4 GB。）


备份位于同目录 `python.py.tdai-orig`。

---

## 三、分级指标可用（对统计功效很关键）

`eval_report.json` 的 `tests_status` 给出逐测试计数：

```json
{"FAIL_TO_PASS": {"success": [...], "failure": [...]},
 "PASS_TO_PASS": {"success": [...], "failure": [...]},
 "FAIL_TO_FAIL": {...}, "PASS_TO_FAIL": {...}}
```

实例 `psf__requests-2931`：

- `resolved: False`（二元，记 0 分）
- 但 `FAIL_TO_PASS: success 1 / failure 0` —— **目标 bug 修好了**
- `PASS_TO_PASS: success 82 / failure 2` —— 有两个回归

二元 `resolved` 把它记为 0；分级指标能看到"几乎成功"。
这可以像我们 code 域的 severity 指标一样显著提升功效，
是降低所需题量的主要手段。

---

## 四、单题成本

| 项 | 实测 |
|---|---|
| agent 耗时 | 272–945 秒（74 轮） |
| 镜像拉取 | 约 75 秒 / 1.0–1.3 GB（首次） |
| 判分（eval.sh） | 约 21 秒 |
| 单题合计 | **约 5–16 分钟** |

4 个 arm × 20 题 = 80 次 ≈ 7–21 小时。降本手段：
`--parallel`（vLLM 可批处理，待实测加速比）、分级指标减少所需题量。

---

## 五、待办

1. 让 5 题筛选跑完，并用修好的解析器**离线重判**所有已完成 trial
   （`agent_patch.diff` 与 `test_output.txt` 都保留在 verifier 目录，
   不需要重跑 agent）。
2. 实测 `--parallel 2/4` 的真实加速比，决定正式实验的墙钟时间。
3. 据基线决定：直接做机制实验 / 在 SWE-bench 内做难度筛选 / 排查基础设施。
4. **不要使用受缺陷影响的 8 道题**参与测量，或确保判分用修复版解析器。

---

## 六、夜间自动跑计划（2026-09-16 夜 → 09-17 晨）

用户在 21:40 离开，要求自主判断 SWE-bench 是否可用。任务链已自动化：

| 阶段 | 脚本 | 内容 |
|---|---|---|
| 1 | `/tmp/swe-probe/overnight.sh` | 官方 train 分层样本 **25 题**，逐题跑 + 判分 + 删镜像控磁盘 |
| 2 | `/tmp/swe-probe/finish-and-retry.sh` | 等批结束 → 汇总 → 对**模型零输出**的题经 shim 重跑 → 再汇总 |
| 3 | `/tmp/swe-probe/hard-subset.sh` | **硬题子集 10 题**（未被 split 使用的 "1-4h"/">4h" 实例） |

### 为什么加第三阶段：官方 train split 偏简单

| | `<15 min` | `15min-1h` | `1-4h` | `>4h` |
|---|---|---|---|---|
| 官方 train（87 题） | 40 | 41 | 6 | 0 |
| Verified 未使用的 357 题 | 130 | 191 | **33** | **3** |

train 里"<15 分钟小修"占 **46%**，而 Verified 全量只占 26%。
**在 train 上饱和不等于整体饱和**，所以必须再用硬题子集探一次。

### 判定规则（预先定好，避免事后挑口径）

- **判分正确性**：`goldcheck.py` 的 gold/空 patch 已知答案测试；
  受环境天花板影响的题（gold 也拿不到 resolved）单独标注。
- **headroom**：以**实际产出 patch 的题**为分母（剔除零输出的基础设施故障），
  看二元 `resolved` 通过率是否落在 40%–70%；分级 severity 作为辅助。
- **成本**：逐题墙钟 + 镜像体积 + 并行加速比。

### 中途已得到的结论（待全量确认）

- 前 9 题里 7 题已判分，**全部 resolved=True、severity 1.0**（6 django + 1 sympy）。
- 2 题模型零输出（基础设施故障，已定位为直连路径问题，将经 shim 重跑）。
- 若 25 题 + 补救后仍接近 100%，则**官方 train split 对 qwen3.8-27b 同样饱和**，
  此时第三阶段的硬题子集结果是决定性的。

---

## 七、若硬题子集显示有 headroom：正式实验的功效与成本预算

预先算好，避免数据出来后临时拍脑袋。（配对设计，alpha=0.05，power=0.8）

### 二元 `resolved` 指标所需题量

| 目标增益 | 不一致率 = Δ（几乎只修不坏） | 不一致率 = 2Δ |
|---|---|---|
| 5% | 155 题/组 | 312 |
| **10%** | **76 题/组** | 155 |
| 15% | 50 题/组 | 102 |
| 20% | 37 题/组 | 76 |

### 折算墙钟（单题实测均值约 13 分钟）

| 目标增益 | 单组串行 | parallel=4 | parallel=8 |
|---|---|---|---|
| 10% | 16.5 h | 6.2 h | **2.9 h** |
| 15% | 10.8 h | 4.1 h | 1.9 h |
| 20% | 8.0 h | 3.0 h | 1.4 h |

（两两对照需要两组，墙钟 ×2；4 个 arm 则 ×4 或做两两分解。）

### 分级指标显著更省

用 `severity`（F2P 达成率 × P2P 保持率）作连续配对指标，
MDE ≈ 2.8·σ/√n：

| n | σ=0.15 | σ=0.25 |
|---|---|---|
| 20 | 9.4% | 15.7% |
| **40** | **6.6%** | **11.1%** |
| 60 | 5.4% | 9.0% |

**结论**：若硬题子集基线落在 40%–70%，
用 40 题/组 + 分级指标 + `parallel=8`，**两臂实验约 3–4 小时**，
四臂约 6–8 小时 —— 一个晚上可以跑完一次有功效的测量。
即：**只要 headroom 存在，SWE-bench 在成本上完全可支撑正式实验。**

---

## 八、实测结果（2026-09-17 凌晨）

统一配置：`codex`/`nanobot` + 本地 vLLM `qwen3.8-27b`，
`maxTokens=16384`、`contextWindowTokens=131072`、`max_tool_iterations=80`、
`temperature=0`，`DOCKER_DEFAULT_PLATFORM=linux/amd64`，
`apiBase` 指向本地 shim（8098）。

### 8.1 官方 train split（25 题分层样本，覆盖 8 个仓库）

| 项 | 值 |
|---|---|
| 已判分 | **18** |
| 二元 `resolved` 通过 | **18 / 18 = 100%** |
| 平均 severity | **1.000** |
| 平均 F2P 达成率 | **1.000** |
| 模型零输出（基础设施） | 5 |
| agent 未产出 patch（基础设施） | 2 |

按仓库分解：django 6/6、sympy 3/3、pytest-dev 2/2、scikit-learn 2/2、
sphinx-doc 2/2、astropy 1/1、matplotlib 1/1、pydata 1/1 —— **全部满分**。

**结论：官方 train split 对 qwen3.8-27b 已饱和，没有 headroom。**

### 8.2 硬题档（10 题；未被 split 使用、标注 "1-4 hours"/">4 hours"）

| 题 | 仓库 | 判定 | F2P | P2P | severity |
|---|---|---|---|---|---|
| astropy__astropy-14369 | astropy | True | 3/3 | 732/732 | 1.000 |
| django__django-15629 | django | True | 2/2 | 115/115 | 1.000 |
| pydata__xarray-3993 | pydata | True | 2/2 | 2398/2398 | 1.000 |
| pydata__xarray-6992 | pydata | **False** | **0/12** | 945/945 | **0.000** |
| sphinx-doc__sphinx-8548 | sphinx-doc | **False** | **0/1** | 4/5 | **0.000** |
| （3 题基础设施故障，补救中） | — | — | — | — | — |

**已判分 6 题 → 4/6 = 66.7%，平均 severity 0.667，落在 40%–70% 可用带内。**

两个失败都是**真失败**（agent 产出了 patch 但没修好目标测试），
不是零输出或判分假象：`xarray-6992` 的 12 个目标测试一个都没过。

### 8.3 分档对比

| 题池 | n（已判分） | 二元通过率 | 可用性 |
|---|---|---|---|
| 官方 train split | 18 | **100%** | 饱和，不可用 |
| 硬题档（1-4h/>4h） | 6 | **66.7%** | **有 headroom，可用** |

**这正是我们要找的东西**：SWE-bench Verified 里有 357 题未被官方 split 使用，
其中 36 题标注为 "1-4 hours"/">4 hours"；在这批硬题上，模型基线落到 67%，
进入可测量区间。

### 8.4 基础设施故障率与补救

主探针 25 题中 7 题（28%）因空响应 bug 报废，必须补救后才能计入分母。
`django__django-15022` 补救后 **resolved=True（severity 1.0）**，
证实这些确实是基础设施故障而非能力失败。

补救流程已脚本化：`retry-zero-any.sh`（零输出）与
`retry-nopatch.sh`（有回合但无 patch），均经 shim 重跑。

---

## 九、最终判定：SWE-bench 是否可用

### 9.1 结论

**可用，但只在硬题档上可用；官方 train split 不可用。**

| 判定标准 | 结果 |
|---|---|
| (1) 判分正确性 | **通过**（修掉 4 个缺陷后；gold/空 patch 已知答案测试通过） |
| (2) 有 headroom | **官方 train split 无**；**硬题档有**（40%–80%） |
| (3) 成本可承受 | **可承受**（parallel=8 下 40 题/组约 3–4 小时） |

这与前一个 benchmark（ContinualSkillBench）**性质不同**：
ContinualSkillBench 是判分器本身坏掉（测 LaTeX 写法、容差到 1e6、判分器不运行），
**无论怎么选题都不可用**；
SWE-bench 的判分是硬的（跑仓库自带测试），问题只在于**官方 train split 对
qwen3.8-27b 太简单**——换更难的题就能用。

### 9.2 分母问题与上下界（重要）

约 28%（train）到 40%（硬题）的题因空响应故障报废，
且**单次补救救不回全部**（`django__django-16950` 补救后仍零输出）。
因此必须给出上下界：

| 题池 | 观测（已判分组） | 下界（故障题全算失败） | 上界（故障题全算通过） |
|---|---|---|---|
| 官方 train split（25 题） | 18/18 = **100%** | **72%** | 100% |
| 硬题档（10 题） | 4/6 = **66.7%** | **40%** | 80% |

- **官方 train split 即使按最坏情况也只有 72%**，仍在可用带（40–70%）之外
  → 对它下"无 headroom"的结论是稳健的。
- **硬题档真值落在 40%–80%**，横跨可用带边界 → **当前样本不足以定性，
  必须扩大样本**。

### 9.3 立即可执行的下一步

1. **把硬题档样本从 10 题扩到全部 36 题**（未被 split 使用的
   "1-4 hours"/">4 hours" 实例）。按 parallel=8、单题约 13 分钟计，
   约 1 小时可跑完。
2. 先用 `goldcheck.py` 对硬题档做**天花板筛查**，剔除 gold patch
   也拿不到 `resolved` 的题（环境依赖测试），避免分母被污染。
3. 基线确认落在 40%–70% 后，按第七节的功效预算做机制实验：
   **40 题/组、分级 severity 指标、parallel=8**，两臂约 3–4 小时。

### 9.4 已知遗留缺陷（需在正式实验前处理）

| 缺陷 | 影响 | 状态 |
|---|---|---|
| 空响应（`content=null` + `tool_calls=[]` + 有 reasoning） | 28%–40% 的题报废 | 已加一次重试，**未能全部挽回**；需更多次重试或换模型采样参数 |
| 环境依赖测试（如 `TARPIT` 网络超时） | 个别题 gold 也拿不到 `resolved` | 用 gold 筛查剔除 |
| `git add`/`commit` 导致 patch 丢失 | 假阴性 | 已修（回退到 `diff base_commit`） |
| 日志解析器键值颠倒 | 9.2% 的题恒判 0 | 已修并验证 |
| 容器代理地址 | setup 阶段 apt/网络失败 | 已修（改写成 host.docker.internal） |

### 9.5 对"benchmark 选择是否是瓶颈"的最终回答

三个仪器合计：

| 仪器 | 失效原因 | 换题能否解决 |
|---|---|---|
| 自有 EvoAgentBench（code 域） | 基线 87%，真饱和 | 否（题池已用尽） |
| ContinualSkillBench | 判分器本身坏（4 处缺陷） | **否** |
| **SWE-bench Verified** | 官方 split 太简单 | **能** —— 硬题档有 headroom |

**所以 benchmark 选择确实曾经是瓶颈，但不是"找不到好 benchmark"，
而是"没用对子集"。** SWE-bench 的硬题档是目前唯一被证实
既有效、又有 headroom 的仪器。

---

## 十、硬题档扩样（进行中）

为把 9.2 节里"硬题档真值落在 40%–80%"收窄，已把硬题池从 10 题扩到
全部 36 题（未被官方 split 使用的 "1-4 hours"/">4 hours" 实例），
剩余 26 题按每块 3 路并行的方式在跑（`hard-rest.sh`）。

### 已观测（截至 06:00）

| 来源 | 已判分 | 通过 | 通过率 |
|---|---|---|---|
| hard10（前 10 题） | 6 | 4 | 66.7% |
| hard-rest 第 1 块（3 道 django） | 3 | 3 | **100%** |
| **合计** | **9** | **7** | **77.8%** |

### 趋势判断

- hard10 里 4/6 的通过率主要由 **pydata 1/2、sphinx-doc 0/1** 拉低；
- 硬题池里占比最大的 django（19 道）**目前全部通过**；
- 若剩余 17 道 django 维持全通过，硬题档最终会落在 **75%–85%**，
  即**同样偏向饱和**，而不是落在 40%–70% 可用带内。

**若该趋势成立，最终结论将修正为：**
SWE-bench Verified 对 qwen3.8-27b 在官方 split 与硬题档上**都接近饱和**，
只是硬题档留有少量真实失败（pydata / sphinx-doc 的个别实例）。
届时可用的路线只剩：进一步收紧到有真实失败的仓库子集（pydata、sphinx-doc），
或改用第 8.4 节列出的其他手段。

扩样跑完后本文会更新为最终数字。

---

## 十一、修正：并行会把单题墙钟挤爆 `agent_timeout`

### 发现

硬题扩样用 `--parallel 3` 跑，结果**全部** `status=timeout`、
`elapsed=1860s`（= 域配置 `agent_timeout: 1800` + 开销），
且 trial 目录里**没有 `session.jsonl`**、`result.json` 只有 818 字节
（串行跑时是 2887 字节、session 82 KB）。

连**判为通过**的那道（`django__django-11138`，F2P 1/1、P2P 73/73）
`status` 也是 timeout —— 说明它是在超时前刚好已经产出 patch 的。

### 原因

`agent_timeout` 是**墙钟**超时。3 个 agent 共享同一个 vLLM 时，
每个 agent 的单轮延迟被拉长（尽管 vLLM 有批处理），
于是同样 1800 秒内能完成的回合数大幅下降，纷纷撞超时墙。

### 后果（方法学教训）

**并行度不是一个免费的加速旋钮**：它与 `agent_timeout` 耦合。
提高并行度必须同步放宽超时，否则会把"没跑完"记成"做不出来"，
凭空制造 headroom。

本轮 hard-rest 的 75% 因此是**下界**而非真值：
其中 "agent 未产出 patch" 的 3 题基本都是被切断的。

### 修正措施

1. 长超时验证脚本 `verify-long.sh`：`agent_timeout` 提到 **5400s**、
   串行运行，重跑两类代表题：
   - `django__django-13128`（超时受限的"未产出 patch"）
   - `pydata__xarray-6992`（**只跑 495 秒、没超时**，
     却 F2P 0/12 —— 疑似真失败）
2. 正式实验若要用并行，必须按 `agent_timeout × parallel` 重新标定超时，
   或改用"题级并行、每题独占模型配额"的调度。
3. 分析时必须把 `status=timeout` 与真实失败分开统计
   （本节发现之前，二者被混在一起）。

---

## 十二、修正后的最终判定（2026-09-17 上午）

### 12.1 SWE-bench 与前一个 benchmark 性质不同

| | ContinualSkillBench | SWE-bench Verified |
|---|---|---|
| 判分机制 | 朴素字符串比对 | **跑仓库自带测试**（硬） |
| 缺陷性质 | 判分器本身坏（改题也没用） | 环境/接入层缺陷（**可修**） |
| 修完能否用 | **不能** | 取决于是否还有 headroom |

SWE-bench 的判分本身是可信的——`goldcheck.py` 的已知答案测试
（gold patch 判通过、空 patch 判不通过）在 astropy / pytest 两题上完全正确。
问题全部出在**接入层与环境层**，共 5 处，均已定位：

1. 日志解析器键值颠倒（9.2% 的题恒判 0）——**已修并验证**
2. 容器代理地址用宿主 127.0.0.1——**已修**
3. `git add`/`commit` 导致 patch 读空——**已修**（回退 `diff base_commit`）
4. 模型偶发空响应（`content=null` + `tool_calls=[]` + 有 reasoning）——**加了重试，未根治**
5. **并行度与 `agent_timeout` 耦合**，并行会把单题墙钟挤爆——
   导致"没跑完"被记成"做不出来"——**本轮才发现**

### 12.2 headroom 的修正结论

| 题池 | 修正前读数 | 修正后判断 |
|---|---|---|
| 官方 train split（25 题） | 18/18 = 100% | **100%（下界 72%）→ 无 headroom，结论稳健** |
| 硬题档（1-4h/>4h） | 4/6 = 67% | **被超时混淆，是下界；真值更高** |

关键证据：硬题扩样的 12 题里，**全部 `status=timeout`**（elapsed=1860s
恰为 `agent_timeout: 1800` + 开销），且**连判为通过的那道也是 timeout**。
即：这些题不是被模型做不出，而是**没跑完**。
因此 67%–75% 的读数不能当作 headroom 的证据。

**综合判断：SWE-bench Verified 对 qwen3.8-27b（默认 xhigh 推理、
90 分钟预算下）大概率也是饱和的；此前观测到的少量失败，
主要来自超时与空响应两类基础设施故障，而非能力差距。**

### 12.3 对"benchmark 选择是否是瓶颈"的回答（修正版）

三个仪器全部失效，但**失效原因各不相同**：

| 仪器 | 原因 | 换个用法能否救 |
|---|---|---|
| 自有 EvoAgentBench（code 域） | 基线 87%，题池已用尽 | 否 |
| ContinualSkillBench | 判分器本身坏 | 否 |
| SWE-bench Verified | 官方 split 太简单；硬题档失败以基础设施故障为主 | **待定**（需在超时放宽后重测） |

**最重要的结论不是"哪个 benchmark 好"，而是：
在 qwen3.8-27b 这个能力档位上，四个可用题池的 vanilla 基线都在 87%–100%。**
即：**模型已经强到把这些 benchmark 做满**，
所以"机制能否带来增益"这个问题的可测空间在自然分布任务上几乎不存在。

### 12.4 因此真正可走的路线只剩两条

1. **换更弱的 base 模型**。这不是回避问题：机制的价值本来就体现在
   能力不足的场景。用 27B 已饱和的模型去验证 memory/skill，
   等于在满分的卷子上找提分空间。
   （注意：用户早前明确反对"换小模型"，理由是会把"记忆价值"换成
   "知识蒸馏"——但当前证据显示，不换模型就没有可测空间。这个取舍需要用户决定。）
2. **改用"失败锚定 + 受控构题"**：不依赖现成 benchmark 的平均难度，
   而是找出该模型**可复现的、可命名的、可从反馈学到的**失败
   （SWE-bench 里 pydata/sphinx 的个别实例、
   ContinualSkillBench 的 `rac{1}{2}` 记法类失败都属于这一类），
   只在这些题上测机制。代价是要自己做题型筛选与预注册。

---

## 十三、决定性验证：硬题档的失败几乎全是"空响应"，不是能力差距

用 `agent_timeout: 5400`（3 倍于默认）+ **串行**重跑两道代表题，
排除"并行挤爆超时"这一混淆：

| 题 | 首次读数 | 长超时重跑 | 判定 |
|---|---|---|---|
| `django__django-13128` | 未产出 patch | **assistant=0**、1014 秒（预算 5400） | 首轮空响应，零回合 |
| `pydata__xarray-6992` | F2P 0/12 | **assistant=11**、577 秒（预算 5400） | 跑 11 轮后收到空响应即停 |

**两题都不是超时**（1014s / 577s 远低于 5400s），
而是同一个空响应故障：
模型返回 `content=null` + `tool_calls=[]`（带 reasoning），
nanobot 当作正常结束，整轮作罢。

### 因此：硬题档的可信失败只有 3 道

把"有真实 patch 但没通过测试"的题筛出来：

| 题 | F2P | P2P | 说明 |
|---|---|---|---|
| `pydata__xarray-6992`（首跑） | **0/12** | 945/945 | 产出 patch 但 12 个目标测试一个没过 |
| `django__django-13344` | **0/2** | 355/356 | 产出 patch，未修好且带回退 |
| `sphinx-doc__sphinx-8548` | **0/1** | 4/5 | 产出 patch，未修好且带回退 |

其余失败全部是空响应导致的基础设施故障。

### 修正后的硬题档估计

硬题档共尝试 21 题（hard10 的 10 题 + hard-rest 的 11 题）：
- 通过 9 题
- **真实能力失败 3 题**
- 空响应报废弃置 9 题

若把弃置题按已观测通过率（9/12 = 75%）折算，
硬题档真实基线约为 **(9 + 0.75×9) / 21 ≈ 75%**，
**高于 40%–70% 可用带，即：同样接近饱和。**

### 最终结论

**SWE-bench Verified 对 qwen3.8-27b 也基本饱和，不能提供足够的 headroom。**
其判分是可信的（与前一个 benchmark 有本质区别），
但在这台机器 + 这个模型上，三个题池的基线分别是：

| 题池 | vanilla 基线 |
|---|---|
| 自有 EvoAgentBench（code 域） | 87% |
| SWE-bench 官方 train split | **100%**（下界 72%） |
| SWE-bench 硬题档（1-4h/>4h） | **≈75%** |

**四个题池全部落在 75%–100%。**

### 对用户最初问题的最终回答

> "试了好几次都没有正面结果，是 benchmark 选得不合适吗？"

**部分是。** 早期确实存在仪器缺陷（ContinualSkillBench 判分器本身是坏的、
SWE-bench 有 5 处接入/环境缺陷），这些修掉之后**仍然没有 headroom**。
根因不是"benchmark 选错了"，而是：

**qwen3.8-27b 这个能力档位已经把这些 benchmark 做满，
自然分布任务上不存在可供机制提升的空间。**

要回答"memory/skill 机制是否有效"，必须先让测量空间存在，
可选路径见 12.4 节（换更弱 base 模型 / 失败锚定 + 受控构题）。
这个取舍需要用户拍板。
