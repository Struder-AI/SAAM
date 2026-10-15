// STL downloads serialize already prepared geometry; no machine export authority.
export function coverSTL(mesh){
  const data=new ArrayBuffer(84+50*mesh.triangles.length),view=new DataView(data);
  view.setUint32(80,mesh.triangles.length,true);
  for(const [i,triangle] of mesh.triangles.entries()){
    const [a,b,c]=triangle.map(index=>mesh.vertices[index]),u=b.map((value,k)=>value-a[k]),v=c.map((value,k)=>value-a[k]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
    const values=[...normal.map(value=>length?value/length:0),...a,...b,...c];
    for(const [k,value] of values.entries())view.setFloat32(84+50*i+4*k,value,true);
  }
  return new Blob([data],{type:'model/stl'});
}
