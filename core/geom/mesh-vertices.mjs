// Bounded normalization of source vertex coordinates; parsing remains exact.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {requireThat} from './tolerance.mjs';
import {checkMeshCapacity} from './mesh-capacity.mjs';

// Source normalization keeps original coordinates. Retained representatives never
// move; every source vertex maps directly to one less than print resolution away.
// Lexicographic coordinate order makes the choice independent of triangle order.
// Collapsed faces and unused vertices are reported. Parsing itself remains exact,
// including the decimal reimport that certifies repaired output.
export const VERTEX_MERGE_METHOD='print-resolution-retained/1';
export function mergeCloseVertices(vertices,triangles,toleranceMm=PRINT_RESOLUTION_MM){
  if(!Number.isFinite(toleranceMm)||toleranceMm<=0)throw Error('Vertex merge needs a positive tolerance in millimetres.');
  requireThat(Array.isArray(vertices)&&vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Source mesh vertices must be finite XYZ millimetres.');
  requireThat(Array.isArray(triangles)&&triangles.every(t=>Array.isArray(t)&&t.length===3&&t.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length)),'Invalid source mesh triangle indices.');
  checkMeshCapacity(vertices.length,triangles.length);
  const n=vertices.length,report={method:VERTEX_MERGE_METHOD,toleranceMm,mergedVertices:0,collapsedTriangles:0,unusedVertices:0,maxDisplacementMm:0};
  const magnitude=[0,0,0];for(const p of vertices)for(let k=0;k<3;k++)magnitude[k]=Math.max(magnitude[k],Math.abs(p[k]));
  const width=magnitude.map(m=>2**Math.max(Math.ceil(Math.log2(toleranceMm)),Math.ceil(Math.log2(m||Number.MIN_VALUE))-48));
  const compareCoordinates=(a,b)=>vertices[a][0]-vertices[b][0]||vertices[a][1]-vertices[b][1]||vertices[a][2]-vertices[b][2]||a-b;
  const order=Int32Array.from({length:n},(_,i)=>i).sort(compareCoordinates);
  const representative=new Int32Array(n),cells=new Map(),key=(x,y,z)=>(Math.imul(x|0,73856093)^Math.imul(y|0,19349663)^Math.imul(z|0,83492791));
  for(const i of order){
    const p=vertices[i],c=[0,1,2].map(k=>Math.floor(p[k]/width[k])),nearest={index:-1,distance:toleranceMm};
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of cells.get(key(c[0]+x,c[1]+y,c[2]+z))??[]){
      const q=vertices[j],d=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
      if(d<nearest.distance){nearest.index=j;nearest.distance=d;}
    }
    if(nearest.index<0){representative[i]=i;const name=key(...c),bucket=cells.get(name);if(bucket)bucket.push(i);else cells.set(name,[i]);}
    else{representative[i]=nearest.index;report.mergedVertices++;report.maxDisplacementMm=Math.max(report.maxDisplacementMm,nearest.distance);}
  }
  const mapped=triangles.map(t=>t.map(v=>representative[v]));
  const kept=mapped.filter(t=>t[0]!==t[1]&&t[1]!==t[2]&&t[0]!==t[2]);report.collapsedTriangles=mapped.length-kept.length;
  if(!report.mergedVertices&&!report.collapsedTriangles)return {vertices,triangles,merge:report};
  const used=new Map(),points=[];
  const compactVertex=v=>{const known=used.get(v);if(known!==undefined)return known;const index=points.length;used.set(v,index);points.push(vertices[v]);return index;};
  const output=kept.map(t=>t.map(compactVertex));
  report.unusedVertices=n-report.mergedVertices-points.length;
  return {vertices:points,triangles:output,merge:report};
}
