// Compare observed source relationships with fixed authored boundaries. Never move
// ownership to make a crossing disappear, or equate a component pair with an API.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadFlow,flowPacket} from './flow.mjs';
import {pipelineOwnership} from './pipeline-ownership.mjs';
import {resourceProvenance} from './resource-provenance.mjs';
import {semanticContainment,inertModuleNavigation} from './semantic-containment.mjs';
import {setFile} from './map-set.mjs';
import {renderAudit} from './architecture-audit-view.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const read=async(repo,file)=>readFile(resolve(repo,file),'utf8');
const json=async(repo,file)=>JSON.parse(await read(repo,file));
const save=async(repo,file,value)=>{await mkdir(resolve(repo,file,'..'),{recursive:true});await writeFile(resolve(repo,file),JSON.stringify(value,null,1)+'\n');};
const code=/\.(?:mjs|cjs|js|ts|tsx|jsx|cpp|c|h|py|ps1|sh|html|css|wasm|glsl|wgsl)$/;
const support=/(?:^|\/)(?:tests?|fixtures|bench|examples)(?:\/|\.)|(?:^|\/)[^/]*(?:-demo|-example|\.test)\.[^/]+$/;
const positional=path=>/@\d+:\d+/.test(path??'');
const stable=path=>{if(!path)return path;while(positional(path))path=path.slice(0,path.lastIndexOf('::'));return path.includes('::')?path:`${path}::@module`;};

