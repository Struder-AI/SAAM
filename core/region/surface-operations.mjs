// Surface-owned construction: chart topology retains native units; every
// standoff, stroke width, sampling step and clipping measurement is physical.
import {referencePatch} from '../geom/reference-surface.mjs';
import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {sectionSurface} from '../geom/section.mjs';
import {heightReferenceBounds} from '../geom/height-slice.mjs';
import {clipChartCurveToRegion,clipLineToRegion} from '../geom/curve-region.mjs';
import {requireThat,dot,cross,distance,normalize} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,PROGRAM_STEP_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {offsetRegion} from './offset.mjs';
import {offsetSurfaceRegion,strokeSurfaceRegion,UV_GRID} from './surface-offset.mjs';

export function surfaceChartBounds(surface,points=[],boundsUv=null){
  const native=surface.kind==='patch'?surface.patch:surface;
  if(boundsUv)return boundsUv;
  if(native.domainU&&native.domainV)return [native.domainU,native.domainV];
  if(surface.kind==='slice-chart')return surfaceChartBounds(surface.slice,points);
  if(surface.kind==='height-field'&&!points.length){const b=heightReferenceBounds(surface.reference);return [[b.min[0],b.max[0]],[b.min[1],b.max[1]]];}
  requireThat(points.length,'Unbounded surface operation needs chart points or boundsUv.');
  return [0,1].map(k=>[Math.min(...points.map(p=>p[k])),Math.max(...points.map(p=>p[k]))]);
}

export function surfaceChartStep(surface,boundsUv,stepMm){
  requireThat(Number.isFinite(stepMm)&&stepMm>0,'Surface sampling needs positive physical millimetres.');
  const speeds=[0,0];
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
    const uv=[boundsUv[0][0]+i*(boundsUv[0][1]-boundsUv[0][0])/4,boundsUv[1][0]+j*(boundsUv[1][1]-boundsUv[1][0])/4];
    if(!surfaceChartCovers(surface,uv))continue;
    const e=evaluateSurface(surface,uv);
    requireThat(e.du&&e.dv,'Surface sampling requires first chart derivatives.');
    speeds[0]=Math.max(speeds[0],Math.hypot(...e.du));speeds[1]=Math.max(speeds[1],Math.hypot(...e.dv));
  }
  requireThat(speeds.every(s=>Number.isFinite(s)&&s>0),'Surface sampling metric is singular or uncovered.');
  return speeds.map(s=>stepMm/s);
}

function offsetChart(surface,points,radiusMm,boundsUv){
  const bounds=surfaceChartBounds(surface,points,boundsUv);
  if(surface.kind==='patch')return surface.patch;
  if(surface.cp||surface.kind==='surface-chart'||surface.kind==='sleeve-chart'||surface.kind==='slice-chart')return surface;
  const margin=surface.kind==='plane'?radiusMm+PRINT_RESOLUTION_MM:0;
  const domains=bounds.map(b=>[b[0]-margin,b[1]+margin]);
  requireThat(domains.every(b=>b[1]>b[0]),'Surface offset needs a chart area.');
  return {kind:'slice-chart',slice:surface,domainU:domains[0],domainV:domains[1]};
}

function chartDomainRegion(chart){
  const [u0,u1]=chart.domainU,[v0,v1]=chart.domainV;
  return [[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]];
}
export function offsetSliceRegion(slice,loops,distanceMm,{sampleStepMm=0.2,boundsUv=null,metric='physical',...settings}={}){
  requireThat(metric==='physical'||metric==='projected','Surface offset metric must be physical or projected.');
  requireThat(metric!=='projected'||!slice||slice.kind==='plane'||slice.kind==='height-field','Projected offset needs a millimetre plane or height chart.');
  if(!loops.length)return [];
  if(!slice||slice.kind==='plane'||metric==='projected')return offsetRegion(loops,distanceMm,metric==='physical'?{arcToleranceMm:PRINT_RESOLUTION_MM,...settings}:settings);
  if(distanceMm===0)return loops;
  const chart=offsetChart(slice,loops.flat(),Math.abs(distanceMm),boundsUv);
  const constraintLoopsUv=settings.constraintLoopsUv??(distanceMm>0?chartDomainRegion(chart):null);
  return offsetSurfaceRegion(chart,loops,distanceMm,{...settings,constraintLoopsUv,maxStepMm:sampleStepMm}).loopsUv;
}

export function strokeSliceRegion(slice,paths,radiusMm,{sampleStepMm=0.2,boundsUv=null,...settings}={}){
  if(!paths.length)return {loops:[],report:{method:'geodesic-bands-clipper2',empty:true}};
  const chart=offsetChart(slice,paths.flatMap(p=>p.points),radiusMm,boundsUv),constraintLoopsUv=settings.constraintLoopsUv??(slice.kind==='plane'?null:chartDomainRegion(chart));
  const result=strokeSurfaceRegion(chart,paths,radiusMm,{...settings,constraintLoopsUv,maxStepMm:sampleStepMm});
  return {loops:result.loopsUv,report:result.report};
}

