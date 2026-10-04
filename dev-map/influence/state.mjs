// State nodes (plans/dev-maps.md#arrows, owner 2026-10-04): each piece of state is a node owned by
// its boundary; writes enter it and reads leave it. derive.mjs decides which writes are effects
// (a write to an object the writer does not own that another callable reads); this module turns
// those writes, and the reads of the same fields, into state nodes and arrows.
//
// Two steps, so closures analysed separately can be merged before nodes are made:
// - stateFacts(pt, built, derived, {modules}) after one analysis: for every object some callable
//   writes as an effect, its allocation site, a name taken from the code there, the callable that
//   allocated it, the fields written, and the callables (by key) that write it as an effect and
//   that read it. run.mjs --out writes these as `state`; mergeStateFacts unites closures.
// - stateNodes(facts, leafOf) on a (merged) analysis: callables mapped to leaves; an object some
//   leaf writes and another leaf reads is one state node. Reads are recorded per object, not per
//   field (constraints.mjs readObjects), so a node is the whole object. Its key is its allocation
//   site with a suffix, `FILE:OFFSET.1` (distinct from a callable allocated there); its name
//   `FILE:LINE label {fields}`, so its owner is the declaration holding the allocation
//   (solve-middle.mjs ownLeaves), as for leaves. Arrows: writer leaf `writes` state, state
//   `reads` reader leaf.
const ELEMENT='[]';
const ANY='*';

// The name the code gives the value made at `start`: the variable, property, class field or
// assignment target it initialises; else the enclosing call's callee for an argument.
function namesAt(ast) {
  const names=new Map();
  const target=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'&&!n.computed?(n.object.type==='ThisExpression'?'this.':'')+n.property.name
    :n?.type==='MemberExpression'&&n.property.type==='Literal'?String(n.property.value):null;
  const keyName=k=>k?.type==='Identifier'?k.name:k?.type==='Literal'?String(k.value):k?.type==='PrivateIdentifier'?'#'+k.name:null;
  const unwrap=n=>{while(n&&(n.type==='AwaitExpression'||n.type==='ChainExpression'||n.type==='ParenthesizedExpression'))n=n.argument??n.expression;return n;};
  const put=(n,name)=>{n=unwrap(n);if(n&&name&&!names.has(n.start))names.set(n.start,name);};
  const walk=n=>{
    if(!n||typeof n.type!=='string')return;
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')put(n.init,n.id.name);
    else if(n.type==='AssignmentExpression')put(n.right,target(n.left));
    else if((n.type==='Property'||n.type==='PropertyDefinition')&&!n.computed)put(n.value,keyName(n.key));
    else if(n.type==='AssignmentPattern'&&n.left.type==='Identifier')put(n.right,n.left.name);
    for(const v of Object.values(n)){if(Array.isArray(v)){for(const c of v)if(c&&typeof c.type==='string')walk(c);}else if(v&&typeof v.type==='string')walk(v);}
  };
  walk(ast);
  return names;
}
const lineAt=text=>{const starts=[0];for(let i=text.indexOf('\n');i>=0;i=text.indexOf('\n',i+1))starts.push(i+1);
  return offset=>{let lo=0,hi=starts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid-1;}return lo+1;};};

