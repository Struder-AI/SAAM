import test from 'node:test';
import assert from 'node:assert/strict';
import {supportSurface,supportSurfaceSection,supportBoundaryAt} from '../../../core/geom/support-surface.mjs';
import {offsetSurfaceSection} from '../../../core/region/section-offset.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {rimmingResults} from '../scripts/rimming.mjs';
import {scheduleOperations} from '../../../core/path/compose.mjs';

const surface=(lean=0)=>({id:'edge-rim',reason:'Anchor the selected edge for bridging.',baseEdge:'bed',basePart:null,supportedEdge:'front lower edge',supportedPart:null,
  outwardSide:1,degreeU:1,degreeV:1,controlPoints:[[[0,-lean,0],[0,0,4]],[[10,-lean,0],[10,0,4]]]});

test('reused surface validity follows control-net content and does not share mutable placed patches',()=>{
  const spec=surface(),first=supportSurface(spec),second=supportSurface(structuredClone(spec),{xMm:5,yMm:2});
  assert.equal(second.bounds.min[0],first.bounds.min[0]+5);
  first.cp[0]=999;
  assert.equal(supportSurface(spec).cp[0],0,'caller mutation cannot change a subsequently built surface');
  spec.controlPoints[0][1][2]=-1;
  assert.throws(()=>supportSurface(spec),/rise monotonically/,'a changed control net must be checked');
  spec.controlPoints[0][1][2]=4;spec.degreeU=3;
  assert.throws(()=>supportSurface(spec),/degrees/,'a changed degree must be checked');
});

test('vertical reference surface gives identical offsets in both modes, with two adjacent bead centers',()=>{
  const patch=supportSurface(surface()),chain=supportSurfaceSection(patch,1)[0];assert.ok(chain?.length>1);
  for(const d of [0.2,0.6]){
    const planar=offsetSurfaceSection(patch,chain,d),normal=offsetSurfaceSection(patch,chain,d,{mode:'normal'});
    assert.deepEqual(planar,normal);
    for(const p of planar){assert.ok(Math.abs(p.point[1]+d)<1e-8);assert.ok(Math.abs(p.point[2]-1)<1e-7);}
  }
});

test('inclined rim offsets follow the selected metric and do not impose a 45-degree gate',()=>{
  const patch=supportSurface(surface(6)),chain=supportSurfaceSection(patch,2)[0];
  const planar=offsetSurfaceSection(patch,chain,0.6),normal=offsetSurfaceSection(patch,chain,0.6,{mode:'normal'});
  for(const p of planar)assert.ok(Math.abs(p.point[2]-2)<1e-7);
  for(const p of normal){assert.ok(Math.abs(Math.hypot(...p.point.map((v,k)=>v-p.reference[k]))-0.6)<1e-8);assert.ok(p.point[2]>2.4);}
  assert.notDeepEqual(planar.map(p=>p.point),normal.map(p=>p.point));
});

test('curved base/top edges retain their spline boundaries and offset sampling converges',()=>{
  const spec=surface();spec.degreeU=3;spec.degreeV=2;
  spec.controlPoints=[[[0,0,0],[0,-0.2,2],[0,0,4]],[[3,-1,0],[3,-0.5,2.5],[3,0,5]],[[7,-1,0],[7,-0.5,2.5],[7,0,5]],[[10,0,0],[10,-0.2,2],[10,0,4]]];
  const patch=supportSurface(spec);assert.ok(supportBoundaryAt(patch,0.5,'base')[1]<-0.7);assert.ok(supportBoundaryAt(patch,0.5,'top')[2]>4.7);
  for(const mode of ['horizontal','normal'])for(const chain of supportSurfaceSection(patch,3)){
    const coarse=offsetSurfaceSection(patch,chain,0.6,{mode,maxStepMm:0.4}),fine=offsetSurfaceSection(patch,chain,0.6,{mode,maxStepMm:0.1});
    const length=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.point.map((v,k)=>v-points[i].point[k])),0);
    assert.ok(Math.abs(length(coarse)/length(fine)-1)<0.003);
    for(const p of fine)assert.ok(Math.abs(Math.hypot(...p.point.map((v,k)=>v-p.reference[k]))-0.6)<1e-7);
  }
});

test('rimming accepts an opt-in loose spline offset while exact remains the default',()=>{
  const spec=surface();spec.degreeU=3;spec.degreeV=2;
  spec.controlPoints=[[[0,0,0],[0,-.2,2],[0,0,4]],[[3,-1,0],[3,-.5,2.5],[3,0,5]],[[7,-1,0],[7,-.5,2.5],[7,0,5]],[[10,0,0],[10,-.2,2],[10,0,4]]];
  const patch=supportSurface(spec),chain=supportSurfaceSection(patch,3)[0];
  const exact=offsetSurfaceSection(patch,chain,.6,{mode:'normal'});
  const loose=offsetSurfaceSection(patch,chain,.6,{mode:'normal',offsetTightness:0});
  assert.equal(loose.length,exact.length);
  assert.ok(loose.every(p=>p.point.every(Number.isFinite)));
  assert.ok(loose.some((p,i)=>Math.hypot(...p.point.map((v,k)=>v-exact[i].point[k]))>1e-8));
  assert.throws(()=>offsetSurfaceSection(patch,chain,.6,{offsetTightness:1.1}),/between zero and one/);
});

