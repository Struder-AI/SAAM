// Generation: authored geometry and recipe into finalized deposition and SAAMpath.
// Ownership precedes construction; one dependency graph schedules shared courses
// and their finalized-material consumers.

import { makeShell, assertClosed } from '../geom/shell.mjs';
import {shellFromSurfaces,splineSolidShell} from '../geom/spline-solid.mjs';
import {planToolpath} from '../path/toolpath.mjs';
import {filamentSelection,assignedFilaments} from '../machine/filaments.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {surveySkinAssignment} from './surface-constructions.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {toolBounds,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {finalizedSliceResults} from './slice-deposition.mjs';
import {supportResults,supportDependencies} from '../../skills/supports/scripts/supports.mjs';
import {preparePlasticWeld,plasticWeldResult} from '../../skills/plastic-weld/scripts/weld.mjs';
import {validateHeatSetAssignments} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {booleanShell} from '../geom/boolean-solid.mjs';
import {scanlineFill} from '../region/region2d.mjs';
import {sampleAuthoredCurve} from '../path/authored-curves.mjs';

// Booleans are stored as their recipe in the native JSON file, like meshes.
export const hasMesh=geometry=>!!geometry&&(['mesh','blob-field','text','gridfinity','heat-set','boolean'].includes(geometry.shape)||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry))));

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
  if(!plan.geometry)return {placed:null,componentShells:null,weldSites:[],bounds:toolBounds(machine,plan.setup.tool)};
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
export function generateModelResults(plan,machine,rhino,{placed,componentShells,bounds,weldSites=[]},onProgress) {
  const welds=weldSites.map(site=>site.reservation),process=plan.process;
  const summary={generatorVersion:VERSION,shape:plan.geometry?.shape??null},results=[];
  const shells=sliceShells(plan,rhino,{placed,componentShells});
  const skins=plan.slices.assignments.filter(a=>a.construction==='skin').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Skin needs a selected component or the single solid.');
    const selectedProcess=assignmentPlan(plan,machine,assignment).process;
    return {assignment,shell,process:selectedProcess,survey:surveySkinAssignment({assignment,shell,machine})};
  });
  const sleeves=plan.slices.assignments.filter(a=>a.construction==='sleeve').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Sleeve needs a selected component or the single solid.');
    const startMm=shell.bounds.min[2]+assignment.zStartMm,endMm=assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm;
    return {assignment,shell,startMm,endMm,process:assignmentPlan(plan,machine,assignment).process};
  });
  for(let i=0;i<sleeves.length;i++)for(let j=i+1;j<sleeves.length;j++)requireThat(sleeves[i].assignment.part!==sleeves[j].assignment.part||Math.min(sleeves[i].endMm,sleeves[j].endMm)<=Math.max(sleeves[i].startMm,sleeves[j].startMm)+1e-8,'Sleeve assignments cannot claim overlapping material bands.');
  const bands=sleeves.map(s=>({part:s.assignment.part,startMm:s.startMm,endMm:s.endMm}));
  const rims=plan.slices.assignments.filter(a=>a.construction==='rim').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Rim needs a selected component or single solid.');
    return {assignment,shell,process:assignmentPlan(plan,machine,assignment).process};
  });
  const injections=plan.slices.assignments.filter(a=>a.construction==='inject').map(assignment=>({assignment,process:assignmentPlan(plan,machine,assignment).process}));
  const remaining=plan.slices.assignments.filter(a=>['curves','bridges'].includes(a.construction)).map(assignment=>({assignment,
    shell:shells.find(([part])=>part===(assignment.part??null))?.[1],process:assignmentPlan(plan,machine,assignment).process}));
  const referenceAssignments=plan.slices.assignments.filter(a=>a.construction==='cladding').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    requireThat(shell,'Cladding needs a selected component or the single solid.');
    return {assignment,shell,process:assignmentPlan(plan,machine,assignment).process};
  });
  const constructions=[...sleeves,...rims,...injections,...remaining].map(context=>({...context,maxBeadHeightMm:machine.tools.find(tool=>tool.index===assignmentPlan(plan,machine,context.assignment).setup.tool)?.layerHeightMm?.[1]??Infinity}));
  const sliced=finalizedSliceResults({plan,machine,shells,volumes:sliceVolumes(plan,rhino),bands,reserves:welds,envelopes:welds,surfaceAssignments:skins,referenceAssignments,constructions,onProgress});
  results.push(...sliced.results);
  if(sliced.summary)summary.slices=sliced.summary;
  for(const [kind,key] of [['sleeve','vaseWall'],['rim','thickLip'],['skin','drapedSkin']]){
    const instances=results.filter(result=>result.report.construction===kind).map(result=>({id:result.id,...result.report}));
    if(instances.length)summary[key]={...instances[0],instances};
  }
  const cladding=results.filter(result=>result.report.construction==='cladding');
  if(cladding.length)summary.pipeCladding={...cladding.at(-1).report,instances:cladding.map(result=>({id:result.id,...result.report}))};
  const curves=results.filter(result=>['curves','bridges'].includes(result.report.construction));
  if(curves.length)summary.curves=curves.map(result=>({id:result.id,...result.report}));
  const survey=skins[0]?.survey??null;
  if(skins.length)summary.nonplanarLimit={machineMaxAngleDeg:skins[0].survey.declaredLimitDeg,effectiveMaxAngleDeg:Math.max(...skins.map(s=>s.survey.limitDeg)),experimentalOverride:skins.some(s=>s.survey.experimentalOverride),surfaceMaxSlopeDeg:Math.max(...skins.map(s=>s.survey.maxSlopeDeg)),excludedAreaPercent:Math.max(...skins.map(s=>s.survey.steepFraction))*100};
  return {results,summary,survey,shells,slicedSupports:sliced.supports};
}

