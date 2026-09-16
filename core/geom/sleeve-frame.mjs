// A periodic horizontal specialization of the shared loose/tight surface API.
import {prepareSurfaceOffsets} from './surface-offset.mjs';
import {requireThat} from './tolerance.mjs';

export function prepareLooseSleeveOffsets({patch,rangeMm}){
  requireThat(patch&&Array.isArray(rangeMm)&&rangeMm.length===2&&rangeMm.every(Number.isFinite)&&rangeMm[1]>rangeMm[0],
    'Loose sleeve offsets need a patch and a positive finite height range.');
  const [start,end]=rangeMm,span=end-start,[u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  const offsets=prepareSurfaceOffsets({patch,mode:'horizontal',periodicU:true});
  const frameAt=(phase,z,tightness=0)=>{
    requireThat(Number.isFinite(phase)&&Number.isFinite(z)&&z>=start-1e-9&&z<=end+1e-9,
      'Horizontal sleeve frame coordinates must be finite and inside its height range.');
    const u=u0+((phase%1+1)%1)*(u1-u0),v=v0+Math.max(0,Math.min(1,(z-start)/span))*(v1-v0);
    const frame=offsets.frameAt(u,v,tightness);
    requireThat(Math.abs(frame.point[2]-z)<=1e-8,'Horizontal sleeve frame requires patch V to reproduce actual Z.');
    frame.point[2]=z;return frame;
  };
  return {frameAt,offsetPatch:offsets.offsetPatch,at:(u,z,depth=0,tightness=0)=>{
    requireThat(Number.isFinite(depth),'Horizontal sleeve depth must be finite.');
    const {point,direction}=frameAt(u,z,tightness);return [point[0]+depth*direction[0],point[1]+depth*direction[1],z];
  },report:offsets.report};
}
