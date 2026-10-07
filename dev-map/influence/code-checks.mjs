// What SAAM code is (plans/dev-maps.md#what-saam-code-is), checked as errors at their source
// locations over a stored influence model, its analysis and its authored top level:
//
//   unmodelled   a shape the analysis does not model (analysis `unmodelled`; UNMODELLED.md). Callee
//                expressions are modelled and only noted, so they are not errors.
//   unowned      a leaf with no top-level owner (ownership.json).
//   contract     a leaf arrow between two top-level nodes that no authored arrow (architecture.json
//                `contracts`) permits in its direction; an arrow both ways needs both. Reported at
//                the code that crosses: the caller of a command, the reader of an answer or state.
//   command-returns-data  a command whose caller computes with what it returns (a `both` arrow).
//   unlinked     a leaf with no arrow, except module load code that only declares (a query).
//
// codeErrors(model, {analysis, architecture}) returns every error as {file, line, rule, reason};
// errorSummary counts them by rule and, for contract errors, by top-level pair.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const LOAD='(module load)';
const callee=kind=>/^(callee-expression:|computed-callee$)/.test(kind);

// Each authored node's top-level node, and actors as the influence model names them.
function topLevel(architecture) {
  const byIndex=new Map(architecture.nodes.filter(n=>!String(n.index).includes('.')).map(n=>[String(n.index),n.id]));
  const top=new Map(architecture.nodes.map(n=>[n.id,byIndex.get(String(n.index).split('.')[0])]));
  for(const id of Object.keys(architecture.actors??{}))top.set(id,`external:${id}`);
  const label=new Map([...architecture.nodes.filter(n=>byIndex.get(String(n.index))===n.id).map(n=>[n.id,n.label]),
    ...Object.entries(architecture.actors??{}).map(([id,a])=>[`external:${id}`,a.label])]);
  const permitted=new Set(architecture.contracts.map(c=>`${top.get(c.from)}>${top.get(c.to)}`));
  label.set('external:unassigned','Unassigned outside contact');
  return {permitted,label:id=>label.get(id)??id};
}

export function codeErrors(model,{analysis,architecture}) {
  const errors=[],leaves=model.leaves;
  const at=l=>({file:l.file??`@channel/${l.channel?.actor}`,line:l.line??0});
  const name=l=>l.label??l.name;
  for(const u of analysis.unmodelled??[])if(!callee(u.kind))
    errors.push({file:u.file,line:u.line??0,rule:'unmodelled',reason:u.kind.startsWith('platform:?.')
      ?`call reaching a value the analysis lost track of: ${u.kind.slice(11)}`
      :u.kind.startsWith('platform:')?`platform API without a model: ${u.kind.slice(9)}`:u.kind});
  for(const l of Object.values(leaves)) {
    if(!l.owner)errors.push({...at(l),rule:'unowned',reason:`${name(l)}: ${l.gap??'no owner'}`});
    if(l.unlinked&&!(l.label===LOAD&&l.role==='query'))errors.push({...at(l),rule:'unlinked',reason:`${name(l)} (${l.role}) has no arrow`});
  }
  const returning=new Map();
  for(const a of model.arrows)if(a.kind==='both')returning.set(a.to,(returning.get(a.to)??0)+1);
  for(const [key,callers] of returning)errors.push({...at(leaves[key]),rule:'command-returns-data',
    reason:`${name(leaves[key])} acts and returns data ${callers>1?`${callers} callers compute`:'its caller computes'} with`});
  const {permitted,label}=topLevel(architecture);
  // The code that crosses: an answer, a state read and an initialisation are read by their target.
  const crosser=a=>{const read=['answer','reads','initialises'].includes(a.kind),near=leaves[read?a.to:a.from],far=leaves[read?a.from:a.to];
    return near.role==='state'||near.role==='channel'?far:near;};
  for(const a of model.arrows) {
    const from=leaves[a.from],to=leaves[a.to];
    if(!from?.owner||!to?.owner||from.owner===to.owner)continue;
    const missing=[[from.owner,to.owner],...(a.kind==='both'?[[to.owner,from.owner]]:[])].filter(([x,y])=>!permitted.has(`${x}>${y}`));
    if(!missing.length)continue;
    const pairs=missing.map(([x,y])=>`${label(x)} → ${label(y)}`);
    errors.push({...at(crosser(a)),rule:'contract',pairs,reason:`no authored arrow ${pairs.join(' and ')}: ${name(from)} → ${name(to)} ${a.kind}`});
  }
  const order=(x,y)=>x<y?-1:x>y?1:0;
  return errors.sort((x,y)=>order(x.file,y.file)||x.line-y.line||order(x.rule,y.rule)||order(x.reason,y.reason));
}

// A set's errors, from its analysis file and authored set folder (solved-set.mjs inputs).
export const setErrors=(model,{analysis,authored})=>codeErrors(model,{analysis:JSON.parse(readFileSync(analysis,'utf8')),
  architecture:JSON.parse(readFileSync(resolve(authored,'architecture.json'),'utf8'))});

export function errorSummary(errors) {
  const count=keys=>{const c={};for(const e of errors)for(const k of keys(e))c[k]=(c[k]??0)+1;return Object.fromEntries(Object.entries(c).sort((a,b)=>b[1]-a[1]));};
  return {errors:errors.length,byRule:count(e=>[e.rule]),contractPairs:count(e=>e.pairs??[])};
}

export const errorLine=e=>`${e.file}:${e.line}: ${e.rule}: ${e.reason}`;
