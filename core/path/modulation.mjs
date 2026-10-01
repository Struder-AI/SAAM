import {distance,requireThat} from '../geom/tolerance.mjs';
import {strokeRange} from './deposition.mjs';
import {validateModulationField,evaluateScalarField,fieldSampleStep,scalarFieldRange,scalarFieldInvariant,scalarFieldBreakpoints} from './modulation-field.mjs';
import {interpolateDirections,validatePose,uprightPose} from './pose.mjs';
import {transportCurveFrames} from './curve-frame.mjs';

const positive=n=>Number.isFinite(n)&&n>0;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const unit=v=>{const length=Math.hypot(...v);requireThat(length>1e-12,'Modulation direction is ambiguous at a reversing corner.');return v.map(n=>n/length);};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const defaultModulations=()=>({version:1,modifiers:[]});

export function validateModulations(record,{assignmentIds}={}) {
  requireThat(record&&Object.keys(record).sort().join()==='modifiers,version'&&record.version===1&&Array.isArray(record.modifiers),'Modulations need version:1 and modifiers.');
  const ids=new Set();
  for(const m of record.modifiers){
    const expected=['id','assignments','roles','channel','amplitude','field','sampleStepMm','tolerance',...(['displacement','tilt'].includes(m?.channel)?['direction']:[])];
    const optional=['frame','layers','topN','phasePerLayerRad'];
    requireThat(m&&expected.every(k=>Object.hasOwn(m,k))&&Object.keys(m).every(k=>expected.includes(k)||optional.includes(k)),'Invalid modulation fields.');
    requireThat(typeof m.id==='string'&&/^[a-z][a-z0-9-]*$/.test(m.id)&&!ids.has(m.id),'Invalid or duplicate modulation id.');ids.add(m.id);
    for(const key of ['assignments','roles'])requireThat(m[key]===null||Array.isArray(m[key])&&m[key].length>0&&new Set(m[key]).size===m[key].length&&m[key].every(id=>typeof id==='string'&&id.length>0),`Modulation ${key} must be null or distinct nonempty names.`);
    requireThat(!assignmentIds||m.assignments===null||m.assignments.every(id=>assignmentIds.includes(id)),`Modulation ${m.id} targets an unknown slice assignment.`);
    requireThat(['displacement','flow','width','speed','tilt'].includes(m.channel)&&Number.isFinite(m.amplitude)&&positive(m.sampleStepMm)&&positive(m.tolerance),'Modulation needs a supported channel, finite amplitude, positive sampleStepMm and tolerance.');
    if(['displacement','tilt'].includes(m.channel))requireThat(['lateral','stack'].includes(m.direction)||vector(m.direction)&&Math.hypot(...m.direction)>0,'Displacement/tilt direction must be lateral, stack or a nonzero vector in the selected frame.');
    requireThat(['world','slice','curve'].includes(m.frame??'world'),'Modulation frame must be world, slice or curve.');
    requireThat(m.layers==null||m.layers&&Object.keys(m.layers).sort().join()==='from,to'&&Number.isInteger(m.layers.from)&&m.layers.from>=0&&Number.isInteger(m.layers.to)&&m.layers.to>=m.layers.from,'Modulation layers needs inclusive nonnegative from/to indices.');
    requireThat(m.topN==null||Number.isInteger(m.topN)&&m.topN>0,'Modulation topN must be a positive layer count.');
    requireThat(m.phasePerLayerRad===undefined||Number.isFinite(m.phasePerLayerRad),'Modulation phasePerLayerRad must be finite.');
    validateModulationField(m.field);
    validateFieldChannel(m.field,m);
  }
  return record;
}

function validateFieldChannel(field,modifier){
  if(field.kind==='periodic'&&field.waveform==='square'&&['displacement','tilt'].includes(modifier.channel))requireThat((field.transitionFraction??.05)>0,'Position/orientation square fields need positive transitionFraction (default0.05 cycle).');
  if(field.kind==='solid-distance')requireThat((modifier.frame??'world')==='world','Solid-distance source geometry uses world coordinates; choose frame world.');
  for(const source of field.sources??(field.source?[field.source]:[]))validateFieldChannel(source,modifier);
}

