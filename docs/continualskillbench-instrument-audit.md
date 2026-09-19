# ContinualSkillBench（SkillsBench）作为评测工具的可用性审计

日期：2026-09-16
审计对象：`gtynnn110-hash/continual-skill-bench-final`（本地副本 `/tmp/csb-probe`，Apache-2.0）
审计目的：判断该 benchmark 能否作为"memory/skill 机制是否真的有效"的评测仪器。

背景：我们自有 harness（EvoAgentBench 适配器）在 code_implementation 域上
vanilla 基线已达 87%，**没有 headroom**，因此无法测量机制增益。需要换一个
基线足够低、判分可靠的仪器。本审计回答"ContinualSkillBench 是否合适"。

结论先行：**office-100 子集不可用（存在两处独立缺陷）；math-100 与
finance-econ-100 的 numeric 判分干净，是目前可用的候选。**

---

## 一、缺陷 A：判分器只在 `*_seq` 系列 agent 下运行

### 现象

用普通 `codex` agent 跑 `office-100-independent-trials` 时，**reward 恒为 0**，
与 agent 表现无关。

实测：`office-ind-007`，agent 写出
`/app/task_007_output.json` = `{"answer": "37921314"}`，
标准答案 `$37,921,314`（题目要求"include public works... exclude revolving funds"，
`_num()` 去 `$`/`,` 后完全相等），判分仍为 **0.0**。

### 根因

判分链路是两段式的：

| 环节 | 位置 | 是否随任务发布 |
|---|---|---|
| `test.sh` | `tests/test.sh` | 是 |
| └ 只调用 `aggregate_reward.py` | `tests/aggregate_reward.py` | 是 |
| └ 读 `/logs/verifier/task_NNN_feedback.json` | — | — |
| 写入该 feedback 的判分器 | `/root/judge_subtask.py` | **否，由 agent 侧注入** |
| 注入者 | `harbor/agents/installed/codex_seq.py` 等 `*_seq` agent | — |

`office-100/tests/test.sh` 的注释写着"it also runs pytest for any QA/programmatic
tasks whose feedback was not yet written"，但**脚本正文只调用
`aggregate_reward.py`，从未运行 pytest**。因此 feedback 文件不存在时，
`aggregate_reward.py` 取 `scores == []`，直接返回 `0.0`。

`INLINE_JUDGE_SCRIPT_PATH = "/root/judge_subtask.py"` 只出现在
`codex_seq.py` / `codex_seq_icl.py` / `claude_code_rag.py` /
`claude_code_seq.py` / `claude_code_seq_debug.py` 中；
普通 `codex` agent 与官方 Harbor 均不注入它。

### 影响

这是一个**方向性错误的高危陷阱**：使用者会观测到"全部失败"，
从而错误地得出结论"该 benchmark 极难、headroom 充足"。
实测就是这样——我们最初用 `codex` 跑 5 题得到 0/5，
真实原因与题目难度无关。

### 规避

用 `codex-seq` 跑 Independent 条件（每个 trial 目录仅 1 道题 ⇒ `n_tasks == 1`，
等价于 benchmark 定义的 Independent），并且：

- `enable_judge_feedback: true`。若设为 `false`，`codex_seq.py:844`
  会走 `if n_tasks == 1 and not self._enable_judge_feedback:` 分支，
  同样跳过判分，reward 依旧恒为 0。
- 不要手动传 `tasks_spec_path`。`harbor/trial/trial.py:99-101` 会自动传
  `<task>/environment/tasks_spec.json`，重复传参会报
  `TypeError: got multiple values for keyword argument 'tasks_spec_path'`。

---

## 二、缺陷 B：numeric 题的容差过大，部分题目不可判伪

### 判分逻辑

`harbor/agents/installed/sequential_subtask_judge.py` 对
`eval_type == "numeric"` 的题目做**相对容差**比较：

```python
tol = float(task_spec.get("numeric_tolerance", 1e-4))
e, a = _num(expected), _num(actual)
passed = abs(e - a) / max(abs(e), 1e-12) <= tol
```

