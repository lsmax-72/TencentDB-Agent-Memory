import { z } from "zod";
import type { IMetadataStore } from "../../metadata/store/interface.js";
import type { MetadataService } from "../../metadata/service/metadata-service.js";
import { EvolutionStore } from "./store.js";
import { EvolutionError, type EvolutionRecord, type EvolutionProfile } from "./types.js";
import { redactEvidence } from "./evidence.js";
import { EvolutionDispatcher } from "./dispatcher.js";
import { withLocalMutationBoundary } from "../../core/local-mutation-boundary.js";
import { applyFrozenCandidate, reconcileApplication, type FrozenAssetWriter } from "./adoption.js";
import { adoptionProof } from "./adoption-proof.js";

const id = z.string().min(1).max(180).regex(/^[\w.:-]+$/);
const scopeSchema = z.object({ team_id: id });
const recordSchema = scopeSchema.extend({ id });
const kind = z.enum(["trace", "diagnosis", "candidate", "attempt", "review", "adoption", "playbook", "job"]);
const profileSchema = scopeSchema.extend({
  agent_id: id, enabled: z.boolean(), revision: z.number().int().nonnegative(),
  asset_kinds: z.array(z.enum(["skill", "memory", "wiki"])).max(3), asset_ids: z.array(id).max(50),
  daily_tokens: z.number().int().positive().nullable(), daily_model_calls: z.number().int().positive().nullable(),
  daily_candidates: z.number().int().positive().nullable(), evaluation_profile_id: id.nullable(),
  review_model_id: id.nullable().optional(),
  auto_memory: z.boolean(), auto_wiki_maintenance: z.boolean(),
}).strict();

const nullableCount = z.number().int().nonnegative().nullable();
const benchmarkRunSummary = z.object({
  status: z.enum(["TASK_PASS", "TASK_FAIL", "INFRA_ERROR"]), reward: z.number().min(0).max(1),
  usage: z.object({ total_tokens: nullableCount, model_call_count: nullableCount, tool_call_count: nullableCount }).passthrough(),
}).strict();
const benchmarkPair = z.object({
  case_ref: z.object({ id: id, trial: z.number().int().positive() }).strict(),
  baseline: benchmarkRunSummary, candidate: benchmarkRunSummary,
  classification: z.enum(["newly_fixed", "newly_broken", "unchanged_success", "unchanged_failure", "incomparable"]),
}).strict();
const benchmarkComparison = z.object({
  pairs: z.array(benchmarkPair).max(300),
  counts: z.object({ newly_fixed: z.number().int().nonnegative(), newly_broken: z.number().int().nonnegative(), unchanged_success: z.number().int().nonnegative(), unchanged_failure: z.number().int().nonnegative(), incomparable: z.number().int().nonnegative() }).strict(),
  transfer_gain: z.number().min(-1).max(1).nullable(), paired_bootstrap_95_ci: z.tuple([z.number(), z.number()]).nullable(),
  pass_at_1: z.number().min(0).max(1).nullable(), token_cost_change: z.number().nullable(),
}).strict();
const benchmarkIngestSchema = scopeSchema.extend({
  agent_id: id, attempt_id: id, protocol_id: z.literal("tdai-evoagentbench-code-v1"),
  protocol_hash: z.string().regex(/^[a-f0-9]{64}$/), source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(["development", "test_checkpoint", "test"]), status: z.enum(["PASS", "FAIL", "INFRA_ERROR"]),
  comparisons: z.object({ memory: benchmarkComparison, skill: benchmarkComparison }).strict(),
  cost_summary: z.record(z.enum(["vanilla", "memory", "skill"]), z.object({ total_tokens: nullableCount, model_call_count: nullableCount, tool_call_count: nullableCount, elapsed_ms: z.number().int().nonnegative() }).strict()),
  candidate_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), retrieval_coverage: z.record(z.string(), z.number().min(0).max(1)),
  evidence_limitations: z.array(z.string().max(500)).max(20), contamination_findings: z.array(z.string().max(300)).max(100),
}).strict();

