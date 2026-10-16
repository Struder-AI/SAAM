import {requireThat} from '../private/toolpath/numeric.mjs';
import {resolveGeometrySelections} from '../geom/build.mjs';
import {validateSelectedExtensionRecipe} from '../../skills/records.mjs';
import {extensionDeposition,extensionSummary} from '../../skills/deposition.mjs';
// Generation: authored geometry and recipe into finalized deposition and SAAMpath.
// Ownership precedes construction; one dependency graph schedules shared deposition
// and their finalized-material consumers.

import {PATH_CONTRACT} from '../path/dependencies.mjs';
import {constructionPath} from '../path/construction-path.mjs';
export {pathDependencies} from '../path/dependencies.mjs';
import {filamentSelection,assignedFilaments} from '../machine/filaments.mjs';
import {plannedNozzleTemperatures} from '../path/process-controls.mjs';
import {assignmentPlan,assignmentFilament,depositionAssignments} from './assignment-process.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {injectionAssignment} from './injection.mjs';
import {depositionAssignment} from './assignment-records.mjs';
import {operationId,withOperationAfter,operationPrerequisite} from './operation-references.mjs';
import {spiralStackCurve} from '../path/stack-curves.mjs';
import {maximumPathAngle,strokeRange} from '../path/deposition.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';
import {traceResult} from './curves.mjs';
import {prepareSliceBoundaryStack} from "./slice-material.mjs";
import {fillSliceRegion} from "./slices.mjs";
import { compileRecipe, VERSION } from './plan.mjs';

import {finalizedSliceResults} from './construction.mjs';

async function extensionEngines(){return {
  Geometry:await geometryOperations(),
  MaterialRegions:{prepareSliceBoundaryStack},
  Recipe:{assignmentFilament,injectionAssignment,depositionAssignment,operationId,withOperationAfter},
  Toolpath:{fillSliceRegion,spiralStackCurve,maximumPathAngle,strokeRange,publishFinishedBoundary,traceResult}
};}


// A zero-length pass deposits nothing.
function primeLineResult(plan){
  const p=plan.process.primeLine;if(p===null)return null;
  const passes=(p.passes??[p]).filter(pass=>Math.hypot(pass.endMm[0]-pass.startMm[0],pass.endMm[1]-pass.startMm[1])>0);
  if(!passes.length)return null;
  const region=passes.map(pass=>{
    const [a,b]=[pass.startMm,pass.endMm],length=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])*pass.widthMm/length/2,ny=(b[0]-a[0])*pass.widthMm/length/2;
    return [[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];
  });
  const top=Math.max(...passes.map(pass=>pass.zMm));
  return traceResult({id:'prime-line',filament:null,after:[]},{process:plan.process,report:{passes:passes.length},batches:[{
    key:0,layerId:'planar:'+top,phase:'prime',layer:0,rank:-1,
    curves:passes.map(pass=>({role:'prime-line',closed:false,points:[[...pass.startMm,pass.zMm],[...pass.endMm,pass.zMm]],
      normals:[[0,0,1],[0,0,1]],beadWidthMm:pass.widthMm,heightMm:pass.heightMm,speedMmS:pass.speedMmS})),
    widthMm:Math.max(...passes.map(pass=>pass.widthMm)),travel:{kind:'planar',region,zMm:top,maxCombMm:0}}]});
}

// Toolpath chooses which geometry its assignments need; Geometry resolves and
// places those requests, including within-volumes in their owner's frame.
export async function preparePathGeometry(plan) {
  plan=compileRecipe(plan).plan;
  if(!plan.geometry)return {placed:null,componentShells:null,shells:[],volumes:new Map(),geometryFailures:new Map()};
  const components=plan.geometry.shape==='assembly'?plan.geometry.parts.map(part=>part.id):[];
  const requests=[{},...components.map(selection=>({selection}))];
  const values=await resolveGeometrySelections(plan.geometry,requests);
  const placed=values[0],componentShells=plan.geometry.shape==='assembly'?new Map(components.map((id,i)=>[id,values[1+i]])):null;
  const shells=[...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true])],volumes=new Map(),geometryFailures=new Map();
  return prepareAssignmentGeometry(plan,plan.slices.assignments,{placed,componentShells,shells,volumes,geometryFailures});
}

