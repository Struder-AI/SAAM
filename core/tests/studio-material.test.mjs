import test from 'node:test';
import assert from 'node:assert/strict';
import {beadSection,beadInstance,materialTemplate,buildMaterialScene,materialKey,materialProjection} from '../../studio/material-view.mjs';
import {createProjection} from '../../studio/camera.mjs';
import {displayPoint} from '../../studio/playback.mjs';
import {dot,length} from '../geom/tolerance.mjs';
import {moveStore} from '../../studio/move-store.mjs';
const plan={geometry:{shape:'pipe'},placement:{xMm:0,yMm:0},process:{lineWidthMm:.4,layerMm:.2,firstLayerMm:.2,skinNormalMm:.2},skills:{'pipe-cladding':{normalMm:.2}},setup:{denso:{rotaryCenterMm:[0,0,0]}}};
const move=(from,to,overrides={})=>({from,to,extruding:true,phase:'planar',layer:0,operation:'fill',...overrides});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('horizontal oval bead is centered below the commanded nozzle and keeps width distinct from height',()=>{
  const m=move([0,0,.2],[10,0,.2]),s=beadSection(m,plan,{});
  assert.deepEqual(s.a.center,[0,0,.1]);near(length(s.a.wide),.2);near(length(s.a.short),.1);
  near(dot(s.a.wide,s.a.short),0);near(s.a.short[2],.1);
  const inset=beadSection(m,plan,{},undefined,undefined,{gap:true});near(length(inset.a.wide),.18);near(length(inset.a.short),.1);
  assert.equal(beadInstance(s).length,18);
});
test('vertical cladding uses radial thickness and circumferential width, independent of nozzle tilt',()=>{
  for(const angle of [0,.6,Math.PI/2,Math.PI]){
    const radial=[Math.cos(angle),Math.sin(angle),0],point=z=>[radial[0]*10,radial[1]*10,z];
    const m=move(point(1),point(5),{phase:'cladding-axial',toolAxisFrom:[0,0,-1],commandedVolumeMm3:.38*.2*4});
    const s=beadSection(m,plan,{});assert.deepEqual(s.a.center,m.from);
    near(dot(s.a.short,radial),.1);near(dot(s.a.wide,radial),0);near(s.a.wide[2],0);near(s.width,.38);
    assert.deepEqual(beadSection({...m,toolAxisFrom:[1,0,0]},plan,{}),s);
  }
});
test('circumferential bead keeps radial thickness and follows changing surface normals',()=>{
  const m=move([10,0,2],[10*Math.cos(.1),10*Math.sin(.1),2.02],{phase:'cladding-hoop'}),s=beadSection(m,plan,{});
  near(length(s.a.short),.1);near(length(s.b.short),.1);assert.ok(Math.abs(s.a.wide[2])>.19);
  assert.notDeepEqual(s.a.short,s.b.short);
  const partial=beadSection(m,plan,{},m.from,m.from.map((v,i)=>v+(m.to[i]-v)*.25));
  near(partial.width,s.width);assert.ok(partial.b.center[1]<s.b.center[1]);
});
test('bounded wedge uses roof normal; unsupported surface frames remain explicit',()=>{
  const s=beadSection(move([0,0,1],[1,0,1.1],{phase:'inclined'}),plan,{roof:{a:.1,b:.2}});
  assert.ok(s.a.center[2]<1);assert.ok(s.a.short[1]<0);
  assert.equal(beadSection(move([0,0,1],[1,0,1.1],{phase:'draped-skin'}),plan,{}),null);
  // A rounded E quantum on this short Y move used to be drawn as a broad
  // X ribbon. Wave source has no across-path surface frame; show its actual
  // centerline through the existing curved-surface fallback instead.
  assert.equal(beadSection(move([149.17954,103.90631,1.41404],[149.17954,103.90632,1.41404],
    {phase:'wave-overhangs',volumeMm3:0.00006379396581954265}),plan,{}),null);
  assert.equal(beadSection(move([0,0,1],[0,0,1]),plan,{}),null);
});
test('completed geometry reduces cross-section cost without losing curve samples or filling a bore',async()=>{
  assert.equal(materialTemplate(true).length,4*materialTemplate(false).length);
  const ring=[];
  for(let i=0;i<80;i++){const point=j=>[5*Math.cos(j*2*Math.PI/80),5*Math.sin(j*2*Math.PI/80),.2];ring.push(move(point(i),point(i+1)));}
  const scene=await buildMaterialScene(ring,plan,{}, {yieldTask:async()=>{}}),data=scene.groups[0].instances;
  assert.equal(data.length,80*18,'every original curve segment is retained');
  for(let i=0;i<80;i++){
    near(data[i*18],ring[i].from[0]);near(data[i*18+1],ring[i].from[1]);near(data[i*18+3],ring[i].to[0]);
    for(const along of [0,1])for(const u of [-1,1])for(const v of [-1,1]){
      const c=i*18+along*3,w=i*18+(along?12:6),h=w+3;
      const x=data[c]+u*data[w]+v*data[h],y=data[c+1]+u*data[w+1]+v*data[h+1];
      assert.ok(Math.hypot(x,y)>4.5,'no rectangular block spans the unprinted bore');
    }
  }
});
test('completed meshes stay separate per layer and operation and retain their source indices',async()=>{
  const moves=[move([0,0,.2],[1,0,.2]),move([1,0,.2],[2,0,.2],{operation:'wall'}),move([0,0,.4],[1,0,.4],{layer:1})];
  const before=structuredClone(moves),scene=await buildMaterialScene(moves,plan,{}, {yieldTask:async()=>{}});
  assert.equal(scene.groups.length,3);assert.equal(new Set(scene.groups.map(g=>g.key)).size,3);
  assert.notEqual(materialKey(moves[0]),materialKey(moves[1]));
  assert.deepEqual(scene.groups.map(g=>g.last),[0,1,2]);assert.deepEqual([...scene.supported],[1,1,1]);assert.deepEqual(moves,before);
});