const benchmarkRunIngestSchema = scopeSchema.extend({
  agent_id: id, task_id: id, run_id: id, session_id: id,
  protocol_hash: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(["development", "test_checkpoint", "test"]),
  arm: z.enum(["vanilla", "memory", "skill"]), trial: z.number().int().positive(),
  status: z.enum(["TASK_PASS", "TASK_FAIL", "INFRA_ERROR"]), reward: z.number().min(0).max(1),
  candidate_revision: z.number().int().positive().nullable(), candidate_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  task_input: z.string().max(100_000), final_output: z.string().max(100_000),
  tool_events: z.array(z.object({ name: z.string().max(120), arguments: z.string().max(20_000), result: z.string().max(40_000), success: z.boolean(), sequence: z.number().int().nonnegative() }).strict()).max(100),
  usage: z.object({ input_tokens: nullableCount, output_tokens: nullableCount, model_calls: nullableCount, tool_calls: nullableCount }).strict(),
  actual_model: z.string().max(200),
  injected_assets: z.array(z.object({ id, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2),
}).strict();

export const EVOLUTION_ACTIONS = ["overview", "records/list", "records/get", "profiles/list", "profiles/options", "profiles/save", "observation/ingest", "benchmark/run/ingest", "benchmark/attempt/ingest", "task/complete", "diagnosis/request", "diagnosis/retry", "generation/retry", "validation/request", "validation/retry", "evaluation/request", "evaluation/retry", "review/decide", "adoption/apply", "adoption/reconcile"] as const;

interface EvolutionConfiguration {
  reviewBindingIds(teamId: string, agentId: string): string[];
  evaluationBindingIds(teamId: string, agentId: string): string[];
}

export class EvolutionService {
  readonly dispatcher: EvolutionDispatcher;
  constructor(
    readonly store: EvolutionStore,
    private readonly metadata: IMetadataStore,
    private readonly permissions: Pick<MetadataService, "checkAssetPermission">,
    /** Set only after governed legacy writers, executor and adoption admission pass. */
    private readonly automationReady = false,
    dispatcher?: EvolutionDispatcher,
    private readonly adoptionWriter?: FrozenAssetWriter,
    private readonly configuration?: EvolutionConfiguration,
  ) {
    this.dispatcher = dispatcher ?? new EvolutionDispatcher(store, {
      admitted: () => this.automationReady, resolveModel: () => null,
      authorize: (source, profile) => this.authorizeDispatch(source, profile),
    });
  }

  /** Background jobs have no user-key inheritance; recheck the persisted owner and grant. */
  async authorizeDispatch(source: EvolutionRecord, profile: EvolutionProfile): Promise<boolean> {
    if (source.team_id !== profile.team_id || source.agent_id !== profile.agent_id) return false;
    const owner = await this.metadata.getUserById(source.owner_user_id);
    const grantor = await this.metadata.getUserById(profile.authorized_by);
    const ownerMember = await this.metadata.getTeamMember(source.team_id, source.owner_user_id);
    const grantMember = await this.metadata.getTeamMember(source.team_id, profile.authorized_by);
    const team = await this.metadata.getTeamById(source.team_id);
    const agent = await this.metadata.getAgentById(source.agent_id);
    if (team?.status !== "active" || owner?.status !== "active" || grantor?.status !== "active" || ownerMember?.status !== "active"
      || grantMember?.status !== "active" || grantMember.role !== "admin" || agent?.status !== "active"
      || agent.team_id !== source.team_id || agent.owner_user_id !== source.owner_user_id) return false;
    return await this.mayRead(source, source.owner_user_id) && await this.mayRead(source, profile.authorized_by);
  }

  private async actor(userKey: string, teamId: string) {
    const user = await this.metadata.getUserByKey(userKey);
    if (!user || user.status !== "active") throw new EvolutionError(401, "UNAUTHORIZED");
    const member = await this.metadata.getTeamMember(teamId, user.user_id);
    if (!member || member.status !== "active") throw new EvolutionError(403, "TEAM_ACCESS_DENIED");
    return { id: user.user_id, role: member.role };
  }

  private async mayRead(record: Pick<EvolutionRecord, "asset_ids" | "owner_user_id" | "team_id"> & Partial<Pick<EvolutionRecord, "id" | "parent_id" | "payload" | "kind" | "origin">>, userId: string, ancestry = new Set<string>()): Promise<boolean> {
    // Unbound raw evidence is private, including to team administrators.
    if (!record.asset_ids.length && record.owner_user_id !== userId) return false;
    for (const asset_id of record.asset_ids) {
      const asset = await this.metadata.getAssetById(asset_id);
      if (!asset || asset.team_id !== record.team_id || !(await this.permissions.checkAssetPermission({ user_id: userId, asset_id, action: "read" })).allowed) return false;
    }
    // Binding a derivative to a shared target cannot declassify an unbound/private source.
    const refs = new Set<string>(record.parent_id ? [record.parent_id] : []);
    if (record.origin === "runtime") {
      for (const ref of (Array.isArray(record.payload?.source_record_ids) ? record.payload.source_record_ids : [])) {
        if (typeof ref !== "string") return false;
        refs.add(ref);
      }
      if (record.kind === "diagnosis" && Array.isArray(record.payload?.evidence)) {
        for (const item of record.payload.evidence) {
          if (!item || typeof item.record_id !== "string") return false;
          refs.add(item.record_id);
        }
      }
    }
    const next = new Set(ancestry);
    if (record.id) { if (next.has(record.id) || next.size >= 64) return false; next.add(record.id); }
    for (const ref of refs) {
      const source = this.store.get(ref);
      if (!source || source.team_id !== record.team_id || !await this.mayRead(source, userId, next)) return false;
    }
    return true;
  }

  private async visible(teamId: string, userId: string) {
    const records = this.store.list(teamId);
    const allowed = await Promise.all(records.map(record => this.mayRead(record, userId)));
    return records.filter((_, index) => allowed[index]);
  }

  async canReadRecord(record: EvolutionRecord, userId: string): Promise<boolean> {
    const [user, member, team] = await Promise.all([this.metadata.getUserById(userId), this.metadata.getTeamMember(record.team_id, userId), this.metadata.getTeamById(record.team_id)]);
    return user?.status === "active" && member?.status === "active" && team?.status === "active" && await this.mayRead(record, userId);
  }

  async invoke(action: string, body: unknown, userKey: string): Promise<unknown> {
    const { team_id } = scopeSchema.parse(body);
    const actor = await this.actor(userKey, team_id);
    if (action === "overview") {
      const records = await this.visible(team_id, actor.id);
      return {
        records: records.length,
        counts: Object.fromEntries(kind.options.map(value => [value, records.filter(record => record.kind === value).length])),
        statuses: records.reduce<Record<string, number>>((counts, record) => ({ ...counts, [record.status]: (counts[record.status] ?? 0) + 1 }), {}),
        automation_ready: this.automationReady,
        runtime_status: this.automationReady ? "READY" : "OFFLINE_ONLY",
        notices: ["内容校验不等于效果提升", "历史 FAIL / INFRA_ERROR 保留，不能通过导入采用", "正式资产自动闭环默认关闭；研究评测是否调用模型以轨迹证据为准"],
      };
    }
    if (action === "records/list") {
      const input = scopeSchema.extend({ kind: kind.optional(), asset_kind: z.enum(["skill", "memory", "wiki"]).optional(), origin: z.enum(["runtime", "historical", "offline_test"]).optional(), statuses: z.array(z.string().max(80)).max(10).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30) }).parse(body);
      const records = (await this.visible(team_id, actor.id)).filter(record => (!input.kind || record.kind === input.kind) && (!input.statuses || input.statuses.includes(record.status)) && (!input.origin || record.origin === input.origin) && (!input.asset_kind || record.payload.asset_kind === input.asset_kind));
      return { items: records.slice(input.offset, input.offset + input.limit), total: records.length };
    }
    if (action === "records/get") {
      const input = recordSchema.parse(body);
      const record = this.store.get(input.id);
      if (!record || record.team_id !== team_id || !await this.mayRead(record, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      const related: EvolutionRecord[] = [];
      for (const child of this.store.list(team_id)) {
        if (child.parent_id === record.id && await this.mayRead(child, actor.id)) related.push(child);
        if (related.length >= 100) break;
      }
      return { record, events: this.store.events(record.id), related };
    }
    if (action === "profiles/list") {
      // Grants reveal private target IDs; only their author may inspect them.
      return { items: this.store.profiles(team_id).filter(profile => profile.authorized_by === actor.id) };
    }
    if (action === "profiles/options") {
      if (actor.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
      const input = scopeSchema.extend({ agent_id: id }).strict().parse(body);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!agent || agent.team_id !== team_id || agent.status !== "active") throw new EvolutionError(404, "AGENT_NOT_FOUND");
      const bindings = await this.metadata.listAgentFixedAssets(input.agent_id, { limit: 1000, offset: 0 });
      const assets = (await Promise.all(bindings.items.map(row => this.metadata.getAssetById(row.asset_id))))
        .filter(asset => asset && asset.team_id === team_id && ["skill", "chat_memory", "llm_wiki"].includes(asset.asset_type));
      const writable = (await Promise.all(assets.map(async asset => ({ asset: asset!, allowed: (await this.permissions.checkAssetPermission({ asset_id: asset!.asset_id, user_id: actor.id, action: "write" })).allowed }))))
        .filter(item => item.allowed).map(({ asset }) => ({ id: asset.asset_id, name: asset.name, asset_kind: asset.asset_type === "chat_memory" ? "memory" : asset.asset_type === "llm_wiki" ? "wiki" : "skill" }));
      return { assets: writable, review_model_ids: this.configuration?.reviewBindingIds(team_id, input.agent_id) ?? [],
        evaluation_profile_ids: this.configuration?.evaluationBindingIds(team_id, input.agent_id) ?? [],
        adoption_kinds: (["skill", "memory", "wiki"] as const).filter(assetKind => this.adoptionWriter?.supports?.(assetKind) === true),
        automation_ready: this.automationReady };
    }
    if (action === "profiles/save") {
      if (actor.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
      const { revision, ...input } = profileSchema.parse(body);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!agent || agent.team_id !== team_id || agent.status !== "active") throw new EvolutionError(404, "AGENT_NOT_FOUND");
      const fixed = input.asset_ids.length
        ? new Set((await this.metadata.listAgentFixedAssets(input.agent_id, { limit: 1000, offset: 0 })).items.map(row => row.asset_id))
        : new Set<string>();
      for (const asset_id of input.asset_ids) {
        const asset = await this.metadata.getAssetById(asset_id);
        if (!asset || asset.team_id !== team_id || !fixed.has(asset_id) || !["skill", "chat_memory", "llm_wiki"].includes(asset.asset_type)
          || !(await this.permissions.checkAssetPermission({ asset_id, user_id: actor.id, action: "write" })).allowed) throw new EvolutionError(403, "TARGET_WRITE_DENIED");
      }
      if (input.enabled && (!input.daily_tokens || !input.daily_model_calls || !input.daily_candidates || !input.asset_kinds.length)) throw new EvolutionError(400, "BUDGET_AND_SCOPE_REQUIRED");
      if (input.enabled && !this.automationReady) throw new EvolutionError(409, "AUTOMATION_ADMISSION_REQUIRED");
      if (input.enabled && input.asset_kinds.includes("skill") && !input.evaluation_profile_id) throw new EvolutionError(400, "SKILL_EVALUATION_PROFILE_REQUIRED");
      if (input.enabled && !input.review_model_id) throw new EvolutionError(400, "REVIEW_MODEL_REQUIRED");
      if (input.enabled) {
        const reviewModelId = input.review_model_id!;
        const reviewAvailable = this.configuration?.reviewBindingIds(team_id, input.agent_id).includes(reviewModelId) === true;
        const evaluationAvailable = !input.asset_kinds.includes("skill")
          || this.configuration?.evaluationBindingIds(team_id, input.agent_id).includes(input.evaluation_profile_id!) === true;
        if (!reviewAvailable || !evaluationAvailable) throw new EvolutionError(409, "MODEL_OR_EVALUATION_BINDING_UNAVAILABLE");
      }
      if (input.enabled) {
        const assetKinds = new Set((await Promise.all(input.asset_ids.map(assetId => this.metadata.getAssetById(assetId)))).map(asset => asset?.asset_type === "chat_memory" ? "memory" : asset?.asset_type === "llm_wiki" ? "wiki" : asset?.asset_type));
        if (input.asset_kinds.some(assetKind => !assetKinds.has(assetKind))) throw new EvolutionError(400, "ASSET_KIND_REQUIRES_BOUND_TARGET");
      }
      if (input.enabled && (!this.adoptionWriter || input.asset_kinds.some(assetKind => !this.adoptionWriter?.supports?.(assetKind)))) throw new EvolutionError(409, "ASSET_ADOPTION_PATH_UNAVAILABLE");
      return withLocalMutationBoundary(async () => {
        // A request queued behind an old write may have lost its permissions while waiting.
        const refreshed = await this.actor(userKey, team_id);
        if (refreshed.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
        const currentFixed = input.asset_ids.length
          ? new Set((await this.metadata.listAgentFixedAssets(input.agent_id, { limit: 1000, offset: 0 })).items.map(row => row.asset_id))
          : new Set<string>();
        for (const asset_id of input.asset_ids) {
          if (!currentFixed.has(asset_id) || !(await this.permissions.checkAssetPermission({ asset_id, user_id: refreshed.id, action: "write" })).allowed) throw new EvolutionError(403, "TARGET_WRITE_DENIED");
        }
        return this.store.saveProfile({ ...input, authorized_by: actor.id }, revision);
      });
    }
    if (action === "observation/ingest") {
      const input = scopeSchema.extend({
        agent_id: id, event_id: id, session_id: id, turn_id: id,
        source: z.literal("codex"), terminal_event: z.enum(["STOP", "INTERRUPT"]),
        task_input: z.string().max(100_000), final_output: z.string().max(100_000),
        tool_events: z.array(z.object({
          tool_use_id: z.string().min(1).max(200), name: z.string().min(1).max(120),
          arguments: z.string().max(20_000), result: z.string().max(40_000),
          success: z.boolean(), sequence: z.number().int().nonnegative(),
        })).max(100),
        usage: z.object({
          input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(),
          model_calls: z.number().int().nonnegative().nullable(), tool_calls: z.number().int().nonnegative().nullable(),
        }),
        actual_model: z.string().max(200), cwd: z.string().max(4_000), permission_mode: z.string().max(80),
      }).strict().parse(body);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!agent || agent.team_id !== team_id || agent.status !== "active" || agent.owner_user_id !== actor.id) {
        throw new EvolutionError(403, "AGENT_OWNER_REQUIRED");
      }
      const inputText = redactEvidence(input.task_input), outputText = redactEvidence(input.final_output), cwd = redactEvidence(input.cwd);
      const toolEvidence = input.tool_events.map(event => ({ event, args: redactEvidence(event.arguments), result: redactEvidence(event.result) }));
      const payload = {
        ...input,
        evidence_mode: "observation", completion: input.terminal_event === "STOP" ? "codex_turn_stopped" : "codex_turn_interrupted",
        task_input: inputText.text, final_output: outputText.text, cwd: cwd.text,
        tool_events: toolEvidence.map(({ event, args, result }) => ({ ...event, arguments: args.text, result: result.text })),
        redaction: {
          policy: "credential-patterns-v1", task_input_hash: inputText.original_sha256, final_output_hash: outputText.original_sha256,
          cwd_hash: cwd.original_sha256,
          replacements: inputText.replacements + outputText.replacements + cwd.replacements
            + toolEvidence.reduce((sum, item) => sum + item.args.replacements + item.result.replacements, 0),
          tool_original_hashes: toolEvidence.map(({ event, args, result }) => ({ sequence: event.sequence, tool_use_id: event.tool_use_id, arguments: args.original_sha256, result: result.original_sha256 })),
        },
      };
      const titleText = inputText.text.trim().split(/\r?\n/, 1)[0]?.slice(0, 120) || `Codex turn ${input.turn_id.slice(0, 12)}`;
      return this.store.append({
        team_id, owner_user_id: actor.id, agent_id: input.agent_id, kind: "trace", origin: "runtime",
        title: `Codex · ${titleText}`, status: input.terminal_event === "STOP" ? "OBSERVED" : "INTERRUPTED",
        asset_ids: [], payload,
      }, `${actor.id}/codex/${input.event_id}`, actor.id);
    }
    if (action === "benchmark/attempt/ingest") {
      const input = benchmarkIngestSchema.parse(body);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!agent || agent.team_id !== team_id || agent.status !== "active" || agent.owner_user_id !== actor.id) {
        throw new EvolutionError(403, "AGENT_OWNER_REQUIRED");
      }
      // Benchmark evidence is research-only. It is not an adoption proof and never dispatches diagnosis.
      return this.store.append({
        team_id, owner_user_id: actor.id, agent_id: input.agent_id, kind: "attempt", origin: "runtime",
        title: `EvoAgentBench · ${input.phase} · ${input.attempt_id}`, status: input.status, asset_ids: [],
        payload: {
          attempt_type: "benchmark_transfer_evaluation", benchmark: "EvoAgentBench-compatible",
          protocol_id: input.protocol_id, protocol_hash: input.protocol_hash, source_hash: input.source_hash,
          phase: input.phase, comparisons: input.comparisons, cost_summary: input.cost_summary,
          pairs: input.comparisons.skill.pairs, comparison_summary: {
            memory: input.comparisons.memory.counts, skill: input.comparisons.skill.counts,
          }, candidate_hash: input.candidate_hash, retrieval_coverage: input.retrieval_coverage,
          contamination_findings: input.contamination_findings, evidence_limitations: input.evidence_limitations,
          research_only: true, promotion_allowed: false, test_traces_candidate_eligible: false,
        },
      }, `${actor.id}/evoagentbench/${input.attempt_id}/${input.source_hash}`, actor.id);
    }
    if (action === "benchmark/run/ingest") {
      const input = benchmarkRunIngestSchema.parse(body);
      const task = await this.metadata.getTaskById(input.task_id);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!task || !agent || task.team_id !== team_id || agent.team_id !== team_id
        || task.creator_user_id !== actor.id || agent.owner_user_id !== actor.id || agent.status !== "active") {
        throw new EvolutionError(403, "TASK_OWNER_REQUIRED");
      }
      if ((input.arm === "vanilla") !== (input.injected_assets.length === 0)
        || (input.arm === "vanilla") !== (input.candidate_hash === null && input.candidate_revision === null)) {
        throw new EvolutionError(400, "BENCHMARK_ASSET_PROVENANCE_INVALID");
      }
      const inputText = redactEvidence(input.task_input), outputText = redactEvidence(input.final_output);
      const toolEvidence = input.tool_events.map(event => ({ event, args: redactEvidence(event.arguments), result: redactEvidence(event.result) }));
      const usedAssetVersions = Object.fromEntries(input.injected_assets.map(asset => [asset.id, asset.hash]));
      const payload = {
        ...input, evidence_mode: "benchmark", completion: "benchmark_verifier_complete",
        task_input: inputText.text, final_output: outputText.text,
        tool_events: toolEvidence.map(({ event, args, result }) => ({ ...event, arguments: args.text, result: result.text })),
        outcome: input.status === "TASK_PASS" ? "PASS" : input.status === "TASK_FAIL" ? "FAIL" : "INFRA_ERROR",
        used_asset_versions: usedAssetVersions, research_only: true, promotion_allowed: false,
        test_traces_candidate_eligible: false,
        redaction: {
          policy: "credential-patterns-v1", task_input_hash: inputText.original_sha256, final_output_hash: outputText.original_sha256,
          replacements: inputText.replacements + outputText.replacements + toolEvidence.reduce((sum, item) => sum + item.args.replacements + item.result.replacements, 0),
          tool_original_hashes: toolEvidence.map(({ event, args, result }) => ({ sequence: event.sequence, arguments: args.original_sha256, result: result.original_sha256 })),
        },
      };
      // Development/test runs are visible research evidence, never diagnosis inputs.
      return this.store.append({
        team_id, owner_user_id: actor.id, agent_id: input.agent_id, kind: "trace", origin: "runtime",
        title: task.title, status: "RECORDED", asset_ids: [], payload,
      }, `${actor.id}/evoagentbench-run/${input.run_id}`, actor.id);
    }
    if (action === "task/complete") {
      const input = scopeSchema.extend({
        agent_id: id, task_id: id, session_id: id, run_id: id,
        completion: z.literal("host_task_complete"),
        asset_ids: z.array(id).max(50), task_input: z.string().max(100_000),
        final_output: z.string().max(100_000),
        tool_events: z.array(z.object({ name: z.string().max(120), arguments: z.string().max(20_000), result: z.string().max(40_000), success: z.boolean(), sequence: z.number().int().nonnegative() })).max(100),
        usage: z.object({ input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(), model_calls: z.number().int().nonnegative().nullable(), tool_calls: z.number().int().nonnegative().nullable() }),
        actual_model: z.string().max(200), outcome: z.enum(["PASS", "FAIL", "INFRA_ERROR", "UNKNOWN"]),
        used_asset_versions: z.record(z.string(), z.string().max(200)),
      }).strict().parse(body);
      const task = await this.metadata.getTaskById(input.task_id);
      const agent = await this.metadata.getAgentById(input.agent_id);
      if (!task || !agent || task.team_id !== team_id || agent.team_id !== team_id || task.creator_user_id !== actor.id || agent.owner_user_id !== actor.id) throw new EvolutionError(403, "TASK_OWNER_REQUIRED");
      const inputText = redactEvidence(input.task_input), outputText = redactEvidence(input.final_output);
      const toolEvidence = input.tool_events.map(event => ({ event, args: redactEvidence(event.arguments), result: redactEvidence(event.result) }));
      const payload = { ...input, task_input: inputText.text, final_output: outputText.text,
        tool_events: toolEvidence.map(({ event, args, result }) => ({ ...event, arguments: args.text, result: result.text })),
        redaction: { policy: "credential-patterns-v1", task_input_hash: inputText.original_sha256, final_output_hash: outputText.original_sha256,
          replacements: inputText.replacements + outputText.replacements + toolEvidence.reduce((sum, item) => sum + item.args.replacements + item.result.replacements, 0),
          tool_original_hashes: toolEvidence.map(({ event, args, result }) => ({ sequence: event.sequence, arguments: args.original_sha256, result: result.original_sha256 })),
        },
      };
      const draft = { team_id, owner_user_id: actor.id, agent_id: input.agent_id, kind: "trace" as const, origin: "runtime" as const, title: task.title, status: "RECORDED", asset_ids: input.asset_ids, payload };
      if (!await this.mayRead(draft, actor.id)) throw new EvolutionError(403, "SOURCE_READ_DENIED");
      if (Object.keys(input.used_asset_versions).some(assetId => !input.asset_ids.includes(assetId))) throw new EvolutionError(400, "ASSET_PROVENANCE_INCOMPLETE");
      // This receipt records a host assertion, not an Oracle certification.
      const trace = this.store.completeWithJob(draft, `${actor.id}/${input.run_id}`, actor.id, source => this.dispatcher.enqueue(source));
      this.dispatcher.wake();
      return trace;
    }
    if (action === "diagnosis/request") {
      const input = recordSchema.parse(body);
      const source = this.store.get(input.id);
      if (!source || source.team_id !== team_id || !await this.mayRead(source, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (source.kind !== "trace" || source.origin !== "runtime") throw new EvolutionError(409, "LIVE_TRACE_REQUIRED");
      if (source.payload.completion !== "host_task_complete") throw new EvolutionError(409, "HOST_TASK_COMPLETION_REQUIRED");
      const job = this.dispatcher.enqueue(source);
      this.dispatcher.wake();
      return job;
    }
    if (action === "validation/request") {
      const input = recordSchema.strict().parse(body), candidate = this.store.get(input.id);
      if (!candidate || candidate.team_id !== team_id || !await this.mayRead(candidate, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (actor.id !== candidate.owner_user_id && !["admin", "reviewer"].includes(actor.role)) throw new EvolutionError(403, "REVIEWER_REQUIRED");
      const job = this.dispatcher.enqueueValidation(candidate);
      if (!job) throw new EvolutionError(503, "VALIDATOR_UNAVAILABLE");
      this.dispatcher.wake(); return job;
    }
    if (action === "evaluation/request") {
      const input = recordSchema.strict().parse(body), candidate = this.store.get(input.id);
      if (!candidate || candidate.team_id !== team_id || !await this.mayRead(candidate, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (actor.id !== candidate.owner_user_id && !["admin", "reviewer"].includes(actor.role)) throw new EvolutionError(403, "REVIEWER_REQUIRED");
      const job = this.dispatcher.enqueueEvaluation(candidate); if (!job) throw new EvolutionError(503, "EVALUATOR_UNAVAILABLE");
      this.dispatcher.wake(); return job;
    }
    if (action === "diagnosis/retry" || action === "generation/retry" || action === "validation/retry" || action === "evaluation/retry") {
      const input = recordSchema.extend({ request_id: id }).strict().parse(body);
      const previous = this.store.get(input.id);
      if (!previous || previous.team_id !== team_id || !await this.mayRead(previous, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      const source = this.store.get(String(previous.payload.source_id));
      if (!source || source.team_id !== team_id || !await this.mayRead(source, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (actor.id !== source.owner_user_id) throw new EvolutionError(403, "TASK_OWNER_REQUIRED");
      const job = action === "validation/retry" ? this.dispatcher.enqueueValidation(source, { previous, requestId: input.request_id })
        : action === "evaluation/retry" ? this.dispatcher.enqueueEvaluation(source, { previous, requestId: input.request_id })
        : action === "generation/retry" ? this.dispatcher.retryProposal(source, previous, input.request_id) : this.dispatcher.enqueue(source, { previous, requestId: input.request_id });
      if (!job) throw new EvolutionError(503, "VALIDATOR_UNAVAILABLE");
      this.dispatcher.wake();
      return job;
    }
    if (action === "review/decide") {
      const input = recordSchema.extend({ revision: z.number().int().positive(), decision: z.enum(["REJECTED", "NEEDS_EVIDENCE", "REVIEW_APPROVED"]), reason: z.string().min(1).max(4000) }).parse(body);
      if (!["admin", "reviewer"].includes(actor.role)) throw new EvolutionError(403, "REVIEWER_REQUIRED");
      const candidate = this.store.get(input.id);
      if (!candidate || candidate.team_id !== team_id || !await this.mayRead(candidate, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      if (candidate.kind !== "candidate" || candidate.origin !== "runtime") throw new EvolutionError(409, "LIVE_CANDIDATE_REQUIRED");
      if (input.decision === "REVIEW_APPROVED") {
        const proof = adoptionProof(this.store, candidate);
        if (!proof || !await this.mayRead(proof, actor.id)) throw new EvolutionError(409, candidate.payload.asset_kind === "skill" ? "EFFECT_EVALUATION_REQUIRED" : "VALIDATION_REQUIRED");
      }
      return this.store.review(candidate.id, input.revision, input.decision, input.reason, actor.id);
    }
    if (action === "adoption/apply") {
      if (actor.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
      if (!this.adoptionWriter) throw new EvolutionError(503, "ADOPTION_UNAVAILABLE");
      const input = recordSchema.extend({ revision: z.number().int().positive() }).strict().parse(body);
      const candidate = this.store.get(input.id);
      if (!candidate || candidate.team_id !== team_id || !await this.mayRead(candidate, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      return applyFrozenCandidate(this.store, candidate.id, input.revision, actor.id, this.adoptionWriter);
    }
    if (action === "adoption/reconcile") {
      if (actor.role !== "admin") throw new EvolutionError(403, "ADMIN_REQUIRED");
      if (!this.adoptionWriter) throw new EvolutionError(503, "ADOPTION_UNAVAILABLE");
      const input = recordSchema.strict().parse(body), operation = this.store.get(input.id);
      if (!operation || operation.team_id !== team_id || operation.kind !== "adoption" || !await this.mayRead(operation, actor.id)) throw new EvolutionError(404, "RECORD_NOT_FOUND");
      return reconcileApplication(this.store, operation.id, actor.id, this.adoptionWriter);
    }
    throw new EvolutionError(404, "UNKNOWN_EVOLUTION_ACTION");
  }
}
