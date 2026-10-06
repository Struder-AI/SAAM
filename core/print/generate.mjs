import {requireThat} from '../private/toolpath/numeric.mjs';
import {resolveGeometrySelections} from '../geom/build.mjs';
import {ASSIGNMENT_RECORDS,validateSelectedExtensionRecipe} from '../../skills/records.mjs';
import {extensionDeposition,extensionResultDependencies,extensionSummary} from '../../skills/deposition.mjs';
// Generation: authored geometry and recipe into finalized deposition and SAAMpath.
// Ownership precedes construction; one dependency graph schedules shared courses
// and their finalized-material consumers.

import {PATH_CONTRACT,NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {saamPath} from '../path/saampath.mjs';
export {pathDependencies} from '../path/dependencies.mjs';
import {planFinishing} from '../path/toolpath.mjs';
import {createPlanningState,planFan,planningPath,planningResult} from '../path/planning.mjs';
import {planOperation,validateOperationBatch,prepareOperationDependencies} from '../path/compose.mjs';
import {filamentSelection,assignedFilaments} from '../machine/filaments.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {plannedNozzleTemperatures} from '../path/process-controls.mjs';
import {assignmentPlan,assignmentFilament,depositionAssignments} from './assignment-process.mjs';
import {planarRegionLayers} from '../geom/planar-region-layers.mjs';
import {prepareContourSleeve} from '../geom/sleeve/contour-sleeve.mjs';
import {difference,union,intersect} from '../region/intersection.mjs';
import {regionArea,pointSegmentDistance} from '../region/region2d.mjs';
import {horizontalSlice,sliceFamily} from '../geom/slice.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {pointInjectionOperation} from '../path/injection.mjs';
import {spiralFamilyCurve} from '../path/family-curves.mjs';
import {maximumPathAngle,strokeRange} from '../path/deposition.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {traceResult} from './curves.mjs';
import {contactCurveGaps} from '../path/contact-curves.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {prepareSliceRegionContext} from './slice-region-context.mjs';
import {prepareSliceBoundaryFamily} from './slices.mjs';
import { compileRecipe, VERSION } from './plan.mjs';

import {finalizedSliceResults} from './slice-deposition.mjs';

const extensionEngines={
  Geometry:{planarRegionLayers,prepareContourSleeve,sampleCurveIntervals,difference,union,intersect,regionArea,pointSegmentDistance,horizontalSlice,sliceFamily,evaluateSurface},
  Toolpath:{prepareSliceRegionContext,prepareSliceBoundaryFamily,pointInjectionOperation,assignmentFilament,
    spiralFamilyCurve,maximumPathAngle,strokeRange,publishFinishedBoundary,traceResult,contactCurveGaps,depositedBeadSegments}
};


function primeLineResult(plan){
  const p=plan.process.primeLine;if(p===null)return null;
  const passes=p.passes??[p],region=[],strokes=[];
  let lengthMm=0,volumeMm3=0,maxZ=0,maxWidth=0;
  for(const pass of passes){
    const [a,b]=[pass.startMm,pass.endMm],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length*pass.widthMm/2,ny=dx/length*pass.widthMm/2;
    region.push([[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]]);
    strokes.push({role:'prime-line',closed:false,points:[[...a,pass.zMm],[...b,pass.zMm]],speedMmS:pass.speedMmS,beadAreaMm2:pass.widthMm*pass.heightMm});
    lengthMm+=length;volumeMm3+=length*pass.widthMm*pass.heightMm;maxZ=Math.max(maxZ,pass.zMm);maxWidth=Math.max(maxWidth,pass.widthMm);
  }
  return {id:'prime-line',report:{lengthMm,volumeMm3,passes:passes.length},operations:[{
    // The sacrificial stroke is physically part of the first layer, so keep it
    // in that layer's preview bucket instead of inventing an extra layer.
    id:'prime-line:0',layerId:'planar:'+maxZ,phase:'prime',layer:0,rank:-1,after:[],order:'given',region,strokes,
    travelPolicy:planarPolicy(region,{layerZ:maxZ,liftMm:plan.process.liftMm,maxCombMm:0,lineWidthMm:maxWidth}),clearanceZ:maxZ+plan.process.liftMm
  }]};
}

// Toolpath chooses which geometry its assignments need; Geometry resolves and
// places those requests, including within-volumes in their owner's frame.
export async function preparePathGeometry(plan) {
  plan=compileRecipe(plan).plan;
  if(!plan.geometry)return {placed:null,componentShells:null,shells:[],volumes:new Map()};
  const components=plan.geometry.shape==='assembly'?plan.geometry.parts.map(part=>part.id):[];
  const named=[...new Set(plan.slices.assignments.filter(a=>a.part!==undefined&&a.preset!=='support').map(a=>a.part).filter(p=>p!==null&&!components.includes(p)))];
  const assignments=plan.slices.assignments.filter(a=>!a.construction);
  const requests=[{},...components.map(selection=>({selection})),...named.map(selection=>({selection}))];
  const volumeSlots=new Map(assignments.map(assignment=>[assignment.id,assignment.within.map(volume=>{
    if(volume.kind!=='geometry')return null;
    const index=requests.length;requests.push({selection:assignment.part,geometry:volume.geometry});return index;
  })]));
  const values=await resolveGeometrySelections(plan.geometry,requests,{offset:[plan.placement.xMm,plan.placement.yMm,0]});
  const placed=values[0],componentShells=plan.geometry.shape==='assembly'?new Map(components.map((id,i)=>[id,values[1+i]])):null;
  const shells=[...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true]),
    ...named.map((part,i)=>[part,values[1+components.length+i],false])];
  const volumes=new Map([...volumeSlots].map(([id,slots])=>[id,slots.map(index=>index===null?null:values[index])]));
  return {placed,componentShells,shells,volumes};
}

