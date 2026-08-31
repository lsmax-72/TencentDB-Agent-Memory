// Preview a new build at an already authorized test origin without modifying its frozen runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [action, rootArg, sourceArg] = process.argv.slice(2);
assert(['start', 'restore'].includes(action) && rootArg, 'start <NEW absolute evolution-browser-* directory> <existing isolated acceptance directory> | restore <preview directory>');
const root = resolve(rootArg);
const tag = basename(root);
assert(root === rootArg && /^evolution-browser-[a-z0-9-]+$/.test(tag));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const save = (name, data) => writeFileSync(join(root, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(path) {
  return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const full = join(entry.parentPath, entry.name);
    return [full.slice(path.length + 1), hash(readFileSync(full))];
  }));
}
async function ready(port) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('PREVIEW_NOT_READY');
}
if (action === 'start') {
  assert(sourceArg && sourceArg === resolve(sourceArg));
  const source = resolve(sourceArg);
  assert(/^evolution-hub-[a-z0-9-]+$/.test(basename(source)) && !existsSync(root));
  const settings = JSON.parse(readFileSync(join(source, 'private/settings.json'), 'utf8'));
  assert(settings.instance === basename(source) && settings.hub === `${basename(source)}-hub` && settings.network === basename(source));
  assert(Number.isInteger(settings.hub_port) && settings.hub_port >= 10000 && settings.hub_port < 65536);
  const oldContainer = JSON.parse(docker('inspect', settings.hub))[0];
  assert.equal(oldContainer.State.Running, true);
  assert.equal(oldContainer.HostConfig.PortBindings['8125/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(oldContainer.HostConfig.PortBindings['8125/tcp'][0].HostPort, String(settings.hub_port));
  assert(!docker('ps', '-a', '--filter', `name=^${tag}$`, '--format', '{{.Names}}'));
  assert.deepEqual(snapshot(join(source, 'runtime')), JSON.parse(readFileSync(join(source, 'runtime-hashes.json'), 'utf8')));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const dir of ['runtime', 'private', 'knowledge-data']) mkdirSync(join(root, dir), { mode: 0o700 });
  cpSync(join(repo, 'MemoryPanel/dist'), join(root, 'runtime/panel-dist'), { recursive: true });
  cpSync(join(repo, 'MemoryPanel/web/dist'), join(root, 'runtime/web-dist'), { recursive: true });
  cpSync(join(source, 'private/metadata-instances.json'), join(root, 'private/metadata-instances.json'));
  save('runtime-hashes.json', snapshot(join(root, 'runtime')));
  save('preview.json', { source, original_hub: settings.hub, preview_hub: tag, port: settings.hub_port,
    backend: 'Existing isolated Core, browser acceptance is read-only', original_runtime_unchanged: true, model_calls: 0 });
  docker('stop', settings.hub);
  try {
    docker('run', '-d', '--name', tag, '--network', settings.network,
      '-p', `127.0.0.1:${settings.hub_port}:8125`, '-v', `${root}/knowledge-data:/data/knowledge`,
      '-v', `${root}/runtime/panel-dist:/app/panel/dist:ro`, '-v', `${root}/runtime/web-dist:/app/panel/web/dist:ro`,
      '-v', `${root}/private/metadata-instances.json:/app/panel/config/metadata-instances.json:ro`,
      '-e', 'KNOWLEDGE_LLM_BINDING_SYNC=0', '-e', 'LLM_MODE=custom', oldContainer.Image);
    await ready(settings.hub_port);
    console.log('PREVIEW_READY; same isolated origin/account; old frozen runtime preserved');
  } catch (error) {
    if (docker('ps', '-a', '--filter', `name=^${tag}$`, '--format', '{{.Names}}')) docker('stop', tag);
    docker('start', settings.hub);
    save('failure.json', { status: 'INFRA_ERROR', reason: 'PREVIEW_START_FAILED_OR_UNHEALTHY' });
    throw error;
  }
} else {
  const state = JSON.parse(readFileSync(join(root, 'preview.json'), 'utf8'));
  assert.equal(state.preview_hub, tag);
  assert(/^evolution-hub-[a-z0-9-]+-hub$/.test(state.original_hub));
  docker('stop', tag);
  docker('start', state.original_hub);
  await ready(state.port);
  assert.deepEqual(snapshot(join(root, 'runtime')), JSON.parse(readFileSync(join(root, 'runtime-hashes.json'), 'utf8')));
  assert.deepEqual(snapshot(join(state.source, 'runtime')), JSON.parse(readFileSync(join(state.source, 'runtime-hashes.json'), 'utf8')));
  save(`restored-${Date.now()}.json`, { restored: true, original_runtime_unchanged: true, preview_runtime_unchanged: true });
  console.log('ORIGINAL_TEST_HUB_RESTORED; preview container/evidence retained');
}
