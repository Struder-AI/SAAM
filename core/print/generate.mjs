// Generation: locked plan in, SAAMpath out.
//
// The order is fixed by the geometry, not by a further planning step. If a
// draped skin is selected, its survey runs first because it decides how much
// material the planar body must leave under the top surface; the body then
// fills up to that reserved surface, and the skin follows the surface down to
// it. With no skin selected the body simply fills the whole solid.

import { makeShell, assertClosed } from '../geom/shell.mjs';
import {shellFromSurfaces,splineSolidShell} from '../geom/spline-solid.mjs';
import {planToolpath} from '../path/toolpath.mjs';
import {filamentSelection,assignedFilaments} from '../machine/filaments.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {surveySkinAssignment,skinResult,frontResults} from './surface-constructions.mjs';
import {depositedBeadSegments,depositedTopAt} from '../path/deposited-curves.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import {curveAssignmentResults} from './curves.mjs';
import {finalizeDepositionResult,finalizeDepositionResults} from './finalize.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {toolBounds,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {sleeveResult,rimResult} from './sleeve-constructions.mjs';
import {planarSupportTopAt} from '../region/support-surface.mjs';
import {sliceResults} from './slices.mjs';
import {supportResults,supportDependencies} from '../../skills/supports/scripts/supports.mjs';
import {claddingResult} from './cladding-constructions.mjs';
import {publishFinishedBoundary,consumeFinishedSurface,republishDepositedBoundary} from '../path/finished-surface.mjs';
import {preparePlasticWeld,plasticWeldResult} from '../../skills/plastic-weld/scripts/weld.mjs';
import {validateHeatSetAssignments} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {booleanShell} from '../geom/boolean-solid.mjs';

// Booleans are stored as their recipe in the native JSON file, like meshes.
export const hasMesh=geometry=>['mesh','blob-field','text','gridfinity','heat-set','boolean'].includes(geometry.shape)||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry)));

