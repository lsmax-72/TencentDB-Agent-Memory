import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { WikiSourceManager } from "../engines/wiki/index.js";
import { applyWikiProposal, recoverWikiApply, snapshotWiki, validateFrozenWikiProposal, verifyWikiApply, type FrozenWikiProposal } from "../evolution/wiki-workspace.js";
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
export function createEvolutionWikiRoutes(deps: { wikiService: WikiService; wikiMgr: WikiSourceManager }): Hono {
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
  app.post("/validate", async c => { try { const { body, root } = await resolve(c), proposal = body.proposal as FrozenWikiProposal;
    validateFrozenWikiProposal(root, proposal); if (snapshotWiki(root).hash !== proposal.base.hash) throw new Error("WIKI_BASE_STALE");
    return c.json(wrapOk({ valid: true, proposal_hash: proposal.hash, base_hash: proposal.base.hash }));
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
