import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {access,copyFile,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {generationFixture} from './workflow-generation-fixture.mjs';

const exec=promisify(execFile),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function snapshot(root,at=root,result={}){
  for(const entry of await readdir(at,{withFileTypes:true})){
    const path=join(at,entry.name),name=path.slice(root.length+1).replaceAll('\\','/');
    if(entry.isDirectory())await snapshot(root,path,result);else result[name]=digest(await readFile(path));
  }
  return result;
}
async function legacy(f,{unknown=true}={}){
  let state=await f.api.commitGeneration(f.directory,await f.api.prepareGeneration(f.directory));
  const manifest=JSON.parse(await f.read('plan.json')),{bundle,...plan}=manifest,native=bundle.geometry.descriptor.nativeFile??'model.3dm';
  const oldGeometry=`geometry/${native}`,oldExport=`exports/${plan.output}/part.gcode`;
  await mkdir(dirname(join(f.directory,oldExport)),{recursive:true});
  await Promise.all([copyFile(join(f.directory,bundle.geometry.file),join(f.directory,oldGeometry)),
    copyFile(join(f.directory,bundle.review.generation.file),join(f.directory,oldExport))]);
  await Promise.all([writeFile(join(f.directory,'machine.json'),JSON.stringify(bundle.machine)),
    writeFile(join(f.directory,'review.json'),JSON.stringify({...bundle.review,generation:{...bundle.review.generation,file:undefined,checks:undefined}})),
    writeFile(join(f.directory,'checks.json'),JSON.stringify(bundle.review.generation.checks)),
    writeFile(join(f.directory,'geometry/model.json'),JSON.stringify(bundle.geometry.descriptor)),
    writeFile(join(f.directory,'plan.json'),JSON.stringify(plan)),
    unknown?writeFile(join(f.directory,'keep-me.txt'),'unknown retained file'):Promise.resolve()]);
  await Promise.all([rm(join(f.directory,bundle.geometry.file)),rm(join(f.directory,bundle.review.generation.file))]);
  return {bundle,plan,oldGeometry,oldExport,state};
}

test('legacy reads are effect-free and explicit migration retains sidecars and the current program',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f),before=await snapshot(f.directory);
  await assert.rejects(f.api.loadBundle(f.directory),/migrate_bundle/);
  assert.deepEqual(await snapshot(f.directory),before);

  const report=await f.api.migrateBundle(f.directory);
  assert.equal(report.status,'migrated');assert.deepEqual(report.removed,[]);assert.deepEqual(report.updated,['plan.json']);
  assert.ok(report.created.some(name=>name.startsWith('geometry/')));assert.ok(report.created.some(name=>name.startsWith('exports/')));
  for(const name of ['machine.json','review.json','checks.json','geometry/model.json',old.oldGeometry,old.oldExport,'keep-me.txt']){
    assert.ok(report.retained.includes(name),name);await access(join(f.directory,name));
  }
  const reopened=await f.api.loadBundle(f.directory,{program:'source'});
  assert.equal(reopened.programError,undefined);assert.equal(reopened.artifacts.program,'current');
});

test('current migration is an idempotent no-op',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const before=await snapshot(f.directory);
  const first=await f.api.migrateBundle(f.directory),second=await f.api.migrateBundle(f.directory);
  assert.equal(first.status,'current');assert.equal(second.status,'current');assert.deepEqual(await snapshot(f.directory),before);
});

test('migration rejects a concurrently changed legacy input without replacing its plan',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f),planBefore=await readFile(join(f.directory,'plan.json'));
  await assert.rejects(f.api.migrateBundle(f.directory,{beforeCommit:async()=>{
    await writeFile(join(f.directory,'review.json'),'{}');
  }}),/changed during migration: review\.json/);
  assert.deepEqual(await readFile(join(f.directory,'plan.json')),planBefore);
});

test('migration rejects a checks file that appears after an absent preflight',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  await rm(join(f.directory,'checks.json'));const planBefore=await readFile(join(f.directory,'plan.json'));
  await assert.rejects(f.api.migrateBundle(f.directory,{beforeCommit:async()=>{
    await writeFile(join(f.directory,'checks.json'),'{}');
  }}),/changed during migration: checks\.json/);
  assert.deepEqual(await readFile(join(f.directory,'plan.json')),planBefore);
});

test('migrated bundle cold-reopens in a fresh process',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  await f.api.migrateBundle(f.directory);
  const script=`import {generationWorkflow} from './core/tests/workflow-generation-fixture.mjs';\nconst state=await generationWorkflow().api.loadBundle(process.argv[1],{program:'source'});\nconsole.log(JSON.stringify({outputId:state.outputId,error:state.programError??null}));`;
  const result=JSON.parse((await exec(process.execPath,['--input-type=module','-e',script,f.directory],{cwd:process.cwd()})).stdout);
  const manifest=JSON.parse(await readFile(join(f.directory,'plan.json'),'utf8'));
  assert.deepEqual(result,{outputId:manifest.bundle.review.generation.exportHash,error:null});
});
