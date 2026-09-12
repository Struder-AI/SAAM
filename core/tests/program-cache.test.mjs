import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createBundleWorkflow} from '../print/workflow.mjs';
import {defaults,validatePlan,VERSION,BUILD_DATE} from '../../skills/wedge-demo/scripts/model.mjs';
import {createGeometry,verifyGeometry} from '../../skills/wedge-demo/scripts/geometry.mjs';
import {generatePath} from '../../skills/wedge-demo/scripts/path.mjs';
import * as shellBundle from '../print/bundle.mjs';
import {defaults as shellDefaults} from '../print/plan.mjs';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {attachCheckedProgramWorker,checkedSourceFor} from '../print/program-handoff.mjs';
import {planarWallTolerance} from '../machine/rules.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value,function(_k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;})).digest('hex');
test('unchanged bundle inputs validate once; approvals and reloads reuse those checks',async t=>{
 let geometryChecks=0,planChecks=0;
 const workflow=createBundleWorkflow({kind:'wedge',defaults,
   validatePlan:(...args)=>{planChecks++;return validatePlan(...args);},createGeometry,
   verifyGeometry:(...args)=>{geometryChecks++;return verifyGeometry(...args);},generatePath,
   version:VERSION,buildDate:BUILD_DATE,exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
 const dir=await mkdtemp(resolve(tmpdir(),'saam-input-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await workflow.initBundle(dir);planChecks=0;
 const first=await workflow.loadBundle(dir);assert.equal(geometryChecks,1);assert.equal(planChecks,1);
 first.plan.process.layerMm=99;first.geometry.parameters.widthMm=999;
 let state=await workflow.loadBundle(dir);assert.notEqual(state.plan.process.layerMm,99);
 state=await workflow.approve(dir,{stage:'geometry',actor:'SYNTHETIC TEST ONLY',revision:state.revision});
 await workflow.approve(dir,{stage:'plan',actor:'SYNTHETIC TEST ONLY',revision:state.revision});
 assert.equal(geometryChecks,1);assert.equal(planChecks,1);
 await assert.rejects(workflow.approve(dir,{stage:'plan',actor:'SYNTHETIC TEST ONLY',revision:first.revision}),/stale/);
 const planFile=resolve(dir,'plan.json'),plan=JSON.parse(await readFile(planFile,'utf8'));
 plan.process.layerMm=.1;await writeFile(planFile,JSON.stringify(plan));
 assert.equal((await workflow.loadBundle(dir)).planApproved,false);assert.equal(planChecks,2);assert.equal(geometryChecks,1);
 const descriptorFile=resolve(dir,'geometry/model.json'),descriptor=await readFile(descriptorFile,'utf8');
 const altered=JSON.parse(descriptor);altered.fileHash='invalid';await writeFile(descriptorFile,JSON.stringify(altered));
 await assert.rejects(workflow.loadBundle(dir),/Geometry file changed/);assert.equal(geometryChecks,2);
 await writeFile(descriptorFile,descriptor);
 const native=resolve(dir,'geometry/model.mesh.json');
 const bytes=await readFile(native);await writeFile(native,Buffer.concat([bytes,Buffer.from(' ')]));
 await assert.rejects(workflow.loadBundle(dir),/Geometry file changed/);
});
test('warm and cold opening check the export without reslicing or an intermediate path',async t=>{
 let generations=0;
 const make=()=>createBundleWorkflow({kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,
   generatePath:async(...args)=>{generations++;return generatePath(...args);},version:VERSION,buildDate:BUILD_DATE,
   exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
 const workflow=make(),dir=await mkdtemp(resolve(tmpdir(),'saam-cache-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await workflow.initBundle(dir);await workflow.generateBundle(dir,{development:true});
 const first=await workflow.loadBundle(dir);assert.ok(first.program);assert.equal(generations,1);
 first.program.moves[0].to[0]=99999;first.pathSummary.tampered=true;
 const second=await workflow.loadBundle(dir);assert.notEqual(second.program.moves[0].to[0],99999);assert.equal(second.pathSummary.tampered,undefined);
 assert.equal(generations,1,'warm load must not reslice');
 assert.ok((await make().loadBundle(dir)).program);assert.equal(generations,1,'cold opening must interpret the export without reslicing');
 const file=resolve(dir,'path.saampath');await assert.rejects(readFile(file),{code:'ENOENT'});
 // Legacy intermediate files have no role in export identity or playback.
 const fingerprint=await workflow.bundleFingerprint(dir);
 await writeFile(file,'obsolete intermediate');
 assert.equal(await workflow.bundleFingerprint(dir),fingerprint);
 assert.ok((await workflow.loadBundle(dir)).program);
 const reviewFile=resolve(dir,'review.json'),review=JSON.parse(await readFile(reviewFile,'utf8'));
 const exportFile=resolve(dir,'exports/griffin-gcode/wedge.gcode'),code=await readFile(exportFile,'utf8');
 await writeFile(exportFile,code+'; changed\n');
 assert.match((await workflow.loadBundle(dir)).programError,/files changed/);
 // A supplied digest cannot bypass command validation. This is an integrity
 // record, not a signature proving which generator created an arbitrary file.
 const invalid=code.replace('M109 T1 S215','M109 T1 S0');
 await writeFile(exportFile,invalid);review.generation.exportHash=hash(invalid);await writeFile(reviewFile,JSON.stringify(review));
 assert.match((await workflow.loadBundle(dir)).programError,/planned temperature/);
 assert.match((await make().loadBundle(dir)).programError,/planned temperature/);
 assert.equal(generations,1);
 await workflow.generateBundle(dir,{development:true});
 await assert.rejects(readFile(file),{code:'ENOENT'});
});

test('checked preparation is reused only for exact current inputs and never grants approval',async t=>{
 let generations=0;
 const workflow=createBundleWorkflow({kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,
   generatePath:async(...args)=>{generations++;return generatePath(...args);},version:VERSION,buildDate:BUILD_DATE,
   exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
 const dir=await mkdtemp(resolve(tmpdir(),'saam-prepared-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await workflow.initBundle(dir);
 const reviewBefore=await readFile(resolve(dir,'review.json'));
 const checked=await workflow.checkPathBundle(dir);checked.exportSummary.moves=-1;
 assert.equal(generations,1);
 assert.deepEqual(await readFile(resolve(dir,'review.json')),reviewBefore);
 await assert.rejects(readFile(resolve(dir,'exports/griffin-gcode/wedge.gcode')),{code:'ENOENT'});
 assert.notEqual((await workflow.checkPathBundle(dir)).exportSummary.moves,-1);
 assert.equal(generations,1);
 await assert.rejects(workflow.generateBundle(dir),/Approve the geometry/);
 let state=await workflow.loadBundle(dir);
 for(const stage of ['geometry','plan'])state=await workflow.approve(dir,{stage,actor:'SYNTHETIC preparation test',revision:state.revision});
 const planFile=resolve(dir,'plan.json'),plan=JSON.parse(await readFile(planFile,'utf8'));
 await writeFile(planFile,JSON.stringify(plan));
 const reformatted=await workflow.loadBundle(dir);
 assert.equal(reformatted.planHash,state.planHash);assert.equal(reformatted.planApproved,true);
 await workflow.generateBundle(dir);assert.equal(generations,1,'approval and JSON formatting must reuse the checked commands');
 assert.equal((await workflow.loadBundle(dir)).toolpathApproved,false);
 await workflow.checkPathBundle(dir);assert.equal(generations,2);
 plan.process.layerMm=.1;await writeFile(planFile,JSON.stringify(plan));
 await assert.rejects(workflow.generateBundle(dir),/Approve the geometry/);
 await workflow.generateBundle(dir,{development:true});assert.equal(generations,3,'changed process cannot reuse the earlier candidate');
 await workflow.checkPathBundle(dir);
 const geometryFile=resolve(dir,'geometry/model.mesh.json');
 await writeFile(geometryFile,Buffer.concat([await readFile(geometryFile),Buffer.from(' ')]));
 await assert.rejects(workflow.generateBundle(dir,{development:true}),/Geometry file changed/);
 assert.equal(generations,4,'changed native bytes must fail before generation');
});

test('warm identity reuse retains normalized legacy plan fields without exposing its private snapshot',async t=>{
 const dir=await mkdtemp(resolve(tmpdir(),'saam-legacy-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const plan=shellDefaults();plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:2};
 await shellBundle.initBundle(dir,plan);
 delete plan.skills.supports;delete plan.skills['vase-wall'].endTransition;
 delete plan.skills['full-fill'].topLayers;delete plan.composition.regions;
 const file=resolve(dir,'plan.json');await writeFile(file,JSON.stringify(plan));
 const cold=await shellBundle.loadBundle(dir,{program:false}),warm=await shellBundle.loadBundle(dir,{program:false});
 assert.deepEqual(warm.plan,cold.plan);assert.equal(warm.planHash,cold.planHash);
 assert.ok(warm.plan.skills.supports);assert.ok(warm.plan.skills['vase-wall'].endTransition);
 warm.plan.skills.supports.enabled=true;
 assert.equal((await shellBundle.loadBundle(dir,{program:false})).plan.skills.supports.enabled,false);
 await writeFile(file,JSON.stringify(plan,null,4));
 const reformatted=await shellBundle.loadBundle(dir,{program:false});
 assert.deepEqual(reformatted.plan,cold.plan);assert.equal(reformatted.planHash,cold.planHash);
});

test('machine wall tolerance defaults stay read-only and edits invalidate approvals and prepared output',async t=>{
 let generations=0;
 const workflow=createBundleWorkflow({kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,
   generatePath:async(...args)=>{generations++;return generatePath(...args);},version:VERSION,buildDate:BUILD_DATE,
   exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
 const dir=await mkdtemp(resolve(tmpdir(),'saam-machine-tolerance-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await workflow.initBundle(dir);
 const file=resolve(dir,'machine.json'),reviewFile=resolve(dir,'review.json'),machine=JSON.parse(await readFile(file,'utf8'));
 delete machine.planarWallToleranceMm;await writeFile(file,JSON.stringify(machine));
 const raw=await readFile(file),unapprovedReview=await readFile(reviewFile);
 const cold=await workflow.loadBundle(dir,{program:false}),warm=await workflow.loadBundle(dir,{program:false});
 assert.equal(planarWallTolerance(cold.machine),.01);assert.equal(planarWallTolerance(warm.machine),.01);
 assert.equal(warm.machine.planarWallToleranceMm,undefined);assert.equal(warm.planHash,cold.planHash);
 assert.deepEqual(await readFile(file),raw);assert.deepEqual(await readFile(reviewFile),unapprovedReview);
 machine.planarWallToleranceMm=.01;await writeFile(file,JSON.stringify(machine));
 let state=await workflow.loadBundle(dir,{program:false});
 for(const stage of ['geometry','plan'])state=await workflow.approve(dir,{stage,actor:'SYNTHETIC machine tolerance test',revision:state.revision});
 await workflow.generateBundle(dir);state=await workflow.loadBundle(dir);
 state=await workflow.approve(dir,{stage:'toolpath',actor:'SYNTHETIC machine tolerance test',revision:state.revision});
 const approvedHash=state.planHash,approvedReview=await readFile(reviewFile);
 assert.equal(state.toolpathApproved,true);
 await workflow.checkPathBundle(dir);assert.equal(generations,2);
 machine.planarWallToleranceMm=0;await writeFile(file,JSON.stringify(machine));
 state=await workflow.loadBundle(dir);const zeroHash=state.planHash;
 assert.notEqual(zeroHash,approvedHash);assert.equal(state.geometryApproved,true);
 assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
 await assert.rejects(workflow.generateBundle(dir),/Approve the geometry/);
 await workflow.checkPathBundle(dir);assert.equal(generations,3,'zero tolerance cannot reuse the .01 candidate');
 assert.deepEqual(await readFile(reviewFile),approvedReview,'reading/checking edited machine settings must not rewrite approvals');
 machine.planarWallToleranceMm=.01;await writeFile(file,JSON.stringify(machine));
 assert.equal((await workflow.loadBundle(dir)).planHash,approvedHash);
 machine.planarWallToleranceMm=.02;await writeFile(file,JSON.stringify(machine));
 state=await workflow.loadBundle(dir);assert.notEqual(state.planHash,approvedHash);assert.notEqual(state.planHash,zeroHash);
 assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
 await workflow.checkPathBundle(dir);assert.equal(generations,4,'another positive tolerance has a distinct preparation identity');
 machine.planarWallToleranceMm=null;await writeFile(file,JSON.stringify(machine));
 await assert.rejects(workflow.loadBundle(dir),/wall tolerance/);
 await assert.rejects(workflow.generateBundle(dir,{development:true}),/wall tolerance/);
 assert.equal(generations,4);assert.deepEqual(await readFile(reviewFile),approvedReview);
});

test('only the attached current worker seeds source reuse; full loads and changed bytes still interpret',async t=>{
 const make=()=>createBundleWorkflow({kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,generatePath,
   version:VERSION,buildDate:BUILD_DATE,exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
 const producer=make(),dir=await mkdtemp(resolve(tmpdir(),'saam-worker-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await producer.initBundle(dir);const checks=await producer.generateBundle(dir,{development:true});
 const generated=await producer.loadBundle(dir,{program:'source',allSources:true});
 const payload={type:'generated',checks,source:{planHash:generated.planHash,exportHash:generated.exportHash,
   metadata:{...generated.program,provenanceTest:'worker-result'},code:generated.code,sources:generated.sources}};
 const makeWorker=()=>{
   // A trusted producer shim isolates provenance/ownership from slicing cost.
   const worker=new Worker("const {parentPort}=require('node:worker_threads');parentPort.on('message',value=>parentPort.postMessage(value));",{eval:true});
   t.after(()=>worker.terminate());return worker;
 };
 const send=async(worker,value)=>{const received=once(worker,'message');worker.postMessage(value);await received;};
 assert.throws(()=>attachCheckedProgramWorker({},generated.planHash),/generation worker/);
 const worker=makeWorker();attachCheckedProgramWorker(worker,generated.planHash);
 await send(worker,payload);
 const consumer=make(),source=await consumer.loadBundle(dir,{program:'source',allSources:true});
 assert.equal(source.program.provenanceTest,'worker-result','source load must reuse the worker result instead of interpreting again');
 assert.equal(source.program.moves,undefined);assert.equal(source.code,generated.code);
 source.program.summary.moves=-1;source.sources.program='caller mutation';
 const reloaded=await consumer.loadBundle(dir,{program:'source',allSources:true});
 assert.notEqual(reloaded.program.summary.moves,-1);assert.equal(reloaded.sources.program,generated.sources.program);
 const full=await consumer.loadBundle(dir);
 assert.ok(full.program.moves.length);assert.equal(full.program.provenanceTest,undefined,'full motion requires actual interpretation');
 const coldWorker=new Worker(`
   const {parentPort,workerData}=require('node:worker_threads');
   (async()=>{
     const [workflow,model,geometry,path]=await Promise.all(workerData.modules.map(url=>import(url)));
     const cold=workflow.createBundleWorkflow({kind:'wedge',defaults:model.defaults,validatePlan:model.validatePlan,
       createGeometry:geometry.createGeometry,verifyGeometry:geometry.verifyGeometry,generatePath:path.generatePath,
       version:model.VERSION,buildDate:model.BUILD_DATE,exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',limitations:()=>[],runtimeFiles:[]});
     const state=await cold.loadBundle(workerData.dir,{program:'source'});
     parentPort.postMessage({program:state.program,error:state.programError});
   })().catch(error=>{throw error;});`,{eval:true,workerData:{dir,modules:[
     '../print/workflow.mjs','../../skills/wedge-demo/scripts/model.mjs','../../skills/wedge-demo/scripts/geometry.mjs','../../skills/wedge-demo/scripts/path.mjs'
   ].map(path=>new URL(path,import.meta.url).href)}});
 t.after(()=>coldWorker.terminate());
 const [cold]=await once(coldWorker,'message');assert.equal(cold.error,undefined);
 assert.ok(cold.program.summary.moves);assert.equal(cold.program.provenanceTest,undefined,'fresh worker has no handoff and must interpret source');
 const file=resolve(dir,'exports/griffin-gcode/wedge.gcode'),reviewFile=resolve(dir,'review.json');
 const invalid=generated.code.replace('M109 T1 S215','M109 T1 S0');await writeFile(file,invalid);
 const review=JSON.parse(await readFile(reviewFile,'utf8'));review.generation.exportHash=hash(invalid);await writeFile(reviewFile,JSON.stringify(review));
 assert.match((await make().loadBundle(dir,{program:'source'})).programError,/planned temperature/,'edited bytes cannot borrow worker verification');
 const stale=makeWorker(),current=makeWorker();attachCheckedProgramWorker(stale,generated.planHash);
 attachCheckedProgramWorker(current,'different-plan');
 await send(current,{...payload,checks:{...checks,planHash:'different-plan'},source:{...payload.source,planHash:'different-plan'}});
 await send(stale,payload);
 assert.equal(checkedSourceFor(generated.planHash,generated.exportHash),null,'an older attachment cannot overwrite the one bounded slot');
 assert.ok(checkedSourceFor('different-plan',generated.exportHash));
});
