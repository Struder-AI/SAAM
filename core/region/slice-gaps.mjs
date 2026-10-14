import {requireThat,dot,normalize,cross} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';

// Prepared normal thickness or translation advance defines every local gap.
// There is no completed-material query and no technique/surface dispatch.
export function sliceGapCurves(curves,surface,gap){
  requireThat(gap&&((Number.isFinite(gap.normalMm)&&gap.normalMm>0)||(Number.isFinite(gap.advanceMm)&&gap.advanceMm>0&&gap.direction)),'Slice needs an explicit positive gap description.');
  if(gap.normalMm!==undefined)return curves.map(curve=>({...curve,heightMm:gap.normalMm}));
  const direction=normalize(gap.direction),ceiling=gap.bedZMm===null||gap.bedZMm===undefined||direction[2]<=ROUNDING_RELATIVE?null:gap.bedZMm+gap.advanceMm*direction[2];
  return curves.map(curve=>{
    const source=curve.closed?[...curve.chartPoints,curve.chartPoints[0]]:curve.chartPoints;
    const chartPoints=[source[0]],originIndices=[];
    for(let i=1;i<source.length;i++){
      const a=evaluateSurface(surface,source[i-1]).point,b=evaluateSurface(surface,source[i]).point;
      if(ceiling!==null&&(a[2]-ceiling)*(b[2]-ceiling)<0){
        let lo=0,hi=1;
        for(;;){const t=(lo+hi)/2,uv=source[i-1].map((v,k)=>v+t*(source[i][k]-v)),z=evaluateSurface(surface,uv).point[2];
          if(Math.abs(z-ceiling)<=PRINT_RESOLUTION_MM/16||t===lo||t===hi){chartPoints.push(uv);originIndices.push(i-1);break;}
          if((z-ceiling)*(a[2]-ceiling)>0)lo=t;else hi=t;
        }
      }
      chartPoints.push(source[i]);originIndices.push(i-1);
    }
    const samples=chartPoints.map(uv=>evaluateSurface(surface,uv));
    const heights=samples.map(e=>{
      const cosine=dot(e.normal,direction);
      requireThat(cosine>ROUNDING_RELATIVE,'Stack direction is tangent to or reverses across its slice.');
      const advance=ceiling===null?gap.advanceMm:Math.max(0,Math.min(gap.advanceMm,(e.point[2]-gap.bedZMm)/direction[2]));
      return advance*cosine;
    });
    const uniform=Math.max(...heights)-Math.min(...heights)<=PRINT_RESOLUTION_MM/16;
    if(uniform&&heights[0]>0)return {...curve,heightMm:heights[0]};
    const heightsMm=heights.slice(1).map((h,i)=>(h+heights[i])/2);
    // Curve mapping has already sampled curvature. Preserve all process/cell
    // data; the only extra sample is at the bed/full-gap transition.
    return {...curve,closed:false,points:samples.map(e=>e.point),chartPoints,normals:samples.map(e=>e.normal),
      frameSamples:curve.frameSamples?samples.map((e,i)=>{const u=normalize(e.du.map((v,k)=>v-dot(e.du,e.normal)*e.normal[k]));return {point:[...chartPoints[i],0],u,v:cross(e.normal,u),normal:e.normal};}):undefined,heightsMm,
      ...(curve.widthsMm?{widthsMm:originIndices.map(i=>curve.widthsMm[i])}:{}),
      ...(curve.flowMultipliers?{flowMultipliers:originIndices.map(i=>curve.flowMultipliers[i])}:{}),
      segmentMetadata:originIndices.map((index,i)=>({...curve.segmentMetadata?.[index],surfaceNormal:samples[i].normal,normalGapMm:heightsMm[i]}))};
  });
}