export function addComplementaryResults(plan,machine,{placed,componentShells,weldSites,bounds},batch) {
  const results=[...batch.results],summary={...batch.summary};
  // Support-preset slices and tree supports print before what they hold up.
  const supports=[...(batch.slicedSupports??[]),...supportResults({plan,machine,shells:componentShells?[...componentShells.values()]:placed?[placed]:[]})];
  const supportedResults=[...supports,...applyResultDependencies(results,supportDependencies(supports,results))];
  if(supports.length)summary.supports=supports.map(r=>({id:r.id,...r.report}));
  const welds=plasticWeldResult({plan,machine,sites:weldSites,modelResults:supportedResults});
  const weldedResults=applyResultDependencies(supportedResults,welds.dependencyChanges);
  if(welds.result)summary.plasticWeld=welds.result.report;
  const completed=welds.result?[...weldedResults,welds.result]:weldedResults;
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

export function addPrimeResult(plan,machine,batch) {
  const prime=primeLineResult(plan,machine);
  if(!prime)return {...batch,prime};
  const results=[prime,...batch.results.map(result=>({...result,operations:result.operations.map(op=>({...op,after:[...new Set([...(op.after??[]),'prime-line:0'])]}))}))];
  return {...batch,results,summary:{...batch.summary,primeLine:prime.report},prime};
}

export function summarizeGeneratedPath(placed,survey,modelSummary) {
  const summary={...modelSummary};
  summary.composition=null;

  summary.boundsMm = placed?.bounds??null;
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

export function depositionInspection(results){
  const operations={},slices={};
  for(const result of results){
    const family=result.familyId??result.report?.owner??result.id;
    for(const layer of result.family?.layers??[]){
      const key=`${result.id}:${layer.index}`;
      if(layer.slice&&layer.region?.length){
        const points=layer.region.flat(),extent=[0,1].map(k=>Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k])));
        const map=(points,closed=false)=>sampleAuthoredCurve({closed,uv:{points,reference:{kind:'slice',assignment:key,index:layer.index}}},
          {references:{[`slice:${key}`]:{layers:[layer]}},toleranceMm:.05,sampleStepMm:2}).points;
        const grid=[0,90].flatMap((angle,i)=>extent[1-i]>1e-9?scanlineFill(layer.region,extent[1-i]/6,angle).map(row=>map([row.from,row.to])):[]);
        slices[key]={family,index:layer.index,loops:layer.region.map(loop=>map(loop,true)),grid};
      }
    }
    for(const operation of result.operations){
      const index=operation.layerIndex??operation.layer,key=`${result.id}:${index}`;
      const changed=result.report?.modulation?.changedOperations?.includes(operation.id);
      operations[operation.id]={family,index,roles:[...new Set(operation.strokes.map(stroke=>stroke.role))],
        modifiers:changed?(result.report.modulation.operationModifiers?.[operation.id]??result.report.modulation.modifiers):[],slice:slices[key]?key:null};
    }
  }
  return {operations,slices};
}

export function generatePath(plan, machine, rhino, {onProgress,modulations,modulationPreparation=[]} = {}) {
  const prepared=preparePathGeometry(plan,machine,rhino);
  const evaluated=modulations?{...plan,modulations}:plan;
  const model=generateModelResults(evaluated,machine,rhino,prepared,onProgress);
  const complemented=addComplementaryResults(evaluated,machine,prepared,model);
  const primed=addPrimeResult(plan,machine,complemented);
  const {placed,bounds}=prepared,{results,survey,prime}=primed,process=plan.process;
  const summary=summarizeGeneratedPath(placed,survey,primed.summary);
  summary.substrateAdaptation={experimental:true,enabled:plan.experimental.substrateAdaptation,
    sliceQueries:results.reduce((sum,result)=>sum+(result.report.substrateContactQueries??0),0),
    sliceHits:results.reduce((sum,result)=>sum+(result.report.contactSamples??0),0),
    sliceMisses:results.reduce((sum,result)=>sum+(result.report.uncoveredContactSamples??0),0)};
  summary.inspection=depositionInspection(results);
  if(modulationPreparation.length)summary.modulationGeometry=modulationPreparation;
  const assigned=[...new Set([plan.setup.bambu?.filament,...assignedFilaments(plan)].filter(v=>v!==undefined))];
  const selections=assignedFilaments(plan).length?Object.fromEntries(assigned.map(i=>[i,filamentSelection(plan,machine,i)])):null;
  return planToolpath({start:startupPosition(machine,plan),process,machine,generatorVersion:VERSION,
    selection:selections?.[plan.setup.bambu.filament]??null,selections,
    motion:plan.setup.denso??null,motionBounds:bounds,retracted:startupRetracted(machine,plan)},results,
  {geometryBounds:placed?.bounds??null,rules:plan.composition,prime:!prime,summary,onProgress});
}
