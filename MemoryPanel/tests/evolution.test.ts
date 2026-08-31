import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { InstanceRegistry } from '../src/panel/config/instance-registry.js';
import type { PanelDeps } from '../src/panel/panel-deps.js';
import { registerEvolutionRoutes } from '../src/panel/http/routes/evolution.js';

function setup() {
  const postEnvelope = vi.fn().mockResolvedValue({ code: 0, message: 'OK', request_id: 'test', data: { records: 0 } });
  const deps = { instanceRegistry: new InstanceRegistry([{ instance_id: 'test', name: 'test', gateway_endpoint: 'http://127.0.0.1:9999', api_key: 'gateway-secret' }]), kernelHttp: { postEnvelope }, config: { metadataRemoteTimeoutMs: 1000 } } as unknown as PanelDeps;
  const api = new Hono(); registerEvolutionRoutes(api, deps);
  return { api, postEnvelope };
}
const headers = { 'content-type': 'application/json', 'X-Tdai-Service-Id': 'test', 'X-Tdai-User-Key': 'user-secret' };
describe('evolution proxy', () => {
  it('forwards identity and an allowlisted path to Core, not the client-supplied endpoint', async () => {
    const { api, postEnvelope } = setup();
    const response = await api.request('/evolution/overview', { method: 'POST', headers, body: JSON.stringify({ team_id: 'team' }) });
    expect(response.status).toBe(200);
    expect(postEnvelope.mock.calls[0]?.[0]).toBe('/v3/evolution/overview');
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('requires a user key even for read operations', async () => {
    const { api, postEnvelope } = setup();
    const response = await api.request('/evolution/overview', { method: 'POST', headers: { 'X-Tdai-Service-Id': 'test' }, body: '{}' });
    expect(response.status).toBe(400); expect(postEnvelope).not.toHaveBeenCalled();
  });
  it('rejects arbitrary execution and malformed bodies', async () => {
    const { api, postEnvelope } = setup();
    expect((await api.request('/evolution/exec', { method: 'POST', headers, body: '{}' })).status).toBe(404);
    expect((await api.request('/evolution/overview', { method: 'POST', headers, body: '[]' })).status).toBe(400);
    expect(postEnvelope).not.toHaveBeenCalled();
  });
});
