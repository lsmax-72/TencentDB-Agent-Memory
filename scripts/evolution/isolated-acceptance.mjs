import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [stage, rootArg] = process.argv.slice(2);
assert(['setup', 'verify', 'restart'].includes(stage) && rootArg, 'Usage: node scripts/evolution/isolated-acceptance.mjs setup|verify|restart <NEW absolute output directory>');
const root = resolve(rootArg);
assert(rootArg === root && basename(root).startsWith('evolution-') && root !== repo, 'Dedicated absolute evolution-* path required');
const tag = basename(root); assert(/^[a-z0-9-]+$/.test(tag));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
let settings = stage === 'setup' ? {
  instance: tag, core: `${tag}-core`, hub: `${tag}-hub`, network: tag,
  core_port: Number(process.env.EVOLUTION_TEST_CORE_PORT ?? 24920), hub_port: Number(process.env.EVOLUTION_TEST_HUB_PORT ?? 24725), gateway_key: randomBytes(32).toString('hex'),
  user_key: `sk-mem-${randomBytes(24).toString('hex')}`,
} : read('private/settings.json');
assert([settings.core_port, settings.hub_port].every(port => Number.isInteger(port) && port >= 10000 && port < 65536) && settings.core_port !== settings.hub_port, 'Dedicated non-production ports required');
async function api(path, body = {}, options = {}) {
  const url = options.core ? `http://127.0.0.1:${settings.core_port}/v3${path}` : `http://127.0.0.1:${settings.hub_port}/api/v1${path}`;
  const response = await fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-tdai-service-id': settings.instance,
    'x-tdai-user-key': options.badKey ? 'invalid' : settings.user_key,
    ...(options.core ? { Authorization: `Bearer ${settings.gateway_key}` } : {}),
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (options.error) { assert.equal(result.code, options.error, `${path}: expected denial`); return result; }
  assert.equal(result.code, 0, `${path}: ${result.message ?? result.msg ?? result.code}`);
  return result.data;
}
async function ready(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('ISOLATED_SERVICE_NOT_READY');
}
function snapshotFiles(dir, prefix = '') {
  const result = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, snapshotFiles(join(dir, entry.name), `${key}/`));
    else if (entry.isFile()) result[key] = hash(readFileSync(join(dir, entry.name)));
  }
  return result;
}
if (stage === 'setup') {
  assert(!existsSync(root), 'Do not overwrite historical acceptance');
  for (const name of [settings.core, settings.hub]) assert(!docker('ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'), 'Container exists');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of ['private', 'core-data', 'knowledge-data', 'runtime', 'history']) mkdirSync(join(root, name), { mode: 0o700 });
  save('private/settings.json', settings);
  for (const [source, target] of [['MemoryCore/src', 'core-src'], ['MemoryPanel/dist', 'panel-dist'], ['MemoryPanel/web/dist', 'web-dist']]) {
    assert(existsSync(join(repo, source)), `Build ${source} first`);
    cpSync(join(repo, source), join(root, 'runtime', target), { recursive: true, errorOnExist: true, force: false });
  }
  save('runtime-hashes.json', snapshotFiles(join(root, 'runtime')));
  const images = { core: docker('inspect', 'tdai-memory-core', '--format', '{{.Image}}'), hub: docker('inspect', 'tdai-memory-hub', '--format', '{{.Image}}') };
  save('preflight.json', { images, kind: 'OFFLINE_INTEGRATION_ACCEPTANCE', model_calls: 0, production_mounts: false, ports: [settings.core_port, settings.hub_port] });
  save('private/core.yaml', { deployMode: 'standalone', stateBackend: 'local',
    server: { port: 8420, host: '0.0.0.0', apiKey: settings.gateway_key }, data: { baseDir: '/data/tdai-memory' },
    llm: { baseUrl: '', apiKey: '', model: '' },
    memory: { storeBackend: 'sqlite', embedding: { provider: 'none' }, capture: { enabled: false }, extraction: { enabled: false }, pipeline: { enableWarmup: false, everyNConversations: 1000000 } },
    skill: { enabled: false, extraction: { enabled: false } },
  });
  // Dedicated bridge and loopback publication. Model routes have no configuration or credentials.
  // Docker Desktop does not publish ports on internal-only networks; retain r1 as a failed setup.
  docker('network', 'create', settings.network);
  docker('run', '-d', '--name', settings.core, '--network', settings.network,
    '-p', `127.0.0.1:${settings.core_port}:8420`, '-v', `${root}/core-data:/data/tdai-memory`,
    '-v', `${root}/runtime/core-src:/app/src:ro`, '-v', `${root}/private/core.yaml:/data/config/tdai-gateway.yaml:ro`,
    '-v', `${root}/history:/evolution-history:ro`, '-v', `${root}/private:/evolution-private:ro`,
    '-e', 'TDAI_GATEWAY_API_KEY=', '-e', 'TDAI_DATA_DIR=/data/tdai-memory', images.core);
  await ready(`http://127.0.0.1:${settings.core_port}/health`);
  const user = await api('/internal/meta/user/init-admin', { username: 'evolution-test-admin', user_key: settings.user_key }, { core: true });
  const owner_user_id = user.user_id ?? user.user?.user_id; assert(owner_user_id);
  const team = await api('/meta/team/create', { name: '自进化验收 / TEST ONLY', owner_user_id }, { core: true });
  const agent = await api('/meta/agent/create', { team_id: team.team_id, owner_user_id, name: 'evolution-test-host' }, { core: true });
  const task = await api('/meta/task/create', { team_id: team.team_id, creator_user_id: owner_user_id, title: '离线接口验收（非模型运行）', auto_assign_floating_assets: false, linked_agents: [{ agent_id: agent.agent_id }] }, { core: true });
  save('identity.json', { owner_user_id, team_id: team.team_id, agent_id: agent.agent_id, task_id: task.task_id });
  save('private/metadata-instances.json', { instances: [{ id: settings.instance, name: '自进化隔离验收', gateway_endpoint: `http://${settings.core}:8420`, api_key: settings.gateway_key }] });
  docker('run', '-d', '--name', settings.hub, '--network', settings.network,
    '-p', `127.0.0.1:${settings.hub_port}:8125`, '-v', `${root}/knowledge-data:/data/knowledge`,
    '-v', `${root}/runtime/panel-dist:/app/panel/dist:ro`, '-v', `${root}/runtime/web-dist:/app/panel/web/dist:ro`,
    '-v', `${root}/private/metadata-instances.json:/app/panel/config/metadata-instances.json:ro`,
    '-e', 'KNOWLEDGE_LLM_BINDING_SYNC=0', '-e', 'LLM_MODE=custom', images.hub);
  await ready(`http://127.0.0.1:${settings.hub_port}/health`);
  const source = '/Users/lsmax/Documents/Codex/2026-08-29/n/outputs/phase-5b-candidate-v4/main.json';
  const original = readFileSync(source); writeFileSync(join(root, 'history/v4-main.json'), original, { flag: 'wx', mode: 0o600 });
  const frozen = readFileSync(join(dirname(source), 'freeze.json')); writeFileSync(join(root, 'history/v4-freeze.json'), frozen, { flag: 'wx', mode: 0o600 });
  const dbPaths = docker('exec', settings.core, 'find', '/data/tdai-memory', '-name', 'metadata.db').split('\n').filter(Boolean);
  assert.equal(dbPaths.length, 1, 'Expected only isolated metadata DB');
  save('private/import.json', { database: dbPaths[0], approved_root: '/evolution-history', files: ['/evolution-history/v4-main.json', '/evolution-history/v4-freeze.json'], scope: { team_id: team.team_id, agent_id: agent.agent_id, owner_user_id } });
  const imported = JSON.parse(docker('exec', settings.core, 'node', '--import', 'tsx', '/app/src/evolution/control/import-cli.ts', '/evolution-private/import.json'));
  assert.equal(imported[0].status, 'FAIL'); assert.equal(hash(readFileSync(source)), hash(original));
  save('history-import.json', { records: imported, original_source_hash: hash(original) });
  console.log(`ISOLATED_SETUP_PASS http://127.0.0.1:${settings.hub_port} (not main 8125)`);
}
if (stage === 'verify' || stage === 'restart') {
  if (stage === 'restart') {
    docker('restart', settings.core, settings.hub);
    await ready(`http://127.0.0.1:${settings.core_port}/health`);
    await ready(`http://127.0.0.1:${settings.hub_port}/health`);
  }
  const identity = read('identity.json');
  const scope = { team_id: identity.team_id };
  const overview = await api('/evolution/overview', scope); assert.equal(overview.automation_ready, false);
  const list = await api('/evolution/records/list', { ...scope, kind: 'attempt' });
  assert.equal(list.total, 1); assert.equal(list.items[0].status, 'FAIL');
  const record = await api('/evolution/records/get', { ...scope, id: list.items[0].id });
  assert.equal(record.record.payload.gate.reasons[0].code, 'NO_NEW_FIX');
  await api('/evolution/overview', scope, { badKey: true, error: 401 });
  await api('/evolution/overview', { team_id: 'other-team' }, { error: 403 });
  await api('/evolution/review/decide', { ...scope, id: record.record.id, revision: 1, decision: 'REVIEW_APPROVED', reason: 'cannot approve history' }, { error: 409 });
  await api('/evolution/task/complete', { ...scope, completion: 'model_stopped' }, { error: 400 });
  const grant = { ...scope, agent_id: identity.agent_id, enabled: false, revision: 0, asset_kinds: ['skill', 'memory', 'wiki'], asset_ids: [], daily_tokens: 10000, daily_model_calls: 2, daily_candidates: 1, evaluation_profile_id: null, auto_memory: false, auto_wiki_maintenance: false };
  const profiles = await api('/evolution/profiles/list', scope);
  if (!profiles.items.length) await api('/evolution/profiles/save', grant);
  const current = (await api('/evolution/profiles/list', scope)).items[0];
  await api('/evolution/profiles/save', { ...grant, enabled: true, revision: current.revision }, { error: 409 });
  const assetsBefore = await api('/meta/asset/list', { ...scope }, { core: true });
  const completion = { ...scope, agent_id: identity.agent_id, task_id: identity.task_id, session_id: 'offline-api-session', run_id: 'offline-api-host-receipt',
    completion: 'host_task_complete', asset_ids: [], task_input: 'Offline API acceptance only; no real Agent or model run',
    final_output: 'Host test receipt; not a task success or evolution gain', tool_events: [],
    usage: { input_tokens: null, output_tokens: null, model_calls: 0, tool_calls: 0 }, actual_model: 'NOT_RUN_OFFLINE_ACCEPTANCE', outcome: 'UNKNOWN', used_asset_versions: {},
  };
  const trace = await api('/evolution/task/complete', completion);
  assert.deepEqual(await api('/evolution/task/complete', completion), trace);
  const job = await api('/evolution/diagnosis/request', { ...scope, id: trace.id });
  assert.equal(job.status, 'BLOCKED_AUTOMATION_DISABLED');
  assert.equal((await api('/evolution/records/list', { ...scope, kind: 'job' })).total, 1);
  await api('/evolution/diagnosis/retry', { ...scope, id: job.id, request_id: '../../etc/passwd' }, { error: 400 });
  await api('/evolution/task/complete', { ...completion, final_output: 'conflicting replay' }, { error: 409 });
  assert.deepEqual(await api('/meta/asset/list', { ...scope }, { core: true }), assetsBefore);
  assert.deepEqual(snapshotFiles(join(root, 'runtime')), read('runtime-hashes.json'));
  save(`${stage}-${Date.now()}.json`, { status: 'PASS', model_calls: 0, historical_gate: record.record.payload.gate, cross_team_denied: true, wrong_key_denied: true, history_immutable: true, automation_disabled: true, runtime_unchanged: true,
    explicit_host_receipt: trace.id, duplicate_completion_same_receipt: true, persisted_job: job.id, job_status: job.status, conflicting_replay_denied: true, arbitrary_retry_path_denied: true, formal_assets_unchanged: true });
  console.log(`${stage.toUpperCase()}_PASS; history FAIL preserved; no model call; no formal writes`);
}
