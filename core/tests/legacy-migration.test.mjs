import test from 'node:test';
import assert from 'node:assert/strict';
import {access,copyFile,mkdir,readFile,readdir,rm,writeFile,appendFile} from 'node:fs/promises';
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
  let state=await f.api.generateBundle(f.directory),approved=await f.api.approve(f.directory,{actor:'migration test',revision:(await f.api.loadBundle(f.directory)).revision});
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
  return {bundle,plan,oldGeometry,oldExport,approved,state};
}

test('legacy reads are effect-free and explicit migration retains sidecars while preserving checked approval',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f),before=await snapshot(f.directory);
  await assert.rejects(f.api.loadBundle(f.directory),/cli\.mjs migrate/);
  await assert.rejects(f.api.bundleFingerprints(f.directory),/cli\.mjs migrate/);
  assert.deepEqual(await snapshot(f.directory),before);

  const report=await f.api.migrateBundle(f.directory);
  assert.equal(report.status,'migrated');assert.deepEqual(report.removed,[]);assert.deepEqual(report.updated,['plan.json']);
  assert.ok(report.created.some(name=>name.startsWith('geometry/')));assert.ok(report.created.some(name=>name.startsWith('exports/')));
  for(const name of ['machine.json','review.json','checks.json','geometry/model.json',old.oldGeometry,old.oldExport,'keep-me.txt']){
    assert.ok(report.retained.includes(name),name);await access(join(f.directory,name));
  }
  let reopened=await f.api.loadBundle(f.directory,{program:'source'});
  assert.equal(reopened.programError,undefined);assert.equal(reopened.toolpathApproved,true);
  assert.equal(reopened.exportHash,old.bundle.review.generation.exportHash);
  await appendFile(join(f.directory,reopened.review.generation.file),'changed');
  reopened=await f.api.loadBundle(f.directory,{program:'source'});
  assert.match(reopened.programError,/Generated files changed/);assert.equal(reopened.toolpathApproved,false);
});

test('current migration is an idempotent no-op available through the CLI',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const before=await snapshot(f.directory);
  const first=await f.api.migrateBundle(f.directory),second=await f.api.migrateBundle(f.directory);
  assert.equal(first.status,'current');assert.equal(second.status,'current');assert.deepEqual(await snapshot(f.directory),before);
  const {stdout}=await exec(process.execPath,['core/print/cli.mjs','migrate',f.directory],{cwd:process.cwd()});
  assert.equal(JSON.parse(stdout).status,'current');assert.deepEqual(await snapshot(f.directory),before);
});

test('malformed legacy preflight leaves every original byte unchanged',async t=>{
  const f=await generationFixture();t.after(f.cleanup);await legacy(f);
  const descriptor=JSON.parse(await readFile(join(f.directory,'geometry/model.json'),'utf8'));
  descriptor.parameters={...descriptor.parameters,geometry:{shape:'different'}};
  await writeFile(join(f.directory,'geometry/model.json'),JSON.stringify(descriptor));
  const before=await snapshot(f.directory);
  await assert.rejects(f.api.migrateBundle(f.directory),/Plan and geometry disagree/);
  assert.deepEqual(await snapshot(f.directory),before);
});

test('migration rejects a concurrently changed legacy input without replacing its plan',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f),planBefore=await readFile(join(f.directory,'plan.json'));
  await assert.rejects(f.api.migrateBundle(f.directory,{beforeCommit:async()=>{
    await writeFile(join(f.directory,'review.json'),'{}');
  }}),/changed during migration: review\.json/);
  assert.deepEqual(await readFile(join(f.directory,'plan.json')),planBefore);
  for(const name of [old.bundle.geometry.file,old.bundle.review.generation.file])await assert.rejects(access(join(f.directory,name)));
});

test('migration rejects a checks file that appears after an absent preflight',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  await rm(join(f.directory,'checks.json'));const planBefore=await readFile(join(f.directory,'plan.json'));
  await assert.rejects(f.api.migrateBundle(f.directory,{beforeCommit:async()=>{
    await writeFile(join(f.directory,'checks.json'),'{}');
  }}),/changed during migration: checks\.json/);
  assert.deepEqual(await readFile(join(f.directory,'plan.json')),planBefore);
  for(const name of [old.bundle.geometry.file,old.bundle.review.generation.file])await assert.rejects(access(join(f.directory,name)));
});

test('stale legacy program remains retained but cannot carry approval into the manifest',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  const plan=JSON.parse(await readFile(join(f.directory,'plan.json'),'utf8'));
  plan.process.speed+=1;await writeFile(join(f.directory,'plan.json'),JSON.stringify(plan));
  const programBefore=await readFile(join(f.directory,old.oldExport));
  const report=await f.api.migrateBundle(f.directory);
  assert.equal(report.legacyProgram,'stale');assert.equal(report.verification.toolpathApproved,false);
  assert.match(report.verification.programError,/stale|settings changed|no longer matches/i);
  assert.deepEqual(await readFile(join(f.directory,old.oldExport)),programBefore);
  const state=await f.api.loadBundle(f.directory,{program:'source'});
  assert.equal(state.toolpathApproved,false);assert.match(state.programError,/stale|settings changed|no longer matches/i);
});

test('changed legacy program fails before writes and preserves every original byte',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  await appendFile(join(f.directory,old.oldExport),'corrupt');const before=await snapshot(f.directory);
  await assert.rejects(f.api.migrateBundle(f.directory),/Legacy generated files changed/);
  assert.deepEqual(await snapshot(f.directory),before);
});

test('migrated bundle cold-reopens in a fresh process with current-byte approval checks',async t=>{
  const f=await generationFixture();t.after(f.cleanup);const old=await legacy(f);
  await f.api.migrateBundle(f.directory);
  const script=`import {generationWorkflow} from './core/tests/workflow-generation-fixture.mjs';\nconst state=await generationWorkflow().api.loadBundle(process.argv[1],{program:'source'});\nconsole.log(JSON.stringify({approved:state.toolpathApproved,exportHash:state.exportHash,error:state.programError??null}));`;
  let result=JSON.parse((await exec(process.execPath,['--input-type=module','-e',script,f.directory],{cwd:process.cwd()})).stdout);
  assert.deepEqual(result,{approved:true,exportHash:old.bundle.review.generation.exportHash,error:null});
  const manifest=JSON.parse(await readFile(join(f.directory,'plan.json'),'utf8'));
  await appendFile(join(f.directory,manifest.bundle.review.generation.file),'changed');
  result=JSON.parse((await exec(process.execPath,['--input-type=module','-e',script,f.directory],{cwd:process.cwd()})).stdout);
  assert.equal(result.approved,false);assert.match(result.error,/Generated files changed/);
});
