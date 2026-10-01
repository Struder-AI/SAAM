// Private export utilities. Arithmetic/IO behavior is local to this bucket.
export function bedPoint(point,angle,center,inverse=false){
  const v=rotateZ(point.map((x,i)=>x-center[i]),inverse?-angle:angle);
  return v.map((x,i)=>x+center[i]);
}
export const rotateZ=(v,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];};

// The interpreter and viewer interpolate decoded directions in command time.
// This is frame arithmetic, independent of toolpath construction or admission.
export function interpolateDirections(a,b,t){
  const unit=v=>{const length=Math.hypot(...v);if(!(length>1e-12))throw Error('Degenerate direction.');return v.map(x=>x/length);};
  const mix=(u,v)=>u.map((x,i)=>x+(v[i]-x)*t);
  const axis=unit(mix(a.toolAxis,b.toolAxis)),up=mix(a.toolUp,b.toolUp);
  const projection=up.reduce((sum,x,i)=>sum+x*axis[i],0);
  return {toolAxis:axis,toolUp:unit(up.map((x,i)=>x-projection*axis[i]))};
}
