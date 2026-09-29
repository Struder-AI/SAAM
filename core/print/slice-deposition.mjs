// Ownership is resolved first. Each ready family course consumes already
// finalized predecessor beads, so modulation cannot leave stale contact data.
import {prepareSliceContexts,sliceContextResult,ownershipDependencies} from './slices.mjs';
import {finalizeDepositionResult} from './finalize.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {requireThat} from '../geom/tolerance.mjs';

function combineCourses(record,courses){
  if(courses.length===1)return courses[0];
  const report={...record.context.report};
  for(const key of ['layers','skippedLayers','areaMm2','loops','fillRows','solidAreaMm2'])report[key]=courses.reduce((sum,r)=>sum+(r.report[key]??0),0);
  const contacts=courses.filter(r=>r.report.contactSamples);
  if(contacts.length){report.contactSamples=contacts.reduce((n,r)=>n+r.report.contactSamples,0);report.minContactGapMm=Math.min(...contacts.map(r=>r.report.minContactGapMm));report.maxContactGapMm=Math.max(...contacts.map(r=>r.report.maxContactGapMm));}
  const modulations=courses.map(r=>r.report.modulation).filter(Boolean);
  if(modulations.length)report.modulation={changed:modulations.some(m=>m.changed),
    maxExcursionMm:Math.max(...modulations.map(m=>m.maxExcursionMm)),
    changedOperations:modulations.flatMap(m=>m.changedOperations),modifiers:[...new Set(modulations.flatMap(m=>m.modifiers))]};
  const layers=courses.flatMap(r=>r.family.layers);
  return {...courses[0],report,operations:courses.flatMap(r=>r.operations),familyLayers:layers,
    family:{...record.family,layers},finishedSurfaces:courses.flatMap(r=>r.finishedSurfaces??[])};
}

export function finalizedSliceResults(args){
  const {contexts}=prepareSliceContexts(args);
  if(!contexts.length)return {results:[],supports:[],summary:null};
  const pending=contexts.map((record,index)=>({record,index,next:0,courses:[],previous:[],
    units:record.spec.settings.join?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder}));
  const deposited=new Map();
  while(pending.some(item=>item.next<item.units.length)){
    const ready=pending.filter(item=>item.next<item.units.length)
      .sort((a,b)=>a.units[a.next].rank-b.units[b.next].rank||a.index-b.index);
    const item=ready[0],unit=item.units[item.next++],record=item.record;
    const sourceKey=record.owner.kind==='support'?`support:${record.owner.part}`:record.owner.part;
    const prior=deposited.get(sourceKey)??[];
    const contacts=prior.filter(segment=>segment.familyId===record.familyId&&segment.layerIndex===unit.index-1&&segment.changed);
    const other=prior.filter(segment=>segment.familyId!==record.familyId||segment.ownerId!==record.owner.assignment.id&&segment.layerIndex<unit.index);
    const built=sliceContextResult(record,{layerIndex:unit.index,contactSegments:contacts,otherFamilyContactSegments:other});
    const prerequisites=item.previous;
    const linked={...built,operations:built.operations.map(op=>({...op,after:[...new Set([...op.after,...prerequisites])]}))};
    const result=finalizeDepositionResult(linked,args.plan,args.machine);
    item.courses.push(result);item.previous=result.operations.map(op=>op.id);
    deposited.set(sourceKey,[...prior,...depositedBeadSegments(result.operations,{widthMm:record.context.process.lineWidthMm}).map(segment=>({...segment,familyId:record.familyId,ownerId:record.owner.assignment.id,layerIndex:unit.index,changed:Boolean(result.report.modulation?.changed)}))]);
  }
  const results=[],supports=[];
  for(const item of pending)(item.record.owner.kind==='support'?supports:results).push(combineCourses(item.record,item.courses));
  requireThat([...results,...supports].some(result=>result.operations.length),'The slice assignments produced no material.');
  const layerIds=new Set([...results,...supports].flatMap(result=>result.operations.map(op=>op.layerId)));
  return {results:ownershipDependencies(results),supports,summary:{layers:layerIds.size,instances:[...results,...supports].map(result=>({id:result.id,...result.report}))}};
}
