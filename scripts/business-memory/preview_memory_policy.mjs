/** Offline preview only; these blocks are not injected into a running Agent. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {memoryContext,POLICIES} from './memory-context-policy.mjs';
const root=resolve(process.argv[2]);
const recall=JSON.parse(readFileSync(resolve(root,'recall-selection.json')));
const previews=POLICIES.map(policy=>memoryContext(recall.items,policy));
writeFileSync(resolve(root,'policy-previews.json'),JSON.stringify({model_calls:0,previews},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(previews.map(p=>({policy:p.policy,selected:p.selected_ids.length,excluded:p.excluded.length,chars:p.block.length,sha256:p.block_sha256}))));
