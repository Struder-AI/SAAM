// Finalization receives each member's Slice Paath and finishes it through the
// existing stroke-operation finishing stages. Spatial geometry and material
// profiles stay producer-owned; this receiver derives only what finishing reads.
import {profileAt,keyed} from '../path/curve-profiles.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {distance,requireThat} from '../private/toolpath/numeric.mjs';
import {surfaceConnectionMaterial,regionContainsSegment} from '../geom/material-envelope.mjs';
import {SegmentIndex} from '../region/region2d.mjs';
import {finalizeDepositionResult} from './finalize.mjs';

const profileKeys=profile=>keyed(profile)?profile.knots:[[0,profile],[1,profile]];
function localProfile(profile,from,to){
  if(!keyed(profile))return profile;
  return {...profile,knots:[[0,profileAt(profile,from)],
    ...profile.knots.filter(([u])=>u>from&&u<to).map(([u,value])=>[(u-from)/(to-from),value]),
    [1,profileAt(profile,to,'left')]]};
}
function sourceSample(values,parameters,u){
  let lo=0,hi=parameters.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(parameters[mid]<=u)lo=mid;else hi=mid;}
  const fraction=(u-parameters[lo])/(parameters[hi]-parameters[lo]);
  const interpolate=(a,b)=>{
    if(fraction===0)return a;if(fraction===1)return b;
    if(typeof a==='number'&&typeof b==='number')return a+(b-a)*fraction;
    if(Array.isArray(a)&&Array.isArray(b))return a.map((value,k)=>interpolate(value,b[k]));
    if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.fromEntries(Object.entries(a).map(([key,value])=>[key,interpolate(value,b[key])]));
    return a;
  };
  return interpolate(values[lo],values[hi]);
}

function depositionStroke(paath,course,founded){
  const curve=paath.curves[course.curveId],labels=paath.correspondence?.[course.curveId]??{};
  requireThat(curve.geometry.kind==='polyline','Slice finishing requires the producer’s spatial polyline.');
  const sourcePoints=curve.geometry.points,sourceLengths=[0];
  for(let i=1;i<sourcePoints.length;i++)sourceLengths.push(sourceLengths.at(-1)+distance(sourcePoints[i-1],sourcePoints[i]));
  const sourceParameters=sourceLengths.map(length=>length/sourceLengths.at(-1)),from=course.from??0,to=course.to??1;
  const sourceLocations=[...new Set([from,to,...sourceParameters.filter(u=>u>from&&u<to),
    ...Object.values(curve.profiles).flatMap(profile=>keyed(profile)?profile.knots.map(([u])=>u).filter(u=>u>from&&u<to):[])])].sort((a,b)=>a-b);
  const points=sourceLocations.map(u=>sourceSample(sourcePoints,sourceParameters,u));
  const parameters=sourceLocations.map(u=>(u-from)/(to-from));
  const profiles=Object.fromEntries(Object.entries(curve.profiles).map(([key,profile])=>[key,localProfile(profile,from,to)]));
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  const rates=[],widths=[],heights=[],speeds=[],volumesMm3=[];
  for(let i=1;i<points.length;i++){
    const u=(parameters[i-1]+parameters[i])/2,rate=profileAt(profiles.rateMm3PerMm,u),aspect=profileAt(profiles.aspectRatio,u);
    rates.push(rate);widths.push(Math.sqrt(rate*aspect));heights.push(Math.sqrt(rate/aspect));
    speeds.push(profileAt(profiles.speedMmS,u));volumesMm3.push((lengths[i]-lengths[i-1])*rate);
  }
  const normals=parameters.map(u=>profileAt(profiles.materialNormal,u));
  const metadata={...labels};
  for(const field of ['widthsMm','heightsMm','flowMultipliers','flowMultiplier','heightMm'])delete metadata[field];
  for(const field of ['chartPoints','sourceParameters','frameSamples','referenceAlong','cellWidthsMm'])if(labels[field])
    metadata[field]=sourceLocations.map(u=>sourceSample(labels[field],sourceParameters,u));
  const sourceSegment=u=>{let i=0;while(i<sourceParameters.length-2&&sourceParameters[i+1]<=u)i++;return i;};
  return {...metadata,id:course.id,sourceCurve:course.sourceCurve??course.curveId,
    ...(course.interruptible===undefined?{}:{interruptible:course.interruptible}),
    ...(course.provenance?{provenance:course.provenance.source??course.provenance}:{}),
    ...(course.after?{after:[...course.after]}:{}),
    points,closed:Boolean(labels.closed&&from===0&&to===1),
    role:labels.cellDirection&&course.role===labels.materialRole?labels.cellDirection:course.role??labels.role,
    directionRequired:course.directionRequired??labels.directionRequired??false,
    seamRequired:course.seamRequired??labels.seamRequired??false,
    ...(course.orderGroup===undefined?{}:{orderGroup:course.orderGroup}),
    beadWidthMm:widths[0],beadHeightMm:heights[0],speedMmS:speeds[0],volumesMm3,normals,
    curveParameters:parameters,profilePath:{parameters,vary:{
      rateMm3PerMm:profileKeys(profiles.rateMm3PerMm),aspectRatio:profileKeys(profiles.aspectRatio),speedMmS:profileKeys(profiles.speedMmS)},
      speedsMmS:speeds,widthsMm:widths,aspects:rates.map((_,i)=>profileAt(profiles.aspectRatio,(parameters[i]+parameters[i+1])/2))},
    segmentMetadata:volumesMm3.map((_,i)=>{
      const declared=founded?founded(metadata.chartPoints?.[i],metadata.chartPoints?.[i+1]):undefined;
      return {...labels.segmentMetadata?.[sourceSegment((sourceLocations[i]+sourceLocations[i+1])/2)],surfaceNormal:normals[i],
        beadWidthMm:widths[i],beadHeightMm:heights[i],speedMmS:speeds[i],...(declared===undefined?{}:{founded:declared})};
    })};
}