// Add authored selections once without rebuilding existing native geometry.
async function prepareAssignmentGeometry(plan,assignments,geometry){
  const {placed,componentShells}=geometry,shells=[...geometry.shells],volumes=new Map(geometry.volumes),geometryFailures=new Map(geometry.geometryFailures);
  for(const assignment of assignments){
    try{
      if(assignment.part!==undefined&&assignment.part!==null&&!shells.some(([part])=>part===assignment.part)){
        const [shell]=await resolveGeometrySelections(plan.geometry,[{selection:assignment.part}]);
        shells.push([assignment.part,shell,false]);
      }
      if(assignment.construction)continue;
      const selections=assignment.within.filter(volume=>volume.kind==='geometry').map(volume=>({selection:assignment.part,geometry:volume.geometry}));
      const resolved=await resolveGeometrySelections(plan.geometry,selections),slots={index:0};
      volumes.set(assignment.id,assignment.within.map(volume=>volume.kind==='geometry'?resolved[slots.index++]:null));
    }catch(error){
      if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
      geometryFailures.set(assignment.id,error);
    }
  }
  return {placed,componentShells,shells,volumes,geometryFailures};
}

// Survey every selected skin before body ownership, then finalize each
// supporting producer before constructing surface consumers.
export async function generateModelResults(plan,{placed,componentShells,shells,volumes,geometryFailures=new Map()},onProgress) {
  if(geometryFailures.size)plan={...plan,slices:{...plan.slices,assignments:plan.slices.assignments.filter(assignment=>!geometryFailures.has(assignment.id))}};
  const summary={generatorVersion:VERSION,shape:plan.geometry?.shape??null},results=[];
  // An assembly construction with no component chosen uses the whole assembly.
  const contexts=depositionAssignments(plan).filter(assignment=>assignment.construction||assignment.join).map(assignment=>{
    const shell=shells.find(([part])=>part===(assignment.part??null))?.[1]??((assignment.part??null)===null?placed:null),selected=assignmentPlan(plan,assignment);
    return {assignment,shell,process:selected.process};
  });
  const extensions=await extensionDeposition({plan,placed,componentShells,shells,volumes,contexts,engines:await extensionEngines(),
    processForAssignment:assignment=>assignmentPlan(plan,assignment).process});
  const expanded={...plan,slices:{...plan.slices,assignments:[...plan.slices.assignments,...extensions.assignments]}};
  const contributedGeometry=await prepareAssignmentGeometry(expanded,extensions.assignments,{placed,componentShells,shells,volumes,geometryFailures:new Map()});
  const contributed=extensions.assignments.filter(assignment=>assignment.construction).map(assignment=>({assignment,
    shell:shells.find(([part])=>part===(assignment.part??null))?.[1]??null,process:assignmentPlan(expanded,assignment).process}));
  const constructions=[...extensions.constructions,...contexts.filter(({assignment})=>['inject','curves'].includes(assignment.construction)&&!assignment.source),...contributed];
  const sliced=finalizedSliceResults({...contributedGeometry,plan:expanded,...extensions,constructions,onProgress});
  results.push(...sliced.results.map(result=>{
    const id=result.report.owner,report=extensions.reports.get(id),requiredMaterial=extensions.materialRequirements.get(id);
    return {...result,report:{...result.report,...report},operations:requiredMaterial?.length?result.operations.map(operation=>({...operation,requiredMaterial})):result.operations};
  }));
  if(sliced.summary)summary.slices=sliced.summary;
  // Generation notes: what was not covered or failed, joining the print's limitations.
  const geometryNotes=[...new Set([...shells.flatMap(([,shell])=>shell.notes??[]),...[...volumes.values()].flatMap(values=>values.flatMap(value=>value?.notes??[]))])];
  const notes=[...geometryNotes,...[...geometryFailures].map(([id,error])=>`${id} failed; it produces nothing. ${error.message}`),...extensions.notes,...sliced.notes];
  if(notes.length)summary.limitations=notes;
  Object.assign(summary,extensionSummary(results));
  const stacks=Object.fromEntries(['roof','terminal','normal'].map(kind=>[kind,results.filter(r=>r.report.referenceStackKind===kind).map(r=>({id:r.id,...r.report}))]).filter(([,items])=>items.length));
  if(Object.keys(stacks).length)summary.referenceStacks=stacks;
  if(stacks.roof){const roofs=stacks.roof;summary.surfaceDomain={maxSlopeDeg:Math.min(...roofs.map(r=>r.limitDeg)),surfaceMaxSlopeDeg:Math.max(...roofs.map(r=>r.maxSlopeDeg)),excludedAreaPercent:Math.max(...roofs.map(r=>r.excludedFraction))*100};}
  const curves=results.filter(result=>result.report.construction==='curves');
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  return {results,summary,survey:null,shells};
}

