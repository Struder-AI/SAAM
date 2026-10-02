// Bounded ownership evidence for synchronous, same-module helper calls. A proof
// describes a particular handoff, not general JavaScript alias safety.
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const children=node=>Object.entries(node).flatMap(([key,value])=>['loc','start','end'].includes(key)?[]:Array.isArray(value)?value.filter(v=>v?.type):value?.type?[value]:[]);
const walk=(node,visit,parent=null)=>{visit(node,parent);for(const child of children(node))walk(child,visit,node);};
const walkOwn=(node,visit,parent=null)=>{visit(node,parent);for(const child of children(node))if(!functions.has(child.type))walkOwn(child,visit,node);};
const site=(file,node)=>({file,line:node.loc.start.line,column:node.loc.start.column+1});
const memberRoot=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'?memberRoot(node.object):null;
const mutators=new Set(['push','pop','shift','unshift','splice','sort','reverse','copyWithin','fill','set','delete','clear','add']);
const readers=new Set(['get','has','slice','map','filter','reduce','forEach','entries','keys','values','at','includes','indexOf']);
const method=node=>node?.type==='MemberExpression'&&!node.computed&&node.property.type==='Identifier'?node.property.name:null;
const parameterNames=fn=>fn.params.map(p=>p.type==='Identifier'?p.name:null);
const contains=(outer,inner)=>outer&&inner&&outer.start<=inner.start&&inner.end<=outer.end;
const containsName=(node,names)=>{let found=false;walk(node,n=>{if(n.type==='Identifier'&&names.has(n.name))found=true;});return found;};
const referenceBearing=(node,names)=>!node?false:node.type==='Identifier'?names.has(node.name)
  :node.type==='MemberExpression'?names.has(memberRoot(node))
  :['ArrayExpression','ObjectExpression','ConditionalExpression','LogicalExpression'].includes(node.type)
    ?children(node).some(child=>referenceBearing(child,names)):false;
const ownedTarget=(node,names)=>node?.type==='MemberExpression'?names.has(memberRoot(node))
  :node?.type==='ArrayPattern'&&node.elements.every(element=>ownedTarget(element,names));

function functionsIn(ast){
  const found=new Map();
  for(const item of ast.body){
    const node=item.type==='ExportNamedDeclaration'?item.declaration:item;
    if(node?.type==='FunctionDeclaration'&&node.id){
      if(found.has(node.id.name))found.set(node.id.name,null);
      else found.set(node.id.name,node);
    }
  }
  return found;
}

function localDeclarations(fn){
  const declared=new Map();
  walk(fn.body,node=>{
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')declared.set(node.id.name,node);
  });
  return declared;
}

// Freshness is deliberately shallow unless a known Array.map callback returns
// a locally constructed element. Unknown factory calls are never fresh here.
function fresh(node,declared,seen=new Set()){
  if(!node)return null;
  if(node.type==='ArrayExpression')return {kind:'array',node};
  if(node.type==='ObjectExpression'&&node.properties.every(p=>p.type==='Property'&&!p.computed
      &&(p.value.type==='Literal'||fresh(p.value,declared,new Set(seen)))))return {kind:'object',node};
  if(node.type==='NewExpression'&&node.callee.type==='Identifier'&&['Array','Map','Set','Int32Array','Float32Array','Float64Array'].includes(node.callee.name))
    return {kind:node.callee.name,node};
  if(node.type==='Identifier'&&!seen.has(node.name)){
    seen.add(node.name);return fresh(declared.get(node.name)?.init,declared,seen);
  }
  if(node.type==='CallExpression'&&method(node.callee)==='map'&&node.callee.object.type==='Identifier'){
    const source=fresh(node.callee.object,declared,new Set(seen));
    const callback=node.arguments[0];
    if(!source||!['array','Array'].includes(source.kind)||!functions.has(callback?.type))return null;
    const locals=localDeclarations(callback),body=callback.body;
    const result=body.type==='BlockStatement'?body.body.findLast(s=>s.type==='ReturnStatement')?.argument:body;
    const element=fresh(result,locals);
    if(!element)return null;
    return {kind:'mapped-array',node,element:{kind:element.kind,node:element.node}};
  }
  return null;
}

function aliasesOf(name,declared){
  const aliases=new Set([name]);
  let changed=true;
  while(changed){changed=false;for(const [other,d] of declared)if(d.init?.type==='Identifier'&&aliases.has(d.init.name)&&!aliases.has(other)){aliases.add(other);changed=true;}}
  return aliases;
}

