import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,distance,normalize,cross} from '../private/toolpath/numeric.mjs';

import {evaluateCurve} from '../geom/nurbs.mjs';

import {heightReferenceBounds} from '../geom/height-slice.mjs';
import {transportCurveFrames} from './curve-frame.mjs';
import {strokeRange} from './deposition.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {beadWidthRule,parallelBeadCurves} from './parallel-curves.mjs';
import {strokeSurfaceRegion} from '../region/surface-offset.mjs';
import {interpolatePose} from './pose.mjs';
import {unitDirection as unit,dot} from '../geom/frame.mjs';
import {piecewiseChart,piecewiseChartFrame,mapPiecewiseChartPath,splitPiecewiseChartPath} from '../geom/piecewise-chart.mjs';

const vec=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);
export function authoredNurbs(record,dimension=3){
  requireThat(record&&Object.keys(record).every(k=>['degree','knots','controlPoints','weights'].includes(k)),'Unexpected NURBS curve fields.');
  const {degree,knots,controlPoints,weights}=record;
  requireThat(Number.isInteger(degree)&&degree>=1&&Array.isArray(controlPoints)&&controlPoints.length>degree&&controlPoints.every(p=>vec(p,dimension)),'NURBS needs a degree and finite control points.');
  const n=controlPoints.length,order=degree+1;
  requireThat(Array.isArray(knots)&&knots.length===n+order&&knots.every((k,i)=>Number.isFinite(k)&&(!i||k>=knots[i-1]))&&knots[n]>knots[degree],'NURBS needs a full increasing knot domain.');
  requireThat(weights===undefined||Array.isArray(weights)&&weights.length===n&&weights.every(w=>Number.isFinite(w)&&w>0),'NURBS weights must be positive.');
  return {n,order,knots:Float64Array.from(knots),domain:[knots[degree],knots[n]],cp:Float64Array.from(controlPoints.flatMap((p,i)=>{const w=weights?.[i]??1;return [p[0]*w,p[1]*w,(p[2]??0)*w,w];}))};
}

export function validateCurveProfiles(vary){
  if(vary===undefined)return;
  requireThat(vary&&Object.keys(vary).every(k=>['beadWidthMm','heightMm','flowMultiplier','speedMmS'].includes(k)),'Unknown curve parameter profile; pose comes from optional Slice output and field modulation.');
  for(const [key,values] of Object.entries(vary))requireThat(Array.isArray(values)&&values.length>=2&&values[0][0]===0&&values.at(-1)[0]===1&&values.every((p,i)=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&(!i||p[0]>values[i-1][0])&&Number.isFinite(p[1])&&p[1]>0),`Curve ${key} profile needs increasing [t,value] pairs spanning 0..1.`);
}
export function curveProfile(values,t,fallback){
  if(!values)return fallback;
  let i=1;while(i<values.length-1&&values[i][0]<t)i++;
  const [a,x]=values[i-1],[b,y]=values[i],s=(t-a)/(b-a);
  return Array.isArray(x)?x.map((v,k)=>v+(y[k]-v)*s):x+(y-x)*s;
}

