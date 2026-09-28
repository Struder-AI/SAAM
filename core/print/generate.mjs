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
import { drapedSkinResult, surveySurface, machineMaxAngle, DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import {bridgingResult} from '../../skills/bridging/scripts/bridge.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {toolBounds,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {vaseWallResult} from '../../skills/vase-wall/scripts/vase.mjs';
import {prepareRegions,regionBands,generateRegionResults,planarSupportTopAt} from './regions.mjs';
import {sliceResults} from './slices.mjs';
import {supportResults,supportDependencies} from '../../skills/supports/scripts/supports.mjs';
import {surfaceCladdingResult} from '../../skills/pipe-cladding/scripts/surface-clad.mjs';
import {publishFinishedBoundary,consumeFinishedSurface} from '../path/finished-surface.mjs';
import {waveResults} from '../../skills/wave-overhangs/scripts/wave.mjs';
import {preparePlasticWeld,plasticWeldResult} from '../../skills/plastic-weld/scripts/weld.mjs';
import {validateHeatSetAssignments} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {booleanShell} from '../geom/boolean-solid.mjs';
import {lineNetworkResult} from '../../skills/line-network/scripts/network.mjs';

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
  const skin = plan.skills['draped-skin'];
  const vase=plan.skills['vase-wall'];
  requireThat(plan.composition.regions.length||!vase.enabled||!skin.enabled||(componentShells&&vase.part!==skin.part),'Vase wall and draped skin overlap on the same component.');

  return {placed,componentShells,weldSites,bounds};
}