export function matchingModulations(result,role,record,operation=null) {
  const assignment=result.report?.owner??result.id;
  return record.modifiers.filter(m=>{
    if(m.amplitude===0||m.assignments!==null&&!m.assignments.includes(assignment)||m.roles!==null&&!m.roles.includes(role))return false;
    if(!operation)return true;
    if(m.layers!=null||m.topN!=null||m.phasePerLayerRad){
      requireThat(Number.isInteger(operation.layerIndex)&&Number.isInteger(operation.layerCount),'Layer-scoped modulation needs producer layerIndex/layerCount metadata.');
      if(m.layers&&(operation.layerIndex<m.layers.from||operation.layerIndex>m.layers.to)||m.topN!=null&&operation.layerIndex<operation.layerCount-m.topN)return false;
    }
    return true;
  });
}

// Both ends of a closed curve use this same averaged source tangent. Neither
// corner directions nor modulation sampling change its authored ordering.
function lateralDirections(points,closed) {
  const duplicate=distance(points[0],points.at(-1))<1e-12;
  const count=duplicate?points.length-1:points.length,cyclic=closed||duplicate,result=[];
  for(let i=0;i<count;i++){
    const previous=i>0?points[i-1]:cyclic?points[count-1]:null,next=i+1<count?points[i+1]:cyclic?points[0]:null;
    const incoming=previous?unit([points[i][0]-previous[0],points[i][1]-previous[1],0]):null;
    const outgoing=next?unit([next[0]-points[i][0],next[1]-points[i][1],0]):null;
    const tangent=incoming&&outgoing?unit(incoming.map((v,a)=>v+outgoing[a])):incoming??outgoing;
    result.push([tangent[1],-tangent[0],0]);
  }
  return duplicate?[...result,result[0]]:result;
}

function sampledFrame(frames,t){
  const u=unit(mix(frames[0].u,frames[1].u,t)),normal=unit(mix(frames[0].normal,frames[1].normal,t));
  const v=unit(cross(normal,u));
  return {point:mix(frames[0].point,frames[1].point,t),u:unit(cross(v,normal)),v,normal};
}

function frameDirection(direction,frame){
  if(!frame)return unit(direction);
  return unit([0,1,2].map(i=>direction[0]*frame.u[i]+direction[1]*frame.v[i]+direction[2]*frame.normal[i]));
}

function rotatedVector(vector,axis,angle){
  const c=Math.cos(angle),s=Math.sin(angle),perpendicular=cross(axis,vector),along=dot(axis,vector);
  return vector.map((v,i)=>v*c+perpendicular[i]*s+axis[i]*along*(1-c));
}

function evaluateModulatedPoint(a,b,t,modifiers,directions,context={}) {
  const source=mix(a,b,t),point=[...source];let flow=1,width=1,speed=1;
  let pose=context.poses?{...interpolateDirections(context.poses[0],context.poses[1],t),rotaryDeg:context.poses[0].rotaryDeg+t*(context.poses[1].rotaryDeg-context.poses[0].rotaryDeg)}:null;
  for(const m of modifiers){
    const kind=m.frame??'world';
    const frame=kind==='slice'?sampledFrame(context.frames,t):kind==='curve'?sampledFrame(context.curveFrames,t):null;
    const coordinateEnds=kind==='slice'?context.frames?.map(f=>f.point):kind==='curve'?context.curveFrames?.map(f=>f.point):[a,b];
    const sideDirection=context.side&&coordinateEnds?coordinateEnds[0].map((v,i)=>(coordinateEnds[1][i]-v)*context.side):null;
    const amount=m.amplitude*evaluateScalarField(m.field,frame?.point??source,{phaseRad:(m.phasePerLayerRad??0)*(context.layerIndex??0),continuous:['displacement','tilt'].includes(m.channel),sideDirection});
    requireThat(Number.isFinite(amount),`Modulation ${m.id} produced a nonfinite value.`);
    if(['displacement','tilt'].includes(m.channel)){
      let direction;
      if(m.direction==='stack'){
        requireThat(vector(context.stackDirection),'Stack-direction modulation needs the producer stacking direction.');direction=unit(context.stackDirection);
      }else if(m.direction==='lateral'){
        if(!frame)direction=unit(mix(directions[0],directions[1],t));
        else{
          const tangent=kind==='slice'&&context.fillDirection?frameDirection([...context.fillDirection,0],frame):sampledFrame(context.curveFrames,t).u;
          direction=unit(cross(tangent,frame.normal));
        }
      }else direction=frameDirection(m.direction,frame);
      if(m.channel==='displacement')for(let axis=0;axis<3;axis++)point[axis]+=direction[axis]*amount;
      else if(amount!==0){
        pose??=uprightPose();
        pose={...pose,toolAxis:rotatedVector(pose.toolAxis,direction,amount*Math.PI/180),toolUp:rotatedVector(pose.toolUp,direction,amount*Math.PI/180)};
      }
    }else{
      requireThat(1+amount>0,`Modulation ${m.id} produced a nonpositive ${m.channel} factor.`);
      if(m.channel==='flow')flow*=1+amount;else if(m.channel==='width')width*=1+amount;else speed*=1+amount;
    }
  }
  requireThat(point.every(Number.isFinite)&&Number.isFinite(flow)&&Number.isFinite(width)&&Number.isFinite(speed),'Modulation overflowed the numeric representation.');
  if(pose)validatePose(pose);
  return {t,point,source,flow,width,speed,pose};
}

