// Geometry's certified local queries. Positive rational controls bound the
// complete curve; Bernstein derivative coefficients bound speed and length.
import {authoredNurbs,evaluateCurve} from './nurbs.mjs';
import {extract} from './curve-ops.mjs';
import {bernsteinProductWeights,restrictBezierLine} from './bezier-net.mjs';
import {distance,requireThat} from './tolerance.mjs';
import {dot,cross} from './frame.mjs';
import {ROUNDING_RELATIVE,ROUNDING_MM,FLOAT64_EPSILON} from '../dimensions.mjs';

const xyz=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export function prepareNumericalCurve(geometry){
  if(geometry.kind==='nurbs'){
    const {kind,...record}=geometry,native=authoredNurbs(record);
    requireThat(geometry.controlPoints.some(point=>point.some((v,k)=>v!==geometry.controlPoints[0][k])),'A stationary curve uses point geometry.');
    const [a,b]=native.domain,nativeKnots=[a,...[...new Set(native.knots)].filter(k=>k>a&&k<b),b];
    const parameters=nativeKnots.map(k=>(k-a)/(b-a)),breaks=parameters.slice(1,-1);
    requireThat(parameters.every((u,i)=>!i||u>parameters[i-1]),'Native knot intervals exceed source parameter precision.');
    const multiplicities=new Map();
    for(const knot of native.knots)if(knot>a&&knot<b)multiplicities.set(knot,(multiplicities.get(knot)??0)+1);
    requireThat([...multiplicities.values()].every(count=>count<native.order),'A curve must be continuous; split disconnected NURBS spans.');
    return {kind:'nurbs',native,breaks,parameters,nativeKnots,pieces:new Map()};
  }
  if(geometry.kind==='point'){requireThat(xyz(geometry.point),'Point curve needs finite XYZ.');return {kind:'point',point:geometry.point,breaks:[]};}
  requireThat(geometry.kind==='polyline'&&Array.isArray(geometry.points)&&geometry.points.length>=2&&geometry.points.every(xyz),'Polyline needs finite XYZ vertices.');
  const lengths=[0];
  for(const [i,p] of geometry.points.slice(1).entries()){
    const length=distance(geometry.points[i],p);requireThat(length>0,'Polyline vertices must have distinct neighbors.');lengths.push(lengths.at(-1)+length);
  }
  const parameters=lengths.map(length=>length/lengths.at(-1));
  requireThat(parameters.every((u,i)=>Number.isFinite(u)&&(!i||u>parameters[i-1])),'Polyline parameter precision cannot represent its distinct edges.');
  return {kind:'polyline',points:geometry.points,parameters,length:lengths.at(-1),breaks:parameters.slice(1,-1)};
}
function polylineIndex(curve,u,side){
  const state={lo:0,hi:curve.parameters.length-1};
  while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(curve.parameters[mid]<u||side==='right'&&curve.parameters[mid]===u)state.lo=mid;else state.hi=mid;}
  return state.lo;
}
export function numericalCurveAt(curve,u,side='right'){
  if(curve.kind==='point')return {point:curve.point,tangent:null,speed:0};
  if(curve.kind==='nurbs'){
    const [a,b]=curve.native.domain,result=evaluateCurve(curve.native,a+u*(b-a),side==='left');
    const speed=Math.hypot(...result.derivative)*(b-a);
    const norm=Math.hypot(...result.derivative);
    return {point:result.point,tangent:speed>0?result.derivative.map(v=>v/norm):null,speed};
  }
  const i=polylineIndex(curve,u,side),a=curve.points[i],b=curve.points[i+1],t=(u-curve.parameters[i])/(curve.parameters[i+1]-curve.parameters[i]);
  const norm=distance(a,b);
  return {point:a.map((v,k)=>v+(b[k]-v)*t),tangent:b.map((v,k)=>(v-a[k])/norm),speed:curve.length};
}
function pointChordDistance(p,a,b){
  const delta=b.map((v,i)=>v-a[i]),length2=dot(delta,delta),t=length2?Math.max(0,Math.min(1,dot(p.map((v,i)=>v-a[i]),delta)/length2)):0;
  return distance(p,a.map((v,i)=>v+t*delta[i]));
}
function nativeSpan(curve,u){
  const state={lo:0,hi:curve.parameters.length-1};
  while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(curve.parameters[mid]<=u)state.lo=mid;else state.hi=mid;}
  return state.lo;
}
function preparedNativePiece(curve,index){
  if(curve.pieces.has(index))return curve.pieces.get(index);
  const piece=extract(curve.native,curve.nativeKnots[index],curve.nativeKnots[index+1]),p=piece.order-1;
  requireThat(piece.n===piece.order,'Numerical range must stay within a native knot span.');
  const rows=Array.from({length:piece.n},(_,i)=>Array.from(piece.cp.slice(i*4,i*4+4)));
  const points=rows.map(row=>row.slice(0,3).map(v=>v/row[3])),origin=points[0];
  const local=rows.map(row=>row.slice(0,3).map((v,k)=>v-origin[k]*row[3]));
  const weights=rows.map(row=>row[3]);
  const coefficients=Array.from({length:2*p},()=>[0,0,0]),factors=bernsteinProductWeights(p-1,p);
  for(let i=0;i<p;i++)for(let j=0;j<=p;j++)for(let k=0;k<3;k++)
    coefficients[i+j][k]+=p*((local[i+1][k]-local[i][k])*weights[j]-(weights[i+1]-weights[i])*local[j][k])*factors[i][j];
  // Differentiate at the original knot-span scale, then restrict the derivative
  // field. Differencing already restricted positions destroys tiny movement.
  const rounding=FLOAT64_EPSILON*16*piece.order**3*Math.max(1,...points.flat().map(Math.abs));
  const result={rows,coefficients,rounding,from:curve.parameters[index],to:curve.parameters[index+1]};
  curve.pieces.set(index,result);return result;
}
function nativePiece(curve,from,to){
  const prepared=preparedNativePiece(curve,nativeSpan(curve,from));
  const domain=prepared.to-prepared.from,p=curve.native.order-1;
  const restricted=[(from-prepared.from)/domain,(to-prepared.from)/domain];
  const rows=restrictBezierLine(prepared.rows,restricted),coefficients=restrictBezierLine(prepared.coefficients,restricted);
  const weights=rows.map(row=>row[3]),points=rows.map(row=>row.slice(0,3).map(v=>v/row[3]));
  const low=[0,1,2].map(k=>Math.min(...coefficients.map(c=>c[k]))),high=[0,1,2].map(k=>Math.max(...coefficients.map(c=>c[k])));
  const numeratorLow=Math.hypot(...low.map((v,k)=>v>0?v:high[k]<0?-high[k]:0));
  const numeratorHigh=Math.max(...coefficients.map(c=>Math.hypot(...c)));
  const rounding=prepared.rounding;
  const minWeight=Math.min(...weights),maxWeight=Math.max(...weights);
  const speed=[Math.max(0,(numeratorLow/maxWeight**2-rounding)/domain),(numeratorHigh/minWeight**2+rounding)/domain];
  // Positive rational Bezier curves are variation diminishing: their arc
  // length is bounded by their Euclidean control polygon (Crofton formula).
  // This converges quadratically under subdivision, unlike a speed supremum.
  const polygon=points.slice(1).reduce((sum,point,i)=>sum+distance(points[i],point),0);
  const directions=coefficients.filter(vector=>Math.hypot(...vector)>0).map(vector=>{const norm=Math.hypot(...vector);return vector.map(v=>v/norm);});
  // Elevate X to degree p+1 and subtract W times the endpoint line. The
  // numerator's Bernstein hull bounds position error at the SAME parameter,
  // including rational speed variation and reversals hidden by chord distance.
  const interpolationNumerator=Array.from({length:p+2},(_,i)=>{
    const fraction=i/(p+1),left=rows[Math.min(i,p)],right=rows[Math.max(0,i-1)];
    return [0,1,2].map(k=>(1-fraction)*(left[k]-left[3]*points[0][k])+fraction*(right[k]-right[3]*points.at(-1)[k]));
  });
  const interpolationErrorMm=Math.max(...interpolationNumerator.map(vector=>Math.hypot(...vector)))/minWeight+rounding;
  return {bounds:{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))-rounding),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))+rounding)},
    lengthMm:[Math.max(0,distance(points[0],points.at(-1))-rounding,speed[0]*(to-from)),Math.min(speed[1]*(to-from),polygon+rounding)],speed,
    tangentCone:directions.length?normalCone(directions):{axis:[1,0,0],halfAngleRad:Math.PI},interpolationErrorMm,
    chordErrorMm:Math.max(...points.map(point=>pointChordDistance(point,points[0],points.at(-1))))+rounding};
}
function boundedNativePiece(curve,from,to,tolerance){
  const whole=nativePiece(curve,from,to);
  if(!tolerance||whole.lengthMm[1]-whole.lengthMm[0]<=tolerance)return whole;
  const mid=(from+to)/2;requireThat(mid>from&&mid<to,'Arc length cannot reach requested numerical precision.');
  const left=boundedNativePiece(curve,from,mid,tolerance/2),right=boundedNativePiece(curve,mid,to,tolerance/2);
  return {...whole,lengthMm:[left.lengthMm[0]+right.lengthMm[0],left.lengthMm[1]+right.lengthMm[1]],
    speed:[Math.min(left.speed[0],right.speed[0]),Math.max(left.speed[1],right.speed[1])]};
}
export function numericalCurveRange(curve,from,to,{lengthToleranceMm}={}){
  if(curve.kind==='point')return {bounds:{min:curve.point,max:curve.point},lengthMm:[0,0],speed:[0,0],tangentCone:null,chordErrorMm:0,interpolationErrorMm:0};
  const a=numericalCurveAt(curve,from).point,b=numericalCurveAt(curve,to,'left').point;
  if(curve.kind==='polyline'){
    const bounds={min:a.map((v,k)=>Math.min(v,b[k])),max:a.map((v,k)=>Math.max(v,b[k]))},state={error:0,interpolationError:0};
    const directions=[numericalCurveAt(curve,from).tangent,numericalCurveAt(curve,to,'left').tangent];
    const start=polylineIndex(curve,from,'right')+1,end=polylineIndex(curve,to,'left');
    for(let i=start;i<=end;i++){
      const point=curve.points[i];for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],point[k]);bounds.max[k]=Math.max(bounds.max[k],point[k]);}
      state.error=Math.max(state.error,pointChordDistance(point,a,b));
      const fraction=(curve.parameters[i]-from)/(to-from),linear=a.map((v,k)=>v+fraction*(b[k]-v));
      state.interpolationError=Math.max(state.interpolationError,distance(point,linear));
      directions.push(numericalCurveAt(curve,curve.parameters[i]).tangent);
    }
    const length=curve.length*(to-from);
    return {bounds,lengthMm:[length,length],speed:[curve.length,curve.length],tangentCone:normalCone(directions),chordErrorMm:state.error,interpolationErrorMm:state.interpolationError};
  }
  const cuts=[from,...curve.breaks.filter(u=>u>from&&u<to),to],pieces=cuts.slice(1).map((end,i)=>
    boundedNativePiece(curve,cuts[i],end,lengthToleranceMm?lengthToleranceMm*(end-cuts[i])/(to-from):null));
  const bounds={min:[0,1,2].map(k=>Math.min(...pieces.map(p=>p.bounds.min[k]))),max:[0,1,2].map(k=>Math.max(...pieces.map(p=>p.bounds.max[k])))};
  // The distance to a fixed segment is convex, hence its maximum on every
  // enclosure box is attained at a corner. Multi-span bounds use that hull.
  const corners=Array.from({length:8},(_,mask)=>[0,1,2].map(k=>mask&(1<<k)?bounds.max[k]:bounds.min[k]));
  const interpolationErrorMm=pieces.reduce((maximum,piece,i)=>{
    const start=numericalCurveAt(curve,cuts[i]).point,end=numericalCurveAt(curve,cuts[i+1],'left').point;
    const left=a.map((v,k)=>v+(b[k]-v)*(cuts[i]-from)/(to-from)),right=a.map((v,k)=>v+(b[k]-v)*(cuts[i+1]-from)/(to-from));
    return Math.max(maximum,piece.interpolationErrorMm+Math.max(distance(start,left),distance(end,right)));
  },0);
  return {bounds,lengthMm:[0,1].map(k=>pieces.reduce((sum,p)=>sum+p.lengthMm[k],0)),
    speed:[Math.min(...pieces.map(p=>p.speed[0])),Math.max(...pieces.map(p=>p.speed[1]))],
    tangentCone:combinedCones(pieces.map(piece=>piece.tangentCone)),interpolationErrorMm,
    chordErrorMm:pieces.length===1?pieces[0].chordErrorMm:Math.max(...corners.map(p=>pointChordDistance(p,a,b)))};
}
// Invert physical length in a source interval without treating normalized u as
// millimetres. Precision loss is explicit; close XYZ endpoints may hide a loop.
export function numericalCurveParameterAtLength(curve,from,to,distanceMm,{fromEnd=false,toleranceMm=ROUNDING_MM}={}){
  requireThat(Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to<=1&&from<to,'Arc-length inversion needs an increasing source interval.');
  requireThat(Number.isFinite(distanceMm)&&distanceMm>=0&&Number.isFinite(toleranceMm)&&toleranceMm>0,'Arc-length inversion needs finite distance and positive accuracy.');
  if(distanceMm===0)return fromEnd?to:from;
  if(curve.kind==='point')return fromEnd?from:to;
  if(curve.kind==='polyline')return fromEnd?Math.max(from,to-distanceMm/curve.length):Math.min(to,from+distanceMm/curve.length);
  const total=numericalCurveRange(curve,from,to,{lengthToleranceMm:toleranceMm/4}).lengthMm;
  if(distanceMm>=total[1])return fromEnd?from:to;
  const state={lo:from,hi:to};
  for(let u=(state.lo+state.hi)/2;u>state.lo&&u<state.hi;u=(state.lo+state.hi)/2){
    const range=numericalCurveRange(curve,fromEnd?u:from,fromEnd?to:u,{lengthToleranceMm:toleranceMm/4}).lengthMm;
    if(Math.max(Math.abs(range[0]-distanceMm),Math.abs(range[1]-distanceMm))<=toleranceMm)return u;
    if(range[1]<distanceMm){if(fromEnd)state.hi=u;else state.lo=u;}
    else if(range[0]>distanceMm){if(fromEnd)state.lo=u;else state.hi=u;}
    else return u;
  }
  throw Object.assign(Error('Physical curve distance is unresolved at source parameter precision.'),{code:'CURVE_LENGTH_UNRESOLVED',from,to,distanceMm});
}
function combinedCones(cones){
  const regular=cones.filter(Boolean);if(!regular.length)return null;
  const axis=regular[0].axis,state={angle:0};
  for(const cone of regular)state.angle=Math.max(state.angle,Math.atan2(Math.hypot(...cross(axis,cone.axis)),dot(axis,cone.axis))+cone.halfAngleRad);
  return {axis,halfAngleRad:Math.min(Math.PI,state.angle)};
}
export function normalCone(values){
  const norm=Math.hypot(...values[0]),axis=values[0].map(v=>v/norm);
  const angle=values.reduce((maximum,v)=>Math.max(maximum,Math.atan2(Math.hypot(...cross(axis,v)),dot(axis,v))),0);
  const bounded=angle===0?0:angle+ROUNDING_RELATIVE;
  return {axis,halfAngleRad:bounded>=Math.PI/2?Math.PI:bounded};
}
export function frameCone(values){
  const reference=values[0],from=[reference.toolAxis,reference.toolUp,cross(reference.toolAxis,reference.toolUp)];
  const state={angle:0};
  for(const value of values){
    const to=[value.toolAxis,value.toolUp,cross(value.toolAxis,value.toolUp)];
    const skew=from.reduce((sum,v,i)=>sum.map((value,k)=>value+cross(v,to[i])[k]),[0,0,0]);
    const angle=Math.atan2(Math.hypot(...skew)/2,Math.max(-1,Math.min(1,(from.reduce((sum,v,i)=>sum+dot(v,to[i]),0)-1)/2)));
    state.angle=Math.max(state.angle,angle);
  }
  // A geodesic ball of radius < pi/2 in SO(3) is convex. Larger endpoint
  // deviations require the complete group bound, including possible roll.
  const bounded=state.angle===0?0:state.angle+ROUNDING_RELATIVE;
  return {reference,halfAngleRad:bounded>=Math.PI/2?Math.PI:bounded};
}
