// Authored architecture is an intention, never evidence of implementation compliance.
// Reuse the map viewer, keeping contracts and conceptual nodes out of scanned leaves.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {guidanceSection} from '../../core/agent/manuals.mjs';
import {mapSet,setFile,setName} from './map-set.mjs';
import {interfaceCode} from './interface-code.mjs';
import {extractGraph} from './graph.mjs';
import {implementationLinks} from './design-implementation.mjs';

// Explicit source references are previews, not implementation ownership or inferred calls.
async function sourceReferences(repo,nodes) {
  const sources={},spans=new Map(),sourceInfo={},root=await realpath(repo);
  for(const n of nodes.values()) {
    const s=n.source;if(!s)continue;
    if(typeof s.file!=='string'||isAbsolute(s.file)||s.file.includes('\\')||s.file.split('/').some(p=>!p||p==='.'||p==='..'))
      throw Error(`Invalid source path on ${n.id}`);
    if(sources[s.file]!==undefined)continue;
    const path=await realpath(resolve(root,s.file)).catch(e=>{if(s.optional&&e.code==='ENOENT')return null;throw e;});
    if(!path)continue;
    const within=relative(root,path);
    if(isAbsolute(within)||within==='..'||within.startsWith('..\\')||within.startsWith('../'))throw Error(`Source outside repository: ${s.file}`);
    sources[s.file]=await readFile(path,'utf8');
  }
  const declarationFiles=[...new Set([...nodes.values()].filter(n=>n.source?.declaration&&sources[n.source.file]!==undefined).map(n=>n.source.file))];
  const graph=declarationFiles.length?await extractGraph({repo,files:declarationFiles,readSource:file=>sources[file]}):{declarations:[]};
  const declarations=new Map(graph.declarations.filter(d=>d.anchor&&!d.ambiguousAnchor).map(d=>[d.anchor,d]));
  for(const n of nodes.values()) {
    const s=n.source;if(!s||sources[s.file]===undefined)continue;
    const text=sources[s.file];
    let start=0,end=text.length;
    if(s.heading&&s.declaration)throw Error(`Choose a heading or declaration on ${n.id}`);
    if(s.heading) {
      if(!s.file.endsWith('.md'))throw Error(`Heading requires Markdown: ${n.id}`);
      const section=guidanceSection(text,s.heading);start=text.indexOf(section);end=start+section.length;
    }
    if(s.declaration) {
      const exact=declarations.get(`${s.file}::${s.declaration}`);
      if(exact)({start,end}=exact);
      else {
        // Legacy source references can name a declaration whose published
        // scanner identity is a record member. Keep that unique-name form.
        const found=[];
        const walk=node=>{
          if(!node||typeof node!=='object')return;
          if(['FunctionDeclaration','ClassDeclaration','VariableDeclarator'].includes(node.type)&&node.id?.name===s.declaration)found.push(node);
          for(const child of Object.values(node))if(Array.isArray(child))child.forEach(walk);else if(child?.type)walk(child);
        };
        walk(parse(text,{ecmaVersion:'latest',sourceType:'module'}));
        if(found.length!==1)throw Error(`Source declaration must match once: ${s.file}::${s.declaration} (${found.length})`);
        ({start,end}=found[0]);
      }
    }
    const sha256=createHash('sha256').update(text).digest('hex');
    const span={file:s.file,line:text.slice(0,start).split('\n').length,endLine:text.slice(0,end).replace(/\r?\n$/,'').split('\n').length,
      sha256,kind:s.file.endsWith('.md')?'document':'source',...(s.heading?{heading:s.heading}:{}),...(s.declaration?{declaration:s.declaration}:{})};
    sourceInfo[s.file]={sourceKind:'snapshot',sourceSha256:sha256};spans.set(n.id,span);
  }
  return {sources,spans,sourceInfo};
}

