// Sub-deliverable "Bridging operations" (map 4, Part edits -> Bridging): bridging adds one
// Trace operation of bridge spans; the rest of the recipe is unchanged.
import '../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createExtensionBundle} from '../../../core/print/extension-edits.mjs';
import {prepareExtensionEdit} from '../../../core/extensions/contributions.mjs';

async function spanned(t){
  const dir=await mkdtemp(resolve(tmpdir(),'saam-bridging-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bin=await createExtensionBundle(resolve(dir,'print'),'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const curve=(id,y)=>({id,visible:true,closed:false,points:[[5,y,7],[35,y,7]]});
  return {...bin.plan,geometry:{shape:'spatial',solid:bin.plan.geometry,curves:[curve('rim-a',8),curve('rim-b',30)],points:[]}};
}
const ready={assignment:'body'};
const request={id:'bridge',base:{geometry:'rim-a',readiness:ready,normal:[0,0,1]},target:{geometry:'rim-b',readiness:ready}};

test('bridging adds one span operation after the other assignments, prerequisite on its edges',async t=>{
  const source=await spanned(t),{plan}=await prepareExtensionEdit(source,'bridging',request);
  const ids=plan.slices.assignments.map(a=>a.id);
  assert.deepEqual(ids,[...source.slices.assignments.map(a=>a.id),'bridge']);
  const bridge=plan.slices.assignments.at(-1);
  assert.equal(bridge.construction,'curves');
  assert.ok(bridge.curves.length>0&&bridge.curves.every(curve=>curve.role==='bridge-span'));
  assert.ok(bridge.after.some(after=>JSON.stringify(after)===JSON.stringify(ready)));
  assert.deepEqual(plan.slices.assignments.slice(0,-1),source.slices.assignments);
});

test('an ID already in use fails',async t=>{
  const source=await spanned(t);
  await assert.rejects(prepareExtensionEdit(source,'bridging',{...request,id:'body'}),/already in use/);
});