`_num()` 只去掉 `,`、`$`、`%`。因此 `numeric_tolerance` 就是相对误差上限。

### office-100 的容差分布（43 道 numeric 题）

| tol | 题数 | 说明 |
|---|---|---|
| 0.001 | 1 | 正常 |
| 0.01 | 34 | 正常（1%） |
| 0.1 | 1 | 宽松（10%） |
| 0.5 | 2 | 很宽松（50%） |
| 1 | 2 | **失效**：任何 `[0, 2×标准答案]` 的数字都算对 |
| 10 | 2 | **失效**：任何 `[0, 11×标准答案]` 的数字都算对 |
| 1000000 | 1 | **完全失效**：任何非负数字都算对 |

即 **8/43 = 18.6% 的 numeric 题容差 ≥10%，其中 3 道 >100%**。

### 用判分器原逻辑验证不可判伪

直接用 `sequential_subtask_judge.py` 的公式喂入明显错误的答案：

| 题号 | 标准答案 | tol | 输入 | 判定 |
|---|---|---|---|---|
| 7 | `$37,921,314` | 0.01 | 999999999 | 不通过（正常） |
| 11 | `36080` | 0.1 | 99999 | 不通过（正常） |
| 12 | `$23,918,635` | 1.0 | **1** | **通过（判分失效）** |
| 79 | `10102000000` | 1000000.0 | **1** | **通过（判分失效）** |

### 实测中被污染的一例

`office-ind-011` 复跑：agent 答 `38073`，标准答案 `36080`，**相对误差 5.5%**，
判分器输出：

```json
{"qa_passed": true, "actual_answer": "38073", "expected_answer": "36080",
 "feedback": "CORRECT\nYour answer: 38073\nExpected: 36080"}
```

`CORRECT` 与 `Your answer != Expected` 同时出现在同一条反馈里。

### 各域对比

| 数据集 | numeric 题数 | 容差 ≥10% | 容差 >100% |
|---|---|---|---|
| **office-100** | 43 | **8 (18.6%)** | **3** |
| finance-econ-100 | 12 | 0 | 0 |
| math-100 | 24 | 0 | 0 |
| healthcare-100 | 0（无 numeric） | — | — |
| law-100 | 0（无 numeric） | — | — |

### 附：independent-trials 变体的判分器完整性

| 变体 | 含 `tests/qa_eval.py` 的题数 |
|---|---|
| `math-100-independent-trials` | **100 / 100** |
| `office-100-independent-trials` | **0 / 100** |

math 的 independent-trials 每道题都带完整判分器；office 一道都没有。

---

## 二·补 缺陷 C：判分器是朴素字符串比对，仓库里更正确的判分器被绕过

这一条比缺陷 B 更根本，且**跨域存在**（office 与 math 都受影响）。

### 实际产出分数的组件用的是内联字符串比对

真正写 `/logs/verifier/task_NNN_feedback.json` 的是
`harbor/agents/installed/sequential_subtask_judge.py`。它对
`eval_type == "exact_match"` 的题目用自己内联的：

```python
def _norm(s):
    s = s.strip().lower()
    s = s.replace(",", " ").replace(".", " ").replace(";", " ").replace(":", " ")
    return " ".join(s.split())
...
passed = _norm(expected) == _norm(actual)
```

它**不去 `$`、不做 LaTeX 归一化、不做数学等值判定**。

### 仓库里本来有一个正确的判分器，但没被用上

`tasks/math-100*/tests/math_equiv.py` 提供了完整的数学等价判定：

- `normalize_exact()` / `parse_numeric()` / `latexish_to_sympy_text()`
- `sympy_equivalent()` —— 用 `simplify(e - a) == 0` 判等值
- `answers_match()` —— 按 `eval_type` 分派的统一入口

`tasks/math-100*/tests/qa_eval.py` 确实 `from math_equiv import answers_match`，
但 **`sequential_subtask_judge.py` 对 `math_equiv` / `sympy` 零引用**
（`grep -n "math_equiv\|sympy" sequential_subtask_judge.py` 无结果）。
即：**更好的判分器在仓库里，但不在打分路径上。**

