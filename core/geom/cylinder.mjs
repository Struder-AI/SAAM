// Bounded circular pipe geometry and a periodic cylindrical coordinate chart.
import {requireThat} from './tolerance.mjs';
import {makeMesh} from './mesh.mjs';
export function circlePoints(radius,center=[0,0],toleranceMm=0.01){
  requireThat(radius>0&&toleranceMm>0,'Invalid circle dimensions.');
  const count=Math.max(16,Math.ceil(Math.PI/Math.acos(Math.max(-1,1-Math.min(toleranceMm,radius)/radius))));
  requireThat(Number.isSafeInteger(count),'Circle tolerance is too fine to resolve a representable segment count.');
  return Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count;return [center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a)];});
}
export function pipeMesh({innerRadiusMm,outerRadiusMm,heightMm,toleranceMm}){
  requireThat(innerRadiusMm>0&&outerRadiusMm>innerRadiusMm&&heightMm>0,'Pipe needs positive height and ordered radii.');
  const outer=circlePoints(outerRadiusMm,[0,0],toleranceMm),n=outer.length,vertices=[];
  for(const z of [0,heightMm])for(const r of [outerRadiusMm,innerRadiusMm])for(let i=0;i<n;i++){
    const a=2*Math.PI*i/n;vertices.push([r*Math.cos(a),r*Math.sin(a),z]);
  }
  const triangles=[],quad=(a,b,c,d)=>triangles.push([a,b,c],[a,c,d]);
  for(let i=0;i<n;i++){const j=(i+1)%n;quad(i,j,2*n+j,2*n+i);quad(n+j,n+i,3*n+i,3*n+j);quad(j,i,n+i,n+j);quad(2*n+i,2*n+j,3*n+j,3*n+i);}
  return makeMesh(vertices,triangles);
}
export function cylindricalPoint(center,radius,angle,z){const a=angle*Math.PI/180;return [center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),z];}
export function cylindricalPose(angle,tiltDeg){const a=angle*Math.PI/180,t=tiltDeg*Math.PI/180;return {rotaryDeg:-angle,toolAxis:[-Math.sin(t)*Math.cos(a),-Math.sin(t)*Math.sin(a),-Math.cos(t)],toolUp:[-Math.sin(a),Math.cos(a),0]};}
