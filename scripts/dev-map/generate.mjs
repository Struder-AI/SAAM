import {extractGraph,sourceFiles} from './graph.mjs';
import {compareEvidence} from './evidence.mjs';
import {containment} from './containment.mjs';

const site = s => `${s.file}:${s.line}:${s.column}`;
const labels = {'call':'calls','construct':'creates','return-value':'return','value-flow':'argument',
  'worker-handoff':'message','mixed-path':'call / message','state-write':'writes','state-read':'reads'};
const countBy=(items,key)=>Object.fromEntries([...new Set(items.map(key))].sort().map(k=>[k,items.filter(i=>key(i)===k).length]));
const span=({file,line,column,endLine,start,end})=>({file,line,column,endLine,start,end});
export const compactRelation=({evidence,resolution,...r})=>({...r,evidence:evidence.map(span),...(resolution?{resolution:resolution.map(span)}:{})});
function unresolvedGroups(items) {
  const groups=new Map();
  for(const u of items) {const key=u.reason;let g=groups.get(key);if(!g){g={reason:u.reason,count:0,files:{},examples:[]};groups.set(key,g);}g.count++;g.files[u.site.file]=(g.files[u.site.file]??0)+1;if(g.examples.length<3)g.examples.push({...span(u.site),text:u.site.text.replace(/\s+/g,' ').slice(0,180)});}
  return [...groups.values()];
}

