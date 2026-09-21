import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVaseSample} from '../scripts/vase-sample.mjs';
import {pointInRegion} from '../../../core/region/region2d.mjs';
test('Clark Y coupon retains its spar openings and single inset route through diagonal-cut transitions',async()=>{
 const {mesh,samples,report}=await buildVaseSample();
 assert.equal(report.parameters.chordMm,200);assert.equal(mesh.bounds.max[2],200);
 assert.equal(report.spars.length,2);assert.deepEqual(report.spars.map(s=>s.x),[60,120]);
 assert.deepEqual(report.rawSectionLoopCounts,{'1':1000});assert.equal(report.offsetFailures.length,0);assert.ok(report.criticalChecks>100);
 for(const sample of samples)for(const spar of report.spars){
  assert.equal(pointInRegion([spar.x,spar.y],sample.loops),false);
  assert.equal(pointInRegion([spar.x-2.6,spar.y],sample.loops),true);
 }
 // Changes at consecutive stations confirm moving cuts, not a static extrusion.
 assert.notDeepEqual(samples[100].loops,samples[101].loops);
});
