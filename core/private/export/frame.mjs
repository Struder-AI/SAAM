// Private export utilities. Arithmetic/IO behavior is local to this bucket.
export function bedPoint(point,angle,center,inverse=false){
  const v=rotateZ(point.map((x,i)=>x-center[i]),inverse?-angle:angle);
  return v.map((x,i)=>x+center[i]);
}
export const rotateZ=(v,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];};