### 缺陷 C-1：`math_equiv.py` 的 sympy 回退是死代码

```python
# math_equiv.py:99
return sympify(cand, evaluate=True, transformations=transformations)
```

`sympify()` 不接受 `transformations` 参数（那是 `parse_expr()` 的参数）。
因此 `_sympy_expr()` **每次调用都抛异常**，被 `sympy_equivalent()` 的
`except Exception: return False` 吞掉 —— 该函数**恒返回 False**，
`answers_match()` 里依赖它的那段 LaTeX 等值回退永不生效。

实测（用 `parse_expr` 替换 `sympify` 后）：

| 标准答案 | 模型答案 | 修复前 | 修复后 |
|---|---|---|---|
| `1/2` | `\frac{1}{2}` | False | **True** |
| `3 \sqrt{3}+\sqrt{13}` | `3\sqrt{3}+\sqrt{13}` | False | **True** |
| `540` | `541` | False | False（正确拒绝） |

即**改一行**即可恢复数学等值判定。

### 缺陷 C-2：`_norm` 实际在测"LaTeX 字符串复现保真度"

`_norm` 的容错能力实测：

| 标准答案 | 模型答案 | 判定 | 问题 |
|---|---|---|---|
| `540` | `$540$` | **判失败** | `$` 不在被替换的字符里 |
| `3 \sqrt{3}+\sqrt{13}` | `3\sqrt{3}+\sqrt{13}` | **判失败** | 只差一个空格 |
| `1/2` | `\frac{1}{2}` | **判失败** | 数学等值但写法不同 |

math-100 的 39 道 `exact_match` 题中，**10 道（25.6%）标准答案含 LaTeX**
（`\frac`、`\sqrt`、`\pm`、`\boxed` 等）。这些题的分数取决于模型能否
逐字符复现参考写的 LaTeX，而不是能否解出题目。

### 缺陷 C-3：题目指令推荐的格式恰好被判分器拒绝

`math-ind-030` 的 `instruction.md` 原文：

```
- `answer`: a short plain string (e.g. `"A"`, `"540"`, `"\\frac{{1}}{{2}}"`).
```

题目**明确把 `\frac{1}{2}` 举为合法答案格式**，而判分器的
`_norm(r"\frac{1}{2}") != _norm("1/2")` 将其判为错误。
实测该题模型答 `\frac{1}{2}`、标准答案 `1/2`，被判 **失败**。

这属于**假阴性**（压低分数、虚增 headroom），
与缺陷 A（假阳性式全零）方向相反，但同样使测量失效。

### 影响与修复建议

- 影响：`exact_match` / `f1` / `numeric` 三类题目的分数都经由这套朴素比对，
  因此不仅 math，office、finance-econ 同样受影响。
- 最小修复（改一行）：`math_equiv.py:99` 的 `sympify` → `parse_expr`。
- 关键修复（改判分路径）：让 `sequential_subtask_judge.py` 的
  `exact_match` / `numeric` 分支调用 `math_equiv.answers_match()`，
  而不是自己内联 `_norm` / `_num`。
- 验收方法：拿 `\frac{1}{2}` vs `1/2`、`$540$` vs `540` 两个已知等值的
  样例跑判分器，必须判通过；拿 `540` vs `541` 必须判不通过。

---

## 三、实测基线（office-100，5 题）

配置：`codex-seq` + 本地 vLLM `qwen3.8-27b`（`Qwen/Qwen3.8-27B-FP8`），
`reasoning_effort: null`（走模型默认档，vLLM 侧为 `xhigh`），
`n_concurrent_trials: 1`，`delete: false`，单题耗时约 3–16 分钟，5 题共 24 分钟。

