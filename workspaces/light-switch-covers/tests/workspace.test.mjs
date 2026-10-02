import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialDesign,buildCover} from '../model.mjs';
import {handoff,startWorkspace} from '../server.mjs';
import {makeMesh,decodeSTL} from '../../../core/geom/mesh.mjs';
import {encodeRepairSTL} from '../../../core/geom/mesh-repair.mjs';
import {loadBundle} from '../../../core/print/bundle.mjs';

const volume=g=>g.triangles.reduce((sum,t)=>{const [a,b,c]=t.map(i=>g.vertices[i]);return sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;},0);
const design=patch=>({...structuredClone(initialDesign),faceOrientation:'up',...patch});
test('raised and face-down recessed solids, readable plane and STL roundtrip',async()=>{
 const raised=await buildCover(design()),recessed=await buildCover(design({treatment:'recessed',faceOrientation:'down'}));
 for(const r of [raised,recessed]){const mesh=makeMesh(r.geometry.vertices,r.geometry.triangles);assert.ok(mesh.bounds.min[2]>=-1e-6);assert.ok(volume(r.geometry)>0);assert.ok(decodeSTL(encodeRepairSTL(mesh),{units:'mm'}).triangles.length);}
 assert.ok(volume(raised.geometry)>volume(recessed.geometry));
 assert.deepEqual(recessed.geometry.features[0].reference.yAxis,[0,-1,0]);
 assert.equal(recessed.geometry.features[0].mirror,false);
 assert.equal(recessed.geometry.materialParts.length,1);
});
test('mixed toggle/rocker geometry and two-color partitions conserve volume',async()=>{
 const d=design({width:115.8875,treatment:'two-color',devices:[{...initialDesign.devices[0],label:'ROOM'},{kind:'rocker',width:33.274,height:66.802,screwPitch:96.825,label:'FAN',labelPosition:'bottom'}]});
 const r=await buildCover(d),parts=r.geometry.materialParts;
 assert.deepEqual(parts.map(p=>p.id),['base','text/label-1','text/label-2']);
 assert.ok(Math.abs(parts.reduce((v,p)=>v+volume(p.geometry??r.geometry.base),0)-volume(r.geometry))<.01);
});
test('reject overlapping labels, edge escape, bad openings and decoration interference',async()=>{
 await assert.rejects(buildCover(design({width:69.85,devices:[{...initialDesign.devices[0],label:'THIS IS A VERY LONG LABEL'}]})),/does not fit/);
 await assert.rejects(buildCover(design({width:69.85,devices:[{...initialDesign.devices[0],width:80}]})),/edge/);
 await assert.rejects(buildCover(design({decoration:[{shape:'circle',x:initialDesign.width/2-initialDesign.pitch/2,y:57.15,size:4,depth:.4,mode:'raised'}]})),/overlaps/);

 const decorated=await buildCover(design({decoration:[{shape:'diamond',x:10,y:40,size:3,depth:.4,mode:'raised'}]}));
 assert.ok(volume(decorated.geometry)>volume((await buildCover(design())).geometry));
});
test('handoff retains saved design, editable font features and no approvals',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'saam-cover-'));
 try{const r=await buildCover(design());await handoff(r,'ultimaker-s5',join(temp,'print'));const state=await loadBundle(join(temp,'print'),{program:false});assert.deepEqual(state.review.approvals,{});assert.equal(state.plan.skills['draped-skin'].enabled,false);assert.equal(state.plan.geometry.features[0].text,'LIGHTS');assert.equal(JSON.parse(await readFile(join(temp,'print','cover-design.json'),'utf8')).schema,initialDesign.schema);
 await assert.rejects(handoff(await buildCover(design({treatment:'two-color'})),'ultimaker-s5',join(temp,'color')),/two logical filaments/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('local server protects writes, returns geometry and rejects stale downloads',async()=>{
 const local=await mkdtemp(join(tmpdir(),'saam-cover-server-'));const server=await startWorkspace(0,{storageDirectory:local}),url=`http://127.0.0.1:${server.address().port}`;
 try{const cfg=await fetch(url+'/api/config').then(r=>r.json());assert.equal((await fetch(url+'/api/build',{method:'POST',body:'{}'})).status,403);
 const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':cfg.token},body:JSON.stringify(body)});
 const a=await post('/api/build',design()).then(r=>r.json());assert.ok(a.mesh.triangles.length);assert.ok((await post('/api/stl',{id:a.id})).ok);
 await post('/api/build',design({treatment:'recessed',faceOrientation:'down'}));assert.equal((await post('/api/stl',{id:a.id})).status,400);
 assert.equal((await fetch(url+'/../README.md')).status,404);
 }finally{await new Promise(r=>server.close(r));await rm(local,{recursive:true,force:true});}
});

test('recessed lettering preserves volume and text when oriented either way',async()=>{
 for(const treatment of ['recessed']){
  const up=await buildCover(design({treatment,faceOrientation:'up'})),down=await buildCover(design({treatment,faceOrientation:'down'}));
  assert.ok(Math.abs(volume(up.geometry)-volume(down.geometry))<.01);
  const mesh=makeMesh(down.geometry.vertices,down.geometry.triangles);
  assert.ok(Math.abs(mesh.bounds.min[2])<1e-5);
  assert.equal(down.geometry.features[0].mode,treatment==='recessed'?'recessed':'raised');
  assert.equal(down.geometry.features[0].mirror,false);
  assert.equal(down.faceOffset,treatment==='recessed'?0:initialDesign.reliefDepth);
 }
});

test('flush two-color inserts fill recesses without projecting above the face',async()=>{
 for(const faceOrientation of ['up','down']){
  const r=await buildCover(design({treatment:'two-color-flush',faceOrientation}));
  assert.equal(r.faceOffset,0);assert.equal(r.geometry.shape,'assembly');
  const [plate,labels]=r.previewMaterials.map(p=>p.geometry);
  assert.ok(Math.abs(volume(plate)+volume(labels)-volume(r.previewMesh))<.01);
  const bounds=makeMesh(labels.vertices,labels.triangles).bounds;
  if(faceOrientation==='up'){assert.ok(Math.abs(bounds.max[2]-initialDesign.thickness)<1e-5);assert.ok(bounds.min[2]>=initialDesign.thickness-initialDesign.reliefDepth-1e-5);}
  else{assert.ok(Math.abs(bounds.min[2])<1e-5);assert.ok(bounds.max[2]<=initialDesign.reliefDepth+1e-5);}
 }
});

test('raised styles force face up and preserve support notes in handoff',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'saam-support-notes-'));
 try{for(const treatment of ['raised','two-color']){
 const r=await buildCover(design({treatment,faceOrientation:'down'}));
 assert.equal(r.printFace,'up');assert.equal(r.design.faceOrientation,'up');assert.ok(r.warnings.some(w=>w.includes('support beneath the rear pocket')));
 }
 const r=await buildCover(design());await handoff(r,'ultimaker-s5',join(temp,'print'));
 assert.match(await readFile(join(temp,'print','HANDOFF.md'),'utf8'),/support beneath the rear pocket/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
