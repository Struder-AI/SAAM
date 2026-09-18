import test from 'node:test';
import assert from 'node:assert/strict';
import {bumpyPlan} from '../../skills/pipe-cladding/scripts/bumpy-demo.mjs';
import {developmentPipePlan} from '../../skills/pipe-cladding/scripts/demo.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell} from '../print/generate.mjs';
import {publishFinishedBoundary,consumeFinishedSurface} from '../path/finished-surface.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';

const r=await rhino();
// Operations contain fresh clearance closures. Compare their serialized motion,
// deposition, poses and dependencies rather than function object identities.
const data=value=>JSON.parse(JSON.stringify(value));
const splinePlan=()=>{
  const p=bumpyPlan();p.geometry.heightMm=8;
  for(const column of p.geometry.controlPoints)for(const point of column)point[2]/=4;
  Object.assign(p.skills['pipe-cladding'],{pattern:'crossed-helices',spacingFactor:8,shells:1});return p;
};

test('native spline cladding applies the continuum through finished-surface ownership and retains tight defaults',()=>{
  const plan=splinePlan(),shell=buildShell(r,plan.geometry),source=publishFinishedBoundary({operations:[{id:'printed-shell',strokes:[{}]}]},{shell});
  const finishedSurface=consumeFinishedSurface({shell,selection:plan.skills['pipe-cladding'].surface,results:[source]});
  const result=t=>{const p=structuredClone(plan);if(t===undefined)delete p.skills['pipe-cladding'].offsetTightness;else p.skills['pipe-cladding'].offsetTightness=t;return pipeCladdingResult({plan:p,shell,finishedSurface});};
  const tight=result(1),omitted=result(undefined),loose=result(0),middle=result(.37);
  assert.deepEqual(data(omitted.operations),data(tight.operations));
  assert.notDeepEqual(data(loose.operations),data(tight.operations));
  assert.notDeepEqual(data(middle.operations),data(tight.operations));
  assert.notDeepEqual(data(middle.operations),data(loose.operations));
  for(const [value,output] of [[0,loose],[.37,middle],[1,tight]]){
    assert.equal(output.report.offsetTightness,value);
    assert.deepEqual(output.operations[0].after,['printed-shell']);
    assert.ok(output.operations.every(op=>op.strokes.every(s=>s.points.every(p=>p.every(Number.isFinite))&&s.volumesMm3.every(v=>Number.isFinite(v)&&v>=0))));
  }
  source.finishedSurfaces[0].contains=()=>false;
  const missing=consumeFinishedSurface({shell,selection:plan.skills['pipe-cladding'].surface,results:[source]});
  plan.skills['pipe-cladding'].offsetTightness=0;
  assert.throws(()=>pipeCladdingResult({plan,shell,finishedSurface:missing}),/not produced/);
});

test('mesh-strip and circular-pipe cladding retain their existing normal offsets for every tightness setting',()=>{
  const plan=developmentPipePlan();plan.geometry.heightMm=2;Object.assign(plan.skills['pipe-cladding'],{shells:1,pattern:'crossed-helices',spacingFactor:8});
  const circle=t=>{const p=structuredClone(plan);p.skills['pipe-cladding'].offsetTightness=t;return pipeCladdingResult({plan:p});};
  assert.deepEqual(data(circle(0).operations),data(circle(1).operations));
  const mesh=pipeMesh({innerRadiusMm:8,outerRadiusMm:10,heightMm:2,toleranceMm:.05}),n=mesh.vertices.length/4;
  plan.skills['pipe-cladding'].surface={kind:'mesh-strip',rows:Array.from({length:n+1},(_,i)=>[i%n,2*n+i%n]),periodicU:true,normalSide:1};
  const stripe=t=>{const p=structuredClone(plan);p.skills['pipe-cladding'].offsetTightness=t;return pipeCladdingResult({plan:p,shell:mesh});};
  const tight=stripe(1);for(const t of [0,.37]){const other=stripe(t);assert.deepEqual(data(other.operations),data(tight.operations));assert.equal(other.report.offsetTightness,1);}
});
