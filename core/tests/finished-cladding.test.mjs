import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {wavyCladdingPlan} from './fixtures/wavy-cladding.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell,generatePath} from '../print/generate.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {publishFinishedBoundary,consumeFinishedSurface} from '../path/finished-surface.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {initBundle,generateBundle,loadBundle,deliver} from '../print/bundle.mjs';
import {claddingSubstrateName,hasSkill,recipeRows} from '../../studio/settings.mjs';

const r=await rhino(),machine=loadMachine('denso-vp6242-rc8');
const small=()=>{const p=wavyCladdingPlan({heightMm:12,columns:24,rows:9});p.skills['pipe-cladding'].shells=2;return p;};
const run=p=>generatePath(p,machine,r);
const extrusions=path=>path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);

test('cladding consumes a wavy vase exterior without changing its existing deposition or filling its bore',()=>{
  const p=small(),bare=structuredClone(p);bare.skills['pipe-cladding'].enabled=false;
  const before=run(bare),after=run(p),moves=extrusions(after);
  assert.deepEqual(moves.filter(a=>a.phase==='vase-wall'),extrusions(before));
  assert.ok(!moves.some(a=>a.phase==='planar'));
  assert.deepEqual(after.summary.pipeCladding.substrate.sourceOperationIds,['vase-wall:wall']);
  const first=moves.findIndex(a=>a.phase==='cladding-helix-forward');
  assert.ok(first>0&&moves.slice(first).every(a=>a.phase!=='vase-wall'));
  assert.match(claddingSubstrateName(p),/Vase wall/);
  assert.equal(p.skills['pipe-cladding'].spacingFactor,3);
});

test('the same exterior consumer works with solid fill and patterned infill producers',()=>{
  for(const source of ['full-fill','planar-infill']){
    const p=small();p.skills['vase-wall'].enabled=false;p.skills[source].enabled=true;
    p.skills[source].perimeters=1;
    const result=run(p);
    assert.ok(result.summary.pipeCladding.substrate.sourceOperationIds.every(id=>id.startsWith(source)));
    assert.ok(extrusions(result).some(a=>a.phase==='cladding-helix-reverse'));
  }
});

test('regional base and vase wall publish one usable exterior with their own prerequisites',()=>{
  const p=small();p.composition.regions=[
    {id:'base',part:null,zStartMm:0,zEndMm:.6,lowerSurfaceFrom:null,skills:{'full-fill':{perimeters:1}}},
    {id:'wall',part:null,zStartMm:.6,zEndMm:null,lowerSurfaceFrom:null,skills:{'vase-wall':{endTransition:'level'}}}
  ];
  const result=run(p),ids=result.summary.pipeCladding.substrate.sourceOperationIds;
  assert.ok(ids.some(id=>id.startsWith('base:')));assert.ok(ids.includes('wall:vase-wall:wall'));
  assert.ok(hasSkill(p,'pipe-cladding'));
  assert.ok(recipeRows(p,machine).some(([label,value])=>label.endsWith('Pattern')&&value==='crossed helices'));
});

test('assembly cladding selects its finished component and rejects an unprinted component',()=>{
  const p=small(),geometry=p.geometry;
  p.geometry={shape:'assembly',parts:[
    {id:'vessel',geometry,xMm:0,yMm:0,zMm:0},
    {id:'other',geometry:{shape:'box',runMm:8,widthMm:8,heightMm:1.2},xMm:30,yMm:0,zMm:0}
  ]};
  p.skills['vase-wall'].part='vessel';p.skills['pipe-cladding'].part='vessel';
  p.skills['full-fill'].enabled=true;p.skills['full-fill'].parts=['other'];
  const result=run(p);
  assert.deepEqual(result.summary.pipeCladding.substrate.sourceOperationIds,['vessel:vase-wall:wall']);
  p.skills['vase-wall'].enabled=false;
  assert.throws(()=>run(p),/no finished material producer/);
});

test('surface contract accepts another producer without a skill-name allowlist and checks the published extent',()=>{
  const p=small(),shell=buildShell(r,p.geometry),selection=p.skills['pipe-cladding'].surface;
  assert.throws(()=>consumeFinishedSurface({shell,selection,results:[]}),/no finished material producer/);
  const source=publishFinishedBoundary({id:'future-pattern',operations:[{id:'future:done',strokes:[{points:[[10,0,0],[10,0,12]]}]}]},
    {shell,boundary:'side',coverage:'nominal'});
  const finished=consumeFinishedSurface({shell,selection,results:[source]});
  const result=pipeCladdingResult({plan:p,shell,finishedSurface:finished});
  assert.deepEqual(result.operations[0].after,['future:done']);
  assert.equal(source.finishedSurfaces[0].contains({point:[0,0,12]}),false,'a side boundary cannot publish an unprinted cap');
  source.finishedSurfaces[0].endMm=6;
  assert.throws(()=>pipeCladdingResult({plan:p,shell,finishedSurface:consumeFinishedSurface({shell,selection,results:[source]})}),/not produced/);
});

test('finished-surface composition survives checked export and cold development reopening',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-finished-cladding-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await initBundle(dir,small(),{machineId:machine.id});await generateBundle(dir,{development:true});
  const state=await loadBundle(dir);assert.equal(state.programError,undefined);
  for(const phase of ['vase-wall','cladding-helix-forward','cladding-helix-reverse'])assert.ok(state.program.moves.some(m=>m.extruding&&m.phase===phase));
  assert.deepEqual(state.review.approvals,{});await assert.rejects(()=>deliver(dir),/approv/);
});
