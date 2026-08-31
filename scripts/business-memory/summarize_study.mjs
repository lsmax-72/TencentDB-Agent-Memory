/** Append-only evidence index and cost ledger; no API calls or result rewriting. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {wireAccounting,normalizedInitialContext} from './audit-lib.mjs';

const root=resolve(process.argv[2]);
assert.equal(basename(root),'business-xlsx-memory-20260831-r4');
const read=p=>JSON.parse(readFileSync(p));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const study=read(resolve(root,'study-report.json')),audit=read(resolve(root,'supplementary-audit.json'));
assert.equal(audit.status,'PASS');
assert(study.production_storage_unchanged);
const totals=rows=>({tokens:rows.reduce((n,r)=>n+r.wire_usage.total_tokens,0),
  model_calls:rows.reduce((n,r)=>n+r.wire_model_calls,0),tool_calls:rows.reduce((n,r)=>n+r.tool_outcomes.length,0)});
const main=audit.details.filter(d=>!/-p[12]$/.test(d.key)),probes=audit.details.filter(d=>/-p[12]$/.test(d.key));
assert.equal(main.length,6);assert.equal(probes.length,4);
const contextProbes=[1,2].map(n=>{
  const left=read(resolve(root,`runs/91-34-none-p${n}/agent-run.json`));
  const right=read(resolve(root,`runs/91-34-memory-p${n}/agent-run.json`));
  assert.equal(normalizedInitialContext(left),normalizedInitialContext(right));
  return {repetition:n,initial_context_equal_except_random_workspace:true};
});
const history=[];
for(let i=1;i<=4;i++){
  const prior=resolve(dirname(root),`business-xlsx-memory-20260831-r${i}`);
  const events=readFileSync(resolve(prior,'proxy-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const wire=wireAccounting(events.filter(e=>e.kind==='request'),events.filter(e=>e.kind==='response'));
  assert(wire.complete,'unsettled wire costs: r'+i);
  const extraction=events.filter(e=>e.kind==='formation_response');
  assert(extraction.every(e=>e.status===200&&Number.isInteger(e.usage?.total_tokens)));
  history.push({attempt:basename(prior),task_tokens:wire.usage.total_tokens,task_model_calls:wire.model_calls,
    extraction_tokens:extraction.reduce((n,r)=>n+r.usage.total_tokens,0),extraction_model_calls:extraction.length,
    wire_evidence_sha256:sha(resolve(prior,'proxy-events.jsonl'))});
}
const diagnostic=read(resolve(dirname(root),'business-xlsx-memory-20260831-r2/extraction-format-diagnostic.json'));
const diagnosticTokens=diagnostic.response.usage.total_tokens;
assert.equal(diagnosticTokens,33);
const record={status:'COMPLETE_WITH_NEGATIVE_OR_INCONCLUSIVE_OUTCOME',original_study_status:study.status,
  main_none:totals(main.filter(d=>d.key.endsWith('-none'))),main_memory:totals(main.filter(d=>d.key.endsWith('-memory'))),
  probe_totals:totals(probes),all_r4:totals(audit.details),history,
  diagnostic_tokens:diagnosticTokens,total_actual_study_tokens:history.reduce((n,r)=>n+r.task_tokens+r.extraction_tokens,diagnosticTokens),
  cost_note:'All r1-r4 requests charged once, including late responses, failures and invalid-fairness work. Reused formation traces are not charged again. Earlier independent XLSX smoke is excluded.',
  probe_context_checks:contextProbes,
  result_hashes:Object.fromEntries(audit.details.map(d=>[d.key,sha(resolve(root,`runs/${d.key}/result.json`))])),
  evidence_hashes:Object.fromEntries(['study-freeze.json','memory-freeze.json','memory-snapshot.json','study-report.json','supplementary-audit.json','hub-memory-visibility.json','probe-selection.json'].map(p=>[p,sha(resolve(root,p))])),
  original_results_unchanged:true,no_promotion:true};
writeFileSync(resolve(root,'evidence-index.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(record,null,2));