| 题号 | eval_type | tol | 标准答案 | agent 答案 | 判定 | 判分可信度 |
|---|---|---|---|---|---|---|
| 002 | numeric | 0.01 | 507 | 507 | 通过 | 可信 |
| 003 | numeric | 0.01 | 182 | 182 | 通过 | 可信 |
| 007 | numeric | 0.01 | $37,921,314 | 37921314 | 通过 | 可信 |
| 011 | numeric | 0.1 | 36080 | 38073（差 5.5%） | 通过 | **存疑** |
| 012 | numeric | 1.0 | $23,918,635 | 23918635 | 通过 | **无意义** |

- 表面结果：5 题 4 通过 = **0.800**（另有 1 次间歇性传输失败已复跑通过）。
- 诚实结果：**有可信判分的 3 道题全部通过 = 3/3**。
- 因此在这个 5 题样本上，**该 benchmark 对 qwen3.8-27b 同样没有 headroom**。

注意样本很小（3 道可信题），不足以对 headroom 下最终结论；
但它足以说明 office-100 的 numeric 子集不适合作为仪器。

---

## 三·补 实测基线（math-100，5 题）

同样的配置（`codex-seq` + `qwen3.8-27b`，`reasoning_effort: null`，
`n_concurrent_trials: 1`，`delete: false`）。选题时避开了前 8 道多选题
（猜对率 20% 会抬高基线），取 task 9 / 10 / 30 / 55（偏难竞赛题）
与 task 70（简单题，作 harness 健全性对照）。5 题共 **43 分 34 秒**。

| 题号 | 题目类型 | 标准答案 | agent 答案 | 判定 | 判断 |
|---|---|---|---|---|---|
| 009 | 复数最值（hard） | 540 | 540 | 通过 | 真通过 |
| 010 | 13 次单位根（hard） | 321 | 321 | 通过 | 真通过 |
| 030 | 无穷级数（hard） | `1/2` | `\frac{1}{2}` | **失败** | **假阴性**：数学等值，仅 LaTeX 写法不同 |
| 055 | 丢番图（hard） | 26 | 26 | 通过 | 真通过 |
| 070 | 符号化简（easy，programmatic） | -21 | — | 通过 | 真通过（pytest 分支） |

- 表面结果：5 题 4 通过 = **0.800**。
- 诚实结果：唯一的失败是缺陷 C 造成的假阴性，
  **修正后为 5/5 = 100%**。
- 结论：**math-100 对该模型同样没有 headroom。**

### 两个附带观察

1. **harness 健全性通过**：连最简单的 task 70 也通过，
   说明接入层（codex ↔ shim ↔ vLLM）没有系统性故障。
2. **shim 头部过滤修复可能有效**：本轮 109 次请求 **0 个 4xx**，
   而修复前在 office 探针中出现过间歇性 `400 Extra data`。
   样本不足以定论，但方向一致。

---

## 三·补二 对"找一个基线低的 benchmark"这一策略的否定

把三个数据点放在一起：

| 仪器 | vanilla / Independent 基线（修正后） |
|---|---|
| 我们自有 EvoAgentBench 适配器（code_implementation） | 87% |
| ContinualSkillBench office-100（可信判分的 3 题） | 100% |
| ContinualSkillBench math-100（修正假阴性后 5 题） | 100% |

**三个仪器对 `qwen3.8-27b` 都已饱和。** 继续寻找"平均基线更低"的
benchmark 是在错误的维度上搜索：benchmark 的平均难度低只是因为
它面向的是**更弱的模型**（该仓库的 baseline 用的是 GPT-4o 一类的
较早模型），而不是因为我们测不出机制增益。

### 正确的做法：以失败锚定的题目筛选（failure-anchored selection）

测量机制增益只需要一个条件：**题目集合里存在该模型可复现的失败，
且失败是可被机制修复的那一类**。因此流程应当反过来：

1. 用 base 模型在候选池上跑，**只保留它确实失败的题**；
2. 对失败做分类：
   - **能力型失败**（难奥赛题解不出）——memory/skill 修不了，不能用作测量题；
   - **约定/流程型失败**（反复出现的、可命名的、可从反馈学到的）
     ——**这才是测量机制的题**；
3. 在筛出的题集上比较 Independent / Sequential / Pure ICL 三组。