function referenceEntry(reference,references,course){
  const key=reference.kind==='patch'?`patch:${reference.part??''}:${reference.name}`:`${reference.kind}:${reference.assignment}`;
  const found=references?.[key];requireThat(found,`Curve reference ${key} is unavailable.`);
  if(reference.kind==='slice'){
    const index=reference.index??course,layer=found.layers?.find(l=>l.index===index);
    requireThat(layer,`Curve reference ${key} has no layer ${index}.`);return layer.slice;
  }
  return found.patch??{kind:'sleeve-chart',layers:found.layers,domainU:[0,1],domainV:[0,found.layers.length-1]};
}
// Native t is normalized over the active knot domain; polylines use cumulative
// source chord length. Refinement retains profile knots and native knot spans.
function authoredSegment(lengths,distanceMm){
  let lo=1,hi=lengths.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(lengths[mid]<distanceMm)lo=mid+1;else hi=mid;}
  return lo;
}
export function sampleAuthoredCurve(curve,{references={},course=0,offset=[0,0,0],toleranceMm=.02,sampleStepMm=1}={}){
  const input=curve.uv??curve,dimension=curve.uv?2:3,native=input.nurbs?authoredNurbs(input.nurbs,dimension):null;
  const points=input.points,entry=curve.uv?referenceEntry(input.reference,references,course):null;
  if(native&&curve.closed)requireThat(distance(evaluateCurve(native,native.domain[0]).point,evaluateCurve(native,native.domain[1]).point)<1e-7,'Closed NURBS must meet at their domain endpoints.');
  const source=native?null:(curve.closed?[...points,points[0]]:points),lengths=[0];
  if(source)for(let i=1;i<source.length;i++)lengths.push(lengths.at(-1)+Math.hypot(...source[i].map((x,k)=>x-source[i-1][k])));
  const local=t=>{if(native)return evaluateCurve(native,native.domain[0]+t*(native.domain[1]-native.domain[0])).point.slice(0,dimension);const d=t*lengths.at(-1),i=authoredSegment(lengths,d),f=(d-lengths[i-1])/(lengths[i]-lengths[i-1]);return source[i-1].map((v,k)=>v+(source[i][k]-v)*f);};
  const at=t=>{const chart=local(t),e=entry?evaluateSurface(entry,chart,input.normalMm??0):{point:chart};requireThat(!entry||e.normal,'Curve reference has a singular tangent.');return {t,chart,...e,point:e.point.map((v,i)=>v+offset[i])};};
  const breaks=[0,1,...(native?[...native.knots].filter(k=>k>native.domain[0]&&k<native.domain[1]).map(k=>(k-native.domain[0])/(native.domain[1]-native.domain[0])):lengths.map(l=>l/lengths.at(-1))),...Object.values(curve.vary??{}).flatMap(v=>v.map(p=>p[0]))];
  const samples=sampleCurveIntervals({at,cuts:breaks,stepMm:curve.sampleStepMm??sampleStepMm,toleranceMm:curve.toleranceMm??toleranceMm,
    chartSteps:curve.uv?.reference.kind==='sleeve'?[.125,.25]:[]});
  const {nurbs,uv,vary,courses,widthRule,toleranceMm:tol,sampleStepMm:maxStep,...properties}=curve;
  const result={...properties,role:curve.role??'curve',closed:false,points:samples.map(s=>s.point),curveParameters:samples.map(s=>s.t)};
  if(curve.segmentMetadata)result.segmentMetadata=samples.slice(1).map((sample,i)=>{
    const d=(sample.t+samples[i].t)/2*lengths.at(-1),segment=authoredSegment(lengths,d);
    return {...curve.segmentMetadata[segment-1]};
  });
  if(samples[0].normal){result.frameSamples=samples.map(s=>{
    const n=s.normal,tangent=s.du;
    const u=normalize(tangent.map((v,i)=>v-dot(tangent,n)*n[i]));return {point:[...s.chart,input.normalMm??0],u,v:cross(n,u),normal:n};
  });result.segmentMetadata=samples.slice(1).map((s,i)=>({...result.segmentMetadata?.[i],surfaceNormal:samples[i].normal}));}
  return applyCurveProfiles(result,curve);
}

export function applyCurveProfiles(input,curve){
  const vary=curve.vary;
  if(!vary)return {...input};
  const source=input.closed?strokeRange(input):input;
  // Parallel construction changes the source parameter spacing and can reverse
  // it. Split at every crossed profile knot before assigning segment values;
  // geometry-only subdivision must not erase a process change.
  const knots=[...new Set(Object.values(vary).flatMap(values=>values.map(([t])=>t)))];
  const positions=[{segment:0,fraction:0}];
  for(let i=1;i<source.points.length;i++){
    const a=source.curveParameters[i-1],b=source.curveParameters[i];
    const cuts=knots.filter(t=>t>Math.min(a,b)&&t<Math.max(a,b)).map(t=>(t-a)/(b-a)).sort((a,b)=>a-b);
    positions.push(...cuts.map(fraction=>({segment:i-1,fraction})),{segment:i-1,fraction:1});
  }
  const mix=(a,b,t)=>a.map((x,k)=>x+t*(b[k]-x));
  const result={...source,points:positions.map(({segment:i,fraction:t})=>mix(source.points[i],source.points[i+1],t)),
    curveParameters:positions.map(({segment:i,fraction:t})=>source.curveParameters[i]+t*(source.curveParameters[i+1]-source.curveParameters[i]))};
  for(const key of ['widthsMm','heightsMm','flowMultipliers','segmentMetadata'])if(source[key])result[key]=positions.slice(1).map(({segment})=>source[key][segment]);
  for(const key of ['normals','chartPoints','referenceAlong'])if(source[key])result[key]=positions.map(({segment:i,fraction:t})=>{
    const value=mix(source[key][i],source[key][i+1],t);return key==='normals'?unit(value):value;
  });
  if(source.poses)result.poses=positions.map(({segment:i,fraction:t})=>interpolatePose(source.poses[i],source.poses[i+1],t));
  if(source.frameSamples)result.frameSamples=positions.map(({segment:i,fraction:t})=>{
    const a=source.frameSamples[i],b=source.frameSamples[i+1],normal=unit(mix(a.normal,b.normal,t)),v=unit(cross(normal,unit(mix(a.u,b.u,t))));
    return {point:mix(a.point,b.point,t),u:unit(cross(v,normal)),v,normal};
  });
  const samples=result.points.map((point,i)=>({point,t:result.curveParameters[i],normal:result.frameSamples?.[i]?.normal}));
  if(vary){
    if(vary.beadWidthMm)result.widthsMm=samples.slice(1).map((s,i)=>curveProfile(vary.beadWidthMm,(s.t+samples[i].t)/2));
    if(vary.heightMm)result.heightsMm=samples.slice(1).map((s,i)=>curveProfile(vary.heightMm,(s.t+samples[i].t)/2));
    if(vary.flowMultiplier)result.flowMultipliers=samples.slice(1).map((s,i)=>curveProfile(vary.flowMultiplier,(s.t+samples[i].t)/2));
    result.segmentMetadata=samples.slice(1).map((s,i)=>({...result.segmentMetadata?.[i],...samples[i].normal?{surfaceNormal:samples[i].normal}:{},...vary.speedMmS?{speedMmS:curveProfile(vary.speedMmS,(s.t+samples[i].t)/2)}:{}}));
  }
  return result;
}

