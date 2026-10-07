// Source instrumentation for influence traces (see trace.mjs). Rewrites one module so the trace
// runtime (runtime.mjs, global __T) sees every entry into a SAAM callable, the call site it came
// from and whether the analysis counts its result as used. Object writes and reads are not traced
// yet (see .local/agent-progress/worker-trace.md).
//
// Callables are identified exactly as the analysis identifies them (dev-map/influence/
// constraints.mjs): file + ':' + the acorn start offset of the function node; a class is its
// explicit constructor's function node, or the class node when it has none; module load code
// is the Program node. Field initialisers and static blocks belong to the class callable.
// The rewrite only inserts text, so every original offset keeps its meaning.
import * as acorn from 'acorn';

// Scope: the same rule as dev-map/influence/run.mjs (keep them equal).
const ROOTS=/^(core|studio|skills|workspaces|scripts|adapters)\/|^packaging\/(application|launch|build|native-repair)\.mjs$/;
const OUT=/(^|\/)(tests?|demos?|bench|benchmarks?|fixtures?|examples?|vendor|node_modules)\/|\.test\.|\.min\.|^scripts\/(bench|bambu-audit)|^packaging\/(windows|macos)\//;
export const inScope=f=>/\.(mjs|js)$/.test(f)&&ROOTS.test(f)&&!OUT.test(f);

const FUNCTION=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const CLASS=new Set(['ClassDeclaration','ClassExpression']);

export function parse(text) {
  return acorn.parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true,preserveParens:true});
}

