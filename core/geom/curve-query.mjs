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
  const tangent=polylineTangent(a,b);
  return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],tangent,speed:curve.length};
}
function polylineTangent(a,b){
  const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],length=Math.hypot(x,y,z);
  return [x/length,y/length,z/length];
}
function pointChordDistance(p,a,b){
  const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],length2=x*x+y*y+z*z;
  const px=p[0]-a[0],py=p[1]-a[1],pz=p[2]-a[2];
  const t=length2?Math.max(0,Math.min(1,(px*x+py*y+pz*z)/length2)):0;
  return Math.hypot(px-t*x,py-t*y,pz-t*z);
}
// Exact projection for line pieces; positive-weight native bounds prune the
// remaining search. Tolerance controls optimization accuracy, never geometry.
export function numericalCurveClosestParameter(curve,from,to,point,{toleranceMm=ROUNDING_MM,maxDistanceMm=Infinity}={}){
  requireThat(xyz(point)&&Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&from<to&&to<=1&&Number.isFinite(toleranceMm)&&toleranceMm>0,'Closest-curve query needs a finite point, interval and positive tolerance.');
  requireThat(maxDistanceMm>=0,'Closest-curve distance bound must be nonnegative.');
  const best={u:from,distance:Infinity};
  const consider=u=>{const d=distance(point,numericalCurveAt(curve,u).point);if(d<best.distance){best.u=u;best.distance=d;}};
  consider(from);consider(to);
  if(curve.kind==='point')return best.distance<=maxDistanceMm?best.u:null;
  if(curve.kind==='polyline'){
    const cuts=[from,...interiorParameters(curve.breaks,from,to),to];
    for(let i=1;i<cuts.length;i++){
      const a=numericalCurveAt(curve,cuts[i-1]).point,b=numericalCurveAt(curve,cuts[i],'left').point,delta=b.map((v,k)=>v-a[k]),length2=dot(delta,delta);
      const t=length2?Math.max(0,Math.min(1,dot(point.map((v,k)=>v-a[k]),delta)/length2)):0;
      consider(cuts[i-1]+t*(cuts[i]-cuts[i-1]));
    }
    return best.distance<=maxDistanceMm?best.u:null;
  }
  const pending=[[from,to]];
  while(pending.length){
    const [a,b]=pending.pop(),bounds=numericalCurveRange(curve,a,b).bounds;
    const lower=Math.hypot(...point.map((v,k)=>Math.max(0,bounds.min[k]-v,v-bounds.max[k])));
    if(lower>maxDistanceMm||lower>=best.distance-toleranceMm)continue;
    const mid=(a+b)/2;
    requireThat(mid>a&&mid<b,'Closest-curve query is unresolved at parameter precision.');
    consider(mid);pending.push([mid,b],[a,mid]);
  }
  return best.distance<=maxDistanceMm?best.u:null;
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
  // A positive-weight degree-one span is a straight segment even when its
  // rational parameter speed varies. Fix its direction before restriction:
  // tiny subintervals must not turn roundoff into persistent angular spread.
  const line=p===1?points[1].map((v,k)=>v-points[0][k]):null,size=line?Math.hypot(...line):0;
  const lineCone=size>0?{axis:line.map(v=>v/size),halfAngleRad:0}:null;
  const result={rows,coefficients,rounding,lineCone,from:curve.parameters[index],to:curve.parameters[index+1]};
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
    tangentCone:prepared.lineCone??(directions.length?normalCone(directions):{axis:[1,0,0],halfAngleRad:Math.PI}),interpolationErrorMm,
    chordErrorMm:p===1?0:Math.max(...points.map(point=>pointChordDistance(point,points[0],points.at(-1))))+rounding};
}
// Absolute unit-tangent projection from derivative Bernstein hulls. Positive
// weights cancel in the ratio. A separating derivative direction supplies a
// norm lower bound even when a world-coordinate box contains the origin.
export function numericalCurveTangentProjection(curve,from,to,axis){
  if(curve.kind==='point')return 1;
  const cuts=[from,...interiorParameters(curve.breaks,from,to),to];let maximum=0;
  for(let i=1;i<cuts.length;i++){
    if(curve.kind==='polyline'){
      maximum=Math.max(maximum,Math.abs(dot(numericalCurveAt(curve,(cuts[i-1]+cuts[i])/2).tangent,axis)));continue;
    }
    const prepared=preparedNativePiece(curve,nativeSpan(curve,cuts[i-1])),span=prepared.to-prepared.from;
    const coefficients=restrictBezierLine(prepared.coefficients,[(cuts[i-1]-prepared.from)/span,(cuts[i]-prepared.from)/span]);
    const center=coefficients.reduce((sum,p)=>sum.map((v,k)=>v+p[k]),[0,0,0]),size=Math.hypot(...center);
    if(!size)return 1;
    const direction=center.map(v=>v/size),weight=Math.max(...prepared.rows.map(p=>p[3]));
    const guard=prepared.rounding*weight**2+FLOAT64_EPSILON*32*Math.max(...coefficients.map(p=>Math.hypot(...p)));
    const lower=Math.min(...coefficients.map(p=>dot(p,direction)))-guard;
    if(lower<=0)return 1;
    const upper=Math.max(...coefficients.map(p=>Math.abs(dot(p,axis))))+guard;
    maximum=Math.max(maximum,Math.min(1,upper/lower));
  }
  return maximum;
}
// Length has one physical error budget across the complete query. Parameter
// spans can be arbitrarily small without deserving sub-floating-point error
// budgets. Refine the largest uncertainty and retain all conservative bounds.
function boundedNativeLength(curve,cuts,pieces,tolerance){
  const gap=node=>node.range.lengthMm[1]-node.range.lengthMm[0],heap=[],leaves=new Set();
  const push=node=>{
    leaves.add(node);
    const floor=4*preparedNativePiece(curve,nativeSpan(curve,node.from)).rounding;
    if(gap(node)<=floor)return;
    let i=heap.length;heap.push(node);
    while(i){const parent=(i-1)>>1;if(gap(heap[parent])>=gap(node))break;heap[i]=heap[parent];i=parent;}
    heap[i]=node;
  };
  const pop=()=>{
    const node=heap[0],last=heap.pop();if(!heap.length)return node;
    let i=0;
    while(2*i+1<heap.length){let child=2*i+1;if(child+1<heap.length&&gap(heap[child+1])>gap(heap[child]))child++;
      if(gap(last)>=gap(heap[child]))break;heap[i]=heap[child];i=child;}
    heap[i]=last;return node;
  };
  const total=[0,1].map(k=>pieces.reduce((sum,piece)=>sum+piece.lengthMm[k],0)),bounded=[...total];
  if(!tolerance||bounded[1]-bounded[0]<=tolerance)return {lengthMm:bounded,speed:[Math.min(...pieces.map(p=>p.speed[0])),Math.max(...pieces.map(p=>p.speed[1]))]};
  pieces.forEach((range,i)=>push({from:cuts[i],to:cuts[i+1],range}));
  while(bounded[1]-bounded[0]>tolerance){
    if(!heap.length)throw Object.assign(Error('Arc length cannot reach requested numerical precision.'),{code:'CURVE_LENGTH_UNRESOLVED',lengthMm:bounded,toleranceMm:tolerance});
    const node=pop(),mid=(node.from+node.to)/2;
    if(!(mid>node.from&&mid<node.to))continue;
    const left={from:node.from,to:mid,range:nativePiece(curve,node.from,mid)},right={from:mid,to:node.to,range:nativePiece(curve,mid,node.to)};
    leaves.delete(node);push(left);push(right);
    for(let k=0;k<2;k++)total[k]+=left.range.lengthMm[k]+right.range.lengthMm[k]-node.range.lengthMm[k];
    bounded[0]=Math.max(bounded[0],total[0]);bounded[1]=Math.min(bounded[1],total[1]);
  }
  const ranges=[...leaves].map(node=>node.range);
  return {lengthMm:bounded,speed:[Math.min(...ranges.map(p=>p.speed[0])),Math.max(...ranges.map(p=>p.speed[1]))]};
}
function interiorParameters(parameters,from,to){
  const find=(value,upper)=>{let low=0,high=parameters.length;
    while(low<high){const mid=(low+high)>>1;if(parameters[mid]<value||upper&&parameters[mid]===value)low=mid+1;else high=mid;}return low;};
  return parameters.slice(find(from,true),find(to,false));
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
      directions.push(polylineTangent(curve.points[i],curve.points[i+1]));
    }
    const length=curve.length*(to-from);
    return {bounds,lengthMm:[length,length],speed:[curve.length,curve.length],tangentCone:normalCone(directions),chordErrorMm:state.error,interpolationErrorMm:state.interpolationError};
  }
  const cuts=[from,...interiorParameters(curve.breaks,from,to),to],pieces=cuts.slice(1).map((end,i)=>nativePiece(curve,cuts[i],end));
  const length=boundedNativeLength(curve,cuts,pieces,lengthToleranceMm);
  const bounds={min:[0,1,2].map(k=>Math.min(...pieces.map(p=>p.bounds.min[k]))),max:[0,1,2].map(k=>Math.max(...pieces.map(p=>p.bounds.max[k])))};
  // The distance to a fixed segment is convex, hence its maximum on every
  // enclosure box is attained at a corner. Multi-span bounds use that hull.
  const corners=Array.from({length:8},(_,mask)=>[0,1,2].map(k=>mask&(1<<k)?bounds.max[k]:bounds.min[k]));
  const interpolationErrorMm=pieces.reduce((maximum,piece,i)=>{
    const start=numericalCurveAt(curve,cuts[i]).point,end=numericalCurveAt(curve,cuts[i+1],'left').point;
    const left=a.map((v,k)=>v+(b[k]-v)*(cuts[i]-from)/(to-from)),right=a.map((v,k)=>v+(b[k]-v)*(cuts[i+1]-from)/(to-from));
    return Math.max(maximum,piece.interpolationErrorMm+Math.max(distance(start,left),distance(end,right)));
  },0);
  return {bounds,...length,
    tangentCone:combinedCones(pieces.map(piece=>piece.tangentCone)),interpolationErrorMm,
    chordErrorMm:pieces.length===1?pieces[0].chordErrorMm:Math.max(...corners.map(p=>pointChordDistance(p,a,b)))};
}
// A minimum-length decision needs neither a complete integral nor frame/bounds
// queries. Accept only a proved lower bound; uncertainty within rounding keeps
// the existing endpoint rather than creating a sub-resolution fragment.
export function numericalCurveHasLength(curve,from,to,minimumMm){
  requireThat(Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to<=1&&from<to&&Number.isFinite(minimumMm)&&minimumMm>=0,
    'Minimum curve length needs an increasing interval and finite nonnegative distance.');
  if(minimumMm===0)return true;
  if(curve.kind==='point')return false;
  if(curve.kind==='polyline')return curve.length*(to-from)>=minimumMm;
  const start=numericalCurveAt(curve,from).point,end=numericalCurveAt(curve,to,'left').point;
  const guard=FLOAT64_EPSILON*32*Math.max(1,...start.map(Math.abs),...end.map(Math.abs));
  if(distance(start,end)-guard>=minimumMm)return true;
  const cuts=[from,...interiorParameters(curve.breaks,from,to),to];let lower=0;
  for(let i=1;i<cuts.length;i++){
    const piece=preparedNativePiece(curve,nativeSpan(curve,cuts[i-1])),span=piece.to-piece.from;
    const rows=restrictBezierLine(piece.rows,[(cuts[i-1]-piece.from)/span,(cuts[i]-piece.from)/span]);
    const pending=[{rows,budget:ROUNDING_MM*(cuts[i]-cuts[i-1])/(to-from)}];
    while(pending.length){
      const {rows,budget}=pending.pop(),points=rows.map(row=>row.slice(0,3).map(v=>v/row[3]));
      const chord=Math.max(0,distance(points[0],points.at(-1))-piece.rounding);
      if(lower+chord>=minimumMm)return true;
      const polygon=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0)+piece.rounding;
      if(polygon-chord<=Math.max(budget,piece.rounding*2)||rows.length===2){lower+=chord;continue;}
      pending.push({rows:restrictBezierLine(rows,[.5,1]),budget:budget/2},
        {rows:restrictBezierLine(rows,[0,.5]),budget:budget/2});
    }
  }
  return false;
}

