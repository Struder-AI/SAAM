import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {importStudioSTL,loadStudioImportRepair} from '../../studio/import-stl.mjs';
import {createStudio,bundleFor} from '../../studio/server.mjs';
import {createTour} from '../../studio/tour.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {encodeRepairSTL} from '../geom/mesh-repair.mjs';
import {boxMesh,subdividedBox} from './fixtures/mesh.mjs';
import {loadBundle,adjustBundle} from '../print/bundle.mjs';
import {nativeMeshExecutable} from '../geom/mesh-native.mjs';

async function library(t){
  const root=await mkdtemp(join(tmpdir(),'saam-studio-import-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  return root;
}

test('tour and ordinary imports reject malformed input without retaining partial prints',async t=>{
  const root=await library(t),bytes=Buffer.from('not an STL');
  for(const tour of [false,true]){
    const parent=join(root,tour?'tour':'');await mkdir(join(parent,'Crossed'),{recursive:true});
    await assert.rejects(importStudioSTL(root,bytes,{name:'Crossed.stl',units:'mm',machineId:'ultimaker-s5',tour}),error=>{
      assert.match(error.message,/Invalid or truncated STL/);return true;
    });
    assert.deepEqual((await readdir(parent)).filter(name=>name.startsWith('Crossed')),['Crossed'],'existing directory retained, failed new import removed');
  }
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
  assert.equal(state.plan.geometry.shape,'mesh');assert.equal(state.geometryApproved,false);
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
  const bytes=encodeRepairSTL(mesh),result=await importStudioSTL(root,bytes,{name:'Crossed.stl',units:'mm',machineId:'ultimaker-s5',tour:true});
  assert.equal(result.repaired,true);
  const report=JSON.parse(await readFile(join(result.directory,'repair/repair.json'),'utf8'));
  assert.equal(report.selfIntersectionsRepaired,true);assert.ok(report.unchangedSourceFaces>700);
  assert.deepEqual(await readFile(join(result.directory,'repair/original.stl')),bytes);
  assert.equal((await loadBundle(result.directory,{program:false})).geometryApproved,false);
  const open=boxMesh(12,10,4);open.triangles.pop();
  await assert.rejects(importStudioSTL(root,encodeRepairSTL(open),{name:'Open.stl',units:'mm',machineId:'ultimaker-s5'}),/Open boundaries/);
  assert.equal((await readdir(root)).includes('Open'),false);
});

test('tour import preserves selection on validation failure and requests its start layer after generation recovery',async t=>{
  const root=await library(t),tour=createTour(root),requests=createAgentRequests(root);
  const {directory}=await tour.action('resume');
  let state=await loadBundle(directory,{program:false});
  state.plan.geometry.parts[1].geometry.heightMm=11;
  await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});
  await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);
  await tour.setStartAt({layer:12});await tour.select(directory);
  let fail=true;
  const server=createStudio(directory,{libraryRoot:root,resolveBundle:async selected=>{
    const actual=await bundleFor(selected);
    return {...actual,generateBundle:async(...args)=>{
      if(fail)throw Error('SYNTHETIC TEST generation interruption');
      return actual.generateBundle(...args);
    }};
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url='http://127.0.0.1:'+server.address().port;
    const html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
    const headers={Origin:url,'X-SAAM-Token':token};
    const upload=(name,bytes)=>fetch(url+'/api/import-stl?'+new URLSearchParams({name,units:'mm'}),{
      method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes
    });
    const rejected=await upload('Invalid.stl',Buffer.from('not an STL'));
    assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/Invalid or truncated STL/);
    state=await(await fetch(url+'/api/state')).json();
    assert.equal(state.localPrintDirectory,directory);assert.equal(state.tour.step,3);
    assert.deepEqual(state.tour.imports,[]);

    const bytes=encodeRepairSTL(boxMesh(12,10,4)),interrupted=await upload('Recovery.stl',bytes);
    assert.equal(interrupted.status,400);assert.match((await interrupted.json()).error,/SYNTHETIC TEST generation interruption/);
    state=await(await fetch(url+'/api/state')).json();
    assert.equal(state.tour.step,4);assert.equal(state.tour.startAt,null);
    assert.equal(state.localPrintDirectory,join(root,'tour','Recovery'));assert.equal(Boolean(state.program),false);
    assert.equal((await requests.list()).some(r=>/sparse-infill/.test(r.instruction)),false);

    fail=false;
    const recovered=await fetch(url+'/api/generate',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
    assert.equal(recovered.status,200,await recovered.text());
    state=await(await fetch(url+'/api/state')).json();
    assert.ok(state.program);assert.equal(state.generationError,undefined);assert.equal(state.tour.step,4);
    const preparation=(await requests.list()).filter(r=>/sparse-infill/.test(r.instruction));
    assert.equal(preparation.length,1);assert.equal(preparation[0].printId,'tour/Recovery');
    assert.deepEqual(await readFile(join(state.localPrintDirectory,'geometry/source.stl')),bytes);
  }finally{await server.shutdown();}
});

test('repaired tour geometry requires confirmation across print switching and normal imports retain geometry review',async t=>{
  const root=await library(t),tour=createTour(root),{directory}=await tour.action('resume');
  let state=await loadBundle(directory,{program:false});
  state.plan.geometry.parts[1].geometry.heightMm=11;
  await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});
  await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.select(directory);
  const server=createStudio(directory,{libraryRoot:root});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url='http://127.0.0.1:'+server.address().port;
    const html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
    const headers={Origin:url,'X-SAAM-Token':token};
    const post=async(route,data)=>{
      const response=await fetch(url+'/api/'+route,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});
      assert.equal(response.status,200,await response.text());
    };
    const current=async()=>await(await fetch(url+'/api/state')).json();
    const mesh=boxMesh(12,10,4);mesh.triangles.push([...mesh.triangles[0]]);
    const bytes=encodeRepairSTL(mesh);
    const upload=async name=>{
      const response=await fetch(url+'/api/import-stl?'+new URLSearchParams({name,units:'mm'}),{
        method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes
      });
      assert.equal(response.status,200,await response.text());
    };
    await upload('Repaired.stl');state=await current();
    const repaired=state.localPrintDirectory;
    assert.equal(state.tour.step,3);assert.equal(state.tour.repairReviewRequired,true);
    assert.equal(state.geometryApproved,false);assert.equal(Boolean(state.program),false);
    assert.equal(state.review.generation,null);assert.match(state.importRepair,/1 duplicate or degenerate faces removed/);
    assert.equal(state.tour.startAt,null);

    await post('tour',{action:'step',step:2});await post('open',{path:directory});
    state=await current();assert.equal(state.localPrintDirectory,directory);
    assert.equal(state.tour.step,3);assert.equal(state.tour.repairReviewRequired,false);
    await post('tour',{action:'step',step:2});await post('open',{path:repaired});
    state=await current();assert.equal(state.localPrintDirectory,repaired);
    assert.equal(state.tour.repairReviewRequired,true);assert.equal(state.geometryApproved,false);
    assert.equal(state.review.generation,null);
    const stale=await fetch(url+'/api/tour',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({action:'step',step:4,revision:'stale',geometryHash:state.geometryHash})});
    assert.equal(stale.status,400);assert.equal((await current()).geometryApproved,false);
    await post('tour',{action:'step',step:4,revision:state.revision,geometryHash:state.geometryHash});state=await current();
    assert.equal(state.tour.step,4);assert.equal(state.geometryApproved,true);assert.ok(state.program);
    const layerRequests=(await createAgentRequests(root).list()).filter(r=>/sparse-infill/.test(r.instruction));
    assert.equal(layerRequests.length,1);assert.equal(layerRequests[0].printId,'tour/Repaired');
    assert.deepEqual(await readFile(join(repaired,'repair/original.stl')),bytes);

    await post('tour',{action:'exit'});await upload('Ordinary repaired.stl');state=await current();
    assert.equal(state.tour.active,false);assert.equal(state.geometryApproved,false);assert.equal(state.review.generation,null);
    assert.match(state.importRepair,/Mesh repaired/);
    assert.deepEqual(await readFile(join(state.localPrintDirectory,'repair/original.stl')),bytes);
    await post('approve',{stage:'geometry',actor:'SYNTHETIC TEST repaired geometry confirmation',revision:state.revision});
    assert.equal((await current()).geometryApproved,true);
  }finally{await server.shutdown();}
});