function helperEffects(fn,params){
  const mutations=new Map(params.filter(Boolean).map(p=>[p,[]]));
  const escapes=[];
  const parent=new WeakMap();walk(fn.body,(node,p)=>parent.set(node,p));
  walk(fn.body,node=>{
    if(node.type==='AssignmentExpression'||node.type==='UpdateExpression'){
      const root=memberRoot(node.type==='AssignmentExpression'?node.left:node.argument);
      if(mutations.has(root)&&(node.type==='UpdateExpression'||node.left.type==='MemberExpression'))mutations.get(root).push(node);
      if(node.type==='AssignmentExpression'&&node.left.type==='ArrayPattern'){
        const affected=new Set();
        walk(node.left,target=>{if(target.type==='MemberExpression'&&mutations.has(memberRoot(target)))affected.add(memberRoot(target));});
        for(const name of affected)mutations.get(name).push(node);
      }
    }
    if(node.type==='CallExpression'){
      const root=memberRoot(node.callee?.object),name=method(node.callee);
      if(mutations.has(root)&&mutators.has(name))mutations.get(root).push(node);
      if(mutations.has(root)&&!mutators.has(name)&&!readers.has(name))escapes.push(node.callee);
      for(const arg of node.arguments)if(arg.type==='Identifier'&&mutations.has(arg.name))escapes.push(arg);
    }
    if(node.type==='NewExpression'&&node.arguments.some(arg=>containsName(arg,mutations)))escapes.push(node);
    if(node.type==='ReturnStatement'&&node.argument&&containsName(node.argument,mutations))escapes.push(node.argument);
    if(node.type==='AssignmentExpression'&&!ownedTarget(node.left,mutations)&&referenceBearing(node.right,mutations))escapes.push(node.right);
    if(node.type==='VariableDeclarator'&&node.init?.type==='Identifier'&&mutations.has(node.init.name))escapes.push(node.init);
    if(node.type==='VariableDeclarator'&&['ObjectExpression','ArrayExpression'].includes(node.init?.type)&&containsName(node.init,mutations))escapes.push(node.init);
    if(node.type==='CallExpression')for(const arg of node.arguments)
      if(mutations.has(memberRoot(arg))||['ObjectExpression','ArrayExpression','SpreadElement'].includes(arg.type)&&containsName(arg,mutations))escapes.push(arg);
    if(functions.has(node.type)&&node!==fn){
      const outer=parent.get(node),nativeCallback=outer?.type==='CallExpression'&&outer.arguments.includes(node)
        &&['map','forEach','filter','reduce'].includes(method(outer.callee));
      if(!nativeCallback)walk(node.body,id=>{if(id.type==='Identifier'&&mutations.has(id.name))escapes.push(id);});
    }
  });
  return {mutations,escapes};
}

function knownElements(fn,call,name,declared,allocation){
  if(allocation.element)return allocation.element;
  if(allocation.kind!=='array')return null;
  const writes=[];
  walk(fn.body,node=>{
    if(node.start>=call.start)return;
    if(node.type==='CallExpression'&&node.callee.object?.type==='Identifier'&&node.callee.object.name===name&&method(node.callee)==='push')
      writes.push(...node.arguments.map(arg=>fresh(arg,declared)));
    if(node.type==='AssignmentExpression'&&memberRoot(node.left)===name)writes.push(null);
  });
  if(!writes.length||writes.some(w=>!w||w.kind!==writes[0].kind))return null;
  return {kind:writes[0].kind,node:writes[0].node};
}

function knownMethods(fn,param,allocation,element){
  let valid=true;
  const collectionKind=(object)=>object.type==='Identifier'?allocation.kind:element?.kind;
  walkOwn(fn.body,node=>{
    if(node.type!=='CallExpression'||memberRoot(node.callee?.object)!==param)return;
    const name=method(node.callee),kind=collectionKind(node.callee.object);
    if(['get','has','set','delete','clear'].includes(name)&&!['Map','Set'].includes(kind))valid=false;
    else if(name==='add'&&kind!=='Set')valid=false;
    else if(['push','pop','shift','unshift','splice','sort','reverse','copyWithin','fill','slice','map','filter','reduce','forEach','at','includes','indexOf'].includes(name)&&!['array','mapped-array','Array'].includes(kind))valid=false;
    else if(['entries','keys','values'].includes(name)&&!['array','mapped-array','Array','Map','Set'].includes(kind))valid=false;
  });
  return valid;
}

function usesOf(fn,names){
  const parent=new WeakMap(),uses=[];
  walk(fn.body,(node,p)=>{parent.set(node,p);if(node.type==='Identifier'&&names.has(node.name))uses.push(node);});
  return {parent,uses};
}