// The recipe's dependency declarations apply to every construction, including
// ordinary slice stacks produced before their later-stage dependents.
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

// Lower assignment completion references only after every producer has constructed.
// No geometry, coordinate rank or construction order substitutes for identity.
export function resolveOperationReferences(plan,results){
  const all=results.flatMap(result=>result.operations),ids=new Set(all.map(op=>op.id)),byAssignment=new Map();
  for(const result of results){
    const owner=result.report?.owner??result.id;
    if(!byAssignment.has(owner))byAssignment.set(owner,[]);
    byAssignment.get(owner).push(...result.operations.map(op=>op.id));
  }
  for(const assignment of plan.slices.assignments){
    if(assignment.construction==='curves'){
      for(const [name,after] of Object.entries(assignment.operationAfter??{}))if(after.length)
        requireThat(ids.has(assignment.id+':'+name),'Required Trace target was not constructed: '+assignment.id+':'+name);
    }else if(!assignment.construction){
      for(const [index,settings] of (assignment.sliceOverrides??[]).entries())for(const [group,after] of Object.entries(settings.operationAfter??{})){
        if(!after.length||JSON.stringify(after)===JSON.stringify(assignment.operationAfter?.[group]))continue;
        const targets=(byAssignment.get(assignment.id)??[]).filter(id=>id.endsWith(':'+assignment.id+':'+index+':'+group)||id===assignment.id+':'+index+':'+group);
        requireThat(targets.length,'Required Slice target was not constructed: '+assignment.id+':'+index+':'+group);
      }
    }
  }
  return results.map(result=>({...result,operations:result.operations.map(operation=>{
    const after=[...new Set((operation.after??[]).flatMap(previous=>{
      requireThat(operationPrerequisite(previous),'Invalid operation prerequisite.');
      if(typeof previous==='string')return [previous];
      const named=byAssignment.get(previous.assignment);
      requireThat(named?.length,'Required assignment produced no operations: '+previous.assignment);
      return named;
    }))];
    requireThat(!after.includes(operation.id),'An operation cannot require its own completion: '+operation.id);
    return {...operation,after};
  })}));
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
  summary.clearance = 'Scheduling records the selected nozzle clearance envelope; carriage and machine mechanisms are unchecked.';
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
    const family=result.stackId??result.report?.owner??result.id,kind=result.report?.depositionFamily??null;
    if(!kind)continue;
    const stackLayers=result.referenceStack?.layers??[];
    const traceLayers=kind==='trace'?[...new Set(result.operations.flatMap(operation=>{
      const layers=operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(segment=>segment.layer).filter(Number.isInteger)??[]);
      return layers.length?layers:[operation.layer];
    }))]:[];
    for(const operation of result.operations){
      const index=operation.layerIndex??operation.layer;
      const sourceLayers=new Set([operation.layer,...operation.strokes.flatMap(stroke=>stroke.segmentMetadata?.map(segment=>segment.layer).filter(Number.isInteger)??[])]);
      const layers=Object.fromEntries([...sourceLayers].map(layer=>{
        const ordinal=stackLayers.findIndex(reference=>reference.index===layer);
        const traceIndex=traceLayers.indexOf(layer);
        return [layer,{index:kind==='slice'&&ordinal>=0?ordinal:kind==='trace'&&operation.layerIndex===undefined?Math.max(0,traceIndex):index}];
      }));
      const changed=result.report?.modulation?.changedOperations?.includes(operation.id);
      operations[operation.id]={family,kind,layers,referenceName:result.referenceStack?.name??null,roles:[...new Set(operation.strokes.map(stroke=>stroke.role))],
        modifiers:changed?(result.report.modulation.operationModifiers?.[operation.id]??result.report.modulation.modifiers):[]};
    }
  }
  return {schema:GENERATION_CONTRACT,operations};
}