这个流程与 benchmark 无关，任何题目池都能用。

### 我们已经拿到一个现成的约定型失败

缺陷 C-3 那类题就是天然的约定型失败样本：
task 030 模型写 `\frac{1}{2}`、判分器要 `1/2`，反馈里直接写着
`Expected: 1/2`。这类失败**可复现（同一模型同一约定）、可命名、
可从反馈学到**，正是 skill 库该解决的问题——
skill 的内容就是"本 harness 期望纯 ASCII 数学写法"。

所以可以用**格式敏感的题目子集**直接做三组对照：
Sequential 组在第 1 题失败后应学到该约定，从而在第 2 题起提升；
Independent 组每题独立、学不到，应当保持低分。
这比继续换 benchmark 更便宜，也更直接地回答"机制到底有没有用"。

math-100 中 `exact_match` 且标准答案含 LaTeX 的题共 **10 道**
（task 20/23/28/31/33/34/35/37/38/39），是现成的候选子集。

---

## 三·补三 失败锚定筛选的实测结果（10 题全跑完）

对上面那 10 道格式敏感题跑 Independent（`codex-seq`，同前配置），
结果：**官方判分 1 通过 / 9 失败**。

逐题核对（模型答案 vs 标准答案）：

| 题号 | 官方判定 | 模型答案 | 标准答案 | 数学上 |
|---|---|---|---|---|
| 020 | 失败 | `max=11 \| min=3\sqrt{3}+\sqrt{13}` | `$11, 3 \sqrt{3}+\sqrt{13}$` | **等值** |
| 023 | 失败 | `\frac{15 - 8\sqrt{3}}{33}` | `$\frac{15-8 \sqrt{3}}{33}$` | **等值**（仅空格与 `$`） |
| 028 | 失败 | `1 - sqrt(2) \| 1 + sqrt(2)` | `1 \pm \sqrt{2}` | **等值** |
| 031 | **通过** | `\frac{1+\sqrt{5}}{2}` | `\frac{1+\sqrt{5}}{2}` | 逐字符相同 |
| 033 | 失败 | `(-4+sqrt(31))/15 \| (-4-sqrt(31))/15` | `\frac{-4 \pm \sqrt{31}}{15}` | **等值** |
| 034 | 失败 | （无输出文件） | — | infra 崩溃（见下） |
| 035 | 失败 | `(2^{n+1} + (-1)^n) / 3` | `\frac{2 \cdot 2^{n}+(-1)^{n}}{3}` | **等值** |
| 037 | 失败 | `a = 1, b = 10, c = 10 (and permutations)` | `\boxed{(10,10,1), (10,1,10), (1,10,10)}` | **等值** |
| 038 | 失败 | `\frac{2009\cdot 2^{2010}+1}{2011!}` | `$\frac{2009\left(2^{2010}\right)+1}{2011!}$` | **等值** |
| 039 | 失败 | `3/4` | `\frac{3}{4}` | **等值** |

**9 个失败里 8 个是数学正确的答案**，唯一真正的问题是 034 的
基础设施崩溃。

唯一的"通过"（031）之所以通过，只是因为模型恰好逐字符复现了参考写法
（`\frac{1+\sqrt{5}}{2}` 里没有 `\cdot`、没有 `\left...\right`、没有 `$`）。

### 用仓库自带判分器交叉验证

把 `math_equiv.py:99` 的 `sympify` 修成 `parse_expr` 后，
用仓库自己的 `answers_match()` 复核：

- 它能认出 3 例（023 / 038 / 039）；
- 另外 5 例（020 / 028 / 033 / 035 / 037）它**也认不出**——
  因为 `latexish_to_sympy_text()` 不处理 `\pm` 展开、`max=/min=` 标签、
  元组答案、`2^{n+1}` 这类等价变形。

即：**即便把仓库自带的"更正确"的判分器修好，它仍然会把数学正确的答案判错。**
本 benchmark 的评测栈整体缺少数学等值判定能力。

### 结论

这批题的低分**不代表模型能力不足**，而是评测器在测
"能否逐字符复现参考的 LaTeX 写法"。因此：

