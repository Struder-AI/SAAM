// Runtime travel queries are prepared only here, downstream of saved deposition.
export function prepareTravelPolicy(material,process,geometry=[]){
  const options={liftMm:process.liftMm,maxCombMm:material.maxCombMm??process.maxCombMm,lineWidthMm:material.lineWidthMm??process.lineWidthMm};
  if(material.kind==='planar')return planarPolicy(material.loops,{...options,layerZ:material.zMm,maxCombMm:material.coverage==='bounds'?0:options.maxCombMm});
  if(material.kind==='surface'){
    const source=material.surface.reference;
    const resolved=source?.geometryId===undefined?material:{...material,surface:{...material.surface,reference:{kind:'roof',geometry:geometry[source.geometryId]}}};
    const surfaceZ=(x,y)=>materialHeight(resolved,x,y);
    return surfacePolicy(material.loops,{...options,surfaceZ,maxZ:material.maxZ,sampleStepMm:material.sampleStepMm,sagMm:material.sagMm});
  }
  requireThat(material.kind==='bounds','Unknown saved material geometry.');
  const clearance=Math.max(material.approachZ??-Infinity,material.maxZ+process.liftMm);
  return {maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>clearance,
    ...(material.poseJoinMm===undefined?{}:{poseJoinMm:material.poseJoinMm}),...(material.constant?{constantClearanceZ:clearance}:{})};
}

import {requireThat,distance} from '../private/toolpath/numeric.mjs';
// Private runtime travel policies for downstream scheduling.

import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {prepareCombCorners} from './comb.mjs';
import {materialRegion} from './material.mjs';
import {materialHeight} from '../geom/material-envelope.mjs';

import { pointInRegion, pointSegmentDistance, SegmentIndex } from '../region/region2d.mjs';

// Travel policy for one planar layer: comb inside the layer's own outline.
export function planarPolicy(loops, { layerZ, liftMm, maxCombMm, lineWidthMm }) {
  const index=new SegmentIndex(loops,Math.max(lineWidthMm,0.5));
  return {
    combRegion: loops,
    combIndex: index,
    combClearanceMm: lineWidthMm / 2,
    connectClearanceMm: Math.max(0,lineWidthMm/2-0.05),
    combCorners: prepareCombCorners(loops,lineWidthMm/2),
    maxCombMm,
    material: materialRegion(loops,{maxZ:layerZ,index}),
    constantClearanceZ: layerZ + liftMm,
    clearanceFor: () => layerZ + liftMm
  };
}

// Any single-valued XY surface can share the same footprint routing as a flat
// layer. The producer owns height validity, sampling and permitted chord sag.
export function surfacePolicy(loops,{surfaceZ,maxZ,maxCombMm,lineWidthMm,liftMm,sampleStepMm=0.5,sagMm=0}) {
  requireThat(typeof surfaceZ==='function'&&Number.isFinite(sampleStepMm)&&sampleStepMm>0&&Number.isFinite(sagMm)&&sagMm>=0,'Surface travel needs a height query, positive sampling step and nonnegative sag.');
  const index=loops?new SegmentIndex(loops,Math.max(lineWidthMm,0.5)):undefined;
  const heightAlong=(from,to)=>{
    const steps=Math.max(2,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/sampleStepMm));
    let high=-Infinity;
    for(let i=0;i<=steps;i++){
      const t=i/steps,z=surfaceZ(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);
      if(Number.isFinite(z))high=Math.max(high,z);
    }
    return high;
  };
  return {
    combRegion:loops,combIndex:index,
    // Preserve the surface's existing centerline/chord allowance for direct
    // connections. New detours retain the inset used by shared comb routing.
    directClearanceMm:0,combClearanceMm:lineWidthMm/2,combCorners:loops?prepareCombCorners(loops,lineWidthMm/2):undefined,
    combSurfaceZ:surfaceZ,combStepMm:sampleStepMm,maxCombMm,
    ...(loops?{material:materialRegion(loops,{heightAt:surfaceZ,maxZ,sampleStepMm,index})}:{}),
    heightAlong,clearanceFor:(from,to)=>Math.max(from[2],to[2],heightAlong(from,to))+liftMm,
    canTravelDirect:(from,to,limit=maxCombMm)=>{
      const span=Math.hypot(to[0]-from[0],to[1]-from[1]);
      if(!(limit>0)||span>limit)return false;
      const steps=Math.max(2,Math.ceil(span/sampleStepMm));
      for(let i=0;i<=steps;i++){
        const t=i/steps,z=surfaceZ(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);
        if(!Number.isFinite(z)||from[2]+(to[2]-from[2])*t<z-sagMm-PRINT_RESOLUTION_MM)return false;
      }
      return true;
    }
  };
}

export { pointSegmentDistance };