export async function generatePath(plan, {onProgress,modulations,modulationPreparation=[]} = {}) {
  plan=compileRecipe(plan).plan;
  const authoredTemperatures=plannedNozzleTemperatures(plan);
  const validation=await validateSelectedExtensionRecipe(plan),failedIds=new Set(validation.failures.map(failure=>failure.assignment));
  const usable=validation.failures.length?{...plan,slices:{...plan.slices,assignments:plan.slices.assignments.filter(assignment=>!failedIds.has(assignment.id))}}:plan;
  const geometry=await preparePathGeometry(usable);
  const prepared={...geometry,geometryFailures:new Map([...validation.failures.map(failure=>[failure.assignment,Error(failure.message)]),...geometry.geometryFailures])};
  plan=usable;
  const evaluated=modulations?{...plan,modulations}:plan;
  const materialAssignments=assignedFilaments(plan),defaultFilament=plan.setup.filament??materialAssignments[0]??null;
  const assigned=[...new Set([defaultFilament,...materialAssignments].filter(v=>v!==null&&v!==undefined))];
  const selections=materialAssignments.length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,i)])):null;
  const prime=primeLineResult(plan);
  const model=await generateModelResults(evaluated,prepared,onProgress);
  const complemented={...model,results:resolveOperationReferences(evaluated,applyDeclaredDependencies(evaluated,model.results))};
  const resultsWithPrime=prime?complemented.results.map(result=>({...result,operations:result.operations.map(operation=>({...operation,after:[...new Set([...prime.operations.map(op=>op.id),...(operation.after??[])])]}))})):complemented.results;
  const primed=prime?{...complemented,results:[prime,...resultsWithPrime],summary:{...complemented.summary,primeLine:prime.report}}:complemented;
  const {placed}=prepared,{results,survey}=primed,process=plan.process;
  const summary=summarizeGeneratedPath(placed,survey,primed.summary);
  summary.substrateAdaptation={experimental:true,enabled:plan.experimental.substrateAdaptation,
    sliceQueries:results.reduce((sum,result)=>sum+(result.report.substrateContactQueries??0),0),
    sliceHits:results.reduce((sum,result)=>sum+(result.report.contactSamples??0),0),
    sliceMisses:results.reduce((sum,result)=>sum+(result.report.uncoveredContactSamples??0),0)};
  summary.inspection=depositionInspection(results);
  if(modulationPreparation.length)summary.modulationGeometry=modulationPreparation;
  for(const result of results)for(const operation of result.operations)for(const target of [operation.nozzleC,operation.restoreNozzleC])
    if(target!==undefined)requireThat(authoredTemperatures.has(target),'Unplanned operation temperature.');
  return constructionPath({results,planning:{process,selection:selections?.[defaultFilament]??null,selections},
    composition:plan.composition,summary,generatorVersion:VERSION});
}