// Survey every selected skin before body ownership, then finalize each
// supporting producer before constructing surface consumers.
export async function generateModelResults(plan,{placed,componentShells,shells,volumes,planningState,emittedIds=[]},onProgress) {
  const summary={generatorVersion:VERSION,shape:plan.geometry?.shape??null},results=[];
  const contexts=depositionAssignments(plan).filter(assignment=>assignment.construction||assignment.join).map(assignment=>{
    const shell=shells.find(([part])=>part===(assignment.part??null))?.[1],selected=assignmentPlan(plan,assignment);
    if(ASSIGNMENT_RECORDS[assignment.construction]?.requiresComponent)requireThat(shell,'A surface family needs selected geometry.');
    return {assignment,shell,process:selected.process,maxBeadHeightMm:Infinity};
  });
  const extensions=await extensionDeposition({plan,placed,componentShells,shells,volumes,contexts,onProgress,engines:extensionEngines,
    processForAssignment:assignment=>assignmentPlan(plan,assignment).process});
  const constructions=[...extensions.constructions,...contexts.filter(({assignment})=>['inject','curves'].includes(assignment.construction))];
  const sliced=finalizedSliceResults({plan,shells,volumes,...extensions,constructions,onProgress,planningState,emittedIds});
  results.push(...sliced.results);
  if(sliced.summary)summary.slices=sliced.summary;
  Object.assign(summary,extensionSummary(results));
  const families=Object.fromEntries(['roof','terminal','normal'].map(kind=>[kind,results.filter(r=>r.report.referenceFamily===kind).map(r=>({id:r.id,...r.report}))]).filter(([,items])=>items.length));
  if(Object.keys(families).length)summary.referenceFamilies=families;
  if(families.roof){const roofs=families.roof;summary.surfaceDomain={maxSlopeDeg:Math.min(...roofs.map(r=>r.limitDeg)),surfaceMaxSlopeDeg:Math.max(...roofs.map(r=>r.maxSlopeDeg)),excludedAreaPercent:Math.max(...roofs.map(r=>r.excludedFraction))*100};}
  const curves=results.filter(result=>result.report.construction==='curves');
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  return {results,summary,survey:null,shells,slicedSupports:sliced.supports,execution:sliced.execution};
}