function sampleModulatedSegment(a,b,modifiers,directions,context) {
  const step=modifiers.reduce((value,m)=>Math.min(value,m.sampleStepMm,fieldSampleStep(m.field)),Infinity),tolerance=modifiers.reduce((value,m)=>Math.min(value,m.tolerance),Infinity);
  const breaks=[0,...new Set(modifiers.flatMap(m=>{
    const ends=m.frame==='slice'?context.frames.map(f=>f.point):m.frame==='curve'?context.curveFrames.map(f=>f.point):[a,b];
    return scalarFieldBreakpoints(m.field,...ends,{phaseRad:(m.phasePerLayerRad??0)*(context.layerIndex??0),continuous:['displacement','tilt'].includes(m.channel)});
  })),1].sort((a,b)=>a-b);
  const stack=breaks.slice(1).map((end,i)=>[evaluateModulatedPoint(a,b,breaks[i],modifiers,directions,{...context,side:1}),evaluateModulatedPoint(a,b,end,modifiers,directions,{...context,side:-1})]).reverse();
  const samples=[stack.at(-1)[0]];
  while(stack.length){
    const [left,right]=stack.pop(),midpoint=(left.t+right.t)/2;
    const middle=evaluateModulatedPoint(a,b,midpoint,modifiers,directions,context);
    const probes=[.25,.5,.75].map(t=>t===.5?middle:evaluateModulatedPoint(a,b,left.t+(right.t-left.t)*t,modifiers,directions,context));
    const error=Math.max(...probes.map((probe,i)=>{
      const t=(i+1)/4;
      const poseError=probe.pose&&left.pose&&right.pose?Math.max(distance(probe.pose.toolAxis,mix(left.pose.toolAxis,right.pose.toolAxis,t)),distance(probe.pose.toolUp,mix(left.pose.toolUp,right.pose.toolUp,t))):0;
      return Math.max(distance(probe.point,mix(left.point,right.point,t)),poseError,...['flow','width','speed'].map(k=>Math.abs(probe[k]-(left[k]+(right[k]-left[k])*t))));
    }));
    const coordinateLength=Math.max(distance(left.source,right.source),...modifiers.map(m=>{
      const frames=m.frame==='slice'?context.frames:m.frame==='curve'?context.curveFrames:null;
      return frames?distance(frames[0].point,frames[1].point)*(right.t-left.t):0;
    }));
    if(coordinateLength<=step&&error<=tolerance){samples.push(right);continue;}
    requireThat(midpoint>left.t&&midpoint<right.t,'Modulation subdivision cannot progress at the requested tolerance.');
    stack.push([middle,right],[left,middle]);
  }
  return samples;
}

function curveFrames(stroke,points){
  const normal=stroke.frameSamples?.[0]?.normal;
  const prepared=transportCurveFrames(points,{closed:stroke.closed,initialNormal:normal??null});
  return prepared.frames.map((frame,i)=>({...frame,point:[frame.point[0],stroke.curveParameters?.[i]??frame.point[0]/prepared.lengthMm,0]}));
}
export function validateFillModulation(stroke,modifiers,{layerIndex}={}){
  const lateral=modifiers.filter(m=>m.channel==='displacement'&&m.direction!=='stack'&&(m.direction==='lateral'||(m.frame??'world')==='curve'&&m.direction[1]!==0||(m.frame??'world')!=='curve'&&(m.direction[0]!==0||m.direction[1]!==0)));
  if(!lateral.length)return;
  requireThat(stroke.fillFamily||!['infill','fill','top','bottom'].includes(stroke.role),`Layer ${layerIndex??'?'} role ${stroke.role}: lateral fill modulation requires producer spacing metadata.`);
  if(!stroke.fillFamily)return;
  const {spacingMm,direction}=stroke.fillFamily;
  requireThat(positive(spacingMm),'Fill modulation needs declared positive line spacing.');
  let excursion=0;
  for(const m of lateral){
    // Only an explicit common chart direction proves translation invariance.
    const invariant=m.frame==='slice'&&direction&&scalarFieldInvariant(m.field,[-direction[1],direction[0],0]);
    if(invariant)continue;
    const range=scalarFieldRange(m.field);
    excursion+=Math.abs(m.amplitude)*Math.max(...range.map(Math.abs));
  }
  requireThat(excursion<spacingMm/2,`Layer ${layerIndex??'?'} role ${stroke.role}: out-of-phase fill modulation excursion ${excursion} mm must remain below half spacing ${spacingMm/2} mm; use an in-phase chart field or reduce amplitude.`);
}

