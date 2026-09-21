import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SPACING_SKILLS,lineSpacing} from '../path/spacing.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell,generatePath} from '../print/generate.mjs';
import {fullFillResult} from '../../skills/full-fill/scripts/fill.mjs';
import {planarInfillResults} from '../../skills/planar-infill/scripts/infill.mjs';
import {infillStrokes,INFILL_PATTERNS} from '../../skills/planar-infill/scripts/patterns.mjs';
import {drapedSkinResult,surveySurface} from '../../skills/draped-skin/scripts/drape.mjs';
import {supportResults} from '../../skills/supports/scripts/supports.mjs';
import {rimmingResults} from '../../skills/rimming-planar/scripts/rimming.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {developmentPipePlan} from '../../skills/pipe-cladding/scripts/demo.mjs';
import {bumpyPlan} from '../../skills/pipe-cladding/scripts/bumpy-demo.mjs';
import {pointInRegion} from '../region/region2d.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {initBundle,loadBundle,adjustBundle,approve,generateBundle,deliver} from '../print/bundle.mjs';
import {recipeRows} from '../../studio/settings.mjs';

const r=await rhino(),machine=loadMachine('ultimaker-s5');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const length=points=>points.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-points[i][k])),0);
const strokes=result=>result.operations.flatMap(op=>op.strokes);
const volume=result=>strokes(result).reduce((n,s)=>n+(s.volumesMm3?s.volumesMm3.reduce((a,b)=>a+b,0):length(s.closed?[...s.points,s.points[0]]:s.points)*s.beadAreaMm2),0);
function boxPlan(){const p=defaults(machine);p.geometry={shape:'box',runMm:12,widthMm:10,heightMm:2};p.process.minimumLayerSeconds=0;p.skills['draped-skin'].enabled=false;return p;}

test('spacing is a required setting and validates one independent value, including regions',()=>{
  for(const name of SPACING_SKILLS){const missing=boxPlan();delete missing.skills[name].spacingFactor;
    assert.throws(()=>validatePlan(missing,machine),/Unexpected or missing fields/);}
  near(lineSpacing(.4,{spacingFactor:3}),1.2);
  near(lineSpacing(2,{spacingFactor:.75}),1.5);
  for(const value of [0,.49,-1,null,'3',NaN,Infinity]){
    const bad=boxPlan();bad.skills['full-fill'].spacingFactor=value;
    assert.throws(()=>validatePlan(bad,machine),/spacingFactor/);
  }
  const regional=boxPlan();regional.composition.regions=[{id:'body',part:null,zStartMm:0,zEndMm:null,lowerSurfaceFrom:null,skills:{'full-fill':{spacingFactor:0}}}];
  assert.throws(()=>validatePlan(regional,machine),/spacingFactor/);
  const unsupported=boxPlan();unsupported.skills['vase-wall'].spacingFactor=2;
  assert.throws(()=>validatePlan(unsupported,machine),/fields/);
});

test('full fill widens rows and inward wall spacing without increasing bead area or inventing wall coverage',()=>{
  const p=boxPlan(),shell=buildShell(r,p.geometry),normal=fullFillResult({shell,plan:p,machine});
  p.skills['full-fill'].spacingFactor=3;
  const open=fullFillResult({shell,plan:p,machine});
  assert.ok(open.report.fillRows<normal.report.fillRows);
  for(const s of strokes(open))near(s.beadAreaMm2,.08);
  const walls=open.operations.find(op=>op.id.endsWith(':walls'));
  near(Math.min(...walls.strokes[0].points.map(p=>p[0])),.2);
  near(Math.min(...walls.strokes[1].points.map(p=>p[0])),1.4);
  assert.ok(pointInRegion([.2,5],walls.materialRegion));
  assert.ok(!pointInRegion([.8,5],walls.materialRegion),'gap between walls is not published as deposited material');
  assert.equal(open.operations.find(op=>op.id.endsWith(':fill')).materialCoverage,'sparse');
  assert.ok(volume(open)<volume(normal));
});

test('all five infill families change their pattern scale through the shared spacing rule',()=>{
  const region=[[[0,0],[40,0],[40,40],[0,40]]];
  for(const pattern of INFILL_PATTERNS){
    const options={pattern,widthMm:.4,density:.3,zMm:.4};
    const dense=infillStrokes(region,options),open=infillStrokes(region,{...options,spacingFactor:3});
    const sum=xs=>xs.reduce((n,s)=>n+length(s.closed?[...s.points,s.points[0]]:s.points),0);
    assert.ok(sum(open)<sum(dense)*.8,pattern+' retains wider spacing');
  }
});

