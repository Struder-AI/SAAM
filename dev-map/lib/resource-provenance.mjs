// Symbolic file identities for observed filesystem effects. Equality is claimed only
// for the same lexical parameter/alias and the same path construction. Distinct
// symbols are not evidence that runtime paths cannot overlap (symlinks, caller
// aliases and dynamic values remain outside this proof).
import {scopeTree} from './lexical-bindings.mjs';

const children=node=>Object.entries(node).flatMap(([key,value])=>['loc','start','end'].includes(key)?[]:
  Array.isArray(value)?value.filter(child=>child?.type):value?.type?[value]:[]);
const site=(file,node)=>({file,line:node.loc.start.line,column:node.loc.start.column+1,start:node.start,end:node.end});
const unknown=(reason,node,file)=>({kind:'unknown',reason,site:site(file,node)});
const exact=value=>value&&value.kind!=='unknown'&&value.kind!=='dynamic'&&
  (!value.parts||value.parts.every(exact));
const member=node=>node?.type==='MemberExpression'&&!node.computed?(node.property.name??null):null;
const key=value=>exact(value)?JSON.stringify(value):null;

export function resourceProvenance({graph,asts}){
  const declarations=new Map(graph.declarations.map(d=>[d.id,d]));
  const contexts=new Map(),observations=[];
  for(const [file,ast] of asts){
    const {binding}=scopeTree(ast),imports=new Map(),initializers=new Map(),writes=new Set(),parameters=new Map(),calls=new Map();
    const callable=graph.declarations.filter(d=>d.file===file&&d.callable&&d.anchor&&!d.ambiguousAnchor);
    const ownerOf=node=>callable.filter(d=>d.start<=node.start&&d.end>=node.end)
      .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]??null;
    (function visit(node){
      if(node.type==='ImportDeclaration')for(const spec of node.specifiers){
        const id=binding(spec.local);if(id)imports.set(id,{source:node.source.value,
          name:spec.type==='ImportNamespaceSpecifier'?'*':spec.imported?.name??'default'});
      }
      if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'){
        const id=binding(node.id);if(id)initializers.set(id,{node:node.init,declaration:node.id});
      }
      if(node.type==='AssignmentExpression'&&node.left.type==='Identifier')writes.add(binding(node.left));
      if(node.type==='UpdateExpression'&&node.argument.type==='Identifier')writes.add(binding(node.argument));
      if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
        const owner=ownerOf(node);
        node.params.forEach((p,index)=>{if(p.type==='Identifier'&&binding(p))parameters.set(binding(p),
          owner?{owner:owner.anchor,index,name:p.name}:null);});
      }
      if(node.type==='CallExpression')calls.set(node.start,node);
      for(const child of children(node))visit(child);
    })(ast);
    const imported=node=>{
      if(node?.type==='Identifier')return imports.get(binding(node))??null;
      const name=member(node),base=node?.object;
      if(name&&base?.type==='Identifier'){
        const origin=imports.get(binding(base));
        if(origin?.name==='*')return {source:origin.source,name};
      }
      return null;
    };
    const evaluate=(node,substitutions=new Map(),invocation=null,seen=new Set())=>{
      if(!node)return unknown('missing-path-expression',ast,file);
      if(node.type==='Literal'&&typeof node.value==='string')return {kind:'literal',value:node.value};
      if(node.type==='Identifier'){
        const id=binding(node);
        if(substitutions.has(id))return substitutions.get(id);
        if(!id)return unknown('unbound-path-identifier',node,file);
        if(writes.has(id))return unknown('reassigned-path-alias',node,file);
        if(initializers.has(id)){
          if(seen.has(id))return unknown('cyclic-path-alias',node,file);
          const initializer=initializers.get(id),value=evaluate(initializer.node,substitutions,invocation,new Set(seen).add(id));
          // An immutable computed local has one value during this invocation.
          // Its bytes are unknown, but two uses of this binding are the same path.
          return exact(value)?value:{kind:'opaque-local',site:site(file,initializer.declaration),
            owner:ownerOf(initializer.declaration)?.anchor??`${file}::@module`};
        }
        const parameter=parameters.get(id);
        return parameter?{kind:'parameter',owner:parameter.owner,index:parameter.index,name:parameter.name}:
          unknown('unresolved-path-binding',node,file);
      }
      if(node.type==='TemplateLiteral'){
        const parts=[];
        node.quasis.forEach((q,index)=>{if(q.value.cooked)parts.push({kind:'literal',value:q.value.cooked});
          if(node.expressions[index])parts.push(evaluate(node.expressions[index],substitutions,invocation,seen));});
        return combine(parts,node);
      }
      if(node.type==='BinaryExpression'&&node.operator==='+')
        return combine([evaluate(node.left,substitutions,invocation,seen),evaluate(node.right,substitutions,invocation,seen)],node);
      if(node.type==='CallExpression'){
        const origin=imported(node.callee);
        if(origin?.source==='node:crypto'&&origin.name==='randomUUID')return {kind:'unique',site:site(file,node),invocation:invocation??'per-call'};
        if(origin?.source==='node:path'&&['resolve','join','dirname'].includes(origin.name)){
          const parts=node.arguments.map(arg=>evaluate(arg,substitutions,invocation,seen));
          if(parts.some(part=>!exact(part)))return unknown('unresolved-path-segment',node,file);
          return {kind:'path',operation:origin.name,parts};
        }
      }
      return unknown('unsupported-path-expression',node,file);
    };
    function combine(parts,node){
      if(parts.some(part=>!exact(part)))return unknown('unresolved-path-segment',node,file);
      const flattened=[];
      for(const part of parts){
        if(part.kind==='concat')flattened.push(...part.parts);
        else if(part.kind==='literal'&&flattened.at(-1)?.kind==='literal')flattened.at(-1).value+=part.value;
        else flattened.push(part);
      }
      return flattened.length===1?flattened[0]:{kind:'concat',parts:flattened};
    }
    const effects=[];
    for(const call of calls.values()){
      const origin=imported(call.callee);
      if(!['node:fs/promises','node:fs'].includes(origin?.source))continue;
      const operation=origin.name;
      if(!['readFile','writeFile','rename','rm','unlink','mkdir','copyFile'].includes(operation))continue;
      const owner=ownerOf(call),paths=(operation==='rename'||operation==='copyFile'?call.arguments.slice(0,2):call.arguments.slice(0,1));
      const row={operation,owner:owner?.anchor??`${file}::@module`,site:site(file,call),nodes:paths,
        paths:paths.map(arg=>evaluate(arg))};
      effects.push(row);
      observations.push({...row,paths:row.paths,identity:operation==='rename'?row.paths[1]:row.paths[0],
        role:operation==='rename'?'publication':operation==='readFile'?'read':operation==='writeFile'?'write':operation==='rm'||operation==='unlink'?'remove':'other'});
    }
    contexts.set(file,{ast,binding,imports,parameters,calls,effects,evaluate});
  }
  // Prove an atomic helper's shape from its actual fs calls: a fresh temporary
  // is written, renamed to a parameter destination, then cleaned. Preserve all
  // three effects at every resolved invocation; the rename publishes `to`.
  const templates=new Map();
  for(const [file,context] of contexts){
    const grouped=new Map();for(const effect of context.effects)
      (grouped.get(effect.owner)??grouped.set(effect.owner,[]).get(effect.owner)).push(effect);
    for(const [owner,effects] of grouped){
      const rename=effects.find(e=>e.operation==='rename'&&e.paths.length===2);
      if(!rename)continue;
      const written=effects.find(e=>e.operation==='writeFile'&&key(e.paths[0])===key(rename.paths[0]));
      const cleanup=effects.find(e=>['rm','unlink'].includes(e.operation)&&key(e.paths[0])===key(rename.paths[0]));
      if(!written||!cleanup||!(written.site.start<rename.site.start&&rename.site.start<cleanup.site.start)||
         !key(rename.paths[0])||rename.paths[0].kind!=='concat'||
         !JSON.stringify(rename.paths[0]).includes('"kind":"unique"')||rename.paths[1].kind!=='parameter')continue;
      templates.set(owner,{file,effects:[written,rename,cleanup],destination:rename.paths[1]});
    }
  }
  for(const relation of graph.relations){
    if(relation.kind!=='call')continue;
    const target=declarations.get(relation.to)?.anchor,template=templates.get(target);
    if(!template)continue;
    const callSite=relation.evidence?.[0],caller=contexts.get(callSite?.file),callee=contexts.get(template.file);
    const call=caller?.calls.get(callSite?.start);
    if(!call||call.arguments.some(arg=>arg.type==='SpreadElement'))continue;
    const actual=call.arguments[template.destination.index];
    if(!actual)continue;
    const destination=caller.evaluate(actual),substitutions=new Map();
    for(const [id,param] of callee.parameters)if(param?.owner===target&&param.index===template.destination.index)
      substitutions.set(id,destination);
    const invocation=`${callSite.file}:${callSite.start}`;
    for(const effect of template.effects){
      const paths=effect.nodes.map(node=>callee.evaluate(node,substitutions,invocation));
      const role=effect.operation==='rename'?'publication':effect.operation==='writeFile'?'staging-write':'staging-cleanup';
      observations.push({operation:effect.operation,owner:declarations.get(relation.from)?.anchor??`${callSite.file}::@module`,
        site:callSite,operationSite:effect.site,via:target,paths,identity:role==='publication'?paths[1]:paths[0],role});
    }
  }
  // Carry an observed effect through resolved callers. Substitution follows
  // actual argument expressions, so same-spelled parameters in unrelated
  // functions never become one resource by name alone. Bound the traversal;
  // recursion and unresolved indirect calls are left as visible limits.
  const substituted=(value,target,actuals,invocation)=>{
    if(value?.kind==='parameter'&&value.owner===target)return actuals[value.index]??{kind:'unknown',reason:'missing-call-argument'};
    if(value?.kind==='opaque-local')return {...value,invocation};
    if(value?.kind==='unique')return {...value,invocation};
    if(value?.parts)return {...value,parts:value.parts.map(part=>substituted(part,target,actuals,invocation))};
    return value;
  };
  let frontier=observations.filter(row=>!templates.has(row.owner));
  const seenEffects=new Set();
  for(let depth=0;depth<3&&frontier.length;depth++){
    const next=[];
    for(const relation of graph.relations){
      if(relation.kind!=='call')continue;
      const target=declarations.get(relation.to)?.anchor;
      if(!target)continue;
      const site0=relation.evidence?.[0],caller=contexts.get(site0?.file),call=caller?.calls.get(site0?.start);
      if(!call||call.arguments.some(arg=>arg.type==='SpreadElement'))continue;
      const actuals=call.arguments.map(arg=>caller.evaluate(arg)),invocation=`${site0.file}:${site0.start}`;
      for(const row of frontier){
        if(row.owner!==target||(row.chain??[]).includes(target))continue;
        const paths=row.paths.map(path=>substituted(path,target,actuals,invocation));
        const identity=row.role==='publication'?paths[1]:paths[0];
        const carried={...row,owner:declarations.get(relation.from)?.anchor??`${site0.file}::@module`,
          site:site0,operationSite:row.operationSite??row.site,paths,identity,
          chain:[...row.chain??[],target],via:row.via??target};
        const fingerprint=JSON.stringify([carried.owner,carried.site.file,carried.site.start,
          carried.operation,carried.role,carried.identity,carried.chain]);
        if(seenEffects.has(fingerprint))continue;
        seenEffects.add(fingerprint);next.push(carried);
      }
    }
    observations.push(...next);frontier=next;
  }
  const groups=new Map();
  for(const observation of observations){
    observation.symbol=key(observation.identity);
    if(!observation.symbol)observation.uncertainty='Symbolic path unresolved; it may overlap another resource.';
    else (groups.get(observation.symbol)??groups.set(observation.symbol,[]).get(observation.symbol)).push(observation);
  }
  const matches=[];
  for(const [symbol,rows] of groups)for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    if(rows[i].role==='other'||rows[j].role==='other')continue;
    if(!['read','publication','write'].includes(rows[i].role)&&!['read','publication','write'].includes(rows[j].role))continue;
    if(rows[i].role==='read'&&rows[j].role==='read')continue;
    matches.push({symbol,first:rows[i].site,second:rows[j].site,firstRole:rows[i].role,secondRole:rows[j].role,
      provenance:[rows[i].operationSite??rows[i].site,rows[j].operationSite??rows[j].site]});
  }
  return {observations,matches,templates:[...templates.keys()],limits:[
    'Exact symbolic equality does not prove distinct symbols cannot alias at runtime or through symlinks.',
    'Only direct node:fs and node:path imports are modeled; aliased holders and unsupported path expressions remain unresolved.',
    'Resolved caller propagation is bounded to three hops; recursion and unresolved indirect calls retain unknown path effects.',
    'A unique staging token means fresh per invocation, not a known literal filename.']};
}
