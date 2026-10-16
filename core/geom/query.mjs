// Skill-facing geometry queries. Adding a backend does not add a pattern pipeline.
import { topAt as splineTopAt,crossingsAt as splineCrossingsAt } from './field.mjs';
import { meshTopAt,meshCrossingsAt } from './mesh.mjs';
import {horizontalSlice} from './slice.mjs';
import {section,prepareSection} from '../region/section.mjs';
import { requireThat,dot,cross } from './tolerance.mjs';
import { PRINT_RESOLUTION_MM,ROUNDING_MM,FLOAT64_EPSILON } from '../dimensions.mjs';
import {chartPrismContains} from './chart-prism.mjs';
import {triangleBVH} from './triangle-bvh.mjs';

export function requireGeometry(geometry, capabilities) {
  requireThat(geometry?.bounds&&((geometry.kind==='triangle-mesh')||geometry.kind==='chart-prism'||geometry.kind==='boolean'||Array.isArray(geometry.patches)),'Unsupported geometry backend.');
  requireThat(capabilities.every(c=>['bounds','planar-section','top-surface'].includes(c)),'Unsupported geometry capability.');
  if(geometry.kind==='boolean')for(const operand of geometry.operands)requireGeometry(operand,capabilities);
  return geometry;
}
// Deferred z-only forms, kept only for vase-wall and its test until vase-wall
// sections by slice. New code sections with section(geometry, slice) in
// slice.mjs.
export function sectionGeometry(geometry,z,options={}) {
  requireGeometry(geometry,['planar-section']);
  return section(geometry,horizontalSlice(z),options);
}
// Repeated horizontal sections of one fixed geometry, sharing search data.
export function createSectionQuery(geometry,options={}) {
  requireGeometry(geometry,['planar-section']);
  const prepared=prepareSection(geometry,horizontalSlice(0));
  return z=>section(prepared,horizontalSlice(z),options);
}
export function topAt(geometry,x,y) {
  requireGeometry(geometry,['top-surface']);
  if(geometry.kind==='boolean')return geometry.operation==='union'?unionTopAt(geometry,x,y):booleanTopAt(geometry,x,y);
  return geometry.kind==='triangle-mesh'?meshTopAt(geometry,x,y):splineTopAt(geometry,x,y);
}
// Every surface crossing of the vertical line through (x, y) on one solid.
function crossingsAt(geometry,x,y){
  return geometry.kind==='triangle-mesh'?meshCrossingsAt(geometry,x,y):splineCrossingsAt(geometry,x,y);
}
export function sampleTopSurface(geometry,{stepMm=1,maxSlopeDeg=90}={}) {
  requireGeometry(geometry,['top-surface']);requireThat(Number.isFinite(stepMm)&&stepMm>0,'Sampling step must be positive.');
  const [minX,minY]=geometry.bounds.min,[maxX,maxY]=geometry.bounds.max;
  const columns=Math.max(2,Math.ceil((maxX-minX)/stepMm)),rows=Math.max(2,Math.ceil((maxY-minY)/stepMm));
  const samples=[];let inside=0,steep=0,maxSlope=0;
  for(let i=0;i<=columns;i++)for(let j=0;j<=rows;j++){
    const x=minX+(maxX-minX)*i/columns,y=minY+(maxY-minY)*j/rows,top=topAt(geometry,x,y);
    if(!top)continue;inside++;maxSlope=Math.max(maxSlope,top.slopeDeg);if(top.slopeDeg>maxSlopeDeg)steep++;
    samples.push({x,y,...top});
  }
  return {samples,inside,steep,maxSlopeDeg:maxSlope,stepMm};
}

// A union's highest material in a column is the highest of its operands'.
function unionTopAt(shell,x,y){
  let best=null;
  for(const operand of shell.operands){const top=topAt(operand,x,y);if(top&&(!best||top.zMm>best.zMm))best=top;}
  return best;
}

// Any boolean's top in a column: the highest operand crossing with material
// just below it and none just above. A solid holds a height when an odd number
// of its crossings lie above it; coincident crossings (a shared patch edge,
// neighbouring triangles) count once. The line grazing a vertical wall exactly
// is outside this parity test. Crossings within print resolution are one; a
// probe steps past such a merged pair.
const COINCIDENT_MM=PRINT_RESOLUTION_MM,PROBE_MM=2*PRINT_RESOLUTION_MM;
function booleanTopAt(shell,x,y){
  const leaves=columnCrossings(shell,x,y);
  const candidates=[...leaves.values()].flat().sort((a,b)=>b.zMm-a.zMm);
  return candidates.find(c=>holdsHeight(shell,leaves,c.zMm-PROBE_MM)&&!holdsHeight(shell,leaves,c.zMm+PROBE_MM))??null;
}

