import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referencePatch} from '../../../core/geom/reference-surface.mjs';
import {surfaceWaves,connectWavePasses,WAVE_DEFAULTS,waveResults} from '../scripts/wave.mjs';
import {scheduleOperations} from '../../../core/path/compose.mjs';
import {pointInRegion} from '../../../core/region/region2d.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const settings={...WAVE_DEFAULTS,lineSpacingMm:0.5,propagationStepMm:0.25,sampleStepMm:0.5};
const plane=(slope=0,scaleU=1,scaleV=1)=>referencePatch({degreeU:1,degreeV:1,
  knotsU:[0,0,scaleU,scaleU],knotsV:[0,0,scaleV,scaleV],
  controlPoints:[[[0,0,1],[0,5,1]],[[5,0,1+5*slope],[5,5,1+5*slope]]]});

test('a curved canopy rim retains rounding residue without spurious perimeter passes',()=>{
  // Original SAAM canopy geometry, starting one complete ring before its rim.
  // This isolates the large example's failure without regenerating 110 rings.
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/canopy-rim.json',import.meta.url)));
  for(const [x,y] of [[0,0],[140.2,100.2]]){
    const surface={...fixture.surface,controlPoints:fixture.surface.controlPoints.map(row=>row.map(p=>[p[0]+x,p[1]+y,p[2]]))};
    const patch=referencePatch(surface),s={...settings,lineSpacingMm:.3,propagationStepMm:.3};
    const result=surfaceWaves(patch,fixture.domainUv,fixture.seedUv,s);
    assert.deepEqual(result.waves.map(w=>w.paths.length),[1]);
    assert.ok(result.report.residualsUv.length>0,'Numerical strips remain reported.');
    assert.ok(result.report.residualMaxSampleDiameterMm>s.toleranceMm,'Long strips are not mislabeled as short residuals.');
    assert.ok(result.report.residualRoundingBandUv>0&&result.report.residualRoundingBandUv<=s.toleranceMm/240);
    assert.equal(connectWavePasses(patch,result.waves,fixture.domainUv,s,.4).passes.length,1);
  }
});

test('wave spacing is physical on inclined, independently rescaled UV planes',()=>{
  for(const [u,v] of [[1,1],[4,0.2]]){
    const r=surfaceWaves(plane(0.2,u,v),[rect(0,0,u,v)],[rect(0,0,0.3*u,v)],settings);
    r.waves.slice(0,-1).forEach((wave,i)=>{
      const xs=wave.paths.flatMap(p=>p.points.map(p=>p[0]));
      assert.ok(Math.abs(Math.max(...xs)-(1.5+(i+1)*0.5/Math.sqrt(1.04)))<0.002);
    });
    assert.equal(r.report.physicalValidation,'not performed');
  }
});

test('fronts split and rejoin around a hole without printing through it',()=>{
  const hole=rect(0.45,0.3,0.15,0.4),domain=[rect(0,0,1,1),hole.toReversed()];
  const r=surfaceWaves(plane(),domain,[rect(0,0,0.25,1)],settings);
  assert.ok(r.waves.some(w=>w.paths.length>1));
  // The final wave is within one spacing of the edge; stationary perimeter
  // segments are not extra fronts or perpendicular glue strokes.
  assert.ok(r.waves.some(w=>w.paths.some(p=>p.points.some(p=>p[0]>=5-settings.lineSpacingMm-0.01))));
  for(const wave of r.waves)for(const path of wave.paths)for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],uv=[(a[0]+b[0])/10,(a[1]+b[1])/10];
    assert.ok(!pointInRegion(uv,[rect(0.45001,0.30001,0.14998,0.39998)]),'No segment enters the hole.');
  }
});

test('a thin barrier cannot seed a disconnected island across empty space',()=>{
  assert.throws(()=>surfaceWaves(plane(),[rect(0,0,0.499,1),rect(0.501,0,0.499,1)],[rect(0,0,0.25,1)],settings),/cannot reach|unreachable/);
  const both=surfaceWaves(plane(),[rect(0,0,0.45,1),rect(0.55,0,0.45,1)],
    [rect(0,0,0.25,1),rect(0.55,0,0.1,1)],settings);
  assert.ok(both.waves.length>0);
});

test('rational cylinder fronts follow intrinsic distance and stay on the surface',()=>{
  const radius=5,w=Math.SQRT1_2;
  const patch=referencePatch({degreeU:2,degreeV:1,controlPoints:[
    [[radius,0,1],[radius,0,4]],[[radius,radius,1,w],[radius,radius,4,w]],[[0,radius,1],[0,radius,4]]]});
  const r=surfaceWaves(patch,[rect(0,0,1,1)],[rect(0,0,0.25,1)],settings);
  // Seed angle measured independently from the rational quadratic formula.
  const t=0.25,theta=Math.atan2(2*w*t*(1-t)+t*t,(1-t)**2+2*w*t*(1-t));
  for(const [i,wave] of r.waves.slice(0,-1).entries()){
    const angles=wave.paths.flatMap(p=>p.points.map(([x,y])=>Math.atan2(y,x)));
    assert.ok(Math.abs(radius*(Math.max(...angles)-theta)-(i+1)*settings.lineSpacingMm)<0.015);
    for(const p of wave.paths.flatMap(p=>p.points))assert.ok(Math.abs(Math.hypot(p[0],p[1])-radius)<1e-9);
  }
});