export async function addComplementaryResults(plan,geometry,batch) {
  const supports=batch.slicedSupports??[],results=[...batch.results],summary={...batch.summary};
  if(supports.length)summary.supports=supports.map(r=>({id:r.id,...r.report}));
  const completed=[...supports,...applyResultDependencies(results,await extensionResultDependencies(results,supports,extensionEngines))];
  return {...batch,results:applyDeclaredDependencies(plan,completed),summary};
}

// The recipe's dependency declarations apply to every construction, including
// ordinary slice families produced before their later-stage dependents.
export function applyDeclaredDependencies(plan,results){
  const changes=[];
  for(const result of results){
    const assignment=plan.slices.assignments.find(a=>a.id===(result.report?.owner??result.id));
    const dependencies=assignment?.dependencies;if(!dependencies)continue;
    const prior=results.filter(other=>other!==result&&dependencies.afterParts.includes(other.report?.part));
    const after=[...dependencies.after,...prior.flatMap(other=>other.operations.map(op=>op.id))];
    for(const op of result.operations)if(after.length)changes.push({operationId:op.id,after,mode:'union'});
    const before=results.filter(other=>other!==result&&dependencies.beforeParts.includes(other.report?.part));
    for(const other of before)for(const op of other.operations)changes.push({operationId:op.id,after:result.operations.map(op=>op.id),mode:'union'});
  }
  return applyResultDependencies(results,changes);
}

// Dependency changes address operation IDs, which are unique within a composed
// result batch. Apply ordered appends and ordered unions without changing earlier
// stages' result, operation or prerequisite records. Geometry/policies stay shared.
export function applyResultDependencies(results,dependencyChanges){
  if(!dependencyChanges.length)return results;
  const changesByOperation=new Map();
  for(const change of dependencyChanges){
    if(!changesByOperation.has(change.operationId))changesByOperation.set(change.operationId,[]);
    changesByOperation.get(change.operationId).push(change);
  }
  return results.map(result=>{
    let changed=false;
    const operations=result.operations.map(operation=>{
      const changes=changesByOperation.get(operation.id);
      if(!changes)return operation;
      changed=true;
      let after=[...(operation.after??[])];
      for(const change of changes){
        if(change.mode==='union')after=[...new Set([...after,...change.after])];
        else after.push(...change.after);
      }
      return {...operation,after};
    });
    return changed?{...result,operations}:result;
  });
}

export function summarizeGeneratedPath(placed,survey,modelSummary) {
  const summary={...modelSummary};
  summary.composition=null;

  summary.boundsMm = placed?.bounds??null;
  summary.clearance = 'operator responsibility; no collision model implemented';
  summary.physicalValidation = 'not performed';
  if (survey&&!summary.surfaceDomain) summary.surfaceDomain = {
    maxSlopeDeg:survey.limitDeg, surfaceMaxSlopeDeg:survey.maxSlopeDeg,excludedAreaPercent:survey.steepFraction*100
  };
  return summary;
}

export const GENERATION_CONTRACT=PATH_CONTRACT;
export function depositionInspection(results){
  const operations={};
  for(const result of results){
    const family=result.familyId??result.report?.owner??result.id,kind=result.report?.depositionFamily??null;
    if(!kind)continue;
    const familyLayers=result.family?.layers??[];
    const traceLayers=kind==='trace'?[...new Set(result.operations.flatMap(operation=>{
      const layers=operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(segment=>segment.layer).filter(Number.isInteger)??[]);
      return layers.length?layers:[operation.layer];
    }))]:[];
    for(const operation of result.operations){
      const index=operation.layerIndex??operation.layer;
      const sourceLayers=new Set([operation.layer,...operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(segment=>segment.layer).filter(Number.isInteger)??[])]);
      const layers=Object.fromEntries([...sourceLayers].map(layer=>{
        const ordinal=familyLayers.findIndex(reference=>reference.index===layer);
        const traceIndex=traceLayers.indexOf(layer);
        return [layer,{index:kind==='slice'&&ordinal>=0?ordinal:kind==='trace'&&operation.layerIndex===undefined?Math.max(0,traceIndex):index}];
      }));
      const changed=result.report?.modulation?.changedOperations?.includes(operation.id);
      operations[operation.id]={family,kind,layers,referenceName:result.family?.name??null,roles:[...new Set(operation.strokes.map(stroke=>stroke.role))],
        modifiers:changed?(result.report.modulation.operationModifiers?.[operation.id]??result.report.modulation.modifiers):[]};
    }
  }
  return {schema:GENERATION_CONTRACT,operations};
}

