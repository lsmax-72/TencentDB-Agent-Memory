import type { Hono } from 'hono';
import type { PanelDeps } from '../../panel-deps.js';
import { validatePanelMetaHeaders } from '../middleware/validate-panel-headers.js';
import { respondControlError, respondEnvelope } from '../envelope.js';
import { toKernelCredentials } from '../../kernel/types.js';

const ACTIONS = new Set(['overview', 'records/list', 'records/get', 'profiles/list', 'profiles/save', 'task/complete', 'diagnosis/request', 'diagnosis/retry', 'generation/retry', 'review/decide']);

/** Core owns permissions and state; Panel never stores credentials or candidate bodies. */
export function registerEvolutionRoutes(api: Hono, deps: PanelDeps): void {
  api.post('/evolution/*', validatePanelMetaHeaders(deps), async c => {
    const action = c.req.path.split('/evolution/')[1];
    if (!action || !ACTIONS.has(action)) return respondControlError(c, 404, 'UNKNOWN_EVOLUTION_ACTION');
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respondControlError(c, 400, 'INVALID_EVOLUTION_REQUEST');
    const ctx = c.get('panelMeta');
    const result = await deps.kernelHttp.postEnvelope(`/v3/evolution/${action}`, body, toKernelCredentials({
      instanceId: ctx.instanceId, gatewayEndpoint: ctx.gatewayEndpoint,
      gatewayApiKey: ctx.gatewayApiKey, userKey: ctx.userKey, reqId: c.get('reqId'),
    }, { timeoutMs: deps.config.metadataRemoteTimeoutMs }));
    return respondEnvelope(c, result);
  });
}