// A member's stack declaration, read per segment: inside the region the member
// rests on its native predecessor. A segment touching its boundary is not
// declared there; the Scheduler qualifies it against deposited material.
function memberFounded(foundation){
  if(!foundation)return null;
  const {region,outside}=foundation;
  if(!region)return outside===undefined?null:()=>outside;
  const index=new SegmentIndex(region);
  return (a,b)=>a&&b&&regionContainsSegment(a,b,{loops:region,index})?true:outside;
}

// The Finalize Slice work receiver. `member` is the stack member the Paath is
// associated with; `envelope` is the Slice work identity returned with it.
export function finalizeSliceWork({paath,member,envelope,owner,part,toolPose=null,filament},{plan}){
  const s=member.settings,operations=[];
  const connectionMaterial=Object.keys(paath.operations).length?surfaceConnectionMaterial(member.slice,member.region,
    {sampleStepMm:s.sampleStepMm,lineWidthMm:member.widthMm??member.process.lineWidthMm}):null;
  const motionIntent=toolPose?{kind:'derived-pose',alignToSliceNormal:toolPose.alignToSliceNormal}:null;
  const founded=memberFounded(member.foundation);
  for(const operation of Object.values(paath.operations)){
    const strokes=operation.courses.map(course=>depositionStroke(paath,course,founded));
    if(!strokes.length)continue;
    const process=paath.processes[operation.processId]??member.process;
    let top=-Infinity,bottom=Infinity;
    for(const stroke of strokes)for(const point of stroke.points){top=Math.max(top,point[2]);bottom=Math.min(bottom,point[2]);}
    const group=paath.operationMetadata?.[operation.id]?.group??operation.id.split(':').at(-1),index=member.index;
    const closed=strokes.every(stroke=>stroke.closed);
    const localSequence=operation.courses.some(course=>course.after?.length);
    operations.push({group,id:operation.id,layerId:operation.layerId,stackId:envelope.stackId,
      phase:top-bottom<=PRINT_RESOLUTION_MM?'planar':'curves',layer:index,rank:top,after:[...operation.after??[]],
      strokes:motionIntent?strokes.map(stroke=>({...stroke,motionIntent})):strokes,
      connectNearby:s.connectNearby??true,foundation:'stack',layerIndex:member.ordinal,layerCount:envelope.totalLayerCount??envelope.stackLayers.length,
      stackDirection:member.direction??null,...(s.continuous?{continuous:true,regionId:envelope.id+':'+index}:{}),
      order:localSequence?'given':s.order??(group==='walls'&&closed?'nearest':'given'),
      slice:member.slice,ownershipIndex:index,materialGeometry:connectionMaterial??{kind:'bounds',maxZ:top},process,
      ...((Object.hasOwn(s.process??{},'fanPercent')||(member.materialOrdinal??member.ordinal)===1)?{fanPercent:process.fanPercent}:{}),
      ...(filament===null||filament===undefined?{}:{filament})});
  }
  const report={...envelope.report,depositionFamily:'slice',construction:envelope.report.construction,owner,part};
  return finalizeDepositionResult({...envelope,report,operations},plan);
}
