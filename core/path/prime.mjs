import {distance,requireThat} from '../private/toolpath/numeric.mjs';

import {ActionAccumulator,planningResult,planContext,planTravel,planMove,planPark} from './planning.mjs';

// Profile-owned sacrificial strokes for the shared shell generator. Keep them
// in SAAMpath so export bounds, material, timing and Studio all see the same moves.
export function planPriming(state,geometryBounds,results) {
  const settings=state.machine.startup?.primingStrokes;
  if(!settings)return planningResult(state);
  const {lineLengthMm:length,clearanceMm:gap}=settings;
  requireThat(Number.isFinite(length)&&length>0&&Number.isFinite(gap)&&gap>0,'Invalid machine priming strokes.');
  const p=state.process;
  const bed=state.motionBounds??state.machine.bounds,w=p.lineWidthMm,z=p.firstLayerMm;
  const candidates=[];
  for(const axis of [1,0])for(const sign of [-1,1]){
    const along=1-axis,edge=sign<0?bed.min[axis]+w/2:bed.max[axis]-w/2,start=bed.min[along]+w/2;
    const point=(a,b)=>{const q=[0,0,z];q[axis]=a;q[along]=b;return q;};
    const points=[point(edge,start),point(edge,start+length),point(edge-sign*w,start+length),point(edge-sign*w,start)];
    if(points.every(q=>q.every((v,i)=>v>=bed.min[i]+(i<2?w/2:0)&&v<=bed.max[i]-(i<2?w/2:0)))){
      if(distance(state.position,points.at(-1))<distance(state.position,points[0]))points.reverse();candidates.push(points);
    }
  }
  requireThat(candidates.length,'No room for the machine priming lane inside the selected tool bounds.');
  candidates.sort((a,b)=>distance(state.position,a[0])-distance(state.position,b[0]));
  const points=candidates[0];
  if(results)validatePrimingClearance(points,geometryBounds,results,w,gap);
  const emitted=emitPrimingPath(state,points);return {...emitted,points};
}

export function preparePrimingFootprint(geometryBounds,results,widthMm) {
  const lo=[...(geometryBounds?.min??[Infinity,Infinity,Infinity])],hi=[...(geometryBounds?.max??[-Infinity,-Infinity,-Infinity])];
  let hasDeposition=false;
  // Include supports/rims and every component, even when they extend beyond
  // the source geometry. Never consume a skirt into a later operation's footprint.
  for(const result of results)for(const op of result.operations)for(const stroke of op.strokes){
    const radius=(stroke.segmentMetadata??[]).reduce((width,m)=>Math.max(width,m.beadWidthMm??0),Math.max(widthMm,stroke.beadWidthMm??0))/2;
    if(stroke.stationaryExtrusion||stroke.beadAreaMm2>0||stroke.volumesMm3?.some(v=>v>0))hasDeposition=true;
    for(const point of stroke.points)for(let i=0;i<2;i++){
      lo[i]=Math.min(lo[i],point[i]-radius);hi[i]=Math.max(hi[i],point[i]+radius);
    }
  }
  return {min:lo,max:hi,hasDeposition};
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

export function validatePrimingClearance(points,geometryBounds,results,widthMm,gap){
  if(!points?.length)return;
  const footprint=preparePrimingFootprint(geometryBounds,results,widthMm);
  const separate=[0,1].some(axis=>Math.max(...points.map(p=>p[axis]))+widthMm/2+gap<=footprint.min[axis]||Math.min(...points.map(p=>p[axis]))-widthMm/2-gap>=footprint.max[axis]);
  requireThat(separate,'The fixed machine priming lane overlaps the complete part/support/deposition footprint; move or resize the part, or author an explicit prime line.');
}
