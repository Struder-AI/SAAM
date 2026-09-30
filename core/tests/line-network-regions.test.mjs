import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine,checkMachinePath} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {unpackZip} from '../export/zip.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-29'};

// Two flat, identically-footprinted assembly parts so two line-network regions can stack: a
// background and lettering above it, each its own filament, each its own bead width and layer grid.
function twoRegionFixture({tools=[0,0],processB=null}={}) {
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  const box=()=>({shape:'box',runMm:40,widthMm:40,heightMm:2});
  plan.geometry={shape:'assembly',parts:[{id:'background',xMm:0,yMm:0,zMm:0,geometry:box()},{id:'lettering',xMm:0,yMm:0,zMm:0,geometry:box()}]};
  plan.placement={xMm:130,yMm:110};
  plan.process.minimumLayerSeconds=0;
  if(tools[0]!==tools[1])plan.setup.bambu.otherNozzleMm=0.4;
  plan.setup.bambu.filaments=[
    {id:'GFA00',colour:'#3355AA',tool:tools[0],source:{type:'auto'}},
    {id:'GFA00',colour:'#CC5522',tool:tools[1],source:{type:'auto'},...(tools[0]!==tools[1]?{nozzleC:215}:{}),process:processB??{lineWidthMm:0.6,firstLayerMm:0.3,layerMm:0.3}},
  ];
  plan.composition.regions=[
    {id:'bg',part:'background',filament:0,zStartMm:0,zEndMm:null,lowerSurfaceFrom:null,
      skills:{'line-network':{layers:2,networks:[{id:'net-bg',strokes:[{closed:true,points:[[0,0],[20,0],[20,20],[0,20]]}]}]}}},
    {id:'tx',part:'lettering',filament:1,zStartMm:0.4,zEndMm:null,lowerSurfaceFrom:'bg',
      skills:{'line-network':{layers:2,networks:[{id:'net-tx',strokes:[{closed:false,points:[[2,2],[18,18]]}]}]}}},
  ];
  return {plan,machine};
}

test('two line-network regions on the same nozzle deposit different colours, no tool change',async()=>{
  const {plan,machine}=twoRegionFixture({tools:[0,0]});
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino());
  checkMachinePath(path,plan,machine);
  assert.equal(path.actions.filter(a=>a.kind==='toolChange').length,1,'same nozzle: one filament-swap change event, no nozzle switch');
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(program.filamentUsage.map(u=>u.filament).sort(),[0,1]);
  assert.ok(program.filamentUsage.every(u=>u.volumeMm3>0));
});

test('two line-network regions on different nozzles deposit through a real tool change, each its own bead width and layer grid',async()=>{
  const {plan,machine}=twoRegionFixture({tools:[0,1]});
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino());
  checkMachinePath(path,plan,machine);
  const changes=path.actions.filter(a=>a.kind==='toolChange');
  assert.equal(changes.length,1,'one change, background then lettering');
  const moves=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  const bgZ=[...new Set(moves.filter(m=>m.region==='bg').map(m=>+m.to[2].toFixed(6)))].sort((a,b)=>a-b);
  const txZ=[...new Set(moves.filter(m=>m.region==='tx').map(m=>+m.to[2].toFixed(6)))].sort((a,b)=>a-b);
  assert.deepEqual(bgZ,[0.2,0.4],'background: its own 0.2 mm layers from the bed');
  assert.deepEqual(txZ,[0.7,1],'lettering: its own 0.3 mm layers starting 0.4 mm up, on top of the background');
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(new Set(program.moves.filter(m=>m.extruding).map(m=>m.tool)),new Set([0,1]));
  // Layer numbers must mean one height everywhere they are used, never two different heights sharing a number.
  const byLayer=new Map();
  for(const m of program.moves.filter(m=>m.extruding&&m.phase==='planar')){
    if(byLayer.has(m.layer))assert.equal(byLayer.get(m.layer),m.to[2],'a layer number never means two different heights');
    else byLayer.set(m.layer,m.to[2]);
  }
});

test('a line-network region cannot combine with another region skill',async()=>{
  const {plan,machine}=twoRegionFixture({tools:[0,0]});
  plan.composition.regions[0].skills['full-fill']={mode:'body'};
  assert.throws(()=>validatePlan(plan,machine),/standalone planar path/);
});

test('a line-network region without a supporting lower surface or matching part is refused',async()=>{
  const {plan,machine}=twoRegionFixture({tools:[0,0]});
  plan.composition.regions[1].lowerSurfaceFrom=null;
  validatePlan(plan,machine); // valid shape; the ordering problem only shows up at generation
  await assert.rejects(async()=>generatePath(plan,machine,await rhino()),/starts above unassigned material/);
});
