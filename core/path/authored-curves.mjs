import {sampleSpatialCurve} from '../geom/spatial-curve.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {surfaceTangentFrame} from '../geom/surface-frame.mjs';
import {referenceSurface,selectedFace} from '../geom/reference-surface.mjs';
import {requireThat,distance,normalize,cross} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE,CHORD_TOLERANCE_MM} from '../dimensions.mjs';

import {curvePoint} from '../geom/surface-curves.mjs';

import {transportCurveFrames} from '../geom/curve-frame.mjs';
import {strokeRange} from './deposition.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {beadWidthRule,parallelBeadCurves} from './parallel-curves.mjs';
import {strokeSurfaceRegion} from '../region/surface-offset.mjs';
import {interpolatePose} from './pose.mjs';
import {unitDirection as unit,dot} from '../geom/frame.mjs';
import {piecewiseChart,piecewiseChartFrame,mapPiecewiseChartPath,splitPiecewiseChartPath} from '../geom/piecewise-chart.mjs';

import {authoredNurbs} from '../geom/spatial.mjs';
export {authoredNurbs} from '../geom/spatial.mjs';

import {curveProfile} from './construction-profiles.mjs';
export {readCurveProfiles,curveProfile} from './construction-profiles.mjs';
export {reconcileAuthoredCorrespondence} from './authored-correspondence.mjs';
export {distinctPolyline} from '../geom/spatial-curve.mjs';

function curveReferenceSurface(reference,references,repetition=null){
  if(reference.kind==='surface'){
    return referenceSurface(reference.surface,references?.[`part:${reference.part??''}`]?.shell);
  }
  if(reference.kind==='patch'&&references?.[`part:${reference.part??''}`])return selectedFace(references[`part:${reference.part??''}`].shell,reference.name);
  const key=reference.kind==='patch'?`patch:${reference.part??''}:${reference.name}`:`${reference.kind}:${reference.assignment}`;
  const found=references?.[key];requireThat(found,`Curve reference ${key} is unavailable.`);
  if(reference.kind==='slice'){
    const index=reference.index??repetition,layer=index===null?found.layers?.findLast(layer=>layer.slice):found.layers?.find(l=>l.index===index);
    requireThat(layer,`Curve reference ${key} has no selected prepared surface.`);return layer.slice;
  }
  return found.patch??{kind:'sleeve-chart',layers:found.layers,domainU:[0,1],domainV:[0,found.layers.length-1]};
}
// Process scale: default chord tolerance of an authored curve, a twentieth of a 0.4 mm
// line; callers normally pass the repetition's own toleranceMm.
const AUTHORED_CHORD_MM=CHORD_TOLERANCE_MM;
export function sampleAuthoredCurve(curve,{references={},repetition=null,offset=[0,0,0],toleranceMm=AUTHORED_CHORD_MM,sampleStepMm=1}={}){
  const input=curve.uv??curve,surface=curve.uv?curveReferenceSurface(input.reference,references,repetition):null;
  const {samples,sourceSegments}=sampleSpatialCurve({points:input.points,nurbs:input.nurbs,closed:curve.closed,surface,normalMm:input.normalMm??0},
    {offset,toleranceMm:curve.toleranceMm??toleranceMm,sampleStepMm:curve.sampleStepMm??sampleStepMm,
      cuts:Object.values(curve.vary??{}).flatMap(v=>v.map(p=>p[0])),chartSteps:curve.uv?.reference.kind==='sleeve'?[.125,.25]:[]});
  const {nurbs,uv,vary,repetitions,widthRule,toleranceMm:tol,sampleStepMm:maxStep,...properties}=curve;
  const result={...properties,role:curve.role??'curve',closed:false,points:samples.map(s=>s.point),curveParameters:samples.map(s=>s.t)};
  if(curve.segmentMetadata)result.segmentMetadata=sourceSegments.map(segment=>({...curve.segmentMetadata[segment]}));
  if(samples[0].normal){result.frameSamples=samples.map(s=>({point:[...s.chart,input.normalMm??0],...surfaceTangentFrame(s)}));
    result.segmentMetadata=samples.slice(1).map((s,i)=>({...result.segmentMetadata?.[i],surfaceNormal:samples[i].normal}));}
  if(surface&&input.points&&!(input.normalMm??0))result.nativeSurface={surface,translation:offset};
  const profiled=applyCurveProfiles(result,curve);
  if(vary)profiled.profilePath={parameters:profiled.curveParameters,vary,
    widthsMm:profiled.widthsMm,speedsMmS:profiled.segmentMetadata?.map(m=>m.speedMmS),
    ...(vary.rateMm3PerMm?{ratesMm2:profiled.curveParameters.slice(1).map((u,i)=>curveProfile(vary.rateMm3PerMm,(u+profiled.curveParameters[i])/2)),
      aspects:profiled.curveParameters.slice(1).map((u,i)=>curveProfile(vary.aspectRatio,(u+profiled.curveParameters[i])/2))}:{})};
  // Exact spatial NURBS survive process/profile finalization. Any subsequent
  // mapping, connection or displacement changing these points invalidates this
  // witness at publication and publishes the actual finalized polyline instead.
  if(nurbs&&!uv)profiled.nativePath={geometry:{kind:'nurbs',...nurbs,
    controlPoints:nurbs.controlPoints.map(p=>p.map((value,i)=>value+offset[i]))},
    points:profiled.points,parameters:profiled.curveParameters};
  return profiled;
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
    if(vary.rateMm3PerMm||vary.aspectRatio){
      requireThat(vary.rateMm3PerMm&&vary.aspectRatio,'Authored Paath profiles need both rateMm3PerMm and aspectRatio.');
      const rates=samples.slice(1).map((s,i)=>curveProfile(vary.rateMm3PerMm,(s.t+samples[i].t)/2));
      const aspects=samples.slice(1).map((s,i)=>curveProfile(vary.aspectRatio,(s.t+samples[i].t)/2));
      result.widthsMm=rates.map((rate,i)=>Math.sqrt(rate*aspects[i]));
      result.heightsMm=rates.map((rate,i)=>Math.sqrt(rate/aspects[i]));
    }
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
    if(distance(first,last)>ROUNDING_RELATIVE){path.points.push(first);path.parameters.push(1);} // chart units: closes unless already closed within rounding
  }
  return samplePiecewiseCurve(source,chart,path,{...options,toleranceMm:curve.toleranceMm??options.toleranceMm,sampleStepMm:curve.sampleStepMm??options.sampleStepMm});
}

