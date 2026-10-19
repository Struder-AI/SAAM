import assert from 'node:assert/strict';
import {cylinder,turn} from './shapes.mjs';
// A collar hides only the upper portion of a differently parameterized shaft.
export default async function(G){
  return {name:'Sliding collar with partial curved coincidence',operation:'difference',
    operands:[await G.buildGeometry(cylinder(G,{length:7})),await G.buildGeometry(turn(cylinder(G,{origin:[0,0,3.1],length:6}),.91))],
    verify(G,body){
      assert.equal(body.construction.recoveries.at(-1)?.method,'fuzzy','Partial coincidence should preserve placement.');
      assert.ok(G.section(body,G.horizontalSlice(3)).loops.length,'Shaft remains below the collar.');
      assert.equal(G.regionArea(G.section(body,G.horizontalSlice(3.2)).loops),0,'No shifted side-wall crescent remains above the collar.');
    }};
}
