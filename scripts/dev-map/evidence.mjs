export function compareEvidence(model,graph,{pilotPages=['6_output','7b_source']}={}) {
  const byAnchor=new Map(graph.declarations.filter(d=>d.anchor&&!d.ambiguousAnchor).map(d=>[d.anchor,d]));
  const occurrences=new Map();
  for(const page of model.pages)for(const node of page.nodes)if(node.anchor) {
    const uses=occurrences.get(node.anchor)??[];uses.push({page:page.key,address:node.num,id:node.id});occurrences.set(node.anchor,uses);
  }
  const mapped=[...occurrences.keys()].map(a=>byAnchor.get(a)).filter(Boolean);
  const contains=(outer,inner)=>outer.file===inner.file&&outer.start<=inner.start&&outer.end>=inner.end;
  const inventory=graph.declarations.filter(d=>/^(core|studio)\//.test(d.file)).map(d=> {
    const direct=d.ambiguousAnchor?[]:occurrences.get(d.anchor)??[];
    const enclosing=mapped.filter(m=>m.id!==d.id&&contains(m,d)).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
    return {...d,status:direct.length?'direct':enclosing.length?'enclosed':'unrepresented',occurrences:direct,enclosing:enclosing.map(m=>({declaration:m.id,occurrences:occurrences.get(m.anchor)}))};
  });
  const inventoryById=new Map(inventory.map(d=>[d.id,d]));
  const status=id=>inventoryById.get(id)?.status??(/^(core|studio)\//.test(id)?'module-unmapped':'outside-map-scope');
  const descendants=key=>model.pages.find(p=>p.key===key)?.nodes.flatMap(n=>n.anchor?[byAnchor.get(n.anchor)].filter(Boolean):n.explodes?descendants(n.explodes):[])??[];
  const adjacency=new Map();
  for(const e of graph.relations) {const out=adjacency.get(e.from)??[];out.push(e);adjacency.set(e.from,out);}
  const comparisons=[],pilot=[];
  for(const page of model.pages) {
    const roots=new Map(page.nodes.map(n=>[n.id,n.anchor?[byAnchor.get(n.anchor)].filter(Boolean):n.explodes?descendants(n.explodes):[]]));
    const membership=new Map();
    for(const d of graph.declarations) {
      const matches=[...roots].flatMap(([node,list])=>list.filter(r=>contains(r,d)).map(r=>({node,size:r.end-r.start})));
      if(matches.length) {const min=Math.min(...matches.map(m=>m.size));membership.set(d.id,[...new Set(matches.filter(m=>m.size===min).map(m=>m.node))]);}
    }
    const generated=[],keyed=new Map();
    for(const first of graph.relations)for(const src of membership.get(first.from)??[]) {
      const queue=[{at:first.to,path:[first],seen:new Set([first.from])}];
      while(queue.length) {
        const item=queue.shift();if(item.seen.has(item.at))continue;
        const destinations=membership.get(item.at)??[];
        if(destinations.length) {
          for(const dst of destinations)if(src!==dst) {
            const kinds=[...new Set(item.path.map(e=>e.kind))];
            const kind=kinds.length===1?kinds[0]:'mixed-path';
            const key=`${src}:${dst}:${kind}`;
            let g=keyed.get(key);
            if(!g) {g={src,dst,kind,kinds,paths:[]};keyed.set(key,g);generated.push(g);}
            g.paths.push(item.path.map(e=>e.id));
          }
          continue;
        }
        // Collapse only call chains and worker delivery; return/value edges are not composable taint proofs.
        if(item.path.length>=6||!item.path.every(e=>['call','worker-handoff'].includes(e.kind)))continue;
        const seen=new Set(item.seen).add(item.at);
        for(const e of adjacency.get(item.at)??[])if(['call','worker-handoff'].includes(e.kind))queue.push({at:e.to,path:[...item.path,e],seen});
      }
    }
    const authored=page.claims??page.edges;
    const claims=authored.map((edge,index)=> {
      const evidence=generated.filter(g=>g.src===edge.src&&g.dst===edge.dst);
      const srcIds=[...membership].filter(([,nodes])=>nodes.includes(edge.src)).map(([id])=>id);
      const unresolved=graph.unresolved.filter(u=>srcIds.includes(u.from));
      const boundary=!(roots.get(edge.src)?.length&&roots.get(edge.dst)?.length);
      return {index,...edge,status:evidence.length?'structural-evidence-only':boundary?'boundary-claim':unresolved.length?'unresolved':'unsupported',
        evidence:evidence.map(g=>({kind:g.kind,paths:g.paths})),unresolvedSites:unresolved.map(u=>u.site),
        claim:'Authored payload/condition semantics require evidence; legacy data/gate/io kinds do not identify call, value flow, sequence or handoff.'};
    });
    const omitted=generated.filter(g=>!authored.some(e=>e.src===g.src&&e.dst===g.dst));
    const result={page:page.key,claims,generated,omitted};comparisons.push(result);
    if(pilotPages.includes(page.key))pilot.push({...result,nodes:page.nodes.map(n=>({id:n.id,address:n.num,label:n.label,anchor:n.anchor,child:n.explodes})),
      unresolved:graph.unresolved.filter(u=>membership.has(u.from)),collapse:'Nearest containing mapped declaration or child-page declaration; paths stop at another mapped node. Up to six call/handoff edges; no value/sequence inference from mixed paths.'});
  }
  const sharedUses=[...occurrences].map(([anchor,uses])=> {
    const d=byAnchor.get(anchor);
    const callers=graph.relations.filter(e=>e.to===d?.id&&['call','construct'].includes(e.kind)).map(e=>({from:e.from,evidence:e.evidence,status:status(e.from),mappedOccurrences:inventoryById.get(e.from)?.occurrences??[]}));
    return {anchor,semanticEquivalence:'Not established by code identity; authored full I/O contract still requires review.',
      occurrences:uses.map(use=>({...use,otherMappedIndexes:uses.filter(other=>other!==use).map(other=>({page:other.page,address:other.address}))})),
      callers,unmappedCallers:callers.filter(c=>!c.mappedOccurrences.length)};
  });
  const represented=new Set(comparisons.flatMap(p=>p.generated.flatMap(e=>e.paths.flat())));
  const derived=graph.relations.map(e=>({...e,fromStatus:status(e.from),toStatus:status(e.to),representation:represented.has(e.id)?'generated-endpoint-path':'not-projected'}));
  const count=items=>Object.fromEntries([...new Set(items)].sort().map(k=>[k,items.filter(v=>v===k).length]));
  return {schema:1,summary:{files:graph.files.length,declarations:count(inventory.map(d=>d.status)),declarationKinds:count(inventory.map(d=>d.kind)),
    callableDeclarations:count(inventory.filter(d=>d.callable).map(d=>d.status)),declarationsByKindAndStatus:count(inventory.map(d=>`${d.kind}/${d.status}`)),
    derivedRelationships:count(graph.relations.map(e=>e.kind)),relationshipRepresentation:count(derived.map(e=>e.representation)),unresolvedSites:graph.unresolved.length,unresolvedReasons:count(graph.unresolved.map(u=>u.reason)),
    authoredClaims:count(comparisons.flatMap(p=>p.claims.map(e=>e.status))),omittedPageConnections:comparisons.reduce((n,p)=>n+p.omitted.length,0),
    relationshipsWithUnrepresentedEndpoint:derived.filter(e=>[e.fromStatus,e.toStatus].includes('unrepresented')).length,
    unmappedCallerSites:sharedUses.reduce((n,s)=>n+s.unmappedCallers.length,0)},
    inventory,comparisons,pilot,sharedUses,derived,
    limits:[...graph.limits,'Enclosed declarations are counted separately and do not mean explained behavior.','Unsupported means no established support in this bounded extractor, not disproven or impossible.','All authored labels remain claims. A matching endpoint path is structural evidence only.','Omitted page connections count typed endpoint pairs, not unique runtime behaviors.','Shared-use indexes enumerate all other mapped occurrences only; unmapped callers never receive invented indexes.']};
}