test('sparse infill spacing leaves independently selected solid masks at their own spacing',()=>{
  const p=boxPlan();p.skills['planar-infill'].enabled=true;p.skills['planar-infill'].perimeters=1;
  Object.assign(p.skills['full-fill'],{mode:'solid-surfaces',topLayers:1,bottomLayers:1});
  const shell=buildShell(r,p.geometry),a=planarInfillResults({shell,plan:p,machine,solid:true});
  p.skills['planar-infill'].spacingFactor=3;
  const b=planarInfillResults({shell,plan:p,machine,solid:true});
  assert.deepEqual(strokes(a[1]),strokes(b[1]));
  assert.ok(volume(b[0])<volume(a[0]));
  p.skills['full-fill'].spacingFactor=2;
  const c=planarInfillResults({shell,plan:p,machine,solid:true});
  assert.ok(volume(c[1])<volume(b[1]));
});

test('draped rows leave gaps while segment extrusion retains actual bead width',()=>{
  const p=boxPlan(),shell=buildShell(r,p.geometry);p.skills['draped-skin'].enabled=true;
  const run=()=>drapedSkinResult({shell,plan:p,machine,survey:surveySurface(shell,p.skills['draped-skin'],15)});
  const dense=run();p.skills['draped-skin'].spacingFactor=3;const open=run();
  assert.ok(open.report.strokes<dense.report.strokes);
  for(const s of open.operations.at(-1).strokes)for(let i=1;i<s.points.length;i++)near(s.volumesMm3[i-1]/length([s.points[i-1],s.points[i]]),.08);
  const stack=regionalStackPlan(machine,'spline');stack.composition.regions.find(region=>region.id==='roof-finish').skills['draped-skin'].spacingFactor=3;
  assert.throws(()=>generatePath(stack,machine,r),/Lower surface does not cover/,'a spaced roof cannot publish its gaps as continuous support');
});

test('support body and interfaces retain bead size when their rows spread apart',()=>{
  const p=boxPlan();Object.assign(p.skills.supports,{enabled:true,perimeters:0,assignments:[{id:'ledge',style:'standard',reason:'Synthetic spacing test',contactZMm:2,footprint:[[[20,0],[30,0],[30,10],[20,10]]],treeNodes:[]}]});
  const run=()=>supportResults({plan:p,machine,shells:[buildShell(r,p.geometry)],modelResults:[]}).results;
  const a=run();p.skills.supports.spacingFactor=3;const b=run();
  assert.ok(b.reduce((n,x)=>n+volume(x),0)<a.reduce((n,x)=>n+volume(x),0));
  for(const result of b)for(const s of strokes(result))near(s.beadAreaMm2,.08);
});

test('both rimming modes keep the contacting bead fixed and widen only the paired-track separation',()=>{
  for(const [skillId,mode] of [['rimming-planar','horizontal'],['rimming-normal','normal']]){
    const p=boxPlan();Object.assign(p.skills[skillId],{enabled:true,surfaces:[{id:'edge',reason:'Synthetic spacing test',baseEdge:'bed',supportedEdge:'test edge',basePart:null,supportedPart:null,outwardSide:1,degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,0,1]],[[8,0,0],[8,0,1]]]}]});
    const run=()=>rimmingResults({plan:p,modelResults:[],skillId,mode}).results[0];
    const a=run();p.skills[skillId].spacingFactor=3;const b=run();
    assert.deepEqual(a.operations[0].strokes[0],b.operations[0].strokes[0]);
    const pair=b.operations[0].strokes;near(Math.abs(pair[0].points[0][1]-pair[1].points[0][1]),1.2);
    near(volume(a),volume(b));
  }
});

