import {requireThat} from '../private/toolpath/numeric.mjs';
import {buildShell,translateShell} from '../geom/build.mjs';
import {ASSIGNMENT_RECORDS} from '../../skills/records.mjs';
import {extensionDeposition,extensionResultDependencies,extensionSummary} from '../../skills/deposition.mjs';
// Generation: authored geometry and recipe into finalized deposition and SAAMpath.
// Ownership precedes construction; one dependency graph schedules shared courses
// and their finalized-material consumers.

import {planFinishing} from '../path/toolpath.mjs';
import {createPlanningState,planFan,planningPath,planningResult} from '../path/planning.mjs';
import {planOperation,validateOperationBatch,prepareOperationDependencies} from '../path/compose.mjs';
import {filamentSelection,assignedFilaments} from '../machine/filaments.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {assignmentPlan,depositionAssignments} from './assignment-process.mjs';
import {surveySurfaceDomain} from './surface-domains.mjs';
import { compileRecipe, VERSION } from './plan.mjs';

import {finalizedSliceResults} from './slice-deposition.mjs';
import {geometrySelections} from '../geom/selections.mjs';


function primeLineResult(plan,machine){
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

export function preparePathGeometry(plan,machine,rhino) {
  ({plan,machine}=compileRecipe(plan,machine));
  if(!plan.geometry)return {placed:null,componentShells:null,bounds:null};
  const placed = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const componentShells=plan.geometry.shape==='assembly' ? new Map(plan.geometry.parts.map(part=>[part.id,
    translateShell(buildShell(rhino,part.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm)])) : null;
  return {placed,componentShells,bounds:null};
}

// Geometry volumes named by slice assignments, placed like their part.
export function sliceVolumes(plan,rhino) {
  if(!plan.geometry)return new Map();
  const selections=geometrySelections(plan.geometry);
  return new Map(plan.slices.assignments.filter(assignment=>!assignment.construction).map(assignment=>{
    const part=assignment.part!==null?selections.get(assignment.part):{xMm:0,yMm:0,zMm:0};
    return [assignment.id,assignment.within.map(volume=>volume.kind==='geometry'
      ?translateShell(buildShell(rhino,volume.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm):null)];
  }));
}

// The shells slice assignments cut, [part, shell, whole]: every assembly
// component (or the whole print) for assignments without a part, and each
// geometry selection an assignment names, placed like the print.
export function sliceShells(plan,rhino,{placed,componentShells}) {
  if(!plan.geometry)return [];
  const selections=geometrySelections(plan.geometry);
  const named=[...new Set(plan.slices.assignments.filter(a=>a.part!==undefined&&a.preset!=='support').map(a=>a.part).filter(p=>p!==null&&!componentShells?.has(p)))];
  return [...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true]),
    ...named.map(part=>{const s=selections.get(part);return [part,translateShell(buildShell(rhino,s.geometry),plan.placement.xMm+s.xMm,plan.placement.yMm+s.yMm,s.zMm),false];})];
}

// Survey every selected skin before body ownership, then finalize each
// supporting producer before constructing surface consumers.
export function generateModelResults(plan,machine,rhino,{placed,componentShells,bounds,planningState,emittedIds=[]},onProgress) {
  const summary={generatorVersion:VERSION,shape:plan.geometry?.shape??null},results=[];
  const shells=sliceShells(plan,rhino,{placed,componentShells});
  const contexts=depositionAssignments(plan).filter(assignment=>assignment.construction||assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal'||assignment.within?.some(v=>v.kind==='surface-domain'&&v.loopsUv===null)).map(assignment=>{
    const shell=shells.find(([part])=>part===(assignment.part??null))?.[1],selected=assignmentPlan(plan,machine,assignment);
    if(ASSIGNMENT_RECORDS[assignment.construction]?.requiresComponent||!assignment.construction&&assignment.surface?.kind!=='terminal')requireThat(shell,'A surface family needs a selected component or the single solid.');
    return {assignment,shell,process:selected.process,maxBeadHeightMm:Infinity};
  });
  const skins=contexts.filter(({assignment})=>assignment.within?.some(v=>v.kind==='surface-domain'&&v.loopsUv===null)).map(context=>({...context,survey:surveySurfaceDomain({...context,machine})}));
  const extensions=extensionDeposition({plan,machine,placed,componentShells,contexts,onProgress});
  const rims=contexts.filter(({assignment})=>assignment.surface?.kind==='terminal'),referenceAssignments=contexts.filter(({assignment})=>assignment.stack?.direction==='normal');
  const constructions=[...extensions.constructions,...contexts.filter(({assignment})=>['inject','curves'].includes(assignment.construction))];
  const sliced=finalizedSliceResults({plan,machine,shells,volumes:sliceVolumes(plan,rhino),...extensions,surfaceAssignments:skins,referenceAssignments,terminalAssignments:rims,constructions,onProgress,planningState,emittedIds});
  results.push(...sliced.results);
  if(sliced.summary)summary.slices=sliced.summary;
  Object.assign(summary,extensionSummary(results));
  const families=Object.fromEntries(['roof','terminal','normal'].map(kind=>[kind,results.filter(r=>r.report.referenceFamily===kind).map(r=>({id:r.id,...r.report}))]).filter(([,items])=>items.length));
  if(Object.keys(families).length)summary.referenceFamilies=families;
  const curves=results.filter(result=>result.report.construction==='curves');
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  const survey=skins[0]?.survey??null;
  if(skins.length)summary.surfaceDomain={maxSlopeDeg:Math.max(...skins.map(s=>s.survey.limitDeg)),surfaceMaxSlopeDeg:Math.max(...skins.map(s=>s.survey.maxSlopeDeg)),excludedAreaPercent:Math.max(...skins.map(s=>s.survey.steepFraction))*100};
  return {results,summary,survey,shells,slicedSupports:sliced.supports,execution:sliced.execution};
}

