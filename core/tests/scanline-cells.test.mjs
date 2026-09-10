import test from 'node:test';
import assert from 'node:assert/strict';
import {scanlineFill} from '../region/region2d.mjs';
import {ringMesh} from './fixtures/mesh.mjs';
import {defaults} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {orderScanlineCells,PathBuilder} from '../path/builder.mjs';
import {composeResults,scheduleOperations} from '../path/compose.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const sides=rows=>rows.filter(r=>r.scanY>5&&r.scanY<25).map(r=>r.from[0]<10?'left':'right');
const changes=values=>values.reduce((n,v,i)=>n+(i>0&&v!==values[i-1]?1:0),0);

test('closest cell entry starts at the current nozzle, reverses intact groups and preserves segment data',()=>{
  const strokes=[
    {scanlineCell:'far',points:[[30,0,1],[35,0,1]],beadAreaMm2:0.08},
    {scanlineCell:'near',points:[[1,0,1],[2,0,1],[3,0,1]],volumesMm3:[0.1,0.2],segmentMetadata:[{gapMm:1},{gapMm:2}]},
    {scanlineCell:'near',points:[[3,1,1],[1,1,1]],volumesMm3:[0.3],segmentMetadata:[{gapMm:3}]}
  ].map(s=>({...s,role:'fill',speedMmS:10}));
  const original=structuredClone(strokes),start=[1,1,1];
  const ordered=orderScanlineCells(strokes,start);
  assert.deepEqual(ordered.map(s=>s.scanlineCell),['near','near','far']);
  assert.deepEqual(ordered[0].points,[[1,1,1],[3,1,1]]);
  assert.deepEqual(ordered[1].points,[[3,0,1],[2,0,1],[1,0,1]]);
  assert.deepEqual(ordered[1].volumesMm3,[0.2,0.1]);
  assert.deepEqual(ordered[1].segmentMetadata,[{gapMm:2},{gapMm:1}]);
  assert.deepEqual(strokes,original,'ordering must not mutate producer results');
  assert.deepEqual(orderScanlineCells(strokes,start),ordered,'deterministic');
  const machine=loadMachine('ultimaker-s5'),plan=defaults(machine);plan.process.minimumLayerSeconds=0;
  const builder=new PathBuilder({start,process:plan.process,machine,generatorVersion:'test'});
  const op={id:'cells',layerId:'one',phase:'planar',layer:0,rank:1,strokes,order:'nearest-cells',travelPolicy:{clearanceFor:()=>2,maxCombMm:0},clearanceZ:2};
  composeResults(builder,[{operations:[op]}]);
  const moves=builder.actions.filter(a=>a.volumeMm3>0);
  assert.deepEqual(moves.slice(0,3).map(m=>[m.to,m.volumeMm3,m.gapMm]),[
    [[3,1,1],0.3,3],[[2,0,1],0.2,2],[[1,0,1],0.1,1]
  ]);
  assert.throws(()=>scheduleOperations([{operations:[{...op,continuous:true}]}]),/grouped open strokes/);
  assert.throws(()=>scheduleOperations([{operations:[{...op,strokes:[{...strokes[0],poses:[]}]}]}]),/grouped open strokes/);
});

test('hole cells and disconnected islands stay intact with identical deposition coverage',()=>{
  const loops=[rect(0,0,30,30),rect(10,5,10,20).reverse(),rect(45,0,5,5)];
  const rows=scanlineFill(loops,1,0),strokes=rows.map((r,i)=>({scanlineCell:r.cellId,points:(i%2?[r.to,r.from]:[r.from,r.to]).map(p=>[...p,1])}));
  const start=[50,4,1],ordered=orderScanlineCells(strokes,start);
  assert.deepEqual(ordered[0].points[0],start,'choose the nearby island before the leftmost component');
  const ids=ordered.map(s=>s.scanlineCell);
  assert.equal(changes(ids),new Set(ids).size-1,'finish every cell before changing regions');
  const coverage=ss=>ss.map(s=>s.points.map(p=>p.join(',')).sort().join('|')).sort();
  assert.deepEqual(coverage(ordered),coverage(strokes));
  let cursor=start;
  const remaining=new Set(ids);
  for(let i=0;i<ordered.length;) {
    const id=ordered[i].scanlineCell;
    const candidates=[...remaining].flatMap(key=>{const cell=strokes.filter(s=>s.scanlineCell===key);return [cell[0].points[0],cell[0].points.at(-1),cell.at(-1).points[0],cell.at(-1).points.at(-1)];});
    const gap=p=>Math.hypot(...p.map((v,k)=>v-cursor[k]));
    assert.equal(gap(ordered[i].points[0]),Math.min(...candidates.map(gap)));
    while(i<ordered.length&&ordered[i].scanlineCell===id)cursor=ordered[i++].points.at(-1);
    remaining.delete(id);
  }
});

test('each end row can start at either endpoint, independent of zigzag parity',()=>{
  for(const count of [1,2,3,4]) {
    const strokes=Array.from({length:count},(_,i)=>({scanlineCell:0,
      points:(i%2?[[10,i,1],[7,i,1],[0,i,1]]:[[0,i,1],[3,i,1],[10,i,1]]),
      volumesMm3:[i+0.1,i+0.2],segmentMetadata:[{segment:i+':a'},{segment:i+':b'}]
    }));
    const original=structuredClone(strokes);
    const segments=ss=>ss.flatMap(s=>s.points.slice(1).map((p,i)=>JSON.stringify({
      endpoints:[s.points[i],p].sort((a,b)=>a[0]-b[0]),volume:s.volumesMm3[i],data:s.segmentMetadata[i]
    }))).sort();
    for(const start of [[0,0,1],[10,0,1],[0,count-1,1],[10,count-1,1]]) {
      const ordered=orderScanlineCells(strokes,start);
      assert.deepEqual(ordered[0].points[0],start,'a coincident valid endpoint must not be skipped');
      assert.deepEqual(segments(ordered),segments(strokes),'same geometric segments and material data');
      for(let i=1;i<ordered.length;i++) {
        const a=ordered[i-1].points.at(-1),b=ordered[i].points[0];
        assert.equal(a[0],b[0],'keep alternating strokes joined on the same side');
        assert.equal(Math.abs(a[1]-b[1]),1,'sweep adjacent rows without skipping');
      }
      assert.deepEqual(strokes,original);
    }
  }
});

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
