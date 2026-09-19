import test from 'node:test';
import assert from 'node:assert/strict';
import {toolpathPresentation} from '../../studio/toolpath-view.mjs';
import {frameAtTime} from '../../studio/playback.mjs';

test('presentation frame preserves active/finishing layer and partial endpoints without mutating inputs',()=>{
  const moves=Object.freeze([
    {from:[0,0,0],to:[10,0,0],startSeconds:0,durationSeconds:1,extruding:true,phase:'planar',layer:0},
    {from:[10,0,0],to:[10,10,0],startSeconds:1,durationSeconds:1,extruding:false,phase:'travel',layer:1},
    {from:[10,10,0],to:[0,10,0],startSeconds:2,durationSeconds:1,extruding:true,phase:'planar',layer:1},
    {from:[0,10,0],to:[0,10,5],startSeconds:3,durationSeconds:1,extruding:false,phase:'finish',layer:1},
  ].map(move=>Object.freeze({...move,from:Object.freeze(move.from),to:Object.freeze(move.to)})));
  const segments=Object.freeze([{from:moves[0].from,to:moves[0].to,first:0,last:0}]);
  for(const seconds of [0,.5,1,1.5,2,2.5,3,3.5,4]) {
    const at=Object.freeze(frameAtTime(moves,seconds));
    for(const partial of [undefined,...(at.completed<moves.length?[Object.freeze({from:moves[0].from,to:moves[2].to,first:0,last:2})]:[])]) {
      const detail=Object.freeze({segments,...(partial?{partial}:{})}),before=JSON.stringify({moves,at,detail});
      const result=toolpathPresentation(moves,at,detail);
      assert.equal(result.current,moves[at.active]);
      assert.equal(result.currentLayer,result.current?.phase==='finish'?moves[2]:result.current);
      if(partial){assert.notEqual(result.displayed,segments);assert.equal(result.displayed.at(-1).to,moves[at.completed].from);}
      else assert.equal(result.displayed,segments,'unchanged detail is shared without copying');
      assert.equal(JSON.stringify({moves,at,detail}),before);
    }
  }
  assert.deepEqual(toolpathPresentation([],{}, {segments:[]}),{displayed:[],current:undefined,currentLayer:undefined});
});
