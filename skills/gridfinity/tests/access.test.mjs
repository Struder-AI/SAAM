import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadBundle} from '../../../core/print/bundle.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-gridfinity-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('CLI creates and edits a shared print from parameters; stale changes fail without altering it',async t=>{
  const parent=await fixture(t),dir=resolve(parent,'print'),request=resolve(parent,'parameters.json');
  await writeFile(request,JSON.stringify({kind:'blank'}));
  const cli=resolve(root,'skills/gridfinity/scripts/cli.mjs');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:tmpdir(),encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const state=run('create',dir,request,'--machine','ultimaker-s5');assert.equal(state.toolpathApproved,false);
  await writeFile(request,JSON.stringify({xUnits:2}));
  const next=run('update',dir,request,'--revision',state.revision);assert.notEqual(next.revision,state.revision);
  assert.throws(()=>run('update',dir,request,'--revision',state.revision),/stale/);
  assert.equal((await loadBundle(dir)).plan.geometry.parameters.xUnits,2);
});