export async function designModel({repo}) {
  const text=await readFile(resolve(repo,setFile('architecture.json')),'utf8');
  const spec=JSON.parse(text),nodes=new Map(),indexes=new Map();
  for(const n of spec.nodes) {
    if(!/^[a-z][a-z0-9-]*$/.test(n.id)||nodes.has(n.id))throw Error(`Invalid/duplicate design id: ${n.id}`);
    if(!/^[1-9]\d*(\.[1-9]\d*)*$/.test(n.index)||indexes.has(n.index))throw Error(`Invalid/duplicate index: ${n.index}`);
    if(!['component','guidance','actor','service'].includes(n.type)||!n.label||!n.description)throw Error(`Incomplete node: ${n.id}`);
    nodes.set(n.id,n);indexes.set(n.index,n);
  }
  for(const n of nodes.values()) {
    const parent=n.index.includes('.')?n.index.slice(0,n.index.lastIndexOf('.')):'0';
    if(parent!=='0'&&!indexes.has(parent))throw Error(`Missing parent for ${n.id}`);
    n.parent=parent;
  }
  const actors=new Map(Object.entries(spec.actors??{}));
  for(const [id,a] of actors)if(nodes.has(id)||!a.label||!a.description)throw Error(`Invalid actor: ${id}`);
  const ids=new Set();
  for(const c of spec.contracts) {
    if(!/^[a-z][a-z0-9-]*$/.test(c.id)||ids.has(c.id))throw Error(`Invalid/duplicate contract: ${c.id}`);
    ids.add(c.id);
    for(const end of [c.from,c.to])if(!nodes.has(end)&&!actors.has(end))throw Error(`Unknown endpoint ${end} on ${c.id}`);
    for(const a of c.access??[])for(const end of [a.from,a.to]) {
      if(!nodes.has(end)&&!actors.has(end))throw Error(`Unknown access endpoint ${end} on ${c.id}`);
      if(![c.from,c.to].includes(end))throw Error(`Access must stay on the drawn interface: ${c.id}`);
    }
    if(c.from===c.to)throw Error(`Self contract: ${c.id}`);
    if(c.overview!==undefined&&c.overview!=='response')throw Error(`Invalid overview direction: ${c.id}`);
    for(const field of ['label','direction','inputs','outputs','effects','failure','excludes'])
      if(typeof c[field]!=='string'||!c[field].trim())throw Error(`Missing ${field} on ${c.id}`);
    if(!Array.isArray(c.operations)||!c.operations.length||c.operations.some(x=>typeof x!=='string'))throw Error(`Missing operations: ${c.id}`);
  }
  const ancestor=(child,parent)=>parent==='0'||child===parent||child.startsWith(parent+'.');
  const endpoint=id=>nodes.get(id)?.index??`external:${id}`;
  const bindingText=await readFile(resolve(repo,setFile('interfaces.json')),'utf8').catch(e=>{if(e.code==='ENOENT')return '{"bindings":[]}';throw e;});
  const observed=await implementationLinks(repo,spec,nodes);
  const bindings=[...(JSON.parse(bindingText).bindings??[]),...observed.bindings];
  const references=new Map(nodes);
  for(const b of bindings)references.set(b.target,{id:b.target,source:{file:b.target.split('::')[0]}});
  const {sources,spans,sourceInfo}=await sourceReferences(repo,references);
  const entries=await interfaceCode(repo,bindings,sources);
  const pages=[];
  for(const p of [{index:'0',label:mapSet.title,description:spec.description},...nodes.values()]) {
    const children=[...nodes.values()].filter(n=>n.parent===p.index);
    const visible=new Map(children.map(n=>[n.index,n]));
    const inside=id=>nodes.has(id)&&ancestor(nodes.get(id).index,p.index);
    const lift=id=>{
      if(!inside(id)) {
        const at=nodes.get(id)?.index;
        if(!at)return endpoint(id);
        const parts=at.split('.'),here=p.index.split('.');let common=0;
        while(common<parts.length&&parts[common]===here[common])common++;
        return parts.slice(0,common+1).join('.');
      }
      return children.find(n=>ancestor(nodes.get(id).index,n.index))?.index??p.index;
    };
    const links=new Map();
    for(const c of [...spec.contracts,...observed.contracts]) {
      if(p.index==='0'&&c.detailOnly)continue;
      if(p.index!=='0'&&!inside(c.from)&&!inside(c.to))continue;
      const response=p.index==='0'&&c.overview==='response';
      const from=lift(response?c.to:c.from),to=lift(response?c.from:c.to);
      if(from===to)continue;
      for(const id of [c.from,c.to]) {
        const at=lift(id);
        if(!visible.has(at))visible.set(at,indexes.get(at)??nodes.get(id)??{...actors.get(id),id,index:at,type:'actor'});
      }
      const key=`${from}\0${to}`,wire=links.get(key)??{from,to,contracts:[],count:0,kinds:{contract:0}};
      wire.contracts.push({...c,code:bindings.filter(b=>b.contract===c.id).map(b=>entries.get(b.target)),fromIndex:endpoint(c.from),toIndex:endpoint(c.to),...(c.access?{access:c.access.map(a=>({...a,fromIndex:endpoint(a.from),toIndex:endpoint(a.to)}))}:{}),status:c.status??'proposed; implementation unchecked'});
      wire.count++;wire.kinds.contract++;links.set(key,wire);
    }
    // Unbound terminal concepts retain their intent page; bound terminals preview source.
    if(!children.length&&p.index!=='0')visible.set(p.index,p);
    const components=[...visible].map(([index,n])=>({index,label:n.label,path:`@design/${n.id}`,
      kind:'concept',type:n.type,description:n.description,stateful:!!n.stateful,
      ...(spans.has(n.id)?{sourceSpan:spans.get(n.id)}:{}),
      ...(n.index!==p.index&&n.parent!==p.index&&nodes.has(n.id)?{home:n.parent}:{} )}));
    const wires=[...links.values()].map(w=>({...w,label:w.contracts.length===1?w.contracts[0].label:`${w.contracts.length} contracts`}));
    const layout=spec.layout?.[p.index];
    if(layout)for(const [index,point] of Object.entries(layout.positions??{})) {
      if(!visible.has(index)||![point.x,point.y].every(v=>Number.isFinite(v)&&v>=0))throw Error(`Invalid layout position ${p.index}: ${index}`);
    }
    pages.push({index:p.index,path:p.index==='0'?'0':`@design/${p.id}`,kind:p.index==='0'?'root':'group',
      label:p.label,description:p.description,design:true,stateful:!!p.stateful,destination:spans.has(p.id)&&!children.length?'code':'graph',leaves:0,
      ...(spans.has(p.id)?{sourceSpan:spans.get(p.id)}:{}),
      components,wires,ports:[],...(layout?{layout}:{}),notes:p.notes??[]});
  }
  const generatorFiles=['design.mjs','design-implementation.mjs','interface-code.mjs','graph.mjs','map-set.mjs','generated-view.mjs','generated-view.py','leveled.py','svg.py','flow.py','viewer.py','../../core/agent/manuals.mjs'];
  const generator=await Promise.all(generatorFiles.map(file=>readFile(resolve(repo,'dev-map/lib',file),'utf8')));
  const audit=JSON.parse(await readFile(resolve(repo,setFile('view/audit-status.json')),'utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;}));
  const snapshotId=createHash('sha256').update(text+bindingText+observed.ownershipText+JSON.stringify(mapSet)+generator.join('\n')+JSON.stringify(sourceInfo)+JSON.stringify(audit&&{generated:audit.generated,totals:audit.totals})).digest('hex');
  return {design:true,auditAvailable:!!audit,audit,title:mapSet.title,generated:spec.date,snapshotId,pages,sources,sourceInfo,stale:{},
    changed:[],changedInputs:[],scores:{},regenerate:`node dev-map/cli.mjs build --set ${setName}`};
}

export async function designCommand(command,args,{repo}) {
  if(['audit','inventory','audit-check'].includes(command)) {
    const {architectureAudit,auditStatus}=await import('./architecture-audit.mjs');
    const result=command==='audit-check'?await auditStatus(repo):await architectureAudit(repo,{inventoryOnly:command==='inventory'});
    if(command==='audit-check')await writeFile(resolve(repo,setFile('view/audit-status.json')),JSON.stringify(result));
    console.log(JSON.stringify(result));
    if(command==='audit-check'&&result.state!=='current')throw Error('Architecture audit missing or stale; run audit.');
    return;
  }
  const model=await designModel({repo});
  if(command==='read') {
    if(args.includes('--code'))throw Error('A design has no scanned code. Use --source for an explicit source reference.');
    const address=args.find(a=>!a.startsWith('--'))??'0';
    const contract=model.pages.flatMap(p=>p.wires.flatMap(w=>w.contracts)).find(c=>c.id===address);
    const page=model.pages.find(p=>p.index===address||p.path===address);
    if(!contract&&!page)throw Error(`No design node or contract ${address}`);
    const result=contract??page;
    if(args.includes('--source')) {
      if(!page?.sourceSpan)throw Error(`No source reference on ${address}`);
      const s=page.sourceSpan;console.log(JSON.stringify({...result,source:model.sources[s.file].split('\n').slice(s.line-1,s.endLine).join('\n')},null,2));
    } else console.log(JSON.stringify(result,null,2));return;
  }
  if(command==='build'||command==='regenerate') {
    const {buildGeneratedView}=await import('./generated-view.mjs');
    const result=await buildGeneratedView({repo});
    await writeFile(resolve(repo,setFile('view/design-stamp.json')),JSON.stringify({snapshotId:model.snapshotId}));
    console.log(JSON.stringify({...result,mode:'design',implementation:'unchecked'}));return;
  }
  if(command==='check') {
    const built=JSON.parse(await readFile(resolve(repo,setFile('view/design-stamp.json')),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
    const current=built.snapshotId===model.snapshotId;
    const missing=[];
    if(args.includes('--viewer')&&current) {
      const html=await readFile(resolve(repo,setFile('view/index.html')),'utf8');
      const pages=JSON.parse(html.match(/const PAGES=(.*);\r?\nconst BUILT=/)?.[1]??'{}');
      const sourceScript=await readFile(resolve(repo,setFile('view/sources.js')),'utf8');
      const sources=JSON.parse(sourceScript.slice(7,-1));
      for(const [file,text] of Object.entries(model.sources))if(sources[file]!==text)missing.push(`${file}: source snapshot`);
      for(const page of model.pages) {
        const span=page.sourceSpan;
        if(pages[page.index]?.destination!==page.destination)missing.push(`${page.index}: destination`);
        if(span&&(pages[page.index]?.r!==`${span.file}:${span.line}-${span.endLine}`||sources[span.file]!==model.sources[span.file]))
          missing.push(`${page.index}: source preview`);
        if(page.destination==='code')continue;
        const script=await readFile(resolve(repo,setFile(`view/svg/${page.index}.js`)),'utf8');
        const [,svg]=JSON.parse(`[${script.slice(6,-1)}]`);
        for(const c of page.components)if(!svg.includes(`data-id="${c.index}"`))missing.push(`${page.index}: box ${c.index}`);
        for(const w of page.wires)if(!svg.includes(`data-a="${w.from}" data-b="${w.to}"`))missing.push(`${page.index}: wire ${w.from} -> ${w.to}`);
        if(JSON.stringify(pages[page.index]?.contracts)!==JSON.stringify(page.wires))missing.push(`${page.index}: interface code`);
      }
    }
    console.log(JSON.stringify({mode:'design',valid:true,pages:model.pages.length,viewer:current?'current':'missing or stale',...(args.includes('--viewer')?{undrawn:missing}:{}),implementation:model.auditAvailable?'partial map 0 audit available; run audit-check for freshness':'unchecked; no audit snapshot'}));
    if(missing.length)throw Error('Design viewer is missing boxes, wires or source previews.');
    if(!current)process.exitCode=1;
    // cli dispatch must preserve a failing check.
    if(!current)throw Error('Build this design set to refresh the viewer.');
    return;
  }
  throw Error('Design sets support read [INDEX|@design/ID|CONTRACT-ID], build, regenerate, check, inventory, audit and audit-check. Solving requires a scanned set.');
}