test('planar rimming tightness approaches the same projected normal on a rising U chart',()=>{
  const spec=surface();
  spec.controlPoints=[[[0,0,0],[0,2,4]],[[10,0,1],[10,2,5]]];
  const patch=supportSurface(spec),chain=supportSurfaceSection(patch,2)[0];
  for(const side of [-1,1]){
    const exact=offsetSurfaceSection(patch,chain,.6,{side}),explicit=offsetSurfaceSection(patch,chain,.6,{side,offsetTightness:1});
    assert.deepEqual(exact,explicit);
    for(const t of [0,.37,1-1e-9]){
      const blended=offsetSurfaceSection(patch,chain,.6,{side,offsetTightness:t});
      assert.equal(blended.length,exact.length);
      for(let i=0;i<blended.length;i++)assert.ok(Math.hypot(...blended[i].point.map((x,k)=>x-exact[i].point[k]))<1e-9);
    }
  }
});

function barbellPlan(machine,skill){
  const plan=defaults(machine);if(machine.id==='dobot-mg400')syntheticDobotSetup(plan);
  plan.geometry={shape:'assembly',parts:[
    {id:'lower',geometry:boxMesh(12,10,2),xMm:0,yMm:0,zMm:0},
    {id:'neck',geometry:boxMesh(2,2,6),xMm:5,yMm:4,zMm:2},
    {id:'upper',geometry:boxMesh(12,10,2),xMm:0,yMm:0,zMm:8}]};
  plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;plan.skills[skill].enabled=true;
  plan.skills[skill].surfaces=[{...surface(),id:'front-rim',baseEdge:'front top edge of lower plate',basePart:'lower',supportedEdge:'front bottom edge of upper plate',supportedPart:'upper',
    controlPoints:[[[0,0,2],[0,0,8]],[[12,0,2],[12,0,8]]]}];
  return plan;
}

test('edge-based barbell rims follow the shared layer/dependency and export pipeline on all machines',async()=>{
  const r=await rhino();
  for(const machineId of ['ultimaker-s5','bambu-h2d','dobot-mg400'])for(const skill of ['rimming-planar','rimming-normal']){
    const machine=loadMachine(machineId),plan=barbellPlan(machine,skill);plan.composition.batchLayers=3;
    const path=generatePath(plan,machine,r);checkMachinePath(path,plan,machine);
    const moves=path.actions.filter(a=>a.volumeMm3>0),firstRim=moves.findIndex(a=>a.phase===skill),firstUpper=moves.findIndex(a=>a.operation?.startsWith('upper:'));
    assert.ok(firstRim>0);assert.ok(moves.slice(firstRim).every(a=>!a.operation?.startsWith('lower:')));
    assert.ok(moves.slice(firstUpper).every(a=>a.phase!==skill));
    const rim=moves.filter(a=>a.phase===skill);assert.ok(rim.some(a=>a.role==='rim-inner')&&rim.some(a=>a.role==='rim-outer'));
    assert.ok(Math.abs(Math.max(...rim.map(m=>m.to[2]))-8)<1e-7,'no conventional top gap is applied');
    const bytes=exportProgram(path,plan,machine,{generatorVersion:'synthetic-test',buildDate:'2026-09-10'}),program=interpretProgram(bytes,plan,machine);
    assert.equal(program.moves.length,path.actions.filter(a=>a.kind==='move').length);assert.ok(program.moves.some(m=>m.phase===skill));
  }
});

test('duplicate comparison surfaces are rejected, and normal offsets require the machine capability',()=>{
  const machine=loadMachine(),plan=barbellPlan(machine,'rimming-planar');
  plan.skills['rimming-normal']=structuredClone(plan.skills['rimming-planar']);assert.throws(()=>validatePlan(plan,machine),/separate prints/);
  plan.skills['rimming-planar'].enabled=false;machine.capabilities=['xyz-extrusion','planar'];
  assert.throws(()=>validatePlan(plan,machine),/nonplanar/);
});

test('both rim modes wait for the whole sloping base and finish before any supported operation',()=>{
  const op=(id,low,high)=>({id,rank:low,layer:0,layerId:id,phase:'fixture',after:[],
    strokes:[{points:[[0,0,low],[10,0,high]]}],travelPolicy:{clearanceFor:()=>high+1},clearanceZ:high+1});
  for(const [skill,mode] of [['rimming-planar','horizontal'],['rimming-normal','normal']]){
    const plan=defaults();plan.skills[skill].enabled=true;
    plan.skills[skill].surfaces=[{...surface(),baseEdge:'sloping base edge',basePart:'lower',supportedPart:'upper',
      controlPoints:[[[0,-1,1],[0,0,4]],[[10,-1,2],[10,0,5]]]}];
    // This atomic base operation extends above the highest base point. Its
    // completion is necessary even though a max-Z-only lookup would omit it.
    const base=op('lower:crossing',1,3),upper=op('upper:first',4,4.2),peer=op('peer:middle',3.5,3.5);
    const modelResults=[{operations:[base,upper,peer]}];
    const rims=rimmingResults({plan,modelResults,mode,skillId:skill});
    const rimOps=rims[0].operations,last=rimOps.at(-1);
    assert.ok(rimOps[0].after.includes(base.id));assert.ok(upper.after.includes(last.id));
    const ordered=scheduleOperations([...rims,...modelResults]),index=id=>ordered.findIndex(o=>o.id===id);
    assert.ok(index(base.id)<index(rimOps[0].id));assert.ok(index(last.id)<index(upper.id));
    assert.ok(index(peer.id)>index(rimOps[0].id)&&index(peer.id)<index(last.id),'independent skills still weave while the rim grows');
    assert.throws(()=>scheduleOperations([...rims,...modelResults],{order:[upper.id,last.id]}),/cycle/);
  }
});
