// Sub-deliverable "Hole transition operations" (map 4, Part edits -> Hole transitions): a
// membrane adds one span operation from the selected edges; the rest of the recipe is unchanged.
import '../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createExtensionBundle} from '../../../core/print/extension-edits.mjs';
import {prepareExtensionEdit} from '../../../core/extensions/contributions.mjs';

test('a membrane adds one span operation after the other assignments',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'saam-hole-transitions-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bin=await createExtensionBundle(resolve(dir,'print'),'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const curve=(id,y)=>({id,visible:true,closed:false,points:[[5,y,7],[35,y,7]]}),ready={assignment:'body'};
  const source={...bin.plan,geometry:{shape:'spatial',solid:bin.plan.geometry,curves:[curve('rim-a',8),curve('rim-b',30)],points:[]}};
  const {plan}=await prepareExtensionEdit(source,'hole-transitions',{strategy:'membrane',id:'cover',
    base:{geometry:'rim-a',readiness:ready,normal:[0,0,1]},target:{geometry:'rim-b',readiness:ready}});
  assert.deepEqual(plan.slices.assignments.map(a=>a.id),[...source.slices.assignments.map(a=>a.id),'cover']);
  assert.ok(plan.slices.assignments.at(-1).curves.every(curve=>curve.role==='bridge-span'));
  assert.deepEqual(plan.slices.assignments.slice(0,-1),source.slices.assignments);
  await assert.rejects(prepareExtensionEdit(source,'hole-transitions',{strategy:'membrane',id:'body',
    base:{geometry:'rim-a',readiness:ready,normal:[0,0,1]},target:{geometry:'rim-b',readiness:ready}}),/already in use/);
});
