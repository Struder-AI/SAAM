// Skill-facing geometry queries. Adding a backend does not add a pattern pipeline.
import { sectionShell } from './shell.mjs';
import { topAt as splineTopAt } from './field.mjs';
import { sectionMesh,meshTopAt } from './mesh.mjs';
import { requireThat } from './tolerance.mjs';

export function requireGeometry(geometry, capabilities) {
  requireThat(geometry?.bounds&&((geometry.kind==='triangle-mesh')||Array.isArray(geometry.patches)),'Unsupported geometry backend.');
  requireThat(capabilities.every(c=>['bounds','planar-section','top-surface'].includes(c)),'Unsupported geometry capability.');
  return geometry;
}
export function sectionGeometry(geometry,z,options={}) {
  requireGeometry(geometry,['planar-section']);
  return geometry.kind==='triangle-mesh'?sectionMesh(geometry,z):sectionShell(geometry,z,options);
}
export function topAt(geometry,x,y) {
  requireGeometry(geometry,['top-surface']);
  return geometry.kind==='triangle-mesh'?meshTopAt(geometry,x,y):splineTopAt(geometry,x,y);
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