// Each solid's distinct crossings of the vertical line through (x, y), highest first.
function columnCrossings(shell,x,y){
  const leaves=new Map();
  const collect=node=>{
    if(node.kind==='boolean'){for(const operand of node.operands)collect(operand);return;}
    const sorted=crossingsAt(node,x,y).sort((a,b)=>b.zMm-a.zMm);
    leaves.set(node,sorted.filter((c,i)=>!i||sorted[i-1].zMm-c.zMm>COINCIDENT_MM));
  };
  collect(shell);
  return leaves;
}
function holdsHeight(node,leaves,z){
  if(node.kind!=='boolean')return leaves.get(node).filter(c=>c.zMm>z).length%2===1;
  const inside=node.operands.map(operand=>holdsHeight(operand,leaves,z));
  return node.operation==='union'?inside.some(Boolean):node.operation==='intersection'?inside.every(Boolean):inside[0]&&!inside.slice(1).some(Boolean);
}

// Whether a point is inside the solid: an odd number of distinct surface
// crossings above it. A point on the surface, or a column grazing a vertical
// wall exactly, is outside what this test decides; callers sample off both.
export function containsPoint(geometry,[x,y,z]){
  if(geometry.kind==='chart-prism')return chartPrismContains(geometry,[x,y,z]);
  requireGeometry(geometry,['bounds']);
  return holdsHeight(geometry,columnCrossings(geometry,x,y),z);
}

// Classify a complete box: 1 inside, -1 outside, 0 unresolved. A closed mesh
// with no boundary near the box has constant membership throughout that box.
// Boolean propagation preserves uncertainty; unsupported surfaces stay unknown.
const solidBoundsQueries=new WeakMap();
function closedMeshMembership(mesh,point){
  let angle=0,error=0;
  for(const triangle of mesh.triangles){
    const [a,b,c]=triangle.map(i=>mesh.vertices[i].map((v,k)=>v-point[k]));
    const [la,lb,lc]=[a,b,c].map(v=>Math.hypot(...v)),scale=la*lb*lc;
    const numerator=dot(a,cross(b,c)),denominator=scale+dot(a,b)*lc+dot(b,c)*la+dot(c,a)*lb;
    const magnitude=Math.hypot(numerator,denominator);if(!magnitude)return 0;
    angle+=2*Math.atan2(numerator,denominator);error+=FLOAT64_EPSILON*256*scale/magnitude;
  }
  const winding=angle/(4*Math.PI),nearest=Math.round(winding);
  if(!Number.isFinite(winding)||Math.abs(winding-nearest)+error>=.5)return 0;
  return Math.abs(nearest)%2?1:-1;
}
export function prepareSolidBoundsQuery(geometry){
  if(solidBoundsQueries.has(geometry))return solidBoundsQueries.get(geometry);
  const outside=box=>box.min.some((v,k)=>v>geometry.bounds.max[k]+ROUNDING_MM||box.max[k]<geometry.bounds.min[k]-ROUNDING_MM);
  let classify=box=>geometry.empty||outside(box)?-1:0;
  if(geometry.kind==='boolean'){
    const operands=geometry.operands.map(prepareSolidBoundsQuery);
    classify=box=>{
      if(geometry.empty||outside(box))return -1;
      const values=operands.map(query=>query(box));
      return geometry.operation==='union'?(values.includes(1)?1:values.every(v=>v===-1)?-1:0):
        geometry.operation==='intersection'?(values.includes(-1)?-1:values.every(v=>v===1)?1:0):
        values[0]===-1||values.slice(1).includes(1)?-1:values[0]===1&&values.slice(1).every(v=>v===-1)?1:0;
    };
  }else if(geometry.kind==='triangle-mesh'&&geometry.topology&&
      ['openEdges','nonmanifoldEdges','nonmanifoldVertices','inconsistentEdges'].every(key=>geometry.topology[key]===0)){
    const tree=triangleBVH(geometry.vertices,geometry.triangles);
    classify=box=>{
      if(geometry.empty||outside(box))return -1;
      let boundary=false;
      tree.query(box.min,box.max,i=>{
        if(boundary)return;
        const triangle=geometry.triangles[i].map(index=>geometry.vertices[index]);
        if(!box.min.some((v,k)=>v>Math.max(...triangle.map(p=>p[k]))+ROUNDING_MM||box.max[k]<Math.min(...triangle.map(p=>p[k]))-ROUNDING_MM))boundary=true;
      });
      if(boundary)return 0;
      return closedMeshMembership(geometry,box.min.map((v,k)=>(v+box.max[k])/2));
    };
  }
  solidBoundsQueries.set(geometry,classify);return classify;
}
