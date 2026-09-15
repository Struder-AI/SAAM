import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemos} from '../../examples/prints/create.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {surfaceDrapePlan} from '../../examples/prints/surface-drape/recipe.mjs';
import {buildShell} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {sampleTopSurface} from '../geom/query.mjs';

test('wavy roof valleys have a continuous downhill outlet within the skin slope limit',async()=>{
  const shell=buildShell(await rhino(),surfaceDrapePlan().geometry);
  const survey=sampleTopSurface(shell,{stepMm:2,maxSlopeDeg:15});
  assert.equal(survey.steep,0);
  for(const point of survey.samples)assert.ok(Math.abs(-point.normal[1]/point.normal[2]-0.1)<1e-7,'the roof falls continuously toward Y=0');
  const edge=survey.samples.filter(p=>p.y===0).map(p=>p.zMm);
  assert.ok(Math.max(...edge)-Math.min(...edge)>5,'the opening example has distinct waves');
});

test('demo workspaces start unapproved and recreating them preserves existing work',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-tour-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const [demo]=await createDemos('surface-drape',directory);
  const state=await loadBundle(demo.directory),original=await readFile(join(demo.directory,'plan.json'),'utf8');
  assert.equal(state.geometryApproved,false);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
  assert.equal(state.plan.geometry.shape,'spline-top');
  await assert.rejects(createDemos('all',directory),/already exists/);
  assert.equal(await readFile(join(demo.directory,'plan.json'),'utf8'),original);
});
