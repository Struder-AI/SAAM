// Authorship selects containment only. Every displayed endpoint, gate and relationship
// comes from a generated packet or scanner relation; boundaries are cut from those edges.
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {invocationInstances} from './instances.mjs';

export async function compositionFiles(repo) {
  const entries=await readdir(resolve(repo,'dev-map/flows'),{withFileTypes:true})
    .catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  return ['dev-map/flows.json',...entries.filter(e=>e.isFile()&&e.name.endsWith('.json'))
    .map(e=>`dev-map/flows/${e.name}`).sort()];
}
export async function readCompositions({repo}={}) {
  const flows=[];
  for(const file of await compositionFiles(repo)) {
    const text=await readFile(resolve(repo,file),'utf8').catch(error=>{
      if(error.code==='ENOENT'&&file==='dev-map/flows.json')return null;throw error;
    });
    if(text===null)continue;
    const config=JSON.parse(text);
    allowed(config,['schema','flows'],file);
    if(config.schema!==1||!Array.isArray(config.flows))throw Error(`Composition ${file} needs schema 1 and flows.`);
    for(const spec of config.flows) {
      allowed(spec,['path','groups'],file);
      flows.push({...spec,source:file});
    }
  }
  return {schema:1,flows};
}
const identity=c=>c.path??(c.file&&c.label?`${c.file}::${c.label}`:c.file);
const allowed=(value,keys,where)=>{
  for(const key of Object.keys(value))if(!keys.includes(key))throw Error(`Composition ${where}: unsupported field ${key}.`);
};

// Region/file compositions operate on the declarations actually contained by that scope.
// Calls remain calls (not imaginary returned-value wires); exact evidence survives contraction.
function structural(page,{model,index,packets}) {
  const files=page.kind==='region'?page.files:[page.file],inside=new Set(files);
  const nodes=model.nodes.filter(n=>inside.has(n.file));
  const components=nodes.map(n=>({index:index.get(n.path),path:n.path,label:n.path.slice(n.file.length+2),
    file:n.file,line:n.line,endLine:n.endLine,lines:n.endLine-n.line+1,
    leaf:!(packets.get(n.path)?.components.length||packets.get(n.path)?.operators?.length)}));
  // Module-only source is still part of the region. Its recorded module-level
  // calls/couplings use the file endpoint; missing callback analysis stays explicit.
  for(const file of files)if(!nodes.some(n=>n.file===file))components.push({
    index:index.get(file),path:file,file,label:file.slice(file.lastIndexOf('/')+1),kind:'file',
    line:1,endLine:contextLines(model,file),leaf:true,moduleOnly:true});
  const shown=new Set(components.map(c=>c.index)),inputs=[],outputs=[],wires=[];
  const port=(end,direction)=>{
    const list=direction==='in'?inputs:outputs,key=`${direction}:${end}`;
    if(!list.some(p=>p.port===key))list.push({port:key,name:end,index:index.get(end)??null,path:end});
    return key;
  };
  const add=(from,to,kind,label,evidence)=>{
    const a=index.get(from),b=index.get(to),hasA=shown.has(a),hasB=shown.has(b);
    if(!hasA&&!hasB)return;
    wires.push({from:hasA?a:port(from,'in'),to:hasB?b:port(to,'out'),kind,
      ...(label?{label}:{}),evidence});
  };
  for(const c of model.calls)add(c.from?.path??c.fromFile??'<external>',c.to.path,c.relation.kind,c.label,
    {file:c.fromFile,line:c.line,start:c.start});
  for(const c of model.couplings)add(c.from?.path??c.fromFile??'<external>',c.to?.path??c.toFile??'<external>',c.kind,c.label,
    {file:c.fromFile,line:c.line});
  const memberPackets=nodes.map(n=>packets.get(n.path)).filter(Boolean);
  return {...page,components,inputs,outputs,wires,gates:[],ports:[],requires:[],formulas:[],calledFrom:[],couplings:[],
    unresolved:[...(page.unresolved??[]),...memberPackets.flatMap(p=>(p.unresolved??[]).map(u=>({...u,file:p.file,path:p.path})))],
    uncertainty:[...(page.uncertainty??[]),...memberPackets.flatMap(p=>(p.uncertainty??[]).map(u=>({...u,file:p.file,path:p.path})))],
    external:(page.external??0)+memberPackets.reduce((n,p)=>n+(p.external??0),0),files,structural:true};
}

function contextLines(model,file) { return model.fileLines?.get(file)??1; }

