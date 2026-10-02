// Authored leaf homes, observed calls. Do not turn implementation dependencies
// into map-0 permission or a claim about schemas/effects.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {extractGraph} from './graph.mjs';
import {setFile} from './map-set.mjs';

export async function implementationLinks(repo,spec,nodes,{containment=null,ownershipText:heldText}={}){
  if(!spec.implementationLinks?.length)return {contracts:[],bindings:[],ownershipText:''};
  const roots=spec.implementationLinks.map(id=>nodes.get(id)?.index);
  if(roots.some(index=>!index))throw Error('Unknown implementation-link root.');
  const inside=id=>roots.some(root=>nodes.get(id)?.index===root||nodes.get(id)?.index.startsWith(root+'.'));
  const ownershipText=heldText??await readFile(resolve(repo,setFile('ownership.json')),'utf8');
  const owners=JSON.parse(ownershipText).leaves;
  const files=[...new Set(Object.entries(owners).filter(([,v])=>inside(v.owner)).map(([path])=>path.split('::')[0]))];
  const graph=await extractGraph({repo,files}),declarations=new Map(graph.declarations.map(d=>[d.id,d]));
  const projected=path=>({path:containment?.homes[path]??path,id:containment?.owners[path]??owners[path].owner});
  function home(id){
    let d=declarations.get(id);
    while(d){if(owners[d.anchor])return projected(d.anchor);d=declarations.get(d.parent);}
    if(id?.endsWith(':<module>')){const path=id.slice(0,-9)+'::@module';if(owners[path])return projected(path);}
    return null;
  }
  const pairs=new Map();
  for(const r of graph.relations){
    if(!['call','construct'].includes(r.kind))continue;
    const caller=home(r.from),callee=home(r.to);
    if(!caller||!callee||caller.id===callee.id||!nodes.has(caller.id)||!nodes.has(callee.id)||!inside(caller.id)&&!inside(callee.id))continue;
    const key=callee.id+'>'+caller.id,pair=pairs.get(key)??{caller,callee,sites:new Set(),kinds:new Set()};
    for(const site of r.evidence??[])pair.sites.add(site.file+':'+site.line);
    pair.kinds.add(r.kind);pairs.set(key,pair);
  }
  const contracts=[],bindings=[];
  for(const [key,{caller,callee,sites,kinds}]of pairs){
    const id='observed-'+createHash('sha256').update(key).digest('hex').slice(0,12);
    contracts.push({id,from:callee.id,to:caller.id,detailOnly:true,label:callee.path.split('::').at(-1)+' result',
      direction:'Observed source dependency: result flows to caller; access records invocation.',access:[{from:caller.id,to:callee.id}],
      operations:[callee.path.split('::').slice(1).join('::')],inputs:'Recorded source arguments; see bound signature.',outputs:'Bound declaration returns; no stronger schema is asserted.',
      effects:'Existing source behavior; unresolved audit findings remain authoritative.',failure:'Existing caller error handling.',excludes:'No new API, map-0 permission or conformance claim.',
      status:'Resolved lexical/import call; dynamic/native behavior remains unchecked.',evidence:[...sites]});
    bindings.push({contract:id,target:callee.path,kinds:[...kinds],callers:[caller.path]});
  }
  return {contracts,bindings,ownershipText};
}
