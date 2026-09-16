import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContourFamily} from '../geom/prepared-contours.mjs';
import {contourPath} from '../geom/contour-path.mjs';
import {makeMesh,sectionMesh,createMeshSectionQuery} from '../geom/mesh.mjs';
import {createSectionQuery} from '../geom/query.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {boxMesh,ringMesh,subdividedBox} from './fixtures/mesh.mjs';
import {boxShell,splineSideShell} from '../geom/shapes.mjs';
import {rhino} from '../print/geometry.mjs';

const error=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const circle=(z,o)=>contourPath(Array.from({length:64},(_,i)=>{
  const t=i*Math.PI/32,r=10+.2*Math.sin(z)+o;
  return [z*.1+r*Math.cos(t),r*Math.sin(t)];
}),[100,0]);

test('prepared height/depth mapping reuses expensive curves and keeps independent samples within its allowance',()=>{
  let calls=0;
  const curveAt=(z,o)=>{calls++;return circle(z,o);};
  const prepared=prepareContourFamily({curveAt,startMm:0,endMm:2,stepMm:.4,toleranceMm:.0025});
  let worst=0;
  for(let i=0;i<2000;i++){
    const z=2*(i+.37)/2000,o=-1+(i*677%2000)/1000,u=(i*997%2000)/2000;
    worst=Math.max(worst,error(prepared.at(u,z,o),circle(z,o).at(u)));
  }
  assert.ok(worst<=.0025,`maximum independently sampled deviation ${worst}`);
  assert.ok(calls<2000,`prepared ${calls} source curves for 2000 distinct mapping positions`);
  assert.ok(prepared.report.preparedCells>0);
  assert.ok(prepared.report.maxCachedCurves<=2048);
});

test('prepared curve queries expose the same mapping and complete perimeter breakpoints',()=>{
  const prepared=prepareContourFamily({curveAt:circle,startMm:0,endMm:2,stepMm:.4,toleranceMm:.0025});
  const curve=prepared.curveAt(.217,-.123),nodes=curve.breakpoints();
  assert.equal(nodes[0].u,0);assert.equal(nodes.at(-1).u,1);
  for(let i=1;i<nodes.length;i++){
    const a=nodes[i-1],b=nodes[i],u=a.u+(b.u-a.u)*.371;
    assert.deepEqual(curve.at(u),prepared.at(u,.217,-.123));
    const expected=a.p.map((v,k)=>v+(b.p[k]-v)*.371);
    assert.ok(error(curve.at(u),expected)<1e-12,'union grid describes the entire piecewise linear contour');
  }
});

test('prepared mapping retains concave contour correspondence, negative phase and local refinement',()=>{
  const curveAt=(z,o)=>contourPath([[0,0],[10+z+o,0],[10+z+o,10],[6,10],[6,4],[4,4],[4,10],[0,10]],[100,0]);
  const prepared=prepareContourFamily({curveAt,startMm:0,endMm:1,stepMm:.4,toleranceMm:.0025});
  let worst=0;
  for(let i=0;i<151;i++){
    const z=(i+.29)/152,o=(i*37%151)/151*.7,u=-.1+(i*97%151)/151*1.3;
    worst=Math.max(worst,error(prepared.at(u,z,o),curveAt(z,o).at(u)));
  }
  assert.ok(worst<=.0025,`concave maximum independently sampled deviation ${worst}`);
  assert.ok(prepared.report.preparedCells>3,'changing corners require refinement');
});

test('twisting eccentric contours preserve the projected seam across refinement boundaries',()=>{
  const curveAt=(z,o)=>{
    const angle=.7*z,co=Math.cos(angle),si=Math.sin(angle);
    const loop=Array.from({length:64},(_,i)=>{
      const t=i*Math.PI/32,x=10*Math.cos(t),y=4*Math.sin(t);
      return [co*x-si*y,si*x+co*y];
    });
    return contourPath(offsetRegion([loop],o,{precisionMm:.00001,arcToleranceMm:.005})[0],[100,0]);
  };
  const prepared=prepareContourFamily({curveAt,startMm:0,endMm:3,stepMm:.4,toleranceMm:.0025});
  let worst=0;
  for(let i=0;i<317;i++){
    const z=3*(i+.419)/317,o=-.8*((i*137%317)+.719)/317,u=((i*223%317)+.331)/317;
    worst=Math.max(worst,error(prepared.at(u,z,o),curveAt(z,o).at(u)));
  }
  assert.ok(worst<=.0025,`twisting oval maximum independently sampled deviation ${worst}`);
  for(const z of [.4-1e-8,.4,.4+1e-8])assert.ok(error(prepared.at(.9999,z,-.173),curveAt(z,-.173).at(.9999))<=.0025);
});

