// Surface-owned construction: chart topology retains native units; every
// standoff, stroke width, sampling step and clipping measurement is physical.
import {affineSurface} from '../geom/affine-surface.mjs';
import {referencePatch} from '../geom/reference-surface.mjs';
import {surfacePlane} from '../geom/surface-coincidence.mjs';
import {faceTrimRegion,planarFaceRegion} from '../geom/surface-trim.mjs';
import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {sectionSurface} from '../geom/section.mjs';
import {heightReferenceBounds} from '../geom/height-slice.mjs';
import {clipChartCurveToRegion,clipLineToRegion} from '../geom/curve-region.mjs';
import {requireThat,dot,cross,distance,normalize} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,PROGRAM_STEP_MM} from '../dimensions.mjs';
import {offsetRegion} from './offset.mjs';
import {intersect,union,difference,clipOpenPaths} from './intersection.mjs';
import {pointInRegion,pointSegmentDistance} from './region2d.mjs';
import {sampledChartRegion} from '../geom/height-slice.mjs';
import {offsetSurfaceRegion,strokeSurfaceRegion,prepareSurfaceOffset,UV_GRID} from './surface-offset.mjs';

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
  return offsetSurfaceRegion(chart,loops,distanceMm,{...settings,constraintLoopsUv}).loopsUv;
}

export function strokeSliceRegion(slice,paths,radiusMm,{sampleStepMm=0.2,boundsUv=null,...settings}={}){
  if(!paths.length)return {loops:[],report:{method:'geodesic-bands-clipper2',empty:true}};
  const chart=offsetChart(slice,paths.flatMap(p=>p.points),radiusMm,boundsUv),constraintLoopsUv=settings.constraintLoopsUv??(slice.kind==='plane'?null:chartDomainRegion(chart));
  const result=strokeSurfaceRegion(chart,paths,radiusMm,{...settings,constraintLoopsUv});
  return {loops:result.loopsUv,report:result.report};
}

const sheetRegions=new WeakMap();
function preparedSheet(sheet,toleranceMm){
  if(!sheetRegions.has(sheet))sheetRegions.set(sheet,new Map());
  const cached=sheetRegions.get(sheet);
  if(cached.has(toleranceMm))return cached.get(toleranceMm);
  const patch=sheet?.cp?sheet:{...referencePatch(sheet),...(sheet.trimLoops?{trimLoops:sheet.trimLoops}:{})},plane=surfacePlane(patch);
  requireThat(plane,'Construction sheet must be a bounded planar spline surface.');
  const middle=[patch.domainU,patch.domainV].map(([a,b])=>(a+b)/2),frame=evaluateSurface(patch,middle);
  const origin3d=plane.point,normal=plane.normal,xAxis=normalize(frame.du),yAxis=cross(normal,xAxis);
  const project=point=>{const relative=point.map((v,k)=>v-origin3d[k]);return [dot(relative,xAxis),dot(relative,yAxis)];};
  const region=union(planarFaceRegion(patch,faceTrimRegion(patch,{toleranceMm}),{origin:origin3d,x:xAxis,y:yAxis},toleranceMm),[]);
  const result={origin3d,normal,xAxis,yAxis,project,region};cached.set(toleranceMm,result);return result;
}
export function intersectSurfaceSheet(slice,sheet,{boundsUv=null,sampleStepMm=0.2,toleranceMm=PRINT_RESOLUTION_MM,parallelBandMm=0}={}){
  requireThat(Number.isFinite(parallelBandMm)&&parallelBandMm>=0,'Parallel sheet coverage needs a nonnegative physical half-thickness.');
  const prepared=preparedSheet(sheet,toleranceMm),{normal,xAxis,yAxis,project,region}=prepared;
  const bounds=surfaceChartBounds(slice,[],boundsUv);let origin3d=prepared.origin3d;
  // A physical sheet band supplies area only on proven parallel planar charts;
  // crossing surfaces always retain their actual zero-thickness intersection.
  if(parallelBandMm){
    const native=slice.patch??slice,plane=affineSurface(slice)?evaluateSurface(slice,bounds.map(([lo,hi])=>(lo+hi)/2)):native.cp?surfacePlane(native):null;
    if(plane&&Math.abs(Math.abs(dot(normal,plane.normal))-1)<=Number.EPSILON*64){
      const distanceMm=dot(normal,plane.point.map((v,k)=>v-origin3d[k]));
      if(Math.abs(distanceMm)<=parallelBandMm)origin3d=origin3d.map((v,k)=>v+distanceMm*normal[k]);
    }
  }
  const cut=sectionSurface(slice,{normal,offset:dot(normal,origin3d)},{boundsUv:bounds,sampleStepMm});
  const curves=[];
  if(cut.coincident){
    const domain=[[bounds[0][0],bounds[1][0]],[bounds[0][1],bounds[1][0]],[bounds[0][1],bounds[1][1]],[bounds[0][0],bounds[1][1]]];
    let regionsUv;
    if(slice.kind==='plane'){
      const loops=region.map(loop=>loop.map(uv=>{
        const point=origin3d.map((v,k)=>v+uv[0]*xAxis[k]+uv[1]*yAxis[k]),delta=point.map((v,k)=>v-slice.origin[k]);
        return [dot(delta,slice.xAxis),dot(delta,slice.yAxis)];
      }));
      regionsUv=intersect(loops,[domain]);
    }else regionsUv=sampledChartRegion({min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])},surfaceChartStep(slice,bounds,sampleStepMm),uv=>
      surfaceChartCovers(slice,uv)&&pointInRegion(project(evaluateSurface(slice,uv).point),region),{surface:slice});
    return {curves:[],regionsUv,report:{method:'surface-sheet-area',coincident:true,sampled:slice.kind!=='plane',sampleStepMm,toleranceMm}};
  }
  for(const chain of cut.chains){
    const state={current:null};
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i],origin=project(a.point),end=project(b.point),direction=end.map((v,k)=>v-origin[k]);
      if(Math.hypot(...direction)<=PROGRAM_STEP_MM)continue;
      const clipped=clipLineToRegion(origin,direction,region,{range:[0,1]});
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


