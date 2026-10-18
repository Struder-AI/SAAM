import test from 'node:test';
import assert from 'node:assert/strict';
import {beadSection} from '../../studio/material-view.mjs';
const plan={geometry:{shape:'spline',patches:[]},placement:{xMm:0,yMm:0},process:{lineWidthMm:.4,layerMm:.2,firstLayerMm:.2},skills:{},slices:{assignments:[]}};
const move=(from,to,overrides={})=>({from,to,extruding:true,phase:'planar',layer:0,operation:'fill',...overrides});

test('source moves without an across-path surface frame draw no bead section',()=>{
  // Missing material frames retain the source line rather than inventing a section.
  assert.equal(beadSection(move([149.17954,103.90631,1.41404],[149.17954,103.90632,1.41404],
    {phase:'wave-overhangs',volumeMm3:0.00006379396581954265}),plan,{}),null);
  assert.equal(beadSection(move([0,0,1],[1,0,1.1],{phase:'curves'}),plan,{}),null);
  assert.equal(beadSection(move([0,0,1],[0,0,1]),plan,{}),null);
});
