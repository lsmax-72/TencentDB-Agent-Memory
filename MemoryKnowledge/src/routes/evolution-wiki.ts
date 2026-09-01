import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { WikiSourceManager } from "../engines/wiki/index.js";
import { applyWikiProposal, isMechanicalWikiMaintenance, recoverWikiApply, snapshotWiki, validateFrozenWikiProposal, verifyWikiApply, type FrozenWikiProposal } from "../evolution/wiki-workspace.js";
import { produceNativeWiki } from "../evolution/wiki-producer.js";
import { createLlmClient, type LlmCallUsage } from "../engines/wiki/ingest-v2/llm.js";
import type { WikiService } from "../store/wiki-service.js";
import { isValidIdSegment, wrapError, wrapOk } from "../api-helpers.js";

function authorized(value: string | undefined): boolean {
  const expected = process.env.EVOLUTION_INTERNAL_TOKEN;
  if (!expected || !value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7)), wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
function journal(root: string, operationId: string): string {
  if (!isValidIdSegment(operationId)) throw new Error("EVOLUTION_OPERATION_ID_INVALID");
  const dir = join(root, ".evolution-adoptions"); mkdirSync(dir, { recursive: true });
  return join(dir, `${operationId}.json`);
}
export function createEvolutionWikiRoutes(deps: { wikiService: WikiService; wikiMgr: WikiSourceManager;
  produce?: typeof produceNativeWiki }): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!authorized(c.req.header("authorization"))) return c.json(wrapError(401, "internal evolution authorization required"), 401);
    await next();
  });
  const resolve = async (c: Context) => {
    const body = await c.req.json<Record<string, unknown>>(), serviceId = c.req.header("x-tdai-service-id");
    if (!isValidIdSegment(serviceId) || !isValidIdSegment(body.team_id) || !isValidIdSegment(body.wiki_id)) throw new Error("WIKI_SCOPE_REQUIRED");
    const row = deps.wikiService.getById(serviceId, String(body.wiki_id));
    if (!row || row.team_id !== body.team_id) throw new Error("WIKI_NOT_FOUND");
    return { body, row, root: deps.wikiService.dirFor(serviceId, row.team_id, row.wiki_id) };
  };
  app.post("/snapshot", async c => { try { const { root } = await resolve(c); return c.json(wrapOk(snapshotWiki(root))); } catch (e) { return c.json(wrapError(409, (e as Error).message), 409); } });
  app.post("/propose", async c => { try {
    const { body, row, root } = await resolve(c);
    const model = body.model as Record<string, unknown>, maxCalls = Number(body.max_calls);
    if (!isValidIdSegment(body.job_id) || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 8
      || model.provider !== "openai-compatible" || typeof model.model !== "string" || !model.model
      || typeof model.base_url !== "string" || typeof model.api_key !== "string" || !model.api_key
      || !Number.isSafeInteger(model.max_output_tokens) || !Number.isSafeInteger(model.token_ceiling)
      || !Number.isSafeInteger(model.timeout_ms) || model.temperature !== 0 || model.fallback !== false) throw new Error("WIKI_PROPOSAL_CONFIG_INVALID");
    const maxOutputTokens = Number(model.max_output_tokens), tokenCeiling = Number(model.token_ceiling), timeoutMs = Number(model.timeout_ms);
    const endpoint = new URL(model.base_url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("WIKI_PROPOSAL_CONFIG_INVALID");
    const sources = deps.wikiService.rawLs(row.service_id, row.team_id, row.wiki_id);
    if (!sources?.length || sources.length > 50) throw new Error("WIKI_SOURCE_REQUIRED");
    const usage: Array<{ label: string; input_tokens: number; output_tokens: number }> = [];
    let started = 0;
    const client = createLlmClient({ protocol: "openai", provider: "openai-compatible", apiKey: String(model.api_key),
      model: String(model.model), baseUrl: String(model.base_url), maxTokens: maxOutputTokens, timeoutMs, stream: false,
    }, {
      beforeCall: params => {
        if (++started > maxCalls || params.temperature !== 0 || (params.maxOutputTokens ?? maxOutputTokens) > maxOutputTokens) throw new Error("WIKI_MODEL_CALL_LIMIT");
        if (Buffer.byteLength(params.system) + Buffer.byteLength(params.prompt) + maxOutputTokens + 512 > tokenCeiling) throw new Error("WIKI_MODEL_CONTEXT_EXCEEDS_RESERVATION");
      },
      afterCall: (call: LlmCallUsage) => {
        if (call.input_tokens === null || call.output_tokens === null) throw new Error("WIKI_MODEL_USAGE_MISSING");
        usage.push({ label: call.label, input_tokens: call.input_tokens, output_tokens: call.output_tokens });
      },
    });
    // Source paths come only from the Wiki service registry, never from the request body.
    const proposal = await (deps.produce ?? produceNativeWiki)({ root, workspaceRoot: join(root, ".evolution-candidates"),
      sourcePaths: sources.map(source => `raw/sources/${source.filename}`), client: { ...client, chat: params => client.chat({ ...params, temperature: 0 }) },
    });
    if (!usage.length || usage.length !== started) throw new Error("WIKI_MODEL_USAGE_MISSING");
    return c.json(wrapOk({ proposal, usage: { input_tokens: usage.reduce((n, call) => n + call.input_tokens, 0),
      output_tokens: usage.reduce((n, call) => n + call.output_tokens, 0), model_calls: usage.length, calls: usage } }));
  } catch (e) { return c.json(wrapError((e as Error).message === "WIKI_MODEL_CALL_LIMIT" ? 429 : 409, (e as Error).message), (e as Error).message === "WIKI_MODEL_CALL_LIMIT" ? 429 : 409); } });
  app.post("/validate", async c => { try { const { body, root } = await resolve(c), proposal = body.proposal as FrozenWikiProposal;
    validateFrozenWikiProposal(root, proposal); if (snapshotWiki(root).hash !== proposal.base.hash) throw new Error("WIKI_BASE_STALE");
    return c.json(wrapOk({ valid: true, proposal_hash: proposal.hash, base_hash: proposal.base.hash, maintenance_only: isMechanicalWikiMaintenance(proposal) }));
  } catch (e) { return c.json(wrapError(409, (e as Error).message), 409); } });
  app.post("/apply", async c => { try { const { body, row, root } = await resolve(c), proposal = body.proposal as FrozenWikiProposal, operationId = String(body.operation_id);
    await applyWikiProposal(root, proposal, journal(root, operationId), async () => {
      deps.wikiMgr.init({ name: row.wiki_id, path: root }); deps.wikiMgr.sync(row.wiki_id);
      if (!deps.wikiMgr.get(row.wiki_id) || deps.wikiMgr.getPages(row.wiki_id).length < 1) throw new Error("WIKI_INDEX_READBACK_INCOMPLETE");
    });
    return c.json(wrapOk({ applied: true, proposal_hash: proposal.hash }));
  } catch (e) { return c.json(wrapError(409, (e as Error).message), 409); } });
  app.post("/verify", async c => { try { const { body, root } = await resolve(c), proposal = body.proposal as FrozenWikiProposal;
    return c.json(wrapOk({ applied: verifyWikiApply(root, journal(root, String(body.operation_id)), proposal) }));
  } catch (e) { return c.json(wrapError(409, (e as Error).message), 409); } });
  app.post("/rollback", async c => { try { const { body, row, root } = await resolve(c);
    await recoverWikiApply(root, journal(root, String(body.operation_id)), async () => { deps.wikiMgr.init({ name: row.wiki_id, path: root }); deps.wikiMgr.sync(row.wiki_id); });
    return c.json(wrapOk({ rolled_back: true }));
  } catch (e) { return c.json(wrapError(409, (e as Error).message), 409); } });
  return app;
}
