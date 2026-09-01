import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [stage, rootArg] = process.argv.slice(2);
assert(['setup', 'verify', 'restart', 'governance', 'validation', 'full'].includes(stage) && rootArg, 'Usage: node scripts/evolution/isolated-acceptance.mjs setup|verify|restart|governance|validation|full <NEW absolute output directory>');
const root = resolve(rootArg);
assert(rootArg === root && basename(root).startsWith('evolution-') && root !== repo, 'Dedicated absolute evolution-* path required');
const tag = basename(root); assert(/^[a-z0-9-]+$/.test(tag));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
let settings = stage === 'setup' ? {
  instance: tag, core: `${tag}-core`, hub: `${tag}-hub`, model: `${tag}-offline-model`, network: tag,
  core_port: Number(process.env.EVOLUTION_TEST_CORE_PORT ?? 24920), hub_port: Number(process.env.EVOLUTION_TEST_HUB_PORT ?? 24725), gateway_key: randomBytes(32).toString('hex'),
  user_key: `sk-mem-${randomBytes(24).toString('hex')}`, internal_token: randomBytes(32).toString('hex'),
  exact_fact: '本次隔离验收只记录一条可逐字核验的项目事实。',
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
  for (let i = 0; i < 80; i++) {
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
  for (const name of [settings.core, settings.hub, settings.model]) assert(!docker('ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'), 'Container exists');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of ['private', 'core-data', 'knowledge-data', 'runtime', 'history']) mkdirSync(join(root, name), { mode: 0o700 });
  save('private/settings.json', settings);
  for (const [source, target] of [['MemoryCore/src', 'core-src'], ['MemoryPanel/dist', 'panel-dist'], ['MemoryPanel/web/dist', 'web-dist'], ['MemoryKnowledge/dist', 'knowledge-dist']]) {
    assert(existsSync(join(repo, source)), `Build ${source} first`);
    cpSync(join(repo, source), join(root, 'runtime', target), { recursive: true, errorOnExist: true, force: false });
  }
  cpSync(join(repo, 'scripts/evolution/offline-openai-fixture.mjs'), join(root, 'runtime/offline-openai-fixture.mjs'), { errorOnExist: true, force: false });
  save('runtime-hashes.json', snapshotFiles(join(root, 'runtime')));
  const images = { core: docker('inspect', 'tdai-memory-core', '--format', '{{.Image}}'), hub: docker('inspect', 'tdai-memory-hub', '--format', '{{.Image}}') };
  save('preflight.json', { images, kind: 'OFFLINE_INTEGRATION_ACCEPTANCE', model_calls: 0, production_mounts: false,
    automation_admitted: true, model_fixture: 'DETERMINISTIC_OFFLINE_OPENAI_COMPATIBLE', ports: [settings.core_port, settings.hub_port] });
  save('private/core.yaml', { deployMode: 'standalone', stateBackend: 'local',
    server: { port: 8420, host: '0.0.0.0', apiKey: settings.gateway_key }, data: { baseDir: '/data/tdai-memory' },
    llm: { baseUrl: '', apiKey: '', model: '' },
    memory: { storeBackend: 'sqlite', embedding: { provider: 'none' }, capture: { enabled: false }, extraction: { enabled: false }, pipeline: { enableWarmup: false, everyNConversations: 1000000 } },
    skill: { enabled: true, extraction: { enabled: false } },
  });
  // Dedicated bridge and loopback publication. Model routes have no configuration or credentials.
  // Docker Desktop does not publish ports on internal-only networks; retain r1 as a failed setup.
  docker('network', 'create', settings.network);
  docker('run', '-d', '--name', settings.model, '--network', settings.network, '--no-healthcheck', '--entrypoint', 'node',
    '-v', `${root}/runtime/offline-openai-fixture.mjs:/fixture.mjs:ro`, '-e', 'PORT=18080', '-e', 'MODEL_ID=offline-evolution-review',
    '-e', `EXACT_FACT=${settings.exact_fact}`, images.core, '/fixture.mjs');
  docker('run', '-d', '--name', settings.core, '--network', settings.network,
    '-p', `127.0.0.1:${settings.core_port}:8420`, '-v', `${root}/core-data:/data/tdai-memory`,
    '-v', `${root}/runtime/core-src:/app/src:ro`, '-v', `${root}/private/core.yaml:/data/config/tdai-gateway.yaml:ro`,
    '-v', `${root}/history:/evolution-history:ro`, '-v', `${root}/private:/evolution-private:ro`,
    '-e', 'TDAI_GATEWAY_API_KEY=', '-e', 'TDAI_DATA_DIR=/data/tdai-memory',
    '-e', 'EVOLUTION_AUTOMATION_ADMITTED=1', '-e', 'EVOLUTION_REVIEW_MODELS_FILE=/evolution-private/review-models.json',
    '-e', 'EVOLUTION_EVALUATION_PROFILES_FILE=/evolution-private/evaluation-profiles.json',
    '-e', `EVOLUTION_KNOWLEDGE_URL=http://${settings.hub}:8424`, '-e', `EVOLUTION_INTERNAL_TOKEN=${settings.internal_token}`, images.core);
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
    '-v', `${root}/runtime/knowledge-dist:/app/knowledge/dist:ro`,
    '-v', `${root}/private/metadata-instances.json:/app/panel/config/metadata-instances.json:ro`,
    '-e', 'KNOWLEDGE_LLM_BINDING_SYNC=0', '-e', 'LLM_MODE=custom', '-e', `EVOLUTION_INTERNAL_TOKEN=${settings.internal_token}`, images.hub);
  await ready(`http://127.0.0.1:${settings.hub_port}/health`);
  const skill = await api('/skill/create', { team_id: team.team_id, agent_id: agent.agent_id, user_id: owner_user_id, task_id: task.task_id,
    name: 'workspace', content: '---\nname: workspace\ndescription: General workspace editing discipline for isolated acceptance.\n---\n\n# Workspace hygiene\n\nRead the target, make the requested change, and verify the result.\n' }, { core: true });
  const wiki = await api('/knowledge/wiki/create', { team_id: team.team_id, name: '自进化 Wiki 验收 / TEST ONLY' });
  await api('/knowledge/wiki/raw/write', { team_id: team.team_id, wiki_id: wiki.wiki_id,
    files: [{ filename: 'source.md', content: '# 可信测试材料\n\n这是隔离实例的离线验收材料，不代表生产知识。\n' }] });
  await api('/knowledge/allocate', { team_id: team.team_id, agent_id: agent.agent_id, knowledge_id: wiki.wiki_id });
  const memoryAssets = (await api('/meta/asset/list', { team_id: team.team_id }, { core: true })).items.filter(item => item.asset_type === 'chat_memory');
  assert.equal(memoryAssets.length, 1, 'Expected the Agent native chat-memory asset');
  save('assets.json', { memory_id: memoryAssets[0].asset_id, skill_id: skill.skill_id, wiki_id: wiki.wiki_id });
  save('private/review-models.json', [{ id: 'offline-review', instance_id: settings.instance, team_id: team.team_id, agent_id: agent.agent_id,
    config: { provider: 'openai-compatible', model: 'offline-evolution-review', base_url: `http://${settings.model}:18080/v1`, api_key: 'offline-fixture-only',
      max_output_tokens: 2048, token_ceiling: 65536, timeout_ms: 5000, temperature: 0, fallback: false } }]);
  save('private/evaluation-profiles.json', [{ id: 'offline-blocked-evaluator', instance_id: settings.instance, team_id: team.team_id, agent_id: agent.agent_id,
    suite_kind: 'AC_REGRESSION_V1', python_executable: '/not-configured/python', nanobot_repo: '/not-configured/nanobot', nanobot_config: '/not-configured/config.json',
    model_preset: 'offline-blocked', provider: 'vllm', model_id: 'qwen3.8-27b' }]);
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
  const admitted = Boolean(read('preflight.json').automation_admitted);
  const overview = await api('/evolution/overview', scope); assert.equal(overview.automation_ready, admitted);
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
  if (!admitted) await api('/evolution/profiles/save', { ...grant, enabled: true, revision: current.revision }, { error: 409 });
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
  save(`${stage}-${Date.now()}.json`, { status: 'PASS', model_calls: 0, historical_gate: record.record.payload.gate, cross_team_denied: true, wrong_key_denied: true, history_immutable: true, automation_admitted: admitted, runtime_unchanged: true,
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
if (stage === 'full') {
  const preflight = read('preflight.json');
  assert.equal(preflight.production_mounts, false); assert.equal(preflight.automation_admitted, true);
  assert.equal(preflight.model_fixture, 'DETERMINISTIC_OFFLINE_OPENAI_COMPATIBLE');
  const identity = read('identity.json'), assets = read('assets.json'), scope = { team_id: identity.team_id };
  const waitFor = async (predicate, message, attempts = 80) => {
    for (let i = 0; i < attempts; i++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
    throw new Error(message);
  };
  const options = await api('/evolution/profiles/options', { ...scope, agent_id: identity.agent_id });
  assert.equal(options.automation_ready, true); assert.deepEqual(options.review_model_ids, ['offline-review']);
  assert.deepEqual(options.evaluation_profile_ids, ['offline-blocked-evaluator']);
  assert.deepEqual(new Set(options.assets.map(item => item.id)), new Set([assets.memory_id, assets.skill_id, assets.wiki_id]));
  assert.equal(options.assets.some(item => item.asset_kind === 'code_graph'), false);
  const previous = (await api('/evolution/profiles/list', scope)).items[0];
  const profile = await api('/evolution/profiles/save', { ...scope, agent_id: identity.agent_id, enabled: true, revision: previous?.revision ?? 0,
    asset_kinds: ['skill', 'memory', 'wiki'], asset_ids: [assets.memory_id, assets.skill_id, assets.wiki_id],
    daily_tokens: 1000000, daily_model_calls: 50, daily_candidates: 20, evaluation_profile_id: 'offline-blocked-evaluator',
    review_model_id: 'offline-review', auto_memory: true, auto_wiki_maintenance: false });
  assert.equal(profile.enabled, true);

  const completion = { ...scope, agent_id: identity.agent_id, task_id: identity.task_id, session_id: 'full-offline-session', run_id: 'full-offline-run',
    completion: 'host_task_complete', asset_ids: [], task_input: settings.exact_fact,
    final_output: 'OFFLINE FIXTURE：宿主任务已明确完成，仅验证治理工程闭环。', tool_events: [],
    usage: { input_tokens: null, output_tokens: null, model_calls: 0, tool_calls: 0 }, actual_model: 'HOST_NOT_MODELLED_OFFLINE_FIXTURE', outcome: 'PASS', used_asset_versions: {},
  };
  const trace = await api('/evolution/task/complete', completion);
  assert.deepEqual(await api('/evolution/task/complete', completion), trace);
  const memoryCandidate = await waitFor(async () => {
    const items = (await api('/evolution/records/list', { ...scope, kind: 'candidate', asset_kind: 'memory' })).items;
    return items.find(item => item.parent_id && item.payload.after === settings.exact_fact && ['AUTO_AUTHORIZED', 'APPLIED'].includes(item.status));
  }, 'Memory candidate was not auto-authorized or applied');
  const memoryAdoption = await waitFor(async () => {
    const items = (await api('/evolution/records/list', { ...scope, kind: 'adoption' })).items;
    return items.find(item => item.parent_id === memoryCandidate.id && item.status === 'APPLIED');
  }, 'Memory candidate was not applied');
  const memoryMatches = Number(docker('exec', settings.core, 'sh', '-lc', `grep -R -F -- '${settings.exact_fact}' /data/tdai-memory 2>/dev/null | wc -l`));
  assert(memoryMatches >= 1, 'Applied Memory bytes missing');

  const runGovernedMemoryLayer = async (layer, suffix) => {
    const beforeIds = new Set((await api('/evolution/records/list', { ...scope, kind: 'candidate', asset_kind: 'memory' })).items.map(item => item.id));
    const nextCompletion = { ...completion, session_id: `full-offline-session-${suffix}`, run_id: `full-offline-run-${suffix}` };
    const nextTrace = await api('/evolution/task/complete', nextCompletion);
    assert.deepEqual(await api('/evolution/task/complete', nextCompletion), nextTrace);
    const candidate = await waitFor(async () => {
      const items = (await api('/evolution/records/list', { ...scope, kind: 'candidate', asset_kind: 'memory' })).items;
      return items.find(item => !beforeIds.has(item.id) && item.payload.layer === layer && item.status === 'VALIDATED');
    }, `${layer} Memory candidate was not generated and validated`);
    const approved = await api('/evolution/review/decide', { ...scope, id: candidate.id, revision: candidate.revision,
      decision: 'REVIEW_APPROVED', reason: `OFFLINE FIXTURE：核对 ${layer} 冻结差异、来源与作用域后批准隔离采用。` });
    const adoption = await api('/evolution/adoption/apply', { ...scope, id: approved.id, revision: approved.revision });
    assert.equal(adoption.status, 'APPLIED');
    return { trace: nextTrace, candidate, adoption };
  };
  // L2 consumes only the already adopted formal L1 snapshot. L3 is not eligible until L2 itself is adopted.
  const memoryL2 = await runGovernedMemoryLayer('L2', 'l2');
  const l2Matches = Number(docker('exec', settings.core, 'sh', '-lc', "grep -R -F -- '用户持续整理项目事实与工程证据' /data/tdai-memory 2>/dev/null | wc -l"));
  assert(l2Matches >= 1, 'Applied L2 scene bytes missing');
  const memoryL3 = await runGovernedMemoryLayer('L3', 'l3');
  const l3Matches = Number(docker('exec', settings.core, 'sh', '-lc', "grep -R -F -- '隔离验收核心记忆' /data/tdai-memory 2>/dev/null | wc -l"));
  assert(l3Matches >= 1, 'Applied L3 persona bytes missing');

  const internal = async (path, body) => {
    const output = execFileSync('docker', ['exec', '-i', settings.core, 'node', '--input-type=module', '-e', `
      const input = JSON.parse(await new Response(process.stdin).text());
      const response = await fetch(input.url, {method:'POST', headers:{'content-type':'application/json','authorization':'Bearer '+input.token,'x-tdai-service-id':input.service}, body:JSON.stringify(input.body)});
      const result = await response.json(); if (!response.ok || result.code !== 0) throw new Error(JSON.stringify(result)); console.log(JSON.stringify(result.data));
    `], { input: JSON.stringify({ url: `http://${settings.hub}:8424/v3/internal/evolution/wiki/${path}`, token: settings.internal_token,
      service: settings.instance, body }), encoding: 'utf8' });
    return JSON.parse(output);
  };
  const wikiBase = await internal('snapshot', { team_id: identity.team_id, wiki_id: assets.wiki_id });
  const wikiPage = `---\ntitle: 隔离自进化验收\nsources:\n  - source.md\n---\n\n这是一条隔离实例的冻结 Wiki 候选，只用于验证采用链路。\n`;
  const wikiPayload = { revision: 1, base: wikiBase, files: [{ path: 'wiki/evolution-acceptance.md', before: null, after: Buffer.from(wikiPage).toString('base64') }],
    source_paths: ['raw/sources/source.md'] };
  const wikiProposal = { ...wikiPayload, hash: hash(JSON.stringify(wikiPayload)) };
  const seedCandidate = input => JSON.parse(execFileSync('docker', ['exec', '-i', settings.core, 'node', '--import', 'tsx', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs'; import { SqliteMetadataStore } from '/app/src/metadata/store/sqlite-adapter.ts';
    import { resolveSqliteDbPath } from '/app/src/metadata/store/db-name.ts'; import { contentHash } from '/app/src/evolution/control/store.ts';
    const input=JSON.parse(readFileSync(0,'utf8')); const metadata=new SqliteMetadataStore(resolveSqliteDbPath('/data/tdai-memory/metadata',input.instance)); metadata.init();
    try { const store=metadata.getEvolutionStore(), source=store.get(input.source_id); if(!source) throw new Error('source missing');
      const record=store.append({team_id:input.team_id,agent_id:input.agent_id,owner_user_id:input.owner_user_id,asset_ids:[input.target_id],parent_id:source.id,
        kind:'candidate',origin:'runtime',status:'FROZEN',title:input.title,payload:{...input.payload,base_hash:contentHash(input.payload.before)}},input.key,input.owner_user_id);
      console.log(JSON.stringify(record)); } finally { metadata.close(); }
  `], { input: JSON.stringify({ ...input, instance: settings.instance, ...identity }), encoding: 'utf8' }));
  const wikiCandidate = seedCandidate({ source_id: trace.id, target_id: assets.wiki_id, key: 'full-e2e/wiki-candidate', title: '[OFFLINE FIXTURE] 冻结 Wiki 采用验收',
    payload: { asset_kind: 'wiki', target_id: assets.wiki_id, operation: 'update', base_version: null, before: JSON.stringify(wikiBase),
      after: JSON.stringify(wikiProposal.files), source_record_ids: [trace.id], wiki_proposal: wikiProposal } });
  await api('/evolution/validation/request', { ...scope, id: wikiCandidate.id });
  const validatedWiki = await waitFor(async () => { const record = (await api('/evolution/records/get', { ...scope, id: wikiCandidate.id })).record; return record.status === 'VALIDATED' ? record : null; }, 'Wiki validation did not pass');
  const approvedWiki = await api('/evolution/review/decide', { ...scope, id: validatedWiki.id, revision: validatedWiki.revision,
    decision: 'REVIEW_APPROVED', reason: 'OFFLINE FIXTURE：核对冻结来源、差异和目标后批准隔离采用。' });
  const wikiAdoption = await api('/evolution/adoption/apply', { ...scope, id: approvedWiki.id, revision: approvedWiki.revision });
  assert.equal(wikiAdoption.status, 'APPLIED');
  assert.deepEqual(await api('/evolution/adoption/apply', { ...scope, id: approvedWiki.id, revision: approvedWiki.revision }), wikiAdoption);
  const wikiRead = await api('/knowledge/wiki/page/read', { wiki_id: assets.wiki_id, refs: ['evolution-acceptance'] });
  assert.match(JSON.stringify(wikiRead), /冻结 Wiki 候选/);

  const officialSkill = await api('/skill/get', { team_id: identity.team_id, agent_id: identity.agent_id, user_id: identity.owner_user_id,
    skill_id: assets.skill_id, include_content: true, include_manifest: true }, { core: true });
  const skillAfter = `${officialSkill.content}\nDo not treat benchmark-specific answers as reusable rules.\n`;
  const skillContentHash = `sha256:${hash(skillAfter)}`;
  const artifact = { candidate_id: 'full-offline-skill-candidate', operation: 'UPDATE', skill_id: assets.skill_id, base_version: officialSkill.version,
    content: skillAfter, content_hash: skillContentHash,
    artifact_hash: `sha256:${hash(JSON.stringify({ skill_id: assets.skill_id, base_version: officialSkill.version, content_hash: skillContentHash, format: 'SKILL_MD_V1' }))}`,
    source: { user_id: identity.owner_user_id, team_id: identity.team_id, agent_id: identity.agent_id, task_id: identity.task_id }, created_at: new Date().toISOString() };
  const skillCandidate = seedCandidate({ source_id: trace.id, target_id: assets.skill_id, key: 'full-e2e/skill-candidate', title: '[OFFLINE FIXTURE] Skill 评测阻塞验收',
    payload: { asset_kind: 'skill', target_id: assets.skill_id, operation: 'update', base_version: officialSkill.version, before: officialSkill.content,
      after: skillAfter, source_record_ids: [trace.id], skill_artifact: artifact } });
  await api('/evolution/validation/request', { ...scope, id: skillCandidate.id });
  const needsEffect = await waitFor(async () => { const record = (await api('/evolution/records/get', { ...scope, id: skillCandidate.id })).record; return record.status === 'NEEDS_EVIDENCE' ? record : null; }, 'Skill content validation did not require effect evidence');
  const evalJob = await api('/evolution/evaluation/request', { ...scope, id: needsEffect.id });
  assert.equal(evalJob.status, 'BLOCKED_EVALUATOR_CONFIGURATION');
  await api('/evolution/review/decide', { ...scope, id: needsEffect.id, revision: needsEffect.revision, decision: 'REVIEW_APPROVED', reason: 'must remain blocked' }, { error: 409 });
  const skillReadback = await api('/skill/get', { team_id: identity.team_id, agent_id: identity.agent_id, user_id: identity.owner_user_id,
    skill_id: assets.skill_id, include_content: true }, { core: true });
  assert.equal(skillReadback.version, officialSkill.version); assert.equal(skillReadback.content, officialSkill.content);
  await api('/evolution/adoption/apply', { ...scope, id: needsEffect.id, revision: needsEffect.revision }, { error: 409 });

  docker('restart', settings.model);
  docker('restart', settings.hub); await ready(`http://127.0.0.1:${settings.hub_port}/health`);
  docker('restart', settings.core); await ready(`http://127.0.0.1:${settings.core_port}/health`);
  assert.equal((await api('/evolution/profiles/list', scope)).items[0].enabled, true);
  assert.match(JSON.stringify(await api('/knowledge/wiki/page/read', { wiki_id: assets.wiki_id, refs: ['evolution-acceptance'] })), /冻结 Wiki 候选/);
  assert.equal((await api('/evolution/records/get', { ...scope, id: memoryAdoption.id })).record.status, 'APPLIED');
  assert.equal((await api('/evolution/records/get', { ...scope, id: memoryL2.adoption.id })).record.status, 'APPLIED');
  assert.equal((await api('/evolution/records/get', { ...scope, id: memoryL3.adoption.id })).record.status, 'APPLIED');
  assert.equal((await api('/evolution/records/get', { ...scope, id: wikiAdoption.id })).record.status, 'APPLIED');
  const historical = await api('/evolution/records/list', { ...scope, kind: 'attempt', origin: 'historical' });
  assert.equal(historical.total, 1); assert.equal(historical.items[0].status, 'FAIL');
  assert.deepEqual(snapshotFiles(join(root, 'runtime')), read('runtime-hashes.json'));
  save(`full-${Date.now()}.json`, { status: 'PASS', origin: 'DETERMINISTIC_OFFLINE_INTEGRATION_FIXTURE', real_llm_effect: false,
    trace_id: trace.id, duplicate_task_receipt: true, memory: { candidate_id: memoryCandidate.id, adoption_id: memoryAdoption.id, exact_fact_readback: true },
    higher_memory: { l2: { trace_id: memoryL2.trace.id, candidate_id: memoryL2.candidate.id, adoption_id: memoryL2.adoption.id, scene_readback: true },
      l3: { trace_id: memoryL3.trace.id, candidate_id: memoryL3.candidate.id, adoption_id: memoryL3.adoption.id, persona_readback: true },
      task_complete_generation: true, frozen_before_review: true, sequential_formal_snapshot_dependency: true },
    wiki: { candidate_id: wikiCandidate.id, adoption_id: wikiAdoption.id, frozen_apply_and_index_readback: true, double_apply_idempotent: true },
    skill: { candidate_id: skillCandidate.id, evaluation_job_id: evalJob.id, evaluation_status: evalJob.status, formal_version_unchanged: true, adoption_blocked: true },
    restart_readback: true, historical_v4_fail_preserved: true, code_graph_unchanged: true });
  console.log('FULL_OFFLINE_E2E_PASS; Memory L1/L2/L3 applied, Wiki applied, Skill blocked without effect proof, history preserved');
}
