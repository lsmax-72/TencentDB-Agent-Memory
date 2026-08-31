/** Heuristic diagnostics, not an applicability judge or a new admission policy. */
export function inspectMemoryScope(items, exposedIds) {
  const byId=new Map(items.map(r=>[r.id,r]));
  if(byId.size!==items.length)throw Error('duplicate memory identity');
  for(const id of exposedIds)if(!byId.has(id))throw Error('exposure outside snapshot');
  return items.map(item=>{
    const anchors=[...item.content.matchAll(/(?:列\s*[A-Z]{1,3}\b|\bcolumn\s+[A-Z]{1,3}\b|\b[A-Z]{1,3}\d+\b|\/[\w./-]+\.(?:xlsx|csv)\b)/g)].map(m=>m[0]);
    const exposed=exposedIds.has(item.id),findings=[];
    if(item.type==='work_method'&&anchors.length)findings.push('TASK_BOUND_METHOD_RISK');
    if(exposed&&item.background&&!item.content.includes(item.background))findings.push('CONTENT_ONLY_RENDERING_OMITS_BACKGROUND');
    const visibleScope=item.scope??item.metadata?.scope??null;
    if(item.type==='work_method'&&!visibleScope)findings.push('METHOD_SCOPE_NOT_EXPOSED_IN_SNAPSHOT');
    return {id:item.id,type:item.type,source_task:item.task_id,exposed,anchors:[...new Set(anchors)],visible_scope:visibleScope,findings};
  });
}
