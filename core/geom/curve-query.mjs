// Geometry's certified local queries. Positive rational controls bound the
// complete curve; Bernstein derivative coefficients bound speed and length.
import {authoredNurbs,evaluateCurve} from './nurbs.mjs';
import {extract} from './curve-ops.mjs';
import {bernsteinProductWeights} from './bezier-net.mjs';
import {distance,requireThat} from './tolerance.mjs';
import {dot,cross,unitDirection} from './frame.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

const xyz=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export function prepareNumericalCurve(geometry){
  if(geometry.kind==='nurbs'){
    const {kind,...record}=geometry,native=authoredNurbs(record);
    const [a,b]=native.domain,breaks=[...new Set(native.knots)].filter(k=>k>a&&k<b).map(k=>(k-a)/(b-a));
    const multiplicities=new Map();
    for(const knot of native.knots)if(knot>a&&knot<b)multiplicities.set(knot,(multiplicities.get(knot)??0)+1);
    requireThat([...multiplicities.values()].every(count=>count<native.order),'A curve must be continuous; split disconnected NURBS spans.');
    return {kind:'nurbs',native,breaks};
  }
  if(geometry.kind==='point'){requireThat(xyz(geometry.point),'Point curve needs finite XYZ.');return {kind:'point',point:geometry.point,breaks:[]};}
  requireThat(geometry.kind==='polyline'&&Array.isArray(geometry.points)&&geometry.points.length>=2&&geometry.points.every(xyz),'Polyline needs finite XYZ vertices.');
  const lengths=[0];
  for(const [i,p] of geometry.points.slice(1).entries()){
    const length=distance(geometry.points[i],p);requireThat(length>0,'Polyline vertices must have distinct neighbors.');lengths.push(lengths.at(-1)+length);
  }
  const parameters=lengths.map(length=>length/lengths.at(-1));
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
function nativePiece(curve,from,to){
  const [a,b]=curve.native.domain,piece=extract(curve.native,a+from*(b-a),a+to*(b-a)),p=piece.order-1;
  requireThat(piece.n===piece.order,'Numerical range must stay within a native knot span.');
  const rows=Array.from({length:piece.n},(_,i)=>Array.from(piece.cp.slice(i*4,i*4+4))),weights=rows.map(row=>row[3]);
  const points=rows.map(row=>row.slice(0,3).map(v=>v/row[3])),origin=points[0];
  const local=rows.map(row=>row.slice(0,3).map((v,k)=>v-origin[k]*row[3]));
  const coefficients=Array.from({length:2*p},()=>[0,0,0]),factors=bernsteinProductWeights(p-1,p);
  for(let i=0;i<p;i++)for(let j=0;j<=p;j++)for(let k=0;k<3;k++)
    coefficients[i+j][k]+=p*((local[i+1][k]-local[i][k])*weights[j]-(weights[i+1]-weights[i])*local[j][k])*factors[i][j];
  const low=[0,1,2].map(k=>Math.min(...coefficients.map(c=>c[k]))),high=[0,1,2].map(k=>Math.max(...coefficients.map(c=>c[k])));
  const numeratorLow=Math.hypot(...low.map((v,k)=>v>0?v:high[k]<0?-high[k]:0));
  const numeratorHigh=Math.max(...coefficients.map(c=>Math.hypot(...c)));
  // Floating arithmetic guard, capped beneath the functional rounding class.
  const rounding=Math.min(ROUNDING_RELATIVE,Number.EPSILON*16*piece.order**3)*Math.max(1,...points.flat().map(Math.abs));
  const minWeight=Math.min(...weights),maxWeight=Math.max(...weights);
  const localSpeed=[Math.max(0,numeratorLow/maxWeight**2-rounding),numeratorHigh/minWeight**2+rounding];
  // Positive rational Bezier curves are variation diminishing: their arc
  // length is bounded by their Euclidean control polygon (Crofton formula).
  // This converges quadratically under subdivision, unlike a speed supremum.
  const polygon=points.slice(1).reduce((sum,point,i)=>sum+distance(points[i],point),0);
  return {bounds:{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))-rounding),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))+rounding)},
    lengthMm:[distance(points[0],points.at(-1)),Math.min(localSpeed[1],polygon+rounding)],speed:localSpeed.map(value=>value/(to-from)),
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
  if(curve.kind==='point')return {bounds:{min:curve.point,max:curve.point},lengthMm:[0,0],speed:[0,0],chordErrorMm:0};
  const a=numericalCurveAt(curve,from).point,b=numericalCurveAt(curve,to,'left').point;
  if(curve.kind==='polyline'){
    const bounds={min:a.map((v,k)=>Math.min(v,b[k])),max:a.map((v,k)=>Math.max(v,b[k]))},state={error:0};
    const start=polylineIndex(curve,from,'right')+1,end=polylineIndex(curve,to,'left');
    for(let i=start;i<=end;i++){
      const point=curve.points[i];for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],point[k]);bounds.max[k]=Math.max(bounds.max[k],point[k]);}
      state.error=Math.max(state.error,pointChordDistance(point,a,b));
    }
    const length=curve.length*(to-from);
    return {bounds,lengthMm:[length,length],speed:[curve.length,curve.length],chordErrorMm:state.error};
  }
  const cuts=[from,...curve.breaks.filter(u=>u>from&&u<to),to],pieces=cuts.slice(1).map((end,i)=>
    boundedNativePiece(curve,cuts[i],end,lengthToleranceMm?lengthToleranceMm*(end-cuts[i])/(to-from):null));
  const bounds={min:[0,1,2].map(k=>Math.min(...pieces.map(p=>p.bounds.min[k]))),max:[0,1,2].map(k=>Math.max(...pieces.map(p=>p.bounds.max[k])))};
  // The distance to a fixed segment is convex, hence its maximum on every
  // enclosure box is attained at a corner. Multi-span bounds use that hull.
  const corners=Array.from({length:8},(_,mask)=>[0,1,2].map(k=>mask&(1<<k)?bounds.max[k]:bounds.min[k]));
  return {bounds,lengthMm:[0,1].map(k=>pieces.reduce((sum,p)=>sum+p.lengthMm[k],0)),
    speed:[Math.min(...pieces.map(p=>p.speed[0])),Math.max(...pieces.map(p=>p.speed[1]))],
    chordErrorMm:pieces.length===1?pieces[0].chordErrorMm:Math.max(...corners.map(p=>pointChordDistance(p,a,b)))};
}
export function normalCone(values){
  const axis=values[0],angle=Math.max(...values.map(v=>Math.acos(Math.max(-1,Math.min(1,dot(axis,v))))));
  return {axis,halfAngleRad:angle>=Math.PI/2?Math.PI:angle};
}
export function frameCone(values){
  const reference=values[0],from=[reference.toolAxis,reference.toolUp,cross(reference.toolAxis,reference.toolUp)];
  const state={angle:0};
  for(const value of values){
    const to=[value.toolAxis,value.toolUp,cross(value.toolAxis,value.toolUp)];
    const angle=Math.acos(Math.max(-1,Math.min(1,(from.reduce((sum,v,i)=>sum+dot(v,to[i]),0)-1)/2)));
    state.angle=Math.max(state.angle,angle);
  }
  // A geodesic ball of radius < pi/2 in SO(3) is convex. Larger endpoint
  // deviations require the complete group bound, including possible roll.
  return {reference,halfAngleRad:state.angle>=Math.PI/2?Math.PI:state.angle};
}