export function stateFacts(pt,{functions},derived,{modules=[]}={}) {
  const {effects,canon}=derived;
  const byFile=new Map(modules.map(m=>[m.file,m]));
  const named=new Map(),lines=new Map();
  const nameAt=(file,start)=>{const m=byFile.get(file);if(!m)return null;
    if(!named.has(file))named.set(file,namesAt(m.ast));return named.get(file).get(start)??null;};
  const line=(file,start)=>{const m=byFile.get(file);if(!m)return null;
    if(!lines.has(file))lines.set(file,lineAt(m.text));return lines.get(file)(start);};
  const key=id=>functions[canon(id)].key;
  const objects=new Map();
  const at=o=>{
    let r=objects.get(o);if(r)return r;
    const x=pt.objects[o],owner=x.owner!=null?functions[x.owner]:null;
    let file=null,start=null,label=null,ln=null;
    if(x.kind==='function'&&x.fn){file=x.fn.file;start=x.fn.start;label=`function ${x.fn.name??'(anonymous)'}`;ln=x.fn.line;}
    else if(x.shape==='module'){file=x.name;start=0;label='module namespace';ln=1;}
    else if(x.start!==undefined&&x.file){file=x.file;start=x.start;}
    else if(x.site){const i=x.site.lastIndexOf(':');file=x.site.slice(0,i);start=Number(x.site.slice(i+1));}
    else if(owner){file=owner.file;start=owner.start;label=x.name??`${x.shape??x.kind} in ${owner.name??'(anonymous)'}`;ln=owner.line;}
    const what=x.kind==='object'&&x.shape&&x.shape!=='prototype'?x.shape:x.name??x.kind;
    if(!label&&file!==null)label=nameAt(file,start)??`${what}`;
    if(ln===null&&file!==null)ln=x.line??line(file,start)??1;
    r={site:file!==null?`${file}:${start}`:`object:${o}`,file,line:ln,label:label??what,kind:x.kind,
      ...(owner?{allocatedBy:functions[canon(owner.id)].key}:{}),fields:new Set(),writers:new Set(),readers:new Set()};
    objects.set(o,r);return r;
  };
  for(const f of functions) {
    const cf=canon(f.id),written=effects[cf].state;if(!written.size)continue;
    for(const st of f.stores)for(const o of pt.pts[st.base]) {
      if(!written.has(o))continue;
      const r=at(o);r.writers.add(key(f.id));
      r.fields.add(st.name===null||st.name===undefined?ANY:st.name===ELEMENT?'[elements]':st.name);
    }
  }
  // Reads are recorded per object (constraints.mjs readObjects) or per field node (compose.mjs).
  const objectsRead=f=>f.readObjects??new Set([...f.reads??[]].map(n=>pt.fieldObj?.[n]).filter(o=>o!==undefined));
  for(const f of functions)for(const o of objectsRead(f)){const r=objects.get(o);if(r)r.readers.add(key(f.id));}
  return mergeStateFacts([[...objects.values()].map(r=>({...r,fields:[...r.fields],writers:[...r.writers],readers:[...r.readers]}))]);
}

// Facts from several analyses of overlapping code, one per allocation site: writers and readers
// united per field.
export function mergeStateFacts(lists) {
  const bySite=new Map();
  for(const list of lists)for(const r of list??[]) {
    let s=bySite.get(r.site);
    if(!s){s={...r,fields:new Set(),writers:new Set(),readers:new Set()};bySite.set(r.site,s);}
    for(const k of ['fields','writers','readers'])for(const v of r[k]??[])s[k].add(v);
  }
  return [...bySite.values()].map(s=>({...s,fields:[...s.fields].sort(),writers:[...s.writers].sort(),readers:[...s.readers].sort()}));
}

// State nodes and their arrows from facts. `leafOf(callableKey)` gives a callable's leaf key, or
// undefined for a callable the analysis has no leaf for (listed in `unknownCallables`).
export function stateNodes(facts,leafOf) {
  const nodes=[],arrows=[],unknown=new Set();
  const leaves=keys=>{const out=new Set();for(const k of keys??[]){const l=leafOf(k);if(l===undefined)unknown.add(k);else out.add(l);}return out;};
  for(const r of facts) {
    const ws=leaves(r.writers),rs=leaves(r.readers);
    if(![...ws].some(w=>[...rs].some(q=>q!==w)))continue;
    const key=`${r.site}.1`;
    const fields=r.fields.length>4?[...r.fields.slice(0,4),`+${r.fields.length-4}`]:r.fields;
    const label=`${r.label} {${fields.join(', ')}}`;
    nodes.push({leaf:`${r.file}:${r.line} ${label}`,key,role:'state',folded:[],foldedKeys:[],
      state:{site:r.site,file:r.file,line:r.line,label,fields:r.fields,kind:r.kind,...(r.allocatedBy?{allocatedBy:r.allocatedBy}:{}),writers:ws.size,readers:rs.size}});
    for(const w of ws)arrows.push({fromKey:w,toKey:key,kind:'writes',count:1});
    for(const q of rs)arrows.push({fromKey:key,toKey:q,kind:'reads',count:1});
  }
  return {nodes,arrows,unknownCallables:[...unknown].sort(),
    summary:{objects:facts.length,stateNodes:nodes.length,writes:arrows.filter(a=>a.kind==='writes').length,reads:arrows.filter(a=>a.kind==='reads').length}};
}