export function intersectSurfaceSheet(slice,sheet,{boundsUv=null,sampleStepMm=0.2,toleranceMm=PRINT_RESOLUTION_MM}={}){
  const patch=sheet?.cp?sheet:referencePatch(sheet);
  requireThat(patch.nu===2&&patch.nv===2&&patch.orderU===2&&patch.orderV===2,'Construction sheet needs a bounded degree-one 2×2 planar spline surface.');
  const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  const corners=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(uv=>evaluateSurface(patch,uv).point);
  const frame=evaluateSurface(patch,[(u0+u1)/2,(v0+v1)/2]);
  requireThat(frame.normal,'Construction sheet requires a regular planar surface.');
  const origin3d=corners[0],normal=frame.normal,xAxis=normalize(frame.du),yAxis=cross(normal,xAxis);
  requireThat(corners.every(point=>Math.abs(dot(normal,point.map((v,k)=>v-origin3d[k])))<=ROUNDING_MM),'Construction sheet must be planar.');
  const project=point=>{const relative=point.map((v,k)=>v-origin3d[k]);return [dot(relative,xAxis),dot(relative,yAxis)];};
  const bounds=surfaceChartBounds(slice,[],boundsUv),cut=sectionSurface(slice,{normal,offset:dot(normal,origin3d)},{boundsUv:bounds,sampleStepMm});
  if(cut.coincident)return {curves:[],report:{method:'surface-plane-section',coincident:true,clipped:true,notes:['Construction sheet coincides with the layer; no unique intersection centerline exists.']}};
  const rectangle=corners.map(project),curves=[];
  for(const chain of cut.chains){
    const state={current:null};
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i],origin=project(a.point),end=project(b.point),direction=end.map((v,k)=>v-origin[k]);
      if(Math.hypot(...direction)<=PROGRAM_STEP_MM)continue;
      const clipped=clipLineToRegion(origin,direction,[rectangle],{range:[0,1]});
      const spans=[...clipped.spans,...clipped.contacts].filter(([lo,hi])=>hi>lo).sort((x,y)=>x[0]-y[0]),merged=[];
      for(const span of spans){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}
      for(const [lo,hi] of merged){
        const first=[a.u+lo*(b.u-a.u),a.v+lo*(b.v-a.v)],last=[a.u+hi*(b.u-a.u),a.v+hi*(b.v-a.v)];
        if(state.current&&distance(evaluateSurface(slice,state.current.at(-1)).point,evaluateSurface(slice,first).point)<=toleranceMm)state.current.push(last);
        else{const points=[first,last];curves.push({closed:false,points});state.current=points;}
      }
    }
  }
  return {curves,report:{method:'surface-plane-section',coincident:false,sampled:!(slice.cp||slice.kind==='patch'||slice.kind==='plane'),sampleStepMm,toleranceMm,uncoveredSamples:cut.uncoveredSamples??0}};
}

function sliceCurveLength(slice,curve){
  const points=curve.closed?[...curve.points,curve.points[0]]:curve.points;
  return points.slice(1).reduce((sum,p,i)=>sum+distance(evaluateSurface(slice,p).point,evaluateSurface(slice,points[i]).point),0);
}

export function clipSliceCurves(slice,curves,region,{precisionUv=UV_GRID,toleranceMm=PRINT_RESOLUTION_MM,sampleStepMm=0.2}={}){
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Surface clipping needs a positive physical tolerance.');
  const bounds=region.length?surfaceChartBounds(slice,region.flat()):null;
  const domain=bounds?[[bounds[0][0],bounds[1][0]],[bounds[0][1],bounds[1][0]],[bounds[0][1],bounds[1][1]],[bounds[0][0],bounds[1][1]]]:null;
  const room=offsetSliceRegion(slice,region,toleranceMm,{sampleStepMm,toleranceMm:toleranceMm/4,arcToleranceMm:toleranceMm/4,precisionMm:PROGRAM_STEP_MM/10,constraintLoopsUv:domain?[domain]:null});
  const result=curves.flatMap(curve=>clipChartCurveToRegion(curve,room,{precisionUv}));
  const before=curves.reduce((sum,c)=>sum+sliceCurveLength(slice,c),0),after=result.reduce((sum,c)=>sum+sliceCurveLength(slice,c),0);
  return {curves:result,report:{clipped:before-after>toleranceMm,removedLengthMm:Math.max(0,before-after),clearanceToleranceMm:toleranceMm,inputCurves:curves.length,outputCurves:result.length,openFragments:result.filter(c=>!c.closed).length}};
}