// Construction retains a native parameter only when its speed is bounded away
// from zero over every span. Unresolved sub-rounding movement uses the sampled
// construction instead; coincident endpoints alone cannot distinguish a loop
// from a singularity.
export function numericalCurveRegular(curve){
  if(curve.kind==='point')return false;
  if(curve.kind==='polyline')return true;
  const pending=curve.parameters.slice(1).map((to,i)=>[curve.parameters[i],to]);
  while(pending.length){
    const [from,to]=pending.pop(),range=numericalCurveRange(curve,from,to);
    if(range.speed[0]>0)continue;
    if(numericalCurveAt(curve,from).speed===0||numericalCurveAt(curve,to,'left').speed===0||
      range.speed[1]*(to-from)<=ROUNDING_MM)return false;
    const middle=(from+to)/2;
    if(!(middle>from&&middle<to))return false;
    pending.push([middle,to],[from,middle]);
  }
  return true;
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
  const norm=Math.hypot(...values[0]),axis=values[0].map(v=>v/norm),state={angle:0};
  for(const value of values){
    state.angle=Math.max(state.angle,Math.atan2(Math.hypot(...cross(axis,value)),dot(axis,value)));
    // This operation already returns the full cone beyond a hemisphere.
    // Later directions cannot widen it; stop inspecting them once it is full.
    if(state.angle>0&&state.angle+ROUNDING_RELATIVE>=Math.PI/2)return {axis,halfAngleRad:Math.PI};
  }
  return {axis,halfAngleRad:state.angle===0?0:state.angle+ROUNDING_RELATIVE};
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
