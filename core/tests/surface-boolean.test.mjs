import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryOperations} from '../geom/operations.mjs';
import {splineBox,splineBlock} from './fixtures/spline-shapes.mjs';
import {compileHeatSet} from '../../skills/heat-set-inserts/scripts/geometry.mjs';
import {plasticWeldSource,PLASTIC_WELD_DEFAULTS} from '../../skills/plastic-weld/scripts/runtime.mjs';
import {defaults} from '../print/plan.mjs';
import {assignmentFilament} from '../print/assignment-process.mjs';
import {injectionAssignment} from '../print/injection.mjs';
import {sliceAssignment} from '../print/slice-records.mjs';
import {generatePath} from '../print/generate.mjs';
import {referencePatch} from '../geom/reference-surface.mjs';
import {solidKernel,solidFromMesh} from '../geom/solid.mjs';
import {BOOLEAN_TOLERANCE_MM} from '../dimensions.mjs';
import {createGeometry} from '../print/geometry.mjs';
import {intersectGeometry} from '../print/geometry-tools.mjs';

const G=geometryOperations(),base=splineBox({runMm:16,widthMm:16,heightMm:8});
const reference={name:'reference',degreeU:2,degreeV:2,controlPoints:[
  [[0,0,0],[0,8,.3],[0,16,0]],[[8,0,.3],[8,8,.6],[8,16,.3]],[[16,0,0],[16,8,.3],[16,16,0]]
]};
const placements=[
  {angle:0,positionMm:[8,8,8],axis:[0,0,-1]},
  {angle:35,positionMm:[8,8,8],axis:[-Math.sin(35*Math.PI/180),0,-Math.cos(35*Math.PI/180)]},
  {angle:90,positionMm:[16,8,5],axis:[-1,0,0]},
  {angle:"compound",positionMm:[8,8,8],axis:[-.4,-.3,-Math.sqrt(.75)]}
];
const feature=placement=>({id:'seat',insertId:'spirol-19-m2-short',positionMm:placement.positionMm,axis:placement.axis});
const weldPlan=placement=>{
  const plan=defaults();plan.geometry=base;
  plan.skills['plastic-weld']={...structuredClone(PLASTIC_WELD_DEFAULTS),enabled:true,
    sites:[{id:'anchor',part:null,positionMm:placement.positionMm,axis:placement.axis,depthMm:5}]};
  return plan;
};

// The periodic seam, almost collapsed UV fragments and opposing retraces in
// these tilted/coplanar circles exposed distinct sewing defects during development.
test('heat-set and weld boundaries retain seams across four section variants',async()=>{
  const host=await G.buildGeometry(base);
  const curved=structuredClone(reference);
  for(const row of curved.controlPoints)for(const p of row)p[2]+=6;
  const slices=[G.horizontalSlice(6.7),G.planeSlice({origin:[8.23,7.91,6.17],normal:[.23,.13,1]}),
    G.planeSlice({origin:[8,8,4],normal:[0,1,0]}),G.patchSlice(referencePatch(curved))];
  for(const placement of placements){
    const heatset=await compileHeatSet(base,[feature(placement)],G),heat=await G.buildGeometry(heatset.geometry);
    assert.ok(!Object.hasOwn(heatset.geometry,'vertices'));
    const plan=weldPlan(placement),runtime=plasticWeldSource({Geometry:G,Recipe:{assignmentFilament,injectionAssignment},extensionId:'plastic-weld',settings:plan.skills['plastic-weld']}),prepared=await runtime.prepare({plan,placed:host,componentShells:null,processForAssignment:()=>plan.process});
    assert.equal(prepared.contributions.length,1,prepared.notes.join('; '));
    const site=prepared.contributions[0],cavity=site.geometryCuts[0].geometry,weld=G.combineSolids('difference',[host,cavity]);
    assert.deepEqual(site.assignments[0].points[0].direction,placement.axis);
    for(const [body,operands] of [[heat,[host,...await Promise.all(heatset.geometry.solid.operands.slice(1).map(G.buildGeometry))]],[weld,[host,cavity]]]){
      assert.equal(body.kind,'surface-solid');assert.deepEqual(body.topology.unmatched,[]);
      assert.equal(body.construction.toleranceMm,BOOLEAN_TOLERANCE_MM);
      // Independent section composition does not use the constructed face trims.
      const layerBoolean={kind:'boolean',operation:'difference',operands,bounds:host.bounds,empty:false};
      for(const slice of slices){
        const actual=G.section(body,slice),expected=G.section(layerBoolean,slice);
        assert.deepEqual(actual.open,[]);
        const change=G.regionArea(G.difference(actual.loops,expected.loops))+G.regionArea(G.difference(expected.loops,actual.loops));
        const allowance=slice.kind==='patch'?.0005:.05;
        assert.ok(change<allowance,`${placement.angle} degree ${slice.kind} symmetric difference ${change}`);
      }
    }
  }
});

