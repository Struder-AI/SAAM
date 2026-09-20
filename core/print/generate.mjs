// Generation: locked plan in, SAAMpath out.
//
// The order is fixed by the geometry, not by a further planning step. If a
// draped skin is selected, its survey runs first because it decides how much
// material the planar body must leave under the top surface; the body then
// fills up to that reserved surface, and the skin follows the surface down to
// it. With no skin selected the body simply fills the whole solid.

import { makeShell, assertClosed } from '../geom/shell.mjs';
import { boxShell, wedgeShell, splineTopShell, splineSideShell, verticalSplineSideShell, shellFromSurfaces } from '../geom/shapes.mjs';
import { composeResults } from '../path/compose.mjs';
import { PathBuilder,planarPolicy } from '../path/builder.mjs';
import {primeBeforePart} from '../path/prime.mjs';
import { fullFillResult } from '../../skills/full-fill/scripts/fill.mjs';
import { drapedSkinResult, surveySurface, machineMaxAngle, DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {toolBounds,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {planarInfillResults} from '../../skills/planar-infill/scripts/infill.mjs';
import {vaseWallResult} from '../../skills/vase-wall/scripts/vase.mjs';
import {generateRegionResults,planarSupportTopAt} from './regions.mjs';
import {supportResults} from '../../skills/supports/scripts/supports.mjs';
import {rimmingPlanarResults} from '../../skills/rimming-planar/scripts/rimming.mjs';
import {rimmingNormalResults} from '../../skills/rimming-normal/scripts/rimming.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';
import {pipeCladdingResult,substrateSection,substrateLoops} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {infillStrokes} from '../../skills/planar-infill/scripts/patterns.mjs';
import {splineTubeShell} from '../geom/spline-tube.mjs';
import {publishFinishedBoundary,consumeFinishedSurface} from '../path/finished-surface.mjs';
import {waveResults} from '../../skills/wave-overhangs/scripts/wave.mjs';
import {preparePlasticWeld,plasticWeldResult} from '../../skills/plastic-weld/scripts/weld.mjs';
import {heatSetFeatures,validateHeatSetAssignments} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {heatSetDetails} from '../../skills/heat-set-inserts/scripts/reinforcement.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {lineNetworkResult} from '../../skills/line-network/scripts/network.mjs';

export const hasMesh=geometry=>['mesh','pipe','text','gridfinity','heat-set'].includes(geometry.shape)||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry)));

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
  if(geometry.shape==='spline-tube')return splineTubeShell(rhino,geometry);
  if(geometry.shape==='pipe')return pipeMesh(geometry);
  if(['mesh','text','gridfinity','heat-set'].includes(geometry.shape)){
    const mesh=makeMesh(geometry.vertices,geometry.triangles),features=heatSetFeatures(geometry);
    if(features.length)mesh.planarDetails=heatSetDetails(features);
    return mesh;
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
  if (geometry.shape === 'box') return boxShell(rhino, { xMm: geometry.runMm, yMm: geometry.widthMm, zMm: geometry.heightMm ?? 10 });
  if (geometry.shape === 'wedge') return wedgeShell(rhino, { runMm: geometry.runMm, widthMm: geometry.widthMm, baseMm: geometry.baseMm ?? 2, angleDeg: geometry.angleDeg ?? 15 });
  if (geometry.shape === 'spline-shell') return splineSideShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    longSideInsetMm: geometry.longSideInsetMm, shortSideOutsetMm: geometry.shortSideOutsetMm,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
  if (geometry.shape === 'vertical-spline-shell') return verticalSplineSideShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    xBulgeMm: geometry.xBulgeMm, yInsetMm: geometry.yInsetMm,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
  return splineTopShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
}

