import test from 'node:test';
import assert from 'node:assert/strict';
import {fitMeshSleeve,detectMeshSleeveInterval} from '../geom/mesh-sleeve.mjs';
import {leastSquares} from '../geom/least-squares.mjs';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {loopArea} from '../region/region2d.mjs';
import {boxMesh,ringMesh} from './fixtures/mesh.mjs';
import {flutedVase} from './fixtures/mesh-sleeve.mjs';

test('fitted sections share a stable parameter grid with a height-wide cubic chord bound',()=>{
  const toleranceMm=.0025,fit=fitMeshSleeve(flutedVase(),{toleranceMm});
  const count=fit.report.sectionSegments;
  assert.ok(fit.report.sectionChordBoundMm<=toleranceMm);
  for(const z of [0,.031,3.123,7.79,11.002,17.31,20]){
    const ring=fit.sectionAt(z).outer;
    assert.equal(ring.length,count);
    for(let i=0;i<count;i++)for(const t of [.13,.37,.61,.89]){
      const actual=fit.pointAt((i+t)/count,z),a=ring[i],b=ring[(i+1)%count];
      const error=Math.hypot(...a.map((v,k)=>actual[k]-(v+(b[k]-v)*t)));
      assert.ok(error<=fit.report.sectionChordBoundMm+1e-10,`chord discrepancy ${error}`);
    }
  }
  assert.throws(()=>fitMeshSleeve(flutedVase(),{toleranceMm:1e-7,maxSectionPoints:16}),/maxSectionPoints/);
});

test('Householder fit recovers an affine signal, respects least-squares orthogonality and rejects rank loss',()=>{
  const rows=Array.from({length:11},(_,i)=>[1,i-5]),solve=leastSquares(rows);
  const exact=solve(rows.map(([a,x])=>3*a+2*x));
  assert.ok(Math.abs(exact[0]-3)<1e-12&&Math.abs(exact[1]-2)<1e-12);
  const values=rows.map(([a,x],i)=>3*a+2*x+(i%2?.3:-.3)),fit=solve(values);
  for(let k=0;k<2;k++)assert.ok(Math.abs(rows.reduce((s,row,i)=>s+row[k]*(values[i]-row[0]*fit[0]-row[1]*fit[1]),0))<1e-12);
  assert.throws(()=>leastSquares([[1,1],[2,2],[3,3]]),/rank deficient/);
});

test('periodic least-squares sleeve suppresses local flutes, preserves leaning envelope and closes through second derivative',()=>{
  const fitted=fitMeshSleeve(flutedVase()),{patch}=fitted;
  assert.equal(fitted.report.sourceClassification,'solid-envelope');
  assert.ok(fitted.report.rmsFitResidualMm>.3);
  for(const v of [0,.31,.5,.89,1]){
    const a=evaluate(patch,0,v),b=evaluate(patch,1,v);
    for(const name of ['point','du','dv'])for(let k=0;k<3;k++)assert.ok(Math.abs(a[name][k]-b[name][k])<1e-9,`${name} seam`);
    const z=20*v,ring=Array.from({length:128},(_,i)=>fitted.pointAt(i/128,z));
    const radii=ring.map(p=>Math.hypot(p[0]-2*v,p[1]+v));
    assert.ok(Math.max(...radii)-Math.min(...radii)<.65,'fine flutes are omitted by low-resolution fit');
    assert.ok(ring.every(p=>p[2]===z));
    assert.ok(loopArea(fitted.sectionAt(z).outer)>200);
  }
  const h=1e-5;
  for(let k=0;k<3;k++){
    const left=(evaluate(patch,1,.4).du[k]-evaluate(patch,1-h,.4).du[k])/h;
    const right=(evaluate(patch,h,.4).du[k]-evaluate(patch,0,.4).du[k])/h;
    assert.ok(Math.abs(left-right)<.1,'second derivative remains periodic');
  }
  assert.ok(fitted.sourceSectionAt(10).outer.length>fitted.sectionAt(10).outer.length);
});

test('fit is translation invariant, source sections retain bores and fit does not claim a filled material wall',()=>{
  const mesh=flutedVase({ripple:0}),offset=[-113,57,-8],a=fitMeshSleeve(mesh),b=fitMeshSleeve(translateMesh(mesh,...offset));
  for(const [u,z] of [[0,0],[.12,7],[.999,19],[1,20]]){
    const pa=a.pointAt(u,z),pb=b.pointAt(u,z+offset[2]);
    for(let k=0;k<3;k++)assert.ok(Math.abs(pa[k]+offset[k]-pb[k])<1e-10);
  }
  const hollow=ringMesh(),fit=fitMeshSleeve(makeMesh(hollow.vertices,hollow.triangles));
  assert.equal(fit.report.sourceClassification,'hollow-sleeve');
  assert.equal(fit.sourceSectionAt(1).holes.length,1);
  assert.equal(fit.sectionAt(1).holes.length,0,'reference envelope intentionally excludes the source bore');
  assert.equal(fit.patch.domainU[1],1);
  assert.throws(()=>fit.pointAt(.5,3),/height interval/);
});

