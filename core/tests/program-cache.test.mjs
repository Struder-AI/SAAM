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
test('verified programs reuse work while changed bytes and forged review hashes still get checked',async t=>{
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
 assert.ok((await make().loadBundle(dir)).program);assert.equal(generations,2,'new workflow verifies saved files fully');
 const file=resolve(dir,'path.saampath'),original=await readFile(file,'utf8'),path=JSON.parse(original);
 path.actions.find(a=>a.kind==='move').to[0]+=.01;
 await writeFile(file,JSON.stringify(path));
 assert.match((await workflow.loadBundle(dir)).programError,/files changed/);
 const reviewFile=resolve(dir,'review.json'),review=JSON.parse(await readFile(reviewFile,'utf8'));
 review.generation.pathHash=hash(path);await writeFile(reviewFile,JSON.stringify(review));
 assert.match((await workflow.loadBundle(dir)).programError,/locked recipe/);
 assert.equal(generations,3,'editing both path and its declared hash cannot reuse the cache');
 await writeFile(file,original);review.generation.pathHash=hash(JSON.parse(original));await writeFile(reviewFile,JSON.stringify(review));
 const exportFile=resolve(dir,'exports/griffin-gcode/wedge.gcode'),code=await readFile(exportFile,'utf8');
 await writeFile(exportFile,code+'; changed\n');review.generation.exportHash=hash(code+'; changed\n');await writeFile(reviewFile,JSON.stringify(review));
 assert.match((await workflow.loadBundle(dir)).programError,/Export does not match/);
});