- 用 `exact_match` 题测 memory/skill 机制，测到的会是"记法模仿能力"，
  不是解题能力；
- math-100 的官方基线低，是评测器伪影，不能当作 headroom。

### 唯一格式无关的子集

math-100 的 `programmatic` 题（task 64–75，共 12 道）判分方式是
**执行模型产出的 Python 代码、再与参考答案做数值比对**
（`tests/mathcode_eval.py`：子进程 `exec` 代码，带超时与数值容差）。
它不依赖任何书写格式，是这套 benchmark 里唯一可信的能力信号。
但只有 12 道，且难度成疑（task 70 是 `16^{1/2}-625^{1/2}` 这种口算题）。

---

## 四、环境接入事实（Codex CLI 0.154.0 × vLLM 0.19.0）

ContinualSkillBench 的容器内 codex-cli 是构建时装的 `@openai/codex`，
实测为 **0.154.0**。它与 vLLM 0.19.0 存在三处不兼容，需要一层传输层
适配（`/tmp/csb-run/shim.py`）：

| # | 问题 | 实测报错 | 处理 |
|---|---|---|---|
| 1 | codex ≥0.154 **不再读 `OPENAI_BASE_URL`**，且移除 `wire_api = "chat"` | 直接打 `api.openai.com`，401 | 写 `$CODEX_HOME/config.toml` 声明 `model_providers.custom`（`wire_api = "responses"`） |
| 2 | codex 把系统指令放在 `role: "developer"`，且顶层另带 `instructions`；vLLM 只接受 user/assistant/system，且把 `instructions` 当成**不在开头**的 system 消息 | `Unexpected message role.` / `System message must be at the beginning.` | 把 `developer` 与顶层 `instructions` **合并成唯一一条开头 system 消息**，文本一字不改 |
| 3 | codex 回传上一轮的 `reasoning` item，vLLM 请求侧校验拒绝它自己产出的结构 | pydantic union 校验失败 | 从 `input` 中剔除 `type == "reasoning"` 的 item（vLLM 返回的 `encrypted_content` 恒为 `null`，本就无法重放） |

其余实测事实：

- `reasoning.effort`：vLLM 只接受 `low` / `medium` / `xhigh`（默认 `xhigh`），
  传 Codex 默认的 `high` 直接 400。为不人为制造 headroom，
  配置里给 `reasoning_effort: null`（不传该参数，走模型默认档）。
- `environment.delete` 必须为 `false`。Harbor 在 `delete: true` 时执行
  `docker compose down --rmi all`，第一道题结束就删掉 `hb-office` 镜像，
  后续 trial 会去 Docker Hub 拉同名镜像并报
  `pull access denied for hb-office`。
- 构建镜像前需把 `/Applications/Docker.app/Contents/Resources/bin`
  加进 `PATH`，否则 `docker` 找不到 `docker-credential-desktop`，
  所有 pull 都失败（报错形态与网络问题相似，容易误判）。
- 容器内 shim 地址用 `host.docker.internal:8097`；宿主机自检必须用
  `127.0.0.1:8097`（`host.docker.internal` 在宿主机不可解析）。
- `NO_PROXY` 无需额外配置：compose 里虽只写了
  `localhost,127.0.0.1,host.docker.internal`，实测经 7897 代理访问局域网 IP
  （vLLM `10.195.214.152:8100`）为直连透传，可正常返回 200。

### shim 对实验有效性的影响

shim 位于 Codex CLI 与 vLLM 之间的传输层，只做角色标签合并与无效 item 剔除，
不改任何指令文本。三个实验分组（Independent / Sequential / Pure ICL）
走的是同一个 Codex CLI + 同一个 shim，因此它是**组间恒定项**，
不构成区分性偏置。每次改写计数写入 `/tmp/csb-run/shim-audit.jsonl` 作为证据。

### 已解决：间歇性 `400 Extra data`