test('a cone-to-cylinder crease keeps its crossing and yields a closed chamfer mesh',async()=>{
  const compiled=await compileHeatSet(base,[{...feature(placements[0]),chamferDepthMm:.5}],G);
  assert.deepEqual(compiled.notes,[]);
  const body=await G.buildGeometry(compiled.geometry),kernel=await solidKernel(),operands=[];
  for(const operand of compiled.geometry.solid.operands)operands.push(await G.buildGeometry(operand));
  const [mesh]=await G.constructSolids([{operation:'difference',operands}]);
  assert.ok(mesh.notes.every(note=>typeof note==='string'));
  const solid=solidFromMesh(kernel,mesh);
  try{assert.equal(solid.status(),'NoError');assert.ok(solid.volume()>0);}finally{solid.delete();}
  const curved=splineBlock({runMm:16,widthMm:16,heightsMm:[[8,8,8,8],[8,10,10,8],[8,10,10,8],[8,8,8,8]]});
  const result=await compileHeatSet(curved,[feature(placements[1])],G);
  assert.deepEqual((await G.buildGeometry(result.geometry)).topology.unmatched,[]);
});

test('both features generate toolpaths with horizontal, tilted and curved stacks',async()=>{
  const placement=placements[1],heatset=await compileHeatSet(base,[feature(placement)],G);
  const variants=[{kind:'horizontal'},{kind:'plane',origin:[0,0,0],normal:[.08,.04,1]},
    {kind:'spline',patch:reference,offsetMm:0}];
  for(const kind of ['heat-set','plastic-weld'])for(const surface of variants){
    const plan=kind==='plastic-weld'?weldPlan(placement):defaults();
    plan.geometry=kind==='heat-set'?heatset.geometry:base;plan.process.primeLine=null;
    plan.process.layerMm=2;plan.process.firstLayerMm=2;
    plan.slices.assignments=[sliceAssignment({id:'body',surface,loops:1,fillDensity:.15,solidTop:0,solidBottom:0})];
    const path=await generatePath(plan),limitations=[path.summary.limitations??[]].flat().join('; ');
    assert.ok(path.operations.some(op=>op.construction==='body'),limitations);
    assert.ok(!/produced nothing|failed|did not close/.test(limitations),limitations);
    const inject=path.operations.filter(op=>op.construction==='plastic-weld:anchor');
    assert.equal(inject.length,kind==='plastic-weld'?1:0);
    for(const op of inject){assert.ok(op.requiredMaterial.length>0);assert.ok(op.strokes.some(stroke=>stroke.stationaryExtrusion));}
  }
});

