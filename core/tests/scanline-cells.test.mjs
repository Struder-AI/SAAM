import test from 'node:test';
import assert from 'node:assert/strict';
import {scanlineFill} from '../region/region2d.mjs';
import {ringMesh} from './fixtures/mesh.mjs';
import {defaults} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const sides=rows=>rows.filter(r=>r.scanY>5&&r.scanY<25).map(r=>r.from[0]<10?'left':'right');
const changes=values=>values.reduce((n,v,i)=>n+(i>0&&v!==values[i-1]?1:0),0);

test('one connected region finishes each side of a hole, with exact analytic coverage',()=>{
  const loops=[rect(0,0,30,30),rect(10,5,10,20).reverse()];
  for(const spacing of [0.4,1,2]) {
    const rows=scanlineFill(loops,spacing,0,{originMm:[0,0.13]});
    assert.equal(changes(sides(rows)),1,'two side cells, not a jump across the hole on each row');
    const byY=new Map();
    for(const r of rows){const list=byY.get(r.scanY)??[];list.push([r.from[0],r.to[0]]);byY.set(r.scanY,list);}
    for(const [y,spans] of byY)assert.deepEqual(spans.sort((a,b)=>a[0]-b[0]),y+0.13>=5&&y+0.13<25?[[0,10],[20,30]]:[[0,30]]);
  }
});

test('multiple holes, a concavity and rotated/translated scans retain exactly the same strokes',()=>{
  const loops=[rect(0,0,40,30),rect(6,4,6,20).reverse(),rect(22,8,6,16).reverse()];
  const angle=37,a=angle*Math.PI/180,rotate=p=>[70+p[0]*Math.cos(a)-p[1]*Math.sin(a),-30+p[0]*Math.sin(a)+p[1]*Math.cos(a)];
  const original=scanlineFill(loops,0.7,0,{originMm:[0,0.17]});
  const rotated=scanlineFill(loops.map(l=>l.map(rotate)),0.7,angle,{originMm:rotate([0,0.17])});
  assert.equal(rotated.length,original.length);
  original.forEach((r,i)=>{for(const endpoint of ['from','to'])rotate(r[endpoint]).forEach((v,k)=>assert.ok(Math.abs(v-rotated[i][endpoint][k])<1e-8));});
  // A U is connected below the notch, just as a flange is connected around a hole.
  const u=[[[0,0],[30,0],[30,30],[20,30],[20,5],[10,5],[10,30],[0,30]]];
  assert.equal(changes(sides(scanlineFill(u,0.5,0))),1);
});

test('full-fill and planar-infill share hole ordering and round-trip through S5 and H2D',()=>{
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const sparse of [false,true]) {
    const machine=loadMachine(id),plan=defaults(machine);
    plan.geometry=ringMesh();plan.process.minimumLayerSeconds=0;
    plan.skills['draped-skin'].enabled=false;
    Object.assign(plan.skills['full-fill'],{fillAnglesDeg:[0],perimeters:1,mode:sparse?'solid-surfaces':'body',bottomLayers:1,topLayers:1});
    Object.assign(plan.skills['planar-infill'],{enabled:sparse,fillAnglesDeg:[0],perimeters:1,density:0.35});
    const path=generatePath(plan,machine,null);
    for(const layer of [0,4,9]) {
      const rows=path.actions.filter(m=>m.layer===layer&&m.volumeMm3>0&&['fill','infill'].includes(m.role)
        &&m.to[1]>plan.placement.yMm+4&&m.to[1]<plan.placement.yMm+8);
      assert.ok(rows.length>=2);
      const side=rows.map(m=>m.to[0]<plan.placement.xMm+6?'left':'right');
      assert.equal(changes(side),1,`${id}, sparse=${sparse}, layer=${layer}`);
    }
    const program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'}),plan,machine);
    assert.equal(program.moves.length,path.actions.filter(a=>a.kind==='move').length);
    assert.ok(Math.abs(program.volumeMm3-path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0))<0.001);
  }
});