function primeLineResult(plan,machine){
  const p=plan.process.primeLine;if(p===null)return null;
  const passes=p.passes??[p],region=[],strokes=[];
  const bounds=toolBounds(machine,plan.setup.tool);
  let lengthMm=0,volumeMm3=0,maxZ=0,maxWidth=0;
  for(const pass of passes){
    const [a,b]=[pass.startMm,pass.endMm],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length*pass.widthMm/2,ny=dx/length*pass.widthMm/2;
    requireThat([a,b].every(point=>point.every((v,i)=>v>=bounds.min[i]+pass.widthMm/2&&v<=bounds.max[i]-pass.widthMm/2))&&pass.zMm<=bounds.max[2],
      'Prime line exceeds selected tool bounds.');
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

export function buildShell(rhino, geometry) {
  if(geometry.shape==='spline')return splineSolidShell(rhino,geometry);
  if(geometry.shape==='boolean')return booleanShell(geometry.operation,geometry.operands.map(operand=>buildShell(rhino,operand)));
  if(['mesh','blob-field','text','gridfinity','heat-set'].includes(geometry.shape)){
    return makeMesh(geometry.vertices,geometry.triangles);
  }
  if(geometry.shape==='assembly'&&hasMesh(geometry)) {
    const components=geometry.parts.map(part=>translateShell(buildShell(rhino,part.geometry),part.xMm,part.yMm,part.zMm));
    return {kind:'assembly',components,bounds:{min:[0,1,2].map(i=>Math.min(...components.map(c=>c.bounds.min[i]))),max:[0,1,2].map(i=>Math.max(...components.map(c=>c.bounds.max[i])))}};
  }
  if(geometry.shape==='assembly') {
    const entries=geometry.parts.flatMap(part=>buildShell(rhino,part.geometry).surfaces.map(entry=>{
      const surface=entry.surface.duplicate();
      requireThat(surface.translate([part.xMm,part.yMm,part.zMm]),'Could not place native component.');
      return {name:part.id+'/'+entry.name,surface};
    }));
    return assertClosed(shellFromSurfaces(rhino,entries,'assembly'));
  }
  throw new Error(`Unsupported geometry shape: ${geometry.shape}.`);
}

// Placement moves the whole shell onto the bed by shifting control points; the
// patches keep their parameterisation, so sections and surface solves are
// unaffected apart from the translation.
export function translateShell(shell, dx, dy, dz = 0) {
  if(shell.kind==='triangle-mesh'){
    return translateMesh(shell,dx,dy,dz);
  }
  if(shell.kind==='boolean')return booleanShell(shell.operation,shell.operands.map(s=>translateShell(s,dx,dy,dz)));
  if(shell.kind==='assembly')return {...shell,components:shell.components.map(s=>translateShell(s,dx,dy,dz)),bounds:{min:shell.bounds.min.map((v,i)=>v+[dx,dy,dz][i]),max:shell.bounds.max.map((v,i)=>v+[dx,dy,dz][i])}};
  const patches = shell.patches.map(patch => {
    const cp = Float64Array.from(patch.cp);
    for (let i = 0; i < cp.length; i += 4) {
      const w = cp[i + 3];
      cp[i] += dx * w;
      cp[i + 1] += dy * w;
      cp[i + 2] += dz * w;
    }
    return { ...patch, cp };
  });
  const moved = makeShell(patches, { name: shell.name });
  moved.surfaces = shell.surfaces;
  return assertClosed(moved);
}

export function preparePathGeometry(plan,machine,rhino) {
  validatePlan(plan, machine);
  validateHeatSetAssignments(plan);
  const placed = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const componentShells=plan.geometry.shape==='assembly' ? new Map(plan.geometry.parts.map(part=>[part.id,
    translateShell(buildShell(rhino,part.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm)])) : null;
  const weldSites=preparePlasticWeld({plan,placed,componentShells});
  const bounds=toolBounds(machine,plan.setup.tool);
  const geometryBounds=assignedFilaments(plan).length?machine.bounds:bounds;
  requireThat(machine.motionChecks==='deferred'||placed.bounds.min.every((v,i)=>v>=geometryBounds.min[i]-1e-8)&&placed.bounds.max.every((v,i)=>v<=geometryBounds.max[i]+1e-8),'Placed geometry exceeds selected tool bounds.');
  return {placed,componentShells,weldSites,bounds};
}

// Geometry volumes named by slice assignments, placed like their part.
export function sliceVolumes(plan,rhino) {
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
  const selections=geometrySelections(plan.geometry);
  const named=[...new Set(plan.slices.assignments.filter(a=>a.part!==undefined&&a.preset!=='support').map(a=>a.part).filter(p=>p!==null&&!componentShells?.has(p)))];
  return [...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true]),
    ...named.map(part=>{const s=selections.get(part);return [part,translateShell(buildShell(rhino,s.geometry),plan.placement.xMm+s.xMm,plan.placement.yMm+s.yMm,s.zMm),false];})];
}

// Survey every selected skin before body ownership, then finalize each
// supporting producer before constructing surface consumers.
export function generateModelResults(plan,machine,rhino,{placed,componentShells,bounds,weldSites=[]},onProgress) {
  const welds=weldSites.map(site=>site.reservation),process=plan.process;
  const summary={generatorVersion:VERSION,shape:plan.geometry.shape},results=[];
  const shells=sliceShells(plan,rhino,{placed,componentShells}),selections=geometrySelections(plan.geometry);
  const skins=plan.slices.assignments.filter(a=>a.construction==='skin').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Skin needs a selected component or the single solid.');
    const selectedProcess=assignmentPlan(plan,machine,assignment).process;
    return {assignment,shell,process:selectedProcess,survey:surveySkinAssignment({assignment,shell,machine})};
  });
  requireThat(new Set(skins.map(s=>s.assignment.part)).size===skins.length,'Only one skin assignment may reserve a selected part roof.');
  const sleeves=plan.slices.assignments.filter(a=>a.construction==='sleeve').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Sleeve needs a selected component or the single solid.');
    const startMm=shell.bounds.min[2]+assignment.zStartMm,endMm=assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm;
    return {assignment,shell,startMm,endMm,process:assignmentPlan(plan,machine,assignment).process};
  });
  for(let i=0;i<sleeves.length;i++)for(let j=i+1;j<sleeves.length;j++)requireThat(sleeves[i].assignment.part!==sleeves[j].assignment.part||Math.min(sleeves[i].endMm,sleeves[j].endMm)<=Math.max(sleeves[i].startMm,sleeves[j].startMm)+1e-8,'Sleeve assignments cannot claim overlapping material bands.');
  const bands=sleeves.map(s=>({part:s.assignment.part,startMm:s.startMm,endMm:s.endMm}));
  const sliced=sliceResults({plan,machine,shells,volumes:sliceVolumes(plan,rhino),bands,reserves:[...skins.map(s=>s.survey),...welds],envelopes:welds,onProgress});
  const finalizedSlices=finalizeDepositionResults(sliced.results,plan,machine);
  if(sliced.summary)summary.slices=sliced.summary;
  results.push(...finalizedSlices);
  const sleeveResults=new Map(),changes=[];
  for(const context of sleeves) {
    const {assignment,shell,startMm,endMm}=context;
    const samePart=finalizedSlices.filter(r=>r.report.part===assignment.part).flatMap(r=>r.operations);
    const below=samePart.filter(op=>op.rank<=startMm+1e-8).map(op=>op.id);
    if(assignment.zStartMm>1e-8&&below.length){
      const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
      requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
    }
    const previousSleeves=sleeves.filter(other=>other!==context&&other.assignment.part===assignment.part&&other.endMm<=startMm+1e-8);
    requireThat(!previousSleeves.some(other=>!sleeveResults.has(other.assignment.id)),'Stacked sleeve assignments must be defined bottom to top.');
    requireThat(assignment.zStartMm===0||below.length||previousSleeves.length,'A raised sleeve needs supporting deposition below its start.');
    const changedFoundation=finalizedSlices.some(r=>r.report.part===assignment.part&&r.report.modulation?.changed&&r.operations.some(op=>below.includes(op.id)))||previousSleeves.some(other=>sleeveResults.get(other.assignment.id).report.modulation?.changed);
    requireThat(assignment.zStartMm===0||!changedFoundation,`Sleeve ${assignment.id}: contact with a modulated foundation is unsupported; use an unmodulated supporting assignment.`);
    const after=[...new Set([...assignment.after,...below,...previousSleeves.flatMap(other=>sleeveResults.get(other.assignment.id).operations.map(op=>op.id))])];
    const result=sleeveResult({...context,machine,after,onProgress});
    const published=assignment.pattern===null&&!assignment.meshSleeve?publishFinishedBoundary(result,{shell,boundary:'side',startMm:result.report.baseTopMm,
      endMm:result.report.endMm-(assignment.endTransition==='level'?0:context.process.layerMm),toleranceMm:assignment.boundaryToleranceMm}):result;
    const selected={...published,report:{...published.report,part:assignment.part,construction:'sleeve'},operations:published.operations.map(op=>({...op,part:assignment.part,...(assignment.filament===null?{}:{filament:assignment.filament})}))};
    const finalized=finalizeDepositionResult(selected,plan,machine);results.push(finalized);sleeveResults.set(assignment.id,finalized);
    const above=samePart.filter(op=>op.rank>endMm+1e-8);
    requireThat(!above.length||assignment.endTransition==='level','Slices above a sleeve need its ending transition to be level.');
    for(const op of above)changes.push({operationId:op.id,after:finalized.operations.map(op=>op.id),mode:'union'});
  }
  if(sleeveResults.size)summary.vaseWall={...sleeveResults.values().next().value.report,instances:[...sleeveResults.values()].map(r=>({id:r.id,...r.report}))};
  for(const assignment of plan.slices.assignments.filter(a=>a.construction==='rim')) {
    const sourceAssignment=plan.slices.assignments.find(a=>a.id===assignment.source),sourceResult=sleeveResults.get(assignment.source);
    const shell=shells.find(([part])=>part===assignment.part)?.[1];requireThat(shell,'Rim needs a selected component or single solid.');
    const selectedProcess=assignmentPlan(plan,machine,assignment).process;
    const result=rimResult({assignment,shell,process:selectedProcess,sourceAssignment,sourceResult});
    const selected={...result,report:{...result.report,part:assignment.part,construction:'rim'},operations:result.operations.map(op=>({...op,part:assignment.part,...(assignment.filament===null?{}:{filament:assignment.filament})}))};
    const finalized=finalizeDepositionResult(selected,plan,machine);results.push(finalized);
    summary.thickLip={instances:[...(summary.thickLip?.instances??[]),{id:assignment.id,...finalized.report}]};
  }
  const skinReports=[],pendingSkins=[...skins];
  const skinSourceMatches=(result,sourceId)=>{
    const source=plan.slices.assignments.find(a=>a.id===sourceId);
    return source&&(result.report?.owner??result.id)===sourceId&&(source.part===undefined||result.report?.part===source.part);
  };
  while(pendingSkins.length) {
    const ready=pendingSkins.findIndex(s=>s.assignment.supportFrom===null||results.some(r=>skinSourceMatches(r,s.assignment.supportFrom)));
    requireThat(ready>=0,'Skin supportFrom names an absent producer, a later-stage producer or a dependency cycle.');
    const [context]=pendingSkins.splice(ready,1);
    const supporting=results.filter(r=>context.assignment.supportFrom!==null?skinSourceMatches(r,context.assignment.supportFrom):r.report?.part===context.assignment.part||r.finishedSurfaces?.some(surface=>surface.shell===context.shell));
    const supports=finalizedSlices.filter(r=>r.report.part===context.assignment.part&&r.operations.length).map(r=>({shell:context.shell,results:[r]}));
    const actual=context.assignment.supportFrom!==null||!supports.length||supporting.some(r=>r.report?.modulation?.changed);
    const segments=actual?depositedBeadSegments(supporting.flatMap(r=>r.operations),{widthMm:context.process.lineWidthMm}):null;
    requireThat(supporting.length,`Skin ${context.assignment.id} needs supporting deposition; add a body assignment.`);
    const supportTopAt=actual?(x,y)=>{
      const top=depositedTopAt(segments,[x,y],Infinity);
      requireThat(top!==null,`Skin ${context.assignment.id}: finalized supporting strokes do not cover a required contact; revise fill or the modulation.`);return top;
    }:supports.length?planarSupportTopAt(supports,context.process):null;
    const produced=skinResult({...context,machine,after:results.flatMap(r=>r.operations.map(op=>op.id)),supportTopAt});
    const result={...produced,report:{...produced.report,part:context.assignment.part}};
    const published=publishFinishedBoundary(result,result.boundaryRequest);
    const finalized=republishDepositedBoundary(finalizeDepositionResult(published,plan,machine),{widthMm:context.process.lineWidthMm});
    results.push(finalized);skinReports.push({id:result.id,part:context.assignment.part,...finalized.report});
  }
  if(skinReports.length)summary.drapedSkin={...skinReports[0],instances:skinReports};
  const survey=skins[0]?.survey??null;
  if(skins.length)summary.nonplanarLimit={machineMaxAngleDeg:skins[0].survey.declaredLimitDeg,effectiveMaxAngleDeg:Math.max(...skins.map(s=>s.survey.limitDeg)),experimentalOverride:skins.some(s=>s.survey.experimentalOverride),surfaceMaxSlopeDeg:Math.max(...skins.map(s=>s.survey.maxSlopeDeg)),excludedAreaPercent:Math.max(...skins.map(s=>s.survey.steepFraction))*100};
  return {results:applyResultDependencies(results,changes),summary,survey,shells,slicedSupports:finalizeDepositionResults(sliced.supports,plan,machine)};
}

