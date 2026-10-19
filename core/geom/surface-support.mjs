// Separating support planes for closed rational surface solids. Control hulls
// bound every retained point; adaptive subdivision tightens only uncertain
// extrema. A sampled extremum can reject a candidate, never prove separation.
import {bezierPieces} from './surface-intersection.mjs';
import {splitBezierNet,evaluateBezierNet} from './bezier-net.mjs';
import {evaluate} from './nurbs.mjs';
import {dot,normalize} from './tolerance.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

const separationCache=new WeakMap();

export function separatingSurfacePlane(a,b){
  if(!separationCache.has(a))separationCache.set(a,new WeakMap());
  const cache=separationCache.get(a);if(cache.has(b))return cache.get(b);
  const result=findSeparatingPlane(a,b);cache.set(b,result);
  if(!separationCache.has(b))separationCache.set(b,new WeakMap());
  separationCache.get(b).set(a,result?{...result,normal:result.normal.map(value=>-value),offset:-result.offset}:null);
  return result;
}

function findSeparatingPlane(a,b){
  for(let axis=0;axis<3;axis++){
    if(a.bounds.max[axis]<=b.bounds.min[axis]+ROUNDING_MM)return {
      normal:[0,1,2].map(k=>k===axis?1:0),offset:(a.bounds.max[axis]+b.bounds.min[axis])/2,
      gapMm:b.bounds.min[axis]-a.bounds.max[axis],uncertaintyMm:0};
    if(b.bounds.max[axis]<=a.bounds.min[axis]+ROUNDING_MM)return {
      normal:[0,1,2].map(k=>k===axis?-1:0),offset:-(b.bounds.max[axis]+a.bounds.min[axis])/2,
      gapMm:a.bounds.min[axis]-b.bounds.max[axis],uncertaintyMm:0};
  }
  const candidates=[];
  const remember=direction=>{
    if(!direction||Math.hypot(...direction)<=ROUNDING_RELATIVE)return;
    const normal=normalize(direction);
    if(!candidates.some(prior=>Math.abs(dot(normal,prior))>=1-ROUNDING_RELATIVE))candidates.push(normal);
  };
  remember([0,1,2].map(k=>(b.bounds.min[k]+b.bounds.max[k]-a.bounds.min[k]-a.bounds.max[k])/2));
  for(const solid of [a,b])for(const patch of solid.patches){
    remember(evaluate(patch,(patch.domainU[0]+patch.domainU[1])/2,(patch.domainV[0]+patch.domainV[1])/2).normal);
  }
  for(const normal of candidates){
    const first=projectionPieces(a,normal),second=projectionPieces(b,normal);
    const maxSample=pieces=>pieces.reduce((value,piece)=>Math.max(value,piece.sampleMax),-Infinity);
    const minSample=pieces=>pieces.reduce((value,piece)=>Math.min(value,piece.sampleMin),Infinity);
    // Real samples already establish overlapping projection intervals. A more
    // accurate outer bound cannot make this direction a separating plane.
    if(maxSample(first)>minSample(second)+ROUNDING_MM&&maxSample(second)>minSample(first)+ROUNDING_MM)continue;
    for(const [left,right,sign] of [[first,second,1],[second,first,-1]]){
      if(maxSample(left)>minSample(right)+ROUNDING_MM)continue;
      const maximum=projectionMaximum(left,1),negativeMinimum=projectionMaximum(right,-1);
      if(!maximum||!negativeMinimum)continue;
      const gap=-negativeMinimum.upper-maximum.upper;
      if(gap < -ROUNDING_MM)continue;
      const midpoint=(maximum.upper-negativeMinimum.upper)/2;
      return {normal:normal.map(value=>value*sign),offset:midpoint*sign,gapMm:gap,
        uncertaintyMm:maximum.uncertainty+negativeMinimum.uncertainty};
    }
  }
  return null;
}

function projectionPieces(solid,normal){
  return solid.patches.flatMap(patch=>bezierPieces(patch).map(piece=>projectionPiece(
    piece.net.map(row=>row.map(point=>[dot(point.slice(0,3),normal),point[3]])),[piece.u,piece.v])));
}

function projectionPiece(net,ranges){
  const values=net.flat().map(point=>point[0]/point[1]);
  const midpoint=evaluateBezierNet(net,[.5,.5]),samples=[net[0][0],net[0].at(-1),net.at(-1)[0],net.at(-1).at(-1),midpoint].map(point=>point[0]/point[1]);
  const variationU=net[0].reduce((largest,_,j)=>{
    const column=net.map(row=>row[j][0]/row[j][1]);return Math.max(largest,Math.max(...column)-Math.min(...column));
  },0);
  const variationV=net.reduce((largest,row)=>{
    const values=row.map(point=>point[0]/point[1]);return Math.max(largest,Math.max(...values)-Math.min(...values));
  },0);
  return {net,ranges,upper:Math.max(...values),lower:Math.min(...values),sampleMax:Math.max(...samples),sampleMin:Math.min(...samples),axis:variationU>=variationV?0:1};
}

function projectionMaximum(input,sign){
  const pending=input.map(piece=>sign>0?piece:projectionPiece(piece.net.map(row=>row.map(point=>[-point[0],point[1]])),piece.ranges));
  const state={sample:pending.reduce((maximum,piece)=>Math.max(maximum,piece.sampleMax),-Infinity)};
  for(;;){
    const best=pending.reduce((index,piece,i)=>index<0||piece.upper>pending[index].upper?i:index,-1);
    if(best<0)return {upper:state.sample,uncertainty:0};
    const piece=pending[best];
    if(piece.upper-state.sample<=ROUNDING_MM/8)return {upper:Math.max(state.sample,piece.upper),uncertainty:Math.max(0,piece.upper-state.sample)};
    pending.splice(best,1);
    const [low,high]=piece.ranges[piece.axis],mid=(low+high)/2;
    if(!(mid>low&&mid<high))return null;
    const halves=splitBezierNet(piece.net,piece.axis);
    for(let side=0;side<2;side++){
      const ranges=piece.ranges.map((range,k)=>k!==piece.axis?range:side?[mid,high]:[low,mid]);
      const next=projectionPiece(halves[side],ranges);state.sample=Math.max(state.sample,next.sampleMax);
      if(next.upper>state.sample)pending.push(next);
    }
  }
}
