// Sub-deliverable "Line text operations" (map 4, Part edits -> Line text): line text adds,
// replaces or removes its own lettering operation; other assignments are unchanged.
import '../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createExtensionBundle} from '../../../core/print/extension-edits.mjs';
import {prepareExtensionEdit} from '../../../core/extensions/contributions.mjs';

test('line text adds its lettering, replaces it in place, removes it, and refuses other operations',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'saam-line-text-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {plan:source}=await createExtensionBundle(resolve(dir,'print'),'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const request={id:'label',fontId:'hershey-sans-1',text:'HI',heightMm:6,beadRangeMm:[0.35,0.5],origin:[8,8,7],layers:2,layerMm:0.2};
  const added=(await prepareExtensionEdit(source,'line-text',request)).plan;
  assert.deepEqual(added.slices.assignments.map(a=>a.id),[...source.slices.assignments.map(a=>a.id),'label']);
  const label=added.slices.assignments.at(-1);
  assert.ok(label.curves.length>0&&label.curves.every(curve=>curve.role==='line-text'));
  const taller=(await prepareExtensionEdit(added,'line-text',{...request,layers:3})).plan;
  assert.deepEqual(taller.slices.assignments.map(a=>a.id),added.slices.assignments.map(a=>a.id));
  assert.equal(taller.slices.assignments.at(-1).repeat.count,3);
  const removed=(await prepareExtensionEdit(taller,'line-text',{id:'label',remove:true})).plan;
  assert.deepEqual(removed.slices.assignments,source.slices.assignments);
  await assert.rejects(prepareExtensionEdit(source,'line-text',{...request,id:'body'}),/another construction/);
});
