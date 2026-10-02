// Compare observed source relationships with fixed authored boundaries. Never move
// ownership to make a crossing disappear, or equate a component pair with an API.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadFlow,flowPacket} from './flow.mjs';
import {pipelineOwnership} from './pipeline-ownership.mjs';
import {resourceProvenance} from './resource-provenance.mjs';
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
  names.push(...toolkit,'dev-map/lib/architecture-audit.mjs','dev-map/lib/architecture-audit-view.mjs','dev-map/lib/lexical-bindings.mjs','dev-map/lib/pipeline-ownership.mjs','dev-map/lib/resource-provenance.mjs');
  const texts=await Promise.all([...new Set(names)].sort().map(async p=>[p,hash(await read(repo,p))]));
  const relevant=files.map(f=>f.analyze||f.unsupported||f.file.endsWith('.json')?f:{file:f.file,scope:f.scope,reason:f.reason});
  return hash(JSON.stringify([relevant,texts]));
}
export async function auditStatus(repo) {
  const held=await json(repo,setFile('store/audit.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!held)return {state:'missing'};
  const current=held.fingerprint===await fingerprint(repo,await auditInputs(repo));
  return {state:current?'current':'stale',generated:held.generated,checkedAt:new Date().toISOString(),totals:held.totals};
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
  const rows=[],seen=new Set();
  function add(row) {
    row.from=stable(row.from);row.to=stable(row.to);
    row.fromOwner=owner(row.from);row.toOwner=owner(row.to);
    const k=JSON.stringify([row.kind,row.from,row.to,row.site?.file,row.site?.line,row.site?.start,row.reason]);
    if(seen.has(k))return;seen.add(k);
    if(row.status){rows.push(row);return;}
    if(!row.fromOwner||!row.toOwner){row.status='unassigned';rows.push(row);return;}
    if(row.fromOwner===row.toOwner)return;
    if(row.fromOwner==='outside-product'||row.toOwner==='outside-product'){row.status='outside-product';rows.push(row);return;}
    // Owner chose map 0 only. A represented pair is not permission for every
    // operation; direction/API questions remain distinct from missing root wires.
    const pairs=spec.contracts.filter(c=>top(c.from)===row.fromOwner&&top(c.to)===row.toOwner||top(c.to)===row.fromOwner&&top(c.from)===row.toOwner);
    const candidates=pairs.filter(c=>['value-flow','return-value'].includes(row.kind)
      ?row.fromOwner===top(c.from)&&row.toOwner===top(c.to)
      :(c.access??[{from:c.from,to:c.to}]).some(a=>row.fromOwner===top(a.from)&&row.toOwner===top(a.to)));
    row.contracts=pairs.map(c=>c.id);row.directionContracts=candidates.map(c=>c.id);
    const match=allowed.filter(b=>row.contracts.includes(b.contract)&&b.target===row.to&&b.kinds.includes(row.kind)&&(!b.callers||b.callers.includes(row.from)));
    row.status=!pairs.length?'forbidden':!candidates.length?'direction-review':match.length?'entry-bound':'represented';
    if(match.length)row.bindings=match.map(b=>b.contract);
    rows.push(row);
  }
  for(const r of graph.relations) {
    if(!['call','construct','file','http-route','worker-message','worker-handoff','registry-entry','event-listener','state-read','state-write','value-flow','return-value'].includes(r.kind))continue;
    let from=endpoint(r.from),to=endpoint(r.to);
    // State reads point from storage to consumer in the data graph; access is consumer -> storage.
    if(r.kind==='state-read')[from,to]=[to,from];
    if(from===to&&from)continue;
    add({kind:r.kind,from,to,site:r.evidence?.[0],provenance:r.resolvedBy??'scanner',...(r.label?{operation:r.label}:{})});
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
    for(const s of p.state??[])if(s.owner&&s.owner!==n.path)for(const access of s.access??[])
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
  const totals={files:files.length,scannedFiles:scanFiles.length,leaves:leaves.length,representedDeclarations:graph.declarations.filter(d=>projection.owner.has(d.id)).length,
    unrepresentedDeclarations:graph.declarations.filter(d=>!projection.owner.has(d.id)).length,assigned:leaves.filter(n=>n.owner).length,unassignedLeaves:leaves.filter(n=>!n.owner).length,orphan:orphan.length,unsupported:files.filter(f=>f.unsupported).length};
  for(const row of rows)totals[row.status]=(totals[row.status]??0)+1;
  const buckets=spec.nodes.filter(n=>!n.index.includes('.')).map(n=>({id:n.id,index:n.index,label:n.label}));
  buckets.push(...Object.entries(spec.actors).map(([id,n])=>({id,index:`external:${id}`,label:n.label})),{id:'outside-product',index:'outside-product',label:'Outside core architecture'});
  const bucketTotals=buckets.map(b=>({...b,leaves:leaves.filter(n=>within(n.owner,b.id)).length,
    forbidden:rows.filter(r=>r.status==='forbidden'&&(within(r.fromOwner,b.id)||within(r.toOwner,b.id))).length}));
  const report={scope:'map 0 only; submap boundaries are not enforced',generated:new Date().toISOString(),fingerprint:await fingerprint(repo,files),totals,buckets,bucketTotals,leaves,orphan,files,rows,contracts:spec.contracts,bindings:allowed,pipelineOwnership:pipelineProofs,resourceProvenance:resources,
    limits:[...graph.limits,'This audit uses lexical/import resolution and literal couplings. Whole-runtime receiver/holder propagation proved too expensive in the initial scan and is disabled here; unresolved targets remain unknown, not permitted.',
      'Sequential ownership proofs cover only traced fresh values passed to direct synchronous same-module helpers. They do not clear unrelated unresolved graph calls or prove arbitrary JavaScript alias safety.',
      'Only map 0 is compared. Represented confirms an existing top-level connection, not allowed operations. Direction-review identifies a call/data direction needing inspection. Entry-bound confirms only a named target/kind. Schemas, effects, timing and functional equivalence are not certified.',
      'Ownership is a provisional authored assignment. No implementation files were moved. Anonymous bodies inherit their containing declaration; mixed leaves need review.',
      'Native/non-mjs code, assets, deployment, tests and development tools remain explicit in the scope ledger; they are not certified.'],sources:Object.fromEntries(sources)};
  await save(repo,setFile('store/audit.json'),report);
  await mkdir(resolve(repo,setFile('view')),{recursive:true});
  await writeFile(resolve(repo,setFile('view/audit.html')),renderAudit(report));
  return {generated:report.generated,...totals,report:setFile('view/audit.html'),compliance:'not certified'};
}
