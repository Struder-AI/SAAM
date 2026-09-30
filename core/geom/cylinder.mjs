// A circle as a polyline within a chord tolerance.
import {requireThat} from './tolerance.mjs';
export function circlePoints(radius,center=[0,0],toleranceMm=0.01){
  requireThat(radius>0&&toleranceMm>0,'Invalid circle dimensions.');
  const count=Math.max(16,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-Math.min(toleranceMm,radius)/radius))));
  requireThat(Number.isSafeInteger(count),'Circle tolerance is too fine to resolve a representable segment count.');
  return Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count;return [center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a)];});
}
