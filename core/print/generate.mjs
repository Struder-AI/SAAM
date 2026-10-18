import {prepareSliceMaterial,sliceMaterialSolids} from '../geom/slice-material.mjs';
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
import {operationId,withOperationAfter} from './operation-references.mjs';
import {spiralStackCurve} from '../path/stack-curves.mjs';
import {maximumPathAngle,strokeRange} from '../path/deposition.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';
import {traceResult} from './curves.mjs';
import {prepareSliceBoundaryStack} from "./slice-material.mjs";
import {fillSliceRegion} from "./slices.mjs";
import { compileRecipe, VERSION } from './plan.mjs';

import {assignmentGeneration} from './assignment-generation.mjs';
import {finalizedSliceResults} from './construction.mjs';

async function extensionEngines(){return {
  Geometry:await geometryOperations(),
  MaterialRegions:{prepareSliceBoundaryStack},
  Recipe:{assignmentFilament,injectionAssignment,depositionAssignment,operationId,withOperationAfter},
  Toolpath:{fillSliceRegion,spiralStackCurve,maximumPathAngle,strokeRange,publishFinishedBoundary,traceResult}
};}


// Toolpath chooses which geometry its assignments need; Geometry resolves and
// places those requests, including within-volumes in their owner's frame.
export async function preparePathGeometry(plan) {
  plan=compileRecipe(plan).plan;
  if(!plan.geometry)return prepareAssignmentGeometry(plan,plan.slices.assignments,{placed:null,componentShells:null,shells:[],volumes:new Map(),sources:new Map(),geometryFailures:new Map()});
  const components=plan.geometry.shape==='assembly'?plan.geometry.parts.map(part=>part.id):[];
  const requests=[{},...components.map(selection=>({selection}))];
  const values=await resolveGeometrySelections(plan.geometry,requests);
  const placed=values[0],componentShells=plan.geometry.shape==='assembly'?new Map(components.map((id,i)=>[id,values[1+i]])):null;
  const shells=[...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true])],volumes=new Map(),geometryFailures=new Map();
  return prepareAssignmentGeometry(plan,plan.slices.assignments,{placed,componentShells,shells,volumes,geometryFailures});
}

// Add authored selections once without rebuilding existing native geometry.
async function prepareAssignmentGeometry(plan,assignments,geometry){
  const {placed,componentShells}=geometry,shells=[...geometry.shells],volumes=new Map(geometry.volumes),sources=new Map(geometry.sources),geometryFailures=new Map(geometry.geometryFailures);
  for(const assignment of assignments){
    try{
      if(assignment.part!==undefined&&assignment.part!==null&&!shells.some(([part])=>part===assignment.part)){
        const [shell]=await resolveGeometrySelections(plan.geometry,[{selection:assignment.part}]);
        shells.push([assignment.part,shell,false]);
      }
      if(assignment.construction)continue;
      const selections=[...(assignment.geometry?[{selection:assignment.part,geometry:assignment.geometry}]:[]),...assignment.within.filter(volume=>volume.kind==='geometry').map(volume=>({selection:assignment.part,geometry:volume.geometry}))];
      const resolved=await resolveGeometrySelections(plan.geometry,selections),slots={index:0};
      if(assignment.geometry)sources.set(assignment.id,resolved[slots.index++]);
      volumes.set(assignment.id,assignment.within.map(volume=>volume.kind==='geometry'?resolved[slots.index++]:null));
    }catch(error){
      if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
      geometryFailures.set(assignment.id,error);
    }
  }
  return {placed,componentShells,shells,volumes,sources,geometryFailures};
}

// Survey every selected skin before body ownership, then finalize each
// supporting producer before constructing surface consumers.
// Prepare the same geometry/material inputs for generation and authoring.
// No deposition or execution is constructed here.
export async function prepareModelInputs(plan,{placed,componentShells,shells,volumes,sources,geometryFailures=new Map()}){
  // An assembly construction with no component chosen uses the whole assembly.
  const contexts=depositionAssignments(plan).filter(assignment=>assignment.construction||assignment.join).map(assignment=>{
    const shell=shells.find(([part])=>part===(assignment.part??null))?.[1]??((assignment.part??null)===null?placed:null),selected=assignmentPlan(plan,assignment);
    return {assignment,shell,process:selected.process};
  });
  const extensions=await extensionDeposition({plan,placed,componentShells,shells,volumes,sources,contexts,engines:await extensionEngines(),
    processForAssignment:assignment=>assignmentPlan(plan,assignment).process});
  const expanded={...plan,slices:{...plan.slices,assignments:[...plan.slices.assignments,...extensions.assignments]}};
  const contributedGeometry=await prepareAssignmentGeometry(expanded,extensions.assignments,{placed,componentShells,shells,volumes,sources,geometryFailures});
  const contributed=extensions.assignments.filter(assignment=>assignment.construction).map(assignment=>({assignment,
    shell:shells.find(([part])=>part===(assignment.part??null))?.[1]??null,process:assignmentPlan(expanded,assignment).process}));
  const constructions=[...extensions.constructions,...contexts.filter(({assignment})=>['inject','curves'].includes(assignment.construction)&&!assignment.source),...contributed];
  return {...contributedGeometry,plan:expanded,...extensions,constructions};
}