function sampleRoundedCurve(curve,options,chart){
  const source=sampleAuthoredCurve({...curve,vary:undefined,uv:{...curve.uv,normalMm:0}},options);
  const path=mapPiecewiseChartPath(chart,{points:source.frameSamples.map(f=>f.point.slice(0,2)),parameters:source.curveParameters});
  if(curve.closed){
    const first=[...path.points[0]],last=path.points.at(-1);if(chart.periodic)first[0]+=Math.round(last[0]-first[0]);
    if(distance(first,last)>1e-12){path.points.push(first);path.parameters.push(1);}
  }
  return samplePiecewiseCurve(source,chart,path,{...options,toleranceMm:curve.toleranceMm??options.toleranceMm,sampleStepMm:curve.sampleStepMm??options.sampleStepMm});
}

// Piece addresses are internal; frame locations retain original authored UV.
// Added round segments hold their source parameter at the crease crossing.
function samplePiecewiseCurve(source,chart,path,{offset=[0,0,0],toleranceMm=.02,sampleStepMm=1}={}){
  const split=splitPiecewiseChartPath(chart,path),samples=[];
  for(let i=1;i<split.points.length;i++){
    const a=split.points[i-1],b=split.points[i],hint=a.map((v,k)=>(v+b[k])/2);
    const at=t=>{const uv=a.map((v,k)=>v+t*(b[k]-v)),frame=piecewiseChartFrame(chart,uv,hint);return {point:frame.point.map((v,k)=>v+offset[k]),uv,frame,parameter:split.parameters[i-1]+t*(split.parameters[i]-split.parameters[i-1])};};
    const piece=sampleCurveIntervals({at,stepMm:sampleStepMm,toleranceMm});samples.push(...piece.slice(samples.length?1:0));
  }
  const frameSamples=samples.map(({frame})=>{const u=normalize(frame.du),normal=frame.normal;return {point:[...frame.baseUv,chart.normalMm],u,v:cross(normal,u),normal};});
  return {...source,closed:false,points:samples.map(s=>s.point),chartPoints:samples.map(s=>s.uv),curveParameters:samples.map(s=>s.parameter),frameSamples,
    segmentMetadata:samples.slice(1).map((_,i)=>({surfaceNormal:frameSamples[i].normal})),frameReport:{method:chart.method,toleranceMm:chart.toleranceMm,roundSegments:chart.roundSegments}};
}