**现象**：间歇性出现 vLLM 返回 `400 Extra data: line 1 column N (char M)`。
在 `office-ind-011` 首次运行中连续命中 3 次，导致该题三轮 codex 调用全部失败；
`math-ind-034` 同样因此没产出输出文件。

**根因（已定位，非网络问题）**：`math-ind-034` 的 agent 日志里有决定性一行：

```
ERROR codex_core::tools::router: error=failed to parse function arguments:
      trailing characters at line 1 column 87
```

模型偶发生成**尾部带多余字符的工具调用参数 JSON**。
codex 自己解析这个 `arguments` 字符串时失败（列号 87），
而 vLLM 在回放历史里的 `function_call` item 时会再次 `json.loads(arguments)`，
抛出**同一个列号**的错误并拒绝整个请求。

即：这是「模型偶发产出坏 JSON」× 「vLLM 请求侧严格校验」的组合，
与代理、`Transfer-Encoding` 都无关（shim 审计里 `req_len` 是 42892 的完整body，
重新序列化后必定是合法 JSON，出错的是嵌套的 arguments 字符串）。

**处理**：shim 对 `function_call` / `custom_tool_call` 的 `arguments`
做修复——若 `json.loads` 失败，用 `JSONDecoder().raw_decode()` 截取首个合法
JSON 值并重新序列化（计数写入审计日志的 `tool_args_repaired`）。

**另一项也一并做了的加固**：转发前过滤掉原始请求的
`Transfer-Encoding` / `Content-Encoding` 头（body 已被重新序列化，
这些头不再成立）。加过滤后 math 探针 109 次请求 0 个 4xx。

---

## 五、结论与下一步建议

### 5.1 最终结论：ContinualSkillBench 不能作为机制评测仪器

四条独立缺陷，任何一条都足以使测量失效：

| # | 缺陷 | 方向 | 后果 |
|---|---|---|---|
| A | 判分器只由 `*_seq` agent 注入，普通 `codex` 不注入 | 假阳性式全零 | 看起来"极难"，实际没判分 |
| B | office-100 numeric 容差最高到 1e6 | 假阳性 | 错答案被判对 |
| C | 判分走朴素字符串比对，测的是 LaTeX 写法 | 假阴性（主导） | 对答案判错，占失败的大头 |
| D | 反馈轮路径用 `idx` 而非 `judge_task_id` | 反馈链路断 | 子集运行时学不到东西 |

缺陷 C 是主导性的：格式敏感子集 10 题里，**9 个失败中 8 个数学正确**。
唯一通过的题只是因为模型恰好逐字符复现了参考写法。

### 5.2 那么"没有正面结果"是 benchmark 的问题吗？

**是，但不是"太简单"这个原因。** 三个仪器各自失效于不同原因：

| 仪器 | 失效原因 |
|---|---|
| 我们自有 EvoAgentBench 适配器 | 基线 87%，**真的饱和**，没有 headroom |
| ContinualSkillBench office-100 | 判分器不运行 + 容差失效 |
| ContinualSkillBench math-100 | 判分器测 LaTeX 写法而非数学正确性 |

**至今从未有过一个既有效、又有 headroom 的仪器。**
所以"机制到底有没有用"这个问题，目前仍然是**未被回答**，
而不是"已被证伪"。继续换 benchmark 不会解决——需要的是**造一个有效仪器**。

### 5.3 有效仪器的三个必要条件

1. **判分必须与书写形式无关**：能执行就执行（代码/数值），
   不能执行就用经过验证的等值判定，并**用已知等值的样例做验收**
   （如 `\frac{1}{2}` vs `1/2` 必须判通过、`540` vs `541` 必须判不通过）。
2. **必须验证判分器真的在跑**：造一个已知正确的输出，分数必须非零。
3. **必须有 headroom**：base 模型基线落在 40%–70% 区间，
   且失败的题要能分类成"能力型"（不可修）与"约定/流程型"（可修）。

### 5.4 可用的干净子集（如果要继续用这个 benchmark）

