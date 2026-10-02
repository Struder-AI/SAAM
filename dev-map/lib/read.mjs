// The sole CLI map-read boundary, shared by direct CLI, toolkit and onboarding.
// Keep viewer snapshots private: replacement readers must preserve this projection.
import {mapSet} from './map-set.mjs';
import {designModel} from './design.mjs';
import {readGenerated} from './store.mjs';
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

export async function readMap(address,{repo}) {
  if(mapSet?.mode!=='design')return readGenerated(address,{repo});
  const model=await designModel({repo}),pages=new Map(model.pages.map(p=>[p.index,p]));
  const contract=model.pages.flatMap(p=>p.wires.flatMap(w=>w.contracts)).find(c=>c.id===address);
  const page=model.pages.find(p=>p.index===address||p.path===address);
  const link=model.pages.flatMap(p=>p.wires).find(w=>w.address===address);
  const component=model.pages.flatMap(p=>p.components).find(c=>c.index===address||c.path===address);
  if(!contract&&!page&&!link&&!component)throw Error('No design node, link or contract '+address);
  if(page?.destination==='code')throw Error('Source leaf '+address+' is not a map. Use normal file tools at the source ranges shown on its containing map.');
  const result=contract?designContract(contract):page?designPage(page,pages):link?
    {address:link.address,from:link.from,to:link.to,label:link.label,contracts:link.contracts.map(designContract)}:
    {index:component.index,path:component.path,label:component.label,type:component.type,description:component.description};
  return {...result,...(model.changedInputs.length?{stale:{inputs:model.changedInputs,regenerate:model.regenerate}}:{})};
}
