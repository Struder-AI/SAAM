// A design set: authored architecture drawn with the map viewer. It is an intention, never
// evidence of implementation compliance.
import {readFile,writeFile,realpath,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
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
      const {guidanceSection}=await import('../../core/agent/manuals.mjs');
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

// Presentation only: authored IDs, ownership and contract endpoints stay intact.
// Small navigation groups add a click without enough internal structure to draw.
function flattenNavigation(nodes,protectedNodes) {
  const children=p=>[...nodes.values()].filter(n=>!n.collapsed&&n.parent===p.index);
  const inline=p=>{
    const held=children(p);p.contents=held.map(n=>n.index);
    for(const n of held)n.parent=p.parent;
    if(!protectedNodes.has(p.id))p.collapsed=true;
  };
  let changed=true;
  while(changed) {
    changed=false;
    for(const p of [...nodes.values()].sort((a,b)=>b.index.split('.').length-a.index.split('.').length)) {
      if(p.collapsed||p.parent==='0')continue;
      const count=children(p).length;
      if(!count&&!p.source&&!protectedNodes.has(p.id)){p.collapsed=true;changed=true;continue;}
      if(count&&count<6){inline(p);changed=true;}
    }
  }
  // Fixed responsibilities cannot disappear. Expand their smallest grouping
  // first; roots with only a few actual operations use a contents list.
  for(const root of nodes.values())if(root.parent==='0')while(children(root).length<6) {
    const groups=children(root).filter(n=>children(n).length).sort((a,b)=>children(a).length-children(b).length);
    if(!groups.length)break;
    inline(groups[0]);
  }
}

// Reads and viewer builds consume the same explicitly regenerated snapshot.
export async function designModel({repo}) {
  try {
    const model=JSON.parse(await readFile(resolve(repo,setFile('store/design.json')),'utf8'));
    const changed=await Promise.all(Object.entries(model.inputs).map(async([file,hash])=>{
      const text=await readFile(resolve(repo,file),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
      return createHash('sha256').update(text).digest('hex')===hash?null:file;
    }));
    model.changedInputs=changed.filter(Boolean);
    if(model.changedInputs.length)model.stale=Object.fromEntries(model.pages.map(p=>[p.index,{inputs:model.changedInputs,regenerate:model.regenerate}]));
    return model;
  }
  catch(error) {if(error.code==='ENOENT')throw Error('No stored design. Run node dev-map/cli.mjs regenerate --set '+setName);throw error;}
}

async function generateDesign({repo}) {
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
  const ancestor=(child,parent)=>{
    if(parent==='0')return true;
    for(let at=child;at&&at!=='0';at=indexes.get(at)?.parent)if(at===parent)return true;
    return false;
  };
  const endpoint=id=>nodes.get(id)?.index??`external:${id}`;
  const bindingText=await readFile(resolve(repo,setFile('interfaces.json')),'utf8').catch(e=>{if(e.code==='ENOENT')return '{"bindings":[]}';throw e;});
  const ownershipText=await readFile(resolve(repo,setFile('ownership.json')),'utf8').catch(error=>{
    if(error.code==='ENOENT'&&!spec.implementationLinks?.length)return '{"leaves":{}}';
    throw error;
  });
  const protectedNodes=new Set(spec.contracts.flatMap(c=>[c.from,c.to,...(c.access??[]).flatMap(a=>[a.from,a.to])]));
  const observed=await implementationLinks(repo,spec,nodes,{ownershipText});
  // Keep actual semantic owners visible even when they have no resolved caller;
  // flattening must not hide a disconnected operation that needs investigation.
  const semanticOwners=Object.values(JSON.parse(ownershipText).leaves).map(n=>n.owner);
  const observedEndpoints=new Set(observed.contracts.flatMap(c=>[c.from,c.to]));
  flattenNavigation(nodes,new Set([...protectedNodes,...semanticOwners,...observedEndpoints]));
  const bindings=[...(JSON.parse(bindingText).bindings??[]),...observed.bindings];
  const references=new Map(nodes);
  for(const b of bindings)references.set(b.target,{id:b.target,source:{file:b.target.split('::')[0]}});
  const {sources,spans,sourceInfo}=await sourceReferences(repo,references);
  const entries=await interfaceCode(repo,bindings,sources);
  const pages=[];
  for(const p of [{index:'0',label:mapSet.title,description:spec.description},...nodes.values()]) {
    const children=p.collapsed?[]:[...nodes.values()].filter(n=>!n.collapsed&&n.parent===p.index);
    const parentOf=n=>{let at=n.parent;while(indexes.get(at)?.collapsed)at=indexes.get(at).parent;return at;};
    if(p.collapsed) {
      pages.push({index:p.index,path:`@design/${p.id}`,kind:'group',label:p.label,description:p.description,design:true,leaves:0,parent:parentOf(p),
        destination:spans.has(p.id)?'code':'alias',...(spans.has(p.id)?{sourceSpan:spans.get(p.id)}:{aliasOf:parentOf(p)}),components:[],wires:[],ports:[],notes:p.notes??[]});
      continue;
    }
    const visible=new Map(children.map(n=>[n.index,n]));
    const inside=id=>nodes.has(id)&&ancestor(nodes.get(id).index,p.index);
    const lift=id=>{
      if(!inside(id)) {
        const at=nodes.get(id)?.index;
        if(!at)return endpoint(id);
        let lifted=at;
        while(indexes.get(lifted)?.parent&&indexes.get(lifted).parent!=='0'&&!ancestor(p.index,indexes.get(lifted).parent))lifted=indexes.get(lifted).parent;
        return lifted;
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
    // A retained semantic owner can expose its former children as a source list
    // while those children are drawn alongside it at their promoted home.
    if(!children.length&&!spans.has(p.id))for(const index of p.contents??[])if(indexes.has(index))visible.set(index,indexes.get(index));
    const components=[...visible].map(([index,n])=>({index,label:n.label,path:`@design/${n.id}`,
      kind:'concept',type:n.type,description:n.description,stateful:!!n.stateful,
      internal:children.some(child=>child.index===index),
      ...(spans.has(n.id)?{sourceSpan:spans.get(n.id)}:{}),
      ...(n.index!==p.index&&n.parent!==p.index&&nodes.has(n.id)?{home:n.parent}:{} )}));
    const wires=[...links.values()].map(w=>({...w,address:'@link/'+p.index+'/'+encodeURIComponent(w.from)+'/'+encodeURIComponent(w.to),label:w.contracts.length===1?w.contracts[0].label:`${w.contracts.length} contracts`}));
    const originalChildren=spec.nodes.filter(n=>n.index.includes('.')?n.index.slice(0,n.index.lastIndexOf('.'))===p.index:p.index==='0');
    const sameChildren=originalChildren.length===children.length&&originalChildren.every(n=>children.some(c=>c.index===n.index));
    const layout=sameChildren?spec.layout?.[p.index]??null:null;
    if(layout)for(const [index,point] of Object.entries(layout.positions??{})) {
      if(!visible.has(index)||![point.x,point.y].every(v=>Number.isFinite(v)))throw Error(`Invalid layout position ${p.index}: ${index}`);
    }
    pages.push({index:p.index,path:p.index==='0'?'0':`@design/${p.id}`,kind:p.index==='0'?'root':'group',
      label:p.label,description:p.description,design:true,parent:p.parent??null,stateful:!!p.stateful,destination:spans.has(p.id)&&!children.length?'code':p.index!=='0'&&children.length<6?'contents':'graph',leaves:0,
      ...(spans.has(p.id)?{sourceSpan:spans.get(p.id)}:{}),
      components,wires,ports:[],...(layout?{layout}:{}),notes:p.notes??[]});
  }
  const generatorFiles=['design.mjs','design-implementation.mjs','interface-code.mjs','graph.mjs','scope.mjs','map-set.mjs','generated-view.mjs','generated-view.py','leveled.py','svg.py','flow.py','viewer.py','../../core/agent/manuals.mjs'];
  const generator=await Promise.all(generatorFiles.map(file=>readFile(resolve(repo,'dev-map/lib',file),'utf8')));
  const snapshotId=createHash('sha256').update(text+bindingText+observed.ownershipText+JSON.stringify(mapSet)+generator.join('\n')+JSON.stringify(sourceInfo)).digest('hex');
  const inputFiles=[...new Set([setFile('architecture.json'),setFile('interfaces.json'),setFile('ownership.json'),setFile('map.json'),...generatorFiles.map(file=>relative(repo,resolve(repo,'dev-map/lib',file)).replaceAll('\\','/')),...Object.keys(sources)])];
  const inputs=Object.fromEntries(await Promise.all(inputFiles.map(async file=>[file,createHash('sha256').update(await readFile(resolve(repo,file),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})).digest('hex')])));
  return {inputs,design:true,title:mapSet.title,generated:spec.date,snapshotId,pages,sources,sourceInfo,stale:{},
    changed:[],changedInputs:[],scores:{},regenerate:`node dev-map/cli.mjs regenerate --set ${setName}`};
}

export async function designCommand(command,args,{repo}) {
  const refresh=command==='regenerate';
  const model=refresh?await generateDesign({repo}):await designModel({repo});
  if(refresh) {
    await mkdir(resolve(repo,setFile('store')),{recursive:true});
    await writeFile(resolve(repo,setFile('store/design.json')),JSON.stringify(model));
  }
  if(command==='build'||command==='regenerate') {
    const {buildGeneratedView}=await import('./generated-view.mjs');
    const result=await buildGeneratedView({repo});
    await writeFile(resolve(repo,setFile('view/design-stamp.json')),JSON.stringify({snapshotId:model.snapshotId}));
    console.log(JSON.stringify({...result,mode:'design',implementation:'unchecked'}));return;
  }
  if(command==='check') {
    const built=JSON.parse(await readFile(resolve(repo,setFile('view/design-stamp.json')),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
    const current=built.snapshotId===model.snapshotId&&!model.changedInputs.length;
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
        if(page.destination!=='graph')continue;
        const script=await readFile(resolve(repo,setFile(`view/svg/${page.index}.js`)),'utf8');
        const [,svg]=JSON.parse(`[${script.slice(6,-1)}]`);
        for(const c of page.components)if(!svg.includes(`data-id="${c.index}"`))missing.push(`${page.index}: box ${c.index}`);
        // One wire per pair: a two-headed wire also draws the reverse direction.
        for(const w of page.wires)if(!svg.includes(`data-a="${w.from}" data-b="${w.to}"`)&&!svg.includes(`data-a="${w.to}" data-b="${w.from}" data-ends="both"`))missing.push(`${page.index}: wire ${w.from} -> ${w.to}`);
        if(JSON.stringify(pages[page.index]?.contracts)!==JSON.stringify(page.wires))missing.push(`${page.index}: interface code`);
      }
    }
    console.log(JSON.stringify({mode:'design',valid:true,pages:model.pages.length,viewer:current?'current':'missing or stale',...(args.includes('--viewer')?{undrawn:missing}:{})}));
    if(missing.length)throw Error('Design viewer is missing boxes, wires or source previews.');
    if(!current)process.exitCode=1;
    // cli dispatch must preserve a failing check.
    if(!current)throw Error('Build this design set to refresh the viewer.');
    return;
  }
  throw Error('Design sets support read, regenerate, build and check [--viewer].');
}
