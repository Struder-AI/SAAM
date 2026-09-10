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
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value,function(_k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;})).digest('hex');
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
