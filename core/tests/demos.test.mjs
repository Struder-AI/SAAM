import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceDrapePlan} from '../../examples/prints/surface-drape/recipe.mjs';
import {buildShell} from '../geom/build.mjs';
import {rhino} from '../geom/runtime.mjs';
import {sampleTopSurface} from '../geom/query.mjs';

test('wavy roof valleys have a continuous downhill outlet within the skin slope limit',async()=>{
  const shell=buildShell(await rhino(),surfaceDrapePlan().geometry);
  const survey=sampleTopSurface(shell,{stepMm:2,maxSlopeDeg:15});
  assert.equal(survey.steep,0);
  for(const point of survey.samples)assert.ok(Math.abs(-point.normal[1]/point.normal[2]-0.1)<1e-7,'the roof falls continuously toward Y=0');
  const edge=survey.samples.filter(p=>p.y===0).map(p=>p.zMm);
  assert.ok(Math.max(...edge)-Math.min(...edge)>5,'the opening example has distinct waves');
});
