// Authorship selects containment only. Every displayed endpoint, gate and relationship
// comes from a generated packet or scanner relation; boundaries are cut from those edges.
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {destinationFor} from './destination.mjs';

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
const outermost=n=>{let node=n;while(node.parent)node=node.parent;return node;};
const allowed=(value,keys,where)=>{
  for(const key of Object.keys(value))if(!keys.includes(key))throw Error(`Composition ${where}: unsupported field ${key}.`);
};

// A region composition operates on the flow roots of that region: where its work starts. Every
// other declaration belongs to the flow that reaches it, and its links here contract onto the
// root that owns that flow. Calls remain calls (not imaginary returned-value wires); exact
// evidence survives contraction.
function structural(page,{model,index,packets}) {
  const region=model.regions.find(r=>r.path===page.path);
  const files=page.files,inside=new Set(files);
  const nodes=model.regionBoxes.get(region.index);
  const held=new Map(model.nodes.filter(n=>inside.has(n.file))
    .map(n=>[n.path,model.ownerRoot.get(n.path)??outermost(n).path]));
  const components=nodes.map(n=>({index:index.get(n.path),path:n.path,label:n.path.slice(n.file.length+2),
    file:n.file,line:n.line,endLine:n.endLine,lines:n.endLine-n.line+1,
    ...(packets.has(n.path)&&destinationFor(packets.get(n.path))==='graph'?{}:{leaf:true})}));
  // Module-only source declares nothing, so no flow root can stand for it. It is still part of
  // the region: its recorded module-level calls/couplings use the file endpoint, and missing
  // callback analysis stays explicit.
  for(const file of files)if(!model.nodes.some(n=>n.file===file))components.push({
    index:index.get(file),path:file,file,label:file.slice(file.lastIndexOf('/')+1),kind:'file',
    line:1,endLine:contextLines(model,file),leaf:true,moduleOnly:true});
  const shown=new Set(components.map(c=>c.index)),inputs=[],outputs=[],wires=[];
  const port=(end,direction)=>{
    const list=direction==='in'?inputs:outputs,key=`${direction}:${end}`;
    if(!list.some(p=>p.port===key))list.push({port:key,name:end,index:index.get(end)??null,path:end});
    return key;
  };
  const add=(end,target,kind,label,evidence)=>{
    const from=held.get(end)??end,to=held.get(target)??target;
    const a=index.get(from),b=index.get(to),hasA=shown.has(a),hasB=shown.has(b);
    if(!hasA&&!hasB)return;
    // A declaration calling a helper it holds is that declaration's own page, not a loop here.
    if(hasA&&hasB&&a===b)return;
    wires.push({from:hasA?a:port(from,'in'),to:hasB?b:port(to,'out'),kind,
      ...(label?{label}:{}),evidence});
  };
  for(const c of model.calls)add(c.from?.path??c.fromFile??'<external>',c.to.path,c.relation.kind,c.label,
    {file:c.fromFile,line:c.line,start:c.start});
  for(const c of model.couplings)add(c.from?.path??c.fromFile??'<external>',c.to?.path??c.toFile??'<external>',c.kind,c.label,
    {file:c.fromFile,line:c.line});
  // Where this scope's code reaches out of the map. The port names the scanned root, not a box:
  // outside code has no address here, and the wire ends in that name.
  for(const c of model.outsideCalls) {
    if(!inside.has(c.fromFile))continue;
    const from=index.get(held.get(c.from?.path)??c.from?.path??c.fromFile);
    if(!shown.has(from))continue;
    const key=`out:${c.root}`;
    if(!outputs.some(p=>p.port===key))outputs.push({port:key,name:c.root,unmapped:true,outside:true});
    wires.push({from,to:key,kind:'call',evidence:{file:c.fromFile,line:c.line,start:c.start}});
  }
  // A finding belongs to the node it is about. It is drawn on that node's box here, and the
  // rows themselves stay whole on the node's own page; nothing is rolled up into a count.
  const memberPackets=[...held.keys()].map(path=>packets.get(path)).filter(Boolean);
  return {...page,components,inputs,outputs,wires,gates:[],ports:[],requires:[],formulas:[],calledFrom:[],couplings:[],
    unresolved:page.unresolved??[],...(page.uncertainty?{uncertainty:page.uncertainty}:{}),
    platform:(page.platform??0)+memberPackets.reduce((n,p)=>n+(p.platform??0),0),
    outside:page.outside??memberPackets.reduce((n,p)=>n+(p.outside??0),0),files,structural:true};
}

