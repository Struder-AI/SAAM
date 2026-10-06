// The sole CLI map-read boundary, shared by direct CLI, toolkit and onboarding.
// Keep viewer snapshots private: replacement readers must preserve this projection.
import {mapSet} from './map-set.mjs';
import {designModel} from './design.mjs';
import {sourceLocations} from './source-locations.mjs';

// Field selection is the visible-page boundary, never a size cap.
function designPage(page,pages) {
  const {index,path,kind,label,description,parent,destination,aliasOf,notes}=page;
  return {index,path,kind,label,description,parent,destination,...(aliasOf?{aliasOf}:{}),
    components:page.components.map(({index,path,label,type,description,home,internal})=>{
      const target=pages.get(index),sources=target?sourceLocations(target):[];
      return {index,path,label,type,description,...(home?{home}:{}),internal,
        ...(target?{destination:target.destination==='code'?'source':target.destination}:{}),
        ...(sources.length?{sources}:{})};
    }),
    wires:page.wires.map(({from,to,label,address,count})=>({from,to,label,address,count})),...(notes?.length?{notes}: {})};
}

function designContract(contract) {
  const {id,label,fromIndex,toIndex,direction,operations,inputs,outputs,effects,failure,excludes,access,status,code=[]}=contract;
  return {id,label,fromIndex,toIndex,direction,operations,inputs,outputs,effects,failure,excludes,
    ...(access?{access:access.map(({fromIndex,toIndex})=>({fromIndex,toIndex}))}:{}),status,
    ...(code.length?{sources:code.flatMap(entry=>entry.unavailable
      ?[{target:entry.target,unavailable:entry.unavailable}]:sourceLocations(entry))}:{})};
}

// The maps whose boxes hold source in a file or folder, as an influence set's `@path/` read gives them.
function designPath(model,pages,path) {
  const under=page=>sourceLocations(page).some(({file})=>file===path||file.startsWith(`${path}/`));
  return {path,owners:Object.fromEntries(model.pages.filter(p=>p.destination!=='code'&&p.components.some(c=>pages.has(c.index)&&under(pages.get(c.index))))
    .map(p=>[p.index,p.label]))};
}

// A read after an input changed counts the changed inputs; `@stale` lists them.
export async function readMap(address,{repo}) {
  if(mapSet?.mode==='influence')return (await import('../influence/solved-set.mjs')).readSolved(address);
  const model=await designModel({repo}),pages=new Map(model.pages.map(p=>[p.index,p]));
  if(address==='@stale')return {changed:model.changedInputs,regenerate:model.regenerate};
  const contract=model.pages.flatMap(p=>p.wires.flatMap(w=>w.contracts)).find(c=>c.id===address);
  const page=model.pages.find(p=>p.index===address||p.path===address);
  const link=model.pages.flatMap(p=>p.wires).find(w=>w.address===address);
  const component=model.pages.flatMap(p=>p.components).find(c=>c.index===address||c.path===address);
  const path=address.startsWith('@path/')?address.slice(6).replaceAll('\\','/').replace(/\/+$/,''):null;
  if(!contract&&!page&&!link&&!component&&path===null)throw Error(`No map, link or contract ${address} in this design set. Maps: `
    +`${model.pages.filter(p=>p.destination!=='code').map(p=>`${p.index} ${p.label}`).join(', ')}; links as a map's wires give them; `
    +'contracts by id; @path/FILE-OR-FOLDER; @stale.');
  if(page?.destination==='code')throw Error('Source leaf '+address+' is not a map. Use normal file tools at the source ranges shown on its containing map.');
  const result=path!==null?designPath(model,pages,path):contract?designContract(contract):page?designPage(page,pages):link?
    {address:link.address,from:link.from,to:link.to,label:link.label,contracts:link.contracts.map(designContract)}:
    {index:component.index,path:component.path,label:component.label,type:component.type,description:component.description};
  return {...result,...(model.changedInputs.length?{stale:{reason:'inputs changed since the build',files:model.changedInputs.length,
    list:'@stale',regenerate:model.regenerate}}:{})};
}
