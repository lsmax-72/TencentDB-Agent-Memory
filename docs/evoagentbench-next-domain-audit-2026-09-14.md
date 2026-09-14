# EvoAgentBench 下一评测域可行性审计

## 独立判断

当前不应立即启动新的大批量实验。Algorithmic Reasoning 已出现 Vanilla 饱和、Candidate 暴露不足和模型运行波动；在隔离缺陷修复前积累的结果又无法严格归因。先换域是合理方向，但官方其余三个域目前都不是“零准备、低成本”的替代品。

## 官方域对比

| 域 | 优点 | 当前阻塞 | 结论 |
|---|---|---|---|
| Information Retrieval / BrowseComp-Plus | 154 train / 65 test，任务更依赖可复用搜索经验；无需 Docker | 本机未下载数据/索引，缺 FAISS 检索依赖；官方主评分是 temperature 0.7 LLM Judge | 最值得作为下一候选，但必须先做离线环境和评分协议冻结 |
| Knowledge Work / GDPVal | 更适合 Wiki/Memory | 依赖多模态 LLM evaluator、文档工具，成本高且判分随机性更大 | 暂不选 |
| Software Engineering / SWE-bench Verified | 官方测试较确定 | 当前为 arm64 Mac，依赖 Linux x86_64 Docker 和大型镜像 | 暂不选 |
| Algorithmic Reasoning / LiveCodeBench | 环境已接通，grader 确定 | 当前样本 Vanilla 过强，且检索覆盖低 | 只保留为回归/接入 smoke，不再盲目扩批 |

## Information Retrieval 的真实准备成本

- 本机该域数据目录只有约 40KB，说明真实 corpus/index 尚未准备。
- 当前 EvoAgentBench 虚拟环境缺 `faiss`、`fastmcp`、`tevatron`、`torch` 和 `transformers`。默认 FAISS 路径不需要 Java；只有改用可选 BM25/Pyserini 时才需要 Java。
- 本机数据盘只剩约 15GB。
- 官方最小 `qwen3-embedding-0.6b` 索引约 411MB，但还需 embedding 模型、Python/Java 依赖与数据；不能在未估算完整空间前直接下载。
- 官方 adapter 优先使用 LLM Judge；exact match 仅是 judge 失败时的 fallback。若改为固定 exact match，必须作为新的 `EvoAgentBench-compatible` 协议冻结，不能冒充官方默认评分。

## 下一次允许花模型成本前的闸门

1. 先为 Information Retrieval 写纯离线 preflight：磁盘、依赖、数据 hash、MCP health、评分方式和 split 冻结。
2. 明确选择官方 LLM Judge或兼容版 deterministic exact match；两者不能在实验中途切换。
3. 只做 1 个 Vanilla smoke，证明搜索工具、verifier、Proxy evaluation isolation 和 Hub evidence 完整。
4. 再做最多 4 个 train-only task 的 `Vanilla / Memory / Skill / Memory+Skill` 校准，共最多 16 arm。
5. 只有 Candidate 实际检索覆盖大于 0、Vanilla 未全通过、无正式资产污染、无 INFRA_ERROR，才允许扩大；否则立即停止。

本审计没有下载数据、安装依赖或调用 vLLM，也没有创建新 Candidate 或修改任何历史 Gate。

可重复 preflight 的当前有效输出为 `/Users/lsmax/Coder/evoagentbench-artifacts/ir-preflight-audit-3.json`，状态 `BLOCKED`，artifact hash `ebf9e45553209f959f10099b495f1833314f414c59d964684f17dc09d7fadde1`。它确认 pinned revision、154/65 split 与磁盘余量合格，当前真正缺少数据、四片最小索引、FAISS 运行模块和冻结的 judge mode。`audit-1` 因错误解析虚拟环境 symlink 而误报依赖；`audit-2` 又把可选 BM25 的 Java/Pyserini 错列为默认 FAISS 的硬依赖，二者都作为实现失败记录保留，未覆盖。