// Contracting a stage around an outside operation would turn a straight flow
// into apparent feedback. Check actual occurrences, including repeated callees.
function assertConvex(packet,groups) {
  if(packet.structural||packet.kind==='class')return;
  const expanded=invocationInstances(packet),outgoing=new Map();
  for(const wire of expanded.wires??[]) {
    // Capturing or passing a function value does not execute that function, and a
    // shared-state dependency does not establish which accessor runs first. These
    // edges can cross closure groups in both directions without creating execution
    // feedback. Keep them and their boundary evidence; exclude only from this walk.
    if(wire.kind==='capture'||wire.kind==='state'||wire.provenance==='ast-closure-value')continue;
    if(!outgoing.has(wire.from))outgoing.set(wire.from,[]);
    outgoing.get(wire.from).push(wire.to);
  }
  for(const group of groups) {
    const declarations=new Set(group.members.map(c=>c.index));
    const inside=new Set(expanded.components.filter(c=>declarations.has(c.index)).map(c=>c.id??c.index));
    const pending=[...inside].flatMap(id=>(outgoing.get(id)??[]).filter(to=>!inside.has(to)));
    const seen=new Set();
    while(pending.length) {
      const next=pending.pop();
      if(inside.has(next))throw Error(`Non-convex composition ${group.path}: execution leaves the group and re-enters it. Keep the intervening flow visible.`);
      if(seen.has(next))continue;seen.add(next);
      pending.push(...(outgoing.get(next)??[]));
    }
  }
}

