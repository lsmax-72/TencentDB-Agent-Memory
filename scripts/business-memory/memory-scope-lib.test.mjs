import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectMemoryScope} from './memory-scope-lib.mjs';

const item={id:'m',type:'work_method',content:'在数据清理中清空列 H。',background:'一次性税务任务',task_id:'source'};
test('fixed column method warns without declaring memory invalid or filtering it',()=>{
  const findings=inspectMemoryScope([item],new Set(['m']));
  assert.equal(findings.length,1);assert.deepEqual(findings[0].anchors,['列 H']);
  assert(findings[0].findings.includes('TASK_BOUND_METHOD_RISK'));
  assert(findings[0].findings.includes('CONTENT_ONLY_RENDERING_OMITS_BACKGROUND'));
  assert.equal(findings[0].source_task,'source');
});
test('source-specific facts are not silently reclassified as defective methods',()=>{
  const findings=inspectMemoryScope([{...item,type:'work_fact'}],new Set());
  assert.deepEqual(findings[0].findings,[]);
});
test('generic scoped methods do not trigger anchor heuristic; no causal PASS claim',()=>{
  const findings=inspectMemoryScope([{...item,content:'Validate the saved workbook once.',metadata:{scope:'workflow'}}],new Set());
  assert.deepEqual(findings[0].findings,[]);
  assert.equal(findings[0].visible_scope,'workflow');
});
test('scope audit rejects corrupt or foreign exposure identity',()=>{
  assert.throws(()=>inspectMemoryScope([item,item],new Set()));
  assert.throws(()=>inspectMemoryScope([item],new Set(['foreign'])));
});
