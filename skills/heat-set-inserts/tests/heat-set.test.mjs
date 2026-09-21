import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../../../core/print/plan.mjs';
import {buildShell,translateShell,generatePath} from '../../../core/print/generate.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {fullFillResult} from '../../full-fill/scripts/fill.mjs';
import {planarInfillResults} from '../../planar-infill/scripts/infill.mjs';
import {compileHeatSet} from '../scripts/geometry.mjs';
import {heatSetFeature,dimensions} from '../scripts/feature.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {loopArea,pointInRegion} from '../../../core/region/region2d.mjs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compileText} from '../../text/scripts/text.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {initBundle} from '../../../core/print/bundle.mjs';
import {applyHeatSet} from '../../../core/print/heat-set.mjs';
import {unwrapTextGeometry,rebuildTextGeometry} from '../../../core/print/text.mjs';

const machine=loadMachine(),base=boxMesh(40,40,12),feature=heatSetFeature({positionMm:[20,20,12]});
const geometry=await compileHeatSet(base,[feature],{buildGeometry:g=>buildShell(null,g)});
const shell=buildShell(null,geometry),plan=defaults(machine);
plan.geometry=geometry;plan.placement={xMm:30,yMm:30};plan.skills['draped-skin'].enabled=false;

test('catalog hole geometry matches independent dimensions and blind depth',()=>{
  assert.deepEqual(dimensions(feature),{diameterMm:3.99,depthMm:6.74});
  assert.equal(sectionGeometry(shell,5).loops.length,1);
  const hole=sectionGeometry(shell,6).loops.find(l=>loopArea(l)<0);
  assert.ok(hole);
  for(const p of hole)assert.ok(Math.abs(Math.hypot(p[0]-20,p[1]-20)-1.995)<0.011);
});

test('gussets have a diagonal vertical edge and a double-width tapered joint',()=>{
  const detailAt=z=>shell.planarDetails.at(sectionGeometry(shell,z).loops,z,{widthMm:.4,perimeters:2,pitchMm:.4});
  const floor=5.26,radius=1.995+2.4;
  assert.equal(detailAt(floor+.1).fins.length,0,'sub-bead tip starts at the bore floor');
  for(const fraction of [.25,.5,.75,1]){
    const detail=detailAt(floor+6.74*fraction);
    const positiveX=detail.finRegion.find(loop=>loop.every(p=>p[0]>24&&Math.abs(p[1]-20)<1));
    assert.ok(positiveX);
    assert.ok(Math.abs(Math.max(...positiveX.map(p=>p[0]))-(20+radius+4*fraction))<.02,'linear reach produces the triangular vertical profile');
    const rootX=Math.min(...positiveX.map(p=>p[0])),tipX=Math.max(...positiveX.map(p=>p[0]));
    const span=x=>{const pts=positiveX.filter(p=>Math.abs(p[0]-x)<.0001);return Math.max(...pts.map(p=>p[1]))-Math.min(...pts.map(p=>p[1]));};
    assert.ok(Math.abs(span(rootX)-1.6)<.001);
    assert.ok(Math.abs(span(tipX)-(.8*(2-fraction)))<.001);
    const rootStroke=detail.fins.filter(s=>s.points.every(p=>p[0]>24&&Math.abs(p[1]-20)<1)).sort((a,b)=>a.points[0][0]-b.points[0][0])[0];
    assert.ok(Math.hypot(rootStroke.points[1][0]-rootStroke.points[0][0],rootStroke.points[1][1]-rootStroke.points[0][1])+.4>1.5,'deposited joint is about twice the original 0.8 mm');
  }
});

test('six complete contiguous loops override ordinary loop count and spacing; interiors exclude sleeve and fins',()=>{
  for(const perimeters of [0,1,3,8])for(const spacingFactor of [1,1.4]){
    const p=structuredClone(plan);Object.assign(p.skills['full-fill'],{perimeters,spacingFactor});
    const result=fullFillResult({shell,plan:p,machine});
    const layer=result.operations.filter(o=>Math.abs(o.rank-8)<1e-8),strokes=layer.flatMap(o=>o.strokes);
    const loops=strokes.filter(s=>s.role==='heat-set-loop');assert.equal(loops.length,6);
    assert.ok(strokes.some(s=>s.role==='heat-set-fin'));
    const radii=loops.map(s=>s.points.reduce((sum,q)=>sum+Math.hypot(q[0]-20,q[1]-20),0)/s.points.length).sort((a,b)=>a-b);
    radii.forEach((r,i)=>assert.ok(Math.abs(r-(1.995+(i+.5)*.4))<.025));
    const detail=shell.planarDetails.at(sectionGeometry(shell,8).loops,8,{widthMm:.4,perimeters,pitchMm:.4*spacingFactor});
    for(const s of strokes.filter(s=>s.role==='fill'))for(let i=1;i<s.points.length;i++)for(let t=0;t<=1;t+=.2){
      const a=s.points[i-1],b=s.points[i],q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
      assert.equal(pointInRegion(q,detail.fillExclusion),false,'fill enters reserved reinforcement');
    }
  }
});

