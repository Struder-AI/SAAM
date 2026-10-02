// Bound interface entries use the scanner's declaration identities and exact source.
import {parse} from 'acorn';
import {extractGraph} from './graph.mjs';

const callable=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
function children(node){
  return Object.values(node).flatMap(value=>Array.isArray(value)?value.filter(v=>v?.type):value?.type?[value]:[]);
}
function returnExpressions(fn,text){
  if(fn.body.type!=='BlockStatement')return [text.slice(fn.body.start,fn.body.end)];
  const returns=[];
  function walk(node){
    if(callable.has(node.type)||['ClassDeclaration','ClassExpression'].includes(node.type))return;
    if(node.type==='ReturnStatement')returns.push(node.argument?text.slice(node.argument.start,node.argument.end):'undefined');
    else for(const child of children(node))walk(child);
  }
  walk(fn.body);
  return [...new Set(returns)];
}

export async function interfaceCode(repo,bindings,sources){
  const files=[...new Set(bindings.map(b=>b.target.split('::')[0]))];
  if(!files.length)return new Map();
  const graph=await extractGraph({repo,files,readSource:file=>sources[file]});
  const declarations=new Map(graph.declarations.filter(d=>d.anchor).map(d=>[d.anchor,d]));
  const syntax=new Map();
  for(const file of files){
    const nodes=new Map();
    function walk(node){
      if(callable.has(node.type)||['VariableDeclarator','Property','MethodDefinition','AssignmentExpression','ClassDeclaration'].includes(node.type))nodes.set(node.start,node);
      for(const child of children(node))walk(child);
    }
    walk(parse(sources[file],{ecmaVersion:'latest',sourceType:'module'}));
    syntax.set(file,nodes);
  }
  const entries=new Map();
  for(const {target} of bindings){
    if(entries.has(target))continue;
    const file=target.split('::')[0],text=sources[file],d=declarations.get(target);
    if(target.endsWith('::@module')){
      entries.set(target,{target,file,line:1,endLine:text.split('\n').length,name:file,signature:'module',returns:[]});continue;
    }
    if(!d){entries.set(target,{target,unavailable:'Bound declaration is absent from this source snapshot.'});continue;}
    const node=syntax.get(file).get(d.start);
    const fn=callable.has(node?.type)?node:[node?.init,node?.value,node?.right].find(n=>callable.has(n?.type));
    entries.set(target,{target,file,line:d.line,endLine:d.endLine,name:d.name,
      signature:fn?text.slice(d.start,fn.body.start).trim():text.slice(d.start,d.end),
      parameters:fn?fn.params.map(p=>text.slice(p.start,p.end)):[],returns:fn?returnExpressions(fn,text):[]});
  }
  return entries;
}