// Geometry volumes named by slice assignments, placed like their part.
export function sliceVolumes(plan,rhino) {
  const selections=geometrySelections(plan.geometry);
  return new Map(plan.slices.assignments.map(assignment=>{
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
  const named=[...new Set(plan.slices.assignments.filter(a=>a.preset!=='support').map(a=>a.part).filter(p=>p!==null&&!componentShells?.has(p)))];
  return [...(componentShells?[...componentShells]:[[null,placed]]).map(([part,shell])=>[part,shell,true]),
    ...named.map(part=>{const s=selections.get(part);return [part,translateShell(buildShell(rhino,s.geometry),plan.placement.xMm+s.xMm,plan.placement.yMm+s.yMm,s.zMm),false];})];
}

// The draped-skin survey of a non-regional recipe: it reserves the skin's
// thickness under the top surface from every planar owner.
export function surveyDrapedSkin(plan,machine,shell) {
  const skin=plan.skills['draped-skin'];
  const declaredLimitDeg=machineMaxAngle(machine),effectiveLimitDeg=skin.maxAngleDegOverride??declaredLimitDeg;
  const survey=surveySurface(shell,{...DRAPED_SKIN_DEFAULTS,...skin},effectiveLimitDeg);
  requireThat(Number.isFinite(survey.maxMm),'The top surface survey found no surface to skin.');
  return {...survey,declaredLimitDeg,experimentalOverride:Boolean(machine.nonplanar?.experimental)||(skin.maxAngleDegOverride!==null&&skin.maxAngleDegOverride!==declaredLimitDeg)};
}

export function generateModelResults(plan,machine,rhino,{placed,componentShells,bounds,weldSites=[]},onProgress) {
  const welds=weldSites.map(site=>site.reservation);
  const process=plan.process,skin=plan.skills['draped-skin'],vase=plan.skills['vase-wall'],network=plan.skills['line-network'];
  const summary = { generatorVersion: VERSION, shape: plan.geometry.shape };
  const results=[];
  let survey=null,regionShells=null,slicedSupports=[];
  const shells=sliceShells(plan,rhino,{placed,componentShells});
  if(network.enabled){const result=lineNetworkResult({plan,bounds:machine.motionChecks==='deferred'?null:bounds});results.push(result);summary.lineNetwork=result.report;}
  else if(plan.composition.regions.length) {
    const selections=geometrySelections(plan.geometry);regionShells=new Map();
    for(const assignment of plan.composition.regions){
      if(regionShells.has(assignment.part))continue;
      const part=selections.get(assignment.part);
      regionShells.set(assignment.part,translateShell(buildShell(rhino,part.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm));
    }
    const records=prepareRegions({plan,machine,placed,componentShells:regionShells,selections});
    const sliced=sliceResults({plan,machine,shells,volumes:sliceVolumes(plan,rhino),bands:regionBands(records),
      reserves:[...records.filter(r=>r.survey).map(r=>r.survey),...welds],envelopes:welds,onProgress});
    const regional=generateRegionResults(records,{plan,machine,sliced:sliced.results,onProgress});
    results.push(...applyResultDependencies(sliced.results,regional.dependencyChanges),...regional.results);
    if(sliced.summary)summary.slices=sliced.summary;
    slicedSupports=sliced.supports;
    Object.assign(summary,regional.summary);
  } else {
  requireThat(!plan.skills['thick-lip'].enabled,'thick-lip only applies through composition.regions, assigned directly above a level-ended vase-wall region.');
  const skinShell=componentShells&&skin.part ? componentShells.get(skin.part):placed;
  if (skin.enabled) survey=surveyDrapedSkin(plan,machine,skinShell);
  const vaseShell=vase.enabled?(componentShells?componentShells.get(vase.part):placed):null;
  requireThat(!vase.enabled||vaseShell,'No component selected for vase wall.');
  // A vase wall claims its part above its start; slices own what is below.
  const bands=vase.enabled?[{part:componentShells?vase.part:null,startMm:vaseShell.bounds.min[2]+vase.zStartMm,endMm:vaseShell.bounds.max[2]}]:[];
  const sliced=sliceResults({plan,machine,shells,volumes:sliceVolumes(plan,rhino),bands,reserves:[...(survey?[survey]:[]),...welds],envelopes:welds,onProgress});
  results.push(...sliced.results);if(sliced.summary)summary.slices=sliced.summary;
  slicedSupports=sliced.supports;
  if(vase.enabled) {
    requireThat(vase.zStartMm===0||sliced.results.some(r=>r.report.part===(componentShells?vase.part:null)&&r.operations.length),'A raised vase wall needs a slice owner of its part for its base.');
    const result=vaseWallResult({shell:vaseShell,plan,machine,id:componentShells?vase.part+':vase-wall':'vase-wall',after:results.flatMap(r=>r.operations.map(op=>op.id)),onProgress});
    const published=vase.pattern==null&&!vase.meshSleeve?publishFinishedBoundary(result,{shell:vaseShell,boundary:'side',startMm:result.report.baseTopMm,
      endMm:result.report.endMm-(vase.endTransition==='level'?0:process.layerMm),toleranceMm:vase.boundaryToleranceMm}):result;
    results.push(published);summary.vaseWall=published.report;
  }
  if(skin.enabled){
    // Every skin operation depends transitively on the ENTIRE supporting body.
    const supports=sliced.results.filter(r=>r.operations.length).map(r=>({shell:shells.find(([part])=>part===r.report.part)[1]}));
    const result=drapedSkinResult({shell:skinShell,plan,machine,survey,after:results.flatMap(r=>r.operations.map(op=>op.id)),
      supportTopAt:supports.length?planarSupportTopAt(supports,process):null});
    const published=publishFinishedBoundary(result,{shell:skinShell,boundary:'top',maxSlopeDeg:survey.limitDeg,coverage:skin.spacingFactor>1?'sparse':'nominal'});
    results.push(published);summary.drapedSkin=published.report;
  }
  }
  if(plan.skills.bridging.enabled){
    const bridge=bridgingResult({plan,modelResults:results,bounds:machine.motionChecks==='deferred'?null:bounds});
    results.push(bridge);summary.bridging=bridge.report;
  }
  return {results,summary,survey,slicedSupports,...(regionShells?{regionShells}:{})};
}

export function addComplementaryResults(plan,machine,{placed,componentShells,weldSites},batch) {
  const results=[...batch.results],summary={...batch.summary};
  if(plan.skills['pipe-cladding'].enabled){
    const settings=plan.skills['pipe-cladding'],shell=batch.regionShells?.get(settings.part)??(componentShells?componentShells.get(settings.part):placed);
    const finishedSurface=settings.surface?consumeFinishedSurface({shell,selection:settings.surface,results}):null;
    const result=surfaceCladdingResult({plan,shell,finishedSurface,after:finishedSurface?[]:results.flatMap(r=>r.operations.map(op=>op.id))});
    results.push(result);summary.pipeCladding=result.report;
  }
  const waves=waveResults({plan,machine,placed,componentShells,modelResults:results});
  const wavedResults=[...applyResultDependencies(results,waves.dependencyChanges),...waves.results];
  if(waves.results.length)summary.waveOverhangs=waves.results.map(r=>r.report);
  // Support-preset slices and tree supports print before what they hold up.
  const supports=[...(batch.slicedSupports??[]),...supportResults({plan,machine,shells:componentShells?[...componentShells.values()]:[placed]})];
  const supportedResults=[...supports,...applyResultDependencies(wavedResults,supportDependencies(supports,wavedResults))];
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
  if (survey) summary.nonplanarLimit = {
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