// register.fn({key,file,line,name,kind,start,stop,owner}) and register.site({fn,file,start,line,
// used,text,callee}) return numeric ids the inserted code passes to the runtime.
export function instrument(text,file,register) {
  const ast=parse(text);
  const edits=[];
  const insert=(pos,str,order)=>edits.push({pos,str,order});
  // Wrapping [start,end) with nesting rank r (its span, adjusted so a function body wrapper is
  // outside, and a suspension inside, any same-span wrap): outer prefixes first, inner suffixes first.
  const wrap=(start,end,pre,post,tweak=0)=>{const r=end-start+tweak;insert(start,pre,[1,-r]);insert(end,post,[0,r]);};
  const counts={functions:0,sites:0,forAwait:0,accessors:0};
  const fnRecord=(node,name,kind,owner)=>{
    counts.functions++;
    return {id:register.fn({key:file+':'+node.start,file,line:node.loc.start.line,name:name??'(anonymous)',kind,start:node.start,stop:node.end,owner:owner?.key}),
      key:file+':'+node.start,node,async:!!node.async,generator:!!node.generator};
  };
  const moduleFn=fnRecord(ast,'(module load)','module',null);
  moduleFn.async=true;// top-level await
  const keyName=(p)=>{
    if(!p.computed)return p.key.type==='Identifier'?p.key.name:p.key.type==='PrivateIdentifier'?'#'+p.key.name:String(p.key.value);
    if(p.key.type==='Literal')return String(p.key.value);
    return null;
  };
  const source=node=>text.slice(node.start,node.end).replace(/\s+/g,' ').slice(0,80);

  // Prologue/epilogue around a block body; the runtime's current callable is saved in __ts.
  function enterBlock(block,fn,afterDirectives=true) {
    let at=block.start+1;
    if(afterDirectives)for(const s of block.body){if(s.type==='ExpressionStatement'&&s.directive!==undefined)at=s.end;else break;}
    if(at===block.end-1){insert(at,`__T.cur=__T.e(${fn.id});`,[1,-Infinity]);return;}// empty body
    insert(at,`let __ts=__T.e(${fn.id}),__tx;try{`,[1,-Infinity]);
    insert(block.end-1,`}finally{__T.cur=__ts}`,[0,Infinity]);
  }
  function func(node,ctx,name,kind='function') {
    const fn=fnRecord(node,name??node.id?.name,node.generator?'generator':kind,ctx.fn);
    const inner={fn,classFn:ctx.classFn};
    if(node.id)visit(node.id,inner);
    for(const p of node.params)visit(p,inner);// defaults run before the body: attributed to the caller's frame
    if(node.body.type==='BlockStatement'){enterBlock(node.body,fn);for(const s of node.body.body)visit(s,inner);}
    else {
      wrap(node.body.start,node.body.end,`{let __ts=__T.e(${fn.id}),__tx;try{return `,`}finally{__T.cur=__ts}}`,0.5);
      visit(node.body,inner);
    }
  }
  function klass(node,ctx) {
    const name=node.id?.name??'(class)';
    const ctor=node.body.body.find(m=>m.kind==='constructor');
    if(node.superClass)visit(node.superClass,ctx);
    // The class callable: its explicit constructor, or the class itself.
    let classFn;
    if(ctor) {
      classFn=fnRecord(ctor.value,name,'class',ctx.fn);
      const inner={fn:classFn,classFn};
      for(const p of ctor.value.params)visit(p,inner);
      enterBlock(ctor.value.body,classFn);
      for(const s of ctor.value.body.body)visit(s,inner);
    } else {
      // The implicit constructor, written out so construction enters the class callable (and
      // a derived class's parent is called from it, not from the code that said `new`).
      classFn=fnRecord(node,name,'class',ctx.fn);
      insert(node.body.start+1,node.superClass
        ?`constructor(...__ta){let __ts=__T.e(${classFn.id});try{super(...__ta)}finally{__T.cur=__ts}}`
        :`constructor(){__T.cur=__T.e(${classFn.id})}`,[1,-Infinity]);
    }
    const cctx={fn:classFn,classFn};
    for(const m of node.body.body) {
      if(m===ctor)continue;
      if(m.type==='StaticBlock'&&!m.body.length){insert(m.end-1,`__T.cur=__T.e(${classFn.id});`,[1,-Infinity]);continue;}
      if(m.type==='StaticBlock'){insert(m.start+6+text.slice(m.start+6,m.end).indexOf('{')+1,`let __ts=__T.e(${classFn.id}),__tx;try{`,[1,-Infinity]);insert(m.end-1,`}finally{__T.cur=__ts}`,[0,Infinity]);for(const s of m.body)visit(s,cctx);continue;}
      if(m.computed)visit(m.key,ctx);
      const key=keyName(m);
      if(m.type==='MethodDefinition') {
        if(m.kind==='get'||m.kind==='set')counts.accessors++;
        func(m.value,ctx,`${name}.${key}`,m.kind==='get'||m.kind==='set'?'accessor':'function');
      } else if(m.type==='PropertyDefinition'&&m.value) {
        if(FUNCTION.has(m.value.type))func(m.value,cctx,`${name}.${key}`);
        else {wrap(m.value.start,m.value.end,`__T.fi(${classFn.id},()=>(`,`))`,0.5);visit(m.value,cctx);}
      }
    }
  }
  function call(node,ctx) {
    const unused=ctx.unusedNode===node;
    const callee=node.callee;
    const calleeText=callee.type==='Super'?'super':source(callee);
    const sid=register.site({fn:ctx.fn.id,file,start:node.start,line:node.loc.start.line,used:!unused,text:calleeText,
      callee:callee.type==='MemberExpression'&&!callee.computed?(callee.property.name??null):callee.type==='Identifier'?callee.name:callee.type==='Super'?'super':null,
      kind:node.type==='NewExpression'?'new':'call'});
    counts.sites++;
    const args=node.arguments;
    // When the call returns, its site is no longer pending (a platform callee that called no
    // SAAM code leaves it set). Not inside optional chains, whose short-circuit spans the chain.
    if(!ctx.chain)wrap(node.start,node.end,'__T.cl(',')',-0.1);
    if(args.length) {
      const last=args[args.length-1];
      const target=last.type==='SpreadElement'?last.argument:last;
      wrap(target.start,target.end,`__T.st(${sid},`,`)`);
    } else if(text[node.end-1]===')'&&!(node.type==='NewExpression'&&node.callee.end===node.end)) {
      insert(node.end-1,`...__T.z(${sid})`,[1,0]);
    }
  }
  // Suspension points: restore the resumer's callable while suspended, re-enter on resumption.
  function suspend(node,ctx) {
    const fn=ctx.fn;
    const r=node.end-node.start-0.25;
    insert(node.start,node.argument?'(__tx=':'(__T.cur=__ts,__tx=',[1,-r]);
    if(node.argument)wrap(node.argument.start,node.argument.end,'__T.sp(__ts,',')',-0.25);
    insert(node.end,`,__ts=__T.cur,__T.cur=${fn.id},__tx)`,[0,r]);
  }

  function visit(node,ctx,parent) {
    if(!node||typeof node.type!=='string')return;
    if(FUNCTION.has(node.type)){func(node,ctx);return;}
    if(CLASS.has(node.type)){klass(node,ctx);return;}
    switch(node.type) {
      case 'Property':
        if(node.computed)visit(node.key,ctx);
        if(FUNCTION.has(node.value.type)){if(node.kind!=='init')counts.accessors++;func(node.value,ctx,keyName(node),node.kind==='init'?'function':'accessor');}
        else visit(node.value,ctx);
        return;
      case 'ExpressionStatement':{
        // Result unused, as the analysis decides it: through chains and parentheses only.
        let e=node.expression;while(e.type==='ParenthesizedExpression'||e.type==='ChainExpression')e=e.expression;
        visit(node.expression,{...ctx,unusedNode:e});return;
      }
      case 'CallExpression':case 'NewExpression':
        call(node,ctx);
        visit(node.callee,{...ctx,unusedNode:null});for(const a of node.arguments)visit(a,{...ctx,unusedNode:null,chain:false});
        return;
      case 'ChainExpression':
        visit(node.expression,{...ctx,chain:true});return;
      case 'AwaitExpression':
        if(ctx.fn.async){suspend(node,ctx);}
        visit(node.argument,{...ctx,unusedNode:null});return;
      case 'YieldExpression':
        if(ctx.fn.generator)suspend(node,ctx);
        if(node.argument)visit(node.argument,{...ctx,unusedNode:null});return;
      case 'TryStatement':
        // A rejected await (or a throw into a generator) skips the re-entry after the
        // suspension: handlers re-enter when the current callable is not this one.
        if(ctx.fn.async||ctx.fn.generator)for(const b of [node.handler?.body,node.finalizer])
          if(b)insert(b.start+1,`if(__T.cur!==${ctx.fn.id}){__ts=__T.cur;__T.cur=${ctx.fn.id}}`,[1,-Infinity]);
        break;
      case 'ForOfStatement':
        if(node.await){counts.forAwait++;
          if(node.body.type==='BlockStatement')insert(node.body.start+1,`__ts=__T.cur;__T.cur=${ctx.fn.id};`,[1,-Infinity]);}
        break;
    }
    const keep=node.type==='ChainExpression'||node.type==='ParenthesizedExpression';
    for(const k in node) {
      if(k==='loc'||k==='type'||k==='start'||k==='end')continue;
      const v=node[k];
      const c=keep?ctx:(ctx.unusedNode?{...ctx,unusedNode:null}:ctx);
      if(Array.isArray(v)){for(const x of v)visit(x,c,node);}
      else if(v&&typeof v.type==='string')visit(v,c,node);
    }
  }

  // Module load code.
  const mctx={fn:moduleFn,classFn:null};
  const body=ast.body;
  let at=0;
  if(text.startsWith('#!'))at=text.indexOf('\n')+1;
  insert(at,`let __ts=__T.e(${moduleFn.id}),__tx;`,[1,-Infinity]);
  for(const s of body)visit(s,mctx);
  insert(text.length,`\n;__T.cur=__ts;`,[0,Infinity]);

  edits.sort((a,b)=>a.pos-b.pos||a.order[0]-b.order[0]||a.order[1]-b.order[1]);
  let out='',last=0;
  for(const e of edits){out+=text.slice(last,e.pos)+e.str;last=e.pos;}
  out+=text.slice(last);
  return {code:out,counts};
}
