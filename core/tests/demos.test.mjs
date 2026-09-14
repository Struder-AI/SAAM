import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemos} from '../../examples/prints/create.mjs';
import {loadBundle} from '../print/bundle.mjs';

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