export function addComplementaryResults(plan,machine,{placed,componentShells,weldSites,bounds},batch) {
  const results=[...batch.results],summary={...batch.summary};
  for(const assignment of plan.slices.assignments.filter(a=>a.construction==='cladding')){
    const shell=batch.shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Cladding needs a selected component or the single solid.');
    const sources=assignment.source===null?results:results.filter(r=>(r.report?.owner??r.id)===assignment.source&&r.report?.part===assignment.part);
    requireThat(sources.length,`Cladding ${assignment.id}: source names an absent producer or a different part.`);
    const finishedSurface=consumeFinishedSurface({shell,selection:assignment.surface,results:sources});
    const selected=assignmentPlan(plan,machine,assignment);
    const result=claddingResult({shell,assignment,process:selected.process,motion:selected.setup.denso,finishedSurface});
    const finalized=finalizeDepositionResult(result,plan,machine);
    results.push(finalized);summary.pipeCladding={...finalized.report,instances:[...(summary.pipeCladding?.instances??[]),{id:assignment.id,...finalized.report}]};
  }
  const waves=frontResults({assignments:plan.slices.assignments.filter(a=>a.construction==='fronts'),plan,machine,placed,componentShells,modelResults:results});
  const wavedResults=[...applyResultDependencies(results,waves.dependencyChanges),...finalizeDepositionResults(waves.results,plan,machine)];
  if(waves.results.length)summary.waveOverhangs=waves.results.map(r=>r.report);
  const curves=curveAssignmentResults({plan,machine,modelResults:wavedResults,bounds:machine.motionChecks==='deferred'?null:bounds});
  const constructedResults=[...wavedResults,...curves];
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  // Support-preset slices and tree supports print before what they hold up.
  const supports=[...(batch.slicedSupports??[]),...supportResults({plan,machine,shells:componentShells?[...componentShells.values()]:[placed]})];
  const supportedResults=[...supports,...applyResultDependencies(constructedResults,supportDependencies(supports,constructedResults))];
  if(supports.length)summary.supports=supports.map(r=>({id:r.id,...r.report}));
  const welds=plasticWeldResult({plan,sites:weldSites,modelResults:supportedResults});
  const weldedResults=applyResultDependencies(supportedResults,welds.dependencyChanges);
  if(welds.result)summary.plasticWeld=welds.result.report;
  return {...batch,results:welds.result?[...weldedResults,welds.result]:weldedResults,summary};
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

export function addPrimeResult(plan,machine,batch) {
  const prime=primeLineResult(plan,machine);
  if(!prime)return {...batch,prime};
  const results=[prime,...batch.results.map(result=>({...result,operations:result.operations.map(op=>({...op,after:[...new Set([...(op.after??[]),'prime-line:0'])]}))}))];
  return {...batch,results,summary:{...batch.summary,primeLine:prime.report},prime};
}

export function summarizeGeneratedPath(placed,survey,modelSummary) {
  const summary={...modelSummary};
  summary.composition=null;

  summary.boundsMm = placed.bounds;
  summary.clearance = 'operator responsibility; no collision model implemented';
  summary.physicalValidation = 'not performed';
  if (survey&&!summary.nonplanarLimit) summary.nonplanarLimit = {
    machineMaxAngleDeg: survey.declaredLimitDeg,
    effectiveMaxAngleDeg: survey.limitDeg,
    experimentalOverride: survey.experimentalOverride,
    surfaceMaxSlopeDeg: Number(survey.maxSlopeDeg.toFixed(3)),
    excludedAreaPercent: Number((survey.steepFraction * 100).toFixed(2))
  };
  return summary;
}

export function generatePath(plan, machine, rhino, {onProgress} = {}) {
  const prepared=preparePathGeometry(plan,machine,rhino);
  const model=generateModelResults(plan,machine,rhino,prepared,onProgress);
  const complemented=addComplementaryResults(plan,machine,prepared,model);
  const primed=addPrimeResult(plan,machine,complemented);
  const {placed,bounds}=prepared,{results,survey,prime}=primed,process=plan.process;
  const summary=summarizeGeneratedPath(placed,survey,primed.summary);
  const assigned=[...new Set([plan.setup.bambu?.filament,...assignedFilaments(plan)].filter(v=>v!==undefined))];
  const selections=assignedFilaments(plan).length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,machine,i)])):null;
  return planToolpath({start:startupPosition(machine,plan),process,machine,generatorVersion:VERSION,
    selection:selections?.[plan.setup.bambu.filament]??null,selections,
    motion:plan.setup.denso??null,motionBounds:bounds,retracted:startupRetracted(machine,plan)},results,
  {geometryBounds:placed.bounds,rules:plan.composition,prime:!prime,summary,onProgress});
}