export function evidenceMarkdown(report) {
  const s=report.summary;
  const lines=['# Generated developer-map evidence','',
    `The viewer and toolkit use the projected relationships from these ${s.files} JavaScript modules. This report is supporting evidence from the same model, not a second wiring authority.`,'',
    '| Core / Studio declaration status | All | Callable |','|---|---:|---:|',
    ...['direct','enclosed','unrepresented'].map(k=>`| ${k} | ${s.declarations[k]??0} | ${s.callableDeclarations[k]??0} |`),'',
    'Enclosed declarations are not individually explained. Variables and classes are counted separately from callable declarations in evidence.json. Skills and adapters supply inbound callers without mapped internals.','',
    '| Relationship kind | Sites |','|---|---:|',
    ...Object.entries(s.derivedRelationships).map(([k,n])=>`| ${k} | ${n} |`),'',
    `Relationships used in displayed endpoint paths: ${s.relationshipRepresentation['generated-endpoint-path']??0}. Not projected: ${s.relationshipRepresentation['not-projected']??0}.`,'',
    `Discovered caller sites without direct mapped nodes: ${s.unmappedCallerSites}. No indexes are invented for them.`,'',
    '| Unresolved reason | Sites |','|---|---:|',
    ...Object.entries(s.unresolvedReasons).map(([k,n])=>`| ${k} | ${n} |`),'',
    'Unresolved sites include external APIs. Endpoint paths do not establish semantic labels, runtime branch selection, execution order or complete coverage.'];
  for(const p of report.comparisons) {
    lines.push('',`## ${p.page}`,'',
      `${p.generated.length} typed generated connections; ${p.omitted.length} are absent from authored claims. Internal claims do not create displayed wires.`,
      '', '| Connection | Derived kind | Paths |','|---|---|---:|',
      ...p.generated.map(e=>`| ${e.src} → ${e.dst} | ${e.kind} | ${e.paths.length} |`),
      '', '| Authored semantic claim | Evidence status |','|---|---|',
      ...p.claims.map(c=>`| ${c.src} → ${c.dst}: ${c.label} | ${c.status} |`));
  }
  lines.push('','## Limits','',...report.limits.map(l=>`- ${l}`),'',
    'graph.json retains source hashes, spans, resolution sites and typed relationships. evidence.json retains full inventory, projection paths, authored claims, unresolved sites and unmapped callers.');
  return lines.join('\n')+'\n';
}