test('off-path contour collapse refines locally, actual invalid queries preserve failure, and unresolved jumps use exact mapping',()=>{
  const curveAt=(z,o)=>{
    if(o>.13)throw new Error('offset contour collapsed');
    const shift=z>=.3271?3:0;
    return contourPath([[shift,0],[10+shift+o,0],[10+shift+o,10],[shift,10]],[100,0]);
  };
  const prepared=prepareContourFamily({curveAt,startMm:0,endMm:1,stepMm:.4,toleranceMm:.0025});
  assert.ok(error(prepared.at(.2,.3271,.129),curveAt(.3271,.129).at(.2))<=.0025);
  assert.throws(()=>prepared.at(.2,.4,.14),/offset contour collapsed/);
  assert.deepEqual(prepared.at(.2,.3271,0),curveAt(.3271,0).at(.2));
  assert.ok(prepared.report.directFallbacks>0);
});

test('mesh connectivity preparation is byte-identical across vertex levels, boundaries, holes and revisited bands',()=>{
  for(const source of [boxMesh(12,10,2,1),ringMesh(),subdividedBox(2)]){
    const mesh=makeMesh(source.vertices,source.triangles),query=createMeshSectionQuery(mesh);
    const heights=[mesh.bounds.min[2],mesh.bounds.max[2],...mesh.vertices.map(p=>p[2]),...Array.from({length:41},(_,i)=>mesh.bounds.min[2]+(mesh.bounds.max[2]-mesh.bounds.min[2])*(i+.31)/42)];
    for(const z of [...heights,...heights.toReversed()])assert.deepEqual(query(z),sectionMesh(mesh,z));
  }
});

test('prepared source accepts mesh and spline section queries without backend branching',async()=>{
  const runtime=await rhino(),mesh=boxMesh(12,10,3);
  const geometries=[makeMesh(mesh.vertices,mesh.triangles),boxShell(runtime,{xMm:12,yMm:10,zMm:3}),
    splineSideShell(runtime,{runMm:12,widthMm:10,longSideInsetMm:.3,shortSideOutsetMm:.2,heights:()=>3})];
  for(const geometry of geometries){
    const section=createSectionQuery(geometry),curveAt=(z,o)=>{
      const loops=offsetRegion(section(z).loops,o-.2);
      assert.equal(loops.length,1);
      return contourPath(loops[0],[100,0]);
    };
    const prepared=prepareContourFamily({curveAt,startMm:.2,endMm:2.8,stepMm:.4,toleranceMm:.0025});
    let worst=0;
    for(let i=0;i<19;i++){
      const z=.25+2.4*(i+.31)/19,o=-.3+(i*7%19)/19*.5,u=(i*13%19)/19;
      worst=Math.max(worst,error(prepared.at(u,z,o),curveAt(z,o).at(u)));
    }
    assert.ok(worst<=.0025,`backend ${geometry.kind??'spline'} error ${worst}`);
  }
});

test('cache size stays bounded over arbitrarily many height slabs and offset cells',()=>{
  const prepared=prepareContourFamily({curveAt:circle,startMm:0,endMm:12,stepMm:.4,toleranceMm:.0025});
  for(let i=0;i<75;i++)prepared.at(.217,(i+.3)/75*12,-2+(i*13%75)/75*4);
  assert.ok(prepared.report.maxCachedCurves<=2048);
  assert.throws(()=>prepared.at(NaN,1,0),/finite/);
  assert.throws(()=>prepareContourFamily({curveAt:circle,startMm:0,endMm:1,stepMm:Infinity,toleranceMm:.01}),/finite/);
});
