import {requireThat,dot,normalize} from '../geom/tolerance.mjs';
import {surfaceTangentFrame} from '../geom/surface-frame.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';

// Prepared normal thickness or translation advance defines every local gap.
// There is no completed-material query and no technique/surface dispatch.
export function sliceGapCurves(curves,surface,gap){
  requireThat(gap&&((Number.isFinite(gap.normalMm)&&gap.normalMm>0)||(Number.isFinite(gap.advanceMm)&&gap.advanceMm>0&&gap.direction)),'Slice needs an explicit positive gap description.');
  if(gap.normalMm!==undefined)return curves.map(curve=>({...curve,heightMm:gap.normalMm}));
  const direction=normalize(gap.direction),substrate=gap.substrate??null;
  if(substrate)requireThat(substrate.origin?.length===3&&substrate.origin.every(Number.isFinite)&&substrate.normal?.length===3&&substrate.normal.every(Number.isFinite),'A substrate plane needs a finite origin and normal.');
  const substrateNormal=substrate?normalize(substrate.normal):null,projection=substrateNormal?dot(direction,substrateNormal):0;
  const bounded=substrate&&Math.abs(projection)>ROUNDING_RELATIVE;
  const advanceAt=point=>bounded?Math.max(0,Math.min(gap.advanceMm,
    dot(point.map((v,k)=>v-substrate.origin[k]),substrateNormal)/projection)):gap.advanceMm;
  const boundaryAt=point=>dot(point.map((v,k)=>v-substrate.origin[k]),substrateNormal)-gap.advanceMm*projection;
  return curves.map(curve=>{
    const source=curve.closed?[...curve.chartPoints,curve.chartPoints[0]]:curve.chartPoints;
    const chartPoints=[source[0]],originIndices=[],parameters=Object.fromEntries(['curveParameters','sourceParameters']
      .filter(key=>curve[key]).map(key=>[key,[curve[key][0]]]));
    for(let i=1;i<source.length;i++){
      const a=evaluateSurface(surface,source[i-1]).point,b=evaluateSurface(surface,source[i]).point;
      if(bounded&&boundaryAt(a)*boundaryAt(b)<0){
        let lo=0,hi=1;
        for(;;){const t=(lo+hi)/2,uv=source[i-1].map((v,k)=>v+t*(source[i][k]-v)),value=boundaryAt(evaluateSurface(surface,uv).point);
          if(Math.abs(value)<=PRINT_RESOLUTION_MM/16||t===lo||t===hi){chartPoints.push(uv);originIndices.push(i-1);
            for(const [key,values] of Object.entries(parameters))values.push(curve[key][i-1]+t*((curve[key][i]??1)-curve[key][i-1]));break;}
          if(value*boundaryAt(a)>0)lo=t;else hi=t;
        }
      }
      chartPoints.push(source[i]);originIndices.push(i-1);
      for(const [key,values] of Object.entries(parameters))values.push(curve[key][i]??1);
    }
    const samples=chartPoints.map(uv=>evaluateSurface(surface,uv));
    const heights=samples.map(e=>{
      const cosine=dot(e.normal,direction);
      requireThat(cosine>ROUNDING_RELATIVE,'Stack direction is tangent to or reverses across its slice.');
      const advance=advanceAt(e.point);
      return advance*cosine;
    });
    let low=Infinity,high=-Infinity;for(const height of heights){low=Math.min(low,height);high=Math.max(high,height);}
    const uniform=high-low<=PRINT_RESOLUTION_MM/16;
    if(uniform&&heights[0]>0)return {...curve,heightMm:heights[0]};
    const heightsMm=heights.slice(1).map((h,i)=>(h+heights[i])/2);
    // Preserve process/cell data through nominal-gap and bed subdivisions.
    return {...curve,closed:false,points:samples.map(e=>e.point),chartPoints,normals:samples.map(e=>e.normal),
      ...parameters,
      frameSamples:curve.frameSamples?samples.map((e,i)=>({point:[...chartPoints[i],0],...surfaceTangentFrame(e)})):undefined,heightsMm,
      ...(curve.widthsMm?{widthsMm:originIndices.map(i=>curve.widthsMm[i])}:{}),
      ...(curve.flowMultipliers?{flowMultipliers:originIndices.map(i=>curve.flowMultipliers[i])}:{}),
      segmentMetadata:originIndices.map((index,i)=>({...curve.segmentMetadata?.[index],surfaceNormal:samples[i].normal,normalGapMm:heightsMm[i]}))};
  });
}
