import {distance,requireThat} from '../geom/tolerance.mjs';
import {ActionAccumulator,planningResult,planContext,planTravel,planMove,planPark} from './planning.mjs';

// Profile-owned sacrificial strokes for the shared shell generator. Keep them
// in SAAMpath so export bounds, material, timing and Studio all see the same moves.
export function planPriming(state,geometryBounds,results) {
  const settings=state.machine.startup?.primingStrokes;
  if(!settings)return planningResult(state);
  const {lineLengthMm:length,clearanceMm:gap}=settings;
  requireThat(Number.isFinite(length)&&length>0&&Number.isFinite(gap)&&gap>0,'Invalid machine priming strokes.');
  const p=state.process;
  const footprint=preparePrimingFootprint(geometryBounds,results,p.lineWidthMm);
  if(!footprint.hasDeposition)return planningResult(state);
  const points=selectPrimingPath(footprint,state.position,state.motionBounds??state.machine.bounds,
    {lineLengthMm:length,clearanceMm:gap,widthMm:p.lineWidthMm,zMm:p.firstLayerMm});
  return emitPrimingPath(state,points);
}

export function preparePrimingFootprint(geometryBounds,results,widthMm) {
  const lo=[...geometryBounds.min],hi=[...geometryBounds.max];
  let hasDeposition=false;
  // Include supports/rims and every component, even when they extend beyond
  // the source geometry. Never consume a skirt into a later operation's footprint.
  for(const result of results)for(const op of result.operations)for(const stroke of op.strokes){
    if(stroke.stationaryExtrusion||stroke.beadAreaMm2>0||stroke.volumesMm3?.some(v=>v>0))hasDeposition=true;
    for(const point of stroke.points)for(let i=0;i<2;i++){
      lo[i]=Math.min(lo[i],point[i]-widthMm/2);hi[i]=Math.max(hi[i],point[i]+widthMm/2);
    }
  }
  return {min:lo,max:hi,hasDeposition};
}

export function selectPrimingPath(footprint,startPosition,bed,{lineLengthMm:length,clearanceMm:gap,widthMm:w,zMm:z}) {
  const candidates=[];
  // Two parallel passes connected at the far end, outside one side of the
  // complete footprint. Try all four sides instead of assuming a free front edge.
  for(const axis of [1,0])for(const sign of [-1,1]){
    const along=1-axis,edge=(sign<0?footprint.min[axis]:footprint.max[axis])+sign*(gap+w/2);
    const low=bed.min[along]+w/2,high=bed.max[along]-w/2-length;
    if(high<low)continue;
    const start=Math.max(low,Math.min(high,footprint.min[along]));
    const point=(a,b)=>{const q=[0,0,z];q[axis]=a;q[along]=b;return q;};
    const points=[point(edge,start),point(edge,start+length),point(edge+sign*w,start+length),point(edge+sign*w,start)];
    if(points.every(q=>q.every((v,i)=>v>=bed.min[i]+(i<2?w/2:0)&&v<=bed.max[i]-(i<2?w/2:0)))){
      // Either end is a valid start; prefer the shorter initial approach.
      if(distance(startPosition,points.at(-1))<distance(startPosition,points[0]))points.reverse();
      candidates.push(points);
    }
  }
  requireThat(candidates.length,'No room for machine priming strokes outside the part/support footprint; move or resize the part.');
  candidates.sort((a,b)=>distance(startPosition,a[0])-distance(startPosition,b[0]));
  return candidates[0];
}

export function emitPrimingPath(state,points) {
  const p=state.process,w=p.lineWidthMm,z=p.firstLayerMm;
  const contextual=planContext(state,'prime',0);
  const approached=planTravel(contextual.state,points[0],{maxCombMm:0}),actions=new ActionAccumulator();actions.add(approached.actions);
  let primeState=approached.state;
  for(const point of points.slice(1)){
    const deposited=planMove(primeState,point,p.firstLayerSpeedMmS,distance(primeState.position,point)*w*z,{role:'prime'});
    primeState=deposited.state;actions.add(deposited.actions);
  }
  const parked=planPark(primeState);actions.add(parked.actions);
  return planningResult({...parked.state,layerSeconds:0},actions.finish());
}