test('doubly curved native spline output has changing Z and preserves the analytic graph',()=>{
  const cp=[];
  for(let i=0;i<3;i++){cp[i]=[];for(let j=0;j<3;j++)cp[i][j]=[2.5*i,2.5*j,1+[0,0,0.25][i]+[0,0,0.125][j]];}
  const r=surfaceWaves(referencePatch({degreeU:2,degreeV:2,controlPoints:cp}),[rect(0,0,1,1)],[rect(0,0,0.3,1)],settings);
  for(const p of r.waves.flatMap(w=>w.paths.flatMap(p=>p.points)))assert.ok(Math.abs(p[2]-1-0.01*p[0]**2-0.005*p[1]**2)<1e-10);
  assert.ok(r.waves[0].paths[0].points.some(p=>p[2]>1.1));
});

test('propagation ends on coverage or non-progress, with no work budgets to spend',()=>{
  for(const key of ['maxWaves','maxPoints','maxEvaluations'])assert.equal(key in WAVE_DEFAULTS,false);
  const machine=loadMachine(),plan=defaults(machine);
  plan.skills['wave-overhangs'].maxWaves=1000;
  assert.throws(()=>validatePlan(plan,machine),/Unexpected or missing fields/);
  // Spacing five times finer than the other cases needs many more fronts,
  // points and surface evaluations, and simply runs until the slice is covered.
  const fine={...settings,lineSpacingMm:0.1,propagationStepMm:0.1};
  const result=surfaceWaves(plane(),[rect(0,0,1,1)],[rect(0,0,0.3,1)],fine);
  assert.ok(result.waves.length>30,`fronts: ${result.waves.length}`);
  assert.ok(result.report.points>result.waves.length&&result.report.evaluations>result.report.points);
});

test('wave dependencies hold complete seed and successor operations across an ordered slice stack',()=>{
  const machine=loadMachine(),plan=defaults(machine);
  const op=(id,z)=>({id,layerId:id,rank:z,strokes:[{points:[[0,0,z],[1,0,z]],beadAreaMm2:0.08,speedMmS:5}],
    after:[],travelPolicy:{clearanceFor:()=>z}});
  // Deliberately lower the successor: a height sort alone would place it first.
  const base=op('base:body',1),upper=op('upper:body',0.2),modelResults=[{id:'body',operations:[base,upper]}];
  const slice={id:'first',reason:'Synthetic assigned anchor and successor',
    surface:{degreeU:1,degreeV:1,controlPoints:[[[0,0,1],[0,2,1]],[[2,0,1],[2,2,1]]]},
    domainUv:[rect(0,0,1,1)],seedUv:[rect(0,0,0.5,1)],afterParts:['base'],beforeParts:[]};
  plan.skills['wave-overhangs']={...settings,enabled:true,slices:[slice,{...structuredClone(slice),id:'second',afterParts:[],beforeParts:['upper']}]};
  const results=waveResults({plan,machine,placed:null,componentShells:null,modelResults});
  const order=scheduleOperations([...modelResults,...results]).map(op=>op.id);
  assert.equal(order[0],base.id);assert.equal(order.at(-1),upper.id);
  assert.ok(order.indexOf(results[0].operations.at(-1).id)<order.indexOf(results[1].operations[0].id));
  const invalid=structuredClone(plan);invalid.skills['wave-overhangs'].slices[0].domainUv=[rect(0,0,2,1)];
  assert.throws(()=>waveResults({plan:invalid,machine,modelResults,placed:null,componentShells:null}),/exceeds/);
});

export function wavePlan(machine=loadMachine()){
  const plan=defaults(machine);
  plan.geometry={shape:'box',runMm:5,widthMm:5,heightMm:1};
  plan.skills['draped-skin'].enabled=false;
  plan.process.minimumLayerSeconds=0;
  plan.skills['wave-overhangs']={...settings,enabled:true,slices:[{id:'cantilever',reason:'Seed lies over the box top; grow a curved cantilever beyond its X edge.',
    surface:{degreeU:2,degreeV:2,controlPoints:Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>[i*5,j*2.5,1.2+[0,0,0.5][i]+[0,0,0.15][j]]))},
    domainUv:[rect(0.4,0,0.6,1)],seedUv:[rect(0.4,0,0.1,1)],afterParts:[null],beforeParts:[]}]};
  return plan;
}