export async function generateModelResults(plan,{placed,componentShells,shells,volumes,sources,geometryFailures=new Map(),generation},onProgress) {
  if(!generation){const compiled=compileRecipe(plan);generation=assignmentGeneration(compiled.intent,compiled.failures);}
  generation.register(plan);
  for(const [id,error] of geometryFailures)generation.fail(id,error);
  plan=generation.retain(plan);
  const summary={generatorVersion:VERSION,shape:plan.geometry?.shape??null},results=[];
  const extensions=await prepareModelInputs(plan,{placed,componentShells,shells,volumes,sources,geometryFailures});
  generation.register(extensions.plan,extensions.assignmentOwners);
  for(const [id,error] of extensions.geometryFailures)generation.fail(id,error);
  generation.seal();
  const sliced=finalizedSliceResults({...extensions,generation,onProgress});
  if(extensions.materialRequirements.size)for(const result of sliced.results){
    result.materialReadiness=[];
    if(result.report.depositionFamily!=='slice')continue;
    for(const layer of result.referenceStack?.layers??[]){
      if(!layer.slice||!Array.isArray(layer.region))continue;
      const material=await sliceMaterialSolids(prepareSliceMaterial(layer));
      if(material)result.materialReadiness.push({...material,part:result.report.part??null,layerId:(result.stackId??result.id)+':layer:'+layer.index});
    }
  }
  results.push(...sliced.results.map(result=>{
    const id=result.report.owner,report=extensions.reports.get(id),requiredMaterial=extensions.materialRequirements.get(id);
    return {...result,report:{...result.report,...report},operations:requiredMaterial?.length?result.operations.map(operation=>({...operation,requiredMaterial})):result.operations};
  }));
  if(sliced.summary)summary.slices=sliced.summary;
  // Generation notes: what was not covered or failed, joining the print's limitations.
  const geometryNotes=[...new Set([...shells.flatMap(([,shell])=>shell.notes??[]),...[...volumes.values()].flatMap(values=>values.flatMap(value=>value?.notes??[]))])];
  const notes=[...geometryNotes,...extensions.notes,...sliced.notes];
  if(notes.length)summary.limitations=notes;
  Object.assign(summary,extensionSummary(results));
  const stacks=Object.fromEntries(['roof','terminal','normal'].map(kind=>[kind,results.filter(r=>r.report.referenceStackKind===kind).map(r=>({id:r.id,...r.report}))]).filter(([,items])=>items.length));
  if(Object.keys(stacks).length)summary.referenceStacks=stacks;
  if(stacks.roof){const roofs=stacks.roof;summary.surfaceDomain={maxSlopeDeg:Math.min(...roofs.map(r=>r.limitDeg)),surfaceMaxSlopeDeg:Math.max(...roofs.map(r=>r.maxSlopeDeg)),excludedAreaPercent:Math.max(...roofs.map(r=>r.excludedFraction))*100};}
  const curves=results.filter(result=>result.report.construction==='curves');
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  return {results,summary,survey:null,shells,plan:generation.retain(extensions.plan)};
}

export function summarizeGeneratedPath(placed,survey,modelSummary) {
  const summary={...modelSummary};
  summary.composition=null;

  summary.boundsMm = placed?.bounds??null;
  summary.clearance = 'Producers own internal deposition validity; scheduling resolves uncovered interference. Export checks transfers using the selected tool geometry.';
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
  const compiled=compileRecipe(plan),generation=assignmentGeneration(compiled.intent,compiled.failures);
  plan=compiled.plan;
  const authoredTemperatures=plannedNozzleTemperatures(plan);
  const validation=await validateSelectedExtensionRecipe(plan);
  for(const failure of validation.failures)generation.fail(failure.assignment,Error(failure.message));
  plan=generation.retain(plan);
  const geometry=await preparePathGeometry(plan);
  const prepared={...geometry,generation};
  const evaluated=modulations?{...plan,modulations}:plan;
  const materialAssignments=assignedFilaments(plan),defaultFilament=plan.setup.filament??materialAssignments[0]??null;
  const assigned=[...new Set([defaultFilament,...materialAssignments].filter(v=>v!==null&&v!==undefined))];
  const selections=materialAssignments.length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,i)])):null;
  const model=await generateModelResults(evaluated,prepared,onProgress);
  const complemented=model;
  const {placed}=prepared,{results,survey}=complemented,process=plan.process;
  const summary=summarizeGeneratedPath(placed,survey,complemented.summary);
  summary.substrateAdaptation={experimental:true,enabled:plan.experimental.substrateAdaptation,
    sliceQueries:results.reduce((sum,result)=>sum+(result.report.substrateContactQueries??0),0),
    sliceHits:results.reduce((sum,result)=>sum+(result.report.contactSamples??0),0),
    sliceMisses:results.reduce((sum,result)=>sum+(result.report.uncoveredContactSamples??0),0)};
  summary.inspection=depositionInspection(results);
  if(modulationPreparation.length)summary.modulationGeometry=modulationPreparation;
  for(const result of results)for(const operation of result.operations)for(const target of [operation.nozzleC,operation.restoreNozzleC])
    if(target!==undefined)requireThat(authoredTemperatures.has(target),'Unplanned operation temperature.');
  return constructionPath({results,planning:{process,selection:selections?.[defaultFilament]??null,selections},
    composition:plan.composition,summary,generatorVersion:VERSION,onProgress});
}