test('sparse and solid surface composition emits details once and translated geometry retains local details',()=>{
  const p=structuredClone(plan);p.skills['planar-infill'].enabled=true;p.skills['full-fill'].mode='solid-surfaces';
  const placed=translateShell(shell,30,40,2);
  const results=planarInfillResults({shell:placed,plan:p,machine,solid:true});
  const at=results.flatMap(r=>r.operations).filter(o=>Math.abs(o.rank-13.8)<1e-8).flatMap(o=>o.strokes);
  assert.equal(at.filter(s=>s.role==='heat-set-loop').length,6);
  const expected=placed.planarDetails.at(sectionGeometry(placed,13.8).loops,13.8,{widthMm:.4,perimeters:2,pitchMm:.4}).fins;
  assert.equal(at.filter(s=>s.role==='heat-set-fin').length,expected.length,'solid partner must not deposit the fins again');
  assert.ok(at.filter(s=>s.role==='heat-set-loop').every(s=>s.points.every(q=>Math.abs(q[0]-50)<5&&Math.abs(q[1]-60)<5)));
});

test('native assembly and planar material regions use the same detail producer',()=>{
  const p=structuredClone(plan);p.geometry={shape:'assembly',parts:[{id:'mount',geometry,xMm:0,yMm:0,zMm:0},{id:'other',geometry:boxMesh(8,8,2),xMm:45,yMm:0,zMm:0}]};
  p.composition.regions=[{id:'base',part:'mount',zStartMm:0,zEndMm:4,lowerSurfaceFrom:null,skills:{'full-fill':{}}},{id:'mount',part:'mount',zStartMm:4,zEndMm:null,lowerSurfaceFrom:null,skills:{'planar-infill':{density:.15},'full-fill':{mode:'solid-surfaces'}}}];
  const result=generatePath(p,machine,null);
  assert.ok(result.actions.some(m=>m.role==='heat-set-loop'));
});

test('insert edits under raised text preserve text and rebuild the original bore once',async()=>{
  const r=await rhino(),bytes=await readFile(new URL('../../text/tests/fixtures/Abel-Regular.ttf',import.meta.url));
  const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
  const p=structuredClone(plan);p.geometry=await compileText(geometry,[{id:'label',text:'A',font,positionMm:[2,2],sizeMm:3,reference:{kind:'plane',origin:[0,0,12],xAxis:[1,0,0],yAxis:[0,1,0]}}],{buildGeometry:g=>buildShell(r,g)});
  const dir=await mkdtemp(join(tmpdir(),'saam-heat-text-'));
  try{
    await initBundle(dir,p);
    const updated=await applyHeatSet(dir,{feature:{diameterAdjustmentMm:.1}});
    assert.equal(updated.plan.geometry.shape,'text');
    assert.equal(updated.plan.geometry.base.features.length,1);
    assert.equal(updated.plan.geometry.base.features[0].diameterAdjustmentMm,.1);
    const removed=await applyHeatSet(dir,{remove:'insert'});
    assert.equal(removed.plan.geometry.shape,'text');assert.equal(removed.plan.geometry.base.shape,'mesh');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('text-owned wrapper stages preserve frozen layer order and stop at standalone text',async()=>{
  const r=await rhino(),bytes=await readFile(new URL('../../text/tests/fixtures/Abel-Regular.ttf',import.meta.url));
  const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
  const text=(id,value,positionMm)=>({id,text:value,font,positionMm,sizeMm:3,reference:{kind:'plane',origin:[0,0,12],xAxis:[1,0,0],yAxis:[0,1,0]}});
  const buildGeometry=g=>buildShell(r,g);
  const inner=await compileText(geometry,[text('inner','A',[2,2])],{buildGeometry,toleranceMm:.02,maxEdgeMm:.8});
  const outer=await compileText(inner,[text('outer','B',[8,2])],{buildGeometry,toleranceMm:.03,maxEdgeMm:.9});
  const before=structuredClone(outer);
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
  freeze(outer);
  const stack=unwrapTextGeometry(outer);
  assert.deepEqual(stack.layers.map(layer=>layer.features[0].id),['outer','inner']);
  assert.equal(stack.base.shape,'heat-set');
  const rebuilt=await rebuildTextGeometry(stack.base,stack.layers,{buildGeometry});
  assert.deepEqual(rebuilt,before);
  assert.deepEqual(outer,before);

  const standalone=await compileText(geometry,[text('standalone','C',[2,2])],{buildGeometry,standalone:true});
  const wrapped=await compileText(standalone,[text('wrapper','D',[8,2])],{buildGeometry});
  const stopped=unwrapTextGeometry(wrapped);
  assert.deepEqual(stopped.layers.map(layer=>layer.features[0].id),['wrapper']);
  assert.equal(stopped.base.standalone,true);
});

test('insufficient host and invalid feature settings fail explicitly',async()=>{
  assert.throws(()=>heatSetFeature({insertId:'M3'}),/catalog/);
  assert.throws(()=>heatSetFeature({finCount:0}),/finCount/);
  const unsupported=structuredClone(plan);unsupported.skills['full-fill'].enabled=false;unsupported.skills['vase-wall'].enabled=true;
  assert.throws(()=>generatePath(unsupported,machine,null),/planar fill/);
  await assert.rejects(compileHeatSet(base,[heatSetFeature({positionMm:[20,20,11]})],{buildGeometry:g=>buildShell(null,g)}),/insertion face/);
  const p=structuredClone(plan);p.skills['full-fill'].perimeters=40;
  assert.throws(()=>fullFillResult({shell,plan:p,machine}),/ordinary walls/);
});