test('shared composition orders the supporting body before waves and exports their 3D extrusion',async()=>{
  const machine=loadMachine(),plan=wavePlan(machine);
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino());checkMachinePath(path,plan,machine);
  let from=null;
  const moves=path.actions.filter(a=>a.kind==='move').map(a=>{const move={...a,from};from=a.to;return move;}).filter(a=>a.volumeMm3>0),first=moves.findIndex(m=>m.phase==='wave-overhangs');
  assert.ok(first>0);assert.ok(moves.slice(first).every(m=>m.phase==='wave-overhangs'));
  const bytes=exportProgram(path,plan,machine,{generatorVersion:'synthetic-test',buildDate:'2026-09-14'}),program=interpretProgram(bytes,plan,machine);
  assert.ok(program.moves.some(m=>m.phase==='wave-overhangs'));
  const wave=moves.filter(m=>m.phase==='wave-overhangs');
  const all=path.actions,begin=all.findIndex(a=>a.kind==='move'&&a.phase==='wave-overhangs'&&a.volumeMm3>0),end=all.findLastIndex(a=>a.kind==='move'&&a.phase==='wave-overhangs'&&a.volumeMm3>0);
  assert.ok(all.slice(begin,end+1).every(a=>a.kind==='move'&&a.volumeMm3>0),'A whole wave slice has no travel, retraction or cooling interruption.');
  const exported=program.moves.filter(m=>m.phase==='wave-overhangs'),firstExtrusion=exported.findIndex(m=>m.extruding),lastExtrusion=exported.findLastIndex(m=>m.extruding);
  const lines=String(bytes).split(/\r?\n/).slice(exported[firstExtrusion].line-1,exported[lastExtrusion].line);
  assert.ok(lines.every(line=>!/^G0\s/.test(line)&&!/^G4\s/.test(line)),'Export contains no internal rapid travel or cooling dwell.');
  assert.ok(exported.slice(firstExtrusion,lastExtrusion+1).every(m=>m.extruding||Math.hypot(...m.to.map((x,k)=>x-m.from[k]))<0.001),
    'Only sub-E-quantum movements may lack a rounded extrusion increment.');
  assert.ok(wave.some(m=>Math.abs(m.to[2]-m.from[2])>1e-4));
  // PathBuilder omits movements wholly inside one five-decimal XYZ cell.
  // The next segment's start can differ by at most that cell's diagonal.
  const beadArea=plan.process.lineWidthMm*settings.beadHeightMm;
  for(const m of wave){const expected=Math.hypot(...m.to.map((v,i)=>v-m.from[i]))*beadArea;
    assert.ok(Math.abs(m.volumeMm3-expected)<Math.sqrt(3)*1e-5*beadArea+1e-9,JSON.stringify({expected,move:m}));}
});

test('saddle fronts keep their boundary endpoints and connect as one surface pass',()=>{
  const patch=referencePatch({degreeU:1,degreeV:1,controlPoints:[[[0,0,0.7],[0,5,0.45]],[[10,0,1.3],[10,5,1.55]]]});
  const domain=[rect(0.4,0,0.6,1)],seed=[rect(0.4,0,0.1,1)],s={...settings,lineSpacingMm:0.3,propagationStepMm:0.3};
  const result=surfaceWaves(patch,domain,seed,s);
  assert.ok(result.waves.length>10);
  for(const wave of result.waves){
    assert.equal(wave.paths.length,1,'No arbitrary breaks in a front without obstacles.');
    const path=wave.paths[0];assert.equal(path.uv[0][1],0);assert.equal(path.uv.at(-1)[1],1);
    assert.ok(Math.abs(path.points[0][0]-path.points[1][0])<0.01,'No sideways perimeter tail at the front start.');
  }
  const connected=connectWavePasses(patch,result.waves,domain,s,0.4);
  assert.equal(connected.passes.length,1);
  assert.equal(connected.report.connectors.length,result.waves.length-1);
  for(const c of connected.report.connectors)assert.ok(c.lengthMm<=0.4+s.toleranceMm);
});

test('continuous slices reject separated hole branches instead of silently inserting travels',()=>{
  const machine=loadMachine(),plan=defaults(machine);
  plan.skills['wave-overhangs']={...settings,enabled:true,slices:[{id:'hole',reason:'Synthetic external anchor',
    surface:{degreeU:1,degreeV:1,controlPoints:[[[0,0,1],[0,5,1]],[[5,0,1],[5,5,1]]]},
    domainUv:[rect(0,0,1,1),rect(0.45,0.3,0.15,0.4).toReversed()],seedUv:[rect(0,0,0.25,1)],afterParts:[],beforeParts:[]}]};
  assert.throws(()=>waveResults({plan,machine,modelResults:[],placed:null,componentShells:null}),/continuous slice cannot contain branch restarts/);
});
