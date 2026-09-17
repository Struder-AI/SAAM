import {readFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
export async function printName(directory){
  let plan;try{plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));}catch{return basename(directory);}
  function named(g){return g?.shape==='text'?g.features?.map(f=>f.text).filter(Boolean).join(' & '):null;}
  const g=plan.geometry,base=g?.shape==='text'?g.base:g;
  const handle=g?.shape==='assembly'&&g.parts?.find(p=>p.id==='fin');
  if(handle)return named(handle.geometry)?'Named handle · '+named(handle.geometry):'Handle';
  if(base?.shape==='spline-top')return named(g)?'Named wavy roof · '+named(g):'Wavy roof';
  return named(g)?'Named part · '+named(g):basename(directory);
}
export function downloadName(name,exportName){
  const clean=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,''),dot=exportName?.indexOf('.')??-1;
  return clean+(dot>=0?exportName.slice(dot):'');
}