// Only authored contract endpoints are operation boundaries. A source-navigation
// box is not an API merely because it has a different numeric address.
export function submapBoundaryResolver({spec,bindings,containment,leaves,asts=new Map()}) {
  const nodes=new Map(spec.nodes.map(n=>[n.id,n])),byPath=new Map(leaves.map(n=>[n.path,n]));
  const indexes=new Map(spec.nodes.map(n=>[n.index,n.id]));
  const top=id=>nodes.has(id)?indexes.get(nodes.get(id).index.split('.')[0]):id;
  const within=(id,parent)=>id===parent||!!nodes.get(id)&&!!nodes.get(parent)&&nodes.get(id).index.startsWith(nodes.get(parent).index+'.');
  const endpoints=new Set(spec.contracts.flatMap(c=>[c.from,c.to]));
  const hasChildren=id=>spec.nodes.some(n=>n.index.startsWith((nodes.get(id)?.index??'!')+'.'));
  const root=path=>top(byPath.get(path)?.owner);
  const rawHome=path=>containment.owners[path]??byPath.get(path)?.owner;
  function component(path,identity) {
    if(identity&&identity!==path&&!containment.homes[identity])return null;
    const home=rawHome(path),r=root(path);
    if(top(home)!==r)return null;
    const semantic=containment.homes[path]??path,evidence=containment.provenance?.[semantic];
    if(nodes.has(r)&&hasChildren(r)&&evidence?.owner!=='exact-source-reference')return null;
    const candidates=[...endpoints].filter(id=>within(home,id)&&id!==r).sort((a,b)=>nodes.get(b).index.length-nodes.get(a).index.length);
    return candidates[0]??(!nodes.has(r)||!hasChildren(r)?r:null);
  }
  const privateHome=path=>spec.nodes.filter(n=>n.visibility==='private'&&within(rawHome(path),n.id)).sort((a,b)=>b.index.length-a.index.length)[0]?.id;
  function resolvedImports(row) {
    // Resolution belongs to this resolved callable, not merely another import
    // in its file. Preserve the original import/reexport evidence in the row.
    return (row.resolution??[]).flatMap(site=>{
      const n=asts.get(site.file)?.body.find(n=>n.start===site.start&&['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type));
      if(!n?.source?.value?.startsWith('.'))return [];
      return [posix.normalize(posix.join(posix.dirname(site.file),n.source.value))];
    });
  }
  const publicRoute=(row,port)=>resolvedImports(row).includes(nodes.get(port)?.source?.file);
  return row=>{
    const from=component(row.from,row.sourceFrom),to=component(row.to,row.sourceTo),fromRoot=root(row.from),toRoot=root(row.to);
    const result={from,to,fromHome:rawHome(row.from)??null,toHome:rawHome(row.to)??null,
      fromDeclaration:containment.homes[row.sourceFrom??row.from]??row.sourceFrom??row.from,toDeclaration:containment.homes[row.sourceTo??row.to]??row.sourceTo??row.to,contracts:[],directionContracts:[]};
    if(!fromRoot||!toRoot)return {...result,status:'unresolved',reason:'A source endpoint or map-0 responsibility is unresolved.'};
    if(fromRoot==='outside-product'||toRoot==='outside-product')return {...result,status:'outside-product'};
    if(row.sourceTo&&row.sourceTo!==row.to&&!containment.homes[row.sourceTo])return {...result,status:'unresolved',reason:'Callee is an anonymous/projected callable without a proved independent semantic home.'};
    if(result.fromDeclaration===result.toDeclaration)return {...result,status:'internal',reason:'Same evidenced semantic declaration; effects remain attached.'};
    const privateTarget=privateHome(row.to);
    if(fromRoot===toRoot&&privateTarget)return {...result,status:'internal',reason:'Shared private implementation remains within its owning component.',privateOwner:privateTarget};
    if(from&&from===to)return {...result,status:'internal',reason:'Within the same resolved operation/component boundary.'};
    const data=['value-flow','return-value'].includes(row.kind),call=['call','construct'].includes(row.kind);
    const targetBindings=bindings.filter(b=>b.target===row.to&&b.kinds.includes(row.kind)&&(!b.callers||b.callers.includes(row.from)));
    const scopeMatches=(home,actualRoot,scope)=>home?within(home,scope):scope===actualRoot;
    const direction=[],pairs=[],bound=[],unproved=[];
    for(const c of spec.contracts) {
      const direct=from&&to&&((within(from,c.from)&&within(to,c.to))||(within(from,c.to)&&within(to,c.from)));
      const access=c.access??[{from:c.from,to:c.to}];
      const entries=targetBindings.filter(b=>b.contract===c.id);
      const through=entries.length&&access.some(a=>scopeMatches(from,fromRoot,a.from)&&top(a.to)===toRoot);
      if(!direct&&!through)continue;
      pairs.push(c.id);
      const compatible=data?from&&to&&within(from,c.from)&&within(to,c.to):access.some(a=>scopeMatches(from,fromRoot,a.from)&&(to&&within(to,a.to)||entries.length&&top(a.to)===toRoot));
      if(!compatible)continue;
      direction.push(c.id);
      if(entries.length){
        const ports=access.filter(a=>scopeMatches(from,fromRoot,a.from)&&top(a.to)===toRoot).map(a=>a.to);
        if(privateTarget&&fromRoot!==toRoot&&!ports.some(port=>!within(port,privateTarget)&&publicRoute(row,port)))unproved.push(c.id);
        else bound.push(c.id);
      }
    }
    Object.assign(result,{contracts:pairs,directionContracts:direction,...(bound.length?{bindings:bound}:{}),...(privateTarget?{privateOwner:privateTarget}:{})});
    if(bound.length)return {...result,status:'entry-bound',reason:'Exact target/kind/caller and compatible authored entry scope; schemas/effects remain unchecked.'};
    if(unproved.length)result.routeContracts=unproved;
    if(privateTarget&&fromRoot!==toRoot&&call){
      const exposed=targetBindings.flatMap(b=>spec.contracts.filter(c=>c.id===b.contract).flatMap(c=>(c.access??[{from:c.from,to:c.to}]).filter(a=>top(a.from)===fromRoot&&top(a.to)===toRoot&&!within(a.to,privateTarget)).map(a=>a.to)));
      if(exposed.some(port=>publicRoute(row,port)))return {...result,status:from?'boundary':'unresolved',reason:'Public import route is proved, but the caller operation is outside or unresolved within its authored entry scope.'};
      if(exposed.length&&!resolvedImports(row).includes(row.to.split('::')[0]))return {...result,status:'unresolved',reason:'Private target has a public binding but the actual import route remains unproved.'};
      return {...result,status:'private-access',reason:'Resolved call directly reaches another component’s private implementation without a bound public route.'};
    }
    if(!from||!to)return {...result,status:'unresolved',reason:'Root-only or ambiguous operation home; authored source nesting is not ownership proof.'};
    if(fromRoot===toRoot&&(within(from,to)||within(to,from)))return {...result,status:'unresolved',reason:'One endpoint has only a containing-component home; its internal operation boundary is unresolved.'};
    if(!pairs.length)return {...result,status:'boundary',reason:'Distinct resolved operation boundaries have no matching authored contract.'};
    if(!direction.length)return {...result,status:'direction-review',reason:'An authored boundary exists but its access/causal direction does not match.'};
    return {...result,status:call?'unbound-operation':'represented',reason:call?'Boundary direction is represented; this callable is not an exact bound entry.':'Authored causal/access boundary is represented; payload and effects remain unchecked.'};
  };
}
export async function auditInputs(repo) {
  const listed=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
  const files=[];
  for(const file of [...new Set(listed)].sort()) {
    const bytes=await readFile(resolve(repo,file)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(bytes===null)continue;
    let scope='outside-product',reason='Development, documentation tooling or example; inventoried, not a product bucket.';
    if(/^(core|studio|skills|adapters|workspaces)\//.test(file)||file==='scripts/agent-toolkit.mjs') {
      scope=support.test(file)?'support':'runtime';reason=scope==='support'?'Test, fixture, benchmark or example.':'Product/extension/agent runtime.';
    } else if(/^(packaging|relay)\//.test(file)){scope='deployment';reason='Separate deployment architecture; not granted core-map access.';}
    else if(file.startsWith('machines/')){scope='asset';reason='Machine configuration dependency; declaration extraction not applicable.';}
    if(scope==='runtime'&&!code.test(file)){scope='asset';reason='Guidance/schema/data asset; inventoried separately from executable declarations.';}
    const analyze=scope==='runtime'&&file.endsWith('.mjs');
    files.push({file,scope,reason,analyze,sha256:hash(analyze?bytes.toString('utf8'):bytes),...(scope==='runtime'&&!analyze?{unsupported:'Non-mjs runtime source: inventoried, not analyzed.'}:{})});
  }
  return files;
}
async function fingerprint(repo,files) {
  const names=[setFile('architecture.json'),setFile('ownership.json'),setFile('interfaces.json')];
  const toolkit=execFileSync('git',['ls-files','dev-map/lib'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/);
  names.push(...toolkit,'dev-map/lib/architecture-audit.mjs','dev-map/lib/architecture-audit-view.mjs','dev-map/lib/lexical-bindings.mjs','dev-map/lib/pipeline-ownership.mjs','dev-map/lib/resource-provenance.mjs','dev-map/lib/semantic-containment.mjs');
  const texts=await Promise.all([...new Set(names)].sort().map(async p=>[p,hash(await read(repo,p))]));
  const relevant=files.map(f=>f.analyze||f.unsupported||f.file.endsWith('.json')?f:{file:f.file,scope:f.scope,reason:f.reason});
  return hash(JSON.stringify([relevant,texts]));
}
export async function auditStatus(repo) {
  const held=await json(repo,setFile('store/audit.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!held)return {state:'missing'};
  const current=held.fingerprint===await fingerprint(repo,await auditInputs(repo));
  return {state:current?'current':'stale',generated:held.generated,checkedAt:new Date().toISOString(),totals:held.totals,...(held.submapTotals?{submapTotals:held.submapTotals}:{})};
}
export async function architectureAudit(repo,{inventoryOnly=false}={}) {
  const files=await auditInputs(repo),spec=await json(repo,setFile('architecture.json'));
  const scanFiles=files.filter(f=>f.analyze).map(f=>f.file);
  console.error(`Scanning ${scanFiles.length} runtime modules; all other discovered code/assets remain in the scope ledger.`);
  const context=await loadFlow({repo,files:scanFiles,receiverCalls:false,onProgress:p=>console.error(JSON.stringify(p))});
  const {graph,projection,sources}=context;
  const pipelineProofs=pipelineOwnership(context.asts);
  const resources=resourceProvenance({graph,asts:context.asts});
  for(const file of files)if(sources.has(file.file))file.sha256=hash(sources.get(file.file));
  // Start unfurled: named declarations and module bodies have distinct ownership.
  // Anonymous bodies stay with their nearest declaration; findings remain visible.
  const leaves=[...projection.nodes.values()].filter(n=>!positional(n.path)).map(n=>({path:n.kind==='module'?`${n.file}::@module`:n.path,file:n.file,line:n.line,endLine:n.endLine,kind:n.kind}));
  for(const file of scanFiles)if(!leaves.some(n=>n.path===`${file}::@module`))leaves.push({path:`${file}::@module`,file,line:1,endLine:1,kind:'module'});
  leaves.sort((a,b)=>a.path.localeCompare(b.path));
  await save(repo,setFile('store/inventory.json'),{files,leaves,limits:graph.limits});
  if(inventoryOnly)return {files:files.length,scanned:scanFiles.length,leaves:leaves.length};
  const authored=await json(repo,setFile('ownership.json')),bindings=await json(repo,setFile('interfaces.json'));
  const nodes=new Map(spec.nodes.map(n=>[n.id,n])),indexes=new Map(spec.nodes.map(n=>[n.index,n.id]));
  const known=new Set([...nodes.keys(),...Object.keys(spec.actors),'outside-product']);
  const owners=authored.leaves??{},byPath=new Map(leaves.map(n=>[n.path,n]));
  for(const [path,entry] of Object.entries(owners))if(!known.has(entry.owner))throw Error(`Unknown owner ${entry.owner}: ${path}`);
  for(const n of leaves){const entry=owners[n.path];Object.assign(n,entry?{...entry,reason:entry.reason??authored.files?.[n.file]?.reason}:{owner:null,reason:'New/unassigned declaration.'});}
  const orphan=Object.keys(owners).filter(path=>!byPath.has(path));
  const declarations=new Map(graph.declarations.map(d=>[d.id,d]));
  const sourceIdentity=id=>declarations.get(id)?.anchor??(id?.endsWith(':<module>')?`${id.slice(0,-9)}::@module`:id);
  const endpoint=id=>{const n=projection.owner.get(id);return n?(n.kind==='module'?`${n.file}::@module`:n.path):id.endsWith(':<module>')?`${id.slice(0,-9)}::@module`:null;};
  const top=id=>nodes.has(id)?indexes.get(nodes.get(id).index.split('.')[0]):id;
  const owner=path=>top(byPath.get(path)?.owner??null);
  const within=(id,container)=>id===container||nodes.has(id)&&nodes.has(container)&&nodes.get(id).index.startsWith(nodes.get(container).index+'.');
  const contracts=new Map(spec.contracts.map(c=>[c.id,c]));
  const allowed=bindings.bindings??[];
  for(const b of allowed) {
    const c=contracts.get(b.contract);
    if(!c||!byPath.has(b.target)||!(c.access??[{from:c.from,to:c.to}]).some(a=>owner(b.target)===top(a.to))||!b.kinds?.length)throw Error(`Invalid interface binding ${JSON.stringify(b)}`);
  }
  const containment=semanticContainment({graph,projection,asts:context.asts,spec,ownership:authored,bindings:allowed,pipelineProofs});
  const submap=submapBoundaryResolver({spec,bindings:allowed,containment,leaves,asts:context.asts});
  const rows=[],seen=new Set(),submapTotals={};
  function add(row) {
    row.from=stable(row.from);row.to=stable(row.to);
    row.fromOwner=owner(row.from);row.toOwner=owner(row.to);
    const k=JSON.stringify([row.kind,row.from,row.to,row.site?.file,row.site?.line,row.site?.start,row.reason]);
    if(seen.has(k))return;seen.add(k);
    if(row.status){rows.push(row);return;}
    if(!row.fromOwner||!row.toOwner){row.status='unassigned';rows.push(row);return;}
    row.submap=submap(row);
    submapTotals[row.submap.status]=(submapTotals[row.submap.status]??0)+1;
    if(row.fromOwner===row.toOwner){
      if(row.submap.status==='internal')return;
      row.status='submap-'+row.submap.status;row.contracts=row.submap.contracts;row.directionContracts=row.submap.directionContracts;rows.push(row);return;
    }
    if(row.fromOwner==='outside-product'||row.toOwner==='outside-product'){row.status='outside-product';rows.push(row);return;}
    // Root policy remains a separate check. Submap operation evidence cannot
    // authorize a missing root wire, and a root wire cannot open private APIs.
    const pairs=spec.contracts.filter(c=>top(c.from)===row.fromOwner&&top(c.to)===row.toOwner||top(c.to)===row.fromOwner&&top(c.from)===row.toOwner);
    const candidates=pairs.filter(c=>['value-flow','return-value'].includes(row.kind)
      ?row.fromOwner===top(c.from)&&row.toOwner===top(c.to)
      :(c.access??[{from:c.from,to:c.to}]).some(a=>row.fromOwner===top(a.from)&&row.toOwner===top(a.to)));
    row.contracts=pairs.map(c=>c.id);row.directionContracts=candidates.map(c=>c.id);
    const match=allowed.filter(b=>row.directionContracts.includes(b.contract)&&b.target===row.to&&b.kinds.includes(row.kind)&&(!b.callers||b.callers.includes(row.from)));
    row.status=!pairs.length?'forbidden':!candidates.length?'direction-review':match.length?'entry-bound':'represented';
    if(match.length)row.bindings=match.map(b=>b.contract);
    rows.push(row);
  }
  for(const r of graph.relations) {
    if(!['call','construct','file','http-route','worker-message','worker-handoff','registry-entry','event-listener','state-read','state-write','value-flow','return-value'].includes(r.kind))continue;
    let from=endpoint(r.from),to=endpoint(r.to);
    let sourceFrom=sourceIdentity(r.from),sourceTo=sourceIdentity(r.to);
    // State reads point from storage to consumer in the data graph; access is consumer -> storage.
    if(r.kind==='state-read'){[from,to]=[to,from];[sourceFrom,sourceTo]=[sourceTo,sourceFrom];}
    if(from===to&&from&&sourceFrom===sourceTo)continue;
    add({kind:r.kind,from,to,sourceFrom,sourceTo,site:r.evidence?.[0],provenance:r.resolvedBy??'scanner',...(r.resolution?.length?{resolution:r.resolution}:{}),...(r.label?{operation:r.label}:{})});
  }
  for(const r of graph.unresolved??[])add({kind:r.kind??'call',from:endpoint(r.from),to:null,site:r.site,status:'unknown',reason:r.reason});
  for(const d of graph.declarations)if(d.ambiguousAnchor)add({kind:'ambiguous-declaration',from:endpoint(d.id),to:null,site:{file:d.file,line:d.line},status:'unknown',reason:`Ambiguous declaration identity ${d.anchor}`});
  for(const r of graph.couplings?.unlinked??[])add({kind:r.kind??'coupling',from:r.from?endpoint(r.from):null,to:null,site:r.site??r,status:'unknown',reason:r.reason});
  // Keep externally observable effects and escaped/mutated values visible, even
  // when the call graph cannot name another component as their recipient.
  let readCount=0;
  for(const n of projection.nodes.values()) {
    if(n.kind==='module')continue;
    const p=flowPacket(context,n.path,{evidence:true});
    for(const r of p.uncertainty??[])if(['member-mutation','nested-receiver-effect','nested-collection-effect','collection-escape','collection-capture','record-escape','callable-origin','closure-capture'].includes(r.kind)&&r.ownership!=='local')
      add({kind:r.kind,from:n.path,to:null,site:{file:n.file,line:r.line??n.line},status:'unknown',reason:JSON.stringify(r)});
    for(const s of p.state??[])if(s.owner&&s.owner!==n.path)for(const access of Array.isArray(s.access)?s.access:typeof s.access==='string'?s.access.split('-'):[])
      add({kind:`state-${access}`,from:n.path,to:sources.has(s.owner)?`${s.owner}::@module`:s.owner,site:{file:n.file,line:n.line},operation:s.name});
    for(const r of p.externalSites??[])if(/read|write|fetch|spawn|exec|import|Worker|socket|request|process\.|global|storage|send|listen/i.test(r.call??''))
      add({kind:'external-effect',from:n.path,to:null,site:{file:n.file,line:r.line},status:'unknown',reason:r.call});
    if(++readCount%500===0)console.error(`Inspected effects for ${readCount} declarations.`);
  }
  // Imports and re-exports are dependencies even when no call was resolved.
  const mixed=new Set(scanFiles.filter(f=>new Set(leaves.filter(n=>n.file===f&&n.kind!=='module').map(n=>top(n.owner))).size>1));
  for(const [file,ast] of context.asts)for(const node of ast.body)if(node.source?.value&&['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)) {
    const specifier=node.source.value;
    if(!specifier.startsWith('.'))continue;
    const target=resolve(repo,file,'..',specifier).slice(resolve(repo).length+1).replaceAll('\\','/');
    add({kind:node.type==='ImportDeclaration'?'import':'re-export',from:`${file}::@module`,to:byPath.has(`${target}::@module`)?`${target}::@module`:null,site:{file,line:node.loc.start.line},
      ...(mixed.has(file)||mixed.has(target)?{status:'unknown',reason:'Module has mixed owners; named call evidence determines access, module-level import alone cannot.'}:byPath.has(`${target}::@module`)?{}:{status:'unknown',reason:`Unanalyzed dependency ${target}`})});
  }
  containment.navigation=inertModuleNavigation({asts:context.asts,spec,ownership:authored,bindings:allowed,rows});
  const totals={files:files.length,scannedFiles:scanFiles.length,leaves:leaves.length,representedDeclarations:graph.declarations.filter(d=>projection.owner.has(d.id)).length,
    unrepresentedDeclarations:graph.declarations.filter(d=>!projection.owner.has(d.id)).length,assigned:leaves.filter(n=>n.owner).length,unassignedLeaves:leaves.filter(n=>!n.owner).length,orphan:orphan.length,unsupported:files.filter(f=>f.unsupported).length};
  for(const row of rows)totals[row.status]=(totals[row.status]??0)+1;
  const buckets=spec.nodes.filter(n=>!n.index.includes('.')).map(n=>({id:n.id,index:n.index,label:n.label}));
  buckets.push(...Object.entries(spec.actors).map(([id,n])=>({id,index:`external:${id}`,label:n.label})),{id:'outside-product',index:'outside-product',label:'Outside core architecture'});
  const bucketTotals=buckets.map(b=>({...b,leaves:leaves.filter(n=>within(n.owner,b.id)).length,
    forbidden:rows.filter(r=>r.status==='forbidden'&&(within(r.fromOwner,b.id)||within(r.toOwner,b.id))).length}));
  const report={scope:'Map-0 responsibility plus resolved authored operation boundaries; source/navigation boxes alone are not APIs. Unresolved submap ownership remains explicit.',generated:new Date().toISOString(),fingerprint:await fingerprint(repo,files),totals,submapTotals,containment,boundaryNodes:spec.nodes.map(({id,index,label,visibility})=>({id,index,label,...(visibility?{visibility}:{})})),buckets,bucketTotals,leaves,orphan,files,rows,contracts:spec.contracts,bindings:allowed,pipelineOwnership:pipelineProofs,resourceProvenance:resources,
    limits:[...graph.limits,'This audit uses lexical/import resolution and literal couplings. Whole-runtime receiver/holder propagation proved too expensive in the initial scan and is disabled here; unresolved targets remain unknown, not permitted.',
      'Sequential ownership proofs cover only traced fresh values passed to direct synchronous same-module helpers. They do not clear unrelated unresolved graph calls or prove arbitrary JavaScript alias safety.',
      'Root and resolved submap operation boundaries are checked separately. Only authored contracts authorize entries; observed implementation wires never do. Root-only/ambiguous operation homes remain unresolved. Entry-bound requires an exact target/kind and compatible direction; schemas, effects, timing and functional equivalence remain unchecked.',
      'Shared private implementation stays inside its owner. Calls from outside require an exact public entry and, for private reexports, a proved import route. Numeric source/navigation subdivisions alone do not create API boundaries.',
      'Ownership is a provisional authored assignment. No implementation files were moved. Anonymous bodies inherit their containing declaration; mixed leaves need review.',
      'Native/non-mjs code, assets, deployment, tests and development tools remain explicit in the scope ledger; they are not certified.'],sources:Object.fromEntries(sources)};
  await save(repo,setFile('store/audit.json'),report);
  await mkdir(resolve(repo,setFile('view')),{recursive:true});
  await writeFile(resolve(repo,setFile('view/audit.html')),renderAudit(report));
  return {generated:report.generated,...totals,submapTotals,containment:{folds:containment.folds.length,blocked:containment.blocked.length},report:setFile('view/audit.html'),compliance:'not certified'};
}
