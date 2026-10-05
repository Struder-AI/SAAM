import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadBundle} from '../../../core/print/bundle.mjs';
import {applyExtensionEdit,createExtensionBundle} from '../../../core/print/extension-edits.mjs';

async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-gridfinity-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('creates and edits a shared print from parameters; stale changes fail without altering it',async t=>{
  const dir=resolve(await fixture(t),'print');
  const state=await createExtensionBundle(dir,'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});assert.equal(state.toolpathApproved,false);
  const next=await applyExtensionEdit(dir,'gridfinity',{xUnits:2},{expectedRevision:state.revision});assert.notEqual(next.revision,state.revision);
  await assert.rejects(applyExtensionEdit(dir,'gridfinity',{xUnits:2},{expectedRevision:state.revision}),/stale/);
  assert.equal((await loadBundle(dir)).plan.geometry.parameters.xUnits,2);
});