export function modulateStroke(stroke,modifiers,{layerIndex=0,stackDirection}={}) {
  modifiers=modifiers.filter(m=>m.amplitude!==0);
  if(!modifiers.length||stroke.volumesMm3?.every(volume=>volume===0))return {stroke,changed:false,maxExcursionMm:0};
  if(stroke.stationaryExtrusion){
    requireThat(stroke.points.length===1&&modifiers.every(m=>m.channel==='flow'&&(m.frame??'world')==='world'),'Stationary extrusion supports world-space flow modulation; geometric, speed, width, tilt and curve/chart channels need a moving path.');
    const factor=modifiers.reduce((value,m)=>{
      const multiplier=1+m.amplitude*evaluateScalarField(m.field,stroke.points[0],{phaseRad:(m.phasePerLayerRad??0)*layerIndex});
      requireThat(positive(multiplier),'Stationary flow modulation must remain positive.');return value*multiplier;
    },1);
    requireThat(positive(factor),'Stationary flow modulation overflowed its factor.');
    if(factor===1)return {stroke,changed:false,maxExcursionMm:0};
    const stationaryExtrusion={...stroke.stationaryExtrusion,volumeMm3:stroke.stationaryExtrusion.volumeMm3*factor,flowMm3S:stroke.stationaryExtrusion.flowMm3S*factor};
    requireThat(positive(stationaryExtrusion.volumeMm3)&&positive(stationaryExtrusion.flowMm3S),'Stationary extrusion needs finite positive modulated volume and flow rate.');
    return {stroke:{...stroke,stationaryExtrusion},changed:true,maxExcursionMm:0};
  }
  validateFillModulation(stroke,modifiers,{layerIndex});
  requireThat(stroke.points.length>=2,'Modulation needs a curve with at least two points.');
  const source=stroke.closed?strokeRange(stroke):stroke,{points,frameSamples:frames,poses:sourcePoses}=source;
  requireThat(!stroke.volumesMm3||stroke.volumesMm3.length===points.length-1,'Modulation needs one source volume per segment.');
  requireThat(!stroke.segmentMetadata||stroke.segmentMetadata.length===points.length-1,'Modulation needs one source metadata record per segment.');
  requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Modulation source poses must align with vertices.');
  requireThat(!stroke.frameSamples||stroke.frameSamples.length===stroke.points.length,'Modulation source frameSamples must align with vertices.');
  requireThat(stroke.frameSamples||!modifiers.some(m=>m.frame==='slice'),'Slice-frame modulation needs producer frameSamples aligned with stroke points.');
  const directions=modifiers.some(m=>m.direction==='lateral'&&(m.frame??'world')==='world')?lateralDirections(points,stroke.closed):null;
  const curve=modifiers.some(m=>m.frame==='curve'||m.direction==='lateral'&&m.frame==='slice')?curveFrames(stroke,points):null;
  const output=[],volumes=[],metadata=[],poses=[],sampleFrames=[],parameters=[];let maxExcursionMm=0,changed=false;
  for(let i=0;i<points.length-1;i++){
    const length=distance(points[i],points[i+1]);
    requireThat(length>0,'Modulation requires nonzero source segments.');
    const volume=stroke.volumesMm3?.[i]??length*stroke.beadAreaMm2;
    const width=stroke.segmentMetadata?.[i]?.beadWidthMm??stroke.beadWidthMm;
    requireThat(Number.isFinite(volume)&&volume>=0&&positive(width),'Modulation needs deposited segment volume and bead width.');
    const context={layerIndex,stackDirection,fillDirection:stroke.fillFamily?.direction,frames:frames?[frames[i],frames[i+1]]:null,curveFrames:curve?[curve[i],curve[i+1]]:null,poses:sourcePoses?[sourcePoses[i],sourcePoses[i+1]]:null};
    const samples=sampleModulatedSegment(points[i],points[i+1],modifiers,directions?[directions[i],directions[i+1]]:null,context);
    const append=sample=>{output.push(sample.point);poses.push(sample.pose??uprightPose());if(frames)sampleFrames.push(sampledFrame(context.frames,sample.t));if(stroke.curveParameters)parameters.push(source.curveParameters[i]+sample.t*(source.curveParameters[i+1]-source.curveParameters[i]));};
    if(!output.length)append(samples[0]);
    for(let j=1;j<samples.length;j++){
      const left=samples[j-1],right=samples[j],mid=evaluateModulatedPoint(points[i],points[i+1],(left.t+right.t)/2,modifiers,directions?[directions[i],directions[i+1]]:null,context);
      const excursion=Math.max(distance(left.point,left.source),distance(right.point,right.source),distance(mid.point,mid.source));
      const poseChanged=modifiers.some(m=>m.channel==='tilt')&&[left,mid,right].some(s=>s.pose&&distance(s.pose.toolAxis,(sourcePoses?interpolateDirections(...context.poses,s.t):uprightPose()).toolAxis)>1e-12);
      maxExcursionMm=Math.max(maxExcursionMm,excursion);changed ||= excursion>0||mid.flow!==1||mid.width!==1||mid.speed!==1||poseChanged;
      append(right);volumes.push(volume/length*distance(left.point,right.point)*mid.flow*mid.width);
      const speedMmS=(stroke.segmentMetadata?.[i]?.speedMmS??stroke.speedMmS)*mid.speed;
      requireThat(positive(speedMmS),'Modulation needs a positive source and final deposition speed.');
      metadata.push({...stroke.segmentMetadata?.[i],beadWidthMm:width*mid.width,speedMmS});
    }
  }
  if(!changed)return {stroke,changed:false,maxExcursionMm:0};
  const closedSource=stroke.closed||distance(stroke.points[0],stroke.points.at(-1))<1e-12;
  requireThat(!closedSource||distance(output[0],output.at(-1))<=1e-8,'Closed-curve modulation does not meet at its seam; make curve-frame periods/phases agree at both ends.');
  // Producer samples and process profiles belong to the original discretization.
  // Final segment metadata retains frozen surfaceNormal and bead dimensions;
  // resampled vertices/volumes replace those inputs and the former uniform area.
  const {normals,chartPoints,referenceAlong,heightsMm,widthsMm,flowMultipliers,beadAreaMm2,frameSamples,curveParameters,...retained}=stroke;
  return {stroke:{...retained,closed:false,points:output,volumesMm3:volumes,segmentMetadata:metadata,
    ...(sourcePoses||modifiers.some(m=>m.channel==='tilt')?{poses}:{}),...(frames?{frameSamples:sampleFrames}:{}),...(curveParameters?{curveParameters:parameters}:{})},changed:true,maxExcursionMm};
}

