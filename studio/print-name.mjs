import {readFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
export async function printName(directory,plan){
  if(!plan)try{plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));}catch{return basename(directory);}
  function named(g){return g?.shape==='text'?g.features?.map(f=>f.text).filter(Boolean).join(' & '):null;}
  const g=plan.geometry?.shape==='spatial'?plan.geometry.solid:plan.geometry;
  const handle=g?.shape==='assembly'&&g.parts?.find(p=>p.id==='fin');
  if(handle)return named(handle.geometry)?'Named handle · '+named(handle.geometry):'Handle';
  return named(g)?'Named part · '+named(g):basename(directory);
}
const NAME_CHARACTERS=120;
// A file-system-safe stem: reserved characters become '-', trailing dots and spaces go.
const safeStem=name=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');
export function downloadName(name,exportName){const extension=exportName?.endsWith('.gcode.3mf')?'.gcode.3mf':exportName?'.'+exportName.split('.').pop():'';return safeStem(name)+extension;}
// The requested name shortened to 120 characters; an empty one is the print's own.
export function requestedDownloadName(value,suggested,exportName){
  const requested=safeStem([...(typeof value==='string'?value.trim():'')].slice(0,NAME_CHARACTERS).join(''));
  return downloadName(requested||suggested,exportName);
}
