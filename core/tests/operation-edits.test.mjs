// Part edits' operation-edit path: an extension that sees only its request and SAAM's services
// changes named fields of the assignments it names; nothing else changes.
import {home} from './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {homePaths} from '../application/home.mjs';
import {createExtensionBundle} from '../print/extension-edits.mjs';
import {prepareExtensionEdit} from '../extensions/contributions.mjs';

const folder=resolve(homePaths(home).extensions,'probe-changes');
await mkdir(resolve(folder,'scripts'),{recursive:true});
await writeFile(resolve(folder,'SKILL.md'),['---','name: probe-changes','description: Test probe.','metadata:','  saam-kind: extension','---','','# Probe',''].join(String.fromCharCode(10)));
await writeFile(resolve(folder,'extension.json'),JSON.stringify({schema:'saam-extension/1',id:'probe-changes',dependencies:[],entries:{'operation-edit':{file:'scripts/edit.mjs',export:'edit'}}}));
await writeFile(resolve(folder,'scripts/edit.mjs'),`export async function edit(request,{Recipe}){
  const owner=Recipe.assignment(request.id);
  return {change:[{id:request.id,set:{fillDensity:request.fillDensity}}],report:{before:owner?.fillDensity??null}};
}`);

test('a named field of a named assignment changes; nothing else does; an unknown assignment fails',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'saam-operation-edits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {plan:source}=await createExtensionBundle(resolve(dir,'print'),'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const {plan,report}=await prepareExtensionEdit(source,'probe-changes',{id:'body',fillDensity:0.3});
  const [before]=source.slices.assignments,[after]=plan.slices.assignments;
  assert.equal(report.before,before.fillDensity);
  assert.equal(after.fillDensity,0.3);
  assert.deepEqual({...after,fillDensity:before.fillDensity},before);
  assert.equal(plan.slices.assignments.length,source.slices.assignments.length);
  await assert.rejects(prepareExtensionEdit(source,'probe-changes',{id:'missing',fillDensity:0.3}),/missing/);
});