`math-100` 的 `programmatic` 题（task 64–75，12 道）由
`tests/mathcode_eval.py` **执行模型代码 + 数值比对**判分，格式无关、可信。
但只有 12 道且难度参差（task 70 是口算题），样本量不足以支撑统计功效。

### 5.5 建议的下一步（按性价比排序）

1. **回到自有 harness，把难度提上去**，而不是继续找 benchmark。
   自有 harness 的判分是经过验证的（有阳性对照、有实测噪声底、
   精确 verifier），问题只在题目太简单。做法是从题库里
   **筛出 vanilla 基线落在 40%–70% 的题**，组成新的测量集。
2. **用 programmatic 类判分构造新题**：数学/算法题让模型交代码，
   执行后比对结果——天然规避写法问题，也是最不容易被"记法模仿"骗过的形式。
3. **把 headroom 与功效分开算**：即便基线 50%，n=24 时二元 MDE 仍达 26.5pp
   （见 `docs/evoagentbench-power-preregistration.md`）。
   要测 10pp 级别的增益需要几十道题，选题时必须同时满足
   "基线在带内"和"题量够"。
4. 任何新仪器投入使用前，跑 5.3 的三条验收。

### 5.6 仍然成立的方法论要求

本审计印证了一条通用要求：**评测仪器本身必须先被验证**。
本次如果不是先做了"造一个正确输出看分数"这一步，
office-100 的 0/5 会被误读成"benchmark 极难、headroom 充足"，
math-100 的 1/10 会被误读成"模型数学能力弱"——两个结论都是错的。

---

## 六、现场状态与恢复入口（2026-09-16 晚）

本审计的全部实验均已完成，结论见第五节。以下是复现所需的现场信息。

### 现场位置

| 内容 | 路径 |
|---|---|
| benchmark 仓库副本 | `/tmp/csb-probe`（4.5 GB，Apache-2.0，`harbor` 为可编辑安装） |
| 运行脚本与配置 | `/tmp/csb-run/`（`run-probe.sh`、各 `*.yaml`、`shim.py`、`build_seq_subset.py`） |
| Harbor 虚拟环境 | `/tmp/csb-venv`（Python 3.12 + `harbor 0.1.45`） |
| 实验记录 | `/tmp/csb-run/jobs/` 下 `office_min5_independent`、`office_ind011_repro`、`math_min5_independent`、`math_fmt_screen10` |
| shim 改写审计 | `/tmp/csb-run/shim-audit.jsonl` |
| 等值复核工具 | `/tmp/csb-run/equivcheck/math_equiv.py`（已打一行修复） |
| 镜像 | `hb-office`(4.33 GB)、`hb-math`(3.06 GB) 均在本地 |

### 接管环境（每次重启后）

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # 否则 docker 找不到凭据助手
cd /tmp/csb-run && nohup /tmp/csb-venv/bin/python shim.py --port 8097 > shim.log 2>&1 &
curl -s http://127.0.0.1:8097/v1/models >/dev/null && echo shim OK
```

跑实验：`cd /tmp/csb-run && bash run-probe.sh <配置>.yaml`

### 为接入 vLLM 对 benchmark 仓库所做的改动

均在 `/tmp/csb-probe/src/harbor/agents/installed/` 下，可用 `git diff` 查看：

- `claude_code_env.py`：新增 `codex_model_provider_config_command()`
  （把 `OPENAI_BASE_URL` 翻译成 `$CODEX_HOME/config.toml` 的
  `model_providers` 段，供 codex ≥0.154 使用）。
- `codex.py`：调用该函数；`_build_register_mcp_servers_command` 的
  `>` 改为 `>>`，以便与 provider 配置共存于同一文件。
- `codex_seq.py` / `codex_seq_icl.py`：在 `setup_command` 中调用该函数。

### 遗留待办

- 清理 `/tmp/csb-probe`（4.5 GB）、`/tmp/csb-venv`（914 MB）与两个镜像——
  确认不再需要本 benchmark 后执行。
- 缺陷 D（反馈轮用 `idx` 而非 `judge_task_id`）未修：
  只在跑"子集顺序式"任务时会暴露，官方全量运行不受影响。
