import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMachine,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {PathBuilder} from '../path/builder.mjs';
import {primeBeforePart} from '../path/prime.mjs';
import {exportGriffin,interpretGriffin} from '../export/griffin.mjs';

test('S5 shell exports recover, sacrificial strokes, then the part on either nozzle',async()=>{
  const native=await rhino();
  for(const tool of [0,1])for(const retractMm of [0,6.5]){
    const machine=loadMachine(),plan=defaults(machine);
    plan.setup.tool=tool;plan.process.retractMm=retractMm;plan.process.minimumLayerSeconds=0;
    plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:.6};plan.skills['draped-skin'].enabled=false;
    const path=generatePath(plan,machine,native);
    const program=interpretGriffin(exportGriffin(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-16'}),plan,machine);
    const depositing=program.moves.filter(m=>m.extruding),prime=depositing.filter(m=>m.phase==='prime');
    assert.equal(prime.length,3,'two passes and their depositing connector');
    assert.deepEqual(depositing.slice(0,3),prime,'prime is before any model deposition');
    const length=prime.reduce((sum,m)=>sum+Math.hypot(...m.to.map((v,i)=>v-m.from[i])),0);
    assert.ok(Math.abs(length-200.4)<1e-5);
    assert.ok(Math.abs(prime.reduce((sum,m)=>sum+m.volumeMm3,0)-16.032)<.001,'purge volume is actual deposited bead volume');
    assert.ok(prime.every(m=>m.from[2]===.2&&m.to[2]===.2));
    const recoveries=program.events.filter(e=>e.kind==='startup-recover');
    assert.equal(recoveries.length,retractMm?1:0);
    if(retractMm){
      assert.equal(recoveries[0].filamentMm,6.5);
      assert.ok(recoveries[0].line<prime[0].line);
      assert.equal(program.events.filter(e=>e.kind==='retract'&&e.line<prime[0].line).length,0);
      assert.equal(program.events.findLast(e=>e.kind==='retract').filamentMm,6.5);
    }
    assert.ok(program.moves.some(m=>m.line>prime.at(-1).line&&m.line<depositing[3].line&&!m.extruding&&m.to[2]>=1.2),'lift clear after priming');
  }
});

function fixture(machine=loadMachine()){
  const plan=defaults(machine),builder=new PathBuilder({start:startupPosition(machine,plan),process:plan.process,machine,generatorVersion:'test'});
  builder.retracted=startupRetracted(machine,plan);
  const geometry={min:[140,100,0],max:[148,108,2]};
  const results=[{operations:[{strokes:[{points:[[140,100,.2],[148,108,.2]],beadAreaMm2:.08}]}]}];
  return {builder,geometry,results};
}

test('priming avoids generated support extents and finds space away from occupied bed edges',()=>{
  const f=fixture();
  f.geometry={min:[0,0,0],max:[325,220,2]};
  f.results[0].operations[0].strokes[0].points=[[0,0,.2],[329,220,.2]];
  primeBeforePart(f.builder,f.geometry,f.results);
  const deposition=f.builder.actions.filter(a=>a.volumeMm3>0);
  assert.equal(deposition.length,3);
  assert.ok(deposition.every(a=>a.to[1]>224),'only the rear strip is available');
  assert.ok(deposition.every(a=>a.to[0]>=.2&&a.to[0]<=329.8&&a.to[1]<=239.8));
  const full=fixture();full.geometry={min:[0,0,0],max:[330,240,2]};
  assert.throws(()=>primeBeforePart(full.builder,full.geometry,full.results),/No room for machine priming strokes/);
  assert.equal(full.builder.actions.length,0,'reject before emitting partial motion');
});

test('profiles without explicit priming and empty deposition preserve their paths',()=>{
  for(const id of ['ultimaker-s5','bambu-h2d']){
    const machine=loadMachine(id);delete machine.startup.primingStrokes;
    const f=fixture(machine);primeBeforePart(f.builder,f.geometry,f.results);
    assert.equal(f.builder.actions.length,0,'old snapshots and other machines retain their startup');
  }
  const f=fixture();primeBeforePart(f.builder,f.geometry,[]);
  assert.equal(f.builder.actions.length,0,'priming cannot disguise an empty part');
});