export async function generateModel(model,repo) {
  const graph=await extractGraph({repo,files:await sourceFiles(repo),importAliases:{
    'studio/app.mjs:./studio/machine-session.mjs':'studio/machine-session.mjs'
  }});
  const report=compareEvidence(model,graph,{pilotPages:model.pages.map(p=>p.key)});
  model.containment=containment(graph,report);
  for(const file of model.containment) {
    const resource=model.resources?.find(r=>r.file===file.file);
    if(resource){file.owner=resource.owner;file.requirement=resource.requirement;file.responsibility=resource.responsibility;}
  }
  const relations=new Map(graph.relations.map(e=>[e.id,e]));
  const regions={};
  for(const page of model.pages) {
    const comparison=report.pilot.find(p=>p.page===page.key);
    page.claims=comparison.claims;
    const boundary=id=>['ext','port'].includes(page.nodes.find(n=>n.id===id)?.kind);
    // Only declared external/boundary contracts remain authored wires. Internal
    // claims stay reviewable in context, but cannot create a generated connection.
    const edges=page.edges.filter(e=>boundary(e.src)||boundary(e.dst)).map(e=>({...e,
      origin:'authored-boundary',relationship:'contract'}));
    const pairs=new Map();
    for(const generated of comparison.generated) {
      const key=`${generated.src}:${generated.dst}`;
      let e=pairs.get(key);
      if(!e) {e={src:generated.src,dst:generated.dst,kind:'data',rank:false,origin:'code',relationships:[],paths:[]};pairs.set(key,e);}
      e.relationships.push(generated.kind);e.paths.push(...generated.paths);
    }
    for(const e of pairs.values()) {
      e.relationships=[...new Set(e.relationships)];
      e.label=e.relationships.map(k=>labels[k]??k).join(' / ');
      e.rank=e.relationships.some(k=>['call','construct','worker-handoff','mixed-path'].includes(k));
      e.evidence=[...new Set(e.paths.flat())].map(id=>compactRelation(relations.get(id)));
      edges.push(e);
    }
    page.edges=edges;
    page.analysis={unresolvedCount:comparison.unresolved.length,unresolved:unresolvedGroups(comparison.unresolved),claims:page.claims.filter(c=>!['boundary-claim','structural-evidence-only'].includes(c.status)),
      isolated:page.nodes.filter(n=>!edges.some(e=>e.src===n.id||e.dst===n.id)).map(n=>n.id)};
    for(const node of page.nodes)if(page.analysis.isolated.includes(node.id))node.note=[node.note,'links unresolved'].filter(Boolean).join('; ');
  }
  for(const source of Object.keys(model.specs)) {
    const pages=model.pages.filter(p=>p.source===source),anchors=new Set(pages.flatMap(p=>p.nodes.map(n=>n.anchor)).filter(Boolean));
    const inventory=report.inventory.filter(d=>d.occurrences.some(o=>pages.some(p=>p.key===o.page))||d.enclosing.some(e=>e.occurrences.some(o=>pages.some(p=>p.key===o.page))));
    const callers=report.sharedUses.filter(s=>anchors.has(s.anchor));
    regions[source]={basis:'code-derived internal relationships; authored grouping, contracts and boundary ports',
      containment:model.containment.filter(f=>source.endsWith('/0_system.md')||pages.some(p=>p.nodes.some(n=>n.src===f.file))).map(({declarations,...f})=>f),
      limits:graph.limits,inventory:countBy(inventory,d=>d.status),callableInventory:countBy(inventory.filter(d=>d.callable),d=>d.status),
      sharedUses:callers.map(({callers,...c})=>({...c,callerCount:callers.length,unmappedCallers:c.unmappedCallers.map(u=>({...u,evidence:u.evidence.map(span)}))})),
      repositorySummary:report.summary,details:'Build writes dev-map/graph.json and dev-map/coverage.json with complete source spans, hashes, inventory, paths and unresolved sites.'};
    const lines=['','## Generated relationships','',
      'Internal wires come from parsed code. Calls, returns, argument flow, state dependencies and possible worker delivery are distinct; none proves execution order. Wires touching boundary ports or external nodes and the payload/condition claims below are authored. Shared red indexes identify reviewed component contracts, not inferred semantic equivalence. Full evidence and unresolved sites are written to dev-map/graph.json and dev-map/coverage.json on build.'];
    for(const p of pages) {
      const name=id=>{const n=p.nodes.find(n=>n.id===id);return n.num??n.label;};
      lines.push('',`### ${p.key}`,'',`${p.edges.filter(e=>e.origin==='code').length} generated connections; ${p.analysis.unresolvedCount} unresolved call sites.`,
        '', '| Connection | Derivation sites |','|---|---|');
      for(const e of p.edges.filter(e=>e.origin==='code')) {
        const sites=[...new Set(e.evidence.flatMap(r=>r.evidence.map(site)))];
        lines.push(`| ${name(e.src)} → ${name(e.dst)}: ${e.relationships.join(', ')} | ${sites.slice(0,4).join('; ')}${sites.length>4?`; +${sites.length-4} sites in graph.json`:''} |`);
      }
      lines.push('','Authored semantic claims (endpoint evidence does not verify the payload or condition):','');
      for(const c of p.claims)lines.push(`- ${name(c.src)} → ${name(c.dst)}: ${c.label} — ${c.status}.`);
      if(p.analysis.isolated.length)lines.push('',`No resolved displayed relationship: ${p.analysis.isolated.map(name).join(', ')}. These components remain mapped; their behavior has not been disproven.`);
      if(p.analysis.unresolved.length)lines.push('','Unresolved calls grouped by reason (up to three example sites; complete list in graph.json):','',...p.analysis.unresolved.map(g=>`- ${g.reason}: ${g.count} across ${Object.keys(g.files).length} files; examples ${g.examples.map(site).join(', ')}.`));
    }
    lines.push('','### Callers outside direct mapped uses','');
    for(const c of callers)for(const u of c.unmappedCallers)lines.push(`- ${c.anchor}: ${u.evidence.map(site).join(', ')} (${u.status}; no map index).`);
    lines.push('','### Analysis limits','',...graph.limits.map(l=>`- ${l}`));
    model.specs[source]+=lines.join('\n')+'\n';
  }
  model.analysis={regions,summary:report.summary,limits:graph.limits};
  // Full inventory includes code outside all authored containers. It is evidence,
  // not silently counted as represented by a factory or a top-level page.
  model.graph=graph;model.coverage=report;
  return model;
}
