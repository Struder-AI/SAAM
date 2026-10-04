// Turns parsed modules into points-to constraints, and records for every callable what the
// derivation needs afterwards: its stores, loads, call sites and returns. Lexical scopes resolve
// each identifier to one binding node; unresolved identifiers are platform globals. Objects are
// allocation sites (literals, functions, classes, instances, module namespaces); platform values
// are opaque objects whose fields are further platform objects. Shapes the analysis does not
// model are recorded as `unmodelled`, never silently approximated away.
import {dirname,join,posix} from 'node:path';
import {PairSet} from './points-to.mjs';
import {lookupPlatform,typeOf,familyOf,familyPath,propertyType,BROWSER_ROOTS} from './platform-models.mjs';
import {keyInfo,literalKey} from './keys.mjs';

const ELEMENT='[]';
// The name a correlated copy gives an unknown key that is none of the names the copy's
// accesses could reach (constraints.mjs accessBases): the field of values written under
// unknown names.
const STAR='*';
const keys=key=>Array.isArray(key)?key:[key];
const UNMODELLED_GLOBALS=new Set(['eval','Function','Proxy','Reflect']);
// Object.defineProperty and defineProperties are modelled (propertyModel); only accessor
// descriptors remain an owner question (UNMODELLED.md), noted where get/set code appears.
const UNMODELLED_MEMBERS=new Set(['setPrototypeOf','__defineGetter__','__defineSetter__']);
// Array methods whose callback receives the receiver's elements, by the parameter that does.
const CALLBACK_ELEMENT=new Map([...'forEach map filter flatMap some every find findIndex findLast findLastIndex'.split(' ').map(m=>[m,0]),['reduce',1],['reduceRight',1]]);
// Array methods whose result holds only (a subset or permutation of) the receiver's elements.
const KEYED_DERIVED=new Set(['filter','slice','sort','toSorted','reverse','toReversed']);
// Mutating platform calls that only remove or reorder elements.
const PERMUTES=/\.(sort|reverse|pop|shift)$/;

