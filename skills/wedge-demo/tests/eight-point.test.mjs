import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,roofGeometry,validatePlan,wedgeMesh,legacyPoints,hash} from '../scripts/model.mjs';
import {createGeometry,verifyGeometry} from '../scripts/geometry.mjs';
import {generatePath} from '../scripts/path.mjs';
import {initBundle,loadBundle,adjustBundle,approve,upgradeBundle} from '../scripts/bundle.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {topAt} from '../../../core/geom/query.mjs';

function pointsFor(a,b,c=4,x=16,y=12) {
  const base=[[0,0,0],[x,0,0],[x,y,0],[0,y,0]];
  return [...base,...base.map(([x,y])=>[x,y,c+a*x+b*y])];
}

test('eight points are order-independent, translated to the bed, and exactly represented by the mesh',async()=>{
  const source=pointsFor(-.1,.15).map(([x,y,z])=>[x+70,y-20,z+9]).reverse();
  const geometry={points:source},roof=roofGeometry(geometry),{bytes,descriptor}=await createGeometry(geometry);
  assert.ok(Math.abs(roof.a+.1)<1e-10);assert.ok(Math.abs(roof.b-.15)<1e-10);
  assert.deepEqual(descriptor.boundsMm.min,[0,0,0]);assert.equal(descriptor.features.length,6);
  await verifyGeometry(bytes,descriptor);
  const mesh=makeMesh(descriptor.vertices,descriptor.faces);
  for(const [x,y] of [[1,1],[8,6],[15,11]])assert.ok(Math.abs(topAt(mesh,x,y).zMm-(4-.1*x+.15*y))<1e-9);
});

test('nonplanar roofs, rotated/nonrectangular bases, nonvertical edges and invalid point sets fail',()=>{
  const mutations=[
    p=>p.pop(),p=>p[0][0]=NaN,p=>p[6][2]+=.01,p=>p[0][2]+=.01,
    p=>p[4][0]+=.01,p=>p[4][2]=0,p=>p[7]=[...p[6]],
    p=>p.forEach(q=>{const [x,y]=q;q[0]=(x-y)/Math.SQRT2;q[1]=(x+y)/Math.SQRT2;})
  ];
  for(const mutate of mutations){const points=pointsFor(.1,.1);mutate(points);assert.throws(()=>roofGeometry({points}));}
  const p=defaults(),m=loadMachine();p.geometry.points=pointsFor(.2,.2);
  assert.throws(()=>validatePlan(p,m),/slope/,'Combined slope must be checked, not each axis separately.');
  p.geometry.points=pointsFor(0,0,300);assert.throws(()=>validatePlan(p,m),/Z bounds/);
});

for(const [name,a,b] of [['right',.15,0],['left',-.15,0],['back',0,.15],['front',0,-.15],
  ['back-right',.12,.14],['back-left',-.12,.14],['front-right',.12,-.14],['front-left',-.12,-.14],['level',0,0]]) {
  test(`${name} roof: six skins follow the mesh, body stays below them, both exports preserve motion`,()=>{
    for(const machineId of ['ultimaker-s5','bambu-h2d']) {
      const machine=loadMachine(machineId),plan=defaults(machine);plan.geometry.points=pointsFor(a,b);plan.process.skinLayers=6;
      const roof=roofGeometry(plan.geometry),path=generatePath(plan,machine),meshData=wedgeMesh(plan.geometry),mesh=makeMesh(meshData.vertices,meshData.faces);
      checkMachinePath(path,plan,machine);
      let high=0;
      let pos=path.initialPosition,skinStarted=false,volume=0,lastStroke,lastDirection;const layers=new Set();
      for(const move of path.actions) {
        if(move.kind!=='move')continue;
        if(move.volumeMm3>0&&move.phase!=='prime') {
          volume+=move.volumeMm3;
          if(move.phase==='inclined'&&move.stroke!==lastStroke) {
            const delta=move.to.map((v,i)=>v-pos[i]);
            const direction=Math.sign(roof.slope>1e-12?delta[0]*a+delta[1]*b:delta[0]);
            if(lastDirection!==undefined)assert.equal(direction,-lastDirection,'Adjacent roof strokes alternate, including across layer boundaries.');
            lastStroke=move.stroke;lastDirection=direction;
          }
          for(const q of [pos,move.to]) {
            const x=q[0]-plan.placement.xMm,y=q[1]-plan.placement.yMm;
            assert.ok(x>=-.000001&&x<=16.000001&&y>=-.000001&&y<=12.000001);
            const top=topAt(mesh,x,y).zMm;
            if(move.phase==='inclined') {
              skinStarted=true;layers.add(move.layer);
              const remaining=path.summary.planarLayers+5-move.layer;
              assert.ok(Math.abs(q[2]-(top-remaining*.2/roof.cosine))<1e-7,'Skin follows a parallel plane at the locked normal spacing.');
            } else {assert.equal(skinStarted,false);assert.ok(q[2]<=top-6*.2/roof.cosine+1e-7);}
          }
        }
        // A sub-grid XY adjustment can share the same written coordinates as
        // the preceding point. Only actual exported XY travel needs clearance.
        const writtenXYChanges = [0,1].some(k => Number(move.to[k].toFixed(5)) !== Number(pos[k].toFixed(5)));
        if(move.volumeMm3===0&&writtenXYChanges&&move.travel!=='combed') {
          assert.ok(Math.abs(pos[2]-move.to[2])<1e-7&&move.to[2]>=high+plan.process.liftMm-1e-7);
        }
        if(move.volumeMm3>0)high=Math.max(high,pos[2],move.to[2]);
        pos=move.to;
      }
      assert.equal(layers.size,6);
      const ideal=16*12*(4+a*8+b*6);assert.ok(Math.abs(volume-ideal)/ideal<.08,`Volume error ${volume/ideal-1}`);
      const code=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'});
      const interpreted=interpretProgram(code,plan,machine),moves=path.actions.filter(a=>a.kind==='move');
      assert.equal(interpreted.moves.length,moves.length);
      moves.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-interpreted.moves[i].to[k])<=6e-6));assert.ok(Math.abs(m.volumeMm3-interpreted.moves[i].volumeMm3)<1e-4);});
    }
  });
}