// Physical parallel rows: the affine case is an exact line translation;
// curved fronts advance through the same intrinsic offset owner as perimeters.
export function parallelSliceRows(surface,region,{spacingMm,angleDeg=0,direction=null,sampleStepMm=.2,toleranceMm=.01}={}){
  requireThat(Number.isFinite(spacingMm)&&spacingMm>0,'Surface rows need positive physical spacing.');
  if(!region.length)return {rows:[],report:{offsets:0}};
  const points=region.flat(),extent=[0,1].map(k=>points.reduce(([lo,hi],p)=>[Math.min(lo,p[k]),Math.max(hi,p[k])],[Infinity,-Infinity]));
  let center=extent.map(([lo,hi])=>(lo+hi)/2);
  if(!surfaceChartCovers(surface,center))center=points[0];
  const frame=evaluateSurface(surface,center),normal=normalize(direction??frame.normal);
  const axis=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0],x=normalize(axis.map((v,k)=>v-dot(axis,normal)*normal[k])),y=cross(normal,x),angle=angleDeg*Math.PI/180;
  const projected=x.map((v,k)=>v*Math.cos(angle)+y[k]*Math.sin(angle)),along=normalize(projected.map((v,k)=>v-dot(projected,frame.normal)*frame.normal[k])),across=normalize(cross(frame.normal,along));
  if(affineSurface(surface)){
    const a=dot(across,frame.du),b=dot(across,frame.dv),length2=a*a+b*b,constant=dot(across,frame.point)-a*center[0]-b*center[1];
    const positions=points.map(uv=>constant+a*uv[0]+b*uv[1]),first=Math.floor(Math.min(...positions)/spacingMm),last=Math.ceil(Math.max(...positions)/spacingMm),rows=[];
    for(let lineIndex=first;lineIndex<=last;lineIndex++){
      const c=constant-lineIndex*spacingMm,origin=[-c*a/length2,-c*b/length2],tangent=[-b,a];
      rows.push({lineIndex,paths:clipLineToRegion(origin,tangent,region).spans.map(span=>span.map(t=>origin.map((v,k)=>v+t*tangent[k])))});
    }
    return {rows,along,report:{method:'analytic-affine-surface-offset',offsets:0}};
  }
  const global=surfaceChartBounds(surface,points),margin=surfaceChartStep(surface,extent,spacingMm);
  const bounds=extent.map(([lo,hi],k)=>[Math.max(global[k][0],lo-margin[k]),Math.min(global[k][1],hi+margin[k])]);
  let chart=offsetChart(surface,points,spacingMm,global);
  const rectangle=[[[bounds[0][0],bounds[1][0]],[bounds[0][1],bounds[1][0]],[bounds[0][1],bounds[1][1]],[bounds[0][0],bounds[1][1]]]];
  const options={precisionMm:UV_GRID,origin:[global[0][0],global[1][0]]};
  const prepared=prepareSurfaceOffset(chart,[],0,{toleranceMm,constraintLoopsUv:rectangle});
  if(prepared.atlas)chart={...chart,atlas:prepared.atlas};
  const allowed=prepared.atlas?intersect(rectangle,union(prepared.atlas.faces.map(face=>face.vertices.map(v=>v.uv)),[],options),options):rectangle;
  const target=intersect(region,allowed,options),positions=target.flat().map(uv=>dot(across,evaluateSurface(chart,uv).point));
  if(!target.length)return {rows:[],along,report:{offsets:0}};
  const seedOffset=(Math.min(...positions)+Math.max(...positions))/2;
  // Only the initial heading is a plane cut. Its region is construction input;
  // all later rows are physical offsets, without repeated world-plane sections.
  const seed=intersect(sampledChartRegion({min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])},surfaceChartStep(chart,bounds,sampleStepMm),uv=>{
    const bounded=uv.map((v,k)=>Math.max(bounds[k][0],Math.min(bounds[k][1],v)));
    return surfaceChartCovers(chart,bounded)&&dot(across,evaluateSurface(chart,bounded).point)<=seedOffset;
  },{surface:chart,precisionUv:UV_GRID}),allowed,options);
  const edges=allowed.flatMap(loop=>loop.map((p,i)=>[p,loop[(i+1)%loop.length]])),slack=UV_GRID*8;
  const onEdge=(a,b)=>edges.some(([p,q])=>pointSegmentDistance(a,p,q)<=slack&&pointSegmentDistance(b,p,q)<=slack);
  const fronts=loops=>{
    const paths=[];
    for(const loop of loops){
      const boundary=loop.findIndex((p,i)=>onEdge(p,loop[(i+1)%loop.length]));
      if(boundary<0){paths.push([...loop,loop[0]]);continue;}
      let path=[];
      for(let j=1;j<=loop.length;j++){
        const i=(boundary+j)%loop.length,a=loop[i],b=loop[(i+1)%loop.length];
        if(onEdge(a,b)){if(path.length>1)paths.push(path);path=[];}
        else{if(!path.length)path.push(a);path.push(b);}
      }
      if(path.length>1)paths.push(path);
    }
    return clipOpenPaths(paths,target,options);
  };
  const rows=[{lineIndex:0,paths:fronts(seed)}],report={method:'geodesic-surface-offset-rows',offsets:0,evaluations:0,integrationSteps:0};
  for(const sign of [-1,1]){
    let source=sign===1?seed:difference(allowed,seed,options),lineIndex=0;
    while(difference(target,source,options).length){
      const result=offsetSurfaceRegion(chart,source,spacingMm,{toleranceMm,constraintLoopsUv:allowed});
      report.offsets++;report.evaluations+=result.report.evaluations;report.integrationSteps+=result.report.integrationSteps;
      if(!difference(result.loopsUv,source,options).length){
        // Integer topology can retain long, subresolution boundary slivers.
        // Only an actually resolvable remainder warrants a progress failure.
        const remainder=difference(target,source,options);
        const unresolved=offsetSurfaceRegion(chart,remainder,-toleranceMm,{toleranceMm}).loopsUv;
        requireThat(!unresolved.length,'Surface row offset cannot advance over the remaining chart region.');
        report.subresolutionRemainders=(report.subresolutionRemainders??0)+remainder.length;break;
      }
      source=result.loopsUv;lineIndex+=sign;rows.push({lineIndex,paths:fronts(source)});
    }
  }
  rows.sort((a,b)=>a.lineIndex-b.lineIndex);
  return {rows,along,report};
}