export function composePages(pages,config,context) {
  allowed(config,['schema','flows'],'root');
  if(config.schema!==1||!Array.isArray(config.flows))throw Error('Composition needs schema 1 and flows.');
  const result=new Map(pages),groupPages=new Map(),seen=new Set();
  for(const spec of config.flows) {
    allowed(spec,['path','groups','source'],'flow');
    const requireStableReference=ref=>{
      if(/<(?:callback|callable|return)@\d+:\d+>/.test(ref))
        throw Error(`Source-position composition reference ${ref}: give the stage a code binding name before authoring its grouping.`);
    };
    requireStableReference(spec.path);
    if(seen.has(spec.path))throw Error(`Duplicate composition ${spec.path}.`);seen.add(spec.path);
    const original=pages.get(spec.path);if(!original)throw Error(`Unknown composition page ${spec.path}.`);
    if(!Array.isArray(spec.groups)||!spec.groups.length)throw Error(`Composition ${spec.path} has no groups.`);
    const packet=['region','file'].includes(original.kind)?structural(original,context):structuredClone(original);
    const base=packet.wires.map((w,i)=>({...w,edgeId:w.edgeId??`${spec.path}#${i+1}`}));
    packet.wires=base;
    const byIdentity=new Map(packet.components.map(c=>[identity(c),c]));
    const groups=[],claimed=new Set(),ids=new Set();
    for(const [i,g] of spec.groups.entries()) {
      allowed(g,['id','label','members','groups'],'group');
      if(!/^[a-z][a-z0-9-]*$/.test(g.id??'')||ids.has(g.id))throw Error(`Invalid or duplicate group id ${g.id}.`);
      ids.add(g.id);
      if(g.label!==undefined&&(typeof g.label!=='string'||!g.label.trim()||g.label.includes('\n')))throw Error(`Invalid label ${g.id}.`);
      if(!Array.isArray(g.members)||!g.members.length)throw Error(`Empty group ${g.id}.`);
      const members=[];
      for(const ref of g.members) {
        requireStableReference(ref);
        const matching=byIdentity.has(ref)?[byIdentity.get(ref)]:packet.components.filter(c=>c.file===ref);
        if(!matching.length)throw Error(`Unknown composition member ${ref} in ${spec.path}.`);
        for(const c of matching) {
          if(claimed.has(c.index))throw Error(`Duplicate composition member ${identity(c)} in ${spec.path}.`);
          claimed.add(c.index);members.push(c);
        }
      }
      // Internal address: one `.0.` separates authored groups from the source page they
      // group, and a subgroup nests past it. Published indexes are the map tree's (tree.mjs).
      const at=`${packet.index}${packet.kind==='group'?'':'.0'}.${i+1}`,path=`${spec.path}::@group/${g.id}`;
      groups.push({index:at,path,label:g.label??g.id,members,...(g.groups?{groups:g.groups}:{})});
    }
    assertConvex(packet,groups);
    const groupOf=new Map(groups.flatMap(g=>g.members.map(c=>[c.index,g])));
    const endpoint=end=>groupOf.get(end)?.index??end;
    const parentWires=base.filter(w=>!groupOf.has(w.from)||groupOf.get(w.from)!==groupOf.get(w.to))
      .map(w=>({...w,from:endpoint(w.from),to:endpoint(w.to)}));
    const projected=[];
    for(const c of packet.components) {
      const g=groupOf.get(c.index);
      if(!g){projected.push(c);continue;}
      if(projected.some(x=>x.index===g.index))continue;
      projected.push({index:g.index,path:g.path,label:g.label,kind:'group',members:g.members.map(identity),
        files:[...new Set(g.members.map(m=>m.file))],count:g.members.length});
    }
    for(const g of groups) {
      const memberIds=new Set(g.members.map(c=>c.index)),inputs=[],outputs=[],wires=[],boundary=[];
      for(const w of base) {
        const a=memberIds.has(w.from),b=memberIds.has(w.to);
        if(!a&&!b)continue;
        if(a&&b){wires.push(w);continue;}
        const direction=b?'in':'out',outside=b?w.from:w.to,port=`boundary:${w.edgeId}`;
        const outsideComponent=packet.components.find(c=>c.index===outside);
        const originalPort=[...(packet.inputs??[]),...(packet.outputs??[]),...(packet.ports??[])].find(p=>(p.port??p.index)===outside);
        const entry={port,name:w.label??originalPort?.name??outsideComponent?.label??outside,
          edgeId:w.edgeId,outside,parentEndpoint:endpoint(outside),...(outsideComponent?{index:outsideComponent.index,path:identity(outsideComponent)}:
            originalPort?.index?{index:originalPort.index,...(originalPort.path?{path:originalPort.path}:{})}:{})};
        (b?inputs:outputs).push(entry);
        wires.push({...w,from:b?port:w.from,to:a?port:w.to});
        boundary.push({edgeId:w.edgeId,direction,port,parentFrom:endpoint(w.from),parentTo:endpoint(w.to)});
      }
      const files=[...new Set(g.members.map(c=>c.file))];
      const memberPaths=new Set(g.members.map(identity));
      const memberRecords=field=>packet.structural?(packet[field]??[]).filter(item=>memberPaths.has(item.path)):[];
      const uncertainty=memberRecords('uncertainty'),unresolved=memberRecords('unresolved');
      // Structural diagnostics belong to the declaration that produced them. Local-flow
      // uncertainty belongs to the caller's analysis; a subgroup links that context once,
      // rather than copying every caller warning into every child as if it owned them.
      const contextual=field=>packet.structural?(packet[field]??[]).filter(item=>!item.path).length:(packet[field]??[]).length;
      const analysisContext={index:packet.index,path:spec.path,uncertainty:contextual('uncertainty'),unresolved:contextual('unresolved')};
      groupPages.set(g.index,{flow:true,generated:true,index:g.index,path:g.path,kind:'group',label:g.label,
        owner:spec.path,parent:packet.index,files,members:g.members.map(identity),codeTargets:g.members.map(identity),
        components:g.members,inputs,outputs,wires,gates:packet.gates??[],requires:[],formulas:[],calledFrom:[],couplings:[],
        ...(packet.stateFields?{stateFields:packet.stateFields.filter(f=>wires.some(w=>w.stateField===f.id))}:{}),
        ...(packet.invocationSites?{invocationSites:true,callBindings:(packet.callBindings??[]).filter(call=>memberPaths.has(call.callee))}:{}),
        unresolved,external:0,boundary,children:g.members.map(c=>({index:c.index,path:identity(c),label:c.label})),
        composition:{source:spec.source??'dev-map/flows.json',authored:['grouping','labels'],relations:'generated'},
        ...(packet.structural?{structural:true}:{}),
        ...(uncertainty.length?{uncertainty}:{}),
        ...(analysisContext.uncertainty||analysisContext.unresolved?{analysisContext}:{}),
        ...(packet.file?{file:packet.file,line:packet.line,endLine:packet.endLine,lines:packet.lines}:{})});
      if(g.groups) {
        const nested=composePages(new Map([[g.path,groupPages.get(g.index)]]),
          {schema:1,flows:[{path:g.path,groups:g.groups,source:spec.source}]},context);
        groupPages.set(g.index,nested.pages.get(g.path));
        for(const [at,child] of nested.groupPages)groupPages.set(at,child);
      }
    }
    const projectedPage={...packet,components:projected,wires:parentWires,
      ...(packet.stateFields?{stateFields:packet.stateFields.filter(f=>parentWires.some(w=>w.stateField===f.id))}:{}),
      ...(packet.kind==='group'?{children:projected.map(c=>({index:c.index,path:identity(c),label:c.label}))}:{}),
      composition:{source:spec.source??'dev-map/flows.json',authored:['grouping','labels'],relations:'generated',
        groups:groups.map(g=>({index:g.index,path:g.path,members:g.members.map(identity)})),
        edges:base.length,internal:base.length-parentWires.length,crossing:parentWires.length}};
    result.set(spec.path,projectedPage);
  }
  return {pages:result,groupPages};
}
