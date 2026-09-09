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
import { PathBuilder } from '../path/builder.mjs';
import { fullFillResult } from '../../skills/full-fill/scripts/fill.mjs';
import { drapedSkinResult, surveySurface, machineMaxAngle, DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {checkMachinePath,toolFor,toolBounds} from '../machine/profile.mjs';
import {planarInfillResults} from '../../skills/planar-infill/scripts/infill.mjs';

export const hasMesh=geometry=>geometry.shape==='mesh'||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry)));

export function buildShell(rhino, geometry) {
  if(geometry.shape==='mesh')return makeMesh(geometry.vertices,geometry.triangles);
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
  if(shell.kind==='triangle-mesh')return translateMesh(shell,dx,dy,dz);
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

export function generatePath(plan, machine, rhino) {
  validatePlan(plan, machine);
  const placed = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const componentShells=plan.geometry.shape==='assembly' ? new Map(plan.geometry.parts.map(part=>[part.id,
    translateShell(buildShell(rhino,part.geometry),plan.placement.xMm+part.xMm,plan.placement.yMm+part.yMm,part.zMm)])) : null;
  const process = plan.process;
  const bounds=toolBounds(machine,plan.setup.tool);
  requireThat(placed.bounds.min.every((v,i)=>v>=bounds.min[i]-1e-8)&&placed.bounds.max.every((v,i)=>v<=bounds.max[i]+1e-8),'Placed geometry exceeds selected tool bounds.');
  const fill = plan.skills['full-fill'], skin = plan.skills['draped-skin'],normal=plan.skills['planar-infill'];

  const builder = new PathBuilder({
    start: [...toolFor(machine,plan.setup.tool).startupXY, (machine.startup.zAfterStartupMm ?? machine.startup.zAfterPrimeMm)],
    process, machine, generatorVersion: VERSION
  });
  builder.setContext('start', 0);
  builder.motionBounds=bounds;
  builder.fan(0);

  const skinShell=componentShells&&skin.part ? componentShells.get(skin.part):placed;
  let survey = null;
  if (skin.enabled) {
    const declaredLimitDeg = machineMaxAngle(machine);
    const effectiveLimitDeg = skin.maxAngleDegOverride ?? declaredLimitDeg;
    survey = surveySurface(skinShell, { ...DRAPED_SKIN_DEFAULTS, ...skin }, effectiveLimitDeg);
    survey.declaredLimitDeg = declaredLimitDeg;
    survey.experimentalOverride = Boolean(machine.nonplanar?.experimental)||(skin.maxAngleDegOverride !== null && skin.maxAngleDegOverride !== declaredLimitDeg);
    requireThat(Number.isFinite(survey.maxMm), 'The top surface survey found no surface to skin.');
  }

  const summary = { generatorVersion: VERSION, shape: plan.geometry.shape };
  const results=[];
  const fillResults=[],normalResults=[];
  for(const [id,shell] of componentShells??[['full-fill',placed]]) {
    const selected=settings=>settings.enabled&&(!componentShells||!settings.parts.length||settings.parts.includes(id));
    const useFill=selected(fill),useNormal=selected(normal);
    requireThat(!(useFill&&useNormal&&fill.mode==='body'),'Full-fill body and planar-infill overlap; select full-fill solid-surfaces mode or separate components.');
    requireThat(!(useFill&&fill.mode==='solid-surfaces'&&!useNormal),'Solid-surface selection requires planar-infill on the same component.');
    if(useNormal){
      const [sparse,solid]=planarInfillResults({shell,plan,reserve:survey,id:componentShells?id+':planar-infill':'planar-infill',solid:useFill});
      results.push(sparse);normalResults.push(sparse);
      if(solid){results.push(solid);fillResults.push(solid);}
    } else if(useFill){const result=fullFillResult({id,shell,plan,reserve:survey});results.push(result);fillResults.push(result);}
  }
  if(fillResults.length){
    summary.fullFill=Object.fromEntries(Object.keys(fillResults[0].report).map(key=>[key,fillResults.reduce((sum,r)=>sum+(r.report[key]??0),0)]));
    summary.fullFill.instances=fillResults.map(r=>({id:r.id,...r.report}));
  }
  if(normalResults.length)summary.planarInfill={instances:normalResults.map(r=>({id:r.id,...r.report}))};
  if(skin.enabled){
    // Every skin operation depends transitively on the ENTIRE supporting body.
    const result=drapedSkinResult({shell:skinShell,plan,machine,survey,after:results.flatMap(r=>r.operations.map(op=>op.id))});
    results.push(result);summary.drapedSkin=result.report;
  }
  builder.planMaxZ=placed.bounds.max[2];
  summary.composition=composeResults(builder,results,plan.composition);

  builder.setContext('finish', 0);
  builder.retract();
  builder.move([builder.position[0], builder.position[1], placed.bounds.max[2] + process.liftMm], process.zSpeedMmS);
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
  const path=builder.toPath(summary);
  path.summary.machineChecks=checkMachinePath(path,plan,machine);
  return path;
}
