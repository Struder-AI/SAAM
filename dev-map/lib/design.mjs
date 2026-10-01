// Authored architecture is an intention, never evidence of implementation compliance.
// Reuse the map viewer, keeping contracts and conceptual nodes out of scanned leaves.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {guidanceSection} from '../../core/agent/manuals.mjs';
import {mapSet,setFile,setName} from './map-set.mjs';

// Explicit source references are previews, not implementation ownership or inferred calls.
async function sourceReferences(repo,nodes) {
  const sources={},spans=new Map(),sourceInfo={},root=await realpath(repo);
  for(const n of nodes.values()) {
    const s=n.source;if(!s)continue;
    if(typeof s.file!=='string'||isAbsolute(s.file)||s.file.includes('\\')||s.file.split('/').some(p=>!p||p==='.'||p==='..'))
      throw Error(`Invalid source path on ${n.id}`);
    const path=await realpath(resolve(root,s.file)).catch(e=>{if(s.optional&&e.code==='ENOENT')return null;throw e;});
    if(!path)continue;
    const within=relative(root,path);
    if(isAbsolute(within)||within==='..'||within.startsWith('..\\')||within.startsWith('../'))throw Error(`Source outside repository: ${s.file}`);
    const text=sources[s.file]??await readFile(path,'utf8');sources[s.file]=text;
    let start=0,end=text.length;
    if(s.heading&&s.declaration)throw Error(`Choose a heading or declaration on ${n.id}`);
    if(s.heading) {
      if(!s.file.endsWith('.md'))throw Error(`Heading requires Markdown: ${n.id}`);
      const section=guidanceSection(text,s.heading);start=text.indexOf(section);end=start+section.length;
    }
    if(s.declaration) {
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
    if(c.from===c.to)throw Error(`Self contract: ${c.id}`);
    if(c.overview!==undefined&&c.overview!=='response')throw Error(`Invalid overview direction: ${c.id}`);
    for(const field of ['label','direction','inputs','outputs','effects','failure','excludes'])
      if(typeof c[field]!=='string'||!c[field].trim())throw Error(`Missing ${field} on ${c.id}`);
    if(!Array.isArray(c.operations)||!c.operations.length||c.operations.some(x=>typeof x!=='string'))throw Error(`Missing operations: ${c.id}`);
  }
  const ancestor=(child,parent)=>parent==='0'||child===parent||child.startsWith(parent+'.');
  const endpoint=id=>nodes.get(id)?.index??`external:${id}`;
  const {sources,spans,sourceInfo}=await sourceReferences(repo,nodes);
  const pages=[];
  for(const p of [{index:'0',label:mapSet.title,description:spec.description},...nodes.values()]) {
    const children=[...nodes.values()].filter(n=>n.parent===p.index);
    const visible=new Map(children.map(n=>[n.index,n]));
    const inside=id=>nodes.has(id)&&ancestor(nodes.get(id).index,p.index);
    const lift=id=>{
      if(!inside(id))return endpoint(id);
      return children.find(n=>ancestor(nodes.get(id).index,n.index))?.index??p.index;
    };
    const links=new Map();
    for(const c of spec.contracts) {
      if(p.index!=='0'&&!inside(c.from)&&!inside(c.to))continue;
      const response=p.index==='0'&&c.overview==='response';
      const from=lift(response?c.to:c.from),to=lift(response?c.from:c.to);
      if(from===to)continue;
      for(const id of [c.from,c.to]) {
        const at=lift(id);
        if(!visible.has(at))visible.set(at,nodes.get(id)??{...actors.get(id),id,index:at,type:'actor'});
      }
      const key=`${from}\0${to}`,wire=links.get(key)??{from,to,contracts:[],count:0,kinds:{contract:0}};
      wire.contracts.push({...c,fromIndex:endpoint(c.from),toIndex:endpoint(c.to),status:c.status??'proposed; implementation unchecked'});
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
  const generatorFiles=['design.mjs','map-set.mjs','generated-view.mjs','generated-view.py','leveled.py','svg.py','flow.py','viewer.py','../../core/agent/manuals.mjs'];
  const generator=await Promise.all(generatorFiles.map(file=>readFile(resolve(repo,'dev-map/lib',file),'utf8')));
  const snapshotId=createHash('sha256').update(text+JSON.stringify(mapSet)+generator.join('\n')+JSON.stringify(sourceInfo)).digest('hex');
  return {design:true,title:mapSet.title,generated:spec.date,snapshotId,pages,sources,sourceInfo,stale:{},
    changed:[],changedInputs:[],scores:{},regenerate:`node dev-map/cli.mjs build --set ${setName}`};
}

export async function designCommand(command,args,{repo}) {
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
      }
    }
    console.log(JSON.stringify({mode:'design',valid:true,pages:model.pages.length,viewer:current?'current':'missing or stale',...(args.includes('--viewer')?{undrawn:missing}:{}),implementation:'unchecked; conformance scanner not implemented'}));
    if(missing.length)throw Error('Design viewer is missing boxes, wires or source previews.');
    if(!current)process.exitCode=1;
    // cli dispatch must preserve a failing check.
    if(!current)throw Error('Build this design set to refresh the viewer.');
    return;
  }
  throw Error('Design sets support read [INDEX|@design/ID|CONTRACT-ID], build, regenerate and check. Solving and code evidence require a scanned set.');
}