test('corner edits invalidate geometry review and update the native mesh without creating approvals',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-eight-point-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  await initBundle(dir);let state=await loadBundle(dir);
  await approve(dir,{stage:'geometry',actor:'SYNTHETIC TEST geometry',revision:state.revision});
  state=await adjustBundle(dir,{geometry:{points:pointsFor(-.1,0)}});
  assert.equal(state.geometryApproved,false);assert.deepEqual(state.review.approvals,{});
  assert.equal(state.geometry.nativeFile,'model.mesh.json');assert.ok(state.geometry.roof.a<0);
});

test('requested double-speed left-high H2D wedge keeps targets while enforcing flow and Z feeds',()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  plan.geometry.points=legacyPoints({runMm:30,widthMm:20,baseMm:2,angleDeg:15}).map(([x,y,z])=>[30-x,y,z]);
  plan.process.skinLayers=6;
  // The requested 40/20/24 targets are now the machine's defaults.
  assert.deepEqual([plan.process.planarSpeedMmS,plan.process.skinSpeedMmS,plan.process.firstLayerSpeedMmS],[40,20,24]);
  const path=generatePath(plan,machine);checkMachinePath(path,plan,machine);
  assert.ok(roofGeometry(plan.geometry).a<0);assert.equal(path.summary.skinLayers,6);
  assert.ok(path.actions.some(a=>a.phase==='planar'&&a.volumeMm3>0&&a.speedMmS===40));
  assert.ok(path.actions.some(a=>a.phase==='planar'&&a.layer===0&&a.volumeMm3>0&&a.speedMmS===24));
  assert.ok(path.actions.filter(a=>a.phase==='inclined'&&a.volumeMm3>0).every(a=>a.speedMmS<=20));
  interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'}),plan,machine);
  const tooFast=structuredClone(plan);tooFast.process.planarSpeedMmS=machine.maxFeedMmS.x+1;
  assert.throws(()=>validatePlan(tooFast,machine),/planarSpeedMmS/);
});

test('explicit legacy 3DM upgrade preserves old artifacts and requires fresh geometry review',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-legacy-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const plan=defaults();plan.generatorVersion='0.2.4';plan.geometry={runMm:16,widthMm:12,baseMm:2,angleDeg:15};
  const r=await (await import('rhino3dm')).default(),doc=new r.File3dm(),points=legacyPoints(plan.geometry),h=points[5][2];
  const solid=r.Extrusion.create(new r.PolylineCurve([[0,0,0],[16,0,0],[16,h,0],[0,2,0],[0,0,0]]),12,true);
  solid.transform(r.Transform.rotationVectors([0,0,1],[0,-1,0],[0,0,0]));solid.transform(r.Transform.translationXYZ(0,12,0));
  const attrs=new r.ObjectAttributes();attrs.setUserString('saam:geometry',hash(plan.geometry));doc.objects().add(solid,attrs);
  for(const ids of [[0,3,2,1],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]]) {
    const [a,b,c,d]=ids.map(i=>points[i]);doc.objects().add(r.NurbsSurface.createRuledSurface(new r.LineCurve(a,b),new r.LineCurve(d,c)),new r.ObjectAttributes());
  }
  const bytes=doc.toByteArray();doc.destroy();await mkdir(join(dir,'geometry'));await mkdir(join(dir,'delivery'));
  await writeFile(join(dir,'geometry/model.3dm'),bytes);
  await writeFile(join(dir,'geometry/model.json'),JSON.stringify({parameters:plan.geometry,fileHash:hash(bytes)}));
  await writeFile(join(dir,'plan.json'),JSON.stringify(plan));await writeFile(join(dir,'machine.json'),JSON.stringify(loadMachine()));
  await writeFile(join(dir,'review.json'),JSON.stringify({schema:'saam-review/1',approvals:{geometry:{actor:'SYNTHETIC TEST legacy',hash:'old'}},history:[],generation:null}));
  await writeFile(join(dir,'delivery/wedge.gcode'),'SYNTHETIC TEST preserved bytes');
  await upgradeBundle(dir);const state=await loadBundle(dir);
  assert.equal(state.geometryApproved,false);assert.equal(state.geometry.nativeFile,'model.mesh.json');assert.deepEqual(state.plan.geometry.points,points);
  assert.equal(hash(await readFile(join(dir,'geometry/model.3dm'))),hash(bytes));
  assert.equal(await readFile(join(dir,'delivery/wedge.gcode'),'utf8'),'SYNTHETIC TEST preserved bytes');
});