test('disconnected islands and degenerate fit requests fail explicitly',()=>{
  const box=boxMesh(),vertices=[...box.vertices,...box.vertices.map(p=>[p[0]+30,p[1],p[2]])];
  const mesh=makeMesh(vertices,[...box.triangles,...box.triangles.map(t=>t.map(i=>i+box.vertices.length))]);
  assert.throws(()=>fitMeshSleeve(mesh),/disconnected, branching/);
  const vase=flutedVase({ripple:0});
  assert.throws(()=>fitMeshSleeve(vase,{heightControls:26}),/height samples/);
  assert.throws(()=>fitMeshSleeve(vase,{zMinMm:3,zMaxMm:2}),/nonempty height interval/);
});

test('dominant sleeve extraction reports tiny islands and pores without changing the source mesh',()=>{
  const box=boxMesh(12,12,2),small=boxMesh(.1,.1,2),vertices=[...box.vertices,...small.vertices.map(p=>[p[0]+13,p[1],p[2]])];
  const mesh=makeMesh(vertices,[...box.triangles,...small.triangles.map(t=>t.map(i=>i+box.vertices.length))]);
  const before=JSON.stringify(mesh.vertices),fit=fitMeshSleeve(mesh),section=fit.sourceSectionAt(1);
  assert.equal(section.loops.length,2);assert.equal(section.secondaryOuters.length,1);
  assert.ok(Math.abs(fit.report.maxSecondaryAreaMm2-.01)<1e-9);
  assert.equal(fit.report.maxSecondaryLoops,1);assert.equal(JSON.stringify(mesh.vertices),before);
  assert.throws(()=>fitMeshSleeve(mesh,{maxSecondaryAreaFraction:0}),/dominant outer/);
  const porous=ringMesh();
  for(let j=0;j<porous.vertices.length;j++)if(j%8>=4){porous.vertices[j][0]=6+(porous.vertices[j][0]-6)/20;porous.vertices[j][1]=6+(porous.vertices[j][1]-6)/20;}
  const poreFit=fitMeshSleeve(makeMesh(porous.vertices,porous.triangles));
  assert.equal(poreFit.sourceSectionAt(1).holes.length,1);assert.equal(poreFit.sourceSectionAt(1).bores.length,0);
  assert.equal(poreFit.report.sourceClassification,'solid-envelope');assert.ok(Math.abs(poreFit.report.maxPoreAreaMm2-.04)<1e-9);
});

test('fit resolution changes the estimate independently of section tessellation tolerance',()=>{
  const mesh=flutedVase(),coarse=fitMeshSleeve(mesh),detailed=fitMeshSleeve(mesh,{circumferentialControls:48}),
    finerPolyline=fitMeshSleeve(mesh,{toleranceMm:.005});
  assert.ok(detailed.report.rmsFitResidualMm<coarse.report.rmsFitResidualMm/2,'more spline controls recover flutes');
  assert.equal(finerPolyline.report.rmsFitResidualMm,coarse.report.rmsFitResidualMm);
  assert.ok(finerPolyline.sectionAt(10).outer.length>coarse.sectionAt(10).outer.length);
});

test('authoring detector preserves flat caps and proposes explicit inward bounds only for collapsed poles',()=>{
  const flat=detectMeshSleeveInterval(flutedVase(),{marginMm:.4});
  assert.deepEqual(flat.rangeMm,[0,20]);assert.equal(flat.report.excludedTopMm,0);assert.equal(flat.report.excludedBottomMm,0);
  const count=24,vertices=Array.from({length:count},(_,i)=>[10*Math.cos(2*Math.PI*i/count),10*Math.sin(2*Math.PI*i/count),10]);
  vertices.push([0,0,0],[0,0,20]);
  const triangles=[];for(let i=0;i<count;i++){const next=(i+1)%count;triangles.push([count,next,i],[count+1,i,next]);}
  const poles=makeMesh(vertices,triangles),before=JSON.stringify(poles.vertices),detected=detectMeshSleeveInterval(poles,{marginMm:.4});
  assert.deepEqual(detected.rangeMm,[.4,19.6]);assert.equal(detected.report.excludedBottomMm,.4);assert.ok(Math.abs(detected.report.excludedTopMm-.4)<1e-12);
  assert.equal(JSON.stringify(poles.vertices),before);
  assert.throws(()=>fitMeshSleeve(poles),/collapses/);
  assert.doesNotThrow(()=>fitMeshSleeve(poles,{zMinMm:detected.rangeMm[0],zMaxMm:detected.rangeMm[1]}));
});

test('authoring detector rejects separated height intervals and significant side branches',()=>{
  const box=boxMesh(12,12,2),combine=offset=>makeMesh([...box.vertices,...box.vertices.map(p=>p.map((v,k)=>v+offset[k]))],
    [...box.triangles,...box.triangles.map(t=>t.map(i=>i+box.vertices.length))]);
  assert.throws(()=>detectMeshSleeveInterval(combine([0,0,8])),/multiple usable height intervals/);
  assert.throws(()=>detectMeshSleeveInterval(combine([20,0,0])),/disconnected, branching/);
});