export function addComplementaryResults(plan,machine,geometry,batch) {
  const supports=batch.slicedSupports??[],results=[...batch.results],summary={...batch.summary};
  if(supports.length)summary.supports=supports.map(r=>({id:r.id,...r.report}));
  const completed=[...supports,...applyResultDependencies(results,extensionResultDependencies(results,supports))];
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

export const GENERATION_CONTRACT='saam-deposition/9';
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

export function generatePath(plan, machine, rhino, {onProgress,modulations,modulationPreparation=[]} = {}) {
  const prepared=preparePathGeometry(plan,machine,rhino);
  const evaluated=modulations?{...plan,modulations}:plan;
  const assigned=[...new Set([plan.setup.bambu?.filament,...assignedFilaments(plan)].filter(v=>v!==undefined))];
  const selections=assignedFilaments(plan).length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,machine,i)])):null;
  const start=[plan.placement.xMm,plan.placement.yMm,(prepared.placed?.bounds.max[2]??0)+plan.process.liftMm];
  const started=planFan(createPlanningState({start,process:plan.process,generatorVersion:VERSION,
    selection:selections?.[plan.setup.bambu.filament]??null,selections}),0);
  const prime=primeLineResult(plan),startup=prime?planOperation(started.state,prime.operations[0]):planningResult(started.state);
  const model=generateModelResults(evaluated,machine,rhino,{...prepared,planningState:startup.state,emittedIds:prime?prime.operations.map(op=>op.id):[]},onProgress);
  const complemented=addComplementaryResults(evaluated,machine,prepared,model);
  const primed=prime?{...complemented,results:[prime,...complemented.results],summary:{...complemented.summary,primeLine:prime.report}}:complemented;
  const {placed,bounds}=prepared,{results,survey}=primed,process=plan.process;
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
  return planningPath(finished.state,[started.actions,startup.actions,execution.actions,finished.actions],{...summary,composition:{...execution.summary,operationOrder:order}});
}
