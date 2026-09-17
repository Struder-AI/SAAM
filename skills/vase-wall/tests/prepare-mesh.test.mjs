import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {importSTLBundle} from '../../../core/print/import-stl.mjs';
import {loadBundle,adjustBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {prepareMeshVase} from '../scripts/prepare-mesh.mjs';
import {layerHeights} from '../../full-fill/scripts/fill.mjs';

const meshBytes=()=>{
  const mesh=boxMesh(20,16,2);
  return Buffer.from('solid sleeve\n'+mesh.triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(v=>'vertex '+mesh.vertices[v].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid sleeve\n');
};
async function imported(t){
  const dir=await mkdtemp(join(tmpdir(),'saam-prepare-mesh-'));
  t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  await importSTLBundle(dir,meshBytes(),{units:'mm',setupFile:join(dir,'no-remembered-setup.json')});
  return dir;
}
const options=()=>({loop:{widthCells:1.3,depthMm:.6,samples:12},cellsPerTurn:8,baseHeightMm:.4,meshSleeve:{fidelity:0,circumferentialControls:8,heightControls:4}});

test('imported STL becomes an editable mesh-sleeve recipe through normal preparation, adjustment and checked generation',async t=>{
  const dir=await imported(t),before=await loadBundle(dir,{program:false});
  const source=await readFile(join(dir,'geometry/source.stl')),native=await readFile(join(dir,'geometry/model.mesh.json'));
  const result=await prepareMeshVase(dir,options(),{expectedRevision:before.revision});
  assert.equal(result.geometryHash,before.geometryHash);assert.equal(result.geometryApproved,false);assert.equal(result.planApproved,false);
  assert.equal(result.settings.endTransition,'level');assert.equal(result.settings.meshSleeve.fidelity,0);
  assert.equal(result.report.automaticCourseCount,true);assert.equal(result.report.bodyCourses,6);assert.equal(result.report.boundaryCourses,2);
  assert.deepEqual(await readFile(join(dir,'geometry/source.stl')),source);
  assert.deepEqual(await readFile(join(dir,'geometry/model.mesh.json')),native);
  let state=await loadBundle(dir,{program:false});
  assert.deepEqual(state.plan.setup,before.plan.setup);assert.deepEqual(state.plan.process,before.plan.process);
  assert.deepEqual(state.plan.geometry,before.plan.geometry);
  await adjustBundle(dir,{skills:{'vase-wall':{meshSleeve:{fidelity:.37}}}},{expectedRevision:state.revision});
  state=await loadBundle(dir,{program:false});assert.equal(state.plan.skills['vase-wall'].meshSleeve.fidelity,.37);
  assert.equal(state.plan.skills['vase-wall'].meshSleeve.heightControls,4);
  await assert.rejects(()=>adjustBundle(dir,{skills:{'vase-wall':{meshSleeve:{unknownSetting:1}}}},{expectedRevision:state.revision}),/Unknown setting/);
  // An isolated development generation checks the normal exporter without
  // manufacturing approvals; use the smooth endpoint for this authoring test.
  await adjustBundle(dir,{skills:{'vase-wall':{meshSleeve:{fidelity:0}}}},{expectedRevision:state.revision});
  const checked=await generateBundle(dir,{development:true});assert.ok(checked.moves>0);
  state=await loadBundle(dir);assert.equal(state.geometryApproved,false);assert.equal(state.toolpathApproved,false);
});

test('preparation preserves requested courses, rejects stale edits and never silently truncates an oversized recipe',async t=>{
  const dir=await imported(t),before=await loadBundle(dir,{program:false});
  const first=await prepareMeshVase(dir,{...options(),repeats:2});
  assert.equal(first.report.automaticCourseCount,false);assert.equal(first.report.bodyCourses,2);
  await assert.rejects(()=>prepareMeshVase(dir,{}, {expectedRevision:before.revision}),/stale/);
  const repeated=await prepareMeshVase(dir,{meshSleeve:{fidelity:.4}});
  assert.deepEqual(repeated.settings.pattern,first.settings.pattern);
  const state=await loadBundle(dir,{program:false}),oversized=structuredClone(state.plan.skills['vase-wall'].pattern);oversized.repeats=100;
  await assert.rejects(()=>prepareMeshVase(dir,{pattern:oversized}),/no path was trimmed/);
  assert.equal((await loadBundle(dir,{program:false})).revision,state.revision);
});

test('preparation rejects existing composition and customized producers rather than clearing them',async t=>{
  const dir=await imported(t);
  await adjustBundle(dir,{skills:{'draped-skin':{enabled:true,sampleStepMm:.8}}});
  const state=await loadBundle(dir,{program:false});
  await assert.rejects(()=>prepareMeshVase(dir,options()),/cannot replace enabled draped-skin/);
  assert.equal((await loadBundle(dir,{program:false})).revision,state.revision);
  await adjustBundle(dir,{skills:{'draped-skin':{enabled:false}},composition:{regions:[{id:'body',part:null,zStartMm:0,zEndMm:2,skills:{'full-fill':{}},lowerSurfaceFrom:null}]}});
  await assert.rejects(()=>prepareMeshVase(dir,options()),/existing composition/);
});

test('preparation cannot accept a secondary-island allowance that generation does not support',async t=>{
  const dir=await imported(t),before=await loadBundle(dir,{program:false});
  await assert.rejects(()=>prepareMeshVase(dir,{...options(),detect:{maxSecondaryAreaFraction:.01}}),
    /maxSecondaryAreaFraction must be between 0 and 0.001/);
  assert.equal((await loadBundle(dir,{program:false})).revision,before.revision);
  const strict=await prepareMeshVase(dir,{...options(),detect:{maxSecondaryAreaFraction:0}});
  assert.equal(strict.report.detectedSleeve.report.maxSecondaryAreaFraction,0);
});

test('detected cone caps use the chosen bead margin and snap a new base to an unequal first-layer grid',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-prepare-cone-'));
  t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const count=24,vertices=[[0,0,0]],triangles=[];
  for(const z of [.25,4])for(let i=0;i<count;i++)vertices.push([8*Math.cos(i*2*Math.PI/count),8*Math.sin(i*2*Math.PI/count),z]);
  const cap=vertices.length;vertices.push([0,0,4]);
  for(let i=0;i<count;i++){
    const a=1+i,b=1+(i+1)%count;
    triangles.push([0,b,a],[a,b,b+count],[a,b+count,a+count],[cap,a+count,b+count]);
  }
  const bytes=Buffer.from('solid cone\n'+triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(v=>'vertex '+vertices[v].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid cone\n');
  await importSTLBundle(dir,bytes,{units:'mm',setupFile:join(dir,'no-remembered-setup.json')});
  await adjustBundle(dir,{process:{lineWidthMm:.8,layerMm:.16,firstLayerMm:.1,minimumLayerSeconds:0}});
  const result=await prepareMeshVase(dir,{loop:{depthMm:.3,widthCells:1.3,samples:8},cellsPerTurn:4,meshSleeve:{fidelity:0}});
  assert.equal(result.report.detectedSleeve.report.marginMm,.8);
  assert.equal(result.report.detectedSleeve.report.excludedBottomMm,.8);
  assert.ok(Math.abs(result.report.baseHeightMm-.9)<1e-12);
  const state=await loadBundle(dir,{program:false});
  const baseLayers=layerHeights(state.plan.process,0,result.report.baseHeightMm);
  assert.equal(baseLayers.at(-1),result.report.baseHeightMm);
  assert.ok(baseLayers.at(-2)<result.report.detectedSleeve.rangeMm[0]);
  const checked=await generateBundle(dir,{development:true});assert.ok(checked.moves>0);
  const preserved=await prepareMeshVase(dir,{meshSleeve:{fidelity:0}});
  assert.equal(preserved.report.baseHeightMm,result.report.baseHeightMm);
  const explicit=await prepareMeshVase(dir,{baseHeightMm:1.06,loop:{depthMm:.3,widthCells:1.3,samples:8},cellsPerTurn:4,meshSleeve:{fidelity:0}});
  assert.equal(explicit.report.baseHeightMm,1.06);
});

test('the packaged CLI accepts a JSON recipe and returns the saved revision',async t=>{
  const dir=await imported(t),file=join(dir,'mesh-vase-options.json');await writeFile(file,JSON.stringify(options()));
  const stdout=execFileSync(process.execPath,['skills/vase-wall/scripts/prepare-mesh.mjs',dir,'--options',file],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'});
  const result=JSON.parse(stdout);assert.equal(result.revision,(await loadBundle(dir,{program:false})).revision);
  assert.equal(result.report.sourceGeometryChanged,false);
  const outside=await prepareMeshVase(dir,{...options(),meshSleeve:{contactSide:'outside'}});
  assert.ok(outside.settings.pattern.motif.offsetMm.every(offset=>offset>=0),'new default loops face the selected contact side');
  await assert.rejects(()=>prepareMeshVase(dir,{fidelty:.5}),/Unknown or invalid/);
  await assert.rejects(()=>prepareMeshVase(dir,{meshSleeve:null}),/Unknown or invalid meshSleeve/);
});