test('circular cladding widens axial courses and hoop pitch while preserving bead area and substrate',()=>{
  const p=developmentPipePlan();p.skills['pipe-cladding'].shells=2;
  const run=()=>pipeCladdingResult({plan:p});
  const a=run(),substrate=JSON.stringify(p.skills['full-fill']);p.skills['pipe-cladding'].spacingFactor=3;const b=run();
  assert.ok(b.operations[0].strokes.length<a.operations[0].strokes.length/2);
  for(const s of b.operations[0].strokes)assert.ok(s.beadAreaMm2<=.08+1e-8&&s.beadAreaMm2>.07);
  const hoop=b.operations[1].strokes[0];
  for(let i=1;i<hoop.points.length;i++)assert.ok(hoop.volumesMm3[i-1]/length([hoop.points[i-1],hoop.points[i]])<=.08+1e-7);
  const turns=s=>(s.poses.at(-1).rotaryDeg-s.poses[0].rotaryDeg)/360;
  near(turns(a.operations[1].strokes[0])/turns(hoop),3);
  assert.equal(JSON.stringify(p.skills['full-fill']),substrate);
  assert.ok(volume(b)<volume(a)/2);
});

test('circular substrate spacing reaches both fitted loops and concentric fill through shared generation',()=>{
  const robot=loadMachine('denso-vp6242-rc8');
  for(const perimeters of [0,1]){
    const p=developmentPipePlan();p.geometry.heightMm=1.2;p.geometry.outerRadiusMm=16;
    p.skills['pipe-cladding'].shells=2;p.skills['full-fill'].perimeters=perimeters;
    const a=generatePath(p,robot,r);p.skills['full-fill'].spacingFactor=3;
    const b=generatePath(p,robot,r);
    assert.ok(b.summary.fullFill.fillRows<a.summary.fullFill.fillRows*.6);
    assert.deepEqual(b.summary.pipeCladding,a.summary.pipeCladding);
  }
});

test('native curved-surface cladding spaces metric cells without multiplying emitted bead width',()=>{
  const p=bumpyPlan();p.geometry.heightMm=4;for(const column of p.geometry.controlPoints)for(const point of column)point[2]/=8;
  p.skills['pipe-cladding'].shells=2;p.skills['pipe-cladding'].sampleStepMm=1;
  const shell=buildShell(r,p.geometry),a=pipeCladdingResult({plan:p,shell});
  p.skills['pipe-cladding'].spacingFactor=3;const b=pipeCladdingResult({plan:p,shell});
  assert.ok(b.report.axialPasses<a.report.axialPasses);
  // Native metric fitting already varies local hoop widths; wider course cells
  // must not multiply those widths along with the pitch.
  assert.ok(b.report.maxBeadWidthMm<=a.report.maxBeadWidthMm+1e-7);
  assert.ok(volume(b)<volume(a)*.65);
});

test('explicit mesh-strip cladding shares independent course spacing and valid segment volumes',()=>{
  const shell=pipeMesh({innerRadiusMm:8,outerRadiusMm:10,heightMm:4,toleranceMm:.02}),n=shell.vertices.length/4;
  const p=developmentPipePlan();p.skills['pipe-cladding'].shells=2;
  p.skills['pipe-cladding'].surface={kind:'mesh-strip',rows:Array.from({length:n+1},(_,i)=>[i%n,2*n+i%n]),periodicU:true,normalSide:1};
  const a=pipeCladdingResult({plan:p,shell});p.skills['pipe-cladding'].spacingFactor=3;
  const b=pipeCladdingResult({plan:p,shell});
  assert.ok(b.report.axialPasses<a.report.axialPasses);
  assert.ok(volume(b)<volume(a)*.65);
  for(const s of strokes(b)){
    assert.equal(s.volumesMm3.length,s.points.length-1);
    assert.ok(s.volumesMm3.every(v=>Number.isFinite(v)&&v>=0));
  }
});

test('spacing is reviewable, invalidates only the process, and survives checked exact-byte delivery',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-synthetic-spacing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=boxPlan();p.geometry.heightMm=.6;
  await initBundle(dir,p);let state=await loadBundle(dir);
  state=await adjustBundle(dir,{skills:{'full-fill':{spacingFactor:3}}},{expectedRevision:state.revision});
  assert.equal(state.toolpathApproved,false);
  assert.ok(recipeRows(state.plan,state.machine).some(([key,v])=>key.includes('Line spacing')&&v.startsWith('3')));
  assert.ok(!recipeRows(p,machine).some(([key])=>key.includes('Line spacing')),'normal recipes need no extra review row');
  await generateBundle(dir);state=await loadBundle(dir);assert.ok(!state.programError);
  await approve(dir,{revision:state.revision,actor:'SYNTHETIC SPACING TEST ONLY'});
  state=await loadBundle(dir);assert.deepEqual(await readFile(await deliver(dir)),await readFile(join(dir,state.review.generation.file)));
});
