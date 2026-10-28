// Sub-deliverable "Canonical Paath operation" (map 4, Part edits -> Canonical Paath example).
// The example is installed into the test home's local extensions, as a contributor would.
import {home} from '../../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homePaths} from '../../../../core/application/home.mjs';
import {createExtensionBundle} from '../../../../core/print/extension-edits.mjs';
import {prepareExtensionEdit} from '../../../../core/extensions/contributions.mjs';

const example=fileURLToPath(new URL('..',import.meta.url));
await cp(example,resolve(homePaths(home).extensions,'canonical-paath'),{recursive:true,filter:path=>!path.includes('tests')});
const lengthOf=assignment=>assignment.entities.find(entity=>entity.id==='line').geometry.controlPoints.at(-1)[0];

test('the example adds its Paath operation, then changes it in place; other assignments stay',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'saam-canonical-paath-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {plan:source}=await createExtensionBundle(resolve(dir,'print'),'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const first=(await prepareExtensionEdit(source,'canonical-paath',{lengthMm:3})).plan;
  assert.deepEqual(first.slices.assignments.map(a=>a.id),[...source.slices.assignments.map(a=>a.id),'canonical']);
  assert.equal(lengthOf(first.slices.assignments.at(-1)),3);
  const second=(await prepareExtensionEdit(first,'canonical-paath',{lengthMm:4})).plan;
  assert.deepEqual(second.slices.assignments.map(a=>a.id),first.slices.assignments.map(a=>a.id));
  assert.equal(lengthOf(second.slices.assignments.at(-1)),4);
  assert.deepEqual(second.slices.assignments.slice(0,-1),source.slices.assignments);
  await assert.rejects(prepareExtensionEdit(source,'canonical-paath',{lengthMm:0}),/positive/);
});
