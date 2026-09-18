import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {importStudioSTL,loadStudioImportRepair} from '../../studio/import-stl.mjs';
import {encodeRepairSTL} from '../geom/mesh-repair.mjs';
import {boxMesh,subdividedBox} from './fixtures/mesh.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {nativeMeshExecutable} from '../geom/mesh-native.mjs';

async function library(t){
  const root=await mkdtemp(join(tmpdir(),'saam-studio-import-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  return root;
}

test('imports reject malformed input without retaining partial prints',async t=>{
  const root=await library(t),bytes=Buffer.from('not an STL');
  await mkdir(join(root,'Crossed'));
  await assert.rejects(importStudioSTL(root,bytes,{name:'Crossed.stl',units:'mm',machineId:'ultimaker-s5'}),error=>{
    assert.match(error.message,/Invalid or truncated STL/);return true;
  });
  assert.deepEqual((await readdir(root)).filter(name=>name.startsWith('Crossed')),['Crossed'],'existing directory retained, failed new import removed');
});

test('worker import keeps the server event loop responsive and preserves source and review',async t=>{
  const root=await library(t),bytes=encodeRepairSTL(boxMesh(12,10,4));
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  let directory;
  try{({directory}=await importStudioSTL(root,bytes,{name:'Valid.stl',units:'mm',machineId:'ultimaker-s5'}));}
  finally{clearInterval(timer);}
  assert.ok(ticks>0,'main-thread timers continue while import runs');
  assert.deepEqual(await readFile(join(directory,'geometry/source.stl')),bytes);
  const state=await loadBundle(directory,{program:false});
  assert.equal(state.plan.geometry.shape,'mesh');assert.equal(state.toolpathApproved,false);
  const second=await importStudioSTL(root,bytes,{name:'Valid.stl',units:'mm',machineId:'ultimaker-s5'});
  assert.equal(second.directory,join(root,'Valid 2'));assert.equal(second.repaired,false);
  assert.equal(await loadStudioImportRepair(second.directory),null);
});

test('exact import repair preserves original bytes, reports progress and retains normal unit inference',async t=>{
  const root=await library(t),mesh=boxMesh(2,1,1);mesh.triangles.push([...mesh.triangles[0]]);
  const bytes=encodeRepairSTL(mesh);
  for(const units of ['auto','mm','inch']){
    const stages=[],result=await importStudioSTL(root,bytes,{name:units+'.stl',units,machineId:'ultimaker-s5',onProgress:event=>stages.push(event.stage)});
    assert.equal(result.repaired,true);assert.match(result.repairSummary,/1 duplicate or degenerate faces removed/);
    assert.ok(stages.includes('Checking your STL'));assert.ok(stages.includes('Repairing your STL'));
    assert.equal(stages.at(-1),'Opening repaired geometry');
    const expectedUnits=units==='auto'?'inch':units;
    const report=JSON.parse(await readFile(join(result.directory,'repair/repair.json'),'utf8'));
    assert.equal(report.sourceUnits,expectedUnits);assert.equal(report.outputUnits,'mm');
    assert.equal(report.method,'exact-cleanup/1');assert.equal(report.sampledDistanceMm.sourceToResult,0);
    assert.deepEqual(await readFile(join(result.directory,'repair/original.stl')),bytes);
    assert.deepEqual(await readFile(join(result.directory,'geometry/source.stl')),await readFile(join(result.directory,'repair/repaired.stl')));
    assert.equal(await loadStudioImportRepair(result.directory),result.repairSummary);
    const state=await loadBundle(result.directory,{program:false});
    assert.deepEqual(state.review.approvals,{});assert.equal(state.plan.geometry.source.units,'mm');
    assert.equal(Math.max(...state.plan.geometry.vertices.map(p=>p[0])),expectedUnits==='inch'?50.8:2);
  }
});

test('native import repair resolves intersections and rejects unbounded holes without a partial print',{
  skip:existsSync(nativeMeshExecutable)?false:'Native mesh backend unavailable'
},async t=>{
  const root=await library(t),mesh=subdividedBox();
  mesh.vertices.find(p=>p[0]===2&&p[1]===2&&p[2]===4)[2]=-1;
  const bytes=encodeRepairSTL(mesh),result=await importStudioSTL(root,bytes,{name:'Crossed.stl',units:'mm',machineId:'ultimaker-s5'});
  assert.equal(result.repaired,true);
  const report=JSON.parse(await readFile(join(result.directory,'repair/repair.json'),'utf8'));
  assert.equal(report.selfIntersectionsRepaired,true);assert.ok(report.unchangedSourceFaces>700);
  assert.deepEqual(await readFile(join(result.directory,'repair/original.stl')),bytes);
  assert.equal((await loadBundle(result.directory,{program:false})).toolpathApproved,false);
  const open=boxMesh(12,10,4);open.triangles.pop();
  await assert.rejects(importStudioSTL(root,encodeRepairSTL(open),{name:'Open.stl',units:'mm',machineId:'ultimaker-s5'}),/Open boundaries/);
  assert.equal((await readdir(root)).includes('Open'),false);
});