test('material preparation retains interleaved and unsupported source records in compact buffers',async()=>{
  const moves=[move([0,0,.2],[1,0,.2]),move([0,0,.4],[1,0,.4],{layer:1}),
    move([1,0,.2],[1,0,.2]),move([1,0,.2],[2,0,.2]),
    move([0,0,1],[1,0,1.1],{phase:'draped-skin'}),move([2,0,.2],[3,0,.2],{extruding:false})];
  const scene=await buildMaterialScene(moves,plan,{}, {yieldTask:async()=>{}});
  assert.deepEqual([...scene.supported],[1,1,1,1,0,0]);
  assert.deepEqual(scene.unsupported,['draped-skin'],'stationary extrusion has an event marker, not a missing surface frame');
  assert.deepEqual([...scene.groups[0].indices],[0,3]);
  assert.deepEqual(scene.groups[0].instances,new Float32Array([
    ...beadInstance(beadSection(moves[0],plan,{})),...beadInstance(beadSection(moves[3],plan,{}))]));
  assert.equal(scene.groups[2].instances.length,0);
});

test('material preparation yields within a large operation without adding a timer per small operation',async t=>{
  let now=0;t.mock.method(performance,'now',()=>now+=10);
  for(const separate of [false,true]){
    let yields=0;const progress=[];
    const moves=Array.from({length:2000},(_,i)=>move([0,0,.2],[1,0,.2],{operation:separate?String(i):'fill'}));
    await buildMaterialScene(moves,plan,{}, {yieldTask:async()=>{yields++;},onProgress:p=>progress.push(p)});
    assert.ok(yields>1,'even a single large operation lets pending browser work run');
    assert.ok(yields<100,'small operations share scheduling turns');
    assert.equal(progress.at(-1),1);
    assert.ok(progress.every((p,i)=>i===0||p>=progress[i-1]));
  }
});
test('compact batch reads preserve material buffers across chunks without mutating source records',async()=>{
  const compact=moveStore(),moves=Array.from({length:16400},(_,i)=>move([i,0,.2],[i+1,0,.2],
    {line:i+1,operation:i%3?'fill':'wall',phase:i%7?'planar':'draped-skin',volumeMm3:.08,toolAxisFrom:[0,0,-1]}));
  for(const m of moves)compact.push(m);
  compact.offsetLines(10);
  const read=compact.reader(['from','line','operation','absent']);
  for(const i of [0,16383,16384,16399]){
    const row=read(i);assert.deepEqual(row.from,moves[i].from);assert.equal(row.line,i+11);
    assert.equal(row.operation,moves[i].operation);assert.equal(row.absent,undefined);
  }
  read(0).from[0]=-999;assert.equal(compact[0].from[0],0,'scratch mutation cannot change the stored source');
  const options={yieldTask:async()=>{}};
  const a=await buildMaterialScene(moves,plan,{},options),b=await buildMaterialScene(compact,plan,{},options);
  assert.deepEqual(b.bounds,a.bounds);assert.deepEqual(b.supported,a.supported);assert.deepEqual(b.unsupported,a.unsupported);
  assert.deepEqual(b.groups.map(g=>[g.key,g.last,g.indices,g.instances]),a.groups.map(g=>[g.key,g.last,g.indices,g.instances]));
  assert.notEqual(b.groups[0].move,b.groups[1].move,'representative moves outlive the scratch reader');
  assert.deepEqual(compact[0].from,moves[0].from);
});

test('WebGL projection matches Studio screen coordinates in both rotary views and at every zoom',()=>{
  const bounds={min:[-12,-12,0],max:[12,12,14]};
  for(const follow of [true,false])for(const angle of [0,45,720])for(const zoom of [.2,1,4]){
    const base=createProjection(bounds,527,401,-.7,.6,zoom),project=p=>base(displayPoint(p,angle,[0,0,0],follow));
    project.pixelsPerMm=base.pixelsPerMm;const {matrix:m}=materialProjection(project,527,401,bounds);
    for(const p of [[0,0,0],[10,0,2],[0,-10,12]]){
      const x=m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],y=m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13];
      const actual=project(p);assert.ok(Math.abs((x+1)*527/2-actual[0])<.0001);assert.ok(Math.abs((1-y)*401/2-actual[1])<.0001);
    }
  }
});