// Piece addresses are internal; frame locations retain original authored UV.
// Added round segments hold their source parameter at the crease crossing.
function samplePiecewiseCurve(source,chart,path,{offset=[0,0,0],toleranceMm=AUTHORED_CHORD_MM,sampleStepMm=1}={}){
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
    const entry=curveReferenceSurface(curve.uv.reference,options.references,options.repetition??null);
    if(entry.layers){
      offsetDescriptor={kind:'sleeve-chart',layers:entry.layers,domainU:[0,1],domainV:[0,entry.layers.length-1]};
      offsetChart=piecewiseChart(offsetDescriptor,{normalMm:curve.uv.normalMm,toleranceMm:(curve.toleranceMm??options.toleranceMm??AUTHORED_CHORD_MM)/4});
      offsetDescriptor={...offsetDescriptor,atlas:offsetChart};
    }
  }
  if(!curve.widthRule)return [offsetChart?applyCurveProfiles(sampleRoundedCurve(curve,options,offsetChart),curve):sampleAuthoredCurve(curve,options)];
  const construction=beadWidthRule(curve.widthRule),plain={...curve,vary:undefined,widthRule:undefined};
  const source=offsetChart?sampleRoundedCurve(plain,options,offsetChart):sampleAuthoredCurve(plain,options);
  if(construction.parallelCount===1)return [applyCurveProfiles({...source,beadWidthMm:construction.beadWidthMm},curve)];
  let paths=[];
  if(curve.uv){
    const entry=curveReferenceSurface(curve.uv.reference,options.references,options.repetition??null);
    const patch=offsetDescriptor??(entry.cp?entry:entry.patch)??(entry.layers?entry:entry.at?{...entry,kind:'surface-chart'}:null);
    if(entry.kind==='plane'){
      const plane=entry;
      paths=parallelBeadCurves({...source,curveParameters:undefined},curve.widthRule).map(c=>{
        const mapped=sampleAuthoredCurve({...plain,uv:undefined,points:c.points,closed:c.closed},{...options,offset:[0,0,0]});
        return {...mapped,frameSamples:mapped.points.map(p=>{const d=p.map((x,k)=>x-plane.origin[k]-(options.offset?.[k]??0));return {point:[dot(d,plane.xAxis),dot(d,plane.yAxis),curve.uv.normalMm??0],u:plane.xAxis,v:plane.yAxis,normal:plane.normal};})};
      });
    }else{
    requireThat(patch,'Parallel surface curves require a native patch, plane or evaluated surface chart.');
    const chartPoints=offsetChart?source.chartPoints:source.frameSamples.map(f=>f.point.slice(0,2));
    for(let k=0;k<Math.ceil(construction.parallelCount/2);k++){
      const radius=(construction.parallelCount-1)*construction.pitchMm/2-k*construction.pitchMm;
      if(radius<=PRINT_RESOLUTION_MM){paths.push(source);continue;} // the center curve: an offset below print resolution
      const region=strokeSurfaceRegion(patch,[{closed:false,points:chartPoints}],radius,{toleranceMm:curve.toleranceMm??AUTHORED_CHORD_MM,maxStepMm:curve.sampleStepMm??1,normalMm:curve.uv.normalMm??0});
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
