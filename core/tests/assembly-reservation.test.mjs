import test from 'node:test';
import assert from 'node:assert/strict';
import {clipReservedRegion,intersectsReservation} from '../region/reservation.mjs';
import {regionArea,pointInRegion} from '../region/region2d.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {boxMesh} from './fixtures/mesh.mjs';

const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const field=(lo=1,hi=1)=>({xs:[-1,11],ys:[-1,11],values:[[lo,lo],[hi,hi]]});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} should equal ${b}`);

test('spatial reservation preserves outside material, partial fields and footprint holes',()=>{
  const region=[rectangle(0,0,20,10)],reserve={skinRegion:[rectangle(0,0,10,10)],field:field()};
  close(regionArea(clipReservedRegion(region,0.5,reserve)),200);
  const above=clipReservedRegion(region,2,reserve);close(regionArea(above),100);
  assert.equal(pointInRegion([15,5],above),true);assert.equal(pointInRegion([5,5],above),false);
  close(regionArea(clipReservedRegion(region,1,{...reserve,field:field(0,2)})),150);
  const ring={...reserve,skinRegion:[rectangle(0,0,10,10),rectangle(3,3,7,7).reverse()]};
  const cut=clipReservedRegion(region,2,ring);close(regionArea(cut),116);assert.equal(pointInRegion([5,5],cut),true);
  assert.equal(intersectsReservation([rectangle(15,0,20,10)],reserve),false);
  assert.equal(intersectsReservation([rectangle(10,0,15,10)],reserve),false,'touching boundary is not support area');
  assert.equal(intersectsReservation([rectangle(5,0,15,10)],reserve),true);
  assert.throws(()=>clipReservedRegion(region,2,{field:field()}),/explicit footprint/);
});

test('a selected short roof does not truncate a separate taller full-fill or sparse component on either backend',async()=>{
  const machine=loadMachine(),native=await rhino();
  for(const mesh of [false,true])for(const sparse of [false,true]){
    const shape=h=>mesh?boxMesh(8,8,h):{shape:'box',runMm:8,widthMm:8,heightMm:h};
    const plan=defaults(machine);plan.geometry={shape:'assembly',parts:[
      {id:'low',xMm:0,yMm:0,zMm:0,geometry:shape(2)},
      {id:'tall',xMm:20,yMm:0,zMm:0,geometry:shape(6)}
    ]};
    plan.skills['draped-skin'].part='low';plan.process.minimumLayerSeconds=0;
    if(sparse){plan.skills['full-fill'].mode='solid-surfaces';plan.skills['planar-infill'].enabled=true;}
    const path=generatePath(plan,machine,native);
    const comparison=structuredClone(plan);comparison.skills['draped-skin'].enabled=false;
    const unreserved=generatePath(comparison,machine,native).actions.filter(a=>a.kind==='move'&&a.volumeMm3>0&&a.operation?.startsWith('tall:'));
    const deposits=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
    const tall=deposits.filter(a=>a.operation?.startsWith('tall:'));
    close(Math.max(...tall.map(a=>a.to[2])),Math.max(...unreserved.map(a=>a.to[2])));
    assert.ok(Math.max(...tall.map(a=>a.to[2]))>5.7,'the tall component retains its upper layers');
    assert.ok(tall.some(a=>a.to[2]>2&&a.role===(sparse?'infill':'fill')),`${mesh?'mesh':'spline'} tall body retains its requested pattern`);
    const low=deposits.filter(a=>a.phase==='planar'&&a.operation?.startsWith('low:'));
    close(Math.max(...low.map(a=>a.to[2])),1.6);
    assert.ok(deposits.some(a=>a.phase==='draped-skin'));
  }
});

test('first drape volume uses the actual translated body layer grid for mesh and assembly input',async()=>{
  const machine=loadMachine(),native=await rhino();
  for(const assembly of [false,true]){
    const plan=defaults(machine),mesh=boxMesh(8,8,2);plan.process.minimumLayerSeconds=0;
    if(assembly){
      plan.geometry={shape:'assembly',parts:[
        {id:'raised',xMm:0,yMm:0,zMm:0.1,geometry:{shape:'box',runMm:8,widthMm:8,heightMm:2}},
        {id:'other',xMm:20,yMm:0,zMm:0,geometry:{shape:'box',runMm:8,widthMm:8,heightMm:1}}
      ]};plan.skills['draped-skin'].part='raised';
    }else{
      mesh.vertices=mesh.vertices.map(p=>[p[0],p[1],p[2]+0.1]);plan.geometry=mesh;
    }
    const path=generatePath(plan,machine,native);
    const body=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0&&a.phase==='planar'&&(!assembly||a.operation?.startsWith('raised:')));
    const bodyTop=Math.max(...body.map(a=>a.to[2]));close(bodyTop,1.7);
    const firstSkin=path.actions.find(a=>a.kind==='move'&&a.volumeMm3>0&&a.phase==='draped-skin');
    close(firstSkin.gapMm,firstSkin.to[2]-bodyTop);close(firstSkin.gapMm,0.2);
  }
});

test('overlapping spanning roof continues to reserve both supporting columns',async()=>{
  const machine=loadMachine(),plan=defaults(machine);
  plan.geometry={shape:'assembly',parts:[
    {id:'left',xMm:0,yMm:0,zMm:0,geometry:{shape:'box',runMm:6,widthMm:6,heightMm:2}},
    {id:'right',xMm:10,yMm:0,zMm:0,geometry:{shape:'box',runMm:6,widthMm:6,heightMm:2}},
    {id:'roof',xMm:0,yMm:0,zMm:1.6,geometry:{shape:'box',runMm:16,widthMm:6,heightMm:0.5}}
  ]};
  plan.skills['full-fill'].parts=['left','right'];plan.skills['draped-skin'].part='roof';plan.skills['draped-skin'].normalMm=0.25;plan.process.minimumLayerSeconds=0;
  const path=generatePath(plan,machine,await rhino());
  for(const id of ['left','right']){
    const body=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0&&a.operation?.startsWith(id+':'));
    close(Math.max(...body.map(a=>a.to[2])),1.6);
  }
  const index=path.actions.findIndex(a=>a.volumeMm3>0&&a.phase==='draped-skin');
  assert.ok(index>0);assert.ok(path.actions.slice(index).every(a=>a.phase!=='planar'));
});
