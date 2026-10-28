// Slice runs as one command chain per member: Stack decisions start the member,
// Offset loops hand its wall Paath to Fill regions, Fill regions hand its
// regions to Infill, and Infill hands its Paath to Slice Paath, which commands
// Finalization. Stages answer queries for the values they hold; a member never
// consults another member.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {sliceWallStrokes,sliceFillRegions} from '../region/layer-strokes.mjs';
import {sliceStrokesPaath,conditionSlicePaath,combineSlicePaath,sliceBoundaryCurves} from './slice-paath.mjs';
import {constructSliceInfill} from './slice-infill-paath.mjs';
import {decideSliceStack,sliceStackChoices} from './slice-stack-decisions.mjs';
import {finalizeSliceWork} from './slice-finalization.mjs';

// 3.1.2: closed wall loops on the member surface, as Paath.
export function constructSliceWalls(member,{id,stackId=id,filament=null}={}){
  const options=member.strokeSettings;
  requireThat(options&&member.slice,'Slice walls need resolved member wall choices and a surface.');
  const loops=member.region.length?sliceWallStrokes(member.region,options):[];
  return sliceStrokesPaath([['walls',loops]],member,{id,stackId,filament});
}

// 3.1.3: the member's material inside the walls actually produced, divided by
// the queried full-fill regions.
export function deriveFillRegions(member,wallPaath,{fullFillRegions,density,overlap}){
  if(!member.region.length)return {interior:[],solidRegion:[],sparseRegion:[]};
  return sliceFillRegions(member.region,Object.values(wallPaath.correspondence),
    {...member.strokeSettings,solid:fullFillRegions,fillDensity:density,fillOverlap:overlap});
}

// 3.1.5's construction report for one member.
export function sliceMemberReport(member,wallPaath,infill,id){
  return {depositionFamily:'slice',layers:member.region.length?1:0,skippedLayers:member.region.length?0:1,
    loops:Object.keys(wallPaath.curves).length,fillRows:Object.values(infill.paath.operations).reduce((sum,operation)=>sum+operation.courses.length,0),
    ...(infill.report?{fillOrder:infill.report,
      ...(infill.report.notes?.length?{notes:infill.report.notes.map(note=>'Slice '+id+' layer '+member.index+': '+note)}:{})}:{})};
}

// The Construct Slice work receiver. `work` names the operation and what its
// finalized members are associated with; `plan` is the construction request.
export function constructSlice(spec,context,{work,plan,onProgress}){
  const {id,filament=null,totalLayerCount=spec.layers.length}=spec,stackId=work.stackId??id,identity={id,stackId,filament};
  const members=decideSliceStack(spec,context),choices=sliceStackChoices(members);
  const walls=new Map(),regions=new Map(),finalized=new Map();
  // 3.1.5 queries the member's wall Paath and process choices, then commands Finalization.
  const slicePaath=(member,infill)=>{
    requireThat(member.gap&&member.strokeSettings,'Slice needs resolved member choices and an explicit gap.');
    const wallPaath=walls.get(member.index),process=choices.process(member.index);
    const paath=conditionSlicePaath(combineSlicePaath([wallPaath,infill.paath]),member.slice,process,{filament});
    const report={...context.report,depositionFamily:'slice',layers:0,skippedLayers:0,loops:0,fillRows:0};
    const own=sliceMemberReport(member,wallPaath,infill,id);
    for(const key of ['layers','skippedLayers','loops','fillRows'])report[key]+=own[key];
    if(own.fillOrder)report.fillOrder=own.fillOrder;
    if(own.notes?.length)report.notes=[...(report.notes??[]),...own.notes];
    const stackLayer={...member,curves:sliceBoundaryCurves(wallPaath)};
    return finalizeSliceWork({paath,member,owner:work.owner,part:work.part,toolPose:work.toolPose,filament:work.filament,
      envelope:{id,stackId,totalLayerCount,report,stackLayers:[stackLayer],referenceStack:{...work.referenceStack,layers:[stackLayer]}}},{plan});
  };
  // 3.1.4 queries its pattern choices and commands Slice Paath.
  const infill=(member,fillRegions)=>slicePaath(member,constructSliceInfill(member,fillRegions,choices.pattern(member.index),identity));
  // 3.1.3 queries the member's full fill, retains its regions and commands Infill.
  const fillRegions=(member,wallPaath)=>{
    const derived=deriveFillRegions(member,wallPaath,choices.fill(member.index));
    regions.set(member.index,derived);
    return infill(member,derived);
  };
  // 3.1.2 constructs and retains the wall Paath and commands Fill regions.
  const offsetLoops=member=>{
    const wallPaath=constructSliceWalls(member,identity);
    walls.set(member.index,wallPaath);
    return fillRegions(member,wallPaath);
  };
  // 3.1.1 starts every member, empty or not.
  for(const [ordinal,member] of members.entries()){
    onProgress?.({stage:'Constructing Slice',layer:member.index,completed:ordinal,total:members.length});
    finalized.set(member.index,offsetLoops(member));
  }
  onProgress?.({stage:'Constructing Slice',completed:members.length,total:members.length});
  return {members,finalized,fillRegions:index=>regions.get(index)};
}
