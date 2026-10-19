import assert from 'node:assert/strict';
import {splineBlock} from './shapes.mjs';
// A 0.05 mm loop lies wholly inside two nonplanar faces. Its depth exceeds
// the Boolean accuracy, although its diameter is below the former seed grid.
export default async function(G){
 const q=[8,-8,8],bowl=splineBlock({runMm:1,widthMm:1,heightsMm:q.map(x=>q.map(y=>8.98+x+y))});
 const saddle=splineBlock({runMm:1,widthMm:1,heightsMm:[[9.03,9,8.97],[9,9,9],[8.97,9,9.03]]});
 return {name:'Hidden closed loop between a steep bowl and a shallow saddle',operation:'intersection',operands:[await G.buildGeometry(bowl),await G.buildGeometry(saddle)],
 verify(_G,body){assert.ok(body.intersections.some(curve=>curve.closed&&curve.points.every(point=>Math.hypot(point[0]-.5,point[1]-.5)<.1)),'The interior intersection loop must be discovered.');}};
}
