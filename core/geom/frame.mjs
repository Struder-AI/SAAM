import {add,subtract,scale,dot,cross,length,requireThat} from './tolerance.mjs';
export {add,subtract,scale,dot,cross,length} from './tolerance.mjs';
export const innerProduct=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);

// Coordinate/frame operations use explicit vectors and transforms. They know
// nothing about tool conventions, rotary installations or controller motion.
export const unitDirection=v=>{const n=length(v);requireThat(n>1e-12,'Degenerate direction.');return scale(v,1/n);};
export const rotateZ=(v,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];};
export const rotatePointZ=(point,degrees,center,inverse=false)=>add(rotateZ(subtract(point,center),inverse?-degrees:degrees),center);
export function validateDirectionPair(primary,secondary){
  for(const v of [primary,secondary])requireThat(Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)&&Math.abs(length(v)-1)<1e-6,'Frame directions must be unit 3-vectors.');
  requireThat(Math.abs(dot(primary,secondary))<1e-6,'Frame directions must be perpendicular.');
}
// Linear direction interpolation, re-orthogonalized; not a rotation trajectory
// or inverse-kinematics solver. Opposed/degenerate intermediate axes fail.
export function interpolateDirectionPair(a,b,t){
  const mix=(u,v)=>u.map((x,i)=>x+(v[i]-x)*t);
  const primary=unitDirection(mix(a[0],b[0])),secondary=mix(a[1],b[1]);
  return [primary,unitDirection(subtract(secondary,scale(primary,dot(secondary,primary))))];
}

export const mv=(matrix,vector)=>matrix.map(row=>dot(row,vector));
export const transpose=matrix=>matrix[0].map((_,i)=>matrix.map(row=>row[i]));
export const mm=(a,b)=>a.map(row=>transpose(b).map(column=>dot(row,column)));
export const identity=()=>[[1,0,0],[0,1,0],[0,0,1]];
export function rotation(axis,angle){
  const [x,y,z]=unitDirection(axis),c=Math.cos(angle),s=Math.sin(angle),d=1-c;
  return [[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
}
export const rigid=(translationMm=[0,0,0],rotation=identity())=>({translationMm,rotation});
export const point=(transform,p)=>add(transform.translationMm,mv(transform.rotation,p));
export const compose=(a,b)=>rigid(point(a,b.translationMm),mm(a.rotation,b.rotation));
export const invert=transform=>{const r=transpose(transform.rotation);return rigid(scale(mv(r,transform.translationMm),-1),r);};
export function axisFrame(z,up=[0,1,0]){
  z=unitDirection(z);if(Math.abs(dot(z,up))>.999)up=[1,0,0];
  const x=unitDirection(cross(up,z)),y=cross(z,x);return x.map((_,i)=>[x[i],y[i],z[i]]);
}
export const rodFrame=(from,to)=>rigid(from,axisFrame(subtract(to,from)));
export function validateRigid(transform){
  requireThat(Array.isArray(transform?.translationMm)&&transform.translationMm.length===3&&transform.translationMm.every(Number.isFinite)&&Array.isArray(transform.rotation)&&transform.rotation.length===3&&transform.rotation.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite)),'Invalid rigid transform');
  const gram=mm(transform.rotation,transpose(transform.rotation));
  requireThat(!gram.some((row,i)=>row.some((v,j)=>Math.abs(v-(i===j?1:0))>1e-6))&&dot(transform.rotation[0],cross(transform.rotation[1],transform.rotation[2]))>=1-1e-6,'Transform rotation must be right-handed orthonormal');
  return transform;
}
