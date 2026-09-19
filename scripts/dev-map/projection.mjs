import {fileURLToPath} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {parse} from 'acorn';
import {extractGraph,sourceFiles} from './graph.mjs';
import {importAliases} from './generate.mjs';

const mapped=file=>/^(core|studio)\//.test(file);
const positional=/<callback@\d+:\d+>/;
const callable=d=>['function','class','method','handler'].includes(d.kind)||!!d.callable;
const dirname=file=>file.slice(0,file.lastIndexOf('/'));
const within=(page,key)=>key==='.'||page===key||page.startsWith(key+'/');
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
  return {pages,nodes,handles,edges,all,totals:{pages:pages.size-1,files:files.length,nodes:all.filter(n=>n.kind!=='module').length,
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

export function generatedContext(projection,target,{evidence=false}={}) {
  const {page,node,file}=select(projection,target),key=page.key,index=!node&&!file;
  const pageRef=k=>`${projection.pages.get(k).handle} ${k}`,fileRef=f=>`${page.files.find(x=>x.file===f).handle} ${f.slice(f.lastIndexOf('/')+1)}`;
  const member=n=>n.page!==key?pageRef(page.children.find(c=>within(n.page,c))):index?fileRef(n.file):`${n.handle} ${n.label}`;
  const inside=n=>!n.external&&within(n.page,key);
  const chosen=index?null:new Set(projection.all.filter(n=>file?n.file===file:n.handle===node.handle||n.handle.startsWith(node.handle+'.')));
  const sites=e=>evidence?{evidence:e.relations.map(r=>({id:r.id,kind:r.kind,sites:r.evidence.map(({file,line,column})=>`${file}:${line}:${column}`)}))}:{};
  const merged=new Map();
  function merge(list,id,e,entry) {
    let m=merged.get(id);
    if(!m) {merged.set(id,m={...entry,kinds:{},label:e.label,count:0,relations:[]});list.push(m);}
    for(const r of e.relations)m.kinds[r.kind]=(m.kinds[r.kind]??0)+1;m.relations.push(...e.relations);if(++m.count>1)m.label='';
  }
  const edges=[],incoming=[],outgoing=[];
  for(const e of projection.edges) {
    const s=inside(e.src),d=inside(e.dst);
    if(!s&&!d)continue;
    if(s&&d) {
      const src=member(e.src),dst=member(e.dst);
      if(src!==dst&&(index||chosen.has(e.src)||chosen.has(e.dst)))merge(edges,`e\n${src}\n${dst}`,e,{src,dst});
      continue;
    }
    const local=s?e.src:e.dst,other=s?e.dst:e.src;
    if(chosen&&!chosen.has(local))continue;
    // An index names the other page only; a file or node read names the far declaration.
    const far=index?(other.external?{external:dirname(other.external)}:{page:pageRef(other.page)}):{path:other.path??other.external,...(other.handle?{handle:other.handle}:{})};
    merge(s?outgoing:incoming,`${s?'o':'i'}\n${index?'':member(local)}\n${Object.values(far)[0]}`,e,index?far:{node:member(local),...far});
  }
  const sorted=kinds=>Object.fromEntries(Object.entries(kinds).sort(([a],[b])=>order(a,b)));
  const finish=list=>list.map(({count,relations,kinds,label,...e})=>index?{...e,kinds:sorted(kinds),...sites({relations})}
    :{...e,label,kinds:Object.keys(kinds).sort(order),...(count>1?{count}:{}),...sites({relations})});
  // A node's path is its file, then the labels down to it joined by '::'; a module node's path is the file.
  const tree=list=>list.map(({handle,label,kind,line,endLine,enclosedCount,children})=>({handle,label,kind,line,endLine,enclosedCount,...(children.length?{nodes:tree(children)}:{})}));
  const top=f=>node?[node]:projection.all.filter(n=>n.file===f&&!n.parent);
  return {generated:true,page:key,handle:page.handle,parent:page.parent,children:page.children.map(c=>({page:c,handle:projection.pages.get(c).handle})),
    ...(node?{selected:{path:node.path,handle:node.handle}}:file?{selected:{file}}:{}),
    files:page.files.filter(f=>index||f.file===(file??node.file)).map(f=>({...f,nodes:tree(top(f.file))})),
    edges:finish(edges),boundary:{in:finish(incoming),out:finish(outgoing)},...(key==='.'?{totals:projection.totals}:{})};
}

export async function loadProjection({repo=fileURLToPath(new URL('../../',import.meta.url)),files,readSource}={}) {
  return projectGraph(await extractGraph({repo,files:files??await sourceFiles(repo),importAliases,literalCouplings:true,...(readSource?{readSource}:{})}));
}

export async function testFiles(repo,roots=['core','studio']) {
  const files=[];
  async function walk(dir,inTests) {
    for(const entry of await readdir(resolve(repo,dir),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
      const path=`${dir}/${entry.name}`;
      if(entry.isDirectory()&&!['node_modules','.local'].includes(entry.name))await walk(path,inTests||entry.name==='tests');
      else if(entry.isFile()&&(entry.name.endsWith('.test.mjs')||inTests&&entry.name.endsWith('.mjs')))files.push(path);
    }
  }
  for(const dir of roots)await walk(dir,false);
  return files.sort();
}

// An on-demand query. Tests are never nodes; a test is listed when its static imports resolve to the selection.
export async function importingTests(projection,target,{repo=fileURLToPath(new URL('../../',import.meta.url)),files,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const {node,file}=select(projection,target);if(!node&&!file)fail('--tests takes a file or a declaration, not a page.');
  const wanted=file??node.file,name=node?node.path.slice(wanted.length+2).split('::')[0]:null,parsed=new Map();
  const from=(importer,source)=>source.startsWith('.')?posix.normalize(posix.join(posix.dirname(importer),source)):null;
  async function ast(path) {
    if(!parsed.has(path))parsed.set(path,Promise.resolve(readSource(path)).then(text=>parse(text,{ecmaVersion:'latest',sourceType:'module'}),()=>null));
    return parsed.get(path);
  }
  async function origin(path,exported,depth=0) {
    const tree=path&&depth<9?await ast(path):null;if(!tree)return null;
    for(const n of tree.body) {
      if(n.type==='ExportNamedDeclaration') {
        const declared=n.declaration?.id?[n.declaration.id.name]:(n.declaration?.declarations??[]).map(v=>v.id.name);
        if(declared.includes(exported))return {file:path,name:exported};
        for(const p of n.specifiers)if((p.exported.name??p.exported.value)===exported) {
          if(n.source)return origin(from(path,n.source.value),p.local.name??p.local.value,depth+1);
          const local=tree.body.find(i=>i.type==='ImportDeclaration'&&i.specifiers.some(q=>q.local.name===p.local.name));
          const q=local?.specifiers.find(q=>q.local.name===p.local.name);
          return local?q.imported?origin(from(path,local.source.value),q.imported.name??q.imported.value,depth+1):null:{file:path,name:p.local.name};
        }
      }
      if(n.type==='ExportAllDeclaration'&&!n.exported) {const found=await origin(from(path,n.source.value),exported,depth+1);if(found)return found;}
    }
    return null;
  }
  const out=[];
  for(const test of files??await testFiles(repo)) {
    const tree=await ast(test),imports=new Set();let whole=false;if(!tree)continue;
    const uses=(local,member)=>{let hit=false;(function walk(n){if(!n||typeof n!=='object')return;if(n.type==='MemberExpression'&&!n.computed&&n.object.type==='Identifier'&&n.object.name===local&&n.property.name===member)hit=true;
      for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v?.type)walk(v);})(tree);return hit;};
    for(const n of tree.body)if(n.type==='ImportDeclaration') {
      const module=from(test,n.source.value);if(!module)continue;
      if(module===wanted&&(!name||!n.specifiers.length))whole=!name;
      for(const p of n.specifiers) {
        if(p.type==='ImportNamespaceSpecifier') {if(module===wanted&&(!name||uses(p.local.name,name)))imports.add(name?`${p.local.name}.${name}`:`* as ${p.local.name}`);continue;}
        const found=p.type==='ImportSpecifier'?await origin(module,p.imported.name??p.imported.value):module===wanted&&!name?{file:wanted,name:'default'}:null;
        if(found?.file===wanted&&(!name||found.name===name))imports.add(found.name);
      }
    }
    if(whole||imports.size)out.push({file:test,imports:[...imports].sort(order)});
  }
  return out.sort((a,b)=>order(a.file,b.file));
}
