import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {generationFixture} from './workflow-generation-fixture.mjs';

async function snapshot(root,at=root,result={}){
  for(const entry of await readdir(at,{withFileTypes:true})){
    const path=join(at,entry.name),name=path.slice(root.length+1).replaceAll('\\','/');
    if(entry.isDirectory())await snapshot(root,path,result);
    else result[name]=createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}

test('a retired split-file bundle receives a compact message without rewriting files',async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  const {bundle,...plan}=JSON.parse(await f.read('plan.json'));
  await writeFile(join(f.directory,'plan.json'),JSON.stringify(plan));
  await writeFile(join(f.directory,'machine.json'),JSON.stringify(bundle.machine));
  const before=await snapshot(f.directory);
  await assert.rejects(f.api.loadBundle(f.directory),/^Error: Deprecated split-file print bundle\.$/);
  await assert.rejects(f.api.migrateBundle(f.directory),/^Error: Deprecated split-file print bundle\.$/);
  assert.deepEqual(await snapshot(f.directory),before);
});

test('current migration is an idempotent no-op',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const before=await snapshot(f.directory);
  const first=await f.api.migrateBundle(f.directory),second=await f.api.migrateBundle(f.directory);
  assert.equal(first.status,'current');assert.equal(second.status,'current');assert.deepEqual(await snapshot(f.directory),before);
});
