# MemoryHub 自进化实施记录

状态：IMPLEMENTATION_IN_PROGRESS；不能视为完整交付。2026-08-31。

## 已锁定边界

- 主交付为现有 8125 Hub；沿用 TencentDB / Tea 界面，不使用 MyUI。
- Skill、Memory L1/L2/L3、Wiki 纳入候选治理；Code Graph 不变。
- Wiki 维护自动、正文审查；Skill 采用单独人工操作；Memory 只有可独立确认的低风险变动允许自动采用。
- 不调用或探测 vLLM；不生成 v5、不修改旧 Suite/Gate/预算或历史结果；v4 FAIL 保留。
- 不 push/PR/merge；用户 deployment 三个修改文件不碰。

## 已实现（源码，尚未部署）

- evolution_* 表复用现有 metadata SQLite 连接；记录去重、冻结 hash、版本 CAS、历史只读、预算预留及保守处理未知 usage。
- Core /v3/evolution 与 Panel /api/v1/evolution 鉴权路由；源资产权限过滤，无源资产绑定的证据仅所有者可见。
- Hub 六个导航页面、详情、基础/候选对照和审查操作；不是 MyUI。
- 自动化启用仍被 admission 阻止：旧写入口治理、执行器和可恢复采用尚未全面接线，绝不提前放开。
- SkillReview 隔离候选生成 helper、L1 proposalSink（失败不回退写入）、Memory shadow storage、内容校验策略。
- 独立复盘模型配置与单次调用 adapter（transport mock 验证）：temperature=0、无 fallback / 隐藏重试，调用前检查上下文上界；未知 usage 保留预算，失败独立记录。
- 原有 L1/L2/L3 的隔离调用封装，L2 派生 index/navigation 与 L3 最终内容一起冻结；离线 runner doubles 验证，没有真实模型效果结论。
- Knowledge 原有 extractSource + commitCandidates 在副本运行；合并错误不冻结成功候选；冻结后精确应用和恢复日志，不重调模型。尚未接入 WikiService 的全局写锁/路由。
- 采用意图与候选状态在同一 SQLite transaction 持久化；双击不重复写；索引/登记未核验不置 APPLIED；reconcile 只核对、不盲目重复写。实际三类正式 writer 尚未接入，测试使用隔离 writer doubles。
- 历史 main.json / freeze.json 受控 CLI 导入，源文件不变，保留原结论、带前缀的 Phase4 hash、基础/候选 diff；历史来源不能采用。
- 轨迹凭证模式脱敏（保留原 hash），不是完整 DLP 保证；权限校验仍不可省略。

## 验证

- Core `npm test`：87 tests / 19 files PASS（包含原 Evaluation 回归）。Core `npm run build:plugin` PASS。
- `node scripts/evolution/typecheck.mjs`：新增 control 文件零类型错误；其导入的既有 Core 代码另有 35 diagnostics，不能当成全仓 strict typecheck PASS。
- Panel `npm run build` / `npm test`：PASS，3 tests。web `npm run build` PASS（既有重复依赖键、大 bundle 警告）。
- Knowledge `npm test`：8 tests / 3 files PASS；`npm run typecheck` PASS；`npm run build` PASS（包含日志中间件兼容修正）。
- Knowledge 新安装 Hono 的 cache 类型暴露旧代码 TS2322；去掉对内部 bodyCache 的手动赋值，使用原生 text() 自动缓存；两条下游 JSON / error-body 回归通过。Code Graph 算法、路由和存储不改。
- Core / Panel npm ci 使用现有锁文件；Knowledge 无锁文件，使用 `npm install --ignore-scripts --no-package-lock` 安装测试依赖，没有改 package.json 或新增锁文件。

## 隔离运行证据（不是主 Hub 交付）

- 输出目录：`/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-hub-20260831-r4`；Core26920 / Hub26725；独立命名、loopback 端口、网络与存储，无生产 mount，无模型配置或凭证。
- 源码与 web/dist 在 setup 时复制并记录 hash，不在运行 Attempt 内热修改源码。
- r2（Core24920 / Hub24725）历史结果页 API / 重启验收 PASS。
- r4 增加历史候选 diff 导入：setup / verify / restart PASS。真实 v4 `FAIL / NO_NEW_FIX` 不变。
- r1：Docker internal network 不发布 Mac loopback 端口导致 setup INFRA，已停止自己创建的容器但保留文件/容器。
- r3：导入器误将 bare SHA 与 `sha256:` 比较，历史 main 导入成功、candidate 导入失败；失败记录保留，修复后独立 r4。没有修改历史内容或 hash。
- 用户明确授权后，临时账号在24725登录成功；六页导航、详情深链接/刷新、Playbook/审查子页、候选分类控件实测通过。console 没有 error/warn；真实 v4 `FAIL / NO_NEW_FIX`、5条 unchanged_success 与原成本一致，原始 trace 未导入也明确标注。
- 浏览器发现 Tea link 按钮的长实验名跨列；增加仅作用于自进化页面的换行样式，没有替换 TencentDB 主题。web build 和 Panel3 tests 再次 PASS。
- 独立冻结预览 `/Users/lsmax/Coder/phase6-artifacts/outputs/evolution-browser-20260831-r1` 在同一已授权24725验证修复：按钮右边420.8px，小于单元格右边438.8px。六页再验通过，无 console error/warn。预览复用隔离 r2 Core，只读访问；暂时停止旧测试 Hub，但保留其容器与冻结文件，验完恢复。主8125未受影响。
- `scripts/evolution/browser-preview.mjs` 可复现同源前端预览及恢复，输出独立 build hashes；不覆盖旧 Attempt，不需要另一端口重新登录。r2与预览各有 `browser-acceptance.json` 和截图。
- 这是基础浏览器验收；r2候选/审查为空，不代表完整生成/审查/采用通过。r4历史候选diff仍仅API验收，本次未登录26725。

## 尚未完成

1. 任务完成后的持久化自动编排；受限本地 evaluation executor；每个真实 provider/tool step、重试和 Wiki merge 的预算准入。
2. 全部旧 Skill / Memory L1/L2/L3 自动写入口治理接线（含后台和 standalone pipeline）；开关尚不能启用，失败不退回直接写是强制准入条件。
3. 三类正式 writer、原生全局并发锁、scope/grant/base-version/source 权限再核验、登记与索引确认、完整重启恢复。现有采用 coordinator 不能代替这些接口验收。
4. Skill 评测任务与现有 nanobot bridge 的固定任务适配；服务端 validation/evaluation receipt 和风险授权封口。旧 Oracle/Pair/Gate 不改。
5. 完整配置和采用 UI（当前预算草案只保存关闭状态），更多历史 trace/diagnosis/Playbook 的受控关联导入；不能伪造记录填空页面。
6. 浏览器真实候选生成/证据关联/审查/采用流程（六页导航与历史详情已验）；隔离完整端到端验收后，备份再更新主 8125。

目前未修改运行中的服务，不能告诉用户 8125 已有新功能；未证明真实模型自进化闭环或收益。
