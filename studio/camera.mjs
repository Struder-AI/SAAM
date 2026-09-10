// Freeze the camera transform for one frame. Bounds and layout reads belong
// outside the endpoint loop; each segment still uses the same projection.
export function createProjection(bounds,width,height,yaw,tilt,zoom) {
  const size=bounds.max.map((v,i)=>Math.max(1,v-bounds.min[i]));
  const center=bounds.min.map((v,i)=>(v+bounds.max[i])/2);
  const cosYaw=Math.cos(yaw),sinYaw=Math.sin(yaw),cosTilt=Math.cos(tilt),sinTilt=Math.sin(tilt);
  const scale=Math.min(width/(size[0]+size[1])*1.1,height/(size[2]+Math.max(size[0],size[1]))*.9)*zoom;
  return point=>{
    const x=point[0]-center[0],y=point[1]-center[1],z=point[2]-center[2];
    const u=x*cosYaw-y*sinYaw,v=x*sinYaw+y*cosYaw;
    // Orthographic, right-handed XYZ: +Y goes into the bed, +Z goes up.
    // Canvas Y increases downward; depth increases toward the viewer.
    return [width/2+u*scale,height*.53-(v*sinTilt+z*cosTilt)*scale,-v*cosTilt+z*sinTilt];
  };
}