test('coincident caps and face/edge/point contacts keep regularized solid topology',async()=>{
  const kernel=await solidKernel(),box=await G.buildGeometry(splineBox({runMm:5,widthMm:5,heightMm:5}));
  for(const offset of [[5,0,0],[5,5,0],[5,5,5],[5,2,1]])for(const operation of ['union','difference','intersection']){
    const body=G.combineSolids(operation,[box,G.translateShell(box,...offset)]);
    assert.deepEqual(body.topology.unmatched,[]);
    const [mesh]=await G.constructSolids([body]);
    if(operation==='intersection'){assert.equal(mesh,null);continue;}
    const solid=solidFromMesh(kernel,mesh);
    try{assert.ok(Math.abs(solid.volume()-(operation==='union'?250:125))<1e-5);}finally{solid.delete();}
  }
  const cylinders=[];
  for(const radius of [2,1])cylinders.push(await G.buildGeometry(G.revolvedProfile({positionMm:[0,0,0],axis:[0,0,1],profile:[[0,radius],[5,radius]]})));
  for(const [operation,faces] of [['union',3],['difference',4],['intersection',3]]){
    const body=G.combineSolids(operation,cylinders);assert.equal(body.patches.length,faces);assert.deepEqual(body.topology.unmatched,[]);
  }
  const reversed=structuredClone(base);for(const patch of reversed.patches)patch.controlPoints.reverse();
  const source=await G.buildGeometry(base),opposite=await G.buildGeometry(reversed);
  assert.ok(G.combineSolids('difference',[source,opposite]).empty);
  assert.equal(G.combineSolids('union',[source,opposite]).patches.length,6);
});
test('curved coincidence survives basis refinement, elevation and periodic partial overlap',async()=>{
  const recipe=splineBlock({runMm:16,widthMm:16,heightsMm:[[8,8,8,8],[8,10,10,8],[8,10,10,8],[8,8,8,8]]});
  const split=points=>{
    const state={row:points},left=[],right=[];
    while(state.row.length){
      left.push(state.row[0]);right.unshift(state.row.at(-1));
      state.row=state.row.slice(1).map((point,i)=>point.map((value,k)=>state.row[i][k]+.37*(value-state.row[i][k])));
    }
    return [...left,...right.slice(1)];
  };
  const elevated=structuredClone(recipe),refined=structuredClone(recipe);
  const elevate=points=>[points[0],...points.slice(1).map((point,i)=>point.map((value,k)=>
    (i+1)/points.length*points[i][k]+(1-(i+1)/points.length)*value)),points.at(-1)];
  for(const patch of elevated.patches){
    const columns=patch.controlPoints[0].map((_,j)=>elevate(patch.controlPoints.map(row=>row[j])));
    patch.controlPoints=columns[0].map((_,i)=>elevate(columns.map(column=>column[i])));
    patch.degreeU++;patch.degreeV++;
  }
  for(const patch of refined.patches){
    const columns=patch.controlPoints[0].map((_,j)=>split(patch.controlPoints.map(row=>row[j])));
    patch.controlPoints=columns[0].map((_,i)=>columns.map(column=>column[i]));
    patch.knotsU=[...Array(patch.degreeU+1).fill(0),...Array(patch.degreeU).fill(.37),...Array(patch.degreeU+1).fill(1)];
  }
  const original=await G.buildGeometry(recipe);
  for(const equivalent of [elevated,refined]){
    const other=await G.buildGeometry(equivalent);
    assert.ok(G.combineSolids('difference',[original,other]).empty);
    for(const operation of ['union','intersection']){
      const body=G.combineSolids(operation,[other,original]);
      assert.equal(body.patches.length,6);assert.deepEqual(body.topology.unmatched,[]);
    }
  }
  const kernel=await solidKernel();
  for(const phase of [0,Math.PI/2]){
    const cylinders=[];
    for(const [z,rotation] of [[0,0],[2,phase]]){
      const geometry=G.revolvedProfile({positionMm:[0,0,z],axis:[0,0,1],profile:[[0,2],[5,2]]});
      for(const patch of geometry.patches)for(const row of patch.controlPoints)for(const p of row){
        const [x,y]=p;p[0]=x*Math.cos(rotation)-y*Math.sin(rotation);p[1]=x*Math.sin(rotation)+y*Math.cos(rotation);
      }
      cylinders.push(await G.buildGeometry(geometry));
    }
    for(const [operation,height] of [['union',7],['difference',2],['intersection',3]]){
      const body=G.combineSolids(operation,cylinders);
      assert.deepEqual(body.topology.unmatched,[]);
      const [mesh]=await G.constructSolids([body],{toleranceMm:BOOLEAN_TOLERANCE_MM}),solid=solidFromMesh(kernel,mesh);
      try{assert.equal(solid.status(),'NoError');assert.ok(Math.abs(solid.volume()-Math.PI*4*height)<.08);}
      finally{solid.delete();}
    }
  }
});