// Placement moves the whole shell onto the bed by shifting control points; the
// patches keep their parameterisation, so sections and surface solves are
// unaffected apart from the translation.
export function translateShell(shell, dx, dy, dz = 0) {
  if(shell.kind==='triangle-mesh'){
    const moved=translateMesh(shell,dx,dy,dz);
    if(shell.planarDetails)moved.planarDetails=shell.planarDetails.translated(dx,dy,dz);
    return moved;
  }
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

export function generatePath(plan, machine, rhino, {onProgress} = {}) {
  validatePlan(plan, machine);
  validateHeatSetAssignments(plan);
  const placed = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const componentShells=plan.geometry.shape==='assembly' ? new Map(plan.geometry.parts.map(part=>[part.id,
    translateShell(buildShell(rhino,part.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm)])) : null;
  const process = plan.process;
  const weldSites=preparePlasticWeld({plan,placed,componentShells});
  const bounds=toolBounds(machine,plan.setup.tool);
  requireThat(machine.motionChecks==='deferred'||placed.bounds.min.every((v,i)=>v>=bounds.min[i]-1e-8)&&placed.bounds.max.every((v,i)=>v<=bounds.max[i]+1e-8),'Placed geometry exceeds selected tool bounds.');
  const fill = plan.skills['full-fill'], skin = plan.skills['draped-skin'],normal=plan.skills['planar-infill'],network=plan.skills['line-network'];
  const vase=plan.skills['vase-wall'];
  requireThat(plan.composition.regions.length||!vase.enabled||!skin.enabled||(componentShells&&vase.part!==skin.part),'Vase wall and draped skin overlap on the same component.');

  const builder = new PathBuilder({
    start: startupPosition(machine,plan),
    process, machine, generatorVersion: VERSION,motion:plan.setup.denso??null,tool:plan.setup.tool
  });
  builder.boundsFor=index=>toolBounds(machine,index);
  builder.setContext('start', 0);
  builder.motionBounds=bounds;
  builder.retracted=startupRetracted(machine,plan);
  builder.fan(0);

  const summary = { generatorVersion: VERSION, shape: plan.geometry.shape };
  const results=[];
  let survey = null;
  if(network.enabled){const result=lineNetworkResult({plan,bounds:machine.motionChecks==='deferred'?null:bounds,boundsFor:machine.motionChecks==='deferred'?null:index=>toolBounds(machine,index)});results.push(result);summary.lineNetwork=result.report;}
  else if(plan.composition.regions.length) {
    const selections=geometrySelections(plan.geometry),regionShells=new Map();
    for(const assignment of plan.composition.regions){
      if(regionShells.has(assignment.part))continue;
      const part=selections.get(assignment.part);
      let shell=buildShell(rhino,part.geometry);
      if(part.detailsFrom){
        const features=heatSetFeatures(part.detailsFrom);
        if(features.length)shell.planarDetails=heatSetDetails(features);
      }
      regionShells.set(assignment.part,translateShell(shell,plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm));
    }
    const regional=generateRegionResults({plan,machine,placed,componentShells:regionShells,selections,onProgress});
    results.push(...regional.results);Object.assign(summary,regional.summary);
  } else {
  requireThat(!plan.skills['thick-lip'].enabled,'thick-lip only applies through composition.regions, assigned directly above a level-ended vase-wall region.');
  const skinShell=componentShells&&skin.part ? componentShells.get(skin.part):placed;
  if (skin.enabled) {
    const declaredLimitDeg = machineMaxAngle(machine);
    const effectiveLimitDeg = skin.maxAngleDegOverride ?? declaredLimitDeg;
    survey = surveySurface(skinShell, { ...DRAPED_SKIN_DEFAULTS, ...skin }, effectiveLimitDeg);
    survey.declaredLimitDeg = declaredLimitDeg;
    survey.experimentalOverride = Boolean(machine.nonplanar?.experimental)||(skin.maxAngleDegOverride !== null && skin.maxAngleDegOverride !== declaredLimitDeg);
    requireThat(Number.isFinite(survey.maxMm), 'The top surface survey found no surface to skin.');
  }

  const fillResults=[],normalResults=[];
  const planarSupports=[];
  let vaseShell=null;
  for(const [id,shell] of componentShells??[['full-fill',placed]]) {
    const selected=settings=>settings.enabled&&(!componentShells||!settings.parts.length||settings.parts.includes(id));
    const useFill=selected(fill),useNormal=selected(normal);
    if(useFill||useNormal)planarSupports.push({shell});
    const useVase=vase.enabled&&(!componentShells||vase.part===id);
    let baseTop=null;
    if(useVase) {
      vaseShell=shell;
      requireThat(!useNormal,'Vase wall and planar-infill overlap on the same component.');
      if(useFill) {
        requireThat(fill.mode==='body'&&vase.zStartMm>=process.firstLayerMm,'Full-fill below a vase requires body mode and an explicit positive vase zStartMm for its base.');
        const baseLayers=(vase.zStartMm-process.firstLayerMm)/process.layerMm;
        requireThat(Math.abs(baseLayers-Math.round(baseLayers))<1e-8,'Vase base height must align with the full-fill layer grid.');
        baseTop=shell.bounds.min[2]+vase.zStartMm;
      } else requireThat(vase.zStartMm===0,'A raised vase wall requires full-fill on the same component for its base.');
    }
    requireThat(!(useFill&&useNormal&&fill.mode==='body'),'Full-fill body and planar-infill overlap; select full-fill solid-surfaces mode or separate components.');
    requireThat(!(useFill&&fill.mode==='solid-surfaces'&&!useNormal),'Solid-surface selection requires planar-infill on the same component.');
    if(useNormal){
      const [sparse,solid]=planarInfillResults({shell,plan,machine,reserve:survey,id:componentShells?id+':planar-infill':'planar-infill',solid:useFill,onProgress});
      publishFinishedBoundary(sparse,{shell,coverage:normal.perimeters?'nominal':'sparse'});
      if(solid)publishFinishedBoundary(solid,{shell});
      results.push(sparse);normalResults.push(sparse);
      if(solid){results.push(solid);fillResults.push(solid);}
    } else if(useFill){const clad=plan.skills['pipe-cladding'].enabled&&!plan.skills['pipe-cladding'].surface;const result=fullFillResult({id,shell,plan,machine,reserve:useVase?null:survey,zEndMm:baseTop,onProgress,
      ...(clad?{sectionAt:substrateSection(shell,plan),interiorStrokes:fill.perimeters===0?()=>substrateLoops(plan):region=>infillStrokes(region,{pattern:'concentric',widthMm:process.lineWidthMm,density:1,spacingFactor:fill.spacingFactor})}:{})});
      publishFinishedBoundary(result,{shell,endMm:baseTop??shell.bounds.max[2],coverage:fill.perimeters||fill.spacingFactor<=1?'nominal':'sparse'});
      results.push(result);fillResults.push(result);}
  }
  if(fillResults.length){
    summary.fullFill=Object.fromEntries(Object.keys(fillResults[0].report).map(key=>[key,fillResults.reduce((sum,r)=>sum+(r.report[key]??0),0)]));
    summary.fullFill.instances=fillResults.map(r=>({id:r.id,...r.report}));
  }
  if(normalResults.length)summary.planarInfill={instances:normalResults.map(r=>({id:r.id,...r.report}))};
  if(vase.enabled) {
    requireThat(vaseShell,'No component selected for vase wall.');
    const result=vaseWallResult({shell:vaseShell,plan,machine,id:componentShells?vase.part+':vase-wall':'vase-wall',after:results.flatMap(r=>r.operations.map(op=>op.id)),onProgress});
    if(vase.pattern==null&&!vase.meshSleeve)publishFinishedBoundary(result,{shell:vaseShell,boundary:'side',startMm:result.report.baseTopMm,
      endMm:result.report.endMm-(vase.endTransition==='level'?0:process.layerMm),toleranceMm:vase.boundaryToleranceMm});
    results.push(result);summary.vaseWall=result.report;
  }
  if(skin.enabled){
    // Every skin operation depends transitively on the ENTIRE supporting body.
    const result=drapedSkinResult({shell:skinShell,plan,machine,survey,after:results.flatMap(r=>r.operations.map(op=>op.id)),
      supportTopAt:planarSupports.length?planarSupportTopAt(planarSupports,process):null});
    publishFinishedBoundary(result,{shell:skinShell,boundary:'top',maxSlopeDeg:survey.limitDeg,coverage:skin.spacingFactor>1?'sparse':'nominal'});
    results.push(result);summary.drapedSkin=result.report;
  }
  }
  if(plan.skills['pipe-cladding'].enabled){
    const settings=plan.skills['pipe-cladding'],shell=componentShells?componentShells.get(settings.part):placed;
    const finishedSurface=settings.surface?consumeFinishedSurface({shell,selection:settings.surface,results}):null;
    const result=pipeCladdingResult({plan,shell,finishedSurface,after:finishedSurface?[]:results.flatMap(r=>r.operations.map(op=>op.id))});
    results.push(result);summary.pipeCladding=result.report;
  }
  const waves=waveResults({plan,machine,placed,componentShells,modelResults:results});
  if(waves.length){results.push(...waves);summary.waveOverhangs=waves.map(r=>r.report);}
  const rims=[...rimmingPlanarResults({plan,modelResults:results}),...rimmingNormalResults({plan,modelResults:results})];
  if(rims.length){results.unshift(...rims);summary.rimming=rims.map(r=>r.report);}
  const supports=supportResults({plan,machine,shells:componentShells?[...componentShells.values()]:[placed],modelResults:results});
  if(supports.length){results.unshift(...supports);summary.supports=supports.map(r=>r.report);}
  const welds=plasticWeldResult({plan,sites:weldSites,modelResults:results});
  if(welds){results.push(welds);summary.plasticWeld=welds.report;}
  const prime=primeLineResult(plan,machine);
  if(prime){for(const result of results)for(const op of result.operations)op.after=[...new Set([...(op.after??[]),'prime-line:0'])];results.unshift(prime);summary.primeLine=prime.report;}
  else primeBeforePart(builder,placed.bounds,results);
  summary.composition=composeResults(builder,results,plan.composition,onProgress);

  builder.setContext('finish', 0);
  builder.park();
  builder.fan(0);

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
  return builder.toPath(summary);
}