export function buildConstraints(pt,modules,{resolveImport,platformModules=new Map(),cloning=true,depth=1,unknownData=false}) {
  const functions=[],unmodelled=[],unresolvedImports=[];
  const platformObjects=new Map(),instances=new Map(),accessorReads=new Set();
  const PLATFORM_PROTO=platform('platform.prototype',undefined,false);
  // Work already done, by integer pairs: (field node, target) per load, (object, target) per
  // all-fields load, (object, value) per store to a platform object or to all fields.
  const loaded=new PairSet(16),loadedAll=new PairSet(14),storedAll=new PairSet(14),storedPlatform=new PairSet(10);
  const calls=[],nsOf=new Map();
  // Correlation tracking: pending lazily walked loops and callbacks, keyed sources (settle).
  const pendingLoops=[],deferredFns=[],keyedSources=[],pendingCallbacks=[];
  const correlation={loops:0,loopCopies:0,callbackCopies:0,genericLoopCopies:0,deferredWalked:0};
  // Why loops and callbacks fell back to the generic analysis, by reason (and by site, for
  // diagnosis: not part of the summary).
  const genericWhy=new Map();
  const why=(reason,file,line)=>{correlation[reason]=(correlation[reason]??0)+1;const k=`${reason} ${file}:${line}`;genericWhy.set(k,(genericWhy.get(k)??0)+1);};

  // A platform object carries the real runtime value when its path names one, so field reads
  // follow what actually exists; an unknown platform value has unknown members.
  function platform(path,value,known=value!==undefined) {
    let o=platformObjects.get(path);
    if(o===undefined){o=pt.object({kind:'platform',name:path,value,known});platformObjects.set(path,o);}
    return o;
  }
  function platformRoot(name) {
    if(platformModules.has(name))return platform(name,platformModules.get(name));
    if(name in globalThis&&!BROWSER_ROOTS.has(name))return platform(name,globalThis[name]);
    return unknownRoot(name);
  }
  function unknownRoot(name){const o=platform(name);pt.objects[o].root=true;return o;}
  const UNKNOWN=platform('platform.unknown');
  const ARRAY_PROTO=platform('Array.prototype',Array.prototype),OBJECT_PROTO=platform('Object.prototype',Object.prototype),FUNCTION_PROTO=platform('Function.prototype',Function.prototype);
  const REGEXP_PROTO=platform('RegExp.prototype',RegExp.prototype);
  const isPlatform=o=>pt.objects[o].kind==='platform';
  const isCallable=o=>pt.objects[o].kind==='function';
  // A member of a value without a runtime value is a value of the same family (platform-models.mjs).
  // A property the analysis process cannot read (a getter, or absent here but present where SAAM
  // runs) takes its declared type, else it is an unknown value named by its path.
  function familyObject(obj){const fam=familyOf(obj.name);return fam?platform(familyPath(fam)):UNKNOWN;}
  function typeObject(type){const t=typeOf(type);return t.family?platform(familyPath(t.family)):platform(t.path,t.value);}
  // Memoized per (object, name): every named load on a value whose prototype is a platform
  // object asks for the same member again.
  const childCache=new Map();
  function platformChild(o,name) {
    let m=childCache.get(o);if(m===undefined){m=new Map();childCache.set(o,m);}
    if(m.has(name))return m.get(name);
    const c=platformChild0(o,name);m.set(name,c);return c;
  }
  function platformChild0(o,name) {
    const obj=pt.objects[o];
    // A named member of an unknown root (a package export, a browser global's member) keeps its
    // name, so the model can tell `zipSync` from `unzipSync`; deeper members are the family's.
    if(!obj.known)return obj.root&&name!==null&&name!==ELEMENT&&familyOf(obj.name)?platform(`${familyOf(obj.name)}.${name}`):familyObject(obj);
    if(name===null||name===ELEMENT)return undefined;
    const path=obj.name+'.'+name;
    const declared=propertyType(path);if(declared!==undefined)return typeObject(declared);
    // A getter the analysis process cannot run on a prototype reads per-instance state; unless
    // platform-models.mjs declares its type, it is taken to return a primitive (recorded).
    let v;try{if(obj.value==null||!(name in Object(obj.value)))return undefined;v=obj.value[name];}catch{accessorReads.add(path);return undefined;}
    // A primitive (a length, a name, a constant) is no object.
    if(v===null||typeof v!=='object'&&typeof v!=='function')return undefined;
    // One object per runtime value: members of members (fn.toString.toString, x.constructor
    // .constructor) reach the object already made for that value, so paths stay finite.
    if(!platformObjects.has(path)){const same=byValue.get(v);if(same!==undefined)return same;}
    const made=platform(path,v,true);
    if(!byValue.has(v))byValue.set(v,made);
    return made;
  }
  const byValue=new Map();
  // One record per source location, however many copies walk it.
  const noted=new Set();
  function note(kind,fn,node){const k=`${kind}|${fn?.file}|${node?.start??fn?.key}`;if(noted.has(k))return;noted.add(k);unmodelled.push({kind,fn:fn?.id,file:fn?.file,line:node?.loc?.start.line});}

  // --- correlation tracking -----------------------------------------------------------------
  // Sridharan et al., "Correlation tracking for points-to analysis of JavaScript" (2012). A loop
  // or callback whose key comes from Object.keys/entries or for-in is analysed once per field
  // name of the enumerated objects, with the key as that named key, so `t[k]=o[k]` moves o.a to
  // t.a only, instead of every field of o into every field of t.
  //
  // A key string is a key object K(name), one per field name ('*', key null: a name the analysis
  // cannot know). Key objects have no members (a string's methods resolve as on any primitive).
  // An array is keyed while its elements are only key objects or entry pairs (obj.keyed true,
  // keyedKind 'array'): Object.keys/entries results, literal lists of strings, and arrays or sets
  // made from keyed arrays alone (filter, slice, sort, new Set, spread). A pair is a two-element
  // array whose first element is a known name (keyedKind 'pair', pairKey): Object.entries pairs
  // and literals `[k, v]` with k a named key. Any write that may add elements or change a pair's
  // key makes it unkeyed for good (markImpure), and everything that relied on it falls back to
  // the generic analysis (key: any field) for it. Only loops and callbacks whose source is
  // syntactically keyed (keyedKindOf) are split, so their source is never an unrepresented value.
  const keyObjects=new Map();
  function keyObject(name) {
    const k=name??'*';let o=keyObjects.get(k);
    if(o===undefined){o=pt.object({kind:'key',name:k,key:name});keyObjects.set(k,o);}
    return o;
  }
  const isKey=o=>pt.objects[o].kind==='key';
  // An object placed directly into a field: the field exists (PointsTo.whenFed).
  const put=(fnode,o)=>{pt.feed(fnode);pt.add(fnode,o);};
  // Calls fn(name, node) for each field of o that exists: one something was written to (a
  // field node a read made exists only once written: PointsTo.whenFed); __proto__ always.
  function eachExisting(o,fn){pt.onField(o,(name,fnode)=>{if(name==='__proto__')fn(name,fnode);else pt.whenFed(fnode,()=>fn(name,fnode));});}
  function markImpure(o) {
    const x=pt.objects[o];if(x.keyed!==true)return;
    x.keyed=false;const ls=x.impure;x.impure=null;
    if(ls)for(const fn of ls)fn();
  }
  function onImpure(o,fn){const x=pt.objects[o];if(x.keyed!==true){fn();return;}(x.impure??=[]).push(fn);}
  // A write that may add elements to, or change elements of, the objects reaching base.
  function mutating(base){pt.on(base,o=>{if(pt.objects[o].keyed===true)markImpure(o);});}
  // The name an element of a keyed array stands for: a key object's name for key loops, a valid
  // pair's key for pair loops; null for an unknown name; undefined if it is neither.
  function elementKey(e,kind) {
    const x=pt.objects[e];
    if(kind==='key')return x.kind==='key'?x.key:undefined;
    return x.keyed===true&&x.keyedKind==='pair'?x.pairKey:undefined;
  }
  // 'key' or 'pair' when e is syntactically an array (or set) of key strings or entry pairs.
  function keyedKindOf(e,ctx,depth=0) {
    if(!e||depth>8)return null;
    switch(e.type) {
      case 'ParenthesizedExpression':case 'ChainExpression':return keyedKindOf(e.expression,ctx,depth+1);
      case 'ArrayExpression':{
        let k;
        for(const x of e.elements) {
          const kx=!x?null:x.type==='SpreadElement'?keyedKindOf(x.argument,ctx,depth+1):stringKey(x)!==undefined?'key':null;
          if(kx===null||k!==undefined&&kx!==k)return null;
          k=kx;
        }
        return k??null;
      }
      case 'CallExpression':{
        const c=e.callee;if(c.type!=='MemberExpression'||c.computed||c.property.type!=='Identifier')return null;
        const m=c.property.name;
        if(c.object.type==='Identifier'&&c.object.name==='Object'&&!ctx.scope.lookup('Object'))return m==='keys'?'key':m==='entries'?'pair':null;
        return KEYED_DERIVED.has(m)?keyedKindOf(c.object,ctx,depth+1):null;
      }
      case 'NewExpression':
        return e.callee.type==='Identifier'&&e.callee.name==='Set'&&!ctx.scope.lookup('Set')&&e.arguments.length===1?keyedKindOf(e.arguments[0],ctx,depth+1):null;
      case 'Identifier':{
        const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(e);
        return r?.kind==='const'&&r.inits.length===1&&!r.writes.length?keyedKindOf(r.inits[0],ctx,depth+1):null;
      }
    }
    return null;
  }
  // A string literal's key, or undefined.
  function stringKey(x) {
    if(x.type==='Literal'&&typeof x.value==='string')return literalKey(x.value);
    if(x.type==='TemplateLiteral'&&!x.expressions.length)return literalKey(x.quasis[0].value.cooked);
    return undefined;
  }
  // The binding a loop or callback names its key by: the identifier itself (keys, for-in) or the
  // first element of an array pattern (entries), when it is never reassigned.
  function keyBinding(p,kind,ctx,constant) {
    const id=kind==='pair'?(p?.type==='ArrayPattern'&&p.elements[0]?.type==='Identifier'?p.elements[0]:null):(p?.type==='Identifier'?p:null);
    if(!id)return undefined;
    const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(id);
    return r&&(constant||!r.writes.length)?r:undefined;
  }
  // Whether a test is decided in a correlated copy, where a key binding is one known name:
  // k === 'a', k !== 'a', ['a','b'].includes(k) (also through a const list), with !, && and ||.
  // undefined when it is not decided.
  function truth(e,ctx) {
    if(!ctx.namedKeys)return undefined;
    switch(e.type) {
      case 'ParenthesizedExpression':return truth(e.expression,ctx);
      case 'UnaryExpression':{if(e.operator!=='!')return undefined;const t=truth(e.argument,ctx);return t===undefined?undefined:!t;}
      case 'LogicalExpression':{
        const a=truth(e.left,ctx),b=truth(e.right,ctx);
        if(e.operator==='&&')return a===false||b===false?false:a===true&&b===true?true:undefined;
        if(e.operator==='||')return a===true||b===true?true:a===false&&b===false?false:undefined;
        return undefined;
      }
      case 'BinaryExpression':{
        if(!['===','!==','==','!='].includes(e.operator))return undefined;
        const [id,lit]=e.left.type==='Identifier'?[e.left,e.right]:[e.right,e.left];
        if(id.type!=='Identifier')return undefined;
        const name=namedKey(id,ctx),other=stringKey(lit);if(name===STAR)return undefined;
        if(name==null||other===undefined||name===ELEMENT||other===ELEMENT)return undefined;
        return (name===other)===(e.operator==='==='||e.operator==='==');
      }
      case 'CallExpression':{
        const c=e.callee;
        if(c.type!=='MemberExpression'||c.computed||c.property.name!=='includes'||e.arguments.length!==1||e.arguments[0].type!=='Identifier')return undefined;
        const name=namedKey(e.arguments[0],ctx);if(name==null||name===ELEMENT||name===STAR)return undefined;
        let list=c.object;
        if(list.type==='Identifier'){const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(list);list=r?.kind==='const'&&r.inits.length===1&&!r.writes.length?r.inits[0]:null;}
        if(list?.type!=='ArrayExpression'||!list.elements.every(x=>x&&stringKey(x)!==undefined))return undefined;
        const names=list.elements.map(stringKey);
        return names.includes(ELEMENT)?undefined:names.includes(name);
      }
    }
    return undefined;
  }
  // The name a correlated copy gives an identifier's binding, if any.
  function namedKey(id,ctx) {
    if(!ctx.namedKeys)return undefined;
    const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(id);
    return r&&ctx.namedKeys.get(r);
  }
  // A two-element array literal whose first element is a name known now: a pair with that key.
  function staticName(x,ctx) {
    const s=stringKey(x);if(s!==undefined)return s;
    if(x.type==='Literal'&&typeof x.value==='number')return literalKey(x.value);
    if(x.type!=='Identifier')return undefined;
    const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(x);if(!r)return undefined;
    const n=ctx.namedKeys?.get(r);if(n!==undefined)return n===STAR?undefined:n??undefined;
    const k=prepared.get(ctx.mod.file).keyInfo.keyOf(x);
    return Array.isArray(k)&&k.length===1?k[0]:undefined;
  }
  // Object.keys, Object.entries (a keyed array of key objects or pairs, one pair per field name
  // and call) and Object.fromEntries (a pair with a known key fills that field only).
  function correlateCall(kind,{site,caller,args,result,api}) {
    const made=site.made??=new Map();
    let r=made.get(api);
    if(kind==='fromEntries') {
      if(r===undefined){r=pt.object({kind:'value',name:`Object from ${api}`,owner:caller.id,site:site.id,fresh:'Object'});made.set(api,r);pt.add(pt.field(r,'__proto__'),OBJECT_PROTO);}
      pt.add(result,r);
      if(args[0]===undefined)return;
      const pairs=pt.node();load(args[0],ELEMENT,pairs,caller);
      let anyValue;
      pt.on(pairs,p=>{
        const x=pt.objects[p];
        const generic=()=>{if(anyValue===undefined){anyValue=pt.node();intoAllFields(anyValue,r);}loadFrom(p,ELEMENT,anyValue,caller);};
        if(x.keyed===true&&x.keyedKind==='pair'&&x.pairKey!==null){loadFrom(p,ELEMENT,pt.field(r,x.pairKey),caller);onImpure(p,generic);}
        else generic();
      });
      return;
    }
    if(r===undefined) {
      r=pt.object({kind:'value',name:`Array from ${api}`,owner:caller.id,site:site.id,fresh:'Array',keyed:true,keyedKind:'array'});
      made.set(api,r);pt.add(pt.field(r,'__proto__'),ARRAY_PROTO);
    }
    pt.add(result,r);
    const A=r,el=pt.field(A,ELEMENT),pairs=new Map();
    const pairOf=name=>{
      let P=pairs.get(name);
      if(P===undefined) {
        P=pt.object({kind:'value',name:`entry from ${api}`,owner:caller.id,site:site.id,fresh:'Array',keyed:true,keyedKind:'pair',pairKey:name});
        pairs.set(name,P);pt.add(pt.field(P,'__proto__'),ARRAY_PROTO);put(el,P);
      }
      return P;
    };
    // name: a field name, ELEMENT, or null (unknown); value: the field node it reads, if any.
    const add=(name,fnode,from)=>{
      if(kind==='keys'){put(el,keyObject(name));return;}
      const P=pairOf(name);
      if(fnode!==undefined){pt.edge(fnode,pt.field(P,ELEMENT));caller.reads.add(fnode);}
      else if(from!==undefined)loadFrom(from,null,pt.field(P,ELEMENT),caller);
    };
    const source=args[0];
    if(source===undefined){add(null);return;}
    keyedSources.push({source,add,done:false});
    pt.on(source,o=>{
      const x=pt.objects[o];
      // A string's keys are its indices; its values are characters.
      if(x.kind==='key'){add(ELEMENT);return;}
      if(x.kind==='platform'){add(null,undefined,o);return;}
      eachExisting(o,(name,fnode)=>{if(name!=='__proto__')add(name==='*'?null:name,fnode);});
      // Data of unknown shape (a value whose prototype is a platform family: parsed JSON) has
      // fields of unknown names.
      pt.on(pt.field(o,'__proto__'),p=>{const y=pt.objects[p];if(y.kind==='platform'&&!y.known)add(null,undefined,p);});
    });
  }
  // The field names a for-in loop enumerates on o: its own and those of SAAM objects on its
  // prototype chain (class prototypes hold methods, which are not enumerable).
  function forInNames(o,add,seen) {
    const x=pt.objects[o];
    if(x.kind==='key'){add(ELEMENT);return;}
    if(x.kind==='platform'){add(null);return;}
    eachExisting(o,(name,fnode)=>{
      if(name!=='__proto__'){add(name==='*'?null:name);return;}
      pt.on(fnode,p=>{const y=pt.objects[p];if(y.kind==='platform'){if(!y.known)add(null);return;}if(y.shape==='prototype'||seen.has(p))return;seen.add(p);forInNames(p,add,seen);});
    });
  }
  // `for (const [k,v] of <keyed>)`, `for (const k of <keyed>)` and `for (const k in o)`: the body
  // is walked once per name (k a named key), lazily as names reach the source, and once
  // generically (k any field) for elements whose name is unknown. A loop that never receives
  // anything is walked generically when solving settles.
  function correlatedLoop(s,ctx,cor) {
    correlation.loops++;
    const src=expression(s.right,ctx);
    const copies=new Map(),unknownEls=[],unknownSet=new Set(),group=new Map();
    let split;  // how unknown names are handled: undefined (none seen yet), true (split), false (generic)
    const loop={walked:false};
    const copyFor=name=>{
      let el=copies.get(name);if(el!==undefined)return el;
      el=pt.node();copies.set(name,el);loop.walked=true;
      if(name===null)correlation.genericLoopCopies++;else correlation.loopCopies++;
      const k=`copy ${ctx.mod.file}:${s.loc?.start.line}`;genericWhy.set(k,(genericWhy.get(k)??0)+1);
      const scope=new Scope(ctx.scope,ctx.fn);
      const c=name===null?{...ctx,scope}:{...ctx,scope,namedKeys:new Map(ctx.namedKeys??[]).set(cor.record,name),allocGroup:ctx.allocGroup??group};
      declareBlock([s.left],scope);
      if(s.type==='ForOfStatement')bindPattern(s.left.declarations[0].id,el,c);
      statement(s.body,c);
      if(name!==null)for(const e of unknownEls)pt.add(el,e);
      return el;
    };
    // An element (or for-in name) whose name is unknown: see accessBases.
    const unknown=e=>{
      if(split===undefined) {
        const bases=accessBases(s,cor.record,ctx,ctx.thisNode);
        split=bases!==null;
        if(split){copyFor(STAR);baseNames(bases,copyFor);}
        else why('genericUnknownName',ctx.mod.file,s.loc?.start.line);
      }
      if(!split){const el=copyFor(null);if(e!==undefined)pt.add(el,e);return;}
      if(e===undefined||isKey(e)||unknownSet.has(e))return;
      unknownSet.add(e);unknownEls.push(e);
      for(const [name,el] of copies)if(name!==null)pt.add(el,e);
    };
    loop.generic=()=>copyFor(null);
    pendingLoops.push(loop);
    if(src===undefined)return;
    if(s.type==='ForInStatement'){const seen=new Set();pt.on(src,o=>forInNames(o,name=>{if(name===null)unknown();else copyFor(name);},seen));return;}
    pt.on(src,A=>{
      const x=pt.objects[A];
      const generic=()=>{why('genericUnkeyed',ctx.mod.file,s.loc?.start.line);loadFrom(A,ELEMENT,copyFor(null),ctx.fn);};
      if(x.keyed!==true||x.keyedKind!=='array'){generic();return;}
      pt.on(pt.field(A,ELEMENT),e=>{
        const name=elementKey(e,cor.kind);
        if(name==null){unknown(e);return;}
        // A key string carries no object: the copy's key binding stays empty.
        const el=copyFor(name);if(!isKey(e))pt.add(el,e);
        if(pt.objects[e].keyedKind==='pair')onImpure(e,()=>pt.add(copyFor(null),e));
      });
      onImpure(A,generic);
    });
  }
  // Splitting an unknown name (correlation tracking for names the analysis cannot know: JSON
  // data, values written under computed names). The body's accesses o[k] with the key binding
  // itself have bases that are variables declared outside it (or `this`); an unknown name is
  // either one of the field names those bases' objects have (fields something was written to,
  // own or on SAAM prototypes), or none of them. The body is walked once per such name (k that
  // name) and once with k as '*' (STAR: none of them). In the STAR copy o[k] reads the field of
  // values written under unknown names (a field never written holds only those) and o[k]=v
  // writes as an unknown name does (every field, store). Each copy gets every unknown element.
  // Sound: at run time k is one string, and each access then reads or writes what the matching
  // copy does. Any other use of k as a key (an object literal key, a pair, a test) treats '*'
  // as unknown. accessBases returns null when an access has another base, which keeps the
  // generic walk (k any field).
  function accessBases(root,record,ctx,thisNode) {
    const kinfo=prepared.get(ctx.mod.file).keyInfo;
    const declared=new Set(),names=new Set();let ok=true,usesThis=false;
    const visit=(n,depth)=>{
      if(!ok||!n||typeof n.type!=='string')return;
      if(n.type==='VariableDeclarator')for(const x of patternNames(n.id))declared.add(x);
      if((n.type==='FunctionDeclaration'||n.type==='ClassDeclaration'||n.type==='FunctionExpression'||n.type==='ClassExpression')&&n.id)declared.add(n.id.name);
      if(/Function/.test(n.type))for(const p of n.params)for(const x of patternNames(p))declared.add(x);
      if(n.type==='CatchClause')for(const x of patternNames(n.param))declared.add(x);
      if(n.type==='MemberExpression'&&n.computed&&n.property.type==='Identifier'&&kinfo.bindingOf(n.property)===record) {
        if(n.object.type==='Identifier')names.add(n.object.name);
        else if(n.object.type==='ThisExpression'&&depth===0)usesThis=true;
        else ok=false;
      }
      const inner=depth+(n.type==='FunctionExpression'||n.type==='FunctionDeclaration'||/Class/.test(n.type)?1:0);
      for(const key in n){if(key==='loc')continue;const v=n[key];if(Array.isArray(v)){for(const x of v)visit(x,inner);}else if(v&&typeof v.type==='string')visit(v,inner);}
    };
    visit(root,0);
    if(!ok||names.has('arguments'))return null;
    const nodes=[];
    for(const name of names){if(declared.has(name))return null;nodes.push(identifier(name,ctx));}
    if(usesThis){if(thisNode===undefined)return null;nodes.push(thisNode);}
    return nodes;
  }
  // Every field name the objects reaching the base nodes have, now and later, own or on SAAM
  // prototypes.
  function baseNames(bases,add) {
    const seen=new Set();
    const of=o=>{
      if(seen.has(o))return;seen.add(o);
      const x=pt.objects[o];if(x.kind==='platform'||x.kind==='key')return;
      eachExisting(o,(name,fnode)=>{if(name==='__proto__')pt.on(fnode,of);else add(name==='*'?STAR:name);});
    };
    for(const b of bases)pt.on(b,of);
  }
  function loopCorrelation(s,ctx) {
    const d=s.left;
    if(d.type!=='VariableDeclaration'||d.declarations.length!==1||d.kind==='var')return undefined;
    const kind=s.type==='ForInStatement'?'key':keyedKindOf(s.right,ctx);
    if(!kind)return undefined;
    const record=keyBinding(d.declarations[0].id,kind,ctx,d.kind==='const');
    return record&&{kind,record};
  }
  // A callback of an array method on a keyed array, defined inline: walked once per name that
  // reaches the parameter receiving elements (a copy of the function, inClone), and as itself
  // only for elements whose name is unknown. Its body is deferred until one of those happens.
  function callbackCopy(f,name) {
    const m=f.keyCopies??=new Map();let g=m.get(name);
    if(g!==undefined)return g;
    const w=f.walk;correlation.callbackCopies++;
    functionValue(w.node,{...w.ctx,namedKeys:new Map(w.ctx.namedKeys??[]).set(f.correlate.record,name),allocGroup:w.ctx.allocGroup??(f.allocGroup??=new Map())},w.name,{thisNode:w.thisNode,clone:x=>{g=x;}});
    m.set(name,g);return g;
  }
  function walkDeferred(f){const body=f.deferred;if(!body)return;f.deferred=null;correlation.deferredWalked++;body();}

  // --- loads, stores and calls as listeners ------------------------------------------------
  function loadFrom(o,name,target,reader) {
    const kind=pt.objects[o].kind;
    if(kind==='platform'){const c=platformChild(o,name);if(c!==undefined)pt.add(target,c);return;}
    if(kind==='key')return;
    if(name===null) {
      if(!loadedAll.add(o,target))return;
      pt.onField(o,(f,fnode)=>{if(f==='__proto__')return;pt.edge(fnode,target);reader?.reads.add(fnode);});
    } else {
      const fnode=pt.field(o,name);if(!loaded.add(fnode,target))return;pt.edge(fnode,target);reader?.reads.add(fnode);
      if(name!=='__proto__')pt.on(pt.field(o,'__proto__'),p=>loadFrom(p,name,target,reader));
    }
  }
  function load(base,name,target,reader){pt.on(base,o=>loadFrom(o,name,target,reader));}
  function store(base,name0,value,writer,site) {
    writer?.stores.push({base,name:name0,site});
    // A write under a correlated unknown name may be a write to any field (accessBases).
    const name=name0===STAR?null:name0;
    const elements=name===null||name===ELEMENT;
    pt.on(base,o=>{
      const x=pt.objects[o];
      if(x.kind==='key')return;
      if(elements&&x.keyed===true)markImpure(o);
      if(x.kind==='platform') {
        if(!storedPlatform.add(o,value))return;
        // Recorded for the platform inventory: a write to a platform object's property.
        if(site){const p=pt.objects[o];(site.apis??=new Map()).set(`set ${p.known?p.name:pt.objects[familyObject(p)].name}.${name??'[computed]'}`,'store');}
        pt.on(value,v=>{if(isCallable(v))invokedByPlatform(v,writer,site,o);});return;
      }
      if(name===null)intoAllFields(value,o);
      else pt.edge(value,pt.field(o,name));
    });
  }
  // Copies every field of src's objects into dst, except names the literal sets explicitly
  // after the spread ({...input, stats}: the later stats replaces the spread one).
  // A value the source holds under an unknown name ('*') may be any field of the copy.
  function copyFields(src,dst,overridden) {
    if(pt.objects[dst].keyed===true)markImpure(dst);
    pt.on(src,o=>{if(isPlatform(o)||isKey(o))return;eachExisting(o,(name,fnode)=>{
      if(name==='__proto__'||overridden?.has(name))return;
      if(name==='*')intoAllFields(fnode,dst);else pt.edge(fnode,pt.field(dst,name));});});
  }
  function intoAllFields(value,o) {
    if(!storedAll.add(o,value))return;
    pt.field(o,'*');
    pt.onField(o,(f,fnode)=>{if(f!=='__proto__')pt.edge(value,fnode,f!=='*');});
  }

  // A SAAM callable stored on a platform object (a handler property such as onclick) is invoked
  // by the platform with values of the object's family.
  function invokedByPlatform(fobj,caller,site,holder) {
    const f=pt.objects[fobj].fn;walkDeferred(f);
    if(!firstTime(site,`p${fobj}`))return;
    site.platformCallbacks.push(f.id);anyParams(f);
    const event=holder===undefined?UNKNOWN:familyObject(pt.objects[holder]);
    for(const p of f.params)pt.add(p,event);
    if(f.rest!==undefined)pt.add(f.rest,event);
    if(!f.arrow)pt.add(f.thisNode,holder??UNKNOWN);
  }
  // Every walk of a call site (each copy of its function walks it again) is its own site object,
  // so calls, constructors and platform models are wired in every copy; this records what one
  // walk has wired already.
  const firstTime=(site,key)=>{const d=site.done??=new Set();if(d.has(key))return false;d.add(key);return true;};
  // A platform call applies the model of the API it reaches (platform-models.mjs). An API without
  // a model is recorded as unmodelled and approximated generically: a fresh result holding the
  // receiver's and arguments' elements, with every callable argument invoked.
  function platformCall(site,caller,thisNode,args,result,method,callee,inst,name) {
    const obj=pt.objects[callee];
    if(obj.parts)return;  // a family value reached as its own part, not a function
    const construct=inst!==undefined;
    const hit=obj.kind==='platform'?lookupPlatform({path:obj.name,value:obj.value,known:obj.known,method,name,construct})
      :obj.name==='platform result'?lookupPlatform({path:'platform.unknown',known:false,method,name,construct})
      :{api:obj.name,notCallable:true};
    site.platform=true;site.receiver=site.receiverNode??thisNode;
    (site.apis??=new Map()).set(hit.api,hit.notCallable?'not-callable':hit.spec?hit.how:'unmodelled');
    if(hit.notCallable||!firstTime(site,`pc|${hit.api}|${callee}`))return;
    const c={site,caller,thisNode,args,result,inst,api:hit.api,memo:new Map(),cb:undefined};
    if(hit.spec){applyModel(hit.spec,c);return;}
    note('platform:'+hit.api,caller,site.node);
    genericPlatformCall(c);
  }
  function genericPlatformCall({site,caller,thisNode,args,result,inst}) {
    const made=site.made??=new Map();
    let pr=made.get('generic result');
    if(pr===undefined){pr=pt.object({kind:'value',name:'platform result',owner:caller.id,site:site.id});made.set('generic result',pr);}
    pt.add(result,pr);pt.add(pt.field(pr,'__proto__'),PLATFORM_PROTO);
    const elements=pt.field(inst??pr,ELEMENT);
    const elementsOf=(n,target)=>pt.on(n,o=>{if(!isPlatform(o))loadFrom(o,ELEMENT,target,caller);});
    if(thisNode!==undefined){elementsOf(thisNode,elements);elementsOf(thisNode,result);}
    for(const a of args) {
      elementsOf(a,elements);
      pt.on(a,o=>{if(!isCallable(o))return;const f=pt.objects[o].fn;walkDeferred(f);
        if(!firstTime(site,'g'+o))return;site.platformCallbacks.push(f.id);anyParams(f);
        for(const p of f.params){pt.add(p,UNKNOWN);pt.edge(elements,p);}
        if(f.rest!==undefined)pt.add(f.rest,UNKNOWN);
        if(!f.arrow)pt.add(f.thisNode,UNKNOWN);
        pt.edge(f.ret,elements);});
    }
  }

  // --- applying a platform model ---------------------------------------------------------
  // c: {site, caller, thisNode, args, result, inst, api, memo, cb}. Sources are described in
  // platform-models.mjs.
  const SOURCE=/^(this|args\d+\+|args|arg\d+|cb|\?|@[\w-]+)((?:\[\]|\.\*|\.[\w$#]+)*)$/;
  function argAt(c,i){const a=c.args;if(i<a.length)return a[i];return a.spreadAt>=0?a[a.spreadAt]:undefined;}
  function cbNode(c){return c.cb??=pt.node();}
  function src(tok,c,key) {
    if(typeof tok==='object')return freshNode(tok,c,key);
    if(tok==='number')return undefined;
    if(c.memo.has(tok))return c.memo.get(tok);
    const m=SOURCE.exec(tok);
    if(!m)throw Error(`Bad platform model source ${tok} (${c.api})`);
    const b=m[1];let n;
    if(b==='this')n=c.inst!==undefined?(()=>{const x=pt.node();pt.add(x,c.inst);return x;})():c.thisNode;
    else if(b==='cb')n=cbNode(c);
    else if(b==='?'){n=pt.node();pt.add(n,UNKNOWN);}
    else if(b[0]==='@'){n=pt.node();pt.add(n,platform(familyPath(b.slice(1))));}
    else if(b==='args'||b.endsWith('+')) {
      const from=b==='args'?0:+b.slice(4,-1);
      const list=c.args.slice(from);
      if(c.args.spreadAt>=0&&from>c.args.spreadAt)list.push(c.args[c.args.spreadAt]);
      n=union(list);
    } else n=argAt(c,+b.slice(3));
    for(const step of n===undefined?[]:m[2].match(/\[\]|\.\*|\.[\w$#]+/g)??[]) {
      const t=pt.node();load(n,step==='[]'?ELEMENT:step==='.*'?null:step.slice(1),t,c.caller);n=t;
    }
    c.memo.set(tok,n);return n;
  }
  // A fresh object the call makes: one per walk of the call site (each copy of a function makes
  // its own, as with its literals), API and position in the model.
  function freshNode(spec,c,key) {
    const id=`${c.api}|${key}`;const made=c.site.made??=new Map();
    let o=made.get(id);
    if(o===undefined) {
      o=pt.object({kind:'value',name:`${spec.fresh} from ${c.api}`,owner:c.caller.id,site:c.site.id,fresh:spec.fresh});
      made.set(id,o);
      const t=typeOf(spec.fresh);
      pt.add(pt.field(o,'__proto__'),t.family?platform(familyPath(t.family)):platform(t.path,t.value));
      // Parts of a family value (an element's style or classList, nested parsed data) are the
      // value itself, so changing them changes only what the caller made.
      if(t.parts){pt.objects[o].parts=true;pt.onField(o,(name,fnode)=>{if(name!=='__proto__')pt.add(fnode,o);});}
    }
    fill(o,spec,c,key);
    const n=pt.node();pt.add(n,o);return n;
  }
  function fill(o,spec,c,key) {
    // An array or set made only of other arrays' elements is keyed while all of those are.
    if(spec.el?.length&&!spec.fields&&!spec.any&&!spec.copy&&spec.el.every(s=>typeof s==='string'&&/^(this|arg\d+)\[\]$/.test(s))) {
      const x=pt.objects[o];
      if(x.keyed===undefined){x.keyed=true;x.keyedKind='array';}
      for(const s of spec.el) {
        const base=src(s.slice(0,-2),c,key);
        if(base===undefined)continue;
        pt.on(base,r=>{const y=pt.objects[r];if(y.keyed===true&&y.keyedKind==='array')onImpure(r,()=>markImpure(o));else markImpure(o);});
      }
    } else if(spec.el?.length||spec.any?.length||spec.copy?.length)markImpure(o);
    (spec.el??[]).forEach((s,i)=>{const n=src(s,c,key+'e'+i);if(n!==undefined)pt.edge(n,pt.field(o,ELEMENT));});
    for(const [name,list] of Object.entries(spec.fields??{}))list.forEach((s,i)=>{const n=src(s,c,`${key}f${name}${i}`);if(n!==undefined)pt.edge(n,pt.field(o,name));});
    (spec.any??[]).forEach((s,i)=>{const n=src(s,c,key+'a'+i);if(n===undefined)return;
      pt.edge(n,pt.field(o,'*'));pt.onField(o,(name,fnode)=>{if(name!=='__proto__')pt.edge(n,fnode,name!=='*');});});
    (spec.copy??[]).forEach((s,i)=>{const n=src(s,c,key+'c'+i);if(n!==undefined)copyFields(n,o);});
  }
  function applyModel(spec,c) {
    const {site,caller}=c;
    if(spec.correlate){correlateCall(spec.correlate,c);return;}
    if(spec.engine){engineCall(spec.engine,c);return;}
    (spec.out??[]).forEach((s,i)=>{const n=src(s,c,'o'+i);if(n!==undefined)pt.edge(n,c.result);});
    if(c.inst!==undefined)fill(c.inst,spec,c,'i');
    (spec.calls??[]).forEach((k,i)=>{const fn=src(k.fn,c,'k'+i);if(fn!==undefined)pt.on(fn,o=>{if(isCallable(o))invokeCallback(o,k,c,i);});});
    for(const t of spec.into??[]) {
      if(t.copy) {
        const target=src(t.to,c,'t');if(target===undefined)continue;
        caller.stores.push({base:target,name:null,site});
        for(const s of t.copy){const n=src(s,c,'t');if(n!==undefined)pt.on(target,o=>{if(!isPlatform(o))copyFields(n,o);});}
        continue;
      }
      const m=/^(.*?)(\[\]|\.\*)$/.exec(t.to);const base=src(m[1],c,'t');if(base===undefined)continue;
      const name=m[2]==='[]'?ELEMENT:null;
      caller.stores.push({base,name,site});
      for(const s of t.from){const n=src(s,c,'t');if(n!==undefined)store(base,name,n,caller,site);}
    }
    for(const s of spec.mutates??[]){const base=src(s,c,'m');if(base!==undefined){caller.stores.push({base,name:ELEMENT,site});if(!PERMUTES.test(c.api))mutating(base);}}
    for(const s of spec.observe??[])src(s,c,'r');
    if(spec.effect)(site.effects??=new Set()).add(spec.effect);
    if(spec.reads)(site.worldReads??=new Set()).add(spec.reads);
  }
  function invokeCallback(fobj,k,c,i) {
    const f=pt.objects[fobj].fn;
    if(!firstTime(c.site,`cb${fobj}|${c.api}|${i}`))return;
    const params=k.params??[];
    const cor=f.correlate,at=cor?.param;
    // A callback correlated on the receiver's elements (callbackCopy): elements with a known
    // name go to that name's copy, the rest to the function itself.
    if(!cor||params[at]?.length!==1||params[at][0]!=='this[]'||c.thisNode===undefined||c.inst!==undefined) {
      walkDeferred(f);wireCallback(f,k,c,i,-1);return;
    }
    let genericWired=false;
    const generic=e=>{
      if(!genericWired){genericWired=true;walkDeferred(f);wireCallback(f,k,c,i,at);}
      if(e!==undefined)pt.add(f.params[at],e);
    };
    const wired=new Set(),unknownEls=[],unknownSet=new Set();
    let split;
    const toCopy=(name,e)=>{
      const g=callbackCopy(f,name);
      if(!wired.has(g)){wired.add(g);wireCallback(g,k,c,i,at);for(const u of unknownEls)pt.add(g.params[at],u);}
      if(e!==undefined&&!isKey(e))pt.add(g.params[at],e);
    };
    // An element whose name is unknown: split over the names its accesses reach (accessBases).
    const unknown=e=>{
      if(split===undefined) {
        const w=f.walk;
        if(f.accessBases===undefined)f.accessBases=accessBases(w.node,cor.record,w.ctx,f.arrow?w.ctx.thisNode:undefined);
        split=f.accessBases!==null;
        if(split){toCopy(STAR);baseNames(f.accessBases,name=>toCopy(name));}
        else why('genericUnknownName',f.file,f.line);
      }
      if(!split){generic(e);return;}
      if(isKey(e)||unknownSet.has(e))return;
      unknownSet.add(e);unknownEls.push(e);
      for(const g of wired)pt.add(g.params[at],e);
    };
    // Invoked even if no element ever arrives, as every model invocation is (settle).
    pendingCallbacks.push(()=>{if(genericWired||wired.size)return false;generic();return true;});
    pt.on(c.thisNode,r=>{
      const x=pt.objects[r];
      const all=()=>{why('genericUnkeyed',f.file,f.line);generic();loadFrom(r,ELEMENT,f.params[at],c.caller);};
      if(x.keyed!==true||x.keyedKind!=='array'){all();return;}
      pt.on(pt.field(r,ELEMENT),e=>{
        const name=elementKey(e,cor.kind);
        if(name==null){unknown(e);return;}
        toCopy(name,e);
        if(pt.objects[e].keyedKind==='pair')onImpure(e,()=>generic(e));
      });
      onImpure(r,all);
    });
  }
  // Wires one invocation of callable f by a platform model's callback spec k; the parameter at
  // `skip` is fed by the caller (a correlated element position).
  function wireCallback(f,k,c,i,skip) {
    c.site.platformCallbacks.push(f.id);
    const params=k.params??[];
    // A position the model passes only numbers to (an index) keeps numeric keys numeric.
    f.params.forEach((_,j)=>{if(!params[j]?.includes('number'))anyParam(f,j);});
    const feed=(j,target)=>{for(const s of params[j]??[]){const n=src(s,c,`p${i}.${j}`);if(n!==undefined)pt.edge(n,target);}};
    f.params.forEach((p,j)=>{if(j!==skip)feed(j,p);});
    if(f.rest!==undefined)for(let j=f.params.length;j<params.length;j++)feed(j,pt.field(f.restArray,ELEMENT));
    if(!f.arrow&&k.this)for(const s of k.this){const n=src(s,c,`t${i}`);if(n!==undefined)pt.edge(n,f.thisNode);}
    pt.edge(f.ret,cbNode(c));
  }
  // Function.prototype.call/apply/bind and the Promise constructor.
  function engineCall(kind,{site,caller,thisNode,args,result,inst,api}) {
    if(kind==='bind'){if(thisNode!==undefined)pt.edge(thisNode,result);return;}
    if(kind==='descriptors'||kind==='defineProperty'||kind==='defineProperties'){propertyModel(kind,{site,caller,args,result,api});return;}
    if(kind==='promise') {
      const resolver=pt.object({kind:'resolver',target:inst,name:'resolve'});
      for(const a of args)pt.on(a,fo=>{if(!isCallable(fo))return;const f=pt.objects[fo].fn;walkDeferred(f);
        if(!firstTime(site,'pr'+fo))return;site.targets.push(f.id);anyParams(f);for(const p of f.params)pt.add(p,resolver);});
      return;
    }
    if(thisNode===undefined)return;
    pt.on(thisNode,fo=>{if(!isCallable(fo))return;const f=pt.objects[fo].fn;walkDeferred(f);
      if(!firstTime(site,'ca'+fo))return;site.targets.push(f.id);
      if(!f.arrow&&args[0]!==undefined)pt.edge(args[0],f.thisNode);
      if(kind==='call')bindArguments(f,args.slice(1));
      else{anyParams(f);if(args[1]!==undefined){const t=pt.node();load(args[1],ELEMENT,t,caller);for(const p of f.params)pt.edge(t,p);}}
      pt.edge(f.ret,result);});
  }
  // Object.getOwnPropertyDescriptors, defineProperty and defineProperties, field by field: a
  // descriptor's value becomes the field of the same name; a getter runs when the field is read
  // (its result is the field's value), a setter when it is written (it receives what is written).
  function propertyModel(kind,{site,caller,args,result,api}) {
    if(kind==='descriptors') {
      const made=site.made??=new Map();
      let r=made.get(api);
      if(r===undefined){r=pt.object({kind:'value',name:`Object from ${api}`,owner:caller.id,site:site.id,fresh:'Object'});made.set(api,r);pt.add(pt.field(r,'__proto__'),OBJECT_PROTO);}
      pt.add(result,r);
      const descriptor=new Map();
      if(args[0]!==undefined)pt.on(args[0],o=>{if(isPlatform(o))return;eachExisting(o,(name,fnode)=>{
        if(name==='__proto__')return;
        let d=descriptor.get(name);
        if(d===undefined){d=pt.object({kind:'value',name:`descriptor from ${api}`,owner:caller.id,site:site.id,fresh:'Object'});descriptor.set(name,d);
          pt.add(pt.field(d,'__proto__'),OBJECT_PROTO);
          if(name==='*'){const n=pt.node();pt.add(n,d);intoAllFields(n,r);}else put(pt.field(r,name),d);}
        pt.edge(fnode,pt.field(d,'value'));
      });});
      return;
    }
    if(args[0]!==undefined)pt.edge(args[0],result);
    const target=args[0];if(target===undefined)return;
    const define=(name,desc)=>{
      const value=pt.node();load(desc,'value',value,caller);
      store(target,name,value,caller,site);
      const getter=pt.node();load(desc,'get',getter,caller);
      const setter=pt.node();load(desc,'set',setter,caller);
      pt.on(getter,g=>{if(!isCallable(g))return;const f=pt.objects[g].fn;walkDeferred(f);if(!firstTime(site,'get'+g))return;
        site.platformCallbacks.push(f.id);anyParams(f);
        if(!f.arrow)pt.edge(target,f.thisNode);
        const v=pt.node();pt.edge(f.ret,v);store(target,name,v,caller,site);});
      pt.on(setter,g=>{if(!isCallable(g))return;const f=pt.objects[g].fn;walkDeferred(f);if(!firstTime(site,'set'+g))return;
        site.platformCallbacks.push(f.id);anyParams(f);
        if(!f.arrow)pt.edge(target,f.thisNode);
        const written=pt.node();load(target,name,written,caller);if(f.params[0]!==undefined)pt.edge(written,f.params[0]);});
    };
    if(kind==='defineProperty'){const desc=args[2];if(desc!==undefined)eachKey(site.keyArg??null,name=>define(name,desc));return;}
    const descs=args[1];if(descs===undefined)return;
    pt.on(descs,o=>{if(isPlatform(o))return;eachExisting(o,(name,fnode)=>{if(name!=='__proto__')define(name==='*'?null:name,fnode);});});
  }
  function dispatch(o,site,caller,thisNode,args,result,method) {
    const obj=pt.objects[o];
    if(obj.kind==='function') {
      const f=obj.fn;walkDeferred(f);
      if(!firstTime(site,`d${o}`))return;
      site.targets.push(f.id);
      bindArguments(f,args);
      pt.edge(f.ret,result);
      if(thisNode!==undefined&&!f.arrow)pt.edge(thisNode,f.thisNode);
    } else if(obj.kind==='resolver') {
      if(args[0]!==undefined)pt.edge(args[0],pt.field(obj.target,ELEMENT));
    } else if(obj.kind==='platform'||obj.kind==='value') {
      platformCall(site,caller,thisNode,args,result,method,o,undefined,site.name);
    }
  }
  // A spread argument (args.spreadAt) may supply every parameter from its position on.
  function bindArguments(f,args) {
    anyParams(f);
    const at=args.spreadAt??-1;
    args.forEach((a,i)=>{
      if(at>=0&&i>=at){for(let j=i;j<f.params.length;j++)pt.edge(a,f.params[j]);}
      else if(i<f.params.length)pt.edge(a,f.params[i]);
      if(i>=f.params.length||at>=0&&i>=at)if(f.rest!==undefined)pt.edge(a,pt.field(f.restArray,ELEMENT));
    });
  }
  // A method call dispatches on each receiver object separately: a callee read from receiver r
  // runs with `this` holding only the receivers it was read from, so a method (or a platform
  // model) never sees receivers whose own method is another function. Sound: at run time `this`
  // is the object the callee was read from.
  function methodCall(site,caller,base,method,args,result) {
    caller.calls.push(site);
    const nodes=spreadNodes(args,caller);
    const callee=pt.node();
    calls.push({site,caller,callee,args:nodes,result});
    const thisFor=new Map(),methodNodes=caller.methodNodes??=new Map();
    const key=methodKey(method);
    pt.on(base,r=>{
      const k=r*4096+key;let mn=methodNodes.get(k);
      if(mn===undefined){mn=pt.node();methodNodes.set(k,mn);loadFrom(r,method,mn,caller);}
      pt.on(mn,c=>{
        let tn=thisFor.get(c);
        if(tn!==undefined){pt.add(tn,r);return;}
        tn=pt.node();thisFor.set(c,tn);pt.add(tn,r);pt.add(callee,c);
        dispatch(c,site,caller,tn,nodes,result,method);
      });
    });
  }
  const methodKeys=new Map();
  const methodKey=m=>{let k=methodKeys.get(m);if(k===undefined){k=methodKeys.size;if(k>=4096)throw Error('more than 4096 method names');methodKeys.set(m,k);}return k;};
  function call(site,caller,callee,thisNode,args,result,method) {
    caller.calls.push(site);
    const nodes=spreadNodes(args,caller);
    calls.push({site,caller,callee,args:nodes,result});
    pt.on(callee,o=>dispatch(o,site,caller,thisNode,nodes,result,method));
  }
  function spreadNodes(args,caller) {
    const spread=args.findIndex(a=>typeof a==='object'&&a.spread);
    const nodes=args.map(a=>typeof a==='object'?a.node:a);
    if(spread>=0){const el=pt.node();load(nodes[spread],ELEMENT,el,caller);nodes[spread]=el;nodes.spreadAt=spread;}
    return nodes;
  }
  function construct(site,caller,callee,args,result) {
    caller.calls.push(site);site.construct=true;
    const nodes=spreadNodes(args,caller);
    calls.push({site,caller,callee,args:nodes,result});
    pt.on(callee,o=>{
      const obj=pt.objects[o];
      const key=site.id+'|'+o;
      let inst=instances.get(key);
      if(inst===undefined){inst=pt.object({kind:isPlatform(o)?'value':'object',name:'new '+obj.name,owner:caller.id,site:site.id});instances.set(key,inst);}
      pt.add(result,inst);
      if(obj.kind==='function') {
        pt.edge(pt.field(o,'prototype'),pt.field(inst,'__proto__'));
        const ctor=obj.fn;walkDeferred(ctor);
        if(firstTime(site,`n${o}`)){site.targets.push(ctor.id);bindArguments(ctor,nodes);pt.add(ctor.thisNode,inst);pt.edge(ctor.ret,result);}
      } else if(isPlatform(o)) {
        const proto=obj.known&&obj.value?.prototype?platform(obj.name+'.prototype',obj.value.prototype):obj.known?PLATFORM_PROTO:familyObject(obj);
        pt.add(pt.field(inst,'__proto__'),proto);
        platformCall(site,caller,undefined,nodes,result,undefined,o,inst,site.name);
      }
    });
  }

  // --- scopes --------------------------------------------------------------------------
  class Scope {
    constructor(parent,fn){this.parent=parent;this.fn=fn;this.names=new Map();}
    declare(name){let n=this.names.get(name);if(n===undefined){n=pt.node();this.names.set(name,n);}return n;}
    lookup(name){for(let s=this;s;s=s.parent){const n=s.names.get(name);if(n!==undefined)return n;}return undefined;}
  }
  function patternNames(p,out=[]) {
    if(!p)return out;
    switch(p.type){
      case 'Identifier':out.push(p.name);break;
      case 'ObjectPattern':for(const q of p.properties)patternNames(q.type==='RestElement'?q.argument:q.value,out);break;
      case 'ArrayPattern':for(const q of p.elements)patternNames(q,out);break;
      case 'RestElement':patternNames(p.argument,out);break;
      case 'AssignmentPattern':patternNames(p.left,out);break;
    }
    return out;
  }
  function hoistVars(body,scope) {
    const visit=n=>{
      if(!n||typeof n.type!=='string')return;
      if(n.type==='VariableDeclaration'&&n.kind==='var')for(const d of n.declarations)for(const x of patternNames(d.id))scope.declare(x);
      if(/Function|Class/.test(n.type)&&n.type!=='ClassBody')return;
      for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v.type==='string')visit(v);}
    };
    body.forEach(visit);
  }
  function declareBlock(statements,scope) {
    for(const s0 of statements) {
      const s=s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration'?s0.declaration:s0;
      if(!s)continue;
      if(s.type==='VariableDeclaration'&&s.kind!=='var')for(const d of s.declarations)for(const x of patternNames(d.id))scope.declare(x);
      if((s.type==='FunctionDeclaration'||s.type==='ClassDeclaration')&&s.id)scope.declare(s.id.name);
    }
  }

  // --- callables -------------------------------------------------------------------------
  function newCallable(node,mod,owner,name,{arrow=false,kind='function',thisNode}={}) {
    const f={id:functions.length,name,kind,file:mod.file,line:node.loc?.start.line,end:node.loc?.end.line,start:node.start,stop:node.end,owner:owner?.id,
      key:mod.file+':'+node.start,inClone:!!owner?.inClone,
      arrow,params:[],rest:undefined,restArray:undefined,ret:pt.node(),thisNode:thisNode??pt.node(),
      stores:[],reads:new Set(),calls:[],returnsValue:false,allocations:[],exported:false};
    functions.push(f);
    f.object=pt.object({kind:'function',fn:f,name:name??'(anonymous)',owner:owner?.id});
    return f;
  }
  // group: the allocation group of a correlated copy (allocate): the copies of one loop or
  // callback share what platform calls at one site make, as they share literals.
  function site(fn,node,text,group) {
    const s={id:`${fn.file}:${node.start}`,fn:fn.id,line:node.loc?.start.line,node,text,targets:[],platformCallbacks:[],platform:false,resultUsed:true};
    if(group){let m=group.get('s'+node.start);if(m===undefined){m=new Map();group.set('s'+node.start,m);}s.made=m;}
    return s;
  }

  // --- the walker ----------------------------------------------------------------------
  // Module-level functions by local name, the module's exports and its imports, so a direct
  // call can be resolved to its declaration before solving.
  const prepared=new Map(),moduleImports=[],dynamicImports=[];
  function prepareModule(mod) {
    const moduleFn=newCallable(mod.ast,mod,null,'(module load)',{kind:'module'});
    moduleFn.module=true;
    const scope=new Scope(null,moduleFn);
    hoistVars(mod.ast.body,scope);declareBlock(mod.ast.body,scope);
    // Module-level variables and imports, for module-load arrows (moduleRead).
    const vars=new Set();
    for(const s0 of mod.ast.body){const s=s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration'?s0.declaration:s0;
      if(s?.type==='VariableDeclaration')for(const d of s.declarations)for(const x of patternNames(d.id))vars.add(x);}
    scope.module={vars,imports:new Map()};
    const ctx={mod,fn:moduleFn,scope,thisNode:undefined,classInfo:null};
    const local=new Map(),exports=new Map(),imports=new Map(),reexports=[],reassigned=new Set();
    for(const s0 of mod.ast.body) {
      const s=(s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration')?(s0.declaration??s0):s0;
      if(s.type==='FunctionDeclaration'&&s.id&&!s.generator)local.set(s.id.name,s);
      if(s.type==='VariableDeclaration'&&s.kind==='const')for(const d of s.declarations)
        if(d.id.type==='Identifier'&&d.init&&(d.init.type==='ArrowFunctionExpression'||d.init.type==='FunctionExpression')&&!d.init.generator)local.set(d.id.name,d.init);
      if(s0.type==='ExportNamedDeclaration') {
        if(s0.declaration){const d=s0.declaration;for(const n of d.type==='VariableDeclaration'?d.declarations.flatMap(x=>patternNames(x.id)):[d.id.name])exports.set(n,{local:n});}
        for(const sp of s0.specifiers??[]) {
          const ex=sp.exported.name??sp.exported.value,lo=sp.local.name??sp.local.value;
          exports.set(ex,s0.source?{from:resolveImport(mod.file,s0.source.value),name:lo}:{local:lo});
        }
      }
      if(s0.type==='ExportDefaultDeclaration'&&s0.declaration.id)exports.set('default',{local:s0.declaration.id.name});
      if(s0.type==='ExportAllDeclaration'&&!s0.exported)reexports.push(resolveImport(mod.file,s0.source.value));
      if(s0.type==='ImportDeclaration')for(const sp of s0.specifiers)if(sp.type==='ImportSpecifier')
        imports.set(sp.local.name,{from:resolveImport(mod.file,s0.source.value),name:sp.imported.name??sp.imported.value});
      // Every import (and re-export) runs the imported module's load code first.
      if((s0.type==='ImportDeclaration'||s0.type==='ExportAllDeclaration'||s0.type==='ExportNamedDeclaration'&&s0.source)) {
        const t=resolveImport(mod.file,s0.source.value);if(t&&t!==mod.file)moduleImports.push([mod.file,t]);
      }
    }
    // A module binding that is ever reassigned is not a fixed target.
    const visit=n=>{if(!n||typeof n.type!=='string')return;
      if(n.type==='AssignmentExpression'&&n.left.type==='Identifier')reassigned.add(n.left.name);
      if(n.type==='UpdateExpression'&&n.argument.type==='Identifier')reassigned.add(n.argument.name);
      for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v.type==='string')visit(v);}};
    visit(mod.ast);
    for(const r of reassigned)local.delete(r);
    scope.module.imports=imports;
    prepared.set(mod.file,{mod,ctx,local,exports,imports,reexports,keyInfo:keyInfo(mod.ast)});
    // Imports bind before the body runs.
    for(const s of mod.ast.body)if(s.type==='ImportDeclaration') {
      const target=moduleNamespace(mod,s.source.value,moduleFn,s);
      for(const sp of s.specifiers) {
        const b=scope.declare(sp.local.name);
        if(sp.type==='ImportNamespaceSpecifier')pt.edge(target,b);
        else load(target,sp.type==='ImportDefaultSpecifier'?'default':(sp.imported.name??sp.imported.value),b,moduleFn);
      }
    }
  }
  function exportedFunction(file,name,seen=new Set()) {
    const p=prepared.get(file);if(!p||seen.has(file+':'+name))return undefined;seen.add(file+':'+name);
    const e=p.exports.get(name);
    if(e?.local!==undefined){const ast=p.local.get(e.local);return ast&&{p,ast,name:e.local};}
    if(e?.from)return exportedFunction(e.from,e.name,seen);
    if(!e&&name!=='default')for(const r of p.reexports){const t=r&&exportedFunction(r,name,seen);if(t)return t;}
    return undefined;
  }
  function staticTarget(name,ctx) {
    const p=prepared.get(ctx.mod.file);if(!p)return undefined;
    const binding=ctx.scope.lookup(name);
    if(binding===undefined||p.ctx.scope.names.get(name)!==binding)return undefined;
    const ast=p.local.get(name);
    if(ast)return {p,ast,name};
    const imp=p.imports.get(name);
    return imp?.from?exportedFunction(imp.from,imp.name):undefined;
  }
  // Copies nest up to `depth` call sites deep; beyond that a site shares one copy.
  const clones=new Map();
  function cloneFor(siteId,target,caller) {
    const d=(caller.cloneDepth??0)+1;
    const key=d<=depth&&caller.cloneKey?caller.cloneKey+'>'+siteId:siteId;
    let f=clones.get(key);if(f)return f;
    functionValue(target.ast,target.p.ctx,target.name,{clone:c=>{f=c;c.cloneKey=key;c.cloneDepth=d<=depth?d:1;clones.set(key,c);}});
    return f;
  }
  function analyzeModule(mod) {
    const {ctx}=prepared.get(mod.file);
    const {scope,fn:moduleFn}=ctx;
    const ns=nsOf.get(mod.file);
    statements(mod.ast.body,ctx);
    // Exports.
    for(const s of mod.ast.body) {
      if(s.type==='ExportNamedDeclaration') {
        if(s.declaration) {
          const d=s.declaration;
          const names=d.type==='VariableDeclaration'?d.declarations.flatMap(x=>patternNames(x.id)):[d.id.name];
          for(const n of names)pt.edge(scope.lookup(n),pt.field(ns,n));
        }
        if(s.source) {
          const target=moduleNamespace(mod,s.source.value,moduleFn,s);
          for(const sp of s.specifiers)load(target,sp.local.name??sp.local.value,pt.field(ns,sp.exported.name??sp.exported.value),moduleFn);
        } else for(const sp of s.specifiers)pt.edge(scope.lookup(sp.local.name)??global(sp.local.name,ctx),pt.field(ns,sp.exported.name??sp.exported.value));
      } else if(s.type==='ExportDefaultDeclaration') {
        const d=s.declaration;
        const v=(d.type==='FunctionDeclaration'||d.type==='ClassDeclaration')&&d.id?scope.lookup(d.id.name):expression(d,ctx);
        if(v!==undefined)pt.edge(v,pt.field(ns,'default'));
      } else if(s.type==='ExportAllDeclaration') {
        const target=moduleNamespace(mod,s.source.value,moduleFn,s);
        if(s.exported)pt.edge(target,pt.field(ns,s.exported.name));
        else pt.on(target,o=>{if(isPlatform(o))return;pt.onField(o,(name,fnode)=>{if(name!=='default'&&name!=='__proto__')pt.edge(fnode,pt.field(ns,name));});});
      }
    }
  }
  function moduleNamespace(mod,spec,fn,node) {
    const n=pt.node();
    const file=resolveImport(mod.file,spec);
    if(file&&nsOf.has(file))pt.add(n,nsOf.get(file));
    else if(file===null){pt.add(n,platformModules.has(spec)?platform(spec,platformModules.get(spec)):unknownRoot(spec));}
    // A JSON module is plain data (platform-models.mjs family json).
    else if(/\.json$/.test(spec))pt.add(n,platform(familyPath('json')));
    else {unresolvedImports.push({file:mod.file,spec,line:node.loc?.start.line});pt.add(n,platform('unresolved:'+spec));}
    return n;
  }
  function global(name,ctx) {
    if(UNMODELLED_GLOBALS.has(name))note('global:'+name,ctx.fn);
    if(name==='undefined'||name==='NaN'||name==='Infinity')return undefined;
    const n=pt.node();pt.add(n,platformRoot(name));return n;
  }
  function identifier(name,ctx,{write=false}={}) {
    if(name==='arguments'&&!ctx.fn.module){note('arguments',ctx.fn);}
    if(!write)moduleRead(name,ctx);
    return ctx.scope.lookup(name)??global(name,ctx);
  }
  // A function reading a module-level variable (var, let, const: not a function or class) reads
  // what that module's load code initialised; an imported variable, what the exporting module's
  // load code initialised. Recorded for derive.mjs (module-load arrows).
  function moduleRead(name,ctx) {
    let s=ctx.scope;while(s&&!s.names.has(name))s=s.parent;
    if(!s?.module||s.fn===ctx.fn)return;
    const from=s.module.vars.has(name)?s.fn:exportedVariable(s.module.imports.get(name));
    if(from)(ctx.fn.moduleReads??=new Set()).add(from.id);
  }
  // The module load callable whose code initialises an exported variable, following re-exports.
  function exportedVariable(imp,seen=new Set()) {
    if(!imp?.from||seen.has(imp.from+':'+imp.name))return undefined;seen.add(imp.from+':'+imp.name);
    const p=prepared.get(imp.from);if(!p)return undefined;
    const e=p.exports.get(imp.name);
    if(e?.local!==undefined)return p.ctx.scope.module.vars.has(e.local)&&!p.local.has(e.local)?p.ctx.fn:undefined;
    if(e?.from)return exportedVariable({from:e.from,name:e.name},seen);
    if(!e&&imp.name!=='default')for(const r of p.reexports){const t=r&&exportedVariable({from:r,name:imp.name},seen);if(t)return t;}
    return undefined;
  }

  function statements(list,ctx){for(const s of list)statement(s,ctx);}
  function block(list,ctx) {
    const scope=new Scope(ctx.scope,ctx.fn);declareBlock(list,scope);
    statements(list,{...ctx,scope});
  }
  function statement(s,ctx) {
    if(!s)return;
    switch(s.type) {
      case 'ImportDeclaration':return;
      case 'ExportNamedDeclaration':if(s.declaration)statement(s.declaration,ctx);return;
      case 'ExportDefaultDeclaration':
        if((s.declaration.type==='FunctionDeclaration'||s.declaration.type==='ClassDeclaration')&&s.declaration.id)statement(s.declaration,ctx);
        return;
      case 'ExportAllDeclaration':return;
      case 'VariableDeclaration':for(const d of s.declarations){if(d.init)bindPattern(d.id,named(d.init,ctx,bindingName(d.id)),ctx,d.init);}return;
      case 'FunctionDeclaration':{const v=functionValue(s,ctx);pt.edge(v,ctx.scope.lookup(s.id.name));return;}
      case 'ClassDeclaration':{const v=classValue(s,ctx);pt.edge(v,ctx.scope.lookup(s.id.name));return;}
      case 'ExpressionStatement':expression(s.expression,ctx,{unused:true});return;
      case 'ReturnStatement':
        if(s.argument){const v=expression(s.argument,ctx);ctx.fn.returnsValue=true;if(v!==undefined)pt.edge(v,ctx.fn.ret);}
        return;
      case 'IfStatement':{expression(s.test,ctx);const t=truth(s.test,ctx);
        if(t!==false)statement(s.consequent,ctx);if(t!==true)statement(s.alternate,ctx);return;}
      case 'BlockStatement':block(s.body,ctx);return;
      case 'ForStatement':{const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        if(s.init){if(s.init.type==='VariableDeclaration'){declareBlock([s.init],scope);statement(s.init,c);}else expression(s.init,c);}
        if(s.test)expression(s.test,c);if(s.update)expression(s.update,c);statement(s.body,c);return;}
      case 'ForOfStatement':case 'ForInStatement':{
        const cor=loopCorrelation(s,ctx);if(cor){correlatedLoop(s,ctx,cor);return;}
        const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        const src=expression(s.right,c);let el;
        if(s.type==='ForOfStatement'&&src!==undefined){el=pt.node();load(src,ELEMENT,el,ctx.fn);}
        if(s.left.type==='VariableDeclaration'){declareBlock([s.left],scope);if(el!==undefined)bindPattern(s.left.declarations[0].id,el,c);}
        else if(el!==undefined)assign(s.left,el,c);
        statement(s.body,c);return;}
      case 'WhileStatement':case 'DoWhileStatement':expression(s.test,ctx);statement(s.body,ctx);return;
      case 'TryStatement':
        statement(s.block,ctx);
        if(s.handler){const scope=new Scope(ctx.scope,ctx.fn);
          for(const x of patternNames(s.handler.param))pt.add(scope.declare(x),UNKNOWN);
          statement(s.handler.body,{...ctx,scope});}
        statement(s.finalizer,ctx);return;
      case 'ThrowStatement':expression(s.argument,ctx);return;
      case 'SwitchStatement':{expression(s.discriminant,ctx);const all=s.cases.flatMap(c=>c.consequent);
        const scope=new Scope(ctx.scope,ctx.fn);declareBlock(all,scope);const c={...ctx,scope};
        for(const k of s.cases){if(k.test)expression(k.test,c);statements(k.consequent,c);}return;}
      case 'LabeledStatement':statement(s.body,ctx);return;
      case 'WithStatement':note('with',ctx.fn,s);return;
      case 'EmptyStatement':case 'BreakStatement':case 'ContinueStatement':case 'DebuggerStatement':return;
      default:note('statement:'+s.type,ctx.fn,s);
    }
  }

  // Binds a declared pattern to a value node.
  function bindPattern(p,value,ctx) {
    switch(p.type) {
      case 'Identifier':if(value!==undefined)pt.edge(value,ctx.scope.lookup(p.name)??ctx.scope.declare(p.name));return;
      case 'ObjectPattern':
        for(const q of p.properties) {
          if(q.type==='RestElement'){bindPattern(q.argument,value,ctx);continue;}
          const key=propertyKey(q,ctx);
          const t=pt.node();if(value!==undefined)eachKey(key,k=>load(value,k,t,ctx.fn));
          bindPattern(q.value,t,ctx);
        }
        return;
      case 'ArrayPattern':{const t=pt.node();if(value!==undefined)load(value,ELEMENT,t,ctx.fn);
        for(const q of p.elements)if(q) {
          // The key of an entry in a correlated copy is that name's string: no object.
          const name=q===p.elements[0]&&q.type==='Identifier'?namedKey(q,ctx):undefined;
          if(name!=null){bindPattern(q,pt.node(),ctx);continue;}
          bindPattern(q.type==='RestElement'?q.argument:q,q.type==='RestElement'?value:t,ctx);
        }
        return;}
      case 'RestElement':bindPattern(p.argument,value,ctx);return;
      case 'AssignmentPattern':{const d=expression(p.right,ctx);const t=pt.node();
        if(value!==undefined)pt.edge(value,t);if(d!==undefined)pt.edge(d,t);bindPattern(p.left,t,ctx);return;}
      case 'MemberExpression':assign(p,value,ctx);return;
    }
  }
  // A function or class expression bound to a variable or property is named by that binding.
  function bindingName(target) {
    if(target?.type==='Identifier')return target.name;
    if(target?.type==='MemberExpression'&&!target.computed&&target.property.type!=='PrivateIdentifier')return target.property.name;
    if(target?.type==='MemberExpression'&&target.property.type==='PrivateIdentifier')return '#'+target.property.name;
    return undefined;
  }
  function named(e,ctx,name) {
    if(name&&(e.type==='ArrowFunctionExpression'||e.type==='FunctionExpression')&&!e.id)return functionValue(e,ctx,name);
    return expression(e,ctx);
  }
  function assign(target,value,ctx) {
    if(target.type==='Identifier'){if(value!==undefined)pt.edge(value,identifier(target.name,ctx,{write:true}));return;}
    if(target.type==='MemberExpression') {
      const base=expression(target.object,ctx);const key=memberKey(target,ctx);
      const at=site(ctx.fn,target,undefined,ctx.allocGroup);
      eachKey(key,k=>{
        if(base!==undefined&&value!==undefined)store(base,k,value,ctx.fn,at);
        else if(base!==undefined){ctx.fn.stores.push({base,name:k,site:at});primitiveWrite(base,k);}
      });
      return;
    }
    bindPattern(target,value,ctx);
  }
  // A write of a primitive or a deletion: an effect on the object, with no value to propagate.
  function write(target,ctx) {
    if(target.type!=='MemberExpression')return;
    const base=expression(target.object,ctx);
    if(base!==undefined){const at=site(ctx.fn,target,undefined,ctx.allocGroup);eachKey(memberKey(target,ctx),k=>{ctx.fn.stores.push({base,name:k,site:at});if(k===null||k===ELEMENT)mutating(base);});}
  }
  // A write of a primitive: the field exists (an enumerated name, correlatedLoop) though no
  // object flows; an element write may add an unrepresented element.
  function primitiveWrite(base,k) {
    if(k===null||k===ELEMENT||k===STAR){mutating(base);return;}
    pt.on(base,o=>{const x=pt.objects[o];if(x.kind!=='platform'&&x.kind!=='key')pt.feed(pt.field(o,k));});
  }
  function laterKeys(properties,spread) {
    const keys=new Set();
    for(const q of properties.slice(properties.indexOf(spread)+1))if(q.type==='Property'&&!q.computed)keys.add(q.key.type==='Identifier'?q.key.name:String(q.key.value));
    return keys;
  }
  // A property key: a name, ELEMENT for an array index (numbers and index strings are the same
  // property), a list of names (a key proved to be one of several strings), or null (any field).
  function propertyKey(p,ctx) {
    if(!p.computed)return p.key.type==='Identifier'?literalKey(p.key.name):p.key.type==='PrivateIdentifier'?'#'+p.key.name:literalKey(p.key.value);
    // In a copy for an unknown name, a literal's computed key may be any name.
    const k=computedKey(p.key,ctx);return k===STAR?null:k;
  }
  function memberKey(m,ctx) {
    if(!m.computed)return m.property.type==='PrivateIdentifier'?'#'+m.property.name:literalKey(m.property.name);
    return computedKey(m.property,ctx);
  }
  function computedKey(k,ctx) {
    if(k.type==='Literal')return literalKey(k.value);
    if(!ctx.noWalk)expression(k,ctx);
    if(k.type==='Identifier'&&ctx.namedKeys) {
      const r=prepared.get(ctx.mod.file).keyInfo.bindingOf(k);
      const n=r&&ctx.namedKeys.get(r);if(n!==undefined)return n;
    }
    const key=prepared.get(ctx.mod.file).keyInfo.keyOf(k);
    if(key===undefined)return null;
    if(!key.params)return key;
    // A key numeric on parameters: the walks of the functions declaring them, enclosing this one.
    const params=[];
    for(const r of key.params) {
      let f=ctx.fn;while(f&&f.start!==r.fn.start)f=f.owner!=null?functions[f.owner]:null;
      if(!f)return null;
      params.push({f,index:r.index});
    }
    return {params};
  }
  // Calls fn for each field a key names. A key numeric on parameters names the element field,
  // and every field as soon as one of those parameters may receive something other than a number.
  function eachKey(key,fn) {
    if(key===null||typeof key!=='object'){fn(key);return;}
    if(Array.isArray(key)){for(const k of key)fn(k);return;}
    fn(ELEMENT);
    let widened=false;const widen=()=>{if(!widened){widened=true;fn(null);}};
    for(const {f,index} of key.params)whenAnyParam(f,index,widen);
  }
  // What each function's parameters may receive: every position not proved numeric is `any`.
  function whenAnyParam(f,index,fn) {
    if(f.allAny||f.anyParams?.has(index)){fn();return;}
    const w=f.paramWaiters??=new Map();(w.get(index)??w.set(index,[]).get(index)).push(fn);
  }
  function anyParam(f,index) {
    if(f.allAny||f.anyParams?.has(index))return;
    (f.anyParams??=new Set()).add(index);
    const w=f.paramWaiters?.get(index);if(w){f.paramWaiters.delete(index);for(const fn of w)fn();}
  }
  function anyParams(f) {
    if(f.allAny)return;
    f.allAny=true;
    const w=f.paramWaiters;if(w){f.paramWaiters=null;for(const list of w.values())for(const fn of list)fn();}
  }

  // --- expressions: return the node holding the value, or undefined for primitives --------
  function expression(e,ctx,{unused=false}={}) {
    if(!e)return undefined;
    switch(e.type) {
      case 'Identifier':return identifier(e.name,ctx);
      case 'Literal':case 'TemplateLiteral':
        if(e.type==='TemplateLiteral')for(const x of e.expressions)expression(x,ctx);
        if(e.regex){const o=allocate('regexp',ctx,e);pt.add(pt.field(o,'__proto__'),REGEXP_PROTO);const v=pt.node();pt.add(v,o);return v;}
        return undefined;
      case 'ThisExpression':return ctx.thisNode;
      case 'Super':return ctx.classInfo?.superNode;
      case 'ArrayExpression':{
        // A list of strings (and of other keyed arrays) is keyed; [name, value] with a known
        // name is a pair (correlation tracking). Copies share a pair only with its own name.
        const keyed=keyedKindOf(e,ctx)==='key';
        const pairName=!keyed&&e.elements.length===2&&e.elements[0]&&e.elements[0].type!=='SpreadElement'&&e.elements[1]?.type!=='SpreadElement'?staticName(e.elements[0],ctx):undefined;
        const before=pt.objects.length;
        const o=allocate('array',ctx,e,pairName===undefined?'':'#'+pairName);const v=pt.node();pt.add(v,o);const el=pt.field(o,ELEMENT);
        pt.add(pt.field(o,'__proto__'),ARRAY_PROTO);
        const x=pt.objects[o];
        if(o>=before) {
          if(keyed){x.keyed=true;x.keyedKind='array';}
          else if(pairName!==undefined){x.keyed=true;x.keyedKind='pair';x.pairKey=pairName;}
        }
        for(const x of e.elements){if(!x)continue;
          if(x.type==='SpreadElement'){const s=expression(x.argument,ctx);if(s!==undefined){load(s,ELEMENT,el,ctx.fn);
            if(keyed)pt.on(s,r=>{const y=pt.objects[r];if(y.keyed===true&&y.keyedKind==='array')onImpure(r,()=>markImpure(o));else markImpure(o);});}}
          else{if(keyed)put(el,keyObject(stringKey(x)));const s=expression(x,ctx);if(s!==undefined)pt.edge(s,el);}}
        return v;}
      case 'ObjectExpression':{const o=allocate('object',ctx,e);const v=pt.node();pt.add(v,o);
        pt.add(pt.field(o,'__proto__'),OBJECT_PROTO);
        for(const p of e.properties) {
          if(p.type==='SpreadElement'){const s=expression(p.argument,ctx);if(s!==undefined)copyFields(s,o,laterKeys(e.properties,p));continue;}
          const key=propertyKey(p,ctx);
          if(p.kind==='get'||p.kind==='set')note('accessor',ctx.fn,p);
          const val=p.value.type==='FunctionExpression'||p.value.type==='ArrowFunctionExpression'?functionValue(p.value,ctx,typeof key==='string'?key:undefined,{thisNode:undefined}):expression(p.value,ctx);
          if(val===undefined){eachKey(key,k=>{if(k!==null)pt.feed(pt.field(o,k));});continue;}
          eachKey(key,k=>{
            if(k===null){pt.edge(val,pt.field(o,'*'));pt.onField(o,(name,f)=>pt.edge(val,f,name!=='*'));}
            else pt.edge(val,pt.field(o,k));
          });
        }
        return v;}
      case 'FunctionExpression':case 'ArrowFunctionExpression':case 'FunctionDeclaration':return functionValue(e,ctx);
      case 'ClassExpression':case 'ClassDeclaration':return classValue(e,ctx);
      case 'MemberExpression':{
        const base=expression(e.object,ctx);const key=memberKey(e,ctx);
        if(!e.computed&&UNMODELLED_MEMBERS.has(key))note('member:'+key,ctx.fn,e);
        if(base===undefined)return undefined;
        const t=pt.node();eachKey(key,k=>load(base,k,t,ctx.fn));return t;}
      case 'ChainExpression':return expression(e.expression,ctx,{unused});
      case 'CallExpression':return callExpression(e,ctx,unused);
      case 'NewExpression':{const callee=expression(e.callee,ctx);const args=argumentNodes(e.arguments,ctx);const r=pt.node();
        if(callee!==undefined)construct({...site(ctx.fn,e,source(e.callee,ctx),ctx.allocGroup),resultUsed:!unused,name:calleeName(e.callee)},ctx.fn,callee,args,r);return r;}
      case 'AssignmentExpression':{
        const v=named(e.right,ctx,e.operator==='='?bindingName(e.left):undefined);
        if(e.operator==='='||e.operator==='??='||e.operator==='||='||e.operator==='&&=')assign(e.left,v,ctx);
        else{expression(e.left,ctx);write(e.left,ctx);}
        return v;}
      case 'SequenceExpression':{let v;for(const x of e.expressions)v=expression(x,ctx);return v;}
      case 'ConditionalExpression':{expression(e.test,ctx);const t=truth(e.test,ctx);
        return union([t!==false?expression(e.consequent,ctx):undefined,t!==true?expression(e.alternate,ctx):undefined]);}
      case 'LogicalExpression':{
        // A test a correlated copy decides (k === 'name') leaves the other operand unevaluated.
        const left=expression(e.left,ctx),t=e.operator==='??'?undefined:truth(e.left,ctx);
        if(e.operator==='&&'&&t===false||e.operator==='||'&&t===true)return left;
        return union([left,expression(e.right,ctx)]);}
      case 'BinaryExpression':expression(e.left,ctx);expression(e.right,ctx);return undefined;
      case 'UnaryExpression':expression(e.argument,ctx);if(e.operator==='delete')write(e.argument,ctx);return undefined;
      case 'UpdateExpression':expression(e.argument,ctx);write(e.argument,ctx);return undefined;
      case 'AwaitExpression':{const v=expression(e.argument,ctx);if(v===undefined)return undefined;const t=pt.node();pt.edge(v,t);load(v,ELEMENT,t,ctx.fn);return t;}
      case 'YieldExpression':note('yield',ctx.fn,e);expression(e.argument,ctx);return undefined;
      case 'SpreadElement':return expression(e.argument,ctx);
      case 'TaggedTemplateExpression':{for(const x of e.quasi.expressions)expression(x,ctx);
        const callee=expression(e.tag,ctx);const r=pt.node();if(callee!==undefined)call(site(ctx.fn,e,source(e.tag,ctx),ctx.allocGroup),ctx.fn,callee,undefined,[],r);return r;}
      case 'ImportExpression':{
        if(e.source.type==='Literal'){const r=pt.node();const p=allocate('promise',ctx,e);pt.add(r,p);
          {const t=resolveImport(ctx.mod.file,e.source.value);if(t)dynamicImports.push([ctx.fn,t]);}
          pt.edge(moduleNamespace(ctx.mod,e.source.value,ctx.fn,e),pt.field(p,ELEMENT));return r;}
        note('dynamic-import',ctx.fn,e);expression(e.source,ctx);return undefined;}
      case 'MetaProperty':return undefined;
      case 'ParenthesizedExpression':return expression(e.expression,ctx,{unused});
      default:note('expression:'+e.type,ctx.fn,e);return undefined;
    }
  }
  function source(n,ctx){return ctx.mod.text.slice(n.start,Math.min(n.end,n.start+80));}
  function union(nodes) {
    const present=nodes.filter(n=>n!==undefined);
    if(present.length<2)return present[0];
    const t=pt.node();for(const n of present)pt.edge(n,t);return t;
  }
  // Copies of a correlated loop or callback for different names share each allocation site's
  // object (one object per site and walk of the enclosing function, as without correlation):
  // copies multiply code walks, not abstract objects.
  function allocate(kind,ctx,e,variant='') {
    const g=ctx.allocGroup,k='a'+e.start+variant;
    if(g){const o=g.get(k);if(o!==undefined)return o;}
    const o=pt.object({kind:'object',shape:kind,owner:ctx.fn.id,file:ctx.mod.file,line:e.loc?.start.line});ctx.fn.allocations.push(o);
    if(g)g.set(k,o);
    return o;
  }
  function argumentNodes(list,ctx,cb) {
    return list.map((a,i)=>{
      if(cb&&i===0&&(a.type==='ArrowFunctionExpression'||a.type==='FunctionExpression')&&!a.generator) {
        const record=keyBinding(a.params[cb.param],cb.kind,ctx,false);
        if(record)return functionValue(a,ctx,undefined,{defer:true,correlate:{param:cb.param,kind:cb.kind,record}});
      }
      if(a.type==='SpreadElement'){const n=expression(a.argument,ctx);return {spread:true,node:n??pt.node()};}
      return expression(a,ctx)??pt.node();
    });
  }
  function callExpression(e,ctx,unused) {
    const c=e.callee;
    if(c.type==='Super') {
      const args=argumentNodes(e.arguments,ctx);const r=pt.node();
      const sup=ctx.classInfo?.superNode;
      if(sup!==undefined)call({...site(ctx.fn,e,'super(...)',ctx.allocGroup),resultUsed:false},ctx.fn,sup,ctx.thisNode,args,r,undefined);
      return r;
    }
    let callee,thisNode,method;
    if(c.type==='MemberExpression'||c.type==='ChainExpression'&&c.expression.type==='MemberExpression') {
      const m=c.type==='ChainExpression'?c.expression:c;
      thisNode=m.object.type==='Super'?ctx.thisNode:expression(m.object,ctx);
      const base=m.object.type==='Super'?ctx.classInfo?.superProtoNode:thisNode;
      method=memberKey(m,ctx);
      if(method!==null&&typeof method==='object')method=null;
      if(!m.computed&&UNMODELLED_MEMBERS.has(method))note('member:'+method,ctx.fn,m);
      if(m.computed&&m.property.type!=='Literal')note('computed-callee',ctx.fn,m);
      if(base===thisNode) {
        // An inline callback of an array method on a keyed array is correlated (callbackCopy).
        const at=CALLBACK_ELEMENT.get(method),kind=at!==undefined&&!m.computed?keyedKindOf(m.object,ctx):null;
        const args=argumentNodes(e.arguments,ctx,kind?{param:at,kind}:undefined);const r=pt.node();
        // Object.defineProperty names its field by its second argument.
        const keyArg=method==='defineProperty'&&e.arguments[1]&&e.arguments[1].type!=='SpreadElement'?computedKey(e.arguments[1],{...ctx,noWalk:true}):undefined;
        if(base!==undefined)methodCall({...site(ctx.fn,e,source(c,ctx),ctx.allocGroup),resultUsed:!unused,name:calleeName(c),member:method,receiverNode:thisNode,keyArg},ctx.fn,base,method,args,r);
        else ctx.fn.calls.push({...site(ctx.fn,e,source(c,ctx),ctx.allocGroup),resultUsed:!unused,name:calleeName(c),member:method});
        return r;
      }
      callee=pt.node();if(base!==undefined)load(base,method,callee,ctx.fn);
    } else {
      const target=c.type==='Identifier'&&cloning?staticTarget(c.name,ctx):undefined;
      if(target) {
        // A direct call gets its own copy of the callee (one level of call-site context), so
        // values return only to the call that supplied them.
        const args=argumentNodes(e.arguments,ctx);const r=pt.node();
        const s={...site(ctx.fn,e,source(c,ctx),ctx.allocGroup),resultUsed:!unused};
        ctx.fn.calls.push(s);
        // Copies of a correlated loop share the callee's copy at a site: one copy per name
        // (siteId#name) made recursive record walkers quadratic in field names (DEVLOG).
        const f=cloneFor(s.id,target,ctx.fn);
        s.targets.push(f.id);
        bindArguments(f,spreadNodes(args,ctx.fn));pt.edge(f.ret,r);
        return r;
      }
      callee=expression(c,ctx);
      if(c.type!=='Identifier'&&!/Function/.test(c.type))note('callee-expression:'+c.type,ctx.fn,c);
    }
    const args=argumentNodes(e.arguments,ctx);
    const r=pt.node();
    if(callee!==undefined)call({...site(ctx.fn,e,source(c,ctx),ctx.allocGroup),resultUsed:!unused,name:calleeName(c),member:method,receiverNode:thisNode},ctx.fn,callee,thisNode,args,r,method);
    return r;
  }
  function calleeName(c){return c.type==='Identifier'?c.name:c.type==='MemberExpression'&&!c.computed?c.property.name:undefined;}

  function functionValue(node,ctx,name,{thisNode,clone,defer=false,correlate}={}) {
    const arrow=node.type==='ArrowFunctionExpression';
    const f=newCallable(node,ctx.mod,ctx.fn,name??node.id?.name,{arrow,thisNode:arrow?ctx.thisNode:thisNode});
    if(clone){f.inClone=true;clone(f);}
    f.walk={node,ctx,name:name??node.id?.name,thisNode};
    if(correlate)f.correlate=correlate;
    if(arrow&&f.thisNode===undefined)f.thisNode=pt.node();
    const v=pt.node();pt.add(v,f.object);
    pt.add(pt.field(f.object,'__proto__'),FUNCTION_PROTO);
    const scope=new Scope(ctx.scope,f);
    if(node.type==='FunctionExpression'&&node.id)pt.add(scope.declare(node.id.name),f.object);
    const fctx={mod:ctx.mod,fn:f,scope,thisNode:f.thisNode,classInfo:arrow?ctx.classInfo:ctx.classInfo,namedKeys:ctx.namedKeys,allocGroup:ctx.allocGroup};
    for(const p of node.params) {
      const pn=pt.node();
      if(p.type==='RestElement'){f.rest=pn;f.restArray=pt.object({kind:'object',shape:'array',owner:f.id});pt.add(pn,f.restArray);
        for(const x of patternNames(p.argument))scope.declare(x);bindPattern(p.argument,pn,fctx);continue;}
      f.params.push(pn);
      for(const x of patternNames(p))scope.declare(x);
      bindPattern(p,pn,fctx);
    }
    const body=()=>{
      if(node.body.type==='BlockStatement') {
        hoistVars(node.body.body,scope);declareBlock(node.body.body,scope);
        statements(node.body.body,fctx);
      } else {
        const v2=expression(node.body,fctx);f.returnsValue=true;f.expressionBody=true;
        if(v2!==undefined)pt.edge(v2,f.ret);
      }
    };
    if(defer){f.deferred=body;deferredFns.push(f);}else body();
    if(node.generator)note('generator',f,node);
    return v;
  }
  function classValue(node,ctx) {
    const name=node.id?.name??'(class)';
    const ctorNode=node.body.body.find(m=>m.kind==='constructor');
    const owner=ctx.fn;
    const superNode=node.superClass?expression(node.superClass,ctx):undefined;
    const ctor=newCallable(ctorNode?.value??node,ctx.mod,owner,name,{kind:'class'});
    const v=pt.node();pt.add(v,ctor.object);
    const proto=pt.object({kind:'object',shape:'prototype',owner:owner.id,name:name+'.prototype'});
    put(pt.field(ctor.object,'prototype'),proto);
    let superProtoNode;
    if(superNode!==undefined) {
      superProtoNode=pt.node();load(superNode,'prototype',superProtoNode,owner);
      pt.edge(superProtoNode,pt.field(proto,'__proto__'));
      pt.edge(superNode,pt.field(ctor.object,'__proto__'));
    } else pt.add(pt.field(proto,'__proto__'),OBJECT_PROTO);
    const classInfo={superNode,superProtoNode};
    const scope=new Scope(ctx.scope,ctor);
    if(node.id)pt.add(scope.declare(node.id.name),ctor.object);
    const cctx={mod:ctx.mod,fn:ctor,scope,thisNode:ctor.thisNode,classInfo,namedKeys:ctx.namedKeys,allocGroup:ctx.allocGroup};
    if(ctorNode) {
      const fnode=ctorNode.value;
      for(const p of fnode.params){const pn=pt.node();ctor.params.push(pn);for(const x of patternNames(p))scope.declare(x);bindPattern(p,pn,cctx);}
      hoistVars(fnode.body.body,scope);declareBlock(fnode.body.body,scope);
      statements(fnode.body.body,cctx);
    } else if(superNode!==undefined) {
      // An implicit constructor forwards its arguments to the parent.
      const rest=pt.node();ctor.rest=rest;ctor.restArray=pt.object({kind:'object',shape:'array',owner:ctor.id});pt.add(rest,ctor.restArray);
      call({...site(ctor,node,'super(...)'),resultUsed:false},ctor,superNode,ctor.thisNode,[{spread:true,node:rest}],pt.node(),undefined);
    }
    for(const m of node.body.body) {
      if(m.kind==='constructor')continue;
      if(m.type==='StaticBlock'){statements(m.body,{...cctx,thisNode:v});continue;}
      let key=propertyKey(m,cctx);if(key!==null&&typeof key==='object')key=null;
      const holder=m.static?ctor.object:proto;
      if(m.type==='MethodDefinition') {
        if(m.kind==='get'||m.kind==='set')note('accessor',ctor,m);
        const mv=functionValue(m.value,{...ctx,classInfo},`${name}.${key}`,{thisNode:undefined});
        // Methods see the instance (or the class, if static) as this.
        if(key!==null)pt.edge(mv,pt.field(holder,key));
      } else if(m.type==='PropertyDefinition') {
        if(!m.value)continue;
        const target=m.static?v:ctor.thisNode;
        const fctx=m.static?{...cctx,thisNode:v}:cctx;
        const val=m.value.type==='ArrowFunctionExpression'||m.value.type==='FunctionExpression'?functionValue(m.value,fctx,`${name}.${key}`):expression(m.value,fctx);
        if(val!==undefined&&key!==null)store(target,key,val,ctor,site(ctor,m));
        else if(key!==null)primitiveWrite(target,key);
      }
    }
    return v;
  }

  // Namespaces first, so imports in any order resolve.
  for(const mod of modules){nsOf.set(mod.file,pt.object({kind:'object',shape:'module',name:mod.file,owner:null}));}
  for(const mod of modules)prepareModule(mod);
  for(const mod of modules)analyzeModule(mod);
  // A call whose callee the analysis holds no value for calls code outside the model (a method
  // of data with no objects: a string, parsed or platform-supplied data, a parameter nobody
  // passes a function to). As Jelly does for external calls (dev-map/influence/JELLY.md), every
  // function handed to it, directly or as a field of an argument (an options callback), is taken
  // as invoked, so the call edge exists. With unknownData its result and those functions'
  // arguments are also plain data of unknown shape (the json family, methods modelled by name);
  // that is off by default: it multiplied the core/path closure's solve 250-fold (DEVLOG
  // 2026-10-04). Applied after a fixed point to the calls still unresolved, until none is new.
  function settle() {
    const DATA=platform(familyPath('json'));
    let rounds=0,unknownCalls=0;
    for(;;) {
      pt.solve();rounds++;
      let fresh=0;
      // Correlation fallbacks: Object.keys/entries of nothing known has unknown names; a loop
      // or callback that nothing reached is walked generically, as code that may run.
      for(const k of keyedSources)if(!k.done&&!pt.pts[k.source].size){k.done=true;k.add(null);fresh++;}
      for(const l of pendingLoops)if(!l.walked){l.generic();fresh++;}
      for(const settleCallback of pendingCallbacks)if(settleCallback())fresh++;
      for(const f of deferredFns)if(f.deferred&&!f.keyCopies){walkDeferred(f);fresh++;}
      if(fresh)continue;
      for(const r of calls) {
        if(r.unknown||pt.pts[r.callee].size)continue;
        r.unknown=true;fresh++;r.site.unknownCallee=true;
        const invoke=o=>{
          if(!isCallable(o)||!firstTime(r.site,'u'+o))return;
          const f=pt.objects[o].fn;walkDeferred(f);r.site.platformCallbacks.push(f.id);anyParams(f);
          if(unknownData)for(const p of f.params)pt.add(p,DATA);
          if(unknownData&&f.rest!==undefined)pt.add(f.rest,DATA);
          if(unknownData&&!f.arrow)pt.add(f.thisNode,DATA);
        };
        for(const a of r.args)pt.on(a,o=>{invoke(o);if(!isCallable(o)&&!isPlatform(o))pt.onField(o,(name,fnode)=>{if(name!=='__proto__')pt.on(fnode,invoke);});});
        if(unknownData)pt.add(r.result,DATA);
      }
      unknownCalls+=fresh;
      if(!fresh)return {rounds,unknownCalls};
    }
  }
  // Module load activations by callable id: importer's load code -> imported module's load code.
  // A dynamic import() activates the imported module from the calling function.
  const moduleActivations=()=>[...moduleImports.filter(([a,b])=>prepared.has(a)&&prepared.has(b)).map(([a,b])=>[prepared.get(a).ctx.fn.id,prepared.get(b).ctx.fn.id]),
    ...dynamicImports.filter(([,b])=>prepared.has(b)).map(([f,b])=>[f.id,prepared.get(b).ctx.fn.id])];
  return {functions,unmodelled,unresolvedImports,namespaces:nsOf,platformObjects,accessorReads,settle,correlation,genericWhy,moduleActivations};
}

// After solving: every call site's platform APIs (merged over the copies that walk it) and the
// writes to platform properties, for the inventory (plans/dev-maps.md milestone 2). A call that
// reaches nothing, though its receiver holds a platform value with a runtime value, names a
// member that value lacks in the analysis process (absent here, present where SAAM runs).
export function platformInventory(pt,{functions}) {
  const sites=new Map();
  const entry=(f,s,kind)=>sites.get(s.id)??sites.set(s.id,{file:f.file,line:s.line,text:s.text,kind,apis:new Map(),reached:false}).get(s.id);
  for(const f of functions) {
    for(const s of f.calls) {
      const r=entry(f,s,s.construct?'new':'call');
      if(s.targets.length)r.reached=true;
      for(const [api,how] of s.apis??[])r.apis.set(api,how);
      if(!s.apis&&!s.targets.length&&s.member!==undefined&&s.receiverNode!==undefined) {
        for(const o of pt.pts[s.receiverNode]){const x=pt.objects[o];if(x.kind==='platform'&&x.known&&x.value!=null){r.absent=`${x.name}.${s.member}`;break;}}
      }
    }
    for(const st of f.stores)if(st.site?.apis)for(const [api,how] of st.site.apis)entry(f,st.site,'set').apis.set(api,how);
  }
  const list=[...sites.values()].map(r=>({...r,apis:Object.fromEntries(r.apis)}));
  for(const r of list)if(r.absent){r.apis[r.absent]='absent';}
  return list.filter(r=>Object.keys(r.apis).length);
}

export function resolver(files,{aliases={}}={}) {
  const known=new Set(files);
  return (from,spec)=>{
    const alias=aliases[`${from}:${spec}`];if(alias)return alias;
    if(spec.startsWith('node:'))return null;
    if(!spec.startsWith('.')&&!spec.startsWith('/'))return null;
    const file=spec.startsWith('/')?spec.slice(1):posix.normalize(posix.join(posix.dirname(from),spec));
    return known.has(file)?file:undefined;
  };
}