// Parallel geometry precedes process profiles. Each offset point carries the
// closest source segment's authored parameter, so NURBS t does not become arc
// length when a wide stroke is lowered to several beads.
export function constructAuthoredCurves(curve,options={}){
  let offsetChart=null,offsetDescriptor=null;
  if(curve.uv?.normalMm){
    const entry=referenceEntry(curve.uv.reference,options.references,options.course??0);
    if(entry.layers||entry.reference?.kind==='roof'){
      const bounds=entry.kind==='height-field'?heightReferenceBounds(entry.reference):null;
      offsetDescriptor=entry.layers?{kind:'sleeve-chart',layers:entry.layers,domainU:[0,1],domainV:[0,entry.layers.length-1]}:{kind:'slice-chart',slice:entry,domainU:[bounds.min[0],bounds.max[0]],domainV:[bounds.min[1],bounds.max[1]]};
      offsetChart=piecewiseChart(offsetDescriptor,{normalMm:curve.uv.normalMm,toleranceMm:(curve.toleranceMm??options.toleranceMm??.02)/4});
      offsetDescriptor={...offsetDescriptor,atlas:offsetChart};
    }
  }
  if(!curve.widthRule)return [offsetChart?applyCurveProfiles(sampleRoundedCurve(curve,options,offsetChart),curve):sampleAuthoredCurve(curve,options)];
  const construction=beadWidthRule(curve.widthRule),plain={...curve,vary:undefined,widthRule:undefined};
  const source=offsetChart?sampleRoundedCurve(plain,options,offsetChart):sampleAuthoredCurve(plain,options);
  if(construction.parallelCount===1)return [applyCurveProfiles({...source,beadWidthMm:construction.beadWidthMm},curve)];
  let paths=[];
  if(curve.uv){
    const entry=referenceEntry(curve.uv.reference,options.references,options.course??0);
    const heightBounds=entry.kind==='height-field'?heightReferenceBounds(entry.reference):null;
    const patch=offsetDescriptor??(entry.cp?entry:entry.patch)??(heightBounds?{kind:'slice-chart',slice:entry,domainU:[heightBounds.min[0],heightBounds.max[0]],domainV:[heightBounds.min[1],heightBounds.max[1]]}:entry.layers?entry:null);
    if(entry.kind==='plane'){
      const plane=entry;
      paths=parallelBeadCurves({...source,curveParameters:undefined},curve.widthRule).map(c=>{
        const mapped=sampleAuthoredCurve({...plain,uv:undefined,points:c.points,closed:c.closed},{...options,offset:[0,0,0]});
        return {...mapped,frameSamples:mapped.points.map(p=>{const d=p.map((x,k)=>x-plane.origin[k]-(options.offset?.[k]??0));return {point:[dot(d,plane.xAxis),dot(d,plane.yAxis),curve.uv.normalMm??0],u:plane.xAxis,v:plane.yAxis,normal:plane.normal};})};
      });
    }else{
    requireThat(patch,'Parallel surface curves require a native patch, plane or height-field chart.');
    const chartPoints=offsetChart?source.chartPoints:source.frameSamples.map(f=>f.point.slice(0,2));
    for(let k=0;k<Math.ceil(construction.parallelCount/2);k++){
      const radius=(construction.parallelCount-1)*construction.pitchMm/2-k*construction.pitchMm;
      if(radius<=1e-9){paths.push(source);continue;}
      const region=strokeSurfaceRegion(patch,[{closed:false,points:chartPoints}],radius,{toleranceMm:curve.toleranceMm??.02,maxStepMm:curve.sampleStepMm??1,normalMm:curve.uv.normalMm??0});
      paths.push(...region.loopsUv.map(points=>offsetChart?samplePiecewiseCurve({...source,closed:false},offsetChart,{points,closed:true},options):sampleAuthoredCurve({...plain,closed:true,uv:{...curve.uv,nurbs:undefined,points}},options)));
    }
    }
  }else paths=parallelBeadCurves({...source,curveParameters:undefined},curve.widthRule).map(c=>sampleAuthoredCurve({...plain,nurbs:undefined,points:c.points,closed:c.closed,beadWidthMm:construction.beadWidthMm,frameReport:c.frameReport},{...options,offset:[0,0,0]}));
  const parameterAt=point=>{
    let best=Infinity,parameter=0,segment=0,fraction=0;
    for(let i=1;i<source.points.length;i++){
      const a=source.points[i-1],b=source.points[i],v=b.map((x,k)=>x-a[k]),d=point.map((x,k)=>x-a[k]),length2=dot(v,v),t=length2?Math.max(0,Math.min(1,dot(d,v)/length2)):0;
      const error=distance(point,a.map((x,k)=>x+t*v[k]));if(error<best){best=error;segment=i-1;fraction=t;parameter=source.curveParameters[i-1]+t*(source.curveParameters[i]-source.curveParameters[i-1]);}
    }
    return {parameter,segment,fraction};
  };
  const transported=paths.some(p=>p.frameReport)?transportCurveFrames(source.points,{closed:curve.closed,initialNormal:curve.widthRule.initialNormal}):null;
  return paths.map(path=>{
    const matches=path.points.map(parameterAt),frameSamples=path.frameSamples??(transported?matches.map(({parameter,segment,fraction})=>{
      const a=transported.frames[segment],b=transported.frames[segment+1],u=unit(a.u.map((v,k)=>v+(b.u[k]-v)*fraction)),seed=a.normal.map((v,k)=>v+(b.normal[k]-v)*fraction),normal=unit(seed.map((v,k)=>v-dot(seed,u)*u[k]));
      return {point:[parameter*transported.lengthMm,0,0],u,v:cross(normal,u),normal};
    }):null);
    const result={...path,beadWidthMm:construction.beadWidthMm,curveParameters:matches.map(m=>m.parameter),...(frameSamples?{frameSamples,segmentMetadata:path.points.slice(1).map((_,i)=>({surfaceNormal:frameSamples[i].normal}))}:{})};
    return applyCurveProfiles(result,curve);
  });
}
