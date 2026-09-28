// The surface ribbon of a sleeve: a patch periodic in U whose V chart is
// linear in actual Z, queried by phase around and height.
import {prepareSurfaceRibbon} from './surface-offset.mjs';
import {requireThat} from './tolerance.mjs';

export function prepareSleeveRibbon({patch,rangeMm}){
  requireThat(patch&&Array.isArray(rangeMm)&&rangeMm.length===2&&rangeMm.every(Number.isFinite)&&rangeMm[1]>rangeMm[0],
    'A sleeve ribbon needs a patch and a positive finite height range.');
  const [start,end]=rangeMm,span=end-start,[u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  const ribbon=prepareSurfaceRibbon({patch,periodicU:true});
  const parameters=(phase,z)=>{
    requireThat(Number.isFinite(phase)&&Number.isFinite(z)&&z>=start-1e-9&&z<=end+1e-9,
      'Sleeve ribbon coordinates must be finite and inside its height range.');
    return [u0+((phase%1+1)%1)*(u1-u0),v0+Math.max(0,Math.min(1,(z-start)/span))*(v1-v0)];
  };
  // The ribbon keeps Z, so a sleeve whose V reproduces Z answers at z itself.
  const atHeight=(point,z)=>{
    requireThat(Math.abs(point[2]-z)<=1e-8,'A sleeve ribbon requires patch V to reproduce actual Z.');
    point[2]=z;return point;
  };
  return {offsetPatch:ribbon.offsetPatch,report:ribbon.report,
    at:(phase,z,depth=0)=>atHeight(ribbon.at(...parameters(phase,z),depth),z),
    exactAt:(phase,z,depth=0)=>atHeight(ribbon.exactAt(...parameters(phase,z),depth),z)};
}