export function finalizeModulatedResult(result,record) {
  const changedOperations=[],materialChangedOperations=[],operationModifiers={},used=new Set();let maxExcursionMm=0;
  const operations=result.operations.map(operation=>{
    let changed=false,materialChanged=false;const applied=new Set();
    const strokes=operation.strokes.map(stroke=>{
      const modifiers=matchingModulations(result,stroke.role,record,operation);
      requireThat(!modifiers.length||!stroke.segmentMetadata?.some(m=>m?.role!==undefined&&m.role!==stroke.role),'Modulation of a stroke with mixed segment roles requires separate role strokes.');
      const answer=modulateStroke(stroke,modifiers,operation);
      if(answer.changed){changed=true;for(const m of modifiers.filter(m=>m.amplitude!==0)){
        used.add(m.id);applied.add(m.id);
        if(['displacement','width','flow'].includes(m.channel))materialChanged=true;
      }}
      maxExcursionMm=Math.max(maxExcursionMm,answer.maxExcursionMm);return answer.stroke;
    });
    if(!changed)return operation;
    changedOperations.push(operation.id);
    operationModifiers[operation.id]=[...applied];
    if(materialChanged)materialChangedOperations.push(operation.id);
    return {...operation,strokes,order:operation.order==='nearest'?'given':operation.order,modulationPendingPublication:materialChanged};
  });
  const changed=changedOperations.length>0,materialChanged=materialChangedOperations.length>0;
  const report={changed,materialChanged,maxExcursionMm,changedOperations,materialChangedOperations,operationModifiers,modifiers:[...used]};
  return {result:changed?{...result,operations,modulationPendingPublication:materialChanged}:result,report,invalidatedPublications:materialChanged};
}