export async function generatePath(plan, {onProgress,modulations,modulationPreparation=[]} = {}) {
  plan=compileRecipe(plan).plan;
  const authoredTemperatures=plannedNozzleTemperatures(plan);
  await validateSelectedExtensionRecipe(plan,assignment=>assignmentPlan(plan,assignment).process);
  const prepared=await preparePathGeometry(plan);
  const evaluated=modulations?{...plan,modulations}:plan;
  const materialAssignments=assignedFilaments(plan),defaultFilament=plan.setup.filament??materialAssignments[0]??null;
  const assigned=[...new Set([defaultFilament,...materialAssignments].filter(v=>v!==null&&v!==undefined))];
  const selections=materialAssignments.length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,i)])):null;
  const start=[plan.placement.xMm,plan.placement.yMm,(prepared.placed?.bounds.max[2]??0)+plan.process.liftMm];
  const started=planFan(createPlanningState({start,process:plan.process,generatorVersion:VERSION,
    selection:selections?.[defaultFilament]??null,selections}),0);
  const prime=primeLineResult(plan),startup=prime?planOperation(started.state,prime.operations[0]):planningResult(started.state);
  const model=await generateModelResults(evaluated,{...prepared,planningState:startup.state,emittedIds:prime?prime.operations.map(op=>op.id):[]},onProgress);
  const complemented=await addComplementaryResults(evaluated,prepared,model);
  const primed=prime?{...complemented,results:[prime,...complemented.results],summary:{...complemented.summary,primeLine:prime.report}}:complemented;
  const {placed}=prepared,{results,survey}=primed,process=plan.process;
  const summary=summarizeGeneratedPath(placed,survey,primed.summary);
  summary.substrateAdaptation={experimental:true,enabled:plan.experimental.substrateAdaptation,
    sliceQueries:results.reduce((sum,result)=>sum+(result.report.substrateContactQueries??0),0),
    sliceHits:results.reduce((sum,result)=>sum+(result.report.contactSamples??0),0),
    sliceMisses:results.reduce((sum,result)=>sum+(result.report.uncoveredContactSamples??0),0)};
  summary.inspection=depositionInspection(results);
  if(modulationPreparation.length)summary.modulationGeometry=modulationPreparation;
  const execution=model.execution;
  const order=[...(prime?prime.operations.map(op=>op.id):[]),...execution.summary.operationOrder],position=new Map(order.map((id,i)=>[id,i]));
  const inventory=validateOperationBatch(results),prerequisites=prepareOperationDependencies(inventory.operations,inventory.byId,plan.composition);
  for(const [id,after] of prerequisites)for(const predecessor of after)requireThat(position.has(predecessor)&&position.get(predecessor)<position.get(id),'Final dependency was not scheduled before '+id+': '+predecessor);
  const finished=planFinishing(execution.state);
  const path=planningPath(finished.state,[started.actions,startup.actions,execution.actions,finished.actions],{...summary,composition:{...execution.summary,operationOrder:order}});
  for(const action of path.actions)if(action.kind==='temperature')
    requireThat(authoredTemperatures.has(action.targetC),'Unplanned operation temperature.');
  return saamPath({...path,completion:{contract:NEUTRAL_PATH_CONTRACT}});
}