test('support planes preserve rotated tangencies without inventing material intersection',async()=>{
  const cylinder=await G.buildGeometry(G.revolvedProfile({positionMm:[0,0,0],axis:[0,0,1],profile:[[0,2],[5,2]]}));
  const box=await G.buildGeometry(splineBox({runMm:4,widthMm:4,heightMm:5})),kernel=await solidKernel();
  const contacts=[... [0,Math.PI/4,.37].map(angle=>({solid:G.translateShell(cylinder,4*Math.cos(angle),4*Math.sin(angle),0),volume:20*Math.PI})),
    {solid:G.translateShell(box,2,-2,0),volume:80}];
  for(const contact of contacts)for(const operation of ['union','difference','intersection']){
    const body=G.combineSolids(operation,[cylinder,contact.solid]);assert.deepEqual(body.topology.unmatched,[]);
    assert.ok(body.construction.separationPlanes.length>0);
    if(operation==='intersection'){assert.ok(body.empty);continue;}
    const [mesh]=await G.constructSolids([body],{toleranceMm:BOOLEAN_TOLERANCE_MM}),solid=solidFromMesh(kernel,mesh);
    try{assert.equal(solid.status(),'NoError');assert.ok(Math.abs(solid.volume()-(20*Math.PI+(operation==='union'?contact.volume:0)))<.2);}
    finally{solid.delete();}
  }
});

test('near tangency retains a penetrating lens instead of treating it as contact',async()=>{
  const cylinder=await G.buildGeometry(G.revolvedProfile({positionMm:[0,0,0],axis:[0,0,1],profile:[[0,2],[5,2]]}));
  const expected=8*Math.acos(3.99/4)-3.99/2*Math.sqrt(16-3.99**2),kernel=await solidKernel();
  for(const angle of [Math.PI/4,.37]){
    const other=G.translateShell(cylinder,3.99*Math.cos(angle),3.99*Math.sin(angle),0);
    for(const operation of ['union','difference','intersection']){
      const body=G.combineSolids(operation,[cylinder,other]);
      assert.deepEqual(body.topology.unmatched,[]);assert.equal(body.construction.separationPlanes.length,0);
      assert.ok(!body.empty);
      if(operation!=='intersection')continue;
      const cut=G.section(body,G.horizontalSlice(2.5),{chordMm:.00001});
      assert.deepEqual(cut.open,[]);assert.ok(Math.abs(G.regionArea(cut.loops)-expected)<.00025);
      const [mesh]=await G.constructSolids([body],{toleranceMm:BOOLEAN_TOLERANCE_MM}),solid=solidFromMesh(kernel,mesh);
      try{assert.equal(solid.status(),'NoError');assert.ok(solid.volume()>0);}finally{solid.delete();}
    }
  }
});


test('automatic recovery warnings reach queries, selected previews and empty results',async()=>{
  const first=G.revolvedProfile({positionMm:[0,0,0],axis:[0,0,1],profile:[[0,2],[5,2]]}),second=structuredClone(first);
  for(const patch of second.patches)for(const row of patch.controlPoints)for(const point of row){
    const [x,y]=point;point[0]=x*Math.cos(.37)-y*Math.sin(.37);point[1]=x*Math.sin(.37)+y*Math.cos(.37);
  }
  const geometry={shape:'boolean',operation:'union',operands:[first,second],displayOperand:0},authored=structuredClone(geometry);
  const body=await G.buildGeometry(geometry),findings=await intersectGeometry(geometry,{sectionsAtZ:[2.5]}),preview=await createGeometry(geometry);
  const warns=notes=>notes?.some(note=>note.includes('automatically recovered'));
  assert.equal(body.construction.recoveries[0].method,'fuzzy');
  assert.equal(body.construction.recoveries[0].fuzzyMm,BOOLEAN_TOLERANCE_MM/4);
  assert.ok(warns(findings.notes));assert.ok(warns(preview.descriptor.notes));
  assert.deepEqual(geometry,authored,'Recovery must not mutate authored operands.');
  const box=splineBox({runMm:5,widthMm:5,heightMm:5}),shifted=structuredClone(box);
  for(const patch of shifted.patches)for(const row of patch.controlPoints)for(const point of row)point[0]+=4.999;
  const thin={shape:'boolean',operation:'intersection',operands:[box,shifted]},empty=await createGeometry(thin);
  assert.equal(empty.descriptor.faces.length,0);assert.ok(warns(empty.descriptor.notes));
  assert.ok(warns((await intersectGeometry(thin,{sectionsAtZ:[2.5]})).notes));
});
