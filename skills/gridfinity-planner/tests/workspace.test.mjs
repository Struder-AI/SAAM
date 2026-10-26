import '../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planGrid,planPlates,normalizeDesign,DEFAULT_DESIGN,PITCH_MM} from '../design.mjs';
import {loadWorkspaceRuntime,workspacePrinter} from '../../../core/extensions/workspaces.mjs';
import {createWorkspaceBundles} from '../../../workspaces/export-worker.mjs';
import {loadBundle} from '../../../core/print/bundle.mjs';

const SIZED={mode:'drawer',unit:'in',drawer:{width:15,depth:20,height:3},gridGapMm:4,grid:{xUnits:null,yUnits:null}};
const design=bins=>normalizeDesign({...structuredClone(DEFAULT_DESIGN),sizing:SIZED,bins},{printer:workspacePrinter});

test('a drawer becomes whole cells centred side to side and pushed to the front',()=>{
  const g=planGrid({mode:'drawer',unit:'mm',drawer:{width:400,depth:300,height:null},gridGapMm:4,grid:{xUnits:1,yUnits:1}});
  assert.deepEqual([g.xUnits,g.yUnits],[9,7]);
  assert.equal(g.padding.left,g.padding.right);
  assert.equal(g.padding.front,0);
  assert.ok(Math.abs(g.padding.left*2+PITCH_MM*9-396)<1e-9&&Math.abs(g.padding.back+PITCH_MM*7-296)<1e-9);
});

test('a new plan starts empty and unsized',()=>{
  const d=normalizeDesign(structuredClone(DEFAULT_DESIGN),{printer:workspacePrinter});
  assert.equal(planGrid(d.sizing),null);assert.deepEqual(d.bins,[]);
  assert.deepEqual(planPlates(d,workspacePrinter('bambu-h2d')),[]);
  assert.throws(()=>normalizeDesign({...structuredClone(DEFAULT_DESIGN),bins:[{type:'bin-1x1',x:0,y:0}]},{printer:workspacePrinter}),/Size the grid/);
});

test('placements are checked against the grid, each other and the drawer height',()=>{
  assert.throws(()=>design([{type:'bin-2x1',x:0,y:0},{type:'bin-1x1',x:1,y:0}]),/overlaps/);
  assert.throws(()=>design([{type:'bin-4x1',x:6,y:0}]),/extends past/);
  assert.throws(()=>design([{type:'bin-1x1',x:0,y:0,heightUnits:12}]),/drawer fits 10/);
  assert.throws(()=>design([{type:'bin-1x1',x:0,y:0,filament:5}]),/filament/);
});

test('baseplate tiles and bins fit the bed, grouped by filament',()=>{
  const d=design([{type:'bin-2x1',x:0,y:0,filament:1},{type:'bin-1x1',x:2,y:0}]);
  const printer=workspacePrinter('bambu-h2d'),plates=planPlates(d,printer),bed=printer.printableMm;
  for(const plate of plates){
    assert.equal(plate.filaments.length,1);
    for(const item of plate.items){
      const [w,h]=item.footprintMm;
      assert.ok(item.bedMm[0]>=bed.min[0]&&item.bedMm[0]+w<=bed.max[0]&&item.bedMm[1]>=bed.min[1]&&item.bedMm[1]+h<=bed.max[1],`${item.id} leaves the bed`);
    }
  }
  const tiles=plates.flatMap(p=>p.items).filter(i=>i.kind==='baseplate');
  assert.equal(tiles.reduce((n,t)=>n+t.xUnits*t.yUnits,0),planGrid(d.sizing).xUnits*planGrid(d.sizing).yUnits);
});

test('plates become neutral bundles with gridfinity parts, text labels and colour intent',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-synthetic-gridfinity-planner-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {definition,extension}=await loadWorkspaceRuntime('gridfinity-planner');
  const d=await definition.normalize({...definition.defaults,sizing:SIZED,baseplate:{include:false},printer:{machineId:'bambu-h2d',packing:'mixed'},
    bins:[{type:'bin-2x1',x:0,y:0,filament:1,label:'M3'},{type:'bin-1x1',x:2,y:0,filament:0}]});
  const result=await createWorkspaceBundles({extensionId:'gridfinity-planner',extension,design:d,directory:join(root,'set')});
  assert.equal(result.bundles.length,1);
  const state=await loadBundle(join(root,'set',result.bundles[0].path),{program:false});
  assert.equal(state.machine,null,'Studio chooses the printer');
  const parts=Object.fromEntries(state.plan.geometry.parts.map(p=>[p.id,p.geometry.shape]));
  assert.deepEqual(parts,{'bin-1':'text','bin-2':'gridfinity'});
  assert.deepEqual(state.plan.slices.assignments.map(a=>[a.part,a.filament]),[['bin-1',null],['bin-2',null]]);
  assert.deepEqual(state.plan.workspace.requirements.materialRoles.map(r=>[r.part,r.color]),[['bin-1',d.filaments[1].colour],['bin-2',d.filaments[0].colour]]);
  assert.equal(state.plan.workspace.source.intendedPrinter.id,'bambu-h2d');
});

test('only a declared gridfinity dependency reaches a workspace',async()=>{
  const {homePaths}=await import('../../../core/application/home.mjs');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const dir=join(homePaths().extensions,'probe-workspace');
  await mkdir(join(dir,'ui'),{recursive:true});
  await writeFile(join(dir,'extension.json'),JSON.stringify({schema:'saam-extension/1',id:'probe-workspace',kind:'workspace',dependencies:[],
    entries:{'workspace-runtime':{file:'workspace.mjs',export:'create'}},workspace:{ui:'ui'},license:'test',provenance:'test'}));
  await writeFile(join(dir,'SKILL.md'),'---\nname: probe-workspace\ndescription: test\n---\n');
  await writeFile(join(dir,'ui','index.html'),'<!doctype html>');
  await writeFile(join(dir,'workspace.mjs'),`export function create({Extensions,Machine}){return {defaults:{},normalize:d=>d,preview:()=>null,pieces:()=>[{id:'one'}],
    construct:async()=>({keys:Object.keys(Extensions),printer:Machine.printer('bambu-h2d').name})};}`);
  const probe=await loadWorkspaceRuntime('probe-workspace');
  assert.deepEqual(await probe.definition.construct({},'one'),{keys:[],printer:'Bambu Lab H2D'});
});
