// Skill-facing geometry queries. Adding a backend does not add a pattern pipeline.
import { sectionShell } from './shell.mjs';
import { topAt as splineTopAt,crossingsAt as splineCrossingsAt } from './field.mjs';
import { sectionMesh,meshTopAt,meshCrossingsAt,createMeshSectionQuery } from './mesh.mjs';
import { requireThat } from './tolerance.mjs';
import { union,intersect,difference } from '../region/intersection.mjs';

export function requireGeometry(geometry, capabilities) {
  requireThat(geometry?.bounds&&((geometry.kind==='triangle-mesh')||geometry.kind==='boolean'||Array.isArray(geometry.patches)),'Unsupported geometry backend.');
  requireThat(capabilities.every(c=>['bounds','planar-section','top-surface'].includes(c)),'Unsupported geometry capability.');
  if(geometry.kind==='boolean')for(const operand of geometry.operands)requireGeometry(operand,capabilities);
  return geometry;
}
export function sectionGeometry(geometry,z,options={}) {
  requireGeometry(geometry,['planar-section']);
  if(geometry.kind==='boolean')return combineSections(geometry.operation,geometry.operands.map(o=>sectionGeometry(o,z,options)),z);
  return geometry.kind==='triangle-mesh'?sectionMesh(geometry,z):sectionShell(geometry,z,options);
}
// Prepare repeated sections of one fixed geometry without changing cut semantics.
// Keep this query local to generation; rebuild it after changing geometry.
export function createSectionQuery(geometry,options={}) {
  requireGeometry(geometry,['planar-section']);
  if(geometry.kind==='boolean'){
    const queries=geometry.operands.map(o=>createSectionQuery(o,options));
    return z=>combineSections(geometry.operation,queries.map(query=>query(z)),z);
  }
  return geometry.kind==='triangle-mesh'?createMeshSectionQuery(geometry):z=>sectionShell(geometry,z,options);
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

// Boolean backend (boolean-solid.mjs): every operand keeps its own query.
// Difference subtracts every later operand from the first.
function combineSections(operation,sections,z){
  const loops=sections.map(s=>s.loops);
  const result=operation==='union'?loops.reduce((a,b)=>union(a,b),[])
    :operation==='difference'?difference(loops[0],loops.slice(1).reduce((a,b)=>union(a,b),[]))
    :loops.slice(1).reduce((a,b)=>intersect(a,b),loops[0]);
  const nudgedByMm=sections.reduce((n,s)=>Math.abs(s.nudgedByMm??0)>Math.abs(n)?s.nudgedByMm:n,0);
  return {loops:result,requestedZ:z,nudgedByMm};
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
// is outside this parity test.
const COINCIDENT_MM=1e-7,PROBE_MM=1e-6;
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
  requireGeometry(geometry,['bounds']);
  return holdsHeight(geometry,columnCrossings(geometry,x,y),z);
}