function allowedPreUse(node,parent,call,declared){
  let p=parent.get(node);
  for(let ancestor=p;ancestor;ancestor=parent.get(ancestor))if(functions.has(ancestor.type)){
    const outer=parent.get(ancestor),nativeCallback=outer?.type==='CallExpression'&&outer.arguments.includes(ancestor)
      &&['map','forEach','filter','reduce'].includes(method(outer.callee))&&fresh(outer.callee.object,declared);
    if(!nativeCallback)return false;
  }
  if(p?.type==='VariableDeclarator'&&p.id===node)return true;
  if(p?.type==='VariableDeclarator'&&p.init===node)return true; // tracked alias
  if(p?.type==='MemberExpression'&&p.object===node){
    const op=parent.get(p);
    if(op?.type==='CallExpression'&&op.callee===p&&mutators.has(method(p)))return true;
    if(op?.type==='CallExpression'&&op.callee===p&&readers.has(method(p)))return true;
    if(op?.type==='AssignmentExpression'&&op.left===p)return true; // local write before transfer
    if(op?.type==='UpdateExpression'&&op.argument===p)return true;
    return false;
  }
  // The two arms of a conditional are exclusive. The other arm can retain
  // its own reference, but it cannot observe this helper's mutation.
  if(p?.type==='ConditionalExpression'&&contains(p,call))return true;
  while(p&&p!==call){
    if(functions.has(p.type)){
      const outer=parent.get(p);
      if(outer?.type==='CallExpression'&&outer.arguments.includes(p)&&method(outer.callee)==='map'
        &&fresh(outer.callee.object,declared))return true;
      return false;
    }
    if(['ReturnStatement','AssignmentExpression','CallExpression','NewExpression','Property','ArrayExpression'].includes(p.type))return false;
    p=parent.get(p);
  }
  return true;
}

function callProof(file,caller,call,callee,declared){
  if(caller.async||caller.generator||callee.async||callee.generator)return null;
  const params=parameterNames(callee),effects=helperEffects(callee,params);
  if(effects.escapes.length)return null;
  const handed=[];
  for(let index=0;index<call.arguments.length;index++){
    const arg=call.arguments[index],param=params[index];
    if(arg.type!=='Identifier'||!effects.mutations.get(param)?.length)continue;
    const allocation=fresh(arg,declared);
    if(!allocation)continue;
    const element=knownElements(caller,call,arg.name,declared,allocation);
    if(!knownMethods(callee,param,allocation,element))continue;
    if(!element&&effects.mutations.get(param).some(node=>node.type==='AssignmentExpression'
      &&node.left.type==='MemberExpression'&&node.left.object.type==='MemberExpression'))continue;
    const names=aliasesOf(arg.name,declared),{parent,uses}=usesOf(caller,names);
    const disqualifying=uses.filter(id=>{
      if(id===arg||id.start===declared.get(id.name)?.id.start)return false;
      if(id.start>call.end)return true; // retained mutable alias lookback
      if(id.start>=call.start)return false;
      return !allowedPreUse(id,parent,call,declared);
    });
    if(disqualifying.length)continue;
    handed.push({argument:arg.name,parameter:param,aliases:[...names].sort(),allocation:site(file,allocation.node),
      allocationKind:allocation.kind,...(element?{elementAllocation:site(file,element.node),elementKind:element.kind}:{}),
      mutations:effects.mutations.get(param).map(n=>site(file,n))});
  }
  if(!handed.length)return null;
  return {caller:caller.id.name,callee:callee.id.name,call:site(file,call),kind:'contained-sequential-handoff',
    handoffs:handed,limits:['Direct same-module synchronous helper only','Only traced fresh values and local aliases','Unknown helper effects and unrelated unresolved calls remain findings']};
}

export function pipelineOwnership(asts){
  const proofs=[];
  for(const [file,ast] of asts){
    const helpers=functionsIn(ast);
    for(const caller of helpers.values()){
      if(!caller)continue;
      const declared=localDeclarations(caller),shadowed=new Set([...parameterNames(caller),...declared.keys()]);
      walkOwn(caller.body,node=>{
        if(node.type!=='CallExpression'||node.callee.type!=='Identifier'||shadowed.has(node.callee.name))return;
        const callee=helpers.get(node.callee.name);
        if(!callee||callee===caller)return;
        const proof=callProof(file,caller,node,callee,declared);
        if(proof)proofs.push(proof);
      });
    }
  }
  return proofs;
}
