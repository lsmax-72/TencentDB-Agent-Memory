# Skill 自进化方法调研：对 TencentDB Agent Memory 的可复用设计

调研日期：2026-09-12

## 结论

这六个方向不是互相替代，而是覆盖 Skill 生命周期的不同环节。当前项目最值得采用的组合是：

1. 用 Trace2Skill 的“轨迹局部诊断 + 分层合并”生成候选；
2. 用 SkillOpt 的“有界修改 + 冻结验证 + 拒绝/回退”控制版本；
3. 用 EvoSkill 的模块化目录管理多个可复用 Skill；
4. 借用 SkillRL 的 SkillBank schema 和检索思想，先解决适用条件与错召回，不立即做强化学习；
5. 借用 skill-up 的声明式用例、执行器适配和报告格式，但保持测试集冻结；
6. 等外挂 Skill 已经稳定有效后，再考虑 SkillRL 或 SKILL0 的后训练。

## 方法对照

| 方法 | 更准确的定位 | 当前可直接借鉴 | 当前不应照搬 |
|---|---|---|---|
| Trace2Skill | 从一组成功/失败轨迹并行提出局部 patch，再分层合并为无冲突 Skill 目录；既能从零创建，也能加深已有 Skill | 逐轨迹证据引用、多分析器、冲突检测、分层合并 | 不能把一次失败直接写成通用规则；不能把全部规则塞入单篇长文档 |
| SkillOpt | 把 Markdown Skill 当作冻结 Agent 的外部可训练状态；优化器只做有界 add/delete/replace，并用 held-out validation 决定保留或拒绝 | patch budget、候选 revision、冻结 hash、严格改善才接受、拒绝记录、回退上一版 | 不能在已看过结果的考卷上反复调到通过 |
| EvoSkill | 基于失败分析，同时产生多个 Skill/Prompt 变体，形成新的模块化 agent program，再以 held-out 表现和 Pareto frontier 选择 | Skill 目录、多个候选模块、效果与成本联合选择、跨任务迁移验证 | 它不是简单的“一类任务一篇 Skill”；过早增加模块会放大检索噪声 |
| skill-up | Agent Skill 的评测与演化 CLI，而非论文式算法；支持 YAML 用例、多执行引擎、多种 judge、结构化/CI 报告 | 声明式用例、runner adapter、rule/script judge、报告与回归自动化 | 官方工作流允许修 Skill 或 eval；研究实验中不能让它改冻结的 held-out suite |
| SkillRL | 从经验蒸馏层级 SkillBank，并在 RL 中让 SkillBank 与策略共同演化 | `general_skills`、`task_specific_skills`、`common_mistakes`、`when_to_apply`、语义检索 | 完整方案包含 SFT/RL，需要可训练模型和训练基础设施，不是当前迭代的低成本修复 |
| SKILL0（项目名 SkillZero） | 训练初期给完整 Skill，上课过程中逐步撤掉，最终把能力内化到模型参数，减少线上检索噪声和上下文成本 | 作为未来“外挂 Skill 已证明有效后再蒸馏”的路线 | 当前远程 vLLM 只有推理接口，无法直接进行这种后训练；过早内化也会削弱资产审计与快速回退能力 |

## 对当前真实问题的映射

现阶段真实评测已经暴露出两个问题：一是 Skill 检索会把不适用的策略注入任务；二是部分困难任务在第一次模型调用中耗尽输出预算、没有形成工具执行。这说明问题不只是 Skill 文案质量。

最小可行改进应先做“会选、会不选”，再做“会写”：

- 为 Skill 增加 `task_family`、`when_to_apply`、`do_not_apply_when`、`constraints`、`complexity`、`evidence_refs`；
- 检索先召回，再做适用条件过滤；达不到阈值时允许一个 Skill 都不注入；
- 通用原则、任务专用策略、常见错误分库存储；
- 每条候选规则至少由两条相互独立的训练轨迹支持；
- 修改采用有界 patch，产生新 revision 和 hash；没有严格改善或出现新增回归就拒绝并保留旧版；
- 开发集和 held-out 集冻结，不能因第一次结果修改考题后冒充同一次实验。

## 建议架构

```text
真实轨迹
  -> Trace2Skill-style 局部诊断
  -> 证据聚类与冲突合并
  -> EvoSkill-style 模块化 Candidate 目录
  -> SkillOpt-style 有界 revision
  -> SkillRL-inspired 适用条件与检索/弃权
  -> skill-up-style 固定回归与 held-out 验收
  -> 接受或回退（不自动 Promotion）
```

## 实施顺序

第一阶段不训练模型：先实现 Skill schema、适用性过滤与弃权，再实现轨迹局部 patch 和冻结回退，最后用未污染的新 held-out suite 验证。当前失败结果保留，不能覆盖。

第二阶段只有在多个 held-out suite 都出现稳定正收益后，才评估 SkillRL/SKILL0。届时还需要开源模型权重、SFT/RL 训练环境、训练数据治理和独立评测预算。

## 主要来源

- Trace2Skill 官方代码与说明：https://github.com/Qwen-Applications/Trace2Skill
- Trace2Skill 论文：https://arxiv.org/abs/2603.25158
- SkillOpt 官方文档：https://microsoft.github.io/SkillOpt/docs/guideline.html
- SkillOpt 论文：https://arxiv.org/abs/2605.23904
- EvoSkill 官方代码：https://github.com/sentient-agi/EvoSkill
- EvoSkill 论文：https://arxiv.org/abs/2603.02766
- skill-up 官方代码：https://github.com/alibaba/skill-up
- SkillRL 官方代码：https://github.com/aiming-lab/SkillRL
- SkillRL 论文：https://arxiv.org/abs/2602.08234
- SKILL0 论文：https://arxiv.org/abs/2604.02268
- SKILL0 官方代码：https://github.com/ZJU-REAL/SkillZero

## 检索说明

使用本地论文检索工具检索 2024–2026 年相关工作，并以论文页面、官方文档和官方仓库交叉核查。检索期间 Semantic Scholar 返回 429、DBLP 返回异常响应，OpenAlex 部分请求发生 504；因此结论只采用已由 arXiv 或官方仓库确认的条目，不使用未核实的聚合结果。
