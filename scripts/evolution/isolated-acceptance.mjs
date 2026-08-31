import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [stage, rootArg] = process.argv.slice(2);
assert(['setup', 'verify', 'restart', 'governance', 'validation'].includes(stage) && rootArg, 'Usage: node scripts/evolution/isolated-acceptance.mjs setup|verify|restart|governance|validation <NEW absolute output directory>');
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
  const list = await api('/evolution/records/list', { ...scope, kind: 'attempt', origin: 'historical' });
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
  assert.equal((await api('/evolution/records/list', { ...scope, kind: 'job' })).items.filter(item => item.payload.job_type === 'diagnosis' && item.payload.source_id === trace.id).length, 1);
  await api('/evolution/diagnosis/retry', { ...scope, id: job.id, request_id: '../../etc/passwd' }, { error: 400 });
  await api('/evolution/task/complete', { ...completion, final_output: 'conflicting replay' }, { error: 409 });
  assert.deepEqual(await api('/meta/asset/list', { ...scope }, { core: true }), assetsBefore);
  assert.deepEqual(snapshotFiles(join(root, 'runtime')), read('runtime-hashes.json'));
  save(`${stage}-${Date.now()}.json`, { status: 'PASS', model_calls: 0, historical_gate: record.record.payload.gate, cross_team_denied: true, wrong_key_denied: true, history_immutable: true, automation_disabled: true, runtime_unchanged: true,
    explicit_host_receipt: trace.id, duplicate_completion_same_receipt: true, persisted_job: job.id, job_status: job.status, conflicting_replay_denied: true, arbitrary_retry_path_denied: true, formal_assets_unchanged: true });
  console.log(`${stage.toUpperCase()}_PASS; history FAIL preserved; no model call; no formal writes`);
}
if (stage === 'governance') {
  // This operator-only fixture is never an HTTP admission bypass. The isolated
  // Core has no model configuration and keeps automation admission disabled.
  const preflight = read('preflight.json');
  assert.equal(preflight.production_mounts, false);
  const config = read('private/core.yaml');
  assert.equal(config.llm.baseUrl, ''); assert.equal(config.llm.apiKey, '');
  const identity = read('identity.json');
  const scope = { team_id: identity.team_id, agent_id: identity.agent_id, user_id: identity.owner_user_id, session_id: 'offline-guard-check' };
  const original = (await api('/evolution/profiles/list', scope)).items[0];
  assert(original && original.enabled === false, 'Run verify first; require disabled original profile');
  const before = await api('/meta/asset/list', scope, { core: true });
  const seed = enabled => execFileSync('docker', ['exec', '-i', settings.core, 'node', '--import', 'tsx', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    import { EvolutionStore } from '/app/src/evolution/control/store.ts';
    import { resolveSqliteDbPath } from '/app/src/metadata/store/db-name.ts';
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const db = new DatabaseSync(resolveSqliteDbPath('/data/tdai-memory/metadata', input.instance));
    try { const store = new EvolutionStore(db); const profile = store.profile(input.team_id, input.agent_id);
      if (!profile) throw new Error('Test profile missing');
      const {revision, updated_at, ...fields} = profile;
      store.saveProfile({...fields, enabled: input.enabled}, revision);
    } finally { db.close(); }
  `], { input: JSON.stringify({ instance: settings.instance, team_id: scope.team_id, agent_id: scope.agent_id, enabled }), encoding: 'utf8' });
  const denied = [];
  try {
    seed(true);
    for (const [path, body] of [['/scenario/write', { path: 'offline.md', content: 'must not be written' }], ['/scenario/rm', { path: 'offline.md' }], ['/core/write', { content: 'must not be written' }]]) {
      const result = await api(path, { ...scope, ...body }, { core: true, error: 409 });
      assert.match(result.message, /EVOLUTION_TASK_COMPLETE_REQUIRED/); denied.push(path);
    }
    assert.equal((await api('/evolution/overview', scope)).automation_ready, false);
  } finally { seed(false); }
  assert.equal((await api('/evolution/profiles/list', scope)).items[0].enabled, false);
  assert.deepEqual(await api('/meta/asset/list', scope, { core: true }), before);
  assert.deepEqual(snapshotFiles(join(root, 'runtime')), read('runtime-hashes.json'));
  save(`governance-${Date.now()}.json`, { status: 'PASS', origin: 'OFFLINE_OPERATOR_PROFILE_FIXTURE', model_calls: 0, denied, profile_restored_disabled: true, official_assets_unchanged: true, automation_admission_disabled: true });
  console.log('GOVERNANCE_PASS; cross-instance legacy routes blocked; profile restored disabled; no model calls');
}
if (stage === 'validation') {
  assert.equal(read('preflight.json').production_mounts, false);
  assert.equal(read('private/core.yaml').llm.apiKey, '');
  const identity = read('identity.json'), scope = { team_id: identity.team_id };
  const assetsBefore = await api('/meta/asset/list', scope, { core: true });
  const seed = execFileSync('docker', ['exec', '-i', settings.core, 'node', '--import', 'tsx', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { SqliteMetadataStore } from '/app/src/metadata/store/sqlite-adapter.ts';
    import { resolveSqliteDbPath } from '/app/src/metadata/store/db-name.ts';
    import { contentHash } from '/app/src/evolution/control/store.ts';
    import { localMemorySnapshot } from '/app/src/evolution/control/memory-snapshot.ts';
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const metadata = new SqliteMetadataStore(resolveSqliteDbPath('/data/tdai-memory/metadata', input.instance)); metadata.init();
    try {
      const store = metadata.getEvolutionStore(), trace = store.list(input.team_id, 'trace').find(row => row.payload.run_id === 'offline-api-host-receipt');
      if (!trace) throw new Error('Run verify first');
      const asset = metadata.listAssetsByTeam(input.team_id).items.find(row => row.asset_type === 'chat_memory' && row.asset_id.endsWith(input.agent_id));
      if (!asset) throw new Error('Native Agent memory asset missing');
      const base = { team_id: input.team_id, agent_id: input.agent_id, owner_user_id: input.owner_user_id, asset_ids: [asset.asset_id], origin: 'runtime' };
      const diagnosis = store.append({ ...base, kind: 'diagnosis', status: 'DIAGNOSED', parent_id: trace.id, title: '[OFFLINE FIXTURE] 人工构造的校验来源，未运行复盘模型',
        payload: { evidence_mode: 'offline_test', route: 'memory_gap', evidence: [{ record_id: trace.id, observation: 'API fixture, not real task' }] } }, 'validation-fixture/diagnosis', input.owner_user_id);
      // New isolated instance has no L1 content. The live validator independently checks the actual store.
      const snapshot = await localMemorySnapshot('/data/tdai-memory', async () => ({ queryL1Records: async () => [] }))({ team_id: input.team_id, agent_id: input.agent_id, user_id: input.owner_user_id });
      const source = store.append({ ...base, kind: 'trace', status: 'SNAPSHOT', parent_id: diagnosis.id, title: '[OFFLINE FIXTURE] 空白测试 Memory 快照',
        payload: { evidence_mode: 'offline_test', evidence_type: 'memory_snapshot', target_id: asset.asset_id, snapshot_hash: snapshot.hash, snapshot } }, 'validation-fixture/snapshot', input.owner_user_id);
      const text = '这是一条离线界面校验测试事实，不代表真实业务记忆。';
      const candidate = store.append({ ...base, kind: 'candidate', status: 'FROZEN', parent_id: diagnosis.id, title: '[OFFLINE FIXTURE] Memory L1 校验/审查测试，禁止当成效果证据',
        payload: { evidence_mode: 'offline_test', asset_kind: 'memory', layer: 'L1', operation: 'create', target_id: asset.asset_id,
          base_hash: contentHash(''), base_version: null, before: '', after: text, source_record_ids: [diagnosis.id, source.id],
          target_snapshot_id: source.id, target_snapshot_hash: snapshot.hash, extracted_memory: { content: text, source_message_ids: [trace.id + ':input'] } } }, 'validation-fixture/candidate', input.owner_user_id);
      console.log(JSON.stringify({ candidate_id: candidate.id }));
    } finally { metadata.close(); }
  `], { input: JSON.stringify({ ...identity, instance: settings.instance }), encoding: 'utf8' });
  const { candidate_id } = JSON.parse(seed);
  await api('/evolution/validation/request', { ...scope, id: candidate_id, command: 'touch /tmp/not-allowed' }, { error: 400 });
  const requests = await Promise.all([api('/evolution/validation/request', { ...scope, id: candidate_id }), api('/evolution/validation/request', { ...scope, id: candidate_id })]);
  assert.equal(requests[0].id, requests[1].id);
  let detail;
  for (let i = 0; i < 20; i++) {
    detail = await api('/evolution/records/get', { ...scope, id: candidate_id });
    if (detail.record.status !== 'FROZEN') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(detail.record.status, 'VALIDATED');
  const receipt = detail.related.find(item => item.kind === 'attempt');
  assert(receipt); assert.equal(receipt.payload.attempt_type, 'content_validation'); assert.equal(receipt.payload.result, 'PASS');
  assert.equal(receipt.payload.auto_eligible, false); assert.equal(receipt.payload.demonstrates_improvement, false); assert.equal(receipt.payload.model_calls, 0);
  const review = { ...scope, id: candidate_id, revision: detail.record.revision, decision: 'REVIEW_APPROVED', reason: 'OFFLINE TEST ONLY: native review API, no formal adoption requested' };
  await api('/evolution/review/decide', review);
  await api('/evolution/review/decide', review, { error: 409 });
  assert.equal((await api('/evolution/records/list', { ...scope, kind: 'adoption' })).total, 0);
  assert.deepEqual(await api('/meta/asset/list', scope, { core: true }), assetsBefore);
  assert.equal((await api('/evolution/overview', scope)).automation_ready, false);
  assert.deepEqual(snapshotFiles(join(root, 'runtime')), read('runtime-hashes.json'));
  save(`validation-${Date.now()}.json`, { status: 'PASS', origin: 'OFFLINE_OPERATOR_CANDIDATE_FIXTURE', model_calls: 0, candidate_id, validation_id: receipt.id,
    independent_live_source_check: true, duplicate_request_same_job: true, review_is_not_adoption: true, stale_double_review_denied: true,
    arbitrary_command_denied: true, official_assets_unchanged: true, no_improvement_claim: true, automation_admission_disabled: true });
  console.log('VALIDATION_PASS; offline fixture; live source checks; review is not adoption; zero models/formal writes');
}