function contextLines(model,file) { return model.fileLines?.get(file)??1; }

export function composePages(pages,config,context) {
  allowed(config,['schema','flows'],'root');
  if(config.schema!==1||!Array.isArray(config.flows))throw Error('Composition needs schema 1 and flows.');
  const result=new Map(pages),groupPages=new Map(),seen=new Set();
  const holder=new Map((context.model?.nodes??[]).filter(n=>n.parent).map(n=>[n.path,n.parent.path]));
  for(const spec of config.flows) {
    allowed(spec,['path','groups','source'],'flow');
    const requireStableReference=ref=>{
      if(/<(?:callback|callable|return)@\d+:\d+>/.test(ref))
        throw Error(`Source-position composition reference ${ref}: give the stage a code binding name before authoring its grouping.`);
    };
    requireStableReference(spec.path);
    if(seen.has(spec.path))throw Error(`Duplicate composition ${spec.path}.`);seen.add(spec.path);
    const original=pages.get(spec.path);if(!original)throw Error(`Unknown composition page ${spec.path}.`);
    const owner=original.owner??spec.path;
    if(!Array.isArray(spec.groups)||!spec.groups.length)throw Error(`Composition ${spec.path} has no groups.`);
    const packet=original.kind==='region'?structural(original,context):structuredClone(original);
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
        // A member is a declaration, never a file. Where the code is written is not a place in
        // the map, so a file path selects nothing to group.
        if(!ref.includes('::'))throw Error(`Composition member ${ref} in ${spec.path} is a file path. A member is a declaration path; name the declarations to group.`);
        // A nested declaration is placed by the declaration that holds it, so only that
        // declaration's own page can group it. Elsewhere it is not a member to author.
        const parent=holder.get(ref);
        if(parent&&parent!==owner)throw Error(`Composition member ${ref} in ${spec.path}: ${parent} already places it. Group it on that declaration's page, or group ${parent} here.`);
        const c=byIdentity.get(ref);
        if(!c)throw Error(`Unknown composition member ${ref} in ${spec.path}.`);
        if(claimed.has(c.index))throw Error(`Duplicate composition member ${identity(c)} in ${spec.path}.`);
        claimed.add(c.index);members.push(c);
      }
      // Internal address: one `.0.` separates authored groups from the source page they
      // group, and a subgroup nests past it. Published indexes are the map tree's (tree.mjs).
      const at=`${packet.index}${packet.kind==='group'?'':'.0'}.${i+1}`,path=`${spec.path}::@group/${g.id}`;
      groups.push({index:at,path,label:g.label??g.id,members,...(g.groups?{groups:g.groups}:{})});
    }
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
      // Structural diagnostics belong to the declaration that produced them, and are drawn on
      // that declaration's box. Local-flow uncertainty belongs to the caller's analysis; a
      // subgroup links that context once, rather than copying every caller warning into it.
      const contextual=field=>packet.structural?(packet[field]??[]).filter(item=>!item.path).length:(packet[field]??[]).length;
      const analysisContext={index:packet.index,path:spec.path,uncertainty:contextual('uncertainty'),unresolved:contextual('unresolved')};
      groupPages.set(g.index,{flow:true,generated:true,index:g.index,path:g.path,kind:'group',label:g.label,
        owner:spec.path,parent:packet.index,files,members:g.members.map(identity),codeTargets:g.members.map(identity),
        components:g.members,inputs,outputs,wires,gates:packet.gates??[],requires:[],formulas:[],calledFrom:[],couplings:[],
        ...(packet.stateFields?{stateFields:packet.stateFields.filter(f=>wires.some(w=>w.stateField===f.id))}:{}),
        ...(packet.invocationSites?{invocationSites:true,callBindings:(packet.callBindings??[]).filter(call=>memberPaths.has(call.callee))}:{}),
        unresolved:[],platform:0,outside:0,boundary,children:g.members.map(c=>({index:c.index,path:identity(c),label:c.label})),
        composition:{source:spec.source??'dev-map/flows.json',authored:['grouping','labels'],relations:'generated'},
        ...(packet.structural?{structural:true}:{}),
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
