import {isMapped} from './scope.mjs';

const mapped=isMapped;
const positional=/<callback@\d+:\d+>/;
const callable=d=>['function','class','method','handler'].includes(d.kind)||!!d.callable;
const dirname=file=>file.slice(0,file.lastIndexOf('/'));
const order=(a,b)=>a<b?-1:a>b?1:0;
const fail=message=>{throw Error(message);};
export const qualifies=d=>mapped(d.file)&&!!d.anchor&&!d.ambiguousAnchor&&!positional.test(d.anchor)&&callable(d);

// Identity is the declaration path. Handles are positions in this scan and are stored nowhere.
export function projectGraph(graph) {
  const byId=new Map(graph.declarations.map(d=>[d.id,d])),relation=new Map(graph.relations.map(r=>[r.id,r]));
  const files=graph.files.filter(f=>mapped(f.file)).map(f=>f.file).sort(order),lines=new Map(graph.files.map(f=>[f.file,f.lines]));
  const nodes=new Map(),owner=new Map();
  const add=node=>{nodes.set(node.path,node);return node;};
  const moduleNode=file=>nodes.get(file)??add({path:file,label:file.slice(file.lastIndexOf('/')+1),kind:'module',file,line:1,endLine:lines.get(file)??null,
    enclosedCount:0,page:dirname(file),parent:null,start:-1,children:[]});
  for(const d of graph.declarations)if(qualifies(d))owner.set(d.id,add({path:d.anchor,label:d.name,kind:d.kind==='variable'?'function':d.kind,file:d.file,
    line:d.line,endLine:d.endLine,enclosedCount:0,page:dirname(d.file),parent:null,start:d.start,children:[]}));
  function nodeFor(d) {
    if(!mapped(d.file))return {external:d.file};
    if(!owner.has(d.id)) {const parent=byId.get(d.parent);owner.set(d.id,parent?nodeFor(parent):moduleNode(d.file));}
    return owner.get(d.id);
  }
  for(const d of graph.declarations)if(mapped(d.file)) {
    if(qualifies(d)) {const parent=byId.get(d.parent),node=owner.get(d.id);node.parent=parent?nodeFor(parent):null;if(node.parent?.kind==='module')node.parent=null;
      node.label=node.path.slice((node.parent?.path??node.file).length+2);}
    else nodeFor(d).enclosedCount++;
  }
  const endpoint=id=>{const d=byId.get(id);if(d)return nodeFor(d);const file=id.slice(0,id.lastIndexOf(':<module>'));return mapped(file)?moduleNode(file):{external:file};};
  const names=r=>r.kind==='call'||r.kind==='construct'?(r.args??[]).map((a,i)=>r.params?.[i]??a)
    :r.kind==='value-flow'?[relation.get(r.path?.[1])?.params?.[r.argument]]:r.kind==='return-value'?[r.result]
    :r.label?[r.label]:r.kind==='state-write'?[byId.get(r.to)?.name]:r.kind==='state-read'?[byId.get(r.from)?.name]:[];
  const pairs=new Map();
  for(const r of graph.relations) {
    const src=endpoint(r.from),dst=endpoint(r.to);
    if(src===dst||src.external&&dst.external)continue;
    const key=`${src.path??'ext:'+src.external}\n${dst.path??'ext:'+dst.external}`;
    let e=pairs.get(key);if(!e)pairs.set(key,e={src,dst,kinds:new Set(),names:new Set(),relations:[]});
    e.kinds.add(r.kind);e.relations.push(r);for(const name of names(r))if(name)e.names.add(name);
  }
  const edges=[...pairs.values()].map(e=>({src:e.src,dst:e.dst,kinds:[...e.kinds].sort(order),label:[...e.names].join(', '),relations:e.relations}));
  const pages=new Map([['.',{key:'.',handle:'0',parent:null,children:[],files:[]}]]);
  [...new Set(files.map(dirname))].sort(order).forEach((key,i)=>pages.set(key,{key,handle:String(i+1),children:[],files:[]}));
  for(const page of pages.values())if(page.key!=='.') {
    let parent=page.key;do parent=parent.includes('/')?dirname(parent):'.';while(!pages.has(parent));
    page.parent=parent;pages.get(parent).children.push(page.key);
  }
  const handles=new Map();
  function number(list,prefix,from=1) {list.sort((a,b)=>a.start-b.start).forEach((n,i)=>{n.handle=`${prefix}.${i+from}`;handles.set(n.handle,n);number(n.children,n.handle);});}
  for(const node of nodes.values())node.parent?.children.push(node);
  for(const file of files) {
    const page=pages.get(dirname(file)),handle=`${page.handle}.${page.files.length+1}`;page.files.push({file,handle});
    const top=[...nodes.values()].filter(n=>n.file===file&&!n.parent);
    number(top,handle,top.some(n=>n.kind==='module')?0:1);
  }
  const all=[...nodes.values()].sort((a,b)=>order(a.file,b.file)||a.start-b.start);
  const largest=[...pages.values()].map(p=>({page:p.key,nodes:all.filter(n=>n.page===p.key).length})).sort((a,b)=>b.nodes-a.nodes)[0];
  // `owner` maps a declaration id to the node that represents it, for readers that need
  // per-relation endpoints rather than the merged edges.
  return {pages,nodes,handles,edges,all,owner,totals:{pages:pages.size-1,files:files.length,nodes:all.filter(n=>n.kind!=='module').length,
    moduleNodes:all.filter(n=>n.kind==='module').length,enclosed:all.reduce((sum,n)=>sum+n.enclosedCount,0),edges:edges.length,largestPage:largest,
    ...(graph.couplings?{couplings:{linked:graph.couplings.linked,unlinked:graph.couplings.unlinked.reduce((out,u)=>{const k=`${u.kind}: ${u.reason}`;out[k]=(out[k]??0)+1;return out;},{})}}:{})}};
}

export function select(projection,target) {
  const key=String(target).replaceAll('\\','/').replace(/\/$/,'')||'.';
  if(/^\d+(\.\d+)*$/.test(key)) {
    const parts=key.split('.'),page=[...projection.pages.values()].find(p=>p.handle===parts[0])??fail(`Unknown generated page handle ${parts[0]}`);
    if(parts.length===1)return {page};
    const file=page.files.find(f=>f.handle===parts.slice(0,2).join('.'))??fail(`Unknown generated file handle ${key}`);
    return parts.length===2?{page,file:file.file}:{page,node:projection.handles.get(key)??fail(`Unknown generated handle ${key}`)};
  }
  if(projection.pages.has(key))return {page:projection.pages.get(key)};
  const node=projection.nodes.get(key);
  if(key.includes('::'))return node?{page:projection.pages.get(node.page),node}:fail(`No generated node ${key}; it is absent, ambiguous, position-based or enclosed.`);
  const page=projection.pages.get(dirname(key));
  return page?.files.some(f=>f.file===key)?{page,file:key}:fail(`Unknown generated page, file or declaration ${key}; pages: ${[...projection.pages.keys()].join(', ')}`);
}
