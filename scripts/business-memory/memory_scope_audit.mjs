/** Offline follow-through: reads only the frozen memories and recall events, not task results. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectMemoryScope} from './memory-scope-lib.mjs';

const root=resolve(process.argv[2]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshotBytes=readFileSync(resolve(root,'memory-snapshot.json'));
assert.equal(sha(snapshotBytes),JSON.parse(readFileSync(resolve(root,'memory-freeze.json'))).sha256);
const snapshot=JSON.parse(snapshotBytes);
const recalls=readFileSync(resolve(root,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.kind==='recall');
assert(recalls.length>0);
const exposed=new Set(recalls.flatMap(e=>e.items.map(i=>i.id)));
// The finding is specifically about this frozen content-only renderer, not all MemoryProxy paths.
for(const r of recalls)assert(r.items.every(i=>r.block.includes(i.content)&&!r.block.includes(i.background)));
const rows=inspectMemoryScope(snapshot.items,exposed);
const record={kind:'OFFLINE_MEMORY_SOURCE_SCOPE_DIAGNOSTIC',revision:1,model_calls:0,
  snapshot_sha256:sha(snapshotBytes),script_sha256:sha(readFileSync(new URL(import.meta.url))),
  helper_sha256:sha(readFileSync(new URL('./memory-scope-lib.mjs',import.meta.url))),
  rows,counts:{snapshot:rows.length,exposed:exposed.size,task_bound_method_risks:rows.filter(r=>r.findings.includes('TASK_BOUND_METHOD_RISK')).length,
    omitted_background:rows.filter(r=>r.findings.includes('CONTENT_ONLY_RENDERING_OMITS_BACKGROUND')).length},
  not_an_admission_gate:true,does_not_rewrite_memory:true,
  limitations:['Lexical anchors flag inspection candidates, not proven defects.',
    'Scope not exposed by query does not prove absent from underlying storage.',
    'This does not establish causal attribution, memory usefulness, or a new study score.'],
  next_design:'Separate source-task facts from transferable methods; retain source context; test applicability before any new intervention. New conditions require a separately frozen revision, not changing r4.'};
writeFileSync(resolve(root,'memory-scope-diagnostic.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(record,null,2));
