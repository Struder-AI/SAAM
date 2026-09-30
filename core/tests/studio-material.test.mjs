import test from 'node:test';
import assert from 'node:assert/strict';
import {beadSection} from '../../studio/material-view.mjs';
const plan={geometry:{shape:'pipe'},placement:{xMm:0,yMm:0},process:{lineWidthMm:.4,layerMm:.2,firstLayerMm:.2,skinNormalMm:.2},skills:{'pipe-cladding':{normalMm:.2}},setup:{denso:{rotaryCenterMm:[0,0,0]}}};
const move=(from,to,overrides={})=>({from,to,extruding:true,phase:'planar',layer:0,operation:'fill',...overrides});

test('source moves without an across-path surface frame draw no bead section',()=>{
  // A rounded E quantum on this short Y move used to be drawn as a broad
  // X ribbon. Wave source has no across-path surface frame; show its actual
  // centerline through the existing curved-surface fallback instead.
  assert.equal(beadSection(move([149.17954,103.90631,1.41404],[149.17954,103.90632,1.41404],
    {phase:'wave-overhangs',volumeMm3:0.00006379396581954265}),plan,{}),null);
  assert.equal(beadSection(move([0,0,1],[1,0,1.1],{phase:'draped-skin'}),plan,{}),null);
  assert.equal(beadSection(move([0,0,1],[0,0,1]),plan,{}),null);
});
